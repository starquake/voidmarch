package sim_test

import (
	"math"
	"slices"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

var idle = Input{PointerY: -1000}

func TestSandbox_AdvanceRunsWholeTicks(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	if got := s.Advance(TickSeconds*2.5, idle, nil).Ticks; got != 2 {
		t.Errorf("2.5 ticks' time: %d ticks, want 2", got)
	}
	if math.Abs(s.Alpha()-0.5) > 1e-6 {
		t.Errorf("Alpha() = %v, want 0.5", s.Alpha())
	}
	if got := s.Advance(TickSeconds*0.6, idle, nil).Ticks; got != 1 {
		t.Errorf("with the remainder: %d ticks, want 1", got)
	}
	if got := NewSandbox().Advance(10, idle, nil).Ticks; got != MaxTicksPerFrame {
		t.Errorf("after a stall: %d ticks, want %d", got, MaxTicksPerFrame)
	}
}

func TestSandbox_MovesAndRemembers(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	startY := s.Ship.Y
	s.Advance(0.5, Input{Up: true, PointerY: -1000}, nil)
	if s.Ship.Y >= startY || s.Previous.Y <= s.Ship.Y {
		t.Errorf(
			"holding W: y %v from %v, previous %v, want moving up",
			s.Ship.Y,
			startY,
			s.Previous.Y,
		)
	}
}

func TestSandbox_ChargeThenShot(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	s.Ship.Loadout.Weapon = WeaponBigSpaceGun
	first := s.Advance(TickSeconds, Input{Fire: true}, nil)
	if !slices.Equal(first.Charges, []WeaponID{WeaponBigSpaceGun}) || len(first.Shots) != 0 {
		t.Fatalf("first tick = %+v, want a charge and no shot", first)
	}
	shots := 0
	for tick := 0.0; tick < 1; tick += TickSeconds {
		shots += len(s.Advance(TickSeconds, idle, nil).Shots)
	}
	if shots != 1 {
		t.Errorf("shots after the charge = %d, want 1", shots)
	}
}

func TestSandbox_ShotsAndExpiries(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	events := s.Advance(TickSeconds, Input{Fire: true, PointerY: -1000}, nil)
	if len(events.Shots) != 1 || events.Shots[0].Companion != 0 ||
		s.Projectiles.ActiveCount() != 1 {
		t.Fatalf("firing: %+v, want one shot of the player's own", events.Shots)
	}
	expired := 0
	for tick := 0.0; tick < WeaponStatsOf(WeaponAutoCannon).Lifetime+0.2; tick += TickSeconds {
		expired += len(s.Advance(TickSeconds, idle, nil).Expired)
	}
	if expired != 1 {
		t.Errorf("expired = %d, want 1", expired)
	}
}

func TestSandbox_ControlModes(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	startX := s.Ship.X
	aimRight := Input{Up: true, PointerX: 10_000, PointerY: s.Ship.Y}
	for range 30 {
		s.Advance(TickSeconds, aimRight, nil)
	}
	if s.ControlMode != ControlShip || s.Ship.X <= startX+20 {
		t.Errorf(
			"ship-relative (the default): x %v from %v, want W to fly toward the aim",
			s.Ship.X,
			startX,
		)
	}

	s = NewSandbox()
	s.ControlMode = ControlScreen
	start := s.Ship.Mover()
	aimRight.PointerY = s.Ship.Y
	for range 30 {
		s.Advance(TickSeconds, aimRight, nil)
	}
	if s.Ship.Y >= start.Y-20 || !closeTo(s.Ship.X, start.X) {
		t.Errorf(
			"screen-relative: at (%v, %v) from (%v, %v), want W to fly up",
			s.Ship.X,
			s.Ship.Y,
			start.X,
			start.Y,
		)
	}
}

func TestSandbox_CompanionFlysIntoFormation(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	c := s.AddCompanion(1, s.Ship.X+150, s.Ship.Y+150)
	for tick := 0.0; tick < 3; tick += TickSeconds {
		s.Advance(TickSeconds, idle, nil)
	}
	if d := math.Hypot(c.Ship.X-s.Ship.X, c.Ship.Y-s.Ship.Y); d >= 100 {
		t.Errorf("after 3 s: %v away, want in formation", d)
	}
}

func TestSandbox_CompanionShotsCarryItsNumber(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	s.AddCompanion(2, s.Ship.X-40, s.Ship.Y+40)
	enemies := []BrainEnemy{{ID: 1, X: s.Ship.X, Y: s.Ship.Y - 200}}
	var shots []FiredShot
	for tick := 0.0; tick < 2; tick += TickSeconds {
		shots = append(shots, s.Advance(TickSeconds, idle, enemies).Shots...)
	}
	if len(shots) == 0 {
		t.Fatal("the companion never fired")
	}
	for _, shot := range shots {
		if shot.Companion != 2 {
			t.Errorf("shot from %d, want only companion 2", shot.Companion)
		}
	}
	for _, p := range s.Projectiles.Items() {
		if p.Active && (p.Owner != "2" || p.Faction != FactionOwn) {
			t.Errorf("projectile %+v, want companion 2's own shots only", p)
		}
	}
}

func TestSandbox_AddAndRemoveCompanions(t *testing.T) {
	t.Parallel()

	numbers := func(s *Sandbox) []int {
		out := make([]int, 0, len(s.Companions))
		for _, c := range s.Companions {
			out = append(out, c.Number)
		}

		return out
	}
	s := NewSandbox()
	s.AddCompanion(1, 0, 0)
	s.AddCompanion(2, 0, 0)
	s.AddCompanion(1, 5, 5)
	if got := numbers(s); !slices.Equal(got, []int{2, 1}) {
		t.Errorf("after adding 1, 2, 1 again: %v, want [2 1]", got)
	}

	s.Projectiles.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(WeaponAutoCannon)},
		SpawnOptions{Owner: "2"},
	)
	s.Projectiles.Spawn(
		ProjectileSpawn{Kind: ProjectileKind(WeaponAutoCannon)},
		SpawnOptions{Owner: "1"},
	)
	s.Projectiles.Spawn(ProjectileSpawn{Kind: ProjectileKind(WeaponAutoCannon)}, SpawnOptions{})
	s.RemoveCompanion(2)
	if got := numbers(s); !slices.Equal(got, []int{1}) {
		t.Errorf("after removing 2: %v, want [1]", got)
	}
	var owners []string
	for _, p := range s.Projectiles.Items() {
		if p.Active {
			owners = append(owners, p.Owner)
		}
	}
	if !slices.Equal(owners, []string{"1", ""}) {
		t.Errorf("shots in flight owned by %q, want companion 2's ended", owners)
	}
}

func TestSandbox_CompanionsReactLate(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	lo, hi := int(
		math.Round(BrainReactionMin/TickSeconds),
	), int(
		math.Round(BrainReactionMax/TickSeconds),
	)
	ticks := map[int]bool{}
	for n := 1; n <= 3; n++ {
		c := s.AddCompanion(n, 0, 200)
		if c.ReactionTicks < lo || c.ReactionTicks > hi {
			t.Errorf(
				"companion %d reacts after %d ticks, want %d to %d",
				n,
				c.ReactionTicks,
				lo,
				hi,
			)
		}
		ticks[c.ReactionTicks] = true
	}
	if len(ticks) < 2 {
		t.Error("every companion reacts at the same pace")
	}
}

func TestSandbox_CompanionFollowsWhereTheOwnerWas(t *testing.T) {
	t.Parallel()

	s := NewSandbox()
	c := s.AddCompanion(1, s.Ship.X, s.Ship.Y+60)
	for tick := 0.0; tick < 1; tick += TickSeconds {
		s.Advance(TickSeconds, idle, nil)
	}
	before := c.Ship.VX
	s.Ship.X += 300
	s.Advance(TickSeconds, idle, nil)
	if math.Abs(c.Ship.VX-before) >= 20 {
		t.Errorf(
			"the tick after the owner moved: vx %v from %v, want no reaction yet",
			c.Ship.VX,
			before,
		)
	}
	for tick := 0.0; tick < BrainReactionMax+0.1; tick += TickSeconds {
		s.Advance(TickSeconds, idle, nil)
	}
	if c.Ship.VX <= 50 {
		t.Errorf("after its reaction time: vx %v, want heading after the owner", c.Ship.VX)
	}
}
