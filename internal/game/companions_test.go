package game_test

import (
	"math"
	"slices"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

var summon = &pb.ClientMessage{Kind: &pb.ClientMessage_Summon{Summon: &pb.Summon{}}}

func companionState(number uint32, x, y float32) *pb.ClientMessage {
	//nolint:staticcheck // an old client's report, which the hub must ignore.
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

func TestCompanions_TheHubFliesThem(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	n := grant(t, a)

	// A client's own report for a companion changes nothing: the hub flies it.
	a.Send(companionState(n, 999, 999))
	var snap *pb.Snapshot
	messages := make([]*pb.ServerMessage, 0, 4*TickRate)
	for range 4 * TickRate {
		var got []*pb.ServerMessage
		snap, got = latest(t, a, tick, 1, 0, 180)
		messages = append(messages, got...)
	}
	for _, msg := range messages {
		if msg.GetCompanionDismissed() != nil {
			t.Fatal("a companion was dismissed while its client sent no states for it")
		}
	}
	var c *pb.PlayerSnapshot
	for _, p := range snap.GetPlayers() {
		if p.GetPlayerId() == "a/1" {
			c = p
		}
	}
	if c == nil {
		t.Fatalf("a's snapshot players = %v, want its own companion a/1", snap.GetPlayers())
	}
	slot := sim.FormationPoint(sim.Mover{Y: 180}, 0, 1)
	x, y := float64(c.GetState().GetX()), float64(c.GetState().GetY())
	if d := math.Hypot(x-slot.X, y-slot.Y); d > sim.BrainInFormation {
		t.Errorf(
			"a/1 at (%v, %v), %v from its slot behind a, want in formation",
			c.GetState().GetX(),
			c.GetState().GetY(),
			d,
		)
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
	grant(t, a)

	seen := snapshotPlayers(t, b, tick)
	c, ok := seen["a/1"]
	if !ok {
		t.Fatalf("b's snapshot players = %v, want a/1", seen)
	}
	if c.GetOwnerId() != "a" || c.GetName() != "name-a" ||
		math.Abs(float64(c.GetState().GetY())-180) > 20 {
		t.Errorf("a/1 = %v, want owner a, a's name, beside a", c)
	}
	if got, want := c.GetColor(), seen["a"].GetColor(); got != want {
		t.Errorf("color = %06x, want a's %06x", got, want)
	}

	if _, ok := snapshotPlayers(t, a, tick)["a/1"]; !ok {
		t.Error("a's own snapshot lacks a/1; the hub flies it, so a draws it from snapshots too")
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

// flyOut takes a and its companions out of the safe zone to (0, 700), where
// they fly for a few seconds.
func flyOut(t *testing.T, a *Session, tick func(int)) {
	t.Helper()

	latest(t, a, tick, 4*TickRate, 0, 700)
}

func TestCompanions_FlyHomeWhenTheirOwnerDrops(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	flyOut(t, a, tick)
	// b joins now, so its queue holds nothing from before the drop.
	b, _ := pilot(t, hub, "b")
	a.Leave()

	// a's ship goes at once; a/1 flies on toward the home planet, then docks.
	var gone []string
	var out float64
	for range 30 * TickRate {
		snap, messages := latest(t, b, tick, 1, 0, -180)
		for _, msg := range messages {
			if l := msg.GetLeft(); l != nil {
				gone = append(gone, l.GetPlayerId())
			}
		}
		if slices.Contains(gone, "a/1") {
			break
		}
		for _, p := range snap.GetPlayers() {
			if p.GetPlayerId() == "a" {
				t.Fatal("a's ship is still in snapshots after a dropped")
			}
			if p.GetPlayerId() == "a/1" {
				d := math.Hypot(float64(p.GetState().GetX()), float64(p.GetState().GetY()))
				if out != 0 && d > out+1 {
					t.Fatalf("a/1 went from %v to %v px from home, want it heading home", out, d)
				}
				out = d
			}
		}
	}
	if !slices.Equal(gone, []string{"a", "a/1"}) {
		t.Errorf("left = %v, want a, then a/1 once it's home", gone)
	}
	if out == 0 {
		t.Error("a/1 never showed in snapshots after a dropped")
	}
}

func TestCompanions_ABackPlayerTakesThemBack(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	flyOut(t, a, tick)
	a.Leave()
	tick(1)

	back, welcome := pilot(t, hub, "a")
	if got := welcome.GetCompanions(); !slices.Equal(got, []uint32{1}) {
		t.Fatalf("welcome companions = %v, want [1] kept", got)
	}
	// With a back out there, a/1 turns back to them instead of docking.
	for range 10 * TickRate {
		snap, messages := latest(t, back, tick, 1, 0, 700)
		for _, msg := range messages {
			if l := msg.GetLeft(); l != nil && l.GetPlayerId() == "a/1" {
				t.Fatal("a/1 docked after a came back")
			}
		}
		_ = snap
	}
	c := snapshotPlayers(t, back, tick)["a/1"].GetState()
	if d := math.Hypot(float64(c.GetX()), float64(c.GetY())-700); d > 150 {
		t.Errorf("a/1 is %v px from a after they came back, want it with them", d)
	}
}

func TestCompanions_KeptOnReconnect(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
	a.Send(state(0, 180))
	grant(t, a)
	join(t, hub, "a")

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

// outThere sends a's ship out of the safe zone, where enemies come, and steps
// the hub until done, given each tick's snapshot and a's other messages, says
// so, or 30 s pass.
func outThere(
	t *testing.T,
	a *Session,
	tick func(int),
	done func(*pb.Snapshot, []*pb.ServerMessage) bool,
) {
	t.Helper()

	for range 30 * TickRate {
		if done(latest(t, a, tick, 1, 0, 700)) {
			return
		}
	}
	t.Fatal("30 s passed")
}

func TestCompanions_FightOnTheHub(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)

	var shot *pb.RemoteShot
	var ended *pb.ShotEnded
	var destroyed *pb.EnemyDestroyed
	outThere(t, a, tick, func(_ *pb.Snapshot, messages []*pb.ServerMessage) bool {
		for _, msg := range messages {
			if s := msg.GetShot(); s != nil && s.GetPlayerId() == "a/1" {
				shot = s
			}
			if e := msg.GetShotEnded(); e != nil && e.GetPlayerId() == "a/1" {
				ended = e
			}
			if d := msg.GetEnemyDestroyed(); d != nil && d.GetByPlayerId() == "a/1" {
				destroyed = d
			}
		}

		return destroyed != nil
	})
	if shot == nil || shot.GetShot().GetCompanion() != 1 ||
		shot.GetShot().GetWeapon() != pb.Weapon_WEAPON_AUTO_CANNON {
		t.Errorf(
			"a/1's shots = %v, want auto cannon shots of companion 1 sent to its owner too",
			shot,
		)
	}
	if ended == nil {
		t.Error("no shot of a/1 ended on an enemy")
	}
}

func TestCompanions_ClientsCantShootForThem(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	n := grant(t, a)
	// Stealth: the companion itself never fires.
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_SquadronOrder{SquadronOrder: &pb.SquadronOrder{
		Mode: pb.CompanionMode_COMPANION_MODE_STEALTH,
	}}})

	var target *pb.EnemyState
	outThere(t, a, tick, func(snap *pb.Snapshot, _ []*pb.ServerMessage) bool {
		if enemies := snap.GetEnemies(); len(enemies) > 0 {
			target = enemies[0]
		}

		return target != nil
	})
	a.Send(
		&pb.ClientMessage{Kind: &pb.ClientMessage_Shot{Shot: &pb.ShotFired{Id: 7, Companion: n}}},
	)
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{
		EnemyId: target.GetEnemyId(), ShotId: 7, Damage: 12,
		Companion: n, //nolint:staticcheck // an old client\'s report, which the hub must ignore.
	}}})
	snap, messages := latest(t, a, tick, 2, 0, 700)
	if !slices.ContainsFunc(
		snap.GetEnemies(),
		func(e *pb.EnemyState) bool { return e.GetEnemyId() == target.GetEnemyId() },
	) {
		t.Error("an enemy fell to a hit a client reported for its companion")
	}
	for _, msg := range messages {
		if msg.GetShotEnded() != nil {
			t.Errorf(
				"shot ended = %v, want none from a client's companion report",
				msg.GetShotEnded(),
			)
		}
	}
}

func TestCompanions_EnemyBulletsWearThemDown(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	// Stealth: the companion never fires back, so the enemies keep shooting.
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_SquadronOrder{SquadronOrder: &pb.SquadronOrder{
		Mode: pb.CompanionMode_COMPANION_MODE_STEALTH,
	}}})

	var full, worn *pb.ShipState
	outThere(t, a, tick, func(snap *pb.Snapshot, _ []*pb.ServerMessage) bool {
		for _, p := range snap.GetPlayers() {
			if p.GetPlayerId() != "a/1" {
				continue
			}
			if full == nil {
				full = p.GetState()
			}
			if p.GetState().GetShield() < full.GetShield() || p.GetState().GetDamage() > 0 {
				worn = p.GetState()
			}
		}

		return worn != nil
	})
	if full.GetShield() <= 0 {
		t.Errorf("a/1's shield at first = %v, want charged", full.GetShield())
	}
}

func TestWithinReach(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name       string
		companions [][2]float64
		want       bool
	}{
		{name: "no companions", want: false},
		{name: "one in reach", companions: [][2]float64{{5000, 0}, {VolleyRange, 0}}, want: true},
		{name: "all too far", companions: [][2]float64{{VolleyRange + 1, 0}, {0, -VolleyRange - 1}}, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if got := WithinReach(0, 0, tc.companions); got != tc.want {
				t.Errorf("WithinReach() = %v, want %v", got, tc.want)
			}
		})
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

	hub, _ := testHub(t, WithPoolStart(3))
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	a.Send(summon)

	// The list after the join says 3; the one after the grant must say 2.
	waitHangar(t, a, 2)
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
		giveBack func(a *Session, tick func(int))
	}{
		{
			name: "dismissed",
			giveBack: func(a *Session, _ func(int)) {
				a.Send(
					&pb.ClientMessage{
						Kind: &pb.ClientMessage_Dismiss{Dismiss: &pb.Dismiss{Companion: 1}},
					},
				)
			},
		},
		{
			name: "owner dropped, at home",
			giveBack: func(a *Session, tick func(int)) {
				a.Leave()
				// Already in the safe zone, it docks on the next tick.
				tick(1)
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			hub, tick := testHub(t, WithPoolStart(1))
			a, _ := pilot(t, hub, "a")
			b, _ := pilot(t, hub, "b")
			a.Send(state(0, 180))
			b.Send(state(0, -180))
			grant(t, a)

			tc.giveBack(a, tick)
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

// squadronsWhere reads s's squadron lists until one satisfies ok, and returns it.
func squadronsWhere(t *testing.T, s *Session, ok func(*pb.Squadrons) bool) *pb.Squadrons {
	t.Helper()

	for {
		if sq := next(t, s).GetSquadrons(); sq != nil && ok(sq) {
			return sq
		}
	}
}

// Players and companions come from different pools: a joiner who takes a
// companion's place holds that ship until they leave, so joining never adds
// ships to the hangar.
func TestHangar_JoiningNeverAddsShips(t *testing.T) {
	t.Parallel()

	t.Run("taking over a companion", func(t *testing.T) {
		t.Parallel()

		hub, _ := testHub(t, WithPoolStart(3))
		a, _ := pilot(t, hub, "a")
		a.Send(state(0, 180))
		for range 3 {
			grant(t, a)
		}
		b, _ := join(t, hub, "b")
		if j := chooseAndWait(t, b, "Alpha"); !j.GetTookOver() {
			t.Fatal("joining a full Alpha, want a takeover")
		}

		joined := squadronsWhere(t, b, func(sq *pb.Squadrons) bool {
			return len(sq.GetSquadrons()) == 1 && len(sq.GetSquadrons()[0].GetMembers()) == 2
		})
		if got, want := joined.GetHangar(), uint32(0); got != want {
			t.Errorf("hangar after the takeover = %d, want %d", got, want)
		}
		b.Leave()
		waitHangar(t, a, 1)
	})

	t.Run("displacing one from a full world", func(t *testing.T) {
		t.Parallel()

		hub, _ := testHub(t, WithPoolStart(12))
		owners := fillSeats(t, hub)
		e, _ := pilot(t, hub, "e")

		joined := squadronsWhere(
			t,
			e,
			func(sq *pb.Squadrons) bool { return len(sq.GetSquadrons()) == 5 },
		)
		if got, want := joined.GetHangar(), uint32(0); got != want {
			t.Errorf("hangar after a joiner displaced a companion = %d, want %d", got, want)
		}
		e.Leave()
		waitHangar(t, owners[0], 1)
	})
}
