// Package game runs the shared world: who is in it, where their ships are, and
// what they fire. Clients are trusted for their own ships (docs/design.md,
// section 9), so the hub relays those; it simulates only the enemies.
package game

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"math"
	"math/rand/v2"
	"slices"
	"time"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

const (
	// TickRate is how many snapshots a second the hub sends.
	TickRate = 20
	// MaxPlayers is how many players fit in the world at once.
	MaxPlayers = 16
	// silenceTicks is how long a player may send nothing before their ship
	// goes: long enough to ride out a reload, a short network blip, or a
	// hidden tab whose worker the browser slows too (#57).
	silenceTicks = 10 * TickRate
	// homingTicks is how long a dropped player's companions fly home before
	// they dock anyway (#28).
	homingTicks = 60 * TickRate
	// sendQueue is how many messages may wait for a slow client before it is
	// dropped rather than slowing everyone down.
	sendQueue = 64

	spawnRadius    = 180
	spawnSlots     = 16
	spawnClearance = 64
	quarterTurn    = math.Pi / 2
	fullTurn       = 2 * math.Pi
)

// ErrFull is returned by [Hub.Join] when the world has no room.
var ErrFull = errors.New("the frontier is full, try again soon")

// ErrStopped is returned by [Hub.Join] once the hub has stopped.
var ErrStopped = errors.New("the hub has stopped")

// colors are the name colors, one per player slot, readable on the dark
// background.
//
//nolint:revive // a color palette is data, not magic numbers.
func colors() [MaxPlayers]uint32 {
	return [MaxPlayers]uint32{
		0x8fd8ff, 0xffb070, 0xb4ff8c, 0xff8fc8, 0xfff08a, 0xb9a0ff, 0x7fffd4, 0xff9a8a,
		0xa0c4ff, 0xe0ff70, 0xffc0f0, 0x70e0ff, 0xffd0a0, 0x9affb0, 0xd8b0ff, 0xf0f0f0,
	}
}

// Session is one connected player. Messages for them arrive on Out, which the
// hub closes when they leave, are dropped or the hub stops.
type Session struct {
	Player players.Player
	Out    <-chan *pb.ServerMessage

	queue chan *pb.ServerMessage
	hub   *Hub
}

// Send passes a message from the player to the hub. It never blocks once the
// hub has stopped.
func (s *Session) Send(msg *pb.ClientMessage) {
	select {
	case s.hub.incoming <- inbound{session: s, msg: msg}:
	case <-s.hub.done:
	}
}

// Leave removes the player's ship.
func (s *Session) Leave() {
	select {
	case s.hub.leave <- s:
	case <-s.hub.done:
	}
}

type inbound struct {
	session *Session
	msg     *pb.ClientMessage
}

type joinRequest struct {
	player players.Player
	reply  chan joinResult
}

type joinResult struct {
	session *Session
	welcome *pb.Welcome
	err     error
}

type member struct {
	session    *Session
	color      uint32
	state      *pb.ShipState
	lastSeen   uint32
	companions map[uint32]*companion
	// wing flies the companions, following this player's latest state.
	wing *sim.Wing
	// attackers are the enemies that fired near this player or their
	// companions, which defensive orders and return fire answer.
	attackers map[uint32]bool
	// squadron is the name of the player's squadron, "" until they choose.
	squadron string
	// held counts the companion ships this player took the place of on
	// joining; they go back to the hangar when the player leaves, so joining
	// never adds ships to it.
	held int
	// gone is set once the player dropped while companions were out: the
	// member stays only for them, flying home from where the player was
	// last seen, until homeBy (#28).
	gone   bool
	last   sim.Mover
	homeBy uint32
	// unlocks are the parts the player owns, at their tiers (#77).
	unlocks sim.Unlocks
	// loadout is the loadout last saved for them (#78).
	loadout sim.Loadout
	// lastHitShot is the last shot counted as a hit, so a piercing shot
	// counts once (#154).
	lastHitShot uint32
}

// Hub owns the shared world. All of its state is touched only by the goroutine
// running [Hub.Run]; everything else talks to it through channels.
type Hub struct {
	logger   *slog.Logger
	join     chan joinRequest
	leave    chan *Session
	incoming chan inbound
	done     chan struct{}

	tick      uint32
	members   map[string]*member
	enemies   map[uint32]*enemy
	nextEnemy uint32
	rng       *rand.Rand
	nextGrant uint64
	squadrons map[string]*squadron
	// hangar is how many companion ships wait to be drawn (docs/design.md, section 13).
	hangar int
	// saveFleet keeps the fleet across restarts, off the tick goroutine
	// through fleetSaves; savedFleet is the last count queued, -1 for none.
	saveFleet  func(ships int)
	fleetSaves chan int
	savedFleet int
	// pickups are the parts on the ground (#77). saves carries the unlocks
	// and loadouts to save, in order, to the saver goroutine.
	pickups    map[uint32]*pickup
	nextPickup uint32
	// derelicts wait to be rescued into the hangar (#52).
	derelicts     map[uint32]*derelict
	nextDerelict  uint32
	derelictSpots []point
	// cleared are the sectors whose garrison is gone (#99).
	cleared       map[sim.Sector]bool
	garrisons     map[sim.Sector]*garrison
	lastStraggler map[sim.Sector]uint32
	// departed keeps what left players last had, for their rejoin.
	departed map[string]kept
	// event is the world event running, nil for none (#102), and the
	// schedule of the next.
	event        *worldEvent
	eventTimes   eventTimes
	nextEvent    uint32
	nextOffline  uint32
	lastOnline   uint32
	forgetSector func(name string)
	worldMap     *world.Map
	frontier     sim.Frontier
	// dreadnoughtID is the awake Dreadnought, 0 while none is (one wakes at
	// a time); dreadnoughtShares each faction's share of health left as
	// saved, for when it wakes (#124, #132, #140).
	dreadnoughtID     uint32
	dreadnoughtShares map[sim.EnemyFaction]float64
	saveDreadnought   func(faction sim.EnemyFaction, share float64)
	saveOpenRings     func(rings int)
	// seasonWon is set once the finale falls (#153), seasonStarted and
	// seasonWonAt say when, and names are the players' names, for its
	// result (#156).
	seasonWon     bool
	seasonStarted time.Time
	seasonWonAt   time.Time
	saveSeasonWon func(at time.Time)
	names         map[string]string
	now           func() time.Time
	// stats are every player's season stats who joined since the hub
	// started, statsChanged those not saved since they changed (#154).
	stats        map[string]*players.Stats
	statsChanged map[string]bool
	// standingsChanged is set when a stat changed since the last Standings.
	standingsChanged bool
	saveStats        func(player string, s players.Stats)
	garrisonField    int
	saveSector       func(name string)
	dropChance       float64
	dropChanceSet    bool
	saveUnlock       func(player string, part sim.Part, tier sim.Tier)
	saveLoadout      func(player string, l sim.Loadout)
	saves            chan func()
	development      bool
	// frigates are the map's Frigate spots and the tick each may next have a
	// Frigate again (#89).
	frigates []frigateSpot
	// shots are the companions' shots and the enemies' bullets in flight.
	shots *sim.Pool
	// relayed are players' shots in flight, for the enemies that dodge
	// (#138).
	relayed []relayedShot
	// volleys are enemy volleys announced but not yet fired.
	volleys []volley
	// rams are the recent rams between bodies, for the cooldown.
	rams sim.Rams[ramPair]
}

// HubOption configures a [Hub].
type HubOption func(*hubOptions)

type hubOptions struct {
	seed      uint64
	seeded    bool
	poolStart int
	saveFleet func(ships int)
	// dropChance replaces every kind's chance when dropChanceSet.
	dropChance        float64
	dropChanceSet     bool
	saveUnlock        func(player string, part sim.Part, tier sim.Tier)
	saveLoadout       func(player string, l sim.Loadout)
	development       bool
	worldMap          *world.Map
	openRings         int
	dreadnoughtShares map[sim.EnemyFaction]float64
	saveDreadnought   func(faction sim.EnemyFaction, share float64)
	saveOpenRings     func(rings int)
	seasonStarted     time.Time
	seasonWonAt       time.Time
	saveSeasonWon     func(at time.Time)
	standings         []players.Standing
	now               func() time.Time
	saveStats         func(player string, s players.Stats)
	cleared           []string
	saveSector        func(name string)
	forgetSector      func(name string)
	eventTimes        *eventTimes
	// setup runs on the new hub, for tests that start from a given world.
	setup []func(*Hub)
}

// WithPoolStart sets how many companion ships the hangar holds at start.
// Without it the hangar has a ship for every seat, so it never limits.
func WithPoolStart(ships int) HubOption {
	return func(o *hubOptions) {
		o.poolStart = ships
	}
}

// WithSaveFleet has the hub call save with the fleet, every companion ship
// in the hangar or out, when it starts and whenever that count changes, so a
// restart can start the hangar from it. save runs off the tick goroutine.
func WithSaveFleet(save func(ships int)) HubOption {
	return func(o *hubOptions) {
		o.saveFleet = save
	}
}

// WithSeed makes the hub's randomness (spawns, steering, fire timing)
// repeatable, for tests.
func WithSeed(seed uint64) HubOption {
	return func(o *hubOptions) {
		o.seed, o.seeded = seed, true
	}
}

// NewHub returns a hub; start it with [Hub.Run].
func NewHub(logger *slog.Logger, opts ...HubOption) *Hub {
	o := hubOptions{poolStart: MaxPlayers, openRings: 1}
	for _, opt := range opts {
		opt(&o)
	}

	h := &Hub{
		logger:   logger,
		join:     make(chan joinRequest),
		leave:    make(chan *Session),
		incoming: make(chan inbound),
		done:     make(chan struct{}),
		members:  make(map[string]*member),
		enemies:  make(map[uint32]*enemy),
		rng:      newRand(o),

		squadrons: make(map[string]*squadron),
		hangar:    o.poolStart,
		shots:     sim.NewPool(shotCapacity),

		saveFleet:  o.saveFleet,
		savedFleet: -1,

		pickups:       make(map[uint32]*pickup),
		derelicts:     make(map[uint32]*derelict),
		derelictSpots: derelictSpots(o.worldMap),
		cleared:       clearedSet(o.cleared),
		saveSector:    o.saveSector,
		dropChance:    o.dropChance,
		dropChanceSet: o.dropChanceSet,
		saveUnlock:    o.saveUnlock,
		saveLoadout:   o.saveLoadout,
		development:   o.development,
		frigates:      frigateSpots(o.worldMap),
	}
	h.garrisons = newGarrisons(o.worldMap, h.cleared)
	h.lastStraggler = make(map[sim.Sector]uint32)
	h.departed = make(map[string]kept)
	h.worldMap = o.worldMap
	h.frontier = sim.Frontier{OpenRings: o.openRings}
	h.dreadnoughtShares = map[sim.EnemyFaction]float64{}
	maps.Copy(h.dreadnoughtShares, o.dreadnoughtShares)
	h.saveDreadnought = o.saveDreadnought
	h.saveOpenRings = o.saveOpenRings
	h.seasonStarted, h.seasonWonAt = o.seasonStarted, o.seasonWonAt
	h.seasonWon, h.saveSeasonWon = !o.seasonWonAt.IsZero(), o.saveSeasonWon
	h.now = o.now
	if h.now == nil {
		h.now = time.Now
	}
	h.stats, h.statsChanged = make(map[string]*players.Stats), make(map[string]bool)
	h.names = make(map[string]string)
	for _, st := range o.standings {
		s := st.Stats
		h.stats[st.ID], h.names[st.ID] = &s, st.Name
	}
	h.saveStats = o.saveStats
	h.forgetSector = o.forgetSector
	h.eventTimes = defaultEventTimes()
	if o.worldMap != nil && o.worldMap.NoEvents {
		h.eventTimes.every, h.eventTimes.offlineEvery = math.MaxUint32, math.MaxUint32
	}
	if o.eventTimes != nil {
		h.eventTimes = *o.eventTimes
	}
	h.nextEvent = h.eventTimes.every
	h.nextOffline = h.eventTimes.offlineEvery
	h.garrisonField = garrisonField(o.worldMap)
	for _, setup := range o.setup {
		setup(h)
	}

	return h
}

// newRand returns the hub's random source: seeded for tests, else random.
// It drives spawns, steering and fire timing, never anything secret.
func newRand(o hubOptions) *rand.Rand {
	seed := o.seed
	if !o.seeded {
		seed = rand.Uint64() //nolint:gosec // game randomness, not security.
	}
	const mix = 0x9e3779b97f4a7c15

	return rand.New(rand.NewPCG(seed, seed^mix)) //nolint:gosec // game randomness, not security.
}

// Join adds a player's ship to the world. A player who is already in (a
// second tab, a reconnect) replaces their old session.
func (h *Hub) Join(ctx context.Context, player players.Player) (*Session, *pb.Welcome, error) {
	reply := make(chan joinResult, 1)
	select {
	case h.join <- joinRequest{player: player, reply: reply}:
	case <-h.done:
		return nil, nil, ErrStopped
	case <-ctx.Done():
		return nil, nil, fmt.Errorf("error joining: %w", context.Cause(ctx))
	}

	res := <-reply

	return res.session, res.welcome, res.err
}

// Run steps the hub on every tick until ctx is done, then closes every session.
func (h *Hub) Run(ctx context.Context, ticks <-chan time.Time) {
	saverDone := h.startFleetSaver()
	savesDone := h.startSaver()
	defer func() {
		// Saved before the members go: removing them doesn't dock their ships.
		h.queueFleetSave()
		h.saveChangedStats()
		for id := range h.members {
			h.remove(id)
		}
		if h.fleetSaves != nil {
			close(h.fleetSaves)
		}
		if h.saves != nil {
			close(h.saves)
		}
		<-saverDone
		<-savesDone
		close(h.done)
	}()
	h.queueFleetSave()

	for {
		select {
		case <-ctx.Done():
			return
		case req := <-h.join:
			req.reply <- h.admit(req.player)
		case s := <-h.leave:
			if m, ok := h.members[s.Player.ID]; ok && m.session == s {
				h.drop(s.Player.ID, "left")
			}
		case in := <-h.incoming:
			h.handleMessage(in)
		case <-ticks:
			h.step()
			h.expirePickups()
			h.queueFleetSave()
			if h.tick%statsSaveEvery == 0 {
				h.saveChangedStats()
				h.sendStandingsIfChanged()
			}
		}
	}
}

// startFleetSaver starts the goroutine that saves the fleet, if there's a
// saver, and returns a channel closed once it has stopped.
func (h *Hub) startFleetSaver() <-chan struct{} {
	done := make(chan struct{})
	if h.saveFleet == nil {
		close(done)

		return done
	}
	h.fleetSaves = make(chan int, 1)
	go func() {
		defer close(done)
		for ships := range h.fleetSaves {
			h.saveFleet(ships)
		}
	}()

	return done
}

// queueFleetSave hands the fleet to the saver when it changed, replacing a
// count still waiting: only the latest matters.
func (h *Hub) queueFleetSave() {
	ships := h.fleet()
	if h.fleetSaves == nil || ships == h.savedFleet {
		return
	}
	h.savedFleet = ships
	select {
	case h.fleetSaves <- ships:
	default:
		select {
		case <-h.fleetSaves:
		default:
		}
		h.fleetSaves <- ships
	}
}

// fleet is every companion ship: docked in the hangar, out with a player, or
// held for a joiner who took one's place.
func (h *Hub) fleet() int {
	ships := h.hangar
	for _, m := range h.members {
		ships += len(m.companions) + m.held
	}

	return ships
}

func (h *Hub) handleJoin(player players.Player) joinResult {
	// A player who is back (a reconnect, a second tab) keeps their companions
	// and their squadron.
	companions := make(map[uint32]*companion)
	wing := &sim.Wing{Key: wingKey(player.ID)}
	attackers := make(map[uint32]bool)
	var squadron string
	var held int
	unlocks, loadout := h.newestKept(player)
	if old, ok := h.members[player.ID]; ok {
		// The hub's copies are the newest: saving them may still be under way.
		unlocks, loadout = old.unlocks, old.loadout
		companions, wing, attackers = old.companions, old.wing, old.attackers
		squadron = old.squadron
		held = old.held
		if old.gone {
			// Back in time: the companions heading home turn back to them.
			for _, c := range wing.Companions {
				c.Orders.OneShot, c.Pending = sim.OneShot{}, nil
			}
		} else {
			close(old.session.queue)
		}
		delete(h.members, player.ID)
	} else if h.seats() >= MaxPlayers {
		if !h.displaceNewestCompanion() {
			return joinResult{err: ErrFull}
		}
		held = 1
	}

	out := make(chan *pb.ServerMessage, sendQueue)
	s := &Session{Player: player, Out: out, queue: out, hub: h}
	color := h.freeColor()
	spawnX, spawnY := h.freeSpawn()
	h.members[player.ID] = &member{
		session:    s,
		color:      color,
		lastSeen:   h.tick,
		companions: companions,
		wing:       wing,
		attackers:  attackers,
		squadron:   squadron,
		held:       held,
		unlocks:    unlocks,
		loadout:    loadout,
	}
	h.logger.Info(
		"player joined",
		slog.String("playerId", player.ID),
		slog.String("name", player.Name),
	)

	welcome := &pb.Welcome{
		PlayerId:       player.ID,
		Name:           player.Name,
		Color:          color,
		SpawnX:         spawnX,
		SpawnY:         spawnY,
		Tick:           h.tick,
		TickRate:       TickRate,
		CompanionLimit: companionLimit,
		Companions:     slices.Sorted(maps.Keys(companions)),
		Squadrons:      h.squadronsMessage(),
		Squadron:       squadron,
		Unlocks:        pbUnlocks(unlocks),
		Pickups:        h.pickupMessages(),
		Loadout:        savedLoadout(loadout, unlocks),
		Development:    h.development,
		ClearedSectors: h.clearedNames(),
		WorldEvent:     eventMessage(h.event),
		MapName:        h.mapName(),
		Frontier:       h.frontierMessage(),
	}

	return joinResult{session: s, welcome: welcome}
}

func (h *Hub) handleMessage(in inbound) {
	m, ok := h.members[in.session.Player.ID]
	if !ok || m.session != in.session || m.gone {
		return
	}
	m.lastSeen = h.tick

	switch kind := in.msg.GetKind().(type) {
	case *pb.ClientMessage_State:
		if m.state != nil && !downed(m.state) && downed(kind.State) {
			h.countStat(in.session.Player.ID, func(s *players.Stats) { s.Deaths++ })
		}
		m.state = kind.State
		h.saveFittedLoadout(in.session.Player.ID, m)
	case *pb.ClientMessage_Hit:
		// The hub tests its companions' shots itself; a client reports its own.
		if kind.Hit.GetCompanion() == 0 { //nolint:staticcheck // ignoring the deprecated field is the point.
			id := in.session.Player.ID
			shot := shotHit{
				id:     kind.Hit.GetShotId(),
				shard:  kind.Hit.GetShard(),
				goesOn: kind.Hit.GetGoesOn(),
			}
			h.countHit(id, m, shot)
			h.hit(id, id, kind.Hit.GetEnemyId(), shot, kind.Hit.GetDamage())
		}
	case *pb.ClientMessage_Summon:
		h.summon(in.session.Player.ID, m)
	case *pb.ClientMessage_Dismiss:
		h.dismiss(in.session.Player.ID, m, kind.Dismiss.GetCompanion())
	case *pb.ClientMessage_ChooseSquadron:
		h.chooseSquadron(in.session.Player.ID, m, kind.ChooseSquadron.GetName())
	case *pb.ClientMessage_SquadronOrder:
		h.squadronOrder(in.session.Player.ID, m, kind.SquadronOrder)
	case *pb.ClientMessage_Collect:
		h.collect(in.session.Player.ID, m, kind.Collect.GetId())
	case *pb.ClientMessage_PickMission:
		h.pickMission(m, kind.PickMission.GetSector())
	case *pb.ClientMessage_DevStartAttack:
		h.devStartAttack(kind.DevStartAttack.GetSector())
	case *pb.ClientMessage_DevSeasonWon:
		h.devSeasonWon(in.session.Player.ID)
	case *pb.ClientMessage_Shot:
		if kind.Shot.GetCompanion() != 0 {
			return
		}
		shot := &pb.ServerMessage{Kind: &pb.ServerMessage_Shot{Shot: &pb.RemoteShot{
			PlayerId: in.session.Player.ID,
			Tick:     h.tick,
			Shot:     kind.Shot,
		}}}
		h.broadcast(shot, in.session.Player.ID)
		h.noteShot(kind.Shot)
		h.countStat(in.session.Player.ID, func(s *players.Stats) { s.Shots++ })
	default:
	}
}

// step advances one tick: silent players leave, and everyone gets a snapshot
// of everyone else.
func (h *Hub) step() {
	h.tick++

	for id, m := range h.members {
		if !m.gone && h.tick-m.lastSeen > silenceTicks {
			h.drop(id, "silent")
		}
	}

	h.stepEnemies()
	h.fireVolleys()
	h.flyCompanions()
	h.sendLostCompanionsHome()
	h.dockHomingCompanions()
	h.bumpShips()
	h.stepDerelicts()
	h.stepEvents()
	enemies := h.enemySnapshot()
	derelicts := h.derelictSnapshot()
	companions := h.companionSnapshots()

	for id, m := range h.members {
		if m.gone {
			continue
		}
		snapshot := &pb.Snapshot{Tick: h.tick, Enemies: enemies, Derelicts: derelicts}
		for otherID, other := range h.members {
			if otherID == id || other.state == nil {
				continue
			}
			snapshot.Players = append(snapshot.Players, &pb.PlayerSnapshot{
				PlayerId: otherID,
				Name:     other.session.Player.Name,
				Color:    other.color,
				State:    other.state,
				Squadron: other.squadron,
			})
		}
		snapshot.Players = append(snapshot.Players, companions...)
		h.send(id, &pb.ServerMessage{Kind: &pb.ServerMessage_Snapshot{Snapshot: snapshot}})
	}
}

// broadcast sends msg to every member except the one with id except.
func (h *Hub) broadcast(msg *pb.ServerMessage, except string) {
	for id := range h.members {
		if id != except {
			h.send(id, msg)
		}
	}
}

// send queues msg for one member, dropping them if their queue is full.
func (h *Hub) send(id string, msg *pb.ServerMessage) {
	m, ok := h.members[id]
	if !ok || m.gone {
		return
	}
	select {
	case m.session.queue <- msg:
	default:
		h.drop(id, "too slow")
	}
}

// drop takes a player's ship out of the world and tells everyone. Their
// companions stay, flying home (#28): the member stays as gone until they've
// docked, or the player is back.
func (h *Hub) drop(id, reason string) {
	m, ok := h.members[id]
	if !ok || m.gone {
		return
	}
	h.logger.Info("player left", slog.String("playerId", id), slog.String("reason", reason))
	h.saveStatsOf(id)
	h.hangar += m.held
	m.held = 0
	h.leaveSquadron(id, m)
	// Gone before anyone is told: telling a slow player drops them too,
	// and they tell this one (pinned by TestHub_TwoSlowPlayersAreBothDropped).
	if len(m.companions) == 0 {
		h.remove(id)
	} else {
		h.sendHome(m)
	}
	h.broadcast(left(id), id)
	h.broadcastSquadrons()
}

// sendHome turns a dropped player's companions home, flying on from where
// the player was last seen.
func (h *Hub) sendHome(m *member) {
	close(m.session.queue)
	m.gone = true
	m.homeBy = h.tick + homingTicks
	if m.state != nil {
		m.last = mover(m.state)
		m.last.Downed = false
	}
	m.state = nil
	for _, c := range m.wing.Companions {
		c.Orders, _ = sim.WithOneShot(sim.OneShotGoHome, c.Orders, 0)
		c.Pending = nil
	}
}

// dockHomingCompanions docks each companion of a dropped player in the
// hangar once it's home, in the safe zone, or homingTicks after the drop,
// and lets the player go with the last of them.
func (h *Hub) dockHomingCompanions() {
	for _, id := range slices.Sorted(maps.Keys(h.members)) {
		m := h.members[id]
		if !m.gone {
			continue
		}
		for _, number := range slices.Sorted(maps.Keys(m.companions)) {
			s := m.companions[number].flight.Ship
			if h.tick >= m.homeBy || math.Hypot(s.X, s.Y) <= safeRadius {
				h.dismiss(id, m, number)
			}
		}
		if len(m.companions) == 0 {
			delete(h.members, id)
		}
	}
}

func (h *Hub) remove(id string) {
	m := h.members[id]
	if !m.gone {
		close(m.session.queue)
	}
	h.departed[id] = kept{unlocks: m.unlocks, loadout: m.loadout}
	delete(h.members, id)
}

// newestKept is a joining player's unlocks and loadout: what the hub kept
// when they left, if it did, else their stored record.
func (h *Hub) newestKept(player players.Player) (sim.Unlocks, sim.Loadout) {
	if k, ok := h.departed[player.ID]; ok {
		delete(h.departed, player.ID)

		return k.unlocks, k.loadout
	}
	unlocks := sim.DefaultUnlocks()
	maps.Copy(unlocks, player.Unlocks)

	return unlocks, player.Loadout
}

// kept is what the hub last had for a player who left: newer than the
// stored record while its saves are still under way (#93).
type kept struct {
	unlocks sim.Unlocks
	loadout sim.Loadout
}

// freeColor returns the first palette color nobody is using.
func (h *Hub) freeColor() uint32 {
	palette := colors()
	used := make(map[uint32]bool, len(h.members))
	for _, m := range h.members {
		used[m.color] = true
	}
	for _, c := range palette {
		if !used[c] {
			return c
		}
	}

	return palette[0]
}

// freeSpawn returns the first spot on a ring around the home planet with no
// ship near it, starting below the planet.
func (h *Hub) freeSpawn() (x, y float32) {
	for slot := range spawnSlots {
		angle := quarterTurn + float64(slot)*fullTurn/spawnSlots
		x = float32(spawnRadius * math.Cos(angle))
		y = float32(spawnRadius * math.Sin(angle))
		if h.clear(x, y) {
			return x, y
		}
	}

	return 0, spawnRadius
}

func (h *Hub) clear(x, y float32) bool {
	for _, m := range h.members {
		if m.state == nil {
			continue
		}
		if math.Hypot(float64(m.state.GetX()-x), float64(m.state.GetY()-y)) < spawnClearance {
			return false
		}
	}

	return true
}
