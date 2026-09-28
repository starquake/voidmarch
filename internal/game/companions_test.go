package game_test

import (
	"math"
	"slices"
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

func chooseSquadron(name string) *pb.ClientMessage {
	return &pb.ClientMessage{
		Kind: &pb.ClientMessage_ChooseSquadron{ChooseSquadron: &pb.ChooseSquadron{Name: name}},
	}
}

// chooseAndWait asks for a squadron ("" starts one) and returns the answer.
func chooseAndWait(t *testing.T, s *Session, name string) *pb.SquadronJoined {
	t.Helper()

	s.Send(chooseSquadron(name))
	for {
		msg := next(t, s)
		if j := msg.GetSquadronJoined(); j != nil {
			return j
		}
		if r := msg.GetSquadronRefused(); r != nil {
			t.Fatalf("squadron %q refused: %s", name, r.GetReason())
		}
	}
}

// pilot joins and starts a squadron of their own, so they can summon.
func pilot(t *testing.T, hub *Hub, id string) (*Session, *pb.Welcome) {
	t.Helper()

	s, w := join(t, hub, id)
	chooseAndWait(t, s, "")

	return s, w
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
	a, welcome := pilot(t, hub, "a")
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
	a, _ := pilot(t, hub, "a")
	a.Send(state(1000, 0))

	if _, reason := summonReply(t, a); reason != "summon companions at the home planet" {
		t.Errorf("reason = %q, want the home planet", reason)
	}
}

func TestCompanions_AtMostThree(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := pilot(t, hub, "a")
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

func TestCompanions_SquadronCap(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := join(t, hub, "b")
	chooseAndWait(t, b, "Alpha")
	a.Send(state(0, 180))
	grant(t, a)
	grant(t, a)

	if _, reason := summonReply(t, a); reason != "your squadron is full" {
		t.Errorf("reason = %q, want the squadron cap (a, b and two companions)", reason)
	}
}

func TestCompanions_NeedASquadron(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := join(t, hub, "a")
	a.Send(state(0, 180))

	if _, reason := summonReply(t, a); reason != "pick a squadron first" {
		t.Errorf("reason = %q, want a squadron first", reason)
	}
}

// fillSeats has four players each summon three companions at the home
// planet and fly off, filling all 16 seats; their companions report no state,
// so no wing is full.
func fillSeats(t *testing.T, hub *Hub) []*Session {
	t.Helper()

	ids := []string{"a", "b", "c", "d"}
	out := make([]*Session, 0, len(ids))
	for i, id := range ids {
		s, _ := pilot(t, hub, id)
		s.Send(state(0, 180))
		for range 3 {
			grant(t, s)
		}
		s.Send(state(-1500, float32(i*300)))
		out = append(out, s)
	}

	return out
}

func TestCompanions_SeatsAreCapped(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	fillSeats(t, hub)
	e, _ := pilot(t, hub, "e")
	e.Send(state(0, 180))

	if _, reason := summonReply(t, e); reason != "the frontier is full" {
		t.Errorf("summon with every seat taken: reason = %q, want the frontier is full", reason)
	}
}

func TestCompanions_ExpireWhenTheirStatesStop(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
	a.Send(state(0, 180))
	grant(t, a)

	var dismissedAt *pb.CompanionDismissed
	for range 4 * TickRate {
		_, messages := latest(t, a, tick, 1, 0, 180)
		b.Send(state(0, -180))
		for _, msg := range messages {
			if d := msg.GetCompanionDismissed(); d != nil {
				dismissedAt = d
			}
		}
		if dismissedAt != nil {
			break
		}
	}
	if dismissedAt == nil {
		t.Fatal("a companion with no states for 4 s was never dismissed")
	}
	if got, want := nextLeft(t, b), "a/1"; got != want {
		t.Errorf("left = %q, want %q", got, want)
	}
}

func TestCompanions_WelcomeListsTheKeptOnes(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	grant(t, a)

	_, welcome := join(t, hub, "a")
	if got, want := welcome.GetCompanions(), []uint32{1, 2}; !slices.Equal(got, want) {
		t.Errorf("welcome companions = %v, want %v", got, want)
	}
}

func TestCompanions_OthersSeeThemAsPlayers(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
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
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
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
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
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
	a, _ := pilot(t, hub, "a")
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
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
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

	hub, _ := testHub(t)
	d := fillSeats(t, hub)[3]

	join(t, hub, "e")
	for {
		if dismissed := next(t, d).GetCompanionDismissed(); dismissed != nil {
			if got, want := dismissed.GetCompanion(), uint32(3); got != want {
				t.Errorf("dismissed = %d, want d's newest, %d", got, want)
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
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
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
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
	a.Send(state(0, 180))
	n := grant(t, a)
	a.Send(companionState(n, 1000, 0))
	b.Send(state(0, -180))

	// The owner stays home; only the companion is out. Everyone keeps
	// reporting, so nobody goes silent.
	var snap *pb.Snapshot
	for range 3 * TickRate {
		a.Send(companionState(n, 1000, 0))
		b.Send(state(0, -180))
		snap, _ = latest(t, a, tick, 1, 0, 180)
		for next(t, b).GetSnapshot().GetTick() != snap.GetTick() {
			continue
		}
	}
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

// nextHangar reads s's messages until a squadron list and returns the ships
// waiting in the hangar.
func nextHangar(t *testing.T, s *Session) uint32 {
	t.Helper()

	for {
		if sq := next(t, s).GetSquadrons(); sq != nil {
			return sq.GetHangar()
		}
	}
}

// waitHangar reads s's squadron lists until the hangar holds want ships.
func waitHangar(t *testing.T, s *Session, want uint32) {
	t.Helper()

	for nextHangar(t, s) != want {
		continue
	}
}

func TestHangar_EveryoneSeesItsShips(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithPoolStart(2))
	_, w := join(t, hub, "a")

	if got, want := w.GetSquadrons().GetHangar(), uint32(2); got != want {
		t.Errorf("Welcome hangar = %d, want %d", got, want)
	}
}

func TestHangar_SummonDrawsFromIt(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithPoolStart(2))
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	a.Send(summon)

	// The list after the join says 2; the one after the grant must say 1.
	waitHangar(t, a, 1)
}

func TestHangar_EmptyRefuses(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithPoolStart(1))
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
	a.Send(state(0, 180))
	b.Send(state(0, -180))
	grant(t, a)

	if _, reason := summonReply(t, b); reason != "the hangar is empty" {
		t.Errorf("summon with no ships left: reason = %q, want the hangar is empty", reason)
	}
}

func TestHangar_ShipsComeBack(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		// giveBack returns a's companion to the hangar.
		giveBack func(a *Session)
	}{
		{
			name: "dismissed",
			giveBack: func(a *Session) {
				a.Send(
					&pb.ClientMessage{
						Kind: &pb.ClientMessage_Dismiss{Dismiss: &pb.Dismiss{Companion: 1}},
					},
				)
			},
		},
		{
			name:     "owner dropped",
			giveBack: func(a *Session) { a.Leave() },
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			hub, _ := testHub(t, WithPoolStart(1))
			a, _ := pilot(t, hub, "a")
			b, _ := pilot(t, hub, "b")
			a.Send(state(0, 180))
			b.Send(state(0, -180))
			grant(t, a)

			tc.giveBack(a)
			waitHangar(t, b, 1)
			if g, reason := summonReply(t, b); g == nil {
				t.Errorf("summon after the ship came back refused: %q", reason)
			}
		})
	}
}

func TestHangar_NeverOverItsShips(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithPoolStart(1))
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
	a.Send(state(0, 180))
	grant(t, a)
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Dismiss{Dismiss: &pb.Dismiss{Companion: 1}}})
	// A second dismissal of the same companion, as a stale client might send.
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Dismiss{Dismiss: &pb.Dismiss{Companion: 1}}})
	a.Leave()

	// The list after a left has only b's squadron.
	for {
		sq := next(t, b).GetSquadrons()
		if sq == nil || len(sq.GetSquadrons()) != 1 {
			continue
		}
		if got, want := sq.GetHangar(), uint32(1); got != want {
			t.Errorf("hangar after a dismissal and a drop = %d, want %d", got, want)
		}

		break
	}
}
