// Package simbridge lays the browser's part of the sim out as numbers: the
// player's ship, the projectiles and the frame's events, in one flat float64
// state, and ids as indexes. cmd/simwasm exports it to the browser through
// WebAssembly, where only numbers cross; keeping it here lets Go test it
// natively.
package simbridge

import (
	"math"
	"slices"

	"github.com/starquake/voidmarch/internal/sim"
)

// ProjectileCapacity is how many projectiles the browser's pool holds.
const ProjectileCapacity = 256

// Header offsets into State: the frame, then the player's ship.
const (
	HeaderTicks = iota
	HeaderAlpha
	HeaderShipX
	HeaderShipY
	HeaderShipVX
	HeaderShipVY
	HeaderShipAngle
	HeaderShipThrusting
	HeaderShipCooldown
	HeaderShipCharging
	HeaderShipNextMuzzle
	HeaderShipDamage
	HeaderShipRotationSnap
	HeaderShipWeapon
	HeaderShipEngine
	HeaderShipShield
	HeaderPreviousX
	HeaderPreviousY
	HeaderShots
	HeaderCharges
	HeaderExpired
	HeaderShipShieldCharge
	HeaderShipSinceHit
	HeaderShipDownFor
	HeaderShipRevive
	HeaderSize
)

// Fields of one projectile in State.
const (
	ProjectileActive = iota
	ProjectileKind
	ProjectileFaction
	ProjectileX
	ProjectileY
	ProjectileAngle
	ProjectileAge
	ProjectileShotID
	ProjectileSize
)

// Fields of one shot the ship fired this frame.
const (
	ShotID = iota
	ShotWeapon
	ShotMuzzle
	ShotX
	ShotY
	ShotAngle
	ShotSize
)

// Fields of one projectile that expired this frame.
const (
	ExpiredKind = iota
	ExpiredFaction
	ExpiredX
	ExpiredY
	ExpiredSize
)

// Limits on a frame's events: at most MaxTicksPerFrame ticks, and a volley
// of at most two muzzles per tick.
const (
	maxShots     = sim.MaxTicksPerFrame * 2
	maxCharges   = sim.MaxTicksPerFrame
	chargeSize   = 1
	patternKind  = 0
	patternX     = 1
	patternY     = 2
	patternAngle = 3
	patternSize  = 4
	maxPatterns  = 8
	targetSize   = 3
	// ShipTargetSize is the numbers per ship ShipScan reads: x, y, angle,
	// shield index and charges.
	ShipTargetSize = 5
	shipX          = 0
	shipY          = 1
	shipAngle      = 2
	shipShield     = 3
	shipCharges    = 4
	// hitTriple is the numbers per hit ShipScan writes.
	hitTriple = 3
	// MaxTargets is how many targets HitScan, ShipScan and Bump read from Scratch.
	MaxTargets = 128
	// BumpSize is the numbers per body Bump reads: x, y, radius, vx, vy, a
	// key naming it for the ram cooldown, the side it pushes the ship to when
	// they sit on the same point, and 1 when it only pushes, never rams (the
	// player's own companions, #68).
	BumpSize   = 8
	bumpX      = 0
	bumpY      = 1
	bumpRadius = 2
	bumpVX     = 3
	bumpVY     = 4
	bumpKey    = 5
	bumpSide   = 6
	bumpGentle = 7
	// ScratchSize is the numbers Scratch holds, enough for the largest use.
	ScratchSize = MaxTargets * BumpSize
)

// Offsets of the sections of State.
const (
	PoolOffset    = HeaderSize
	ShotsOffset   = PoolOffset + ProjectileCapacity*ProjectileSize
	ChargesOffset = ShotsOffset + maxShots*ShotSize
	ExpiredOffset = ChargesOffset + maxCharges*chargeSize
	StateSize     = ExpiredOffset + ProjectileCapacity*ExpiredSize
)

// Bridge is the browser's sim with its state laid out as numbers.
type Bridge struct {
	sandbox *sim.Sandbox
	// State is rewritten after every change, for the browser to read.
	State [StateSize]float64
	// Scratch passes a call's extra numbers both ways: hit targets in, a
	// position or an enemy pattern out.
	Scratch [ScratchSize]float64
	// Hits is HitScan's answer, pairs of (slot, target index), ShipScan's,
	// triples of (slot, ship index, direction of the contact), and Bump's,
	// pairs of (body index, 1 when the shield took the ram).
	Hits [ProjectileCapacity * hitTriple]float64
	// clock is the seconds the sandbox has run, for the ram cooldown.
	clock float64
	rams  sim.Rams[float64]
}

// New returns a bridge around a fresh sandbox, its state already written.
func New() *Bridge {
	b := &Bridge{sandbox: sim.NewSandbox()}
	b.write(sim.FrameEvents{})

	return b
}

// Advance runs the frame with the input as a command, like
// [sim.Sandbox.Advance], and writes the state. squadmateDistance is how far
// the nearest squadmate that is up is, for the shield's formation bonus and
// revives, and friendDistance the nearest friendly ship that is up.
func (b *Bridge) Advance(
	frameSeconds float64,
	cmd sim.Command,
	squadmateDistance, friendDistance float64,
) {
	b.sandbox.SquadmateDistance = squadmateDistance
	b.sandbox.FriendDistance = friendDistance
	events := b.sandbox.AdvanceCommand(frameSeconds, cmd)
	b.clock += float64(events.Ticks) * sim.TickSeconds
	b.write(events)
}

// Bump pushes the ship out of the n bodies in Scratch (BumpSize numbers
// each) and applies a hit for each ram, from the rammed body's side. It
// writes (body index, 1 when the shield took it) pairs into Hits and
// returns how many rams there were.
func (b *Bridge) Bump(n int) int {
	n = min(max(n, 0), MaxTargets)
	ship := b.sandbox.Ship
	before := sim.Vec{X: ship.X, Y: ship.Y}
	rams := 0
	for i := range n {
		at := b.Scratch[i*BumpSize:]
		other := sim.Body{
			X:      at[bumpX],
			Y:      at[bumpY],
			Radius: at[bumpRadius],
			VX:     at[bumpVX],
			VY:     at[bumpVY],
		}
		c, ok := sim.Touching(sim.ShipBody(ship), other, at[bumpSide])
		if !ok {
			continue
		}
		ship.MoveTo(sim.Apart(sim.ShipBody(ship), c, 1))
		if at[bumpGentle] != 0 || !c.Hurts() || !b.rams.Ready(at[bumpKey], b.clock) {
			continue
		}
		b.Hits[rams*2], b.Hits[rams*2+1] = float64(i), boolFloat(sim.TakeHit(ship, c.From()))
		rams++
	}
	b.rams.Forget(b.clock)
	// Drawing blends from Previous: move it along, so the push shows at once.
	b.sandbox.Previous.X += ship.X - before.X
	b.sandbox.Previous.Y += ship.Y - before.Y
	b.write(sim.FrameEvents{})

	return rams
}

// TakeHit applies a hit on the ship from direction from, as ShipScan
// reports it, and reports whether the shield absorbed it.
func (b *Bridge) TakeHit(from float64) bool {
	absorbed := sim.TakeHit(b.sandbox.Ship, from)
	b.write(sim.FrameEvents{})

	return absorbed
}

// SetControlMode sets how WASD maps to movement.
func (b *Bridge) SetControlMode(mode sim.ControlMode) {
	b.sandbox.ControlMode = mode
}

// PlaceShip puts the ship at (x, y) at rest, as a spawn or a takeover does.
func (b *Bridge) PlaceShip(x, y float64) {
	s := b.sandbox.Ship
	s.X, s.Y, s.VX, s.VY = x, y, 0, 0
	b.sandbox.Previous = sim.Vec{X: x, Y: y}
	b.write(sim.FrameEvents{})
}

// Respawn brings a downed ship back at (x, y) with a whole hull and a full
// shield, once its player may, and reports whether it did.
func (b *Bridge) Respawn(x, y float64) bool {
	s := b.sandbox.Ship
	if !sim.CanRespawn(s) {
		return false
	}
	sim.Respawn(s, x, y)
	b.sandbox.Previous = sim.Vec{X: x, Y: y}
	b.write(sim.FrameEvents{})

	return true
}

// SetLoadout fits the parts at the indexes of [sim.Weapons], [sim.Engines]
// and [sim.Shields]; an index out of range keeps that part. A new weapon
// starts ready.
func (b *Bridge) SetLoadout(weapon, engine, shield int) {
	s := b.sandbox.Ship
	l := &s.Loadout
	if next := pick(sim.Weapons(), weapon, l.Weapon); next != l.Weapon {
		// A new weapon starts ready, from its first barrel.
		l.Weapon = next
		s.Cooldown, s.Charging, s.NextMuzzle = 0, 0, 0
	}
	l.Engine = pick(sim.Engines(), engine, l.Engine)
	l.Shield = pick(sim.Shields(), shield, l.Shield)
	// A swap never adds charges: the new shield holds what's left, up to its strength.
	s.Shield = math.Min(s.Shield, sim.ShieldStatsOf(l.Shield).Strength)
	b.write(sim.FrameEvents{})
}

// SetDamage sets the hits the ship has taken.
func (b *Bridge) SetDamage(damage int) {
	b.sandbox.Ship.Damage = damage
	b.write(sim.FrameEvents{})
}

// SetRotationSnap sets how many facing directions the ship snaps to; 0 is free.
func (b *Bridge) SetRotationSnap(steps int) {
	b.sandbox.Ship.RotationSnap = steps
	b.write(sim.FrameEvents{})
}

// Spawn starts a projectile of the kind at index kind of [ProjectileKinds],
// for the faction at index faction of [Factions], already age seconds old,
// and returns its slot, or -1 for an unknown kind or faction.
func (b *Bridge) Spawn(kind, faction int, x, y, angle, age float64, shotID int) int {
	kinds, factions := ProjectileKinds(), Factions()
	if kind < 0 || kind >= len(kinds) || faction < 0 || faction >= len(factions) {
		return -1
	}
	p := b.sandbox.Projectiles.Spawn(
		sim.ProjectileSpawn{Kind: kinds[kind], X: x, Y: y, Angle: angle},
		sim.SpawnOptions{AgeSeconds: age, Faction: factions[faction], ShotID: shotID},
	)
	b.write(sim.FrameEvents{})

	return b.slotOf(p)
}

// Deactivate ends the projectile in slot, as a hit does.
func (b *Bridge) Deactivate(slot int) {
	items := b.sandbox.Projectiles.Items()
	if slot >= 0 && slot < len(items) {
		items[slot].Active = false
		b.write(sim.FrameEvents{})
	}
}

// Clear ends every projectile of the faction at index faction of [Factions].
func (b *Bridge) Clear(faction int) {
	if factions := Factions(); faction >= 0 && faction < len(factions) {
		b.sandbox.Projectiles.Clear(factions[faction])
		b.write(sim.FrameEvents{})
	}
}

// HitScan tests every active projectile of the faction at index faction of
// [Factions] along the path it flew in the last stepSeconds against n targets
// in Scratch (x, y, radius each), ends the ones that hit, and writes (slot,
// target index) pairs into Hits. It returns how many hit: one call for a
// frame's hits instead of two per projectile.
func (b *Bridge) HitScan(faction int, stepSeconds float64, n int) int {
	factions := Factions()
	if faction < 0 || faction >= len(factions) {
		return 0
	}
	n = min(max(n, 0), MaxTargets)
	targets := make([]sim.Target[int], n)
	for i := range n {
		at := b.Scratch[i*targetSize:]
		targets[i] = sim.Target[int]{ID: i, X: at[0], Y: at[1], Radius: at[2]}
	}
	hits := 0
	items := b.sandbox.Projectiles.Items()
	for slot := range items {
		p := &items[slot]
		if !p.Active || p.Faction != factions[faction] {
			continue
		}
		from := sim.PositionAt(p, max(0, p.Age-stepSeconds))
		target, ok := sim.HitTargetAlong(from.X, from.Y, p.X, p.Y, targets)
		if !ok {
			continue
		}
		p.Active = false
		b.Hits[hits*2], b.Hits[hits*2+1] = float64(slot), float64(target.ID)
		hits++
	}
	if hits > 0 {
		b.write(sim.FrameEvents{})
	}

	return hits
}

// ShipScan tests every active enemy bullet along the path it flew in the
// last stepSeconds against n ships in Scratch (ShipTargetSize numbers each),
// a charged shield's arc before the hull, and ends the ones that hit. It
// writes (slot, ship index, direction of the contact) triples into Hits for
// TakeHit, and returns how many hit.
func (b *Bridge) ShipScan(stepSeconds float64, n int) int {
	n = min(max(n, 0), MaxTargets)
	ships := make([]sim.ShipTarget, n)
	for i := range n {
		at := b.Scratch[i*ShipTargetSize:]
		ships[i] = sim.ShipTarget{
			X: at[shipX], Y: at[shipY], Angle: at[shipAngle],
			Shield:  pick(sim.Shields(), int(at[shipShield]), sim.ShieldFront),
			Charges: at[shipCharges],
		}
	}
	hits := 0
	items := b.sandbox.Projectiles.Items()
	for slot := range items {
		p := &items[slot]
		if !p.Active || p.Faction != sim.FactionEnemy {
			continue
		}
		from := sim.PositionAt(p, max(0, p.Age-stepSeconds))
		ship, direction, ok := sim.FirstShipHit(ships, from.X, from.Y, p.X, p.Y)
		if !ok {
			continue
		}
		p.Active = false
		at := b.Hits[hits*hitTriple:]
		at[0], at[1], at[2] = float64(slot), float64(ship), direction
		hits++
	}
	if hits > 0 {
		b.write(sim.FrameEvents{})
	}

	return hits
}

// EnemyPattern writes the bullets of an enemy's volley into Scratch (kind
// index, x, y, angle each) and returns how many there are.
func (b *Bridge) EnemyPattern(kind int, x, y, angle float64, seed uint32) int {
	enemies := sim.EnemyKinds()
	if kind < 0 || kind >= len(enemies) {
		return 0
	}
	bullets := sim.EnemyPattern(enemies[kind], x, y, angle, seed)
	n := min(len(bullets), maxPatterns)
	for i, bullet := range bullets[:n] {
		at := b.Scratch[i*patternSize:]
		at[patternKind] = float64(slices.Index(ProjectileKinds(), bullet.Kind))
		at[patternX], at[patternY], at[patternAngle] = bullet.X, bullet.Y, bullet.Angle
	}

	return n
}

func (b *Bridge) slotOf(p *sim.Projectile) int {
	items := b.sandbox.Projectiles.Items()
	for i := range items {
		if &items[i] == p {
			return i
		}
	}

	return -1
}

// write lays the sandbox and the frame's events out in State.
func (b *Bridge) write(events sim.FrameEvents) {
	s, st := b.sandbox.Ship, &b.State
	st[HeaderTicks] = float64(events.Ticks)
	st[HeaderAlpha] = b.sandbox.Alpha()
	st[HeaderShipX], st[HeaderShipY] = s.X, s.Y
	st[HeaderShipVX], st[HeaderShipVY] = s.VX, s.VY
	st[HeaderShipAngle] = s.Angle
	st[HeaderShipThrusting] = boolFloat(s.Thrusting)
	st[HeaderShipCooldown], st[HeaderShipCharging] = s.Cooldown, s.Charging
	st[HeaderShipNextMuzzle] = float64(s.NextMuzzle)
	st[HeaderShipDamage] = float64(s.Damage)
	st[HeaderShipRotationSnap] = float64(s.RotationSnap)
	st[HeaderShipWeapon] = float64(slices.Index(sim.Weapons(), s.Loadout.Weapon))
	st[HeaderShipEngine] = float64(slices.Index(sim.Engines(), s.Loadout.Engine))
	st[HeaderShipShield] = float64(slices.Index(sim.Shields(), s.Loadout.Shield))
	st[HeaderPreviousX], st[HeaderPreviousY] = b.sandbox.Previous.X, b.sandbox.Previous.Y
	st[HeaderShipShieldCharge], st[HeaderShipSinceHit] = s.Shield, s.SinceHit
	st[HeaderShipDownFor], st[HeaderShipRevive] = s.DownFor, s.Revive

	kinds, factions := ProjectileKinds(), Factions()
	for i, p := range b.sandbox.Projectiles.Items() {
		at := st[PoolOffset+i*ProjectileSize:]
		at[ProjectileActive] = boolFloat(p.Active)
		at[ProjectileKind] = float64(slices.Index(kinds, p.Kind))
		at[ProjectileFaction] = float64(slices.Index(factions, p.Faction))
		at[ProjectileX], at[ProjectileY] = p.X, p.Y
		at[ProjectileAngle], at[ProjectileAge] = p.Angle, p.Age
		at[ProjectileShotID] = float64(p.ShotID)
	}

	shots := events.Shots[:min(len(events.Shots), maxShots)]
	st[HeaderShots] = float64(len(shots))
	for i, shot := range shots {
		at := st[ShotsOffset+i*ShotSize:]
		at[ShotID] = float64(shot.ID)
		at[ShotWeapon] = float64(slices.Index(sim.Weapons(), shot.Weapon))
		at[ShotMuzzle] = float64(shot.Muzzle)
		at[ShotX], at[ShotY], at[ShotAngle] = shot.X, shot.Y, shot.Angle
	}
	charges := events.Charges[:min(len(events.Charges), maxCharges)]
	st[HeaderCharges] = float64(len(charges))
	for i, weapon := range charges {
		st[ChargesOffset+i] = float64(slices.Index(sim.Weapons(), weapon))
	}
	expired := events.Expired[:min(len(events.Expired), ProjectileCapacity)]
	st[HeaderExpired] = float64(len(expired))
	for i, e := range expired {
		at := st[ExpiredOffset+i*ExpiredSize:]
		at[ExpiredKind] = float64(slices.Index(kinds, e.Kind))
		at[ExpiredFaction] = float64(slices.Index(factions, e.Faction))
		at[ExpiredX], at[ExpiredY] = e.X, e.Y
	}
}

// ProjectileKinds are the projectile kinds in index order: the weapons, then
// the enemy bullets.
func ProjectileKinds() []sim.ProjectileKind {
	var out []sim.ProjectileKind
	for _, w := range sim.Weapons() {
		out = append(out, sim.ProjectileKind(w))
	}

	return append(out, sim.ProjectileKind(sim.KlaedBullet), sim.ProjectileKind(sim.KlaedBigBullet))
}

// Factions are the factions in index order.
func Factions() []sim.Faction {
	return []sim.Faction{sim.FactionOwn, sim.FactionRemote, sim.FactionEnemy}
}

func pick[T any](list []T, i int, keep T) T {
	if i < 0 || i >= len(list) {
		return keep
	}

	return list[i]
}

func boolFloat(b bool) float64 { //nolint:revive // a conversion to a number, not a mode.
	if b {
		return 1
	}

	return 0
}
