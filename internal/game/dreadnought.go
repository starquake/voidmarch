package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// The Dreadnoughts' fight in hub ticks and world pixels (#124); its rules
// are the sim's.
const (
	// halfSweep is half the arc a Ray sweep turns through.
	halfSweep = sim.DreadnoughtRaySweep / 2
	// dreadnoughtFireRange is how close a ship has to come for it to fire.
	dreadnoughtFireRange = 520
	// dreadnoughtVolleyGap is the wait after a ring or a Wave spread, and
	// dreadnoughtBeamGap between the beams of a Ray sweep.
	dreadnoughtVolleyGap   = 2 * TickRate
	dreadnoughtBeamGap     = 6
	dreadnoughtShieldTicks = sim.DreadnoughtShieldDelay * TickRate
	// dreadnoughtDerelictRing is how far from the wreck its fall's derelicts wait.
	dreadnoughtDerelictRing = 140
	// dreadnoughtSaveEvery is how often its health is saved while it's awake.
	dreadnoughtSaveEvery = 60 * TickRate
	// regenPerTick is the share of its health it gets back each hub tick.
	regenPerTick = sim.DreadnoughtRegenPerHour / (60 * 60 * TickRate)
)

// dreadnoughtFight is the Dreadnought's state beyond an enemy's: its
// shield, which volley comes next, and its health, as the share of its
// maximum left and the weight of the players online that the maximum
// follows (#132).
type dreadnoughtFight struct {
	shield  int
	lastHit uint32
	next    sim.DreadnoughtVolley
	// beams is how many beams of a Ray sweep are left, fired from
	// across the sweep.
	beams  int
	from   float64
	share  float64
	weight float64
}

// maxHP is its maximum health for the players online now.
func (f *dreadnoughtFight) maxHP() float64 {
	return sim.DreadnoughtMaxHP(f.weight)
}

// hp is its health, never 0 while any share is left.
func (f *dreadnoughtFight) hp() int {
	if f.share <= 0 {
		return 0
	}

	return max(1, int(math.Round(f.share*f.maxHP())))
}

// WithDreadnought sets the share of a faction's Dreadnought's health left,
// from 0 to 1, as saved, its offline regeneration applied (#124, #132,
// #140); a hub starts with each whole.
func WithDreadnought(faction sim.EnemyFaction, share float64) HubOption {
	return func(o *hubOptions) {
		if o.dreadnoughtShares == nil {
			o.dreadnoughtShares = map[sim.EnemyFaction]float64{}
		}
		o.dreadnoughtShares[faction] = share
	}
}

// WithSaveDreadnought saves the share of a faction's Dreadnought's health
// left, off the tick goroutine, while it's awake and when it falls.
func WithSaveDreadnought(save func(faction sim.EnemyFaction, share float64)) HubOption {
	return func(o *hubOptions) {
		o.saveDreadnought = save
	}
}

// WithSaveOpenRings saves how many rings are open when that changes (#123).
func WithSaveOpenRings(save func(rings int)) HubOption {
	return func(o *hubOptions) {
		o.saveOpenRings = save
	}
}

// ringCleared is how many of ring's sectors are cleared.
func (h *Hub) ringCleared(ring int) int {
	n := 0
	for s := range h.cleared {
		if s.Ring() == ring {
			n++
		}
	}

	return n
}

// dreadnoughtShare is the share of faction's Dreadnought's health left, as
// saved: all of it until it's been fought.
func (h *Hub) dreadnoughtShare(faction sim.EnemyFaction) float64 {
	if share, ok := h.dreadnoughtShares[faction]; ok {
		return share
	}

	return 1
}

// wakeDreadnought wakes the Dreadnought guarding the next closed ring,
// once enough of the open ring inside it is cleared, in a sector of that
// closed ring drawn at random that opens for it (#8 decisions 1, 4 and 11):
// the Kla'ed one in ring 2 after ring 1, the Nairan one in ring 3 after
// ring 2 (#140). Its faction is the one holding the ring it wakes beyond.
func (h *Hub) wakeDreadnought() {
	inside := h.frontier.OpenRings
	if _, awake := h.enemies[h.dreadnoughtID]; awake || inside >= sim.GridRings {
		return
	}
	early := inside == 1 && h.worldMap != nil && h.worldMap.DreadnoughtAwake
	if !early && h.ringCleared(inside) < sim.DreadnoughtWakesAt {
		return
	}
	faction := sim.FactionOfRing(inside)
	var spots []sim.Sector
	for _, s := range sim.Sectors() {
		if s.Ring() == inside+1 {
			spots = append(spots, s)
		}
	}
	s := spots[h.rng.IntN(len(spots))]
	c := s.Center()
	h.nextEnemy++
	e := &enemy{
		id:       h.nextEnemy,
		kind:     pb.EnemyKind_ENEMY_KIND_DREADNOUGHT,
		faction:  faction,
		x:        c.X,
		y:        c.Y,
		angle:    quarterTurn,
		lastNear: h.tick,
		dread: &dreadnoughtFight{
			shield: sim.DreadnoughtShield,
			share:  h.dreadnoughtShare(faction),
			weight: h.onlineWeight(),
		},
	}
	e.hp = e.dread.hp()
	h.enemies[e.id] = e
	h.dreadnoughtID = e.id
	h.frontier.Opened = map[sim.Sector]bool{s: true}
	h.broadcastFrontier()
}

// closeRingsIfFallenBack closes every ring beyond the first open ring that
// has fewer than sim.DreadnoughtWakesAt cleared sectors (#8 decision 9,
// #140): ring 1 falling back closes rings 2 and 3, ring 2 falling back ring
// 3. Reopening a ring takes its Dreadnought again. A Dreadnought awake
// beyond the new edge goes back to sleep, keeping its share.
func (h *Hub) closeRingsIfFallenBack() {
	for ring := 1; ring < h.frontier.OpenRings; ring++ {
		if h.ringCleared(ring) >= sim.DreadnoughtWakesAt {
			continue
		}
		h.frontier = sim.Frontier{OpenRings: ring}
		if h.saveOpenRings != nil {
			h.saves <- func() { h.saveOpenRings(ring) }
		}
		if e, awake := h.enemies[h.dreadnoughtID]; awake {
			h.dreadnoughtShares[e.faction] = e.dread.share
			h.saveDreadnoughtShare(e.faction, e.dread.share)
			delete(h.enemies, e.id)
			h.forgetEnemy(e.id)
			h.dreadnoughtID = 0
		}
		h.broadcastFrontier()

		return
	}
}

// stepDreadnought scales it to the players online, regenerates it,
// recharges its shield, and fires its volleys in turn at the nearest ship in
// range.
func (h *Hub) stepDreadnought(e *enemy, ships []upShip, online float64) {
	f := e.dread
	e.lastNear = h.tick
	f.weight = online
	f.share = math.Min(1, f.share+regenPerTick)
	e.hp = f.hp()
	if h.tick%dreadnoughtSaveEvery == 0 {
		h.saveDreadnoughtShare(e.faction, f.share)
	}
	if f.shield < sim.DreadnoughtShield && h.tick-f.lastHit >= dreadnoughtShieldTicks {
		f.shield = sim.DreadnoughtShield
	}
	if e.cooldown > 0 {
		e.cooldown--

		return
	}
	target, distance, found := nearest(e, shipPoints(ships))
	if !found || distance > dreadnoughtFireRange {
		return
	}
	e.angle = math.Atan2(target.y-e.y, target.x-e.x)
	switch f.next {
	case sim.DreadnoughtRay:
		if f.beams == 0 {
			f.beams, f.from = sim.DreadnoughtRayBeams, e.angle-halfSweep
		}
		step := sim.DreadnoughtRaySweep / (sim.DreadnoughtRayBeams - 1)
		h.fireVolley(e, f.from+step*float64(sim.DreadnoughtRayBeams-f.beams), sim.DreadnoughtRay)
		f.beams--
		e.cooldown = dreadnoughtBeamGap
		if f.beams == 0 {
			f.next, e.cooldown = sim.DreadnoughtWave, dreadnoughtVolleyGap
		}
	case sim.DreadnoughtWave:
		h.fireVolley(e, e.angle, sim.DreadnoughtWave)
		f.next, e.cooldown = sim.DreadnoughtRing, dreadnoughtVolleyGap
	case sim.DreadnoughtRing:
		fallthrough
	default:
		h.fireVolley(e, e.angle, sim.DreadnoughtRing)
		f.next, e.cooldown = sim.DreadnoughtRay, dreadnoughtVolleyGap
	}
}

// takeHit takes damage, the shield first, off its share, and returns its
// health after.
func (f *dreadnoughtFight) takeHit(damage int, tick uint32) int {
	f.lastHit = tick
	absorbed := min(f.shield, damage)
	f.shield -= absorbed
	f.share = math.Max(0, f.share-float64(damage-absorbed)/f.maxHP())

	return f.hp()
}

// dreadnoughtFallen rewards the players near e, releases its derelicts and
// tells everyone (#125), opens the ring it guarded (#140, replacing #8
// decision 12's "rings 2 and 3 together"), and saves a fresh Dreadnought's
// health for the next time its faction's wakes.
func (h *Hub) dreadnoughtFallen(e *enemy) {
	var gains []*pb.PickupGain
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[id]
		if m.gone || m.state == nil || downed(m.state) {
			continue
		}
		if math.Hypot(float64(m.state.GetX())-e.x, float64(m.state.GetY())-e.y) > sim.FrigateReach {
			continue
		}
		if gain := h.grantPart(id, m); gain != nil {
			gains = append(gains, gain)
		}
	}
	for n := range sim.DreadnoughtDerelicts {
		angle := fullTurnFloat * float64(n) / sim.DreadnoughtDerelicts
		h.releaseDerelict(
			e.x+dreadnoughtDerelictRing*math.Cos(angle),
			e.y+dreadnoughtDerelictRing*math.Sin(angle),
			0,
		)
	}
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_BossFell{BossFell: &pb.BossFell{
		Kind: e.kind, Gains: gains, Tick: h.tick, Faction: pbEnemyFaction(e.faction),
	}}}, "")
	h.dreadnoughtID = 0
	h.dreadnoughtShares[e.faction] = 1
	h.saveDreadnoughtShare(e.faction, 1)
	opened := min(h.frontier.OpenRings+1, sim.GridRings)
	h.frontier = sim.Frontier{OpenRings: opened}
	if h.saveOpenRings != nil {
		h.saves <- func() { h.saveOpenRings(opened) }
	}
	h.broadcastFrontier()
}

// saveDreadnoughtShare saves the share of faction's Dreadnought's health
// left off the tick goroutine.
func (h *Hub) saveDreadnoughtShare(faction sim.EnemyFaction, share float64) {
	if h.saveDreadnought != nil {
		h.saves <- func() { h.saveDreadnought(faction, share) }
	}
}

// broadcastFrontier tells everyone which sectors are open now (#123).
func (h *Hub) broadcastFrontier() {
	h.broadcast(
		&pb.ServerMessage{Kind: &pb.ServerMessage_Frontier{Frontier: h.frontierMessage()}},
		"",
	)
}
