package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

// downed is a ship at the origin, facing up, taken down by hits from behind.
func downed() *Ship {
	s := facingUp(ShieldFront)
	for range MaxDamage {
		TakeHit(s, math.Pi/2)
	}

	return s
}

func TestTakeHit_GoingDown(t *testing.T) {
	t.Parallel()

	s := downed()
	if !s.Downed() || s.Shield != 0 || s.DownFor != 0 || s.Revive != 0 {
		t.Fatalf(
			"after %d hull hits: downed %v, shield %v, down for %v, revive %v; want down with no shield",
			MaxDamage,
			s.Downed(),
			s.Shield,
			s.DownFor,
			s.Revive,
		)
	}
	if TakeHit(s, -math.Pi/2) || s.Damage != MaxDamage {
		t.Errorf("a downed ship took a hit: damage %v", s.Damage)
	}
}

func TestRecover_NothingWhileDown(t *testing.T) {
	t.Parallel()

	s := downed()
	Recover(s, 60, NoSquadmate)
	if !s.Downed() || s.Shield != 0 {
		t.Errorf(
			"a minute down alone: damage %v, shield %v; want still down, no shield",
			s.Damage,
			s.Shield,
		)
	}
}

func TestReviveStep(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name              string
		friend, squadmate float64
		seconds           float64
		want              bool
	}{
		{name: "alone, it stays down", friend: NoSquadmate, squadmate: NoSquadmate, seconds: 60},
		{name: "a friend, not quite long enough", friend: ReviveRadius, squadmate: NoSquadmate, seconds: ReviveSeconds - 0.1},
		{name: "a friend near revives it", friend: ReviveRadius, squadmate: NoSquadmate, seconds: ReviveSeconds, want: true},
		{name: "a friend too far", friend: ReviveRadius + 1, squadmate: NoSquadmate, seconds: 60},
		{name: "a squadmate is quicker", friend: 10, squadmate: 10, seconds: ReviveSquadmateSeconds, want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			s := downed()
			up := false
			// Tick by tick, as the sim steps it.
			for range int(math.Round(tc.seconds/TickSeconds)) + 1 {
				up = ReviveStep(s, TickSeconds, tc.friend, tc.squadmate) || up
			}
			if up != tc.want || s.Downed() == tc.want {
				t.Fatalf(
					"revived %v, downed %v, progress %v; want revived %v",
					up,
					s.Downed(),
					s.Revive,
					tc.want,
				)
			}
			if tc.want && (s.Damage != MaxDamage-1 || s.DownFor != 0 || s.Revive != 0) {
				t.Errorf(
					"revived: damage %v, down for %v, progress %v; want one step above down",
					s.Damage,
					s.DownFor,
					s.Revive,
				)
			}
		})
	}
}

func TestReviveStep_DrainsWithNobodyNear(t *testing.T) {
	t.Parallel()

	s := downed()
	for range int(ReviveSeconds / 2 / TickSeconds) {
		ReviveStep(s, TickSeconds, 10, NoSquadmate)
	}
	half := s.Revive
	for range int(ReviveSeconds / 4 / TickSeconds) {
		ReviveStep(s, TickSeconds, NoSquadmate, NoSquadmate)
	}
	if math.Abs(s.Revive-half/2) > 0.02 {
		t.Errorf(
			"after a quarter of ReviveSeconds alone, progress %v, want about half of %v",
			s.Revive,
			half,
		)
	}
	for range int(ReviveSeconds / TickSeconds) {
		ReviveStep(s, TickSeconds, NoSquadmate, NoSquadmate)
	}
	if s.Revive != 0 {
		t.Errorf("long alone, progress %v, want 0", s.Revive)
	}
}

func TestReviveStep_UpShipsReset(t *testing.T) {
	t.Parallel()

	s := facingUp(ShieldFront)
	s.DownFor, s.Revive = 2, 0.5
	if ReviveStep(s, TickSeconds, 0, 0) || s.DownFor != 0 || s.Revive != 0 {
		t.Errorf("a ship that is up: down for %v, progress %v; want both 0", s.DownFor, s.Revive)
	}
}

func TestHelpers(t *testing.T) {
	t.Parallel()

	friend, squadmate := Helpers(0, 0, []Friend{
		{X: 10, Downed: true, Squadmate: true},
		{X: 30},
		{X: 50, Squadmate: true},
	})
	if friend != 30 || squadmate != 50 {
		t.Errorf("Helpers() = %v, %v, want 30, 50: downed ships don't help", friend, squadmate)
	}
	if f, s := Helpers(0, 0, nil); f != NoSquadmate || s != NoSquadmate {
		t.Errorf("Helpers() of nobody = %v, %v, want NoSquadmate twice", f, s)
	}
}

func TestRespawn(t *testing.T) {
	t.Parallel()

	s := downed()
	s.RotationSnap, s.VX = 16, 50
	if CanRespawn(s) {
		t.Error("could respawn the moment it went down")
	}
	for range int(RespawnDelay/TickSeconds) + 1 {
		ReviveStep(s, TickSeconds, NoSquadmate, NoSquadmate)
	}
	if !CanRespawn(s) {
		t.Fatalf("can't respawn %v s down", s.DownFor)
	}
	Respawn(s, 5, 6)
	full := ShieldStatsOf(ShieldFront).Strength
	if s.Downed() || s.Damage != 0 || s.Shield != full || s.X != 5 || s.Y != 6 || s.VX != 0 ||
		s.RotationSnap != 16 {
		t.Errorf("respawned: %+v; want whole at (5, 6), at rest, full shield, rotation kept", s)
	}
}

func TestSandbox_ADownedShipDrifts(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	for range MaxDamage {
		TakeHit(s.Ship, s.Ship.Angle+math.Pi)
	}
	s.Ship.VX = 100
	angle := s.Ship.Angle
	events := s.Advance(
		TickSeconds*3,
		Input{Up: true, Fire: true, PointerX: 500, PointerY: HomeSpawnY},
		nil,
	)
	if len(events.Shots) != 0 || s.Ship.Thrusting || s.Ship.Angle != angle {
		t.Errorf("down: %d shots, thrusting %v, angle %v; want none, no thrust, facing %v kept",
			len(events.Shots), s.Ship.Thrusting, s.Ship.Angle, angle)
	}
	if s.Ship.VX <= 0 || s.Ship.VX >= 100 {
		t.Errorf("down: vx %v, want drifting and slowing", s.Ship.VX)
	}
	if s.Ship.DownFor <= 0 {
		t.Error("the sandbox didn't count the time down")
	}
}

func TestSandbox_ASquadmateNearRevives(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	for range MaxDamage {
		TakeHit(s.Ship, s.Ship.Angle+math.Pi)
	}
	s.SquadmateDistance, s.FriendDistance = 30, 30
	for range int(ReviveSquadmateSeconds/TickSeconds) + 1 {
		s.Advance(TickSeconds, Input{}, nil)
	}
	if s.Ship.Downed() {
		t.Errorf(
			"a squadmate %v px away for %v s: still down at %v",
			30,
			ReviveSquadmateSeconds,
			s.Ship.Revive,
		)
	}
}

func TestWing_CompanionsReviveADownedOwner(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		mode Mode
		want bool
	}{
		{mode: ModeEscort, want: true},
		{mode: ModeAttack, want: true},
		{mode: ModeHold, want: false},
		{mode: ModeStealth, want: false},
	} {
		t.Run(string(tc.mode), func(t *testing.T) {
			t.Parallel()

			var w Wing
			c := w.Add(1, 250, 0, ModeOrders(tc.mode, DefaultOrders(), 250, 0))
			owner := Mover{Angle: -math.Pi / 2, Downed: true}
			for range 4 * TickRate {
				w.Observe(owner)
				w.Step(nil, nil)
			}
			// Coming over means hovering BrainSpacing out; a Stealth companion
			// keeps its formation slot, which can still be in reach.
			if came := dist(c.Ship.X, c.Ship.Y, 0, 0) <= BrainSpacing+5; came != tc.want {
				t.Errorf("%s: %v from its downed owner; came over %v, want %v",
					tc.mode, dist(c.Ship.X, c.Ship.Y, 0, 0), came, tc.want)
			}
		})
	}
}

func TestWing_ADownedCompanionDriftsUntilRevived(t *testing.T) {
	t.Parallel()

	var w Wing
	c := w.Add(1, 0, 30, DefaultOrders())
	for range MaxDamage {
		TakeHit(c.Ship, c.Ship.Angle+math.Pi)
	}
	// Its owner right beside it: a squadmate.
	owner := Mover{Angle: -math.Pi / 2}
	for range int(ReviveSquadmateSeconds/TickSeconds) + 1 {
		w.Observe(owner)
		if len(
			w.Step([]BrainEnemy{{ID: 1, Kind: EnemyScout, Y: -100, AttackedWing: true}}, nil),
		) != 0 {
			t.Fatal("a downed companion fired")
		}
	}
	if c.Ship.Downed() {
		t.Errorf(
			"beside its owner for %v s: still down at %v",
			ReviveSquadmateSeconds,
			c.Ship.Revive,
		)
	}
}

func TestRescueStep(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		progress float64
		dt       float64
		helper   float64
		want     float64
		done     bool
	}{
		{"a helper in reach fills it", 0, 1, ReviveRadius, 1 / ReviveSeconds, false},
		{"nobody near drains it", 0.5, 1, ReviveRadius + 1, 0.5 - 1/ReviveSeconds, false},
		{"it never drains below empty", 0.1, 1, NoSquadmate, 0, false},
		{"a full bar is a rescue", 0.9, 1, 10, 1, true},
	}
	for _, tc := range tests {
		got, done := RescueStep(tc.progress, tc.dt, tc.helper)
		if !closeTo(got, tc.want) || done != tc.done {
			t.Errorf("%s: RescueStep() = %v, %t; want %v, %t", tc.name, got, done, tc.want, tc.done)
		}
	}
}

func TestWing_CompanionsRescueADerelict(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		mode Mode
		want bool
	}{
		{mode: ModeEscort, want: true},
		{mode: ModeHold, want: false},
		{mode: ModeStealth, want: false},
	} {
		t.Run(string(tc.mode), func(t *testing.T) {
			t.Parallel()

			var w Wing
			c := w.Add(1, 0, 60, ModeOrders(tc.mode, DefaultOrders(), 0, 60))
			derelict := Vec{X: 250, Y: 60}
			w.Derelicts = []Vec{derelict}
			owner := Mover{Angle: -math.Pi / 2}
			for range 4 * TickRate {
				w.Observe(owner)
				w.Step(nil, nil)
			}
			d := dist(c.Ship.X, c.Ship.Y, derelict.X, derelict.Y)
			if came := d <= ReviveRadius; came != tc.want {
				t.Errorf(
					"%s: %v from the derelict; in rescue reach %v, want %v",
					tc.mode,
					d,
					came,
					tc.want,
				)
			}
		})
	}
}

func TestComesToRevive(t *testing.T) {
	t.Parallel()

	oneShot := func(kind OneShotKind) Orders {
		o := DefaultOrders()
		o.OneShot = OneShot{Kind: kind}

		return o
	}
	for _, tc := range []struct {
		name   string
		orders Orders
		// from is how far the companion starts from the downed squadmate.
		from float64
		want bool
	}{
		{name: "escort in range", orders: DefaultOrders(), from: 250, want: true},
		{name: "attack in range", orders: ModeOrders(ModeAttack, DefaultOrders(), 0, 0), from: 250, want: true},
		{name: "guard in range", orders: ModeOrders(ModeGuard, DefaultOrders(), 0, 0), from: 250, want: true},
		{name: "escort out of range", orders: DefaultOrders(), from: 500},
		{name: "hold in range", orders: ModeOrders(ModeHold, DefaultOrders(), 1250, 1000), from: 250},
		{name: "stealth in range", orders: ModeOrders(ModeStealth, DefaultOrders(), 0, 0), from: 250},
		{name: "regrouping in range", orders: oneShot(OneShotRegroup), from: 250},
		{name: "going home in range", orders: oneShot(OneShotGoHome), from: 250},
		{name: "shielding nobody in range", orders: oneShot(OneShotShieldMe), from: 250, want: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			// The owner is far below, so only a revive brings it over.
			const downX, downY = 1000.0, 1000.0
			var w Wing
			c := w.Add(1, downX+tc.from, downY, tc.orders)
			if got := ComesToRevive(c.Ship, tc.orders, downX, downY); got != tc.want {
				t.Errorf("ComesToRevive() = %v, want %v", got, tc.want)
			}
			owner := Mover{X: downX + tc.from, Y: downY + 2000, Angle: -math.Pi / 2}
			down := []Friend{{X: downX, Y: downY, Squadmate: true, Downed: true}}
			for range 4 * TickRate {
				w.Observe(owner)
				w.Step(nil, down)
			}
			if came := dist(c.Ship.X, c.Ship.Y, downX, downY) <= BrainSpacing+5; came != tc.want {
				t.Errorf("%v from the downed squadmate; came over %v, want %v",
					dist(c.Ship.X, c.Ship.Y, downX, downY), came, tc.want)
			}
		})
	}
}

func TestWing_ADownedSquadmateComesBeforeADerelict(t *testing.T) {
	t.Parallel()

	var w Wing
	c := w.Add(1, 0, 60, DefaultOrders())
	w.Derelicts = []Vec{{X: -250, Y: 60}}
	owner := Mover{Angle: -math.Pi / 2, Downed: true}
	for range 4 * TickRate {
		w.Observe(owner)
		w.Step(nil, nil)
	}
	if d := dist(c.Ship.X, c.Ship.Y, 0, 0); d > BrainSpacing+5 {
		t.Errorf("%v from its downed owner, want beside them, not at the derelict", d)
	}
}
