package simbridge_test

import (
	"math"
	"slices"
	"testing"
	"unicode/utf16"

	"github.com/starquake/voidmarch/internal/sim"
	. "github.com/starquake/voidmarch/internal/simbridge"
)

func slot(b *Bridge, i int) []float64 {
	return b.State[PoolOffset+i*ProjectileSize : PoolOffset+(i+1)*ProjectileSize]
}

func index[T comparable](list []T, v T) float64 {
	return float64(slices.Index(list, v))
}

func TestNew_WritesTheStartingShip(t *testing.T) {
	t.Parallel()

	b := New()
	if b.State[HeaderShipX] != 0 || b.State[HeaderShipY] != 160 {
		t.Errorf("ship at (%v, %v), want (0, 160)", b.State[HeaderShipX], b.State[HeaderShipY])
	}
	got, want := b.State[HeaderShipWeapon], index(sim.Weapons(), sim.WeaponAutoCannon)
	if got != want {
		t.Errorf("weapon index = %v, want %v", got, want)
	}
}

func TestAdvance_MovesAndReportsShots(t *testing.T) {
	t.Parallel()

	b := New()
	b.Advance(
		sim.TickSeconds*3,
		sim.Command{MoveY: -1, AimY: -1000, Fire: true},
		sim.NoSquadmate,
		sim.NoSquadmate,
	)
	if got := b.State[HeaderTicks]; got != 3 {
		t.Errorf("ticks = %v, want 3", got)
	}
	if b.State[HeaderShipY] >= 160 || b.State[HeaderPreviousY] <= b.State[HeaderShipY] {
		t.Errorf(
			"ship y %v, previous %v, want moving up",
			b.State[HeaderShipY],
			b.State[HeaderPreviousY],
		)
	}
	if b.State[HeaderShots] < 1 {
		t.Fatalf("shots = %v, want the auto cannon firing", b.State[HeaderShots])
	}
	shot := b.State[ShotsOffset : ShotsOffset+ShotSize]
	if shot[ShotID] != 1 || shot[ShotWeapon] != index(sim.Weapons(), sim.WeaponAutoCannon) {
		t.Errorf("first shot = %v, want id 1 from the auto cannon", shot)
	}
	first := slot(b, 0)
	if first[ProjectileActive] != 1 ||
		first[ProjectileFaction] != index(Factions(), sim.FactionOwn) {
		t.Errorf("slot 0 = %v, want an active own shot", first)
	}
}

func TestAdvance_ReportsChargesAndExpiries(t *testing.T) {
	t.Parallel()

	b := New()
	b.SetLoadout(slices.Index(sim.Weapons(), sim.WeaponBigSpaceGun), -1, -1, 0, 0, 0)
	// Past the swap (#191), so the charge starts on the next tick.
	for b.State[HeaderShipCooldown] > 0 {
		b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
	}
	b.Advance(
		sim.TickSeconds,
		sim.Command{AimY: -1000, Fire: true},
		sim.NoSquadmate,
		sim.NoSquadmate,
	)
	if b.State[HeaderCharges] != 1 ||
		b.State[ChargesOffset] != index(sim.Weapons(), sim.WeaponBigSpaceGun) {
		t.Errorf("charges = %v, want the big space gun's", b.State[HeaderCharges])
	}

	b = New()
	b.Spawn(0, 0, 0, 0, 0, 0, 10, 0)
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
	if b.State[HeaderExpired] != 1 {
		t.Errorf("expired = %v, want the spawned-old shot", b.State[HeaderExpired])
	}
}

func TestShipSetters(t *testing.T) {
	t.Parallel()

	b := New()
	b.PlaceShip(50, 60)
	if b.State[HeaderShipX] != 50 || b.State[HeaderPreviousY] != 60 {
		t.Errorf("placed at (%v, %v), want (50, 60)", b.State[HeaderShipX], b.State[HeaderShipY])
	}
	b.SetLoadout(1, 2, 3, 0, 0, 0)
	if b.State[HeaderShipWeapon] != 1 || b.State[HeaderShipEngine] != 2 ||
		b.State[HeaderShipShield] != 3 {
		t.Errorf("loadout = %v, want 1 2 3", b.State[HeaderShipWeapon:HeaderShipShield+1])
	}
	b.SetLoadout(-1, -1, -1, 3, 9, -2)
	if got := b.State[HeaderShipWeaponTier : HeaderShipShieldTier+1]; got[0] != 3 || got[1] != 3 ||
		got[2] != 0 {
		t.Errorf("tiers = %v, want 3 3 0: each held to plain through Hyper", got)
	}
	b.SetLoadout(9, -1, 0, 0, 0, 0)
	if b.State[HeaderShipWeapon] != 1 || b.State[HeaderShipEngine] != 2 ||
		b.State[HeaderShipShield] != 0 {
		t.Errorf(
			"out-of-range indexes changed parts: %v",
			b.State[HeaderShipWeapon:HeaderShipShield+1],
		)
	}
	b.SetDamage(2)
	b.SetRotationSnap(16)
	if b.State[HeaderShipDamage] != 2 || b.State[HeaderShipRotationSnap] != 16 {
		t.Errorf(
			"damage %v, snap %v, want 2 and 16",
			b.State[HeaderShipDamage],
			b.State[HeaderShipRotationSnap],
		)
	}
}

func TestControlMode(t *testing.T) {
	t.Parallel()

	b := New()
	b.SetControlMode(sim.ControlScreen)
	for range 30 {
		b.Advance(
			sim.TickSeconds,
			sim.Command{MoveY: -1, AimX: 10_000, AimY: 160},
			sim.NoSquadmate,
			sim.NoSquadmate,
		)
	}
	if math.Abs(b.State[HeaderShipX]) > 1e-9 || b.State[HeaderShipY] >= 140 {
		t.Errorf(
			"screen-relative W: at (%v, %v), want straight up",
			b.State[HeaderShipX],
			b.State[HeaderShipY],
		)
	}
}

func TestProjectiles(t *testing.T) {
	t.Parallel()

	b := New()
	bullet := slices.Index(ProjectileKinds(), sim.ProjectileKind(sim.KlaedBullet))
	enemy := slices.Index(Factions(), sim.FactionEnemy)
	s := b.Spawn(bullet, enemy, 10, 20, 0, 0, 0.5, 0)
	if s < 0 || slot(b, s)[ProjectileKind] != float64(bullet) || slot(b, s)[ProjectileAge] != 0.5 {
		t.Fatalf("spawned slot %d = %v, want a half-second-old bullet", s, slot(b, s))
	}
	if b.Spawn(99, 0, 0, 0, 0, 0, 0, 0) != -1 || b.Spawn(0, 9, 0, 0, 0, 0, 0, 0) != -1 {
		t.Error("spawned an unknown kind or faction")
	}
	remote := b.Spawn(0, slices.Index(Factions(), sim.FactionRemote), 0, 0, 0, 0, 0, 77)
	if slot(b, remote)[ProjectileShotID] != 77 {
		t.Errorf("remote shot id = %v, want 77", slot(b, remote)[ProjectileShotID])
	}

	b.Deactivate(remote)
	b.Clear(enemy)
	if slot(b, s)[ProjectileActive] != 0 || slot(b, remote)[ProjectileActive] != 0 {
		t.Error("cleared and deactivated projectiles are still active")
	}
	b.Deactivate(-1)
	b.Clear(-1)
}

func TestEnemyPattern(t *testing.T) {
	t.Parallel()

	b := New()
	fighter := slices.Index(sim.EnemyKinds(), sim.EnemyFighter)
	want := sim.EnemyPattern(sim.EnemyFighter, sim.Klaed, 100, 50, 1, 42)
	if n := b.EnemyPattern(fighter, 0, 100, 50, 1, 42); n != len(want) {
		t.Fatalf("EnemyPattern() = %d bullets, want %d", n, len(want))
	}
	if b.Scratch[0] != index(ProjectileKinds(), want[0].Kind) || b.Scratch[1] != want[0].X ||
		b.Scratch[3] != want[0].Angle {
		t.Errorf("bullet = %v, want %+v", b.Scratch[:4], want[0])
	}
	if b.EnemyPattern(9, 0, 0, 0, 0, 1) != 0 || b.EnemyPattern(fighter, 9, 0, 0, 0, 1) != 0 {
		t.Error("an unknown enemy kind or faction fired")
	}
	nautolan := slices.Index(sim.EnemyFactions(), sim.Nautolan)
	b.EnemyPattern(fighter, nautolan, 0, 0, 0, 1)
	spinning := index(ProjectileKinds(), sim.ProjectileKind(sim.NautolanSpinningBullet))
	if got := b.Scratch[0]; got != spinning {
		t.Errorf(
			"a Nautolan Fighter's bullet kind = %v, want the Spinning Bullet's %v",
			got,
			spinning,
		)
	}
	frigate := slices.Index(sim.EnemyKinds(), sim.EnemyFrigate)
	if got, want := b.EnemyPattern(frigate, 0, 0, 0, 0, 1), sim.FrigateRingBullets; got != want {
		t.Errorf("EnemyPattern(frigate) = %d bullets, want the whole ring of %d", got, want)
	}
}

func TestSetLoadout_ANewWeaponFiresAfterTheSwap(t *testing.T) {
	t.Parallel()

	b := New()
	b.Advance(
		sim.TickSeconds*3,
		sim.Command{AimY: -1000, Fire: true},
		sim.NoSquadmate,
		sim.NoSquadmate,
	)
	if b.State[HeaderShipCooldown] <= 0 || b.State[HeaderShipNextMuzzle] == 0 {
		t.Fatalf(
			"after firing: cooldown %v, next muzzle %v, want both set",
			b.State[HeaderShipCooldown],
			b.State[HeaderShipNextMuzzle],
		)
	}
	b.SetLoadout(slices.Index(sim.Weapons(), sim.WeaponRockets), -1, -1, 0, 0, 0)
	if b.State[HeaderShipCooldown] != sim.WeaponSwapSeconds || b.State[HeaderShipNextMuzzle] != 0 {
		t.Errorf(
			"new weapon: cooldown %v, next muzzle %v, want the swap's %v from its first barrel (#191)",
			b.State[HeaderShipCooldown],
			b.State[HeaderShipNextMuzzle],
			sim.WeaponSwapSeconds,
		)
	}
	// The same weapon again isn't a swap.
	b.SetLoadout(slices.Index(sim.Weapons(), sim.WeaponRockets), -1, -1, 1, 0, 0)
	if got, want := b.State[HeaderShipCooldown], sim.WeaponSwapSeconds; got != want {
		t.Errorf("same weapon at a new tier: cooldown %v, want it left at %v", got, want)
	}
}

func TestSetLoadout_ASwapNeverAddsCharges(t *testing.T) {
	t.Parallel()

	b := New()
	shield := func(id sim.ShieldID) int { return slices.Index(sim.Shields(), id) }
	round := sim.ShieldStatsOf(sim.ShieldRound).Strength
	b.SetLoadout(-1, -1, shield(sim.ShieldRound), 0, 0, 0)
	if got := b.State[HeaderShipShieldCharge]; got != round {
		t.Errorf("round shield charges = %v, want its strength %v", got, round)
	}
	b.SetLoadout(-1, -1, shield(sim.ShieldFront), 0, 0, 0)
	if got := b.State[HeaderShipShieldCharge]; got != round {
		t.Errorf("front shield after round = %v charges, want the %v left", got, round)
	}
}

// body writes a body into b's Scratch at index i for Bump, on side +1.
func body(b *Bridge, i int, o sim.Body, key float64) {
	copy(b.Scratch[i*BumpSize:], []float64{o.X, o.Y, o.Radius, o.VX, o.VY, key, 1})
}

func TestBump_PushesTheShipOut(t *testing.T) {
	t.Parallel()

	b := New()
	x, y := b.State[HeaderShipX], b.State[HeaderShipY]
	body(b, 0, sim.Body{X: x + 20, Y: y, Radius: sim.ShipRadius}, 1)
	body(b, 1, sim.Body{X: x + 500, Y: y, Radius: sim.ShipRadius}, 2)
	if rams := b.Bump(2); rams != 0 {
		t.Errorf("Bump() = %d rams, want 0 for a ship at rest", rams)
	}
	if got, want := b.State[HeaderShipX], x-4; math.Abs(got-want) > 1e-9 {
		t.Errorf("ship x = %v, want %v, just out of the body", got, want)
	}
	if got, want := b.State[HeaderPreviousX], x-4; math.Abs(got-want) > 1e-9 {
		t.Errorf("previous x = %v, want %v, moved with the push", got, want)
	}
}

func TestBump_ARamHurtsOncePerCooldown(t *testing.T) {
	t.Parallel()

	b := New()
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
	x, y := b.State[HeaderShipX], b.State[HeaderShipY]
	// A body rushing up into the ship from behind, where the front shield doesn't cover.
	ram := func() int {
		body(b, 0, sim.Body{X: x, Y: y + 20, Radius: sim.ShipRadius, VY: -sim.RammingSpeed}, 7)

		return b.Bump(1)
	}
	if rams := ram(); rams != 1 || b.Hits[0] != 0 || b.Hits[1] != 0 {
		t.Fatalf("Bump() = %d rams, hits %v, want one on body 0, not absorbed", rams, b.Hits[:2])
	}
	if got := b.State[HeaderShipDamage]; got != 1 {
		t.Errorf("damage after a ram from behind = %v, want 1", got)
	}
	if rams := ram(); rams != 0 {
		t.Errorf("a second ram at once = %d rams, want 0 within the cooldown", rams)
	}
	for range int(sim.RammingCooldown*sim.TickRate) + 1 {
		b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
	}
	x, y = b.State[HeaderShipX], b.State[HeaderShipY]
	if rams := ram(); rams != 1 {
		t.Errorf("a ram after the cooldown = %d rams, want 1", rams)
	}
}

func TestBump_ClampsN(t *testing.T) {
	t.Parallel()

	b := New()
	if got := b.Bump(-1); got != 0 {
		t.Errorf("Bump(-1) = %d, want 0", got)
	}
	if got := b.Bump(MaxTargets + 1); got != 0 {
		t.Errorf("Bump(MaxTargets+1) over an empty scratch = %d, want 0", got)
	}
}

func TestHitScan(t *testing.T) {
	t.Parallel()

	b := New()
	own, enemy := slices.Index(
		Factions(),
		sim.FactionOwn,
	), slices.Index(
		Factions(),
		sim.FactionEnemy,
	)
	hitting := b.Spawn(0, own, -20, 0, 0, 0, 0, 0)
	missing := b.Spawn(0, own, -20, 100, 0, 0, 0, 0)
	bullet := b.Spawn(4, enemy, -20, 0, 0, 0, 0, 0)
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
	copy(b.Scratch[:], []float64{0, 0, 10})

	if got := b.HitScan(own, sim.TickSeconds, 1); got != 1 {
		t.Fatalf("HitScan() = %d hits, want 1", got)
	}
	if b.Hits[0] != float64(hitting) || b.Hits[1] != 0 {
		t.Errorf("hit = (slot %v, target %v), want (%d, 0)", b.Hits[0], b.Hits[1], hitting)
	}
	if slot(b, hitting)[ProjectileActive] != 0 || slot(b, missing)[ProjectileActive] != 1 {
		t.Error("HitScan() didn't end just the hit")
	}
	if slot(b, bullet)[ProjectileActive] != 1 {
		t.Error("HitScan() for own shots ended an enemy bullet")
	}
	if b.HitScan(9, sim.TickSeconds, 1) != 0 {
		t.Error("an unknown faction hit something")
	}
}

func TestShipScan(t *testing.T) {
	t.Parallel()

	b := New()
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
	x, y, angle := b.State[HeaderShipX], b.State[HeaderShipY], b.State[HeaderShipAngle]
	enemy := slices.Index(Factions(), sim.FactionEnemy)
	kind := sim.ProjectileKind(sim.KlaedBullet)
	bullet := slices.Index(ProjectileKinds(), kind)
	// Flying down at the ship from 80 px above, now 5 px from its center:
	// on the way it met the front shield.
	age := 75 / sim.ProjectileStatsOf(kind).Speed
	slot := b.Spawn(bullet, enemy, x, y-80, math.Pi/2, 0, age, 0)
	b.Spawn(0, slices.Index(Factions(), sim.FactionOwn), x, y-80, math.Pi/2, 0, age, 0)
	copy(
		b.Scratch[:],
		[]float64{x, y, angle, float64(slices.Index(sim.Shields(), sim.ShieldFront)), 3},
	)

	if n := b.ShipScan(age, 1); n != 1 || b.Hits[0] != float64(slot) || b.Hits[1] != 0 {
		t.Fatalf("ShipScan() = %d, hits %v, want the enemy bullet on ship 0", n, b.Hits[:3])
	}
	if from := b.Hits[2]; math.Abs(from+math.Pi/2) > 1e-9 {
		t.Errorf("contact from %v, want -Pi/2, ahead", from)
	}
	if b.ShipScan(age, 1) != 0 {
		t.Error("an ended bullet hit again")
	}
	if b.ShipScan(age, -1) != 0 {
		t.Error("ShipScan() over no ships hit something")
	}
}

func TestTakeHit(t *testing.T) {
	t.Parallel()

	b := New()
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
	full := b.State[HeaderShipShieldCharge]
	if !b.TakeHit(-math.Pi/2, 0) || b.State[HeaderShipShieldCharge] != full-1 ||
		b.State[HeaderShipDamage] != 0 {
		t.Errorf(
			"hit ahead: shield %v, damage %v, want one charge less",
			b.State[HeaderShipShieldCharge],
			b.State[HeaderShipDamage],
		)
	}
	if b.TakeHit(math.Pi/2, 0) || b.State[HeaderShipDamage] != 1 ||
		b.State[HeaderShipSinceHit] != 0 {
		t.Errorf("hit from behind: damage %v, want the hull hit", b.State[HeaderShipDamage])
	}
}

func TestTakeHit_ATorpedoTakesTwoSteps(t *testing.T) {
	t.Parallel()

	for _, id := range []sim.EnemyBulletID{sim.KlaedTorpedo, sim.NairanTorpedo} {
		b := New()
		b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
		torpedo := slices.Index(ProjectileKinds(), sim.ProjectileKind(id))
		b.TakeHit(math.Pi/2, torpedo)
		if got, want := b.State[HeaderShipDamage], float64(sim.TorpedoHitSteps); got != want {
			t.Errorf("a %s from behind: damage %v, want %v", id, got, want)
		}
	}
}

func TestEnemyPattern_ABomberPairCurvesIn(t *testing.T) {
	t.Parallel()

	b := New()
	bomber := slices.Index(sim.EnemyKinds(), sim.EnemyBomber)
	nairan := slices.Index(sim.EnemyFactions(), sim.Nairan)
	want := sim.EnemyPattern(sim.EnemyBomber, sim.Nairan, 0, 0, 0, 1)
	if n := b.EnemyPattern(bomber, nairan, 0, 0, 0, 1); n != len(want) || n != 2 {
		t.Fatalf("EnemyPattern(bomber) = %d shots, want 2", n)
	}
	if b.Scratch[4] != want[0].Curve || b.Scratch[9] != want[1].Curve || want[0].Curve == 0 {
		t.Errorf(
			"curves = %v and %v, want %v and %v",
			b.Scratch[4],
			b.Scratch[9],
			want[0].Curve,
			want[1].Curve,
		)
	}
}

func TestAdvance_FormationBonus(t *testing.T) {
	t.Parallel()

	alone, together := New(), New()
	for _, b := range []*Bridge{alone, together} {
		b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
		b.TakeHit(-math.Pi/2, 0)
		// A frame covers at most a few ticks, so wait out the delay tick by tick.
		for range int(sim.ShieldRechargeDelay/sim.TickSeconds) + 1 {
			b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
		}
	}
	for range 30 {
		alone.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
		together.Advance(
			sim.TickSeconds,
			sim.Command{AimY: -1000},
			sim.FormationRadius,
			sim.NoSquadmate,
		)
	}
	if together.State[HeaderShipShieldCharge] <= alone.State[HeaderShipShieldCharge] {
		t.Errorf(
			"with a squadmate near: shield %v, alone %v, want faster",
			together.State[HeaderShipShieldCharge],
			alone.State[HeaderShipShieldCharge],
		)
	}
}

func TestRespawn(t *testing.T) {
	t.Parallel()

	b := New()
	if b.Respawn(0, 0) {
		t.Fatal("a ship that is up respawned")
	}
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
	for range sim.MaxDamage {
		b.TakeHit(math.Pi/2, 0)
	}
	if b.Respawn(0, 0) {
		t.Fatal("respawned the moment it went down")
	}
	for range int(sim.RespawnDelay/sim.TickSeconds) + 1 {
		b.Advance(sim.TickSeconds, sim.Command{}, sim.NoSquadmate, sim.NoSquadmate)
	}
	if got := b.State[HeaderShipDownFor]; got < sim.RespawnDelay {
		t.Fatalf("down for %v s, want at least %v", got, sim.RespawnDelay)
	}
	if !b.Respawn(0, sim.HomeSpawnY) {
		t.Fatal("couldn't respawn after the delay")
	}
	if b.State[HeaderShipDamage] != 0 || b.State[HeaderShipDownFor] != 0 ||
		b.State[HeaderShipY] != sim.HomeSpawnY || b.State[HeaderPreviousY] != sim.HomeSpawnY {
		t.Errorf(
			"respawned: damage %v, down for %v, y %v, previous y %v; want whole at home",
			b.State[HeaderShipDamage], b.State[HeaderShipDownFor],
			b.State[HeaderShipY], b.State[HeaderPreviousY],
		)
	}
}

func TestAdvance_AFriendNearRevives(t *testing.T) {
	t.Parallel()

	b := New()
	for range sim.MaxDamage {
		b.TakeHit(math.Pi/2, 0)
	}
	for range int(sim.ReviveSeconds/sim.TickSeconds) / 2 {
		b.Advance(sim.TickSeconds, sim.Command{}, sim.NoSquadmate, 20)
	}
	if got := b.State[HeaderShipRevive]; got < 0.4 || got > 0.6 {
		t.Errorf("revive after half the time with a friend near = %v, want about 0.5", got)
	}
}

func TestBump_AGentleBodyOnlyPushes(t *testing.T) {
	t.Parallel()

	b := New()
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate, sim.NoSquadmate)
	x, y := b.State[HeaderShipX], b.State[HeaderShipY]
	body(b, 0, sim.Body{X: x, Y: y + 20, Radius: sim.ShipRadius, VY: -2 * sim.RammingSpeed}, 3)
	b.Scratch[BumpSize-1] = 1
	if rams := b.Bump(1); rams != 0 || b.State[HeaderShipDamage] != 0 {
		t.Errorf(
			"a gentle body rushing in: %d rams, damage %v; want a push only",
			rams,
			b.State[HeaderShipDamage],
		)
	}
	if b.State[HeaderShipY] >= y {
		t.Errorf("ship y %v, want pushed up from %v", b.State[HeaderShipY], y)
	}
}

// target writes a HitScan target into b's Scratch at index i.
func target(b *Bridge, i int, x, y, radius float64, id int) {
	copy(b.Scratch[i*4:], []float64{x, y, radius, float64(id)})
}

func TestHitScan_AZapperShotPierces(t *testing.T) {
	t.Parallel()

	b := New()
	own := slices.Index(Factions(), sim.FactionOwn)
	zapper := slices.Index(ProjectileKinds(), sim.ProjectileKind(sim.WeaponZapper))
	slot := b.Spawn(zapper, own, 0, 0, 0, 0, 0.2, 0)
	// Three enemies in a row along its path, and a fourth.
	for i, id := range []int{11, 12, 13, 14} {
		target(b, i, 0, 0, 200, id)
	}
	var carriesOn []float64
	for range 4 {
		if b.HitScan(own, 0.2, 4) == 1 {
			carriesOn = append(carriesOn, b.Hits[2])
		}
	}
	if !slices.Equal(carriesOn, []float64{1, 1, 0}) {
		t.Errorf("zapper hits carried on %v, want through two and ending on the third", carriesOn)
	}
	if b.State[PoolOffset+slot*ProjectileSize+ProjectileActive] != 0 {
		t.Error("the zapper shot is still flying after its last pierce")
	}
}

func TestSteer_ARocketTurns(t *testing.T) {
	t.Parallel()

	b := New()
	own := slices.Index(Factions(), sim.FactionOwn)
	rocket := slices.Index(ProjectileKinds(), sim.ProjectileKind(sim.WeaponRockets))
	slot := b.Spawn(rocket, own, 0, 0, 0, 0, 0, 0)
	target(b, 0, 200, -100, 10, 1)
	b.Steer(own, sim.TickSeconds, 1)
	if angle := b.State[PoolOffset+slot*ProjectileSize+ProjectileAngle]; angle >= 0 {
		t.Errorf(
			"rocket angle %v after steering toward an enemy up and ahead, want turned up (negative)",
			angle,
		)
	}
	b.Steer(99, sim.TickSeconds, 1)
}

func TestBurst(t *testing.T) {
	t.Parallel()

	b := New()
	for i, r := range utf16.Encode([]rune("sanne")) {
		b.Scratch[i] = float64(r)
	}
	seed := b.BurstSeed(5, 7)
	if want := sim.BurstSeed("sanne", 7); seed != want {
		t.Fatalf("BurstSeed() = %d, want %d, the sim's", seed, want)
	}
	gun := slices.Index(sim.Weapons(), sim.WeaponBigSpaceGun)
	remote := slices.Index(Factions(), sim.FactionRemote)
	n := b.Burst(gun, remote, 10, 20, 7, seed, -1)
	if n != sim.WeaponStatsOf(sim.WeaponBigSpaceGun).Burst.Shards {
		t.Fatalf("Burst() = %d shards, want the gun's", n)
	}
	for k := range n {
		at := b.State[PoolOffset+int(b.Scratch[k])*ProjectileSize:]
		if at[ProjectileActive] != 1 || at[ProjectileShotID] != 7 ||
			at[ProjectileShard] != float64(k+1) {
			t.Errorf(
				"shard %d in slot %v: %v, want active, shot 7, shard %d",
				k,
				b.Scratch[k],
				at[:ProjectileSize],
				k+1,
			)
		}
	}
	if b.Burst(99, remote, 0, 0, 1, seed, -1) != 0 {
		t.Error("an unknown weapon burst")
	}
}

func TestBurst_ShardsPassTheEnemyTheBallHit(t *testing.T) {
	t.Parallel()

	b := New()
	own := slices.Index(Factions(), sim.FactionOwn)
	gun := slices.Index(ProjectileKinds(), sim.ProjectileKind(sim.WeaponBigSpaceGun))
	ball := b.Spawn(gun, own, 0, 0, 0, 0, 0.1, 0)
	target(b, 0, 0, 0, 40, 5)
	if b.HitScan(own, 0.1, 1) != 1 {
		t.Fatal("the ball missed the enemy it sits in")
	}
	b.Burst(slices.Index(sim.Weapons(), sim.WeaponBigSpaceGun), own, 0, 0, 1, 1, ball)
	b.Advance(sim.TickSeconds, sim.Command{}, sim.NoSquadmate, sim.NoSquadmate)
	target(b, 0, 0, 0, 40, 5)
	if hits := b.HitScan(own, sim.TickSeconds, 1); hits != 0 {
		t.Errorf("%d shards hit the enemy the ball struck, want none: they fly out past it", hits)
	}
}

func TestFrontier_StopsTheShipAtAClosedRing(t *testing.T) {
	t.Parallel()

	d3Top := -3 * sim.SectorApothem
	fly := func(b *Bridge) float64 {
		b.PlaceShip(0, d3Top+50)
		for range 60 {
			cmd := sim.Command{MoveY: -1, AimY: b.State[HeaderShipY] - 1000}
			b.Advance(sim.TickSeconds, cmd, sim.NoSquadmate, sim.NoSquadmate)
		}

		return b.State[HeaderShipY]
	}

	b := New()
	b.SetFrontier(1)
	if y := fly(b); y < d3Top {
		t.Errorf("with ring 2 closed: ship at y %v, want it kept below D3's top at %v", y, d3Top)
	}
	b.OpenSector(0, -2)
	if y := fly(b); y > d3Top {
		t.Errorf("with D2 opened on its own: ship at y %v, want it through into D2", y)
	}
	b.SetFrontier(0)
	if y := fly(b); y > d3Top {
		t.Errorf("with every ring open: ship at y %v, want it through into D2", y)
	}
}
