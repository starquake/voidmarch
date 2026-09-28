package sim_test

import (
	"slices"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestLoadout_FourPartsPerSlot(t *testing.T) {
	t.Parallel()

	if len(Weapons()) != 4 || len(Engines()) != 4 || len(Shields()) != 4 {
		t.Errorf(
			"parts = %d weapons, %d engines, %d shields, want 4 each",
			len(Weapons()),
			len(Engines()),
			len(Shields()),
		)
	}
	d := DefaultLoadout()
	if !slices.Contains(Weapons(), d.Weapon) || !slices.Contains(Engines(), d.Engine) ||
		!slices.Contains(Shields(), d.Shield) {
		t.Errorf("DefaultLoadout() = %+v, want one part per slot", d)
	}
	for _, id := range Shields() {
		if s := ShieldStatsOf(id); s.Strength <= 0 || s.Coverage <= 0 {
			t.Errorf("ShieldStatsOf(%s) = %+v, want some strength and coverage", id, s)
		}
	}
}

func TestEnemies(t *testing.T) {
	t.Parallel()

	for _, kind := range EnemyKinds() {
		if EnemyRadius(kind) <= 0 || EnemyHP(kind) <= 0 || IsSupport(kind) {
			t.Errorf(
				"%s: radius %v, hp %v, support %t",
				kind,
				EnemyRadius(kind),
				EnemyHP(kind),
				IsSupport(kind),
			)
		}
	}
	if EnemyHP(EnemyFighter) <= EnemyHP(EnemyScout) {
		t.Error("the Fighter is no tougher than the Scout")
	}
}
