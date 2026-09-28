package game_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
)

var summon = &pb.ClientMessage{Kind: &pb.ClientMessage_Summon{Summon: &pb.Summon{}}}

func companionState(number uint32, x, y float32) *pb.ClientMessage {
	return &pb.ClientMessage{Kind: &pb.ClientMessage_Companion{Companion: &pb.CompanionState{
		Companion: number,
		State:     &pb.ShipState{X: x, Y: y},
	}}}
}

// summonReply sends Summon and returns the grant, or the refusal's reason.
func summonReply(t *testing.T, s *Session) (*pb.CompanionGranted, string) {
	t.Helper()

	s.Send(summon)
	for {
		msg := next(t, s)
		if g := msg.GetCompanionGranted(); g != nil {
			return g, ""
		}
		if r := msg.GetCompanionRefused(); r != nil {
			return nil, r.GetReason()
		}
	}
}

// grant summons a companion that must be granted, and returns its number.
func grant(t *testing.T, s *Session) uint32 {
	t.Helper()

	g, reason := summonReply(t, s)
	if g == nil {
		t.Fatalf("summon refused: %q", reason)
	}

	return g.GetCompanion()
}

// nextLeft reads s's messages until a PlayerLeft and returns who left.
func nextLeft(t *testing.T, s *Session) string {
	t.Helper()

	for {
		if l := next(t, s).GetLeft(); l != nil {
			return l.GetPlayerId()
		}
	}
}

// snapshotPlayers steps one tick and returns s's snapshot players by id.
func snapshotPlayers(t *testing.T, s *Session, tick func(int)) map[string]*pb.PlayerSnapshot {
	t.Helper()

	tick(1)
	for {
		if snap := next(t, s).GetSnapshot(); snap != nil {
			out := map[string]*pb.PlayerSnapshot{}
			for _, p := range snap.GetPlayers() {
				out[p.GetPlayerId()] = p
			}

			return out
		}
	}
}

func TestCompanions_SummonedAtHome(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, welcome := join(t, hub, "a")
	if got, want := welcome.GetCompanionLimit(), uint32(3); got != want {
		t.Errorf("companion limit = %d, want %d", got, want)
	}
	a.Send(state(0, 180))

	g, reason := summonReply(t, a)
	if g == nil {
		t.Fatalf("summon at home refused: %q", reason)
	}
	if got, want := g.GetCompanion(), uint32(1); got != want {
		t.Errorf("companion = %d, want %d", got, want)
	}
	if g.GetX() != 0 || g.GetY() != 180 {
		t.Errorf("granted at (%v, %v), want the owner's (0, 180)", g.GetX(), g.GetY())
	}
}

func TestCompanions_RefusedAwayFromHome(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := join(t, hub, "a")
	a.Send(state(1000, 0))

	if _, reason := summonReply(t, a); reason != "summon companions at the home planet" {
		t.Errorf("reason = %q, want the home planet", reason)
	}
}

func TestCompanions_AtMostThree(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := join(t, hub, "a")
	a.Send(state(0, 180))
	for want := uint32(1); want <= 3; want++ {
		if got := grant(t, a); got != want {
			t.Errorf("companion = %d, want %d", got, want)
		}
	}

	if _, reason := summonReply(t, a); reason != "all your companions are already out" {
		t.Errorf("fourth summon: reason = %q, want the limit", reason)
	}
}

func TestCompanions_WingCap(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(state(0, 180))
	b.Send(state(40, 180))
	grant(t, a)
	grant(t, a)

	if _, reason := summonReply(t, a); reason != "your wing is full" {
		t.Errorf("reason = %q, want the wing cap (a, b and two companions)", reason)
	}
}

func TestCompanions_DevelopmentLiftsTheLimits(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithDevelopment())
	a, welcome := join(t, hub, "a")
	if !welcome.GetSummonAnywhere() || welcome.GetCompanionLimit() != MaxPlayers-1 {
		t.Errorf("welcome = %v, want summon anywhere and a limit of %d", welcome, MaxPlayers-1)
	}
	a.Send(state(1000, 0))
	for range MaxPlayers - 1 {
		grant(t, a)
	}

	if _, reason := summonReply(t, a); reason == "" {
		t.Error("summon past every seat granted, want a refusal")
	}
}

func TestCompanions_OthersSeeThemAsPlayers(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(state(0, 180))
	b.Send(state(0, -180))
	n := grant(t, a)
	a.Send(companionState(n, 30, 200))

	seen := snapshotPlayers(t, b, tick)
	c, ok := seen["a/1"]
	if !ok {
		t.Fatalf("b's snapshot players = %v, want a/1", seen)
	}
	if c.GetOwnerId() != "a" || c.GetName() != "name-a" || c.GetState().GetX() != 30 {
		t.Errorf("a/1 = %v, want owner a, a's name, at x 30", c)
	}
	if got, want := c.GetColour(), seen["a"].GetColour(); got != want {
		t.Errorf("colour = %06x, want a's %06x", got, want)
	}

	if _, ok := snapshotPlayers(t, a, tick)["a/1"]; ok {
		t.Error("a's own snapshot has a/1; its client draws its own companions")
	}
}

func TestCompanions_DismissedOnesLeave(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(state(0, 180))
	n := grant(t, a)
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Dismiss{Dismiss: &pb.Dismiss{Companion: n}}})

	if got, want := nextLeft(t, b), "a/1"; got != want {
		t.Errorf("left = %q, want %q", got, want)
	}
}

func TestCompanions_LeaveWithTheirOwner(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(state(0, 180))
	grant(t, a)
	a.Leave()

	if got, want := nextLeft(t, b), "a/1"; got != want {
		t.Errorf("first left = %q, want %q", got, want)
	}
	if got, want := nextLeft(t, b), "a"; got != want {
		t.Errorf("then left = %q, want %q", got, want)
	}
}

func TestCompanions_UnknownOnesAreDismissed(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := join(t, hub, "a")
	a.Send(companionState(2, 0, 0))

	for {
		if d := next(t, a).GetCompanionDismissed(); d != nil {
			if got, want := d.GetCompanion(), uint32(2); got != want {
				t.Errorf("dismissed = %d, want %d", got, want)
			}

			return
		}
	}
}

func TestCompanions_KeptOnReconnect(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(state(0, 180))
	n := grant(t, a)
	again, _ := join(t, hub, "a")
	again.Send(companionState(n, 30, 200))

	if _, ok := snapshotPlayers(t, b, tick)["a/1"]; !ok {
		t.Error("a/1 is gone after a reconnected, want it kept")
	}
}

func TestCompanions_HumansDisplaceTheNewest(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithDevelopment())
	a, _ := join(t, hub, "a")
	a.Send(state(0, 180))
	for range MaxPlayers - 1 {
		grant(t, a)
	}

	join(t, hub, "b")
	for {
		if d := next(t, a).GetCompanionDismissed(); d != nil {
			if got, want := d.GetCompanion(), uint32(MaxPlayers-1); got != want {
				t.Errorf("dismissed = %d, want the newest, %d", got, want)
			}

			return
		}
	}
}

func companionShot(companion, id uint32) *pb.ClientMessage {
	return &pb.ClientMessage{Kind: &pb.ClientMessage_Shot{Shot: &pb.ShotFired{
		Id: id, Companion: companion, Weapon: pb.Weapon_WEAPON_AUTO_CANNON,
	}}}
}

func TestCompanions_ShotsRelayUnderTheirSeat(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(state(0, 180))
	n := grant(t, a)
	a.Send(companionShot(2, 1))
	a.Send(companionShot(n, 7))

	shot := nextShot(t, b)
	if got, want := shot.GetPlayerId(), "a/1"; got != want {
		t.Errorf("shot from %q, want %q (companion 2 was never granted)", got, want)
	}
	if got, want := shot.GetShot().GetId(), uint32(7); got != want {
		t.Errorf("shot id = %d, want %d", got, want)
	}
}

func TestCompanions_EnemiesComeForThemAndTheirHitsCount(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(state(0, 180))
	n := grant(t, a)
	a.Send(companionState(n, 1000, 0))
	b.Send(state(0, -180))

	// The owner stays home; only the companion is out.
	snap, _ := latest(t, a, tick, 3*TickRate, 0, 180)
	drain(b)
	var target *pb.EnemyState
	for _, e := range snap.GetEnemies() {
		if math.Hypot(float64(e.GetX())-1000, float64(e.GetY())) < 500 {
			target = e
		}
	}
	if target == nil {
		t.Fatalf("enemies = %v, want one near the companion at (1000, 0)", snap.GetEnemies())
	}

	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{
		EnemyId: target.GetEnemyId(), ShotId: 7, Damage: 12, Companion: n,
	}}})
	var ended *pb.ShotEnded
	var destroyed *pb.EnemyDestroyed
	for ended == nil || destroyed == nil {
		msg := next(t, b)
		if e := msg.GetShotEnded(); e != nil {
			ended = e
		}
		if d := msg.GetEnemyDestroyed(); d != nil {
			destroyed = d
		}
	}
	if got, want := ended.GetPlayerId(), "a/1"; got != want {
		t.Errorf("shot ended for %q, want %q", got, want)
	}
	if got, want := destroyed.GetByPlayerId(), "a/1"; got != want {
		t.Errorf("destroyed by %q, want %q", got, want)
	}
}
