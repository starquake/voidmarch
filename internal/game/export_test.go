package game

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
		o.setup = append(o.setup, func(h *Hub) { h.releaseDerelict(x, y) })
	}
}

// DerelictTicks exposes derelictTicks for tests.
const DerelictTicks = derelictTicks
