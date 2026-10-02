package game_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

func TestSimEnemyKind(t *testing.T) {
	t.Parallel()

	tests := []struct {
		kind pb.EnemyKind
		want sim.EnemyKind
	}{
		{pb.EnemyKind_ENEMY_KIND_SCOUT, sim.EnemyScout},
		{pb.EnemyKind_ENEMY_KIND_FIGHTER, sim.EnemyFighter},
		{pb.EnemyKind_ENEMY_KIND_FRIGATE, sim.EnemyFrigate},
		{pb.EnemyKind_ENEMY_KIND_UNSPECIFIED, sim.EnemyScout},
	}
	for _, tc := range tests {
		if got := SimEnemyKind(tc.kind); got != tc.want {
			t.Errorf("SimEnemyKind(%v) = %q, want %q", tc.kind, got, tc.want)
		}
	}
}

// frigateMap puts one Frigate in D3, straight up from home.
var frigateMap = &world.Map{Name: "test", Bosses: []world.Boss{{Kind: "frigate", Sector: "D3"}}}

// frigateIn is the snapshot's Frigate, or nil.
func frigateIn(snap *pb.Snapshot) *pb.EnemyState {
	for _, e := range snap.GetEnemies() {
		if e.GetKind() == pb.EnemyKind_ENEMY_KIND_FRIGATE {
			return e
		}
	}

	return nil
}

// inFrigateRange is a point 300 px below the frigateMap's Frigate as s sees
// it now: in the fight and in its fire range, so a ship there holds it still.
func inFrigateRange(t *testing.T, s *Session, tick func(int)) (x, y float32) {
	t.Helper()

	f := frigateIn(must(latest(t, s, tick, 1, 0, 0)))
	if f == nil {
		t.Fatal("no Frigate in the snapshot")
	}

	const below = 300

	return f.GetX(), f.GetY() + below
}

// hitFrigate has s report a hit of the most damage a shot does on the Frigate.
func hitFrigate(s *Session, id, shot uint32) {
	s.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{
		EnemyId: id, ShotId: shot, Damage: MaxHitDamage,
	}}})
}

func TestFrigate_TakesASpotInItsSectorWithEscorts(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap))
	s, _ := join(t, hub, "a")
	snap, _ := latest(t, s, tick, 1, 0, 0)

	f := frigateIn(snap)
	if f == nil {
		t.Fatal("no Frigate in the snapshot")
	}
	d3, _ := sim.ParseSector("D3")
	if !d3.Inside(float64(f.GetX()), float64(f.GetY()), FrigateMargin-1) {
		t.Errorf(
			"Frigate at (%v, %v), want it in D3, %d px in from its sides",
			f.GetX(),
			f.GetY(),
			FrigateMargin,
		)
	}
	if f.GetHp() != sim.FrigateBaseHP || f.GetMaxHp() != sim.FrigateBaseHP ||
		f.GetShield() != sim.FrigateShield || f.GetScaledFor() != 0 {
		t.Errorf("Frigate %+v, want base health and a full shield, scaled for nobody", f)
	}
	escorts := 0
	for _, e := range snap.GetEnemies() {
		if e.GetKind() == pb.EnemyKind_ENEMY_KIND_FIGHTER &&
			math.Hypot(float64(e.GetX()-f.GetX()), float64(e.GetY()-f.GetY())) < 200 {
			escorts++
		}
	}
	if escorts == 0 {
		t.Error("the Frigate has no Fighters with it")
	}
}

func TestFrigate_EscortsStayWhileItIsThere(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap))
	s, _ := join(t, hub, "a")
	var snap *pb.Snapshot
	for range DespawnAfter/TickRate + 2 {
		snap, _ = latest(t, s, tick, TickRate, 0, 0)
	}
	if got := len(snap.GetEnemies()); got != 1+FrigateEscorts {
		t.Errorf("%d enemies long after anyone was near, want the Frigate and its %d escorts",
			got, FrigateEscorts)
	}
}

func TestFrigate_HealthScalesWithShipsNear(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap))
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	c, _ := join(t, hub, "c")
	x, y := inFrigateRange(t, a, tick)
	step := func(bAt, cAt [2]float32) *pb.EnemyState {
		b.Send(state(bAt[0], bAt[1]))
		c.Send(state(cAt[0], cAt[1]))
		snap, _ := latest(t, a, tick, 1, x, y)
		drain(b)
		drain(c)

		return frigateIn(snap)
	}
	near, far := [2]float32{x + 50, y}, [2]float32{0, 0}

	f := step(near, far)
	if got, want := f.GetMaxHp(), float32(sim.FrigateHP(2)); got != want {
		t.Errorf("max hp with two near = %v, want %v", got, want)
	}
	if got := f.GetScaledFor(); got != 2 {
		t.Errorf("scaled for %v, want 2", got)
	}
	f = step(near, near)
	if got, want := f.GetMaxHp(), float32(sim.FrigateHP(3)); got != want {
		t.Errorf("max hp after a third joined = %v, want %v", got, want)
	}
	if got, want := f.GetHp(), float32(sim.FrigateHP(3)); got != want {
		t.Errorf("hp after a third joined = %v, want %v", got, want)
	}
	f = step(far, far)
	if got, want := f.GetMaxHp(), float32(sim.FrigateHP(3)); got != want {
		t.Errorf("max hp after two left = %v, want it kept at %v", got, want)
	}
}

func TestFrigate_ACompanionCountsHalf(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap))
	a, _ := pilot(t, hub, "a")
	must(latest(t, a, tick, 1, 0, 0))
	grant(t, a)
	x, y := inFrigateRange(t, a, tick)
	want := float32(1 + sim.FrigateCompanionWeight)
	for range 20 * TickRate {
		snap, _ := latest(t, a, tick, 1, x, y)
		if frigateIn(snap).GetScaledFor() == want {
			return
		}
	}
	t.Errorf("the Frigate never scaled for a player and their companion (%v)", want)
}

func TestFrigate_ShieldTakesHitsFirstAndRecharges(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap))
	a, _ := join(t, hub, "a")
	x, y := inFrigateRange(t, a, tick)
	f := frigateIn(must(latest(t, a, tick, 1, x, y)))
	full := f.GetHp()

	hitFrigate(a, f.GetEnemyId(), 1)
	f = frigateIn(must(latest(t, a, tick, 1, x, y)))
	shield := float32(sim.FrigateShield - MaxHitDamage)
	if f.GetShield() != shield || f.GetHp() != full {
		t.Errorf(
			"after one hit: shield %v, hp %v; want %v, %v",
			f.GetShield(),
			f.GetHp(),
			shield,
			full,
		)
	}
	hitFrigate(a, f.GetEnemyId(), 2)
	f = frigateIn(must(latest(t, a, tick, 1, x, y)))
	left := full - (2*MaxHitDamage - sim.FrigateShield)
	if f.GetShield() != 0 || f.GetHp() != left {
		t.Errorf("after two hits: shield %v, hp %v; want 0, %v", f.GetShield(), f.GetHp(), left)
	}

	f = frigateIn(must(latest(t, a, tick, FrigateShieldTicks, x, y)))
	if got, want := f.GetShield(), float32(sim.FrigateShield); got != want {
		t.Errorf("shield after a while without a hit = %v, want %v", got, want)
	}
}

func TestFrigate_ResetsWhenNobodyNearIsUp(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap))
	a, _ := join(t, hub, "a")
	x, y := inFrigateRange(t, a, tick)
	f := frigateIn(must(latest(t, a, tick, 1, x, y)))
	hitFrigate(a, f.GetEnemyId(), 1)
	hitFrigate(a, f.GetEnemyId(), 2)
	must(latest(t, a, tick, 1, x, y))

	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_State{State: &pb.ShipState{
		X: x, Y: y, Damage: sim.MaxDamage,
	}}})
	tick(1)
	var snap *pb.Snapshot
	for snap == nil {
		snap = next(t, a).GetSnapshot()
	}
	f = frigateIn(snap)
	if f.GetHp() != sim.FrigateBaseHP || f.GetMaxHp() != sim.FrigateBaseHP ||
		f.GetShield() != sim.FrigateShield || f.GetScaledFor() != 0 {
		t.Errorf("Frigate %+v once its one player was down, want it healed for nobody", f)
	}
}

func TestFrigate_FiresRingsAtShipsInRange(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap))
	a, _ := join(t, hub, "a")
	x, y := inFrigateRange(t, a, tick)
	for range 2 * FrigateRingEvery {
		_, others := latest(t, a, tick, 1, x, y)
		for _, msg := range others {
			if f := msg.GetEnemyFired(); f != nil &&
				f.GetKind() == pb.EnemyKind_ENEMY_KIND_FRIGATE {
				if f.GetAngle() < 0 {
					t.Errorf("fired at angle %v, want toward the player below it", f.GetAngle())
				}

				return
			}
		}
	}
	t.Error("the Frigate never fired at a player 300 px away")
}

func TestFrigate_AlwaysDropsAndComesBack(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap))
	a, _ := join(t, hub, "a")
	x, y := inFrigateRange(t, a, tick)
	f := frigateIn(must(latest(t, a, tick, 1, x, y)))
	for shot := range uint32(10) {
		hitFrigate(a, f.GetEnemyId(), shot+1)
	}
	destroyed := false
	for !destroyed {
		msg := next(t, a)
		destroyed = msg.GetEnemyDestroyed().GetKind() == pb.EnemyKind_ENEMY_KIND_FRIGATE
	}
	nextPickupDropped(t, a)
	a.Leave()

	// The kill was on the last tick; the wait counts from there.
	tick(FrigateRespawnTicks - 2)
	b, _ := join(t, hub, "b")
	if frigateIn(must(latest(t, b, tick, 1, 0, 0))) != nil {
		t.Error("the Frigate is back before its time")
	}
	back := frigateIn(must(latest(t, b, tick, 1, 0, 0)))
	if back == nil || back.GetEnemyId() == f.GetEnemyId() {
		t.Errorf("Frigate = %+v after its time, want a new one", back)
	}
}

// must is the snapshot from latest, without its other messages.
func must(snap *pb.Snapshot, _ []*pb.ServerMessage) *pb.Snapshot {
	return snap
}

func TestFrigate_PatrolsItsSectorWhileNoShipIsInRange(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap), NoEvents)
	a, _ := join(t, hub, "a")
	d3, _ := sim.ParseSector("D3")
	start := frigateIn(must(latest(t, a, tick, 1, 0, 0)))
	f, facing, samples := start, 0, 0
	for range 30 {
		prev := f
		f = frigateIn(must(latest(t, a, tick, TickRate, 0, 0)))
		if !d3.Inside(float64(f.GetX()), float64(f.GetY()), FrigateMargin-1) {
			t.Fatalf("Frigate at (%v, %v), out of its patrol in D3", f.GetX(), f.GetY())
		}
		dx, dy := float64(f.GetX()-prev.GetX()), float64(f.GetY()-prev.GetY())
		if math.Hypot(dx, dy) > FrigatePatrolSpeed/2 {
			samples++
			if math.Abs(sim.WrapAngle(float64(f.GetAngle())-math.Atan2(dy, dx))) < 0.35 {
				facing++
			}
		}
	}
	if facing*10 < samples*7 {
		t.Errorf(
			"the Frigate faced where it was going in %d of %d seconds, want most",
			facing,
			samples,
		)
	}
	moved := math.Hypot(float64(f.GetX()-start.GetX()), float64(f.GetY()-start.GetY()))
	if moved < FrigatePatrolSpeed {
		t.Errorf("the Frigate moved %.0f px in 30 s with nobody near, want it patrolling", moved)
	}
	snap := must(latest(t, a, tick, 1, 0, 0))
	f = frigateIn(snap)
	if d := snap.GetDerelicts(); len(d) != 1 || !d[0].GetHeld() ||
		d[0].GetX() != f.GetX() || d[0].GetY() != f.GetY()+FrigateDerelictOffset {
		t.Errorf("derelicts %+v, want the held one towed %d px below the Frigate at (%v, %v)",
			d, FrigateDerelictOffset, f.GetX(), f.GetY())
	}
	escorts := 0
	for _, e := range snap.GetEnemies() {
		if e.GetKind() == pb.EnemyKind_ENEMY_KIND_FIGHTER &&
			math.Hypot(float64(e.GetX()-f.GetX()), float64(e.GetY()-f.GetY())) < 250 {
			escorts++
		}
	}
	if escorts != FrigateEscorts {
		t.Errorf("%d escorts kept up with the patrolling Frigate, want %d", escorts, FrigateEscorts)
	}
}

func TestFrigate_HoldsStillWhileAShipIsInRange(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithMap(frigateMap), NoEvents)
	a, _ := join(t, hub, "a")
	x, y := inFrigateRange(t, a, tick)
	before := frigateIn(must(latest(t, a, tick, 1, x, y)))
	after := frigateIn(must(latest(t, a, tick, 5*TickRate, x, y)))
	if after.GetX() != before.GetX() || after.GetY() != before.GetY() {
		t.Errorf("the Frigate moved from (%v, %v) to (%v, %v) with a ship in range",
			before.GetX(), before.GetY(), after.GetX(), after.GetY())
	}
}

func TestTurnToward(t *testing.T) {
	t.Parallel()

	tests := []struct {
		angle, want, limit, got float64
	}{
		{0, 1, 0.25, 0.25},
		{0, 0.1, 0.25, 0.1},
		{0, -1, 0.25, -0.25},
		{3, -3, 0.25, 3 + 0.25},
	}
	for _, tc := range tests {
		got := TurnToward(tc.angle, tc.want, tc.limit)
		if math.Abs(sim.WrapAngle(got-tc.got)) > 1e-9 {
			t.Errorf(
				"TurnToward(%v, %v, %v) = %v, want %v",
				tc.angle,
				tc.want,
				tc.limit,
				got,
				tc.got,
			)
		}
	}
}
