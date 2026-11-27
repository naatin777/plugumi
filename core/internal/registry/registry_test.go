package registry

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

func TestReplaceOperationsValidatesAndPublishesOnlyOnChange(t *testing.T) {
	registry := New("test-core", "")
	lease, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"})
	declarations := []wire.OperationDeclaration{
		{Path: "a/one"},
		{Path: "a/two"},
	}
	if err := registry.ReplaceOperations(lease.RegistrationID, declarations); err != nil {
		t.Fatal(err)
	}
	snapshot := registry.Snapshot()
	operations := snapshot.Registrations[0].Operations
	if len(operations) != 2 || operations[0].Path != "a/one" {
		t.Fatalf("unexpected operations: %+v", operations)
	}
	if err := registry.ReplaceOperations(lease.RegistrationID, declarations); err != nil {
		t.Fatal(err)
	}
	if current := registry.Snapshot(); current.Revision != snapshot.Revision {
		t.Fatalf("identical replacement changed the revision: %s", current.Revision)
	}

	// contracts/00004のpath制約: 重複・空segment・先頭末尾の /・空白・. / ..を拒否する
	for _, invalid := range [][]wire.OperationDeclaration{
		{{Path: "a/one"}, {Path: "a/one"}},   // 重複
		{{Path: ""}},                        // 空
		{{Path: "/a"}},                      // 先頭 /
		{{Path: "a/"}},                      // 末尾 /
		{{Path: "a//b"}},                    // 空segment
		{{Path: "a/../b"}},                  // .. segment
		{{Path: "a/b c"}},                   // 空白
	} {
		if err := registry.ReplaceOperations(lease.RegistrationID, invalid); err != ErrInvalidOperations {
			t.Fatalf("invalid declarations accepted: %+v", invalid)
		}
	}
}

func TestExpiredRegistrationIsNotRoutableBeforeCleanup(t *testing.T) {
	registry := New("test-core", "")
	now := time.Now()
	registry.now = func() time.Time { return now }
	identity := wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"}
	lease, _, _ := registry.Create(identity)
	if err := registry.ReplaceOperations(lease.RegistrationID, []wire.OperationDeclaration{{Path: "echo"}}); err != nil {
		t.Fatal(err)
	}
	reservation, err := registry.ReserveConnection(lease.RegistrationID)
	if err != nil {
		t.Fatal(err)
	}
	connection := &rpc.Connection{}
	if !reservation.Complete(connection) {
		t.Fatal("Could not attach to live registration")
	}
	if err := registry.SetReady(lease.RegistrationID); err != nil {
		t.Fatal(err)
	}
	if got, err := registry.ResolveOperation("echo"); got != connection || err != nil {
		t.Fatalf("live registration was not routable: %v", err)
	}
	if _, err := registry.ResolveOperation("nonexistent"); err != ErrUnknownOperation {
		t.Fatalf("unknown operation resolved: %v", err)
	}
	now = lease.ExpiresAt
	if _, err := registry.ResolveOperation("echo"); err != ErrUnknownOperation {
		t.Fatalf("expired registration is still routable: %v", err)
	}
	if _, found := registry.Renew(lease.RegistrationID); found {
		t.Fatal("expired registration renewed")
	}
	registry.Detach(lease.RegistrationID, connection)
	events, unsubscribe := registry.Subscribe()
	defer unsubscribe()
	reset := <-events
	snapshot := registry.Snapshot()
	if len(snapshot.Registrations) != 0 || snapshot.Revision == reset.Revision {
		t.Fatalf("expiration should advance the revision and hide the registration: %+v", snapshot)
	}
	select {
	case removed := <-events:
		if removed.Name != "provider.removed" || removed.Revision != snapshot.Revision {
			t.Fatalf("unexpected expiration event: %+v", removed)
		}
	default:
		t.Fatal("missing expiration event")
	}
	if current, created, err := registry.Create(identity); err != nil || !created || current.RegistrationID == lease.RegistrationID {
		t.Fatalf("expected a fresh registration: %+v %v", current, err)
	}
}

// 接続の無い登録（zombie）はoperation解決で数えない。
// processが死んでleaseだけ残った登録が、生きているproviderの
// 解決をambiguousにしないことを確認する。
func TestDisconnectedRegistrationDoesNotCauseAmbiguity(t *testing.T) {
	registry := New("test-core", "")
	first, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "fs", InstanceID: "instance-1"})
	second, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "fs", InstanceID: "instance-2"})
	for _, lease := range []wire.RegistrationLease{first, second} {
		if err := registry.ReplaceOperations(lease.RegistrationID, []wire.OperationDeclaration{{Path: "echo"}}); err != nil {
			t.Fatal(err)
		}
		if err := registry.SetReady(lease.RegistrationID); err != nil {
			t.Fatal(err)
		}
	}
	// secondだけ接続する。firstは宣言・ready済みだが未接続のまま
	// （process死亡でdetachされた状態と同じ）。
	reservation, err := registry.ReserveConnection(second.RegistrationID)
	if err != nil {
		t.Fatal(err)
	}
	connection := &rpc.Connection{}
	if !reservation.Complete(connection) {
		t.Fatal("Could not attach to live registration")
	}
	if got, err := registry.ResolveOperation("echo"); got != connection || err != nil {
		t.Fatalf("disconnected registration caused ambiguity or wrong resolution: %v", err)
	}
	// 接続している方も切ると、unknownではなくunavailableになる
	// （「居ない」と「居るが繋がらない」を区別する）。
	registry.Detach(second.RegistrationID, connection)
	if _, err := registry.ResolveOperation("echo"); err != ErrConnectionUnavailable {
		t.Fatalf("fully disconnected resolution should be unavailable: %v", err)
	}
}

func TestRepeatRegistrationRefreshesLeaseWithoutChangingTheRegistry(t *testing.T) {
	registry := New("test-core", "")
	now := time.Now()
	registry.now = func() time.Time { return now }
	identity := wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"}
	first, _, err := registry.Create(identity)
	if err != nil {
		t.Fatal(err)
	}
	revision := registry.Snapshot().Revision
	now = first.ExpiresAt.Add(-time.Second)
	repeated, created, err := registry.Create(identity)
	if err != nil || created || repeated.RegistrationID != first.RegistrationID {
		t.Fatalf("expected the same registration: %+v, %v", repeated, err)
	}
	if want := now.Add(time.Duration(first.LeaseSeconds) * time.Second); !repeated.ExpiresAt.Equal(want) {
		t.Fatalf("retry expiry = %v, want %v", repeated.ExpiresAt, want)
	}
	now = first.ExpiresAt
	snapshot := registry.Snapshot()
	if snapshot.Revision != revision || len(snapshot.Registrations) != 1 {
		t.Fatalf("renewing should keep the existing registration and revision: %+v", snapshot)
	}
}

// upgrade中に止まった予約はreservationTTLを過ぎると回収され、
// 再登録でLeaseが延び続けても再接続が永久に失敗しない。
func TestStaleReservationIsReclaimed(t *testing.T) {
	registry := New("test-core", "")
	now := time.Now()
	registry.now = func() time.Time { return now }
	lease, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"})
	stale, err := registry.ReserveConnection(lease.RegistrationID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := registry.ReserveConnection(lease.RegistrationID); err != ErrConnectionInUse {
		t.Fatalf("in-flight reservation should conflict: %v", err)
	}
	now = now.Add(reservationTTL)
	fresh, err := registry.ReserveConnection(lease.RegistrationID)
	if err != nil {
		t.Fatalf("stale reservation was not reclaimed: %v", err)
	}
	if stale.Complete(&rpc.Connection{}) {
		t.Fatal("reclaimed reservation still completed")
	}
	if !fresh.Complete(&rpc.Connection{}) {
		t.Fatal("new reservation did not complete")
	}
}

func TestConnectionReservationDoesNotSurviveDeletion(t *testing.T) {
	registry := New("test-core", "")
	lease, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"})
	first, err := registry.ReserveConnection(lease.RegistrationID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := registry.ReserveConnection(lease.RegistrationID); err != ErrConnectionInUse {
		t.Fatalf("second reservation should conflict: %v", err)
	}
	first.Complete(nil)
	second, err := registry.ReserveConnection(lease.RegistrationID)
	if err != nil {
		t.Fatalf("failed upgrade left the registration reserved: %v", err)
	}
	if !registry.Delete(lease.RegistrationID) || second.Complete(&rpc.Connection{}) {
		t.Fatal("upgrade completed on a deleted registration")
	}
}

func TestReplaceUIPublishesPanelsChanged(t *testing.T) {
	registry := New("test-core", "")
	events, unsubscribe := registry.Subscribe()
	defer unsubscribe()
	lease, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"})
	drain(events)
	hash := strings.Repeat("a", 64)
	// pull modelでは宣言時に内容の存在を要求しない
	manifest := wire.UIManifest{
		Files:  []wire.UIFile{{Path: "panel.js", SHA256: hash}},
		Panels: []wire.PanelDeclaration{{PanelID: "files", Title: "Files", Entry: "panel.js"}},
	}
	if err := registry.ReplaceUI(lease.RegistrationID, manifest); err != nil {
		t.Fatal(err)
	}
	if event := <-events; event.Name != "panels.changed" {
		t.Fatalf("ReplaceUI published %q, want panels.changed", event.Name)
	}
}

func drain(events <-chan Event) {
	for {
		select {
		case <-events:
		default:
			return
		}
	}
}

func TestAssetCacheSweepsOnlyUnreferencedStaleEntries(t *testing.T) {
	registry := New("test-core", t.TempDir())
	now := time.Now()
	registry.now = func() time.Time { return now }

	// 内容を正しいhashでcacheへ書く
	content := []byte("x")
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])
	if err := registry.WriteAsset(hash, content); err != nil {
		t.Fatal(err)
	}
	if data, ok := registry.ReadAsset(hash); !ok || string(data) != "x" {
		t.Fatal("written asset was not readable")
	}

	// hashが一致しない内容は拒否する
	if err := registry.WriteAsset(hash, []byte("wrong")); err == nil {
		t.Fatal("mismatched content was written")
	}

	// manifestが参照している間は、古くなってもsweepされない
	lease, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"})
	manifest := wire.UIManifest{Files: []wire.UIFile{{Path: "panel.js", SHA256: hash, Size: 1}}}
	if err := registry.ReplaceUI(lease.RegistrationID, manifest); err != nil {
		t.Fatal(err)
	}
	now = now.Add(unreferencedAssetTTL + time.Hour)
	registry.collectStaleAssetsLocked(now)
	if !registry.HasAsset(hash) {
		t.Fatal("referenced asset was swept")
	}

	// 参照が外れてもTTL以内なら残る（再起動後の再宣言を待つ猶予）。
	// 登録のleaseは既に切れているので、white-boxで直接参照を外す。
	registry.mu.Lock()
	registry.releaseFilesLocked(manifest.Files)
	registry.mu.Unlock()
	registry.collectStaleAssetsLocked(now)
	if !registry.HasAsset(hash) {
		t.Fatal("asset within TTL was swept")
	}

	// TTLを超えるとsweepされる
	now = now.Add(unreferencedAssetTTL + time.Hour)
	registry.collectStaleAssetsLocked(now)
	if registry.HasAsset(hash) {
		t.Fatal("stale unreferenced asset was not swept")
	}
}

func TestReadyLatchesAndGatesOperationResolution(t *testing.T) {
	registry := New("test-core", "")
	lease, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"})
	if err := registry.ReplaceOperations(lease.RegistrationID, []wire.OperationDeclaration{{Path: "echo"}}); err != nil {
		t.Fatal(err)
	}
	reservation, err := registry.ReserveConnection(lease.RegistrationID)
	if err != nil {
		t.Fatal(err)
	}
	connection := &rpc.Connection{}
	if !reservation.Complete(connection) {
		t.Fatal("could not attach")
	}
	// ready前は解決できない
	if _, err := registry.ResolveOperation("echo"); err != ErrUnknownOperation {
		t.Fatalf("operation resolved before ready: %v", err)
	}
	if snapshot := registry.Snapshot(); snapshot.Registrations[0].Ready {
		t.Fatal("registration should not be ready")
	}
	// readyを立てると解決できる。one-way latch。
	if err := registry.SetReady(lease.RegistrationID); err != nil {
		t.Fatal(err)
	}
	if got, err := registry.ResolveOperation("echo"); got != connection || err != nil {
		t.Fatalf("operation did not resolve after ready: %v", err)
	}
	if snapshot := registry.Snapshot(); !snapshot.Registrations[0].Ready {
		t.Fatal("snapshot did not show ready")
	}
	// 再送は冪等
	if err := registry.SetReady(lease.RegistrationID); err != nil {
		t.Fatal(err)
	}
}
