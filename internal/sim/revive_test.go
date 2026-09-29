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
