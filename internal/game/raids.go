package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// Raids in hub ticks (#223).
const (
	raidWarnTicks  = sim.DreadnoughtRaidWarning * TickRate
	raidTicks      = sim.DreadnoughtRaidSeconds * TickRate
	raidEveryMin   = sim.DreadnoughtRaidEveryMin * TickRate
	raidEveryMax   = sim.DreadnoughtRaidEveryMax * TickRate
	raidSpotTrials = 40
)

// raid is a Dreadnought raiding a sector of the ring it guards the way out
// of (#223): announced first, then on the field until it's driven off,
// its time is up, or everyone near it is down.
type raid struct {
	faction sim.EnemyFaction
	sector  sim.Sector
	at      point
	// arrives is the tick it appears; enemyID is 0 until it has.
	arrives uint32
	enemyID uint32
	leaves  uint32
	// floor is the share of health left that drives it off.
	floor float64
}

// raidRing is the ring a Dreadnought may raid now, its own faction's: the
// outermost open ring, short of the last, while no Dreadnought is awake as
// its gate and the season isn't won (#223 decisions 4 and 5).
func (h *Hub) raidRing() (int, bool) {
	ring := h.frontier.OpenRings
	if h.seasonWon || ring < 1 || ring >= sim.GridRings {
		return 0, false
	}
	if _, awake := h.enemies[h.dreadnoughtID]; awake {
		return 0, false
	}

	return ring, true
}

// raidEveryOf is the bounds of the ticks between raids: the options', or
// the sim's.
func raidEveryOf(o hubOptions) [2]uint32 {
	if o.raidEvery != [2]uint32{} {
		return o.raidEvery
	}

	return [2]uint32{raidEveryMin, raidEveryMax}
}

// raidInterval is the ticks until the next raid, drawn between the bounds.
func (h *Hub) raidInterval() uint32 {
	lo, hi := h.raidEvery[0], h.raidEvery[1]
	if hi <= lo {
		return lo
	}

	return lo + uint32(h.rng.IntN(int(hi-lo+1))) //nolint:gosec // minutes in ticks.
}

// stepRaids runs the raid under way, or starts the next once it's due, the
// raided ring has a sector cleared, and a player is up in a hostile sector
// of it. The clock starts again whenever no raid may come.
func (h *Hub) stepRaids(ships []upShip) {
	ring, ok := h.raidRing()
	if h.raid != nil {
		h.stepRaid(ring)

		return
	}
	if !ok || h.ringCleared(ring) == 0 {
		h.nextRaid = 0

		return
	}
	if h.nextRaid == 0 {
		h.nextRaid = later(h.tick, h.raidInterval())

		return
	}
	if h.tick < h.nextRaid {
		return
	}
	if s, found := h.raidSector(ring); found {
		h.warnRaid(s, ships)
	}
}

// raidSector is the hostile sector of ring a player is up in, drawn among
// them, if any is.
func (h *Hub) raidSector(ring int) (sim.Sector, bool) {
	var sectors []sim.Sector
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[id]
		if m.gone || m.state == nil || downed(m.state) {
			continue
		}
		s, ok := sim.SectorAt(float64(m.state.GetX()), float64(m.state.GetY()))
		if ok && s.Ring() == ring && h.hostile(s) {
			sectors = append(sectors, s)
		}
	}
	if len(sectors) == 0 {
		return sim.Sector{}, false
	}

	return sectors[h.rng.IntN(len(sectors))], true
}

// hostile reports whether s is open, held by the enemy, and not home.
func (h *Hub) hostile(s sim.Sector) bool {
	return s != sim.HomeSector() && !h.cleared[s] && h.frontier.Open(s)
}

// warnRaid announces a raid on s by the raided ring's faction, at a spot in
// s out of every ship's sight; with no such spot, it tries again next tick.
func (h *Hub) warnRaid(s sim.Sector, ships []upShip) {
	var at point
	found := false
	for range raidSpotTrials {
		p := h.roamPoint(s, roamMargin)
		if _, d := nearestShip(p, ships); d > sim.DreadnoughtRaidClearance {
			at, found = p, true

			break
		}
	}
	if !found {
		return
	}
	h.raid = &raid{
		faction: sim.FactionOfRing(s.Ring()),
		sector:  s,
		at:      at,
		arrives: h.tick + raidWarnTicks,
	}
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_RaidWarned{RaidWarned: &pb.RaidWarned{
		Faction: pbEnemyFaction(h.raid.faction),
		Sector:  s.Name(),
		Tick:    h.raid.arrives,
	}}}, "")
}

// stepRaid brings the raider in once it's due, and sends it off when ring,
// the ring that may be raided now (0 for none), isn't its own any more, its
// time is up, or everyone near it is down.
func (h *Hub) stepRaid(ring int) {
	r := h.raid
	if ring == 0 || sim.FactionOfRing(ring) != r.faction {
		h.endRaid(false, nil)

		return
	}
	if r.enemyID == 0 {
		if h.tick >= r.arrives {
			h.raiderArrives()
		}

		return
	}
	e, here := h.enemies[r.enemyID]
	if !here {
		h.raid = nil

		return
	}
	if h.tick >= r.leaves || h.allNearDown(e) {
		h.endRaid(false, nil)
	}
}

// raiderArrives puts the raiding Dreadnought on the field, with its saved
// share of health, a tenth of its maximum away from being driven off.
func (h *Hub) raiderArrives() {
	r := h.raid
	share := h.dreadnoughtShare(r.faction)
	h.nextEnemy++
	e := &enemy{
		id:       h.nextEnemy,
		kind:     pb.EnemyKind_ENEMY_KIND_DREADNOUGHT,
		faction:  r.faction,
		x:        r.at.x,
		y:        r.at.y,
		angle:    quarterTurn,
		lastNear: h.tick,
		dread: &dreadnoughtFight{
			sector: r.sector,
			shield: sim.DreadnoughtShield,
			share:  share,
			weight: h.onlineWeight(),
			dealt:  map[string]*dealing{},
			raid:   r,
		},
	}
	e.hp = e.dread.hp()
	h.enemies[e.id] = e
	r.enemyID, r.leaves = e.id, h.tick+raidTicks
	r.floor = math.Max(0, share-sim.DreadnoughtRaidShare)
}

// allNearDown reports whether any ship is within reach of e and every one
// of them is down: a raider doesn't camp over the downed.
func (h *Hub) allNearDown(e *enemy) bool {
	near, up := false, false
	note := func(x, y float64, isDown bool) {
		if math.Hypot(x-e.x, y-e.y) > sim.FrigateReach {
			return
		}
		near = true
		up = up || !isDown
	}
	for _, m := range h.members {
		if !m.gone && m.state != nil {
			note(float64(m.state.GetX()), float64(m.state.GetY()), downed(m.state))
		}
		for _, c := range m.wing.Companions {
			note(c.Ship.X, c.Ship.Y, c.Ship.Downed())
		}
	}

	return near && !up
}

// driveOff sends the raider e off, its tenth taken: every player up near it
// gets a part (#223 decision 10).
func (h *Hub) driveOff(e *enemy) {
	h.endRaid(true, h.partsNear(e))
}

// endRaid teleports the raider out, if it has arrived, keeping the share of
// health it has left, tells everyone, and starts the clock to the next.
//
//nolint:revive // drivenOff is what everyone is told, not a mode.
func (h *Hub) endRaid(drivenOff bool, gains []*pb.PickupGain) {
	r := h.raid
	h.raid = nil
	h.nextRaid = later(h.tick, h.raidInterval())
	ended := &pb.RaidEnded{
		Faction:   pbEnemyFaction(r.faction),
		DrivenOff: drivenOff,
		Gains:     gains,
		Tick:      h.tick,
	}
	if e, here := h.enemies[r.enemyID]; here {
		h.dreadnoughtShares[e.faction] = e.dread.share
		h.saveDreadnoughtShare(e.faction, e.dread.share)
		h.logDreadnoughtDamage(e, true)
		delete(h.enemies, e.id)
		ended.EnemyId = e.id
	}
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_RaidEnded{RaidEnded: ended}}, "")
}

// devStartRaid sends a raid on the hostile sector player is in at once, on
// a development server, whatever the clock says (#223).
func (h *Hub) devStartRaid(player string) {
	m := h.members[player]
	if !h.development || h.raid != nil || m == nil || m.state == nil {
		return
	}
	ring, ok := h.raidRing()
	s, in := sim.SectorAt(float64(m.state.GetX()), float64(m.state.GetY()))
	if !ok || !in || s.Ring() != ring || !h.hostile(s) {
		return
	}
	h.warnRaid(s, h.upShips())
}
