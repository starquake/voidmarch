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
	worldHalf  = sim.WorldHalfSize

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

func statsFor(kind pb.EnemyKind) enemyStats {
	if kind == pb.EnemyKind_ENEMY_KIND_FIGHTER {
		return enemyStats{
			hp:           fighterHP,
			maxSpeed:     fighterMaxSpeed,
			acceleration: fighterAcceleration,
			fireEvery:    fighterFireEvery,
			aggroRange:   aggroRange,
			keepDistance: fighterKeepDistance,
		}
	}

	return enemyStats{
		hp:           scoutHP,
		maxSpeed:     scoutMaxSpeed,
		acceleration: scoutAcceleration,
		fireEvery:    scoutFireEvery,
		aggroRange:   aggroRange,
		keepDistance: scoutKeepDistance,
	}
}

type enemy struct {
	id       uint32
	kind     pb.EnemyKind
	x, y     float64
	vx, vy   float64
	angle    float64
	hp       int
	cooldown int
	lastNear uint32
	// strafe is the Fighter's sideways direction, +1 or -1.
	strafe float64
	// wanderX and wanderY offset the Scout's goal around its target.
	wanderX, wanderY float64
	// frigate is a Frigate's fight; nil for the rest.
	frigate *frigateFight
	// garrison is the garrison it belongs to, which keeps it in its sector,
	// and post where it waits there; nil for stragglers and escorts (#99).
	garrison *garrison
	post     point
	// escortOf is the Frigate a Fighter guards, which keeps it from
	// despawning while that Frigate is there.
	escortOf uint32
}

type point struct{ x, y float64 }

// stepEnemies runs one tick of the enemies: spawn, steer, fire, despawn.
func (h *Hub) stepEnemies() {
	players := h.playersOutsideSafeZone()
	ships := h.upShips()
	h.stepGarrisons(ships)
	h.spawnStragglers(players)
	h.spawnFrigates()
	// In id order: steering draws from h.rng, so map order would make a
	// seeded hub differ between runs.
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		if e.frigate != nil {
			h.stepFrigate(e, ships)

			continue
		}
		h.steer(e, players)
		if _, guarding := h.enemies[e.escortOf]; guarding || e.garrison != nil {
			e.lastNear = h.tick
		}
		if h.tick-e.lastNear > despawnAfter {
			delete(h.enemies, id)
			h.forgetEnemy(id)
		}
	}
}

// playersOutsideSafeZone are the ships enemies target and stragglers come at:
// players and their companions alike, while they're up (#47).
func (h *Hub) playersOutsideSafeZone() []point {
	var out []point
	add := func(x, y float64) {
		if math.Hypot(x, y) > safeRadius {
			out = append(out, point{x, y})
		}
	}
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[id]
		if m.state != nil && !downed(m.state) {
			add(float64(m.state.GetX()), float64(m.state.GetY()))
		}
		for _, c := range m.wing.Companions {
			if !c.Ship.Downed() {
				add(c.Ship.X, c.Ship.Y)
			}
		}
	}

	return out
}

// addEnemyOf adds an enemy of kind at (x, y).
func (h *Hub) addEnemyOf(kind pb.EnemyKind, x, y float64) *enemy {
	stats := statsFor(kind)
	h.nextEnemy++
	strafe := strafeRight
	if h.rng.Uint32()&1 == 0 {
		strafe = -strafeRight
	}
	e := &enemy{
		id:       h.nextEnemy,
		kind:     kind,
		x:        x,
		y:        y,
		hp:       stats.hp,
		cooldown: stats.fireEvery,
		lastNear: h.tick,
		strafe:   strafe,
	}
	h.enemies[e.id] = e

	return e
}

// steer moves one enemy toward its role's goal around the nearest player,
// and fires when its cooldown and range allow.
func (h *Hub) steer(e *enemy, players []point) {
	stats := statsFor(e.kind)
	if e.garrison != nil {
		players = inSector(players, e.garrison.sector)
	}
	target, distance, found := nearest(e, players)
	if distance < despawnRadius {
		e.lastNear = h.tick
	}

	// A garrison engages anyone in its sector, and waits at its post otherwise.
	engaged := found && (distance < stats.aggroRange || e.garrison != nil)
	switch {
	case engaged:
		accelerate(e, h.goal(e, target, stats), stats)
	case e.garrison != nil && math.Hypot(e.post.x-e.x, e.post.y-e.y) > postReach:
		accelerate(e, e.post, stats)
	default:
		e.vx *= idleDamping
		e.vy *= idleDamping
	}

	e.x += e.vx * tickDuration
	e.y += e.vy * tickDuration
	keepOutOfSafeZone(e)
	e.x = math.Max(-worldHalf, math.Min(worldHalf, e.x))
	e.y = math.Max(-worldHalf, math.Min(worldHalf, e.y))
	if e.garrison != nil {
		keepInSector(e, e.garrison.sector)
	}

	if !engaged {
		return
	}
	// Aim and fire from where this tick's snapshot shows the enemy.
	e.angle = math.Atan2(target.y-e.y, target.x-e.x)
	if e.cooldown > 0 {
		e.cooldown--
	}
	if e.cooldown <= 0 && math.Hypot(target.x-e.x, target.y-e.y) < fireRange {
		e.cooldown = stats.fireEvery + h.rng.IntN(2*fireJitter+1) - fireJitter
		h.fire(e)
	}
}

// goal is where the enemy wants to be: a Scout darts around near its target,
// a Fighter holds its distance and strafes.
func (h *Hub) goal(e *enemy, target point, stats enemyStats) point {
	away := math.Atan2(e.y-target.y, e.x-target.x)
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
	h.noteAttack(e)
	seed := h.rng.Uint32()
	// The hub flies the bullets too, against its companions (#46).
	h.volleys = append(
		h.volleys,
		volley{tick: h.tick + fireWarning, enemyID: e.id, angle: e.angle, seed: seed},
	)
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_EnemyFired{EnemyFired: &pb.EnemyFired{
		EnemyId:   e.id,
		Kind:      e.kind,
		Tick:      h.tick + fireWarning,
		WarnTicks: fireWarning,
		Seed:      seed,
		X:         float32(e.x),
		Y:         float32(e.y),
		Angle:     float32(e.angle),
	}}}, "")
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

	if e.frigate != nil {
		e.hp -= e.frigate.takeHit(int(min(damage, maxHitDamage)), h.tick)
	} else {
		e.hp = damaged(e.hp, damage)
	}
	if e.hp > 0 {
		return
	}
	if e.frigate != nil {
		h.frigateDestroyed(e)
	}
	delete(h.enemies, e.id)
	if e.garrison != nil {
		h.garrisonLost(e)
	}
	h.forgetEnemy(e.id)
	h.broadcast(
		&pb.ServerMessage{Kind: &pb.ServerMessage_EnemyDestroyed{EnemyDestroyed: &pb.EnemyDestroyed{
			EnemyId:    e.id,
			Kind:       e.kind,
			ByPlayerId: shooter,
			Tick:       h.tick,
			X:          float32(e.x),
			Y:          float32(e.y),
		}}},
		"",
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
			X:       float32(e.x),
			Y:       float32(e.y),
			Angle:   float32(e.angle),
			Vx:      float32(e.vx),
			Vy:      float32(e.vy),
		}
		if f := e.frigate; f != nil {
			state.Hp = float32(e.hp)
			state.MaxHp = float32(f.maxHP)
			state.Shield = float32(f.shield)
			state.ScaledFor = float32(f.weight)
		}
		out = append(out, state)
	}

	return out
}
