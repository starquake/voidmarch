package game

import (
	"log/slog"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
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

// GarrisonKinds draws the first n places of ring's garrison line-up, as
// garrisonKind does.
func (h *Hub) GarrisonKinds(ring, n int) []pb.EnemyKind {
	kinds := make([]pb.EnemyKind, n)
	for place := range n {
		kinds[place] = h.garrisonKind(ring, place)
	}

	return kinds
}

// EnemyStatsFor exposes a kind's hit points and fire interval in its faction.
func EnemyStatsFor(kind pb.EnemyKind, faction sim.EnemyFaction) (hp, fireEvery int) {
	s := statsFor(kind, faction)

	return s.hp, s.fireEvery
}

// WithEnemyOf starts the hub with an enemy of kind and faction at (x, y).
func WithEnemyOf(kind pb.EnemyKind, faction sim.EnemyFaction, x, y float64) HubOption {
	return func(o *hubOptions) {
		o.setup = append(o.setup, func(h *Hub) { h.addEnemyOf(kind, faction, x, y) })
	}
}

// TorpedoWarning exposes torpedoWarning for tests.
const TorpedoWarning = torpedoWarning

// WithWokenThenLost wakes the Dreadnought at the start, then loses sector
// name again, as an attack would.
func WithWokenThenLost(name string) HubOption {
	return func(o *hubOptions) {
		o.setup = append(o.setup, func(h *Hub) {
			h.wakeDreadnought()
			if s, ok := sim.ParseSector(name); ok {
				delete(h.cleared, s)
			}
		})
	}
}

// DreadnoughtGap exposes dreadnoughtGap for tests.
var DreadnoughtGap = dreadnoughtGap

// DreadnoughtVolleyGap exposes dreadnoughtVolleyGap for tests.
const DreadnoughtVolleyGap = dreadnoughtVolleyGap

// StatsSaveEvery exposes statsSaveEvery for tests.
const StatsSaveEvery = statsSaveEvery

// KillsCounted is player a's stats after kills by each of shooters, a
// player or a companion's seat, on a hub that isn't running.
func KillsCounted(shooters ...string) players.Stats {
	h := NewHub(slog.New(slog.DiscardHandler))
	h.keepStats(players.Player{ID: "a"})
	for _, shooter := range shooters {
		h.countKill(shooter)
	}

	return *h.stats["a"]
}

// SupportBehind exposes supportBehind for tests.
const SupportBehind = supportBehind
