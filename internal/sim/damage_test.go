package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

// facingUp is a ship at the origin facing up, with a shield.
func facingUp(shield ShieldID) *Ship {
	return NewShip(0, 0, Loadout{Weapon: WeaponAutoCannon, Engine: EngineBase, Shield: shield})
}

func TestTakeHit_TheShieldTakesHitsFromTheSidesItCovers(t *testing.T) {
	t.Parallel()

	ahead, behind := -math.Pi/2, math.Pi/2
	tests := []struct {
		name       string
		shield     ShieldID
		from       float64
		wantShield float64
		wantDamage int
	}{
		{name: "front shield, hit ahead", shield: ShieldFront, from: ahead, wantShield: 2},
		{
			name:       "front shield, hit from behind",
			shield:     ShieldFront,
			from:       behind,
			wantShield: 3,
			wantDamage: 1,
		},
		{
			name:       "front shield, hit from the side",
			shield:     ShieldFront,
			from:       0,
			wantShield: 3,
			wantDamage: 1,
		},
		{
			name:       "front and side, hit from the side",
			shield:     ShieldFrontAndSide,
			from:       0,
			wantShield: 1,
		},
		{name: "round, hit from behind", shield: ShieldRound, from: behind, wantShield: 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			ship := facingUp(tc.shield)
			absorbed := TakeHit(ship, tc.from)
			if ship.Shield != tc.wantShield || ship.Damage != tc.wantDamage ||
				absorbed != (tc.wantDamage == 0) {
				t.Errorf(
					"after the hit: shield %v, damage %d, absorbed %t; want shield %v, damage %d",
					ship.Shield,
					ship.Damage,
					absorbed,
					tc.wantShield,
					tc.wantDamage,
				)
			}
		})
	}
}

func TestTakeHit_AnEmptyShieldLetsHitsThrough(t *testing.T) {
	t.Parallel()

	ship := facingUp(ShieldRound)
	TakeHit(ship, 0)
	for range 5 {
		TakeHit(ship, 0)
	}
	if ship.Shield != 0 || ship.Damage != MaxDamage {
		t.Errorf(
			"shield %v, damage %d, want 0 and the most the hull takes (%d)",
			ship.Shield,
			ship.Damage,
			MaxDamage,
		)
	}
}

func TestRecover_ShieldRechargesAfterASpell(t *testing.T) {
	t.Parallel()

	ship := facingUp(ShieldFront)
	TakeHit(ship, -math.Pi/2)
	Recover(ship, ShieldRechargeDelay-0.1, NoSquadmate)
	if ship.Shield != 2 {
		t.Errorf("before the delay: shield %v, want 2", ship.Shield)
	}
	stats := ShieldStatsOf(ShieldFront)
	full := stats.Recharge
	Recover(ship, 0.1+full/stats.Strength/2, NoSquadmate)
	if ship.Shield <= 2 || ship.Shield >= 3 {
		t.Errorf("half a charge's time later: shield %v, want between 2 and 3", ship.Shield)
	}
	Recover(ship, full, NoSquadmate)
	if ship.Shield != stats.Strength {
		t.Errorf("fully recharged: shield %v, want %v, and no more", ship.Shield, stats.Strength)
	}
}

func TestRecover_FormationRechargesFaster(t *testing.T) {
	t.Parallel()

	alone, together := facingUp(ShieldFront), facingUp(ShieldFront)
	for _, s := range []*Ship{alone, together} {
		TakeHit(s, -math.Pi/2)
		TakeHit(s, -math.Pi/2)
	}
	for _, s := range []*Ship{alone, together} {
		Recover(s, ShieldRechargeDelay, NoSquadmate)
	}
	Recover(alone, 0.5, NoSquadmate)
	Recover(together, 0.5, FormationRadius)
	// The first Recover only waits out the delay, then half a second recharges.
	gainAlone, gainTogether := alone.Shield-1, together.Shield-1
	if math.Abs(gainTogether-FormationRecharge*gainAlone) > 1e-9 {
		t.Errorf(
			"recharged %v alone and %v together, want %d times as much",
			gainAlone,
			gainTogether,
			FormationRecharge,
		)
	}
}

func TestRecover_HullHealsSlowly(t *testing.T) {
	t.Parallel()

	ship := facingUp(ShieldFront)
	TakeHit(ship, math.Pi/2)
	TakeHit(ship, math.Pi/2)
	for range int(math.Round((HullRegenDelay + HullRegenEvery - 1) / TickSeconds)) {
		Recover(ship, TickSeconds, NoSquadmate)
	}
	if ship.Damage != 2 {
		t.Errorf("before the first step heals: damage %d, want 2", ship.Damage)
	}
	for range int(math.Round(2 / TickSeconds)) {
		Recover(ship, TickSeconds, NoSquadmate)
	}
	if ship.Damage != 1 {
		t.Errorf("after one step heals: damage %d, want 1", ship.Damage)
	}
	TakeHit(ship, math.Pi/2)
	Recover(ship, HullRegenDelay-1, NoSquadmate)
	if ship.Damage != 2 {
		t.Errorf("a new hit restarts the wait: damage %d, want 2", ship.Damage)
	}
}

func TestShipHitAlong(t *testing.T) {
	t.Parallel()

	// A ship at the origin facing up (-y).
	ship := func(shield ShieldID, charges float64) ShipTarget {
		return ShipTarget{Angle: -math.Pi / 2, Shield: shield, Charges: charges}
	}
	front := ShieldStatsOf(ShieldFront).Radius + ShotRadius
	round := ShieldStatsOf(ShieldRound).Radius + ShotRadius
	hull := float64(ShipRadius + ShotRadius)
	for _, tc := range []struct {
		name           string
		target         ShipTarget
		x0, y0, x1, y1 float64
		along, from    float64
		ok             bool
	}{
		{
			name:   "from the front, the shield meets it",
			target: ship(ShieldFront, 3),
			y0:     -100,
			along:  (100 - front) / 100, from: -math.Pi / 2, ok: true,
		},
		{
			name:   "from the front with no charge, the hull does",
			target: ship(ShieldFront, 0.9),
			y0:     -100,
			along:  (100 - hull) / 100, from: -math.Pi / 2, ok: true,
		},
		{
			name:   "from behind, past the front shield to the hull",
			target: ship(ShieldFront, 3),
			y0:     100,
			along:  (100 - hull) / 100, from: math.Pi / 2, ok: true,
		},
		{
			name:   "from behind, the round shield meets it",
			target: ship(ShieldRound, 1),
			y0:     100,
			along:  (100 - round) / 100, from: math.Pi / 2, ok: true,
		},
		{
			name:   "starting inside the shield",
			target: ship(ShieldFront, 3),
			y0:     -front + 1, y1: -front + 1,
			along: 0, from: -math.Pi / 2, ok: true,
		},
		{
			name:   "passing wide",
			target: ship(ShieldRound, 1),
			x0:     100, y0: -100, x1: 100,
		},
		{
			name:   "flying away",
			target: ship(ShieldFront, 3),
			y0:     -30, y1: -100,
		},
		{
			name:   "not there yet",
			target: ship(ShieldFront, 3),
			y0:     -100, y1: -90,
		},
		{
			name:   "standing still outside",
			target: ship(ShieldFront, 3),
			y0:     -100, y1: -100,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			along, from, ok := ShipHitAlong(tc.target, tc.x0, tc.y0, tc.x1, tc.y1)
			if ok != tc.ok || math.Abs(along-tc.along) > 1e-9 ||
				math.Abs(WrapAngle(from-tc.from)) > 1e-9 {
				t.Errorf(
					"ShipHitAlong() = %v, %v, %v, want %v, %v, %v",
					along, from, ok, tc.along, tc.from, tc.ok,
				)
			}
		})
	}
}

func TestFirstShipHit(t *testing.T) {
	t.Parallel()

	near := ShipTarget{Y: -50, Angle: -math.Pi / 2, Shield: ShieldFront}
	far := ShipTarget{Y: 0, Angle: -math.Pi / 2, Shield: ShieldFront}
	if i, _, ok := FirstShipHit([]ShipTarget{far, near}, 0, -100, 0, 0); !ok || i != 1 {
		t.Errorf("FirstShipHit() = %d, %v, want 1 (the nearer ship), true", i, ok)
	}
	if _, _, ok := FirstShipHit([]ShipTarget{far}, 100, -100, 100, 0); ok {
		t.Error("FirstShipHit() of a miss = true, want false")
	}
}

func TestTargetOf(t *testing.T) {
	t.Parallel()

	s := facingUp(ShieldRound)
	s.X, s.Y = 3, 4
	want := ShipTarget{X: 3, Y: 4, Angle: s.Angle, Shield: ShieldRound, Charges: s.Shield}
	if got := TargetOf(s); got != want {
		t.Errorf("TargetOf() = %+v, want %+v", got, want)
	}
}

func TestRecover_OnlyTheTimePastTheDelayCounts(t *testing.T) {
	t.Parallel()

	ship := facingUp(ShieldFront)
	TakeHit(ship, -math.Pi/2)
	// One long step, as a throttled hidden tab might take: 3 s waiting, 0.5 s recharging.
	Recover(ship, ShieldRechargeDelay+0.5, NoSquadmate)
	stats := ShieldStatsOf(ShieldFront)
	if want := 2 + stats.Strength/stats.Recharge*0.5; math.Abs(ship.Shield-want) > 1e-9 {
		t.Errorf("shield %v, want %v", ship.Shield, want)
	}
}
