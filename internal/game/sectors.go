package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// WithClearedSectors starts the hub with these sectors cleared, as saved
// (#99); names off the grid are ignored.
func WithClearedSectors(names []string) HubOption {
	return func(o *hubOptions) {
		o.cleared = append(o.cleared, names...)
	}
}

// WithSaveSector saves each sector the hub clears, by name, off the tick
// goroutine and in order with the other saves.
func WithSaveSector(save func(name string)) HubOption {
	return func(o *hubOptions) {
		o.saveSector = save
	}
}

// clearedSet is the cleared sectors among names.
func clearedSet(names []string) map[sim.Sector]bool {
	out := make(map[sim.Sector]bool, len(names))
	for _, name := range names {
		if s, ok := sim.ParseSector(name); ok {
			out[s] = true
		}
	}

	return out
}

// clearedNames are the cleared sectors' names, sorted.
func (h *Hub) clearedNames() []string {
	out := make([]string, 0, len(h.cleared))
	for s := range h.cleared {
		out = append(out, s.Name())
	}
	slices.Sort(out)

	return out
}

// mapName is the game map's name, empty without one.
func (h *Hub) mapName() string {
	if h.worldMap == nil {
		return ""
	}

	return h.worldMap.Name
}

// Garrisons, in world pixels and hub ticks (#99).
const (
	// garrisonReach is how close to its sector a ship wakes a garrison.
	garrisonReach = 400
	// garrisonActive is the most of a garrison on the field at once, unless
	// the map says fewer.
	garrisonActive = 24
	// roamMargin keeps a garrison's roam points this far in from its sector's
	// sides (#121).
	roamMargin = 80
	// roamSpeedShare is the share of its top speed a garrison ship roams at.
	roamSpeedShare = 0.4
	// postClearance keeps reinforcements out of sight: none takes a post
	// this close to a ship.
	postClearance = 400
	// postReach is close enough to its post for a garrison ship to wait.
	postReach = 30
	// garrisonIdle is how long a garrison stays on the field with nobody near.
	garrisonIdle   = 30 * TickRate
	stragglerTicks = sim.StragglerSeconds * TickRate
)

// garrison is the Kla'ed holding a sector until it's cleared. Its size
// grows with the ships that enter, and its losses stay until it's cleared.
type garrison struct {
	sector sim.Sector
	base   int
	// shares are the counted ships' shares of the base, the first player's
	// included.
	shares   float64
	counted  map[string]bool
	killed   int
	field    int
	lastNear uint32
}

// size is the garrison's whole size: the base for one player, and the
// other ships' shares on top.
func (g *garrison) size() int {
	extra := math.Max(0, g.shares-sim.GarrisonPlayerShare)

	return int(math.Round(float64(g.base) * (1 + extra)))
}

// reserve is how many of the garrison wait off the field.
func (g *garrison) reserve() int {
	return max(0, g.size()-g.killed-g.field)
}

// done reports whether the whole garrison is destroyed.
func (g *garrison) done() bool {
	return g.field == 0 && g.killed >= g.size()
}

// count adds a ship that entered the sector to the garrison's size, once.
func (g *garrison) count(s upShip) {
	if g.counted[s.key] {
		return
	}
	g.counted[s.key] = true
	g.shares += s.weight * sim.GarrisonPlayerShare
}

// newGarrisons are the garrisons of every sector but home and the cleared,
// sized by the map, or by ring without one.
func newGarrisons(m *world.Map, cleared map[sim.Sector]bool) map[sim.Sector]*garrison {
	out := make(map[sim.Sector]*garrison)
	for _, s := range sim.Sectors() {
		base := sim.GarrisonSize(s.Ring())
		if m != nil {
			base = m.GarrisonSize(s)
		}
		if base <= 0 || cleared[s] || s == sim.HomeSector() {
			continue
		}
		out[s] = &garrison{sector: s, base: base, counted: map[string]bool{}}
	}

	return out
}

// stepGarrisons counts the ships that entered each sector, brings a
// garrison onto the field while anyone is near it, and stands it down after
// a while with nobody near.
func (h *Hub) stepGarrisons(ships []upShip) {
	for _, s := range sim.Sectors() {
		g := h.garrisons[s]
		if g == nil {
			continue
		}
		near := false
		for _, ship := range ships {
			if s.Contains(ship.at.x, ship.at.y) {
				g.count(ship)
				near = true
			} else if distanceToSector(ship.at, s) <= garrisonReach {
				near = true
			}
		}
		if near {
			g.lastNear = h.tick
			h.fillGarrison(g, ships)
		} else if g.field > 0 && h.tick-g.lastNear > garrisonIdle {
			h.standDown(g)
		}
	}
}

// fillGarrison brings the garrison's reserve onto the field, up to
// garrisonField, each at a post out of every ship's sight.
func (h *Hub) fillGarrison(g *garrison, ships []upShip) {
	for g.field < h.garrisonField && g.reserve() > 0 {
		post, ok := h.freePost(g.sector, ships)
		if !ok {
			return
		}
		kind := pb.EnemyKind_ENEMY_KIND_SCOUT
		if h.rng.Float64() < sim.GarrisonFighterShare(g.sector.Ring()) {
			kind = pb.EnemyKind_ENEMY_KIND_FIGHTER
		}
		e := h.addEnemyOf(kind, post.x, post.y)
		e.garrison, e.post = g, post
		g.field++
	}
}

// freePost is a point anywhere in s with no ship within postClearance.
func (h *Hub) freePost(s sim.Sector, ships []upShip) (point, bool) {
	for range spawnAttempts {
		p := h.roamPoint(s, roamMargin)
		if _, d := nearestShip(p, ships); d > postClearance {
			return p, true
		}
	}

	return point{}, false
}

// roamPoint is a random point in s, margin in from its sides.
func (h *Hub) roamPoint(s sim.Sector, margin float64) point {
	c := s.Center()
	for range spawnAttempts {
		p := point{
			c.X + (h.rng.Float64()*2-1)*sim.SectorRadius,
			c.Y + (h.rng.Float64()*2-1)*sim.SectorApothem,
		}
		if s.Inside(p.x, p.y, margin) {
			return p
		}
	}

	return point{c.X, c.Y}
}

// standDown takes a garrison off the field; its ships wait in its reserve.
func (h *Hub) standDown(g *garrison) {
	for _, id := range slices.Sorted(maps.Keys(h.enemies)) {
		if h.enemies[id].garrison == g {
			delete(h.enemies, id)
			h.forgetEnemy(id)
		}
	}
	g.field = 0
}

// garrisonLost counts a garrison ship destroyed, and clears its sector once
// it was the last.
func (h *Hub) garrisonLost(e *enemy) {
	e.garrison.killed++
	e.garrison.field--
	h.clearIfDone(e.garrison.sector)
}

// clearIfDone clears s once its garrison and its Frigate, if any, are
// destroyed.
func (h *Hub) clearIfDone(s sim.Sector) {
	if h.cleared[s] || s == sim.HomeSector() {
		return
	}
	if g := h.garrisons[s]; g != nil && !g.done() {
		return
	}
	for _, spot := range h.frigates {
		if spot.sector == s && spot.enemyID != 0 {
			return
		}
	}
	delete(h.garrisons, s)
	h.clearSector(s)
}

// clearSector marks s cleared, saves it, rewards it, moves the missions
// sent there on, and tells everyone.
func (h *Hub) clearSector(s sim.Sector) {
	h.cleared[s] = true
	name := s.Name()
	if h.saveSector != nil {
		h.saves <- func() { h.saveSector(name) }
	}
	gains := h.rewardClear()
	h.moveMissionsOn(s)
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_SectorCleared{
		SectorCleared: &pb.SectorCleared{Sector: name, Tick: h.tick, Gains: gains},
	}}, "")
	h.broadcastSquadrons()
}

// spawnStragglers sends the odd Scout into a cleared sector someone is in,
// at most one every stragglerTicks; the clock starts when someone arrives.
func (h *Hub) spawnStragglers(players []point) {
	for _, p := range players {
		s, ok := sim.SectorAt(p.x, p.y)
		if !ok || !h.cleared[s] {
			continue
		}
		last, seen := h.lastStraggler[s]
		if !seen {
			h.lastStraggler[s] = h.tick

			continue
		}
		if h.tick-last < stragglerTicks {
			continue
		}
		h.lastStraggler[s] = h.tick
		h.spawnNear(p, pb.EnemyKind_ENEMY_KIND_SCOUT)
	}
}

// spawnNear puts an enemy of kind just out of p's view, inside the world
// and out of the safe zone.
func (h *Hub) spawnNear(p point, kind pb.EnemyKind) {
	for range spawnAttempts {
		angle := h.rng.Float64() * fullTurnFloat
		distance := spawnMinDistance + h.rng.Float64()*(spawnMaxDistance-spawnMinDistance)
		x := p.x + distance*math.Cos(angle)
		y := p.y + distance*math.Sin(angle)
		if math.Hypot(x, y) > safeRadius && sim.WorldReach(x, y) < sim.WorldApothem {
			h.addEnemyOf(kind, x, y)

			return
		}
	}
}

// inSector are the points inside s.
func inSector(points []point, s sim.Sector) []point {
	var out []point
	for _, p := range points {
		if s.Contains(p.x, p.y) {
			out = append(out, p)
		}
	}

	return out
}

// keepInSector holds an enemy inside s, stopping it at the edge.
func keepInSector(e *enemy, s sim.Sector) {
	if x, y := s.Clamp(e.x, e.y, 1); x != e.x || y != e.y {
		e.x, e.y, e.vx, e.vy = x, y, 0, 0
	}
}

// distanceToSector is how far p is from s's edge; 0 inside it.
func distanceToSector(p point, s sim.Sector) float64 {
	return s.Beyond(p.x, p.y)
}

// garrisonField is how many of a garrison fight at once: the map's cap, or
// garrisonActive.
func garrisonField(m *world.Map) int {
	if m == nil || m.Field <= 0 {
		return garrisonActive
	}

	return min(m.Field, garrisonActive)
}

// newGarrison is a fresh garrison for s, sized by the map or by its ring.
func (h *Hub) newGarrison(s sim.Sector) *garrison {
	base := sim.GarrisonSize(s.Ring())
	if h.worldMap != nil {
		base = h.worldMap.GarrisonSize(s)
	}

	return &garrison{sector: s, base: base, counted: map[string]bool{}}
}
