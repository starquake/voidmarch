package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
)

// Spawning, in world pixels and ticks. The view is 640x360 art pixels, so
// its half-diagonal is about 367: enemies appear just outside it.
const (
	// Around each player the hub keeps enemiesPerShip for every ship nearby,
	// never fewer than enemiesMinimum, so a wing meets more than one ship alone.
	enemiesMinimum   = 3
	enemiesPerShip   = 2
	maxEnemies       = MaxPlayers * enemiesMinimum
	spawnEvery       = TickRate
	spawnMinDistance = 380
	spawnMaxDistance = 460
	spawnAttempts    = 5
	nearRadius       = 500
	despawnRadius    = 800
	despawnAfter     = 30 * TickRate

	// safeRadius keeps enemies away from the home planet (docs/design.md,
	// section 8); they don't fire at players inside it either.
	safeRadius = 300
	worldHalf  = 2000

	// maxHitDamage caps a reported hit at the strongest weapon's damage.
	maxHitDamage = 12

	// fireWarning is how long an enemy's weapon animates before its bullets
	// leave, so every shot is telegraphed (docs/design.md, section 3).
	fireWarning = 6

	fighterShare  = 0.4
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

	// aggroRange covers the whole spawn ring, so every enemy spawned for a
	// player comes for them.
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
}

type point struct{ x, y float64 }

// stepEnemies runs one tick of the enemies: spawn, steer, fire, despawn.
func (h *Hub) stepEnemies() {
	players := h.playersOutsideSafeZone()
	if h.tick%spawnEvery == 0 {
		h.spawnEnemies(players)
	}
	// In id order: steering draws from h.rng, so map order would make a
	// seeded hub differ between runs.
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		h.steer(e, players)
		if h.tick-e.lastNear > despawnAfter {
			delete(h.enemies, id)
			h.forgetEnemy(id)
		}
	}
}

// playersOutsideSafeZone are the ships enemies spawn around and target:
// players and their companions alike.
func (h *Hub) playersOutsideSafeZone() []point {
	var out []point
	add := func(x, y float64) {
		if math.Hypot(x, y) > safeRadius {
			out = append(out, point{x, y})
		}
	}
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[id]
		if m.state != nil {
			add(float64(m.state.GetX()), float64(m.state.GetY()))
		}
		for _, c := range m.wing.Companions {
			add(c.Ship.X, c.Ship.Y)
		}
	}

	return out
}

func (h *Hub) spawnEnemies(players []point) {
	for _, p := range players {
		want := max(enemiesMinimum, enemiesPerShip*shipsNear(p, players))
		if len(h.enemies) >= maxEnemies || h.enemiesNear(p, nearRadius) >= want {
			continue
		}
		for range spawnAttempts {
			angle := h.rng.Float64() * fullTurnFloat
			distance := spawnMinDistance + h.rng.Float64()*(spawnMaxDistance-spawnMinDistance)
			x := p.x + distance*math.Cos(angle)
			y := p.y + distance*math.Sin(angle)
			if math.Hypot(x, y) > safeRadius && math.Abs(x) < worldHalf && math.Abs(y) < worldHalf {
				h.addEnemy(x, y)

				break
			}
		}
	}
}

func (h *Hub) addEnemy(x, y float64) {
	kind := pb.EnemyKind_ENEMY_KIND_SCOUT
	if h.rng.Float64() < fighterShare {
		kind = pb.EnemyKind_ENEMY_KIND_FIGHTER
	}
	stats := statsFor(kind)
	h.nextEnemy++
	strafe := strafeRight
	if h.rng.Uint32()&1 == 0 {
		strafe = -strafeRight
	}
	h.enemies[h.nextEnemy] = &enemy{
		id:       h.nextEnemy,
		kind:     kind,
		x:        x,
		y:        y,
		hp:       stats.hp,
		cooldown: stats.fireEvery,
		lastNear: h.tick,
		strafe:   strafe,
	}
}

// shipsNear counts the ships within nearRadius of p, p's own included.
func shipsNear(p point, ships []point) int {
	n := 0
	for _, s := range ships {
		if math.Hypot(s.x-p.x, s.y-p.y) < nearRadius {
			n++
		}
	}

	return n
}

func (h *Hub) enemiesNear(p point, radius float64) int {
	n := 0
	for _, e := range h.enemies {
		if math.Hypot(e.x-p.x, e.y-p.y) < radius {
			n++
		}
	}

	return n
}

// steer moves one enemy toward its role's goal around the nearest player,
// and fires when its cooldown and range allow.
func (h *Hub) steer(e *enemy, players []point) {
	stats := statsFor(e.kind)
	target, distance, found := nearest(e, players)
	if distance < despawnRadius {
		e.lastNear = h.tick
	}

	engaged := found && distance < stats.aggroRange
	if engaged {
		accelerate(e, h.goal(e, target, stats), stats)
	} else {
		e.vx *= idleDamping
		e.vy *= idleDamping
	}

	e.x += e.vx * tickDuration
	e.y += e.vy * tickDuration
	keepOutOfSafeZone(e)
	e.x = math.Max(-worldHalf, math.Min(worldHalf, e.x))
	e.y = math.Max(-worldHalf, math.Min(worldHalf, e.y))

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
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_EnemyFired{EnemyFired: &pb.EnemyFired{
		EnemyId:   e.id,
		Kind:      e.kind,
		Tick:      h.tick + fireWarning,
		WarnTicks: fireWarning,
		Seed:      h.rng.Uint32(),
		X:         float32(e.x),
		Y:         float32(e.y),
		Angle:     float32(e.angle),
	}}}, "")
}

// hit applies shooter's shot hitting enemyID: a player's, as their client
// reports it (except is that player, who ended it already), or a companion's,
// as the hub tests it. The shot ends everywhere else, and the enemy is
// destroyed once its hit points run out.
func (h *Hub) hit(except, shooter string, enemyID, shotID, damage uint32) {
	e, ok := h.enemies[enemyID]
	if !ok {
		return
	}
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_ShotEnded{ShotEnded: &pb.ShotEnded{
		PlayerId: shooter,
		ShotId:   shotID,
		Tick:     h.tick,
	}}}, except)

	e.hp = damaged(e.hp, damage)
	if e.hp > 0 {
		return
	}
	delete(h.enemies, e.id)
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
}

// damaged is hp after a reported hit, capped at the strongest weapon's damage.
func damaged(hp int, damage uint32) int {
	return hp - int(min(damage, maxHitDamage))
}

func (h *Hub) enemySnapshot() []*pb.EnemyState {
	out := make([]*pb.EnemyState, 0, len(h.enemies))
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		e := h.enemies[id]
		out = append(out, &pb.EnemyState{
			EnemyId: e.id,
			Kind:    e.kind,
			X:       float32(e.x),
			Y:       float32(e.y),
			Angle:   float32(e.angle),
		})
	}

	return out
}
