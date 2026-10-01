package game

import pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"

// Damaged exposes damaged for tests.
var Damaged = damaged

// FireWarning exposes fireWarning for tests.
const FireWarning = fireWarning

// SilenceTicks exposes silenceTicks for tests.
const SilenceTicks = silenceTicks

// MaxHitDamage exposes maxHitDamage for tests.
const MaxHitDamage = maxHitDamage

// WithinReach exposes withinReach for tests, with points as pairs.
func WithinReach(x, y float64, companions [][2]float64) bool {
	ps := make([]point, len(companions))
	for i, c := range companions {
		ps[i] = point{c[0], c[1]}
	}

	return withinReach(point{x, y}, ps)
}

// VolleyRange exposes volleyRange for tests.
const VolleyRange = volleyRange

// WithEnemyAt starts the hub with an enemy at (x, y).
func WithEnemyAt(x, y float64) HubOption {
	return func(o *hubOptions) {
		o.setup = append(o.setup, func(h *Hub) { h.addEnemy(x, y) })
	}
}

// SendQueue exposes sendQueue for tests.
const SendQueue = sendQueue

// SimEnemyKind exposes simEnemyKind for tests.
var SimEnemyKind = simEnemyKind

// Frigate timings and sizes, exposed for tests.
const (
	FrigateEscorts      = frigateEscorts
	FrigateRingEvery    = frigateRingEvery
	FrigateShieldTicks  = frigateShieldTicks
	FrigateRespawnTicks = frigateRespawnTicks
	DespawnAfter        = despawnAfter
)

// WithDerelictAt starts the hub with a derelict at (x, y).
func WithDerelictAt(x, y float64) HubOption {
	return func(o *hubOptions) {
		o.setup = append(o.setup, func(h *Hub) { h.releaseDerelict(x, y, 0) })
	}
}

// DerelictTicks exposes derelictTicks for tests.
const DerelictTicks = derelictTicks

// Garrison distances and timings, exposed for tests.
const (
	GarrisonPosts  = garrisonPosts
	GarrisonIdle   = garrisonIdle
	StragglerTicks = stragglerTicks
)

// addEnemy adds a Scout or a Fighter at (x, y), as the hub once spawned them.
func (h *Hub) addEnemy(x, y float64) {
	const fighterShare = 0.4
	kind := pb.EnemyKind_ENEMY_KIND_SCOUT
	if h.rng.Float64() < fighterShare {
		kind = pb.EnemyKind_ENEMY_KIND_FIGHTER
	}
	h.addEnemyOf(kind, x, y)
}
