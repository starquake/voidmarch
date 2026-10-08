package game

import (
	"log/slog"
	"maps"
	"math"
	"slices"
	"strings"

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
	// dreadnoughtVolleyGap is the wait after a ring, a Wave spread or a
	// spiral, and dreadnoughtBeamGap between the beams of a Ray sweep.
	dreadnoughtVolleyGap = 2 * TickRate
	dreadnoughtBeamGap   = 6
	// spiralCooldown is the ticks skipped between a spiral's bursts.
	spiralCooldown         = max(int(sim.DreadnoughtSpiralEvery*TickRate)-1, 0)
	dreadnoughtShieldTicks = sim.DreadnoughtShieldDelay * TickRate
	// dreadnoughtDerelictRing is how far from the wreck its fall's derelicts wait.
	dreadnoughtDerelictRing = 140
	// dreadnoughtSaveEvery is how often its health is saved while it's awake.
	dreadnoughtSaveEvery = 60 * TickRate
	// regenPerTick is the share of its health it gets back each hub tick.
	regenPerTick = sim.DreadnoughtRegenPerHour / (60 * 60 * TickRate)
	// dreadnoughtLogEvery is how often each ship's damage to it is logged
	// while the ship fights it (#223).
	dreadnoughtLogEvery = 60 * TickRate
)

// dreadnoughtFight is the Dreadnought's state beyond an enemy's: its
// shield, where it is in its turn of volleys, and its health, as the share
// of its maximum left and the weight of the players online that the maximum
// follows (#132).
type dreadnoughtFight struct {
	// sector is the sector it holds.
	sector  sim.Sector
	shield  int
	lastHit uint32
	// turn is how many volleys of its turn (sim.DreadnoughtTurn) it has
	// taken.
	turn int
	// beams is how many beams of a Ray sweep are left, and bursts how many
	// bursts of a spiral; from is the angle the sweep started at.
	beams  int
	bursts int
	from   float64
	// reversed is whether its latest spiral turned the negative way; the
	// next one turns the other (#273).
	reversed bool
	share    float64
	weight   float64
	// dealt is each ship's damage to it in its current minute of fighting,
	// by player id or companion seat, for the log (#223).
	dealt map[string]*dealing
	// raid is the raid it's on, nil for the gate fight (#223).
	raid *raid
	// hpScale multiplies its maximum health; 0 means 1. Tests that measure
	// a long fight raise it so it doesn't fall mid-measurement.
	hpScale float64
}

// drivenOff reports whether a raiding Dreadnought has taken enough this
// visit to leave.
func (f *dreadnoughtFight) drivenOff() bool {
	return f.raid != nil && f.share <= f.raid.floor
}

// dealing is the health a ship took off a Dreadnought since the tick it
// first hit it this minute.
type dealing struct {
	damage float64
	since  uint32
}

// maxHP is its maximum health for the players online now.
func (f *dreadnoughtFight) maxHP() float64 {
	if f.hpScale > 0 {
		return sim.DreadnoughtMaxHP(f.weight) * f.hpScale
	}

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
// With every ring open, the Nautolan one, the season's finale, wakes in ring
// 3 itself, until the season is won (#10 decision 2, #153).
func (h *Hub) wakeDreadnought() {
	inside := h.frontier.OpenRings
	if _, awake := h.enemies[h.dreadnoughtID]; awake || h.seasonWon {
		return
	}
	early := inside == 1 && h.worldMap != nil && h.worldMap.DreadnoughtAwake
	if !early && h.ringCleared(inside) < sim.DreadnoughtWakesAt {
		return
	}
	// Its raid, if it's on one, ends first, keeping the share it took (#223).
	if h.raid != nil {
		h.endRaid(false, nil)
	}
	faction := sim.FactionOfRing(inside)
	ring := min(inside+1, sim.GridRings)
	var spots []sim.Sector
	for _, s := range sim.Sectors() {
		if s.Ring() == ring {
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
			sector: s,
			shield: sim.DreadnoughtShield,
			share:  h.dreadnoughtShare(faction),
			weight: h.onlineWeight(),
			dealt:  map[string]*dealing{},
		},
	}
	e.hp = e.dread.hp()
	h.enemies[e.id] = e
	h.dreadnoughtID = e.id
	if ring > inside {
		h.frontier.Opened = map[sim.Sector]bool{s: true}
		h.broadcastFrontier()
	}
}

// finale reports whether faction's Dreadnought is the season's last, the
// one holding the outer ring (#153).
func finale(faction sim.EnemyFaction) bool {
	return faction == sim.FactionOfRing(sim.GridRings)
}

// closeRingsIfFallenBack closes every ring beyond the first open ring that
// has fewer than sim.DreadnoughtWakesAt cleared sectors (#8 decision 9,
// #140): ring 1 falling back closes rings 2 and 3, ring 2 falling back ring
// 3. Reopening a ring takes its Dreadnought again. A Dreadnought awake
// beyond the new edge goes back to sleep, keeping its share, and so does
// the finale when ring 3 itself falls back (#153). A won season keeps every
// ring open (#10 decision 4).
func (h *Hub) closeRingsIfFallenBack() {
	if h.seasonWon {
		return
	}
	for ring := 1; ring < h.frontier.OpenRings; ring++ {
		if h.ringCleared(ring) >= sim.DreadnoughtWakesAt {
			continue
		}
		h.frontier = sim.Frontier{OpenRings: ring}
		if h.saveOpenRings != nil {
			h.saves <- func() { h.saveOpenRings(ring) }
		}
		h.sleepDreadnought()
		h.broadcastFrontier()

		return
	}
	if e, awake := h.enemies[h.dreadnoughtID]; awake && finale(e.faction) &&
		h.ringCleared(sim.GridRings) < sim.DreadnoughtWakesAt {
		h.sleepDreadnought()
	}
}

// sleepDreadnought puts the awake Dreadnought, if any, back to sleep,
// keeping its share of health for when it wakes again.
func (h *Hub) sleepDreadnought() {
	e, awake := h.enemies[h.dreadnoughtID]
	if !awake {
		return
	}
	h.dreadnoughtShares[e.faction] = e.dread.share
	h.saveDreadnoughtShare(e.faction, e.dread.share)
	h.logDreadnoughtDamage(e, true)
	delete(h.enemies, e.id)
	h.forgetEnemy(e.id)
	h.dreadnoughtID = 0
}

// stepDreadnought scales it to the players online, regenerates it,
// recharges its shield, and fires its volleys in turn once a ship is in
// range, all but the spiral at the nearest one. A spiral, once started, runs
// out whether or not a ship stays in range.
func (h *Hub) stepDreadnought(e *enemy, ships []upShip, online float64) {
	f := e.dread
	e.lastNear = h.tick
	f.weight = online
	f.share = math.Min(1, f.share+regenPerTick)
	e.hp = f.hp()
	if h.tick%dreadnoughtSaveEvery == 0 {
		h.saveDreadnoughtShare(e.faction, f.share)
	}
	h.logDreadnoughtDamage(e, false)
	if f.shield < sim.DreadnoughtShield && h.tick-f.lastHit >= dreadnoughtShieldTicks {
		f.shield = sim.DreadnoughtShield
	}
	if e.cooldown > 0 {
		e.cooldown--

		return
	}
	if f.bursts > 0 {
		h.spiralBurst(e)

		return
	}
	target, distance, found := nearest(e, shipPoints(ships))
	if !found || distance > dreadnoughtFireRange {
		return
	}
	e.angle = math.Atan2(target.y-e.y, target.x-e.x)
	turn := sim.DreadnoughtTurn(e.faction)
	switch turn[f.turn%len(turn)] {
	case sim.DreadnoughtRay:
		if f.beams == 0 {
			f.beams, f.from = sim.DreadnoughtRayBeams, e.angle-halfSweep
		}
		step := sim.DreadnoughtRaySweep / (sim.DreadnoughtRayBeams - 1)
		h.fireVolley(e, f.from+step*float64(sim.DreadnoughtRayBeams-f.beams), sim.DreadnoughtRay)
		f.beams--
		e.cooldown = dreadnoughtGap(e.faction, dreadnoughtBeamGap)
		if f.beams == 0 {
			f.nextVolley(e)
		}
	case sim.DreadnoughtSpiral:
		f.bursts, f.reversed = sim.DreadnoughtSpiralBursts, !f.reversed
		h.spiralBurst(e)
	case sim.DreadnoughtWave:
		h.fireVolley(e, e.angle, sim.DreadnoughtWave)
		f.nextVolley(e)
	case sim.DreadnoughtRing:
		fallthrough
	default:
		h.fireVolley(e, e.angle, sim.DreadnoughtRing)
		f.nextVolley(e)
	}
}

// spiralBurst fires the spiral's next burst, a step further round its
// turn from straight up, or holds it for a pause (#273). Only the first
// warns: restarting the weapon animation every burst would hold it on its
// first frames.
func (h *Hub) spiralBurst(e *enemy) {
	f := e.dread
	burst := sim.DreadnoughtSpiralBursts - f.bursts
	way := 1
	if f.reversed {
		way = -1
	}
	angle := sim.DreadnoughtSpiralAngle(burst, way)
	switch {
	case !sim.DreadnoughtSpiralFires(burst):
	case burst == 0:
		h.fireAt(e, angle, sim.DreadnoughtSeed(h.rng.Uint32(), sim.DreadnoughtSpiral))
	default:
		h.fireUnwarned(e, angle, sim.DreadnoughtSeed(h.rng.Uint32(), sim.DreadnoughtSpiral))
	}
	f.bursts--
	e.cooldown = spiralCooldown
	if f.bursts == 0 {
		f.nextVolley(e)
	}
}

// nextVolley moves e on to its turn's next volley, after the wait.
func (f *dreadnoughtFight) nextVolley(e *enemy) {
	f.turn++
	e.cooldown = dreadnoughtGap(e.faction, dreadnoughtVolleyGap)
}

// dreadnoughtGap is ticks shortened by faction's shots multiplier, so the
// later factions' Dreadnoughts fire more often (#10 decision 8).
func dreadnoughtGap(faction sim.EnemyFaction, ticks int) int {
	return int(math.Round(float64(ticks) / sim.FactionStats(faction).Shots))
}

// takeHit takes shooter's damage, the shield first, off its share, counts
// the health it took for the log, and returns its health after.
func (f *dreadnoughtFight) takeHit(shooter string, damage int, tick uint32) int {
	f.lastHit = tick
	absorbed := min(f.shield, damage)
	f.shield -= absorbed
	before := f.share
	f.share = math.Max(0, f.share-float64(damage-absorbed)/f.maxHP())
	d := f.dealt[shooter]
	if d == nil {
		d = &dealing{since: tick}
		f.dealt[shooter] = d
	}
	d.damage += (before - f.share) * f.maxHP()

	return f.hp()
}

// logDreadnoughtDamage logs the health each ship took off e over its minute
// of fighting once the minute is up, or every ship's so far when all is
// set, so a real fight's rate can be read back (#223).
//
//nolint:revive // all is whether the fight is over, not a mode.
func (h *Hub) logDreadnoughtDamage(e *enemy, all bool) {
	for _, ship := range slices.Sorted(maps.Keys(e.dread.dealt)) {
		d := e.dread.dealt[ship]
		ticks := h.tick - d.since
		if !all && ticks < dreadnoughtLogEvery {
			continue
		}
		delete(e.dread.dealt, ship)
		player, _, _ := strings.Cut(ship, "/")
		l := h.shipLoadout(ship)
		h.logger.Info(
			"dreadnought damage",
			slog.String("ship", ship),
			slog.String("name", h.names[player]),
			slog.String("faction", string(e.faction)),
			slog.String("weapon", string(l.Weapon)),
			slog.Int("tier", int(l.WeaponTier)),
			slog.Int("damage", int(math.Round(d.damage))),
			slog.Float64("seconds", float64(ticks)/TickRate),
		)
	}
}

// shipLoadout is the loadout of a player's ship or a companion's seat, or
// the default loadout once it's gone.
func (h *Hub) shipLoadout(ship string) sim.Loadout {
	player, _, seat := strings.Cut(ship, "/")
	m := h.members[player]
	if m == nil {
		return sim.DefaultLoadout()
	}
	if !seat {
		return simLoadout(m.state.GetLoadout())
	}
	for _, c := range m.companions {
		if seatID(player, c.number) == ship {
			return c.flight.Ship.Loadout
		}
	}

	return sim.DefaultLoadout()
}

// dreadnoughtFallen rewards the players near e, releases its derelicts and
// tells everyone (#125), opens the ring it guarded (#140, replacing #8
// decision 12's "rings 2 and 3 together"), saves a fresh Dreadnought's
// health for the next time its faction's wakes, and clears the sector it
// held (#223). The finale's fall wins the season (#153).
func (h *Hub) dreadnoughtFallen(e *enemy) {
	gains := h.partsNear(e)
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
	h.logDreadnoughtDamage(e, true)
	h.dreadnoughtID = 0
	h.dreadnoughtShares[e.faction] = 1
	h.saveDreadnoughtShare(e.faction, 1)
	// Before the finale's win, so the season's stats count the sector.
	h.clearHeldSector(e.dread.sector)
	if finale(e.faction) {
		h.winSeason()
	}
	opened := min(h.frontier.OpenRings+1, sim.GridRings)
	h.frontier = sim.Frontier{OpenRings: opened}
	if h.saveOpenRings != nil {
		h.saves <- func() { h.saveOpenRings(opened) }
	}
	h.broadcastFrontier()
}

// partsNear grants a part to every player up within reach of e (#125).
func (h *Hub) partsNear(e *enemy) []*pb.PickupGain {
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

	return gains
}

// clearHeldSector clears s, the sector a fallen Dreadnought held, its
// garrison gone with it however much of it is left (#223); a sector cleared
// before, when its ring was open the last time, stays as it is.
func (h *Hub) clearHeldSector(s sim.Sector) {
	if h.cleared[s] {
		return
	}
	var mission []*pb.PlayerStats
	if g := h.garrisons[s]; g != nil {
		mission = h.missionStats(g)
		h.standDown(g)
		delete(h.garrisons, s)
	}
	h.clearSector(s, mission)
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
