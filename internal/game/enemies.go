package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// Stragglers, in world pixels and ticks. The view is 640x360 art pixels, so
// its half-diagonal is about 367: a straggler appears just outside it.
const (
	spawnMinDistance = 380
	spawnMaxDistance = 460
	spawnAttempts    = 5
	nearRadius       = 500
	despawnRadius    = 800
	despawnAfter     = 30 * TickRate

	// safeRadius keeps enemies away from the home planet (docs/design.md,
	// section 8); they don't fire at players inside it either.
	safeRadius = 300

	// maxHitDamage caps a reported hit at the strongest weapon's damage.
	maxHitDamage = 12

	// fireWarning is how long an enemy's weapon animates before its bullets
	// leave, so every shot is telegraphed (docs/design.md, section 3).
	fireWarning = 6

	scoutWander   = 60
	wanderEvery   = TickRate / 2
	strafeFlip    = 1.0 / 80
	fireJitter    = TickRate / 2
	strafeRight   = 1.0
	idleDamping   = 0.96
	tickDuration  = 1.0 / TickRate
	fullTurnFloat = 2 * math.Pi
)

// Enemy stats: speeds in px/s, accelerations in px/s^2, distances in px.
const (
	scoutHP           = 2
	scoutMaxSpeed     = 150
	scoutAcceleration = 400
	scoutFireEvery    = 5 * TickRate / 2
	scoutKeepDistance = 90

	fighterHP           = 6
	fighterMaxSpeed     = 95
	fighterAcceleration = 250
	fighterFireEvery    = 2 * TickRate
	fighterKeepDistance = 170

	// The Bomber keeps its distance, where its pair of shots cross (#137).
	bomberHP           = 10
	bomberMaxSpeed     = 60
	bomberAcceleration = 150
	bomberFireEvery    = 7 * TickRate / 2
	bomberKeepDistance = sim.BomberConverge

	torpedoHP           = 8
	torpedoMaxSpeed     = 80
	torpedoAcceleration = 200
	torpedoFireEvery    = 4 * TickRate
	torpedoKeepDistance = 260
	// torpedoWarning is how long a Torpedo Ship holds still, lined up,
	// before its Torpedo leaves; holdDamping slows it to a stop meanwhile.
	torpedoWarning = 3 * TickRate / 4
	holdDamping    = 0.5

	// aggroRange covers a straggler's whole spawn ring, so it comes for the
	// player it was sent at; a garrison engages anyone in its sector instead.
	aggroRange = nearRadius
	// fireRange stays inside the Scout's bullet reach (110 px/s for 3.2 s,
	// ENEMY_BULLET_STATS in frontend/src/sim/tuning.ts), so no shot falls short.
	fireRange = 340
)

type enemyStats struct {
	hp           int
	maxSpeed     float64
	acceleration float64
	// fireEvery is the ticks between patterns, give or take fireJitter.
	fireEvery    int
	aggroRange   float64
	keepDistance float64
}

// statsFor is a kind's stats, made tougher by its faction (#9 decision 14).
func statsFor(kind pb.EnemyKind, faction sim.EnemyFaction) enemyStats {
	stats := enemyStats{
		hp:           scoutHP,
		maxSpeed:     scoutMaxSpeed,
		acceleration: scoutAcceleration,
		fireEvery:    scoutFireEvery,
		aggroRange:   aggroRange,
		keepDistance: scoutKeepDistance,
	}
	switch kind {
	case pb.EnemyKind_ENEMY_KIND_FIGHTER:
		stats = enemyStats{
			hp:           fighterHP,
			maxSpeed:     fighterMaxSpeed,
			acceleration: fighterAcceleration,
			fireEvery:    fighterFireEvery,
			aggroRange:   aggroRange,
			keepDistance: fighterKeepDistance,
		}
	case pb.EnemyKind_ENEMY_KIND_BOMBER:
		stats = enemyStats{
			hp:           bomberHP,
			maxSpeed:     bomberMaxSpeed,
			acceleration: bomberAcceleration,
			fireEvery:    bomberFireEvery,
			aggroRange:   aggroRange,
			keepDistance: bomberKeepDistance,
		}
	case pb.EnemyKind_ENEMY_KIND_TORPEDO:
		stats = enemyStats{
			hp:           torpedoHP,
			maxSpeed:     torpedoMaxSpeed,
			acceleration: torpedoAcceleration,
			fireEvery:    torpedoFireEvery,
			aggroRange:   aggroRange,
			keepDistance: torpedoKeepDistance,
		}
	case pb.EnemyKind_ENEMY_KIND_SUPPORT:
		// No guns: fireEvery stays 0.
		stats = enemyStats{
			hp:           supportHP,
			maxSpeed:     supportMaxSpeed,
			acceleration: supportAcceleration,
			aggroRange:   aggroRange,
			keepDistance: supportBehind,
		}
	case pb.EnemyKind_ENEMY_KIND_UNSPECIFIED, pb.EnemyKind_ENEMY_KIND_SCOUT,
		pb.EnemyKind_ENEMY_KIND_FRIGATE, pb.EnemyKind_ENEMY_KIND_DREADNOUGHT:
		fallthrough
	default:
	}
	tougher := sim.FactionStats(faction)
	stats.hp = int(math.Round(float64(stats.hp) * tougher.Health))
	stats.fireEvery = int(math.Round(float64(stats.fireEvery) / tougher.Shots))

	return stats
}

type enemy struct {
	id      uint32
	kind    pb.EnemyKind
	faction sim.EnemyFaction
	x, y    float64
	vx, vy  float64
	angle   float64
	hp      int
	// maxHP is the hp it starts with, the most a Support Ship repairs it to.
	maxHP    int
	cooldown int
	lastNear uint32
	// strafe is the Fighter's sideways direction, +1 or -1.
	strafe float64
	// wanderX and wanderY offset the Scout's goal around its target.
	wanderX, wanderY float64
	// holdUntil is the tick a Torpedo Ship lined up for its shot holds
	// still until (#137).
	holdUntil uint32
	// flank is the side of its target a flanking faction's ship takes, and
	// dodgeUntil and dodgeAngle a dodging one's sidestep (#138).
	flank      float64
	dodgeUntil uint32
	dodgeAngle float64
	// frigate is a Frigate's fight, dread the Dreadnought's; nil for the rest.
	frigate *frigateFight
	dread   *dreadnoughtFight
	// garrison is the garrison it belongs to, which keeps it in its sector;
	// nil for stragglers and escorts (#99). post is the point a garrison
	// ship roams toward, or an escort's place around its Frigate (#121).
	garrison *garrison
	post     point
	// escortOf is the Frigate a Fighter guards, which keeps it from
	// despawning while that Frigate is there.
	escortOf uint32
	// leaving is set while a straggler flies off from downed ships, with
	// nobody up to fight (#166).
	leaving bool
	// repairing is the enemy a Support Ship repairs, 0 for none, and
	// repairIn the ticks until its next point (#184).
	repairing uint32
	repairIn  int
}

type point struct{ x, y float64 }

// stepEnemies runs one tick of the enemies: spawn, steer, fire, despawn.
func (h *Hub) stepEnemies() {
	quarries := h.quarries()
	players := quarryPoints(quarries)
	threats := h.threats()
	ships := h.upShips()
	online := h.onlineWeight()
	h.stepGarrisons(ships)
	h.spawnStragglers(players)
	h.spawnFrigates()
	h.closeRingsIfFallenBack()
	h.wakeDreadnought()
	h.stepRaids(ships)
	// In id order: steering draws from h.rng, so map order would make a
	// seeded hub differ between runs.
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		if e.frigate != nil {
			h.stepFrigate(e, ships, online)

			continue
		}
		if e.dread != nil {
			h.stepDreadnought(e, ships, online)

			continue
		}
		h.steer(e, quarries, threats)
		if _, guarding := h.enemies[e.escortOf]; guarding || e.garrison != nil {
			e.lastNear = h.tick
		}
		if h.tick-e.lastNear > despawnAfter || e.leaving && h.outOfView(e) {
			delete(h.enemies, id)
			h.forgetEnemy(id)
		}
	}
	h.stepRepairs()
}

// addEnemyOf adds an enemy of kind and faction at (x, y).
func (h *Hub) addEnemyOf(kind pb.EnemyKind, faction sim.EnemyFaction, x, y float64) *enemy {
	stats := statsFor(kind, faction)
	h.nextEnemy++
	strafe := strafeRight
	if h.rng.Uint32()&1 == 0 {
		strafe = -strafeRight
	}
	e := &enemy{
		id:       h.nextEnemy,
		kind:     kind,
		faction:  faction,
		x:        x,
		y:        y,
		hp:       stats.hp,
		maxHP:    stats.hp,
		cooldown: stats.fireEvery,
		lastNear: h.tick,
		strafe:   strafe,
	}
	if sim.FactionSmarts(faction).Flank {
		e.flank = h.rng.Float64() * fullTurnFloat
	}
	h.enemies[e.id] = e

	return e
}

// steer moves one enemy toward its role's goal around the ship it goes for,
// sidestepping shots if its faction dodges, and fires when its cooldown and
// range allow.
func (h *Hub) steer(e *enemy, quarries []quarry, threats []sim.Projectile) {
	stats := statsFor(e.kind, e.faction)
	if e.garrison != nil {
		quarries = slices.DeleteFunc(slices.Clone(quarries), func(q quarry) bool {
			return !e.garrison.sector.Contains(q.at.x, q.at.y)
		})
	}
	target, distance, found := pickQuarry(e, quarries, stats.aggroRange)
	if distance < despawnRadius {
		e.lastNear = h.tick
	}

	// A garrison engages anyone in its sector, and roams it otherwise (#121).
	engaged := found && (distance < stats.aggroRange || e.garrison != nil)
	// A Support Ship keeps behind its pack, and out of a fight without one.
	behind, backing := point{}, false
	if engaged && e.isSupport() {
		behind, backing = h.behindPack(e, target.at)
		engaged = backing
	}
	holding := h.tick < e.holdUntil
	if engaged && !holding {
		h.dodge(e, threats)
	}
	switch {
	case holding:
		e.vx *= holdDamping
		e.vy *= holdDamping
	case h.tick < e.dodgeUntil:
		accelerate(e, point{
			e.x + dodgeStep*math.Cos(e.dodgeAngle),
			e.y + dodgeStep*math.Sin(e.dodgeAngle),
		}, stats)
	case backing:
		accelerate(e, behind, stats)
	case engaged:
		accelerate(e, h.goal(e, target.at, stats), stats)
	case e.garrison != nil:
		if math.Hypot(e.post.x-e.x, e.post.y-e.y) <= postReach {
			e.post = h.roamPoint(e.garrison.sector, roamMargin)
		}
		accelerate(e, e.post, roaming(stats))
	case h.enemies[e.escortOf] != nil:
		f := h.enemies[e.escortOf]
		accelerate(e, point{f.x + e.post.x, f.y + e.post.y}, roaming(stats))
	default:
		e.leaving = h.flyOff(e, stats)
	}

	move(e)

	if holding {
		return
	}
	if !engaged || backing {
		faceTravel(e)

		return
	}
	h.aimAndFire(e, target, stats)
}

// move moves e on by its velocity for a tick, out of the safe zone, inside
// the world and, for a garrison ship, inside its sector.
func move(e *enemy) {
	e.x += e.vx * tickDuration
	e.y += e.vy * tickDuration
	keepOutOfSafeZone(e)
	e.x, e.y = sim.ClampToWorld(e.x, e.y, 0)
	if e.garrison != nil {
		keepInSector(e, e.garrison.sector)
	}
}

// aimAndFire aims e at target from where this tick's snapshot shows it, and
// fires when its cooldown and range allow.
func (h *Hub) aimAndFire(e *enemy, target quarry, stats enemyStats) {
	e.angle = aimAt(e, target)
	if e.cooldown > 0 {
		e.cooldown--
	}
	if e.cooldown <= 0 && math.Hypot(target.at.x-e.x, target.at.y-e.y) < fireRange {
		e.cooldown = stats.fireEvery + h.rng.IntN(2*fireJitter+1) - fireJitter
		h.fire(e)
	}
}

// goal is where the enemy wants to be: a Scout darts around near its target,
// a Fighter holds its distance and strafes, and a Bomber or a Torpedo Ship
// keeps its distance.
func (h *Hub) goal(e *enemy, target point, stats enemyStats) point {
	away := bearing(e, target)
	if e.kind == pb.EnemyKind_ENEMY_KIND_BOMBER || e.kind == pb.EnemyKind_ENEMY_KIND_TORPEDO {
		return point{
			x: target.x + stats.keepDistance*math.Cos(away),
			y: target.y + stats.keepDistance*math.Sin(away),
		}
	}
	if e.kind == pb.EnemyKind_ENEMY_KIND_FIGHTER {
		if h.rng.Float64() < strafeFlip {
			e.strafe = -e.strafe
		}
		sideways := away + e.strafe*quarterTurn
		const strafeStep = 60

		return point{
			x: target.x + stats.keepDistance*math.Cos(away) + strafeStep*math.Cos(sideways),
			y: target.y + stats.keepDistance*math.Sin(away) + strafeStep*math.Sin(sideways),
		}
	}

	if h.tick%wanderEvery == 0 {
		e.wanderX = (h.rng.Float64()*2 - 1) * scoutWander
		e.wanderY = (h.rng.Float64()*2 - 1) * scoutWander
	}

	return point{
		x: target.x + stats.keepDistance*math.Cos(away) + e.wanderX,
		y: target.y + stats.keepDistance*math.Sin(away) + e.wanderY,
	}
}

func accelerate(e *enemy, goal point, stats enemyStats) {
	dx, dy := goal.x-e.x, goal.y-e.y
	length := math.Hypot(dx, dy)
	if length > 0 {
		e.vx += dx / length * stats.acceleration * tickDuration
		e.vy += dy / length * stats.acceleration * tickDuration
	}
	if speed := math.Hypot(e.vx, e.vy); speed > stats.maxSpeed {
		e.vx *= stats.maxSpeed / speed
		e.vy *= stats.maxSpeed / speed
	}
}

// faceTravel turns an enemy that isn't aiming to where it's going (#121):
// roaming, following its Frigate, or drifting to a stop.
func faceTravel(e *enemy) {
	if math.Hypot(e.vx, e.vy) > minFacingSpeed {
		e.angle = math.Atan2(e.vy, e.vx)
	}
}

// turnToward is angle turned toward want by at most limit radians, the short
// way round.
func turnToward(angle, want, limit float64) float64 {
	d := sim.WrapAngle(want - angle)

	return sim.WrapAngle(angle + math.Max(-limit, math.Min(limit, d)))
}

// roaming is stats at the easy pace of a garrison ship roaming its sector.
func roaming(stats enemyStats) enemyStats {
	stats.maxSpeed *= roamSpeedShare
	stats.acceleration *= roamSpeedShare

	return stats
}

func keepOutOfSafeZone(e *enemy) {
	distance := math.Hypot(e.x, e.y)
	if distance >= safeRadius {
		return
	}
	if distance == 0 {
		e.x = safeRadius

		return
	}
	nx, ny := e.x/distance, e.y/distance
	e.x, e.y = nx*safeRadius, ny*safeRadius
	if inward := e.vx*nx + e.vy*ny; inward < 0 {
		e.vx -= inward * nx
		e.vy -= inward * ny
	}
}

func nearest(e *enemy, players []point) (target point, distance float64, found bool) {
	distance = math.Inf(1)
	for _, p := range players {
		if d := math.Hypot(p.x-e.x, p.y-e.y); d < distance {
			target, distance, found = p, d, true
		}
	}

	return target, distance, found
}

func (h *Hub) fire(e *enemy) {
	h.fireAt(e, e.angle, h.rng.Uint32())
}

// fireVolley fires the Dreadnought's volley along angle (#124).
func (h *Hub) fireVolley(e *enemy, angle float64, volley sim.DreadnoughtVolley) {
	h.fireAt(e, angle, sim.DreadnoughtSeed(h.rng.Uint32(), volley))
}

// fireAt fires e's pattern along angle with seed, after the warning; a
// Torpedo Ship holds still through its longer one.
func (h *Hub) fireAt(e *enemy, angle float64, seed uint32) {
	h.noteAttack(e)
	warning := uint32(fireWarning)
	if e.kind == pb.EnemyKind_ENEMY_KIND_TORPEDO {
		warning = torpedoWarning
		e.holdUntil = h.tick + warning
	}
	// The hub flies the bullets too, against its companions (#46).
	h.volleys = append(
		h.volleys,
		volley{tick: h.tick + warning, enemyID: e.id, angle: angle, seed: seed},
	)
	h.sendNear(
		e.id,
		&pb.ServerMessage{Kind: &pb.ServerMessage_EnemyFired{EnemyFired: &pb.EnemyFired{
			EnemyId:   e.id,
			Kind:      e.kind,
			Tick:      h.tick + warning,
			WarnTicks: warning,
			Faction:   pbEnemyFaction(e.faction),
			Seed:      seed,
			X:         float32(e.x),
			Y:         float32(e.y),
			Angle:     float32(angle),
		}}},
	)
}

// hit applies shooter's shot hitting enemyID: a player's, as their client
// reports it (except is that player, who ended it already), or a companion's,
// as the hub tests it. The shot ends everywhere else, and the enemy is
// destroyed once its hit points run out.
func (h *Hub) hit(except, shooter string, enemyID uint32, shot shotHit, damage uint32) {
	e, ok := h.enemies[enemyID]
	if !ok {
		return
	}
	// Shot 0 is a ram (#48), with no shot to end; a piercing shot that
	// carries on isn't over yet (#72).
	if shot.id != 0 && !shot.goesOn {
		h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_ShotEnded{ShotEnded: &pb.ShotEnded{
			PlayerId: shooter,
			ShotId:   shot.id,
			Shard:    shot.shard,
			Tick:     h.tick,
		}}}, except)
	}

	switch {
	case e.frigate != nil:
		e.hp -= e.frigate.takeHit(int(min(damage, maxHitDamage)), h.tick)
	case e.dread != nil:
		e.hp = e.dread.takeHit(shooter, int(min(damage, maxHitDamage)), h.tick)
	default:
		e.hp = damaged(e.hp, damage)
	}
	if e.dread != nil && e.dread.drivenOff() {
		h.driveOff(e)

		return
	}
	if e.hp > 0 {
		return
	}
	// Counted first: the finale's fall reports the season's stats.
	h.countKill(shooter)
	if e.frigate != nil {
		h.frigateDestroyed(e)
	}
	if e.dread != nil {
		h.dreadnoughtFallen(e)
	}
	delete(h.enemies, e.id)
	if e.garrison != nil {
		h.garrisonLost(e)
	}
	h.forgetEnemy(e.id)
	h.sendNear(
		e.id,
		&pb.ServerMessage{Kind: &pb.ServerMessage_EnemyDestroyed{EnemyDestroyed: &pb.EnemyDestroyed{
			EnemyId:    e.id,
			Kind:       e.kind,
			ByPlayerId: shooter,
			Tick:       h.tick,
			X:          float32(e.x),
			Y:          float32(e.y),
		}}},
	)
	h.dropPickup(e)
}

// shotHit names what hit: a shot by its id, or 0 for a ram; a shard of its
// burst, from 1; and whether a piercing shot carries on.
type shotHit struct {
	id, shard uint32
	goesOn    bool
}

// damaged is hp after a reported hit, capped at the strongest weapon's damage.
func damaged(hp int, damage uint32) int {
	return hp - int(min(damage, maxHitDamage))
}

func (h *Hub) enemySnapshot() []*pb.EnemyState {
	out := make([]*pb.EnemyState, 0, len(h.enemies))
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		state := &pb.EnemyState{
			EnemyId: e.id,
			Kind:    e.kind,
			Faction: pbEnemyFaction(e.faction),
			X:       float32(e.x),
			Y:       float32(e.y),
			Angle:   float32(e.angle),
			Vx:      float32(e.vx),
			Vy:      float32(e.vy),
		}
		// The ship it repairs can go down later in the tick, to a companion's shot.
		if _, ok := h.enemies[e.repairing]; ok {
			state.Repairing = e.repairing
		}
		if f := e.frigate; f != nil {
			state.Hp = float32(e.hp)
			state.MaxHp = float32(f.maxHP)
			state.Shield = float32(f.shield)
		}
		if d := e.dread; d != nil {
			state.Hp = float32(e.hp)
			state.MaxHp = float32(d.maxHP())
			state.Shield = float32(d.shield)
			if d.raid != nil {
				state.LeavesAt = float32(d.raid.floor * d.maxHP())
			}
		}
		out = append(out, state)
	}

	return out
}

// leaveStep is how far ahead a straggler flying off aims, away from the
// downed ship it leaves.
const leaveStep = 200

// flyOff turns a straggler with nobody up to fight away from the nearest
// downed player within despawnRadius, at its roaming speed, and reports
// whether it is leaving; with no downed player near it slows to a stop
// (#166).
func (h *Hub) flyOff(e *enemy, stats enemyStats) bool {
	from, found := point{}, false
	best := math.Inf(1)
	for _, m := range h.members {
		if m.gone || m.state == nil || !downed(m.state) {
			continue
		}
		p := point{float64(m.state.GetX()), float64(m.state.GetY())}
		if d := math.Hypot(e.x-p.x, e.y-p.y); d < best && d < despawnRadius {
			from, best, found = p, d, true
		}
	}
	if !found {
		e.vx *= idleDamping
		e.vy *= idleDamping

		return false
	}
	away := math.Atan2(e.y-from.y, e.x-from.x)
	accelerate(
		e,
		point{e.x + leaveStep*math.Cos(away), e.y + leaveStep*math.Sin(away)},
		roaming(stats),
	)

	return true
}

// outOfView reports whether e is farther than despawnRadius from every
// player, up or down.
func (h *Hub) outOfView(e *enemy) bool {
	for _, m := range h.members {
		if m.gone || m.state == nil {
			continue
		}
		if math.Hypot(e.x-float64(m.state.GetX()), e.y-float64(m.state.GetY())) <= despawnRadius {
			return false
		}
	}

	return true
}
