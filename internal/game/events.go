package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// World events' timing in hub ticks (#102): how often one comes while
// anyone is online, how long an attack lasts, and the same with nobody on.
const (
	eventEvery         = 5 * 60 * TickRate
	attackTicks        = 10 * 60 * TickRate
	offlineAttackTicks = 60 * 60 * TickRate
	offlineEvery       = 4 * 60 * 60 * TickRate
	distressGuards     = 3
	distressGuardRing  = 140
)

// eventTimes are the world events' timings, which tests shorten.
type eventTimes struct {
	every, attack, offlineAttack, offlineEvery uint32
}

func defaultEventTimes() eventTimes {
	return eventTimes{
		every:         eventEvery,
		attack:        attackTicks,
		offlineAttack: offlineAttackTicks,
		offlineEvery:  offlineEvery,
	}
}

// worldEvent is the event running: an attack on a cleared sector, with its
// force, or a distress call, with its derelict.
type worldEvent struct {
	kind     pb.WorldEventKind
	sector   sim.Sector
	endsTick uint32
	force    *garrison
	frigate  int
	derelict uint32
}

// WithForgetSector saves a sector the enemy took back as no longer cleared,
// off the tick goroutine and in order with the other saves.
func WithForgetSector(forget func(name string)) HubOption {
	return func(o *hubOptions) {
		o.forgetSector = forget
	}
}

// stepEvents ends the event running once it's won or its time is up, and
// starts the next on schedule: every few minutes with anyone online, every
// few hours with nobody on.
func (h *Hub) stepEvents() {
	online := slices.ContainsFunc(
		slices.Collect(maps.Values(h.members)),
		func(m *member) bool { return !m.gone },
	)
	if online {
		h.lastOnline = h.tick
		h.nextOffline = h.tick + h.eventTimes.offlineEvery
	}
	if e := h.event; e != nil && e.kind == pb.WorldEventKind_WORLD_EVENT_KIND_ATTACK {
		if e.force.done() && h.frigates[e.frigate].enemyID == 0 {
			h.endEvent(true)
		} else if h.tick >= e.endsTick {
			h.loseSector(e.sector)
			h.endEvent(false)
		}
	}
	if h.event != nil {
		return
	}
	if online && h.tick >= h.nextEvent {
		h.nextEvent = h.tick + h.eventTimes.every
		if !h.startAttack(h.eventTimes.attack) {
			h.startDistress()
		}
	} else if !online && h.tick >= h.nextOffline {
		h.nextOffline = h.tick + h.eventTimes.offlineEvery
		h.startAttack(h.eventTimes.offlineAttack)
	}
}

// startAttack sends a Frigate and a garrison at a cleared sector next to
// hostile space, to last ticks, and reports whether there was one to attack.
func (h *Hub) startAttack(ticks uint32) bool {
	var targets []sim.Sector
	for _, s := range sim.Sectors() {
		if h.cleared[s] && h.bordersHostile(s) {
			targets = append(targets, s)
		}
	}
	if len(targets) == 0 {
		return false
	}
	s := targets[h.rng.IntN(len(targets))]
	force := &garrison{sector: s, base: sim.GarrisonSize(s.Ring()), counted: map[string]bool{}}
	h.garrisons[s] = force
	c := s.Center()
	h.frigates = append(h.frigates, frigateSpot{at: point{c.X, c.Y}, sector: s, once: true})
	h.event = &worldEvent{
		kind:     pb.WorldEventKind_WORLD_EVENT_KIND_ATTACK,
		sector:   s,
		endsTick: h.tick + ticks,
		force:    force,
		frigate:  len(h.frigates) - 1,
	}
	h.spawnFrigates()
	h.broadcastEvent()

	return true
}

// startDistress puts a derelict with a small guard in a sector next to
// cleared ground or home; none when the fleet has no room for it.
func (h *Hub) startDistress() {
	var spots []sim.Sector
	for _, s := range sim.Sectors() {
		if s != sim.HomeSector() && h.bordersReached(s) {
			spots = append(spots, s)
		}
	}
	if len(spots) == 0 {
		return
	}
	s := spots[h.rng.IntN(len(spots))]
	c := s.Center()
	id, ok := h.releaseDerelict(c.X, c.Y, 0)
	if !ok {
		return
	}
	for n := range distressGuards {
		angle := fullTurnFloat * float64(n) / distressGuards
		h.addEnemyOf(
			pb.EnemyKind_ENEMY_KIND_FIGHTER,
			c.X+distressGuardRing*math.Cos(angle),
			c.Y+distressGuardRing*math.Sin(angle),
		)
	}
	h.event = &worldEvent{
		kind:     pb.WorldEventKind_WORLD_EVENT_KIND_DISTRESS,
		sector:   s,
		endsTick: h.derelicts[id].goneTick,
		derelict: id,
	}
	h.broadcastEvent()
}

// derelictRescued wins a distress call whose derelict was rescued, with a
// part for every player near.
func (h *Hub) derelictRescued(id uint32, at point) {
	if h.isDistress(id) {
		h.dropPickup(&enemy{kind: pb.EnemyKind_ENEMY_KIND_FRIGATE, x: at.x, y: at.y})
		h.endEvent(true)
	}
}

// derelictDriftedOff loses a distress call whose derelict nobody rescued.
func (h *Hub) derelictDriftedOff(id uint32) {
	if h.isDistress(id) {
		h.endEvent(false)
	}
}

// isDistress reports whether derelict id is the distress call's.
func (h *Hub) isDistress(id uint32) bool {
	e := h.event

	return e != nil && e.kind == pb.WorldEventKind_WORLD_EVENT_KIND_DISTRESS && e.derelict == id
}

// loseSector turns s hostile again: forgotten as cleared, the attack's
// force gone, and a fresh garrison of its own in its place.
func (h *Hub) loseSector(s sim.Sector) {
	delete(h.cleared, s)
	if h.forgetSector != nil {
		name := s.Name()
		h.saves <- func() { h.forgetSector(name) }
	}
	h.standDown(h.event.force)
	if spot := &h.frigates[h.event.frigate]; spot.enemyID != 0 {
		delete(h.enemies, spot.enemyID)
		h.forgetEnemy(spot.enemyID)
		spot.enemyID, spot.respawnAt = 0, math.MaxUint32
	}
	h.garrisons[s] = h.newGarrison(s)
	for _, name := range slices.Sorted(maps.Keys(h.squadrons)) {
		if sq := h.squadrons[name]; !sq.hasMission {
			sq.mission, sq.hasMission = s, true
		}
	}
}

// endEvent tells everyone the event is over; a won attack adds a ship to
// the hangar, within the fleet cap (#102, decision 10).
//
//nolint:revive // won is the outcome everyone is told, not a mode.
func (h *Hub) endEvent(won bool) {
	e := h.event
	h.event = nil
	if e.kind == pb.WorldEventKind_WORLD_EVENT_KIND_ATTACK {
		if h.garrisons[e.sector] == e.force {
			delete(h.garrisons, e.sector)
		}
		if won && h.fleet()+len(h.derelicts) < sim.MaxFleet {
			h.hangar++
		}
	}
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_EventEnded{EventEnded: &pb.EventEnded{
		Event: eventMessage(e),
		Won:   won,
	}}}, "")
	h.broadcastSquadrons()
}

func (h *Hub) broadcastEvent() {
	h.broadcast(
		&pb.ServerMessage{Kind: &pb.ServerMessage_EventStarted{EventStarted: &pb.EventStarted{
			Event: eventMessage(h.event),
		}}},
		"",
	)
}

// eventMessage is e for the wire; nil for none.
func eventMessage(e *worldEvent) *pb.WorldEvent {
	if e == nil {
		return nil
	}

	return &pb.WorldEvent{Kind: e.kind, Sector: e.sector.Name(), EndsTick: e.endsTick}
}

// bordersHostile reports whether a sector next to s is held by the enemy.
func (h *Hub) bordersHostile(s sim.Sector) bool {
	return anyNeighbor(
		s,
		func(n sim.Sector) bool { return n != sim.HomeSector() && !h.cleared[n] },
	)
}

// bordersReached reports whether a sector next to s is cleared or home.
func (h *Hub) bordersReached(s sim.Sector) bool {
	return anyNeighbor(
		s,
		func(n sim.Sector) bool { return n == sim.HomeSector() || h.cleared[n] },
	)
}

// anyNeighbor reports whether any of the up to 8 sectors around s matches.
func anyNeighbor(s sim.Sector, match func(sim.Sector) bool) bool {
	for dc := -1; dc <= 1; dc++ {
		for dr := -1; dr <= 1; dr++ {
			n := sim.Sector{Col: s.Col + dc, Row: s.Row + dr}
			if (dc != 0 || dr != 0) && n.Valid() && match(n) {
				return true
			}
		}
	}

	return false
}
