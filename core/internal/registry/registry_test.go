package registry

import (
	"strings"
	"testing"
	"time"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

func TestReplaceOperationsValidatesAndPublishesOnlyOnChange(t *testing.T) {
	registry := New("test-core")
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
	registry := New("test-core")
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

func TestRepeatRegistrationRefreshesLeaseWithoutChangingTheRegistry(t *testing.T) {
	registry := New("test-core")
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
	registry := New("test-core")
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
	registry := New("test-core")
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
	registry := New("test-core")
	events, unsubscribe := registry.Subscribe()
	defer unsubscribe()
	lease, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"})
	drain(events)
	hash := strings.Repeat("a", 64)
	registry.PutAsset(hash, []byte("x"))
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

func TestReleasedAssetSurvivesUntilTTL(t *testing.T) {
	registry := New("test-core")
	now := time.Now()
	registry.now = func() time.Time { return now }
	lease, _, _ := registry.Create(wire.ProviderIdentity{ProviderID: "standard", InstanceID: "instance"})
	hash := strings.Repeat("b", 64)
	registry.PutAsset(hash, []byte("x"))
	manifest := wire.UIManifest{Files: []wire.UIFile{{Path: "panel.js", SHA256: hash}}}
	if err := registry.ReplaceUI(lease.RegistrationID, manifest); err != nil {
		t.Fatal(err)
	}
	if err := registry.ReplaceUI(lease.RegistrationID, wire.UIManifest{}); err != nil {
		t.Fatal(err)
	}
	// 参照は0だがTTL以内なのでassetは残る（即時削除だと別登録のmissing_assets競合になる）。
	if missing := registry.MissingAssets([]string{hash}); len(missing) != 0 {
		t.Fatalf("asset released within TTL was removed: %v", missing)
	}
	now = now.Add(unreferencedAssetTTL + time.Second)
	registry.collectStaleAssetsLocked(now)
	if missing := registry.MissingAssets([]string{hash}); len(missing) != 1 {
		t.Fatalf("stale asset was not swept: %v", missing)
	}
	if got := registry.MissingAssets(nil); got == nil {
		t.Fatal("MissingAssets must return an empty slice, not nil")
	}
}
