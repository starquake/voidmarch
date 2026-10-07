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

// WarningTravel is the farthest any enemy moves at full speed while its
// weapon warns.
func WarningTravel() float64 {
	var most float64
	for _, kind := range []pb.EnemyKind{
		pb.EnemyKind_ENEMY_KIND_SCOUT,
		pb.EnemyKind_ENEMY_KIND_FIGHTER,
		pb.EnemyKind_ENEMY_KIND_BOMBER,
		pb.EnemyKind_ENEMY_KIND_TORPEDO,
	} {
		warning := float64(fireWarning)
		if kind == pb.EnemyKind_ENEMY_KIND_TORPEDO {
			warning = torpedoWarning
		}
		most = max(most, statsFor(kind, sim.Klaed).maxSpeed*warning/TickRate)
	}

	return most
}

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

// WithDreadnoughtHealthScale wakes the Dreadnought at the start with its
// maximum health multiplied by scale, so a measuring fight outlasts it.
func WithDreadnoughtHealthScale(scale float64) HubOption {
	return func(o *hubOptions) {
		o.setup = append(o.setup, func(h *Hub) {
			h.wakeDreadnought()
			if e, awake := h.enemies[h.dreadnoughtID]; awake {
				e.dread.hpScale = scale
				e.hp = e.dread.hp()
			}
		})
	}
}

// WithDreadnoughtGarrisonOut wakes the Dreadnought at the start with its
// sector's garrison on the field, killed of it destroyed already, as if it
// was fought before the Dreadnought woke.
func WithDreadnoughtGarrisonOut(killed int) HubOption {
	return func(o *hubOptions) {
		o.setup = append(o.setup, func(h *Hub) {
			h.wakeDreadnought()
			if e, awake := h.enemies[h.dreadnoughtID]; awake {
				g := h.garrisons[e.dread.sector]
				g.killed = killed
				h.fillGarrison(g, nil)
			}
		})
	}
}

// WithClearedBesideDreadnought wakes the Dreadnought at the start, with n
// other sectors of its ring cleared.
func WithClearedBesideDreadnought(n int) HubOption {
	return func(o *hubOptions) {
		o.setup = append(o.setup, func(h *Hub) {
			h.wakeDreadnought()
			e, awake := h.enemies[h.dreadnoughtID]
			if !awake {
				return
			}
			for _, s := range sim.Sectors() {
				if n > 0 && s.Ring() == e.dread.sector.Ring() && s != e.dread.sector {
					h.cleared[s] = true
					delete(h.garrisons, s)
					n--
				}
			}
		})
	}
}

// WithDreadnoughtInClearedSector wakes the Dreadnought at the start in a
// sector cleared before, as when its ring closed and opened again.
func WithDreadnoughtInClearedSector() HubOption {
	return func(o *hubOptions) {
		o.setup = append(o.setup, func(h *Hub) {
			h.wakeDreadnought()
			if e, awake := h.enemies[h.dreadnoughtID]; awake {
				h.cleared[e.dread.sector] = true
				delete(h.garrisons, e.dread.sector)
			}
		})
	}
}

// WithRaidEvery sets the bounds of the hub ticks between raids (#223).
func WithRaidEvery(lo, hi uint32) HubOption {
	return func(o *hubOptions) {
		o.raidEvery = [2]uint32{lo, hi}
	}
}

// Raid timings in hub ticks, exposed for tests.
const (
	RaidWarnTicks = raidWarnTicks
	RaidTicks     = raidTicks
	RaidEveryMin  = raidEveryMin
	RaidEveryMax  = raidEveryMax
)

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
