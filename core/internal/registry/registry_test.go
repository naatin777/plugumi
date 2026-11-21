package registry

import (
	"testing"
	"time"

	"github.com/naatin777/plugumi/core/internal/rpc"
	"github.com/naatin777/plugumi/core/internal/wire"
)

func TestReplaceToolsNormalizesAndPublishesOnlyOnChange(t *testing.T) {
	registry := New("test-core")
	lease, _, _ := registry.Create(wire.PluginIdentity{PluginID: "standard", PluginInstanceID: "instance"})
	declarations := []wire.ToolDeclaration{
		{ToolPath: "a/one"},
		{ToolPath: "a/two", Kind: "async"},
	}
	if err := registry.ReplaceTools(lease.RegistrationID, declarations); err != nil {
		t.Fatal(err)
	}
	snapshot := registry.Snapshot()
	tools := snapshot.Registrations[0].Tools
	if tools[0].Kind != "sync" || tools[1].Kind != "async" {
		t.Fatalf("unexpected Tool kinds: %+v", tools)
	}
	if err := registry.ReplaceTools(lease.RegistrationID, declarations); err != nil {
		t.Fatal(err)
	}
	if current := registry.Snapshot(); current.Revision != snapshot.Revision {
		t.Fatalf("identical replacement changed the revision: %s", current.Revision)
	}
}

func TestExpiredRegistrationIsNotRoutableBeforeCleanup(t *testing.T) {
	registry := New("test-core")
	now := time.Now()
	registry.now = func() time.Time { return now }
	identity := wire.PluginIdentity{PluginID: "standard", PluginInstanceID: "instance"}
	lease, _, _ := registry.Create(identity)
	if err := registry.ReplaceTools(lease.RegistrationID, []wire.ToolDeclaration{{ToolPath: "echo"}}); err != nil {
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
	target := wire.CallTarget{RegistrationID: lease.RegistrationID, ToolPath: "echo"}
	if got, kind, err := registry.ResolveTool(target); got != connection || kind != "sync" || err != nil {
		t.Fatalf("live registration was not routable: %s, %v", kind, err)
	}
	now = lease.ExpiresAt
	if _, _, err := registry.ResolveTool(target); err != ErrUnknownRegistration {
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
		if removed.Name != "plugin.removed" || removed.Revision != snapshot.Revision {
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
	identity := wire.PluginIdentity{PluginID: "standard", PluginInstanceID: "instance"}
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
	lease, _, _ := registry.Create(wire.PluginIdentity{PluginID: "standard", PluginInstanceID: "instance"})
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
	lease, _, _ := registry.Create(wire.PluginIdentity{PluginID: "standard", PluginInstanceID: "instance"})
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
