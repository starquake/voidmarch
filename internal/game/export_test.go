package game

import (
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

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

// TurnToward exposes turnToward for tests.
var TurnToward = turnToward

// The Frigate's patrol (#121), exposed for tests.
const (
	FrigateMargin      = frigateMargin
	FrigatePatrolSpeed = frigatePatrolSpeed
)

// FrigateDerelictOffset is how far below its Frigate a held derelict waits.
const FrigateDerelictOffset = frigateDerelictOffset

// DerelictTicks exposes derelictTicks for tests.
const DerelictTicks = derelictTicks

// Garrison distances and timings, exposed for tests.
const (
	RoamMargin     = roamMargin
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
	h.addEnemyOf(kind, sim.Klaed, x, y)
}

// WithEventTimes sets the world events' timings in hub ticks (#102).
func WithEventTimes(every, attack, offlineAttack, offlineEvery uint32) HubOption {
	return func(o *hubOptions) {
		o.eventTimes = &eventTimes{
			every:         every,
			attack:        attack,
			offlineAttack: offlineAttack,
			offlineEvery:  offlineEvery,
		}
	}
}

// NoEvents puts the world events off past any test.
var NoEvents = WithEventTimes(1<<30, 1<<30, 1<<30, 1<<30)

// EventEvery exposes eventEvery for tests.
const EventEvery = eventEvery

// EnemyStatsFor exposes a kind's hit points and fire interval in its faction.
func EnemyStatsFor(kind pb.EnemyKind, faction sim.EnemyFaction) (hp, fireEvery int) {
	s := statsFor(kind, faction)

	return s.hp, s.fireEvery
}
