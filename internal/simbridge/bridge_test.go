package simbridge_test

import (
	"math"
	"slices"
	"testing"

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
	b.Advance(sim.TickSeconds*3, sim.Command{MoveY: -1, AimY: -1000, Fire: true}, sim.NoSquadmate)
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
	b.SetLoadout(slices.Index(sim.Weapons(), sim.WeaponBigSpaceGun), -1, -1)
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000, Fire: true}, sim.NoSquadmate)
	if b.State[HeaderCharges] != 1 ||
		b.State[ChargesOffset] != index(sim.Weapons(), sim.WeaponBigSpaceGun) {
		t.Errorf("charges = %v, want the big space gun's", b.State[HeaderCharges])
	}

	b = New()
	b.Spawn(0, 0, 0, 0, 0, 10, 0)
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate)
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
	b.SetLoadout(1, 2, 3)
	if b.State[HeaderShipWeapon] != 1 || b.State[HeaderShipEngine] != 2 ||
		b.State[HeaderShipShield] != 3 {
		t.Errorf("loadout = %v, want 1 2 3", b.State[HeaderShipWeapon:HeaderShipShield+1])
	}
	b.SetLoadout(9, -1, 0)
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
		b.Advance(sim.TickSeconds, sim.Command{MoveY: -1, AimX: 10_000, AimY: 160}, sim.NoSquadmate)
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
	s := b.Spawn(bullet, enemy, 10, 20, 0, 0.5, 0)
	if s < 0 || slot(b, s)[ProjectileKind] != float64(bullet) || slot(b, s)[ProjectileAge] != 0.5 {
		t.Fatalf("spawned slot %d = %v, want a half-second-old bullet", s, slot(b, s))
	}
	if b.Spawn(99, 0, 0, 0, 0, 0, 0) != -1 || b.Spawn(0, 9, 0, 0, 0, 0, 0) != -1 {
		t.Error("spawned an unknown kind or faction")
	}
	remote := b.Spawn(0, slices.Index(Factions(), sim.FactionRemote), 0, 0, 0, 0, 77)
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
	want := sim.EnemyPattern(sim.EnemyFighter, 100, 50, 1, 42)
	if n := b.EnemyPattern(fighter, 100, 50, 1, 42); n != len(want) {
		t.Fatalf("EnemyPattern() = %d bullets, want %d", n, len(want))
	}
	if b.Scratch[0] != index(ProjectileKinds(), want[0].Kind) || b.Scratch[1] != want[0].X ||
		b.Scratch[3] != want[0].Angle {
		t.Errorf("bullet = %v, want %+v", b.Scratch[:4], want[0])
	}
	if b.EnemyPattern(9, 0, 0, 0, 1) != 0 {
		t.Error("an unknown enemy kind fired")
	}
}

func TestSetLoadout_ANewWeaponStartsReady(t *testing.T) {
	t.Parallel()

	b := New()
	b.Advance(sim.TickSeconds*3, sim.Command{AimY: -1000, Fire: true}, sim.NoSquadmate)
	if b.State[HeaderShipCooldown] <= 0 || b.State[HeaderShipNextMuzzle] == 0 {
		t.Fatalf(
			"after firing: cooldown %v, next muzzle %v, want both set",
			b.State[HeaderShipCooldown],
			b.State[HeaderShipNextMuzzle],
		)
	}
	b.SetLoadout(slices.Index(sim.Weapons(), sim.WeaponRockets), -1, -1)
	if b.State[HeaderShipCooldown] != 0 || b.State[HeaderShipNextMuzzle] != 0 {
		t.Errorf(
			"new weapon: cooldown %v, next muzzle %v, want ready",
			b.State[HeaderShipCooldown],
			b.State[HeaderShipNextMuzzle],
		)
	}
}

func TestSetLoadout_ASwapNeverAddsCharges(t *testing.T) {
	t.Parallel()

	b := New()
	shield := func(id sim.ShieldID) int { return slices.Index(sim.Shields(), id) }
	round := sim.ShieldStatsOf(sim.ShieldRound).Strength
	b.SetLoadout(-1, -1, shield(sim.ShieldRound))
	if got := b.State[HeaderShipShieldCharge]; got != round {
		t.Errorf("round shield charges = %v, want its strength %v", got, round)
	}
	b.SetLoadout(-1, -1, shield(sim.ShieldFront))
	if got := b.State[HeaderShipShieldCharge]; got != round {
		t.Errorf("front shield after round = %v charges, want the %v left", got, round)
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
	hitting := b.Spawn(0, own, -20, 0, 0, 0, 0)
	missing := b.Spawn(0, own, -20, 100, 0, 0, 0)
	bullet := b.Spawn(4, enemy, -20, 0, 0, 0, 0)
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate)
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
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate)
	x, y, angle := b.State[HeaderShipX], b.State[HeaderShipY], b.State[HeaderShipAngle]
	enemy := slices.Index(Factions(), sim.FactionEnemy)
	kind := sim.ProjectileKind(sim.KlaedBullet)
	bullet := slices.Index(ProjectileKinds(), kind)
	// Flying down at the ship from 80 px above, now 5 px from its center:
	// on the way it met the front shield.
	age := 75 / sim.ProjectileStatsOf(kind).Speed
	slot := b.Spawn(bullet, enemy, x, y-80, math.Pi/2, age, 0)
	b.Spawn(0, slices.Index(Factions(), sim.FactionOwn), x, y-80, math.Pi/2, age, 0)
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
	b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate)
	full := b.State[HeaderShipShieldCharge]
	if !b.TakeHit(-math.Pi/2) || b.State[HeaderShipShieldCharge] != full-1 ||
		b.State[HeaderShipDamage] != 0 {
		t.Errorf(
			"hit ahead: shield %v, damage %v, want one charge less",
			b.State[HeaderShipShieldCharge],
			b.State[HeaderShipDamage],
		)
	}
	if b.TakeHit(math.Pi/2) || b.State[HeaderShipDamage] != 1 || b.State[HeaderShipSinceHit] != 0 {
		t.Errorf("hit from behind: damage %v, want the hull hit", b.State[HeaderShipDamage])
	}
}

func TestAdvance_FormationBonus(t *testing.T) {
	t.Parallel()

	alone, together := New(), New()
	for _, b := range []*Bridge{alone, together} {
		b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate)
		b.TakeHit(-math.Pi / 2)
		// A frame covers at most a few ticks, so wait out the delay tick by tick.
		for range int(sim.ShieldRechargeDelay/sim.TickSeconds) + 1 {
			b.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate)
		}
	}
	for range 30 {
		alone.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.NoSquadmate)
		together.Advance(sim.TickSeconds, sim.Command{AimY: -1000}, sim.FormationRadius)
	}
	if together.State[HeaderShipShieldCharge] <= alone.State[HeaderShipShieldCharge] {
		t.Errorf(
			"with a squadmate near: shield %v, alone %v, want faster",
			together.State[HeaderShipShieldCharge],
			alone.State[HeaderShipShieldCharge],
		)
	}
}
