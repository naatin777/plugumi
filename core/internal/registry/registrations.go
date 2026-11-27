// Package registry は登録、Lease、Tool宣言、接続状態とRevisionを管理する（contracts/00004）。
package registry

import (
	"cmp"
	"context"
	"crypto/rand"
	"errors"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

const leaseDuration = 60 * time.Second

// 予約はupgrade完了までの一時的な占有。upgradeが止まったままの予約を
// 回収しないと、その登録は再接続できず、再登録でLeaseが延び続けて
// 永久に409が返り続ける。
const reservationTTL = 15 * time.Second

// アップロード済みだがどのUI manifestからも参照されないassetの保持期限。
// 登録が途中で止まってもファイルが残らないようにする。
const unreferencedAssetTTL = 60 * time.Second

var (
	ErrUnknownRegistration   = errors.New("unknown registration")
	ErrRegistrationConflict  = errors.New("instance already registered with another pluginId")
	ErrConnectionInUse       = errors.New("registration already has an RPC connection")
	ErrConnectionUnavailable = errors.New("plugin connection unavailable")
	ErrUnknownOperation      = errors.New("unknown operation")
	ErrInvalidOperations     = errors.New("invalid or duplicated operation declaration")
	ErrAmbiguousOperation    = errors.New("operation provided by multiple providers")
	ErrInvalidUI             = errors.New("invalid UI manifest")
)

type registration struct {
	identity    wire.ProviderIdentity
	lease       wire.RegistrationLease
	operations  []wire.OperationDeclaration
	files       []wire.UIFile
	panels      []wire.PanelDeclaration
	uiSHA256    string
	connection  *rpc.Connection
	reservation *ConnectionReservation
}

type Event struct {
	Name     string
	Revision string
}

type Registry struct {
	mu          sync.Mutex
	coreID      string
	now         func() time.Time
	revision    uint64
	byID        map[string]*registration
	byInstance  map[string]*registration
	subscribers map[chan Event]struct{}
	assets      map[string]*asset
}

func New(coreID string) *Registry {
	return &Registry{
		coreID:      coreID,
		now:         time.Now,
		byID:        make(map[string]*registration),
		byInstance:  make(map[string]*registration),
		subscribers: make(map[chan Event]struct{}),
		assets:      make(map[string]*asset),
	}
}

func (r *Registry) Create(identity wire.ProviderIdentity) (wire.RegistrationLease, bool, error) {
	r.mu.Lock()
	now := r.now()
	var expiredConnection *rpc.Connection
	if previous := r.byInstance[identity.InstanceID]; previous != nil {
		if now.Before(previous.lease.ExpiresAt) {
			if previous.identity.ProviderID != identity.ProviderID {
				r.mu.Unlock()
				return wire.RegistrationLease{}, false, ErrRegistrationConflict
			}
			// 再接続前の別の更新リクエストを不要にする（contracts/00004）。
			previous.lease.ExpiresAt = now.Add(leaseDuration)
			lease := previous.lease
			r.mu.Unlock()
			return lease, false, nil
		}
		expiredConnection = r.removeLocked(previous)
	}
	lease := wire.RegistrationLease{
		CoreID: r.coreID, RegistrationID: "registration-" + rand.Text(),
		LeaseSeconds: int(leaseDuration.Seconds()), ExpiresAt: now.Add(leaseDuration),
	}
	record := &registration{identity: identity, lease: lease}
	r.byID[lease.RegistrationID] = record
	r.byInstance[identity.InstanceID] = record
	r.publishLocked("provider.added")
	r.mu.Unlock()
	if expiredConnection != nil {
		expiredConnection.CloseNow()
	}
	return lease, true, nil
}

func (r *Registry) liveLocked(registrationID string, now time.Time) *registration {
	record := r.byID[registrationID]
	if record == nil || !now.Before(record.lease.ExpiresAt) {
		return nil
	}
	return record
}

func (r *Registry) Renew(registrationID string) (wire.RegistrationLease, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	record := r.liveLocked(registrationID, now)
	if record == nil {
		return wire.RegistrationLease{}, false
	}
	record.lease.ExpiresAt = now.Add(leaseDuration)
	return record.lease, true
}

// validOperationPath はcontracts/00004のpath制約を検査する。
// 空のsegment、先頭・末尾の /、空白、. / .. segmentを拒否する。
func validOperationPath(path string) bool {
	if path == "" || strings.HasPrefix(path, "/") || strings.HasSuffix(path, "/") {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "." || segment == ".." || strings.ContainsAny(segment, " \t\n") {
			return false
		}
	}
	return true
}

func (r *Registry) ReplaceOperations(registrationID string, declarations []wire.OperationDeclaration) error {
	operations := slices.Clone(declarations)
	paths := make(map[string]bool, len(operations))
	for _, operation := range operations {
		if paths[operation.Path] || !validOperationPath(operation.Path) {
			return ErrInvalidOperations
		}
		paths[operation.Path] = true
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.liveLocked(registrationID, r.now())
	if record == nil {
		return ErrUnknownRegistration
	}
	if !slices.EqualFunc(record.operations, operations, func(first, second wire.OperationDeclaration) bool {
		return reflect.DeepEqual(first, second)
	}) {
		record.operations = operations
		r.publishLocked("operations.changed")
	}
	return nil
}

// ResolveOperation はoperation pathからproviderを解決する。
// Lease・宣言・接続を同じ時点で確認する。
// 初期実装ではroutingを行わず、宣言しているliveなproviderが
// ちょうど1つの場合だけ解決する。複数ならambiguous、ゼロならunknown。
func (r *Registry) ResolveOperation(path string) (*rpc.Connection, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	var found *registration
	count := 0
	for _, record := range r.byID {
		if !now.Before(record.lease.ExpiresAt) {
			continue
		}
		for _, operation := range record.operations {
			if operation.Path == path {
				found = record
				count++
				break
			}
		}
	}
	if count == 0 {
		return nil, ErrUnknownOperation
	}
	if count > 1 {
		return nil, ErrAmbiguousOperation
	}
	if found.connection == nil {
		return nil, ErrConnectionUnavailable
	}
	return found.connection, nil
}

// ListOperations は現在liveな登録のoperation宣言を集約する。
func (r *Registry) ListOperations() []wire.OperationDeclaration {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	seen := make(map[string]bool)
	var result []wire.OperationDeclaration
	for _, record := range r.byID {
		if !now.Before(record.lease.ExpiresAt) {
			continue
		}
		for _, operation := range record.operations {
			if !seen[operation.Path] {
				seen[operation.Path] = true
				result = append(result, operation)
			}
		}
	}
	slices.SortFunc(result, func(first, second wire.OperationDeclaration) int {
		return cmp.Compare(first.Path, second.Path)
	})
	return result
}

type ConnectionReservation struct {
	registry       *Registry
	registrationID string
	reservedAt     time.Time
}

// ReserveConnection はHTTP upgradeの間だけ接続枠を押さえる。ネットワークI/Oはロックの外で行う。
// 前の予約がreservationTTLを超えて完了していなければ、止まったupgradeとみなして回収する。
func (r *Registry) ReserveConnection(registrationID string) (*ConnectionReservation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.now()
	record := r.liveLocked(registrationID, now)
	if record == nil {
		return nil, ErrUnknownRegistration
	}
	if record.connection != nil {
		return nil, ErrConnectionInUse
	}
	if record.reservation != nil && now.Sub(record.reservation.reservedAt) < reservationTTL {
		return nil, ErrConnectionInUse
	}
	reservation := &ConnectionReservation{registry: r, registrationID: registrationID, reservedAt: now}
	record.reservation = reservation
	return reservation, nil
}

// Complete は予約を消費する。nilはupgrade失敗、falseは接続できなかったことを表す。
func (reservation *ConnectionReservation) Complete(connection *rpc.Connection) bool {
	r := reservation.registry
	r.mu.Lock()
	defer r.mu.Unlock()
	record := r.byID[reservation.registrationID]
	if record == nil || record.reservation != reservation {
		return false
	}
	record.reservation = nil
	if connection == nil || !r.now().Before(record.lease.ExpiresAt) {
		return false
	}
	record.connection = connection
	r.publishLocked("provider.changed")
	return true
}

func (r *Registry) Detach(registrationID string, connection *rpc.Connection) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if record := r.byID[registrationID]; record != nil && record.connection == connection {
		record.connection = nil
		if r.now().Before(record.lease.ExpiresAt) {
			r.publishLocked("provider.changed")
		}
	}
}

func (r *Registry) Delete(registrationID string) bool {
	r.mu.Lock()
	record := r.liveLocked(registrationID, r.now())
	if record == nil {
		r.mu.Unlock()
		return false
	}
	connection := r.removeLocked(record)
	r.mu.Unlock()
	if connection != nil {
		connection.CloseNow()
	}
	return true
}

func (r *Registry) removeLocked(record *registration) *rpc.Connection {
	delete(r.byID, record.lease.RegistrationID)
	delete(r.byInstance, record.identity.InstanceID)
	r.releaseFilesLocked(record.files)
	r.publishLocked("provider.removed")
	return record.connection
}

func (r *Registry) collectExpiredLocked(now time.Time) []*rpc.Connection {
	var connections []*rpc.Connection
	for _, record := range r.byID {
		if !now.Before(record.lease.ExpiresAt) {
			if connection := r.removeLocked(record); connection != nil {
				connections = append(connections, connection)
			}
		}
	}
	return connections
}

func (r *Registry) Expire(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.mu.Lock()
			expiredConnections := r.collectExpiredLocked(r.now())
			r.collectStaleAssetsLocked(r.now())
			r.mu.Unlock()
			for _, connection := range expiredConnections {
				connection.CloseNow()
			}
		}
	}
}

func (r *Registry) Snapshot() wire.RegistrySnapshot {
	r.mu.Lock()
	// Snapshotから期限切れを除く時点でRevisionも進める。
	expiredConnections := r.collectExpiredLocked(r.now())
	result := wire.RegistrySnapshot{
		CoreID: r.coreID, Revision: r.revisionLocked(),
		Registrations: make([]wire.RegistryRegistration, 0, len(r.byID)),
	}
	for _, record := range r.byID {
		result.Registrations = append(result.Registrations, wire.RegistryRegistration{
			RegistrationID: record.lease.RegistrationID,
			ProviderID:     record.identity.ProviderID,
			Environment:    record.identity.Environment,
			HostSession:    record.identity.HostSession,
			RPCAvailable:   record.connection != nil,
			Operations:     append([]wire.OperationDeclaration{}, record.operations...),
			Panels:         append([]wire.PanelDeclaration{}, record.panels...),
			UISHA256:       record.uiSHA256,
		})
	}
	r.mu.Unlock()
	for _, connection := range expiredConnections {
		connection.CloseNow()
	}
	slices.SortFunc(result.Registrations, func(first, second wire.RegistryRegistration) int {
		return cmp.Compare(first.RegistrationID, second.RegistrationID)
	})
	return result
}

func (r *Registry) revisionLocked() string {
	return r.coreID + ":" + strconv.FormatUint(r.revision, 10)
}

func (r *Registry) publishLocked(name string) {
	r.revision++
	event := Event{Name: name, Revision: r.revisionLocked()}
	for subscriber := range r.subscribers {
		select {
		case subscriber <- event:
		default:
			close(subscriber)
			delete(r.subscribers, subscriber)
		}
	}
}

func (r *Registry) Subscribe() (<-chan Event, func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	subscriber := make(chan Event, 32)
	subscriber <- Event{Name: "registry.reset", Revision: r.revisionLocked()}
	r.subscribers[subscriber] = struct{}{}
	return subscriber, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if _, ok := r.subscribers[subscriber]; ok {
			delete(r.subscribers, subscriber)
			close(subscriber)
		}
	}
}
