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

func TestHitFrom(t *testing.T) {
	t.Parallel()

	p := &Projectile{Angle: 0}
	if got := HitFrom(p); math.Abs(math.Abs(got)-math.Pi) > 1e-9 {
		t.Errorf("a shot flying +x came from %v, want the -x side (Pi)", got)
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
