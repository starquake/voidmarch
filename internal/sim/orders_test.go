package sim_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestModeOrders(t *testing.T) {
	t.Parallel()

	tests := []struct {
		mode Mode
		want Orders
	}{
		{ModeEscort, DefaultOrders()},
		{
			ModeAttack,
			Orders{
				Stance:       StanceAggressive,
				Fire:         FireFree,
				Resources:    ResourcesSpend,
				SupportFirst: true,
			},
		},
		{
			ModeGuard,
			Orders{Stance: StanceDefensive, Fire: FireReturn, Resources: ResourcesConserve},
		},
		{
			ModeHold,
			Orders{
				Stance:    StanceHold,
				Fire:      FireFree,
				Resources: ResourcesSpend,
				HoldX:     10,
				HoldY:     20,
			},
		},
		{ModeStealth, Orders{Stance: StanceEscort, Fire: FireHold, Resources: ResourcesConserve}},
	}
	for _, tc := range tests {
		t.Run(string(tc.mode), func(t *testing.T) {
			t.Parallel()

			if got := ModeOrders(tc.mode, DefaultOrders(), 10, 20); got != tc.want {
				t.Errorf("ModeOrders(%s) = %+v, want %+v", tc.mode, got, tc.want)
			}
			if got := ModeOf(tc.want); got != tc.mode {
				t.Errorf("ModeOf(%+v) = %s, want %s", tc.want, got, tc.mode)
			}
		})
	}
}

func TestModeOrders_ReplacesEverythingAndEndsAOneShot(t *testing.T) {
	t.Parallel()

	clash := Orders{
		Stance: StanceAggressive, Fire: FireHold, Resources: ResourcesConserve,
		HoldX: 5, HoldY: 6, OneShot: OneShot{Kind: OneShotRegroup},
	}
	got := ModeOrders(ModeEscort, clash, 10, 20)
	want := DefaultOrders()
	want.HoldX, want.HoldY = 5, 6
	if got != want {
		t.Errorf("Escort over %+v = %+v, want %+v", clash, got, want)
	}
}

func TestWithOneShot(t *testing.T) {
	t.Parallel()

	attacking := ModeOrders(ModeAttack, DefaultOrders(), 0, 0)
	regroup, ok := WithOneShot(OneShotRegroup, attacking, 0)
	if !ok || regroup.Stance != StanceAggressive || regroup.OneShot.Kind != OneShotRegroup {
		t.Errorf("regroup = %+v, %t, want the mode kept and regrouping", regroup, ok)
	}
	focus, ok := WithOneShot(OneShotFocus, attacking, 7)
	if !ok || focus.OneShot != (OneShot{Kind: OneShotFocus, EnemyID: 7}) {
		t.Errorf("focus = %+v, %t, want focusing on 7", focus, ok)
	}
	if _, ok := WithOneShot(OneShotFocus, attacking, 0); ok {
		t.Error("focus with no enemy was given")
	}
}
