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
)

const (
	// TickRate is how many snapshots a second the hub sends.
	TickRate = 20
	// MaxPlayers is how many players fit in the world at once.
	MaxPlayers = 16
	// silenceTicks is how long a player may send nothing before their ship
	// goes: long enough to ride out a reload or a short network blip.
	silenceTicks = 3 * TickRate
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

// colours are the name colours, one per player slot, readable on the dark
// background.
//
//nolint:revive // a colour palette is data, not magic numbers.
func colours() [MaxPlayers]uint32 {
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
	colour     uint32
	state      *pb.ShipState
	lastSeen   uint32
	companions map[uint32]*companion
	// squadron is the name of the player's squadron, "" until they choose.
	squadron string
	// held counts the companion ships this player took the place of on
	// joining; they go back to the hangar when the player leaves, so joining
	// never adds ships to it.
	held int
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
}

// HubOption configures a [Hub].
type HubOption func(*hubOptions)

type hubOptions struct {
	seed      uint64
	seeded    bool
	poolStart int
}

// WithPoolStart sets how many companion ships the hangar holds at start.
// Without it the hangar has a ship for every seat, so it never limits.
func WithPoolStart(ships int) HubOption {
	return func(o *hubOptions) {
		o.poolStart = ships
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
	o := hubOptions{poolStart: MaxPlayers}
	for _, opt := range opts {
		opt(&o)
	}

	return &Hub{
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
	}
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
	defer func() {
		for id := range h.members {
			h.remove(id)
		}
		close(h.done)
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case req := <-h.join:
			req.reply <- h.handleJoin(req.player)
		case s := <-h.leave:
			if m, ok := h.members[s.Player.ID]; ok && m.session == s {
				h.drop(s.Player.ID, "left")
			}
		case in := <-h.incoming:
			h.handleMessage(in)
		case <-ticks:
			h.step()
		}
	}
}

func (h *Hub) handleJoin(player players.Player) joinResult {
	// A player who is back (a reconnect, a second tab) keeps their companions
	// and their squadron.
	companions := make(map[uint32]*companion)
	var squadron string
	var held int
	if old, ok := h.members[player.ID]; ok {
		companions = old.companions
		squadron = old.squadron
		held = old.held
		close(old.session.queue)
		delete(h.members, player.ID)
	} else if h.seats() >= MaxPlayers {
		if !h.displaceNewestCompanion() {
			return joinResult{err: ErrFull}
		}
		held = 1
	}

	out := make(chan *pb.ServerMessage, sendQueue)
	s := &Session{Player: player, Out: out, queue: out, hub: h}
	colour := h.freeColour()
	spawnX, spawnY := h.freeSpawn()
	h.members[player.ID] = &member{
		session:    s,
		colour:     colour,
		lastSeen:   h.tick,
		companions: companions,
		squadron:   squadron,
		held:       held,
	}
	h.logger.Info(
		"player joined",
		slog.String("playerId", player.ID),
		slog.String("name", player.Name),
	)

	welcome := &pb.Welcome{
		PlayerId: player.ID,
		Name:     player.Name,
		Colour:   colour,
		SpawnX:   spawnX,
		SpawnY:   spawnY,
		Tick:     h.tick,
		TickRate: TickRate,

		CompanionLimit: companionLimit,
		Companions:     slices.Sorted(maps.Keys(companions)),
		Squadrons:      h.squadronsMessage(),
		Squadron:       squadron,
	}

	return joinResult{session: s, welcome: welcome}
}

func (h *Hub) handleMessage(in inbound) {
	m, ok := h.members[in.session.Player.ID]
	if !ok || m.session != in.session {
		return
	}
	m.lastSeen = h.tick

	switch kind := in.msg.GetKind().(type) {
	case *pb.ClientMessage_State:
		m.state = kind.State
	case *pb.ClientMessage_Hit:
		if shooter, ok := shooterID(in.session.Player.ID, m, kind.Hit.GetCompanion()); ok {
			h.hit(in.session.Player.ID, shooter, kind.Hit)
		}
	case *pb.ClientMessage_Summon:
		h.summon(in.session.Player.ID, m)
	case *pb.ClientMessage_Companion:
		h.companionState(in.session.Player.ID, m, kind.Companion)
	case *pb.ClientMessage_Dismiss:
		h.dismiss(in.session.Player.ID, m, kind.Dismiss.GetCompanion())
	case *pb.ClientMessage_ChooseSquadron:
		h.chooseSquadron(in.session.Player.ID, m, kind.ChooseSquadron.GetName())
	case *pb.ClientMessage_SquadronOrder:
		h.squadronOrder(in.session.Player.ID, m, kind.SquadronOrder)
	case *pb.ClientMessage_Shot:
		shooter, ok := shooterID(in.session.Player.ID, m, kind.Shot.GetCompanion())
		if !ok {
			return
		}
		shot := &pb.ServerMessage{Kind: &pb.ServerMessage_Shot{Shot: &pb.RemoteShot{
			PlayerId: shooter,
			Tick:     h.tick,
			Shot:     kind.Shot,
		}}}
		h.broadcast(shot, in.session.Player.ID)
	default:
	}
}

// step advances one tick: silent players leave, and everyone gets a snapshot
// of everyone else.
func (h *Hub) step() {
	h.tick++

	for id, m := range h.members {
		if h.tick-m.lastSeen > silenceTicks {
			h.drop(id, "silent")
		}
	}

	h.expireCompanions()
	h.stepEnemies()
	enemies := h.enemySnapshot()

	for id := range h.members {
		snapshot := &pb.Snapshot{Tick: h.tick, Enemies: enemies}
		for otherID, other := range h.members {
			if otherID == id || other.state == nil {
				continue
			}
			snapshot.Players = append(snapshot.Players, &pb.PlayerSnapshot{
				PlayerId: otherID,
				Name:     other.session.Player.Name,
				Colour:   other.colour,
				State:    other.state,
				Squadron: other.squadron,
			})
		}
		snapshot.Players = append(snapshot.Players, h.companionSnapshots(id)...)
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
	if !ok {
		return
	}
	select {
	case m.session.queue <- msg:
	default:
		h.drop(id, "too slow")
	}
}

// drop removes a member and tells everyone else their ship, and their
// companions, are gone.
func (h *Hub) drop(id, reason string) {
	m, ok := h.members[id]
	if !ok {
		return
	}
	h.remove(id)
	h.logger.Info("player left", slog.String("playerId", id), slog.String("reason", reason))
	for _, number := range slices.Sorted(maps.Keys(m.companions)) {
		h.broadcast(left(seatID(id, number)), "")
		h.hangar++
	}
	h.hangar += m.held
	h.broadcast(left(id), "")
	h.leaveSquadron(id, m)
	h.broadcastSquadrons()
}

func (h *Hub) remove(id string) {
	close(h.members[id].session.queue)
	delete(h.members, id)
}

// freeColour returns the first palette colour nobody is using.
func (h *Hub) freeColour() uint32 {
	palette := colours()
	used := make(map[uint32]bool, len(h.members))
	for _, m := range h.members {
		used[m.colour] = true
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
