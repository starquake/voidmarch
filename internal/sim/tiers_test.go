package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

func TestTier(t *testing.T) {
	t.Parallel()

	tests := []struct {
		tier  Tier
		boost float64
		name  string
	}{
		{TierPlain, 1, ""},
		{TierSuper, 1.15, "Super"},
		{TierMega, 1.3, "Mega"},
		{TierHyper, 1.45, "Hyper"},
	}
	for _, tc := range tests {
		if got := tc.tier.Boost(); math.Abs(got-tc.boost) > 1e-9 {
			t.Errorf("Tier(%d).Boost() = %v, want %v", tc.tier, got, tc.boost)
		}
		if got := tc.tier.Name(); got != tc.name {
			t.Errorf("Tier(%d).Name() = %q, want %q", tc.tier, got, tc.name)
		}
	}
}

func TestStatsAt_ATierStrengthensThePartsOwnStrength(t *testing.T) {
	t.Parallel()

	l := Loadout{
		Weapon: WeaponZapper, Engine: EngineBurst, Shield: ShieldRound,
		WeaponTier: TierHyper, EngineTier: TierMega, ShieldTier: TierSuper,
	}
	near := func(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

	want := WeaponStatsOf(WeaponZapper).Interval / 1.45
	if got := l.WeaponStats().Interval; !near(got, want) {
		t.Errorf("Hyper zapper interval = %v, want %v", got, want)
	}
	want = EngineStatsOf(EngineBurst).Acceleration * 1.3
	if got := l.EngineStats().Acceleration; !near(got, want) {
		t.Errorf("Mega burst engine acceleration = %v, want %v", got, want)
	}
	want = ShieldStatsOf(ShieldRound).Recharge / 1.15
	if got := l.ShieldStats().Recharge; !near(got, want) {
		t.Errorf("Super round shield recharge = %v, want %v", got, want)
	}
	// Everything else stays: the parts remain sidegrades.
	if got, want := l.WeaponStats().Damage, WeaponStatsOf(WeaponZapper).Damage; got != want {
		t.Errorf("Hyper zapper damage = %v, want %v", got, want)
	}
	if got, want := l.EngineStats().MaxSpeed, EngineStatsOf(EngineBurst).MaxSpeed; got != want {
		t.Errorf("Mega burst engine max speed = %v, want %v", got, want)
	}
	if got, want := l.ShieldStats().Strength, ShieldStatsOf(ShieldRound).Strength; got != want {
		t.Errorf("Super round shield strength = %v, want %v", got, want)
	}
}

func TestStepWeapon_AHyperWeaponFiresMore(t *testing.T) {
	t.Parallel()

	shots := func(tier Tier) int {
		ship := NewShip(
			0,
			0,
			Loadout{
				Weapon:     WeaponAutoCannon,
				Engine:     EngineBase,
				Shield:     ShieldFront,
				WeaponTier: tier,
			},
		)
		n := 0
		for range 10 * TickRate {
			n += len(StepWeapon(ship, true, TickSeconds).Shots)
		}

		return n
	}
	if plain, hyper := shots(TierPlain), shots(TierHyper); hyper <= plain {
		t.Errorf("shots in 10 s: Hyper %d, plain %d, want Hyper more", hyper, plain)
	}
}

func TestParts(t *testing.T) {
	t.Parallel()

	parts := Parts()
	if got, want := len(parts), 12; got != want {
		t.Fatalf("len(Parts()) = %d, want %d", got, want)
	}
	seen := map[Part]bool{}
	for _, p := range parts {
		if seen[p] {
			t.Errorf("part %q listed twice: slots share an id", p)
		}
		seen[p] = true
	}
}

func TestUnlocks_Grant(t *testing.T) {
	t.Parallel()

	u := DefaultUnlocks()
	if got, want := u.Level(), 3; got != want {
		t.Errorf("DefaultUnlocks().Level() = %d, want %d", got, want)
	}
	zapper := Part(WeaponZapper)
	if !u.CanUse(zapper) || !u.Grant(zapper) {
		t.Fatal("a part nobody owns can't be granted")
	}
	if got, want := u[zapper], TierPlain; got != want {
		t.Errorf("a new part's tier = %v, want %v", got, want)
	}
	for want := TierSuper; want <= TierHyper; want++ {
		if !u.Grant(zapper) || u[zapper] != want {
			t.Fatalf("a duplicate raised the tier to %v, want %v", u[zapper], want)
		}
	}
	if u.CanUse(zapper) || u.Grant(zapper) {
		t.Error("a Hyper part took another pickup")
	}
	if got, want := u.Level(), 3+1+3; got != want {
		t.Errorf("Level() = %d, want %d", got, want)
	}
}

func TestBehind(t *testing.T) {
	t.Parallel()

	fresh := DefaultUnlocks()
	veteran := DefaultUnlocks()
	veteran.Grant(Part(WeaponZapper))
	veteran.Grant(Part(WeaponZapper))

	if !Behind(fresh, []Unlocks{veteran}) {
		t.Error("a fresh player next to a veteran isn't behind")
	}
	if Behind(veteran, []Unlocks{fresh}) {
		t.Error("a veteran next to a fresh player is behind")
	}
	if Behind(fresh, nil) {
		t.Error("a player without squadmates is behind")
	}
}

func TestDropFor(t *testing.T) {
	t.Parallel()

	fresh := DefaultUnlocks()
	if _, ok := DropFor([]Unlocks{fresh}, nil, 0, 1); ok {
		t.Error("a 0 chance dropped a part")
	}
	part, ok := DropFor([]Unlocks{fresh}, nil, 1, 1)
	if !ok {
		t.Fatal("a certain drop dropped nothing")
	}
	if _, owned := fresh[part]; owned {
		t.Errorf("dropped %q, which the only player nearby owns; want a part they lack", part)
	}
	// The same seed rolls the same drop.
	if again, _ := DropFor([]Unlocks{fresh}, nil, 1, 1); again != part {
		t.Errorf("seed 1 dropped %q, then %q", part, again)
	}
}

func TestDropFor_FavorsAPlayerBehind(t *testing.T) {
	t.Parallel()

	// The player behind owns everything but the zapper, so every drop for
	// them is the zapper or an upgrade.
	behind := Unlocks{}
	for _, p := range Parts() {
		behind[p] = TierHyper
	}
	behind[Part(WeaponZapper)] = TierMega
	for seed := range uint32(50) {
		part, ok := DropFor([]Unlocks{DefaultUnlocks(), behind}, []Unlocks{behind}, 1, seed)
		if !ok || part != Part(WeaponZapper) {
			t.Fatalf(
				"seed %d dropped %q, %t, want the zapper the player behind can raise",
				seed,
				part,
				ok,
			)
		}
	}
}

func TestDropFor_UpgradesWhenNobodyLacksAnything(t *testing.T) {
	t.Parallel()

	owner := Unlocks{}
	for _, p := range Parts() {
		owner[p] = TierHyper
	}
	owner[Part(EngineBurst)] = TierPlain
	part, ok := DropFor([]Unlocks{owner}, nil, 1, 3)
	if !ok || part != Part(EngineBurst) {
		t.Errorf("DropFor() = %q, %t, want the only part that can go up a tier", part, ok)
	}
	owner[Part(EngineBurst)] = TierHyper
	if part, ok = DropFor([]Unlocks{owner}, nil, 1, 3); ok {
		t.Errorf("dropped %q for a player with every part at Hyper", part)
	}
}

func TestDropFor_CatchUpDoublesTheChance(t *testing.T) {
	t.Parallel()

	rate := func(behind []Unlocks) float64 {
		drops := 0
		const rolls = 20000
		for seed := range uint32(rolls) {
			if _, ok := DropFor([]Unlocks{DefaultUnlocks()}, behind, FighterDropChance, seed); ok {
				drops++
			}
		}

		return float64(drops) / rolls
	}
	if got := rate(nil); math.Abs(got-FighterDropChance) > 0.02 {
		t.Errorf("drop rate = %v, want about %v", got, FighterDropChance)
	}
	withCatchUp := rate([]Unlocks{DefaultUnlocks()})
	if want := FighterDropChance * CatchUpDrops; math.Abs(withCatchUp-want) > 0.02 {
		t.Errorf("drop rate with a player behind = %v, want about %v", withCatchUp, want)
	}
}

func TestDropChance(t *testing.T) {
	t.Parallel()

	if got, want := DropChance(EnemyScout), ScoutDropChance; got != want {
		t.Errorf("DropChance(scout) = %v, want %v", got, want)
	}
	if got, want := DropChance(EnemyFighter), FighterDropChance; got != want {
		t.Errorf("DropChance(fighter) = %v, want %v", got, want)
	}
}
