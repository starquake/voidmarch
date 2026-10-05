package game

import (
	"maps"
	"math"
	"slices"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// pickupTicks is how long a pickup waits, in hub ticks.
const pickupTicks = sim.PickupLifetime * TickRate

// saveQueue is how many saves may wait for the saver before the hub waits
// for it.
const saveQueue = 256

// pickup is a part a kill left behind, until someone collects it (#77).
type pickup struct {
	part           sim.Part
	x, y           float64
	tick, goneTick uint32
}

// WithDropChance makes every kill drop a part at chance instead of its
// kind's, for E2E.
func WithDropChance(chance float64) HubOption {
	return func(o *hubOptions) {
		o.dropChance, o.dropChanceSet = chance, true
	}
}

// WithSaveUnlock has the hub call save with every part it grants, at its new
// tier. save runs off the tick goroutine.
func WithSaveUnlock(save func(player string, part sim.Part, tier sim.Tier)) HubOption {
	return func(o *hubOptions) {
		o.saveUnlock = save
	}
}

// startSaver starts the goroutine that runs the saves the hub queues, in
// order, if it has a saver at all, and returns a channel closed once it has
// stopped.
func (h *Hub) startSaver() <-chan struct{} {
	done := make(chan struct{})
	savers := []bool{
		h.saveUnlock != nil,
		h.saveLoadout != nil,
		h.saveSector != nil,
		h.forgetSector != nil,
		h.saveDreadnought != nil,
		h.saveOpenRings != nil,
		h.saveSeasonWon != nil,
		h.saveStats != nil,
	}
	if !slices.Contains(savers, true) {
		close(done)

		return done
	}
	h.saves = make(chan func(), saveQueue)
	go func() {
		defer close(done)
		for save := range h.saves {
			save()
		}
	}()

	return done
}

// dropPickup rolls e's drop and puts it where e died (#6, decisions 8 and 14).
func (h *Hub) dropPickup(e *enemy) {
	var nearby, behind []sim.Unlocks
	for id, m := range h.members {
		if m.gone || m.state == nil ||
			math.Hypot(float64(m.state.GetX())-e.x, float64(m.state.GetY())-e.y) > sim.DropReach {
			continue
		}
		nearby = append(nearby, m.unlocks)
		if sim.Behind(m.unlocks, h.squadmateUnlocks(id, m)) {
			behind = append(behind, m.unlocks)
		}
	}
	chance := sim.DropChance(simEnemyKind(e.kind))
	if h.dropChanceSet {
		chance = h.dropChance
	}
	part, ok := sim.DropFor(nearby, behind, chance, h.rng.Uint32())
	if !ok {
		return
	}
	h.nextPickup++
	p := &pickup{part: part, x: e.x, y: e.y, tick: h.tick, goneTick: h.tick + pickupTicks}
	h.pickups[h.nextPickup] = p
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_PickupDropped{
		PickupDropped: pickupMessage(h.nextPickup, p),
	}}, "")
}

// squadmateUnlocks are the unlocks of the players in m's squadron but id.
func (h *Hub) squadmateUnlocks(id string, m *member) []sim.Unlocks {
	mates := h.squadmates(id, m)
	out := make([]sim.Unlocks, 0, len(mates))
	for _, mate := range mates {
		out = append(out, h.members[mate].unlocks)
	}

	return out
}

// squadmates are the players in m's squadron but id, in id order; none
// without a squadron.
func (h *Hub) squadmates(id string, m *member) []string {
	if m.squadron == "" {
		return nil
	}
	var out []string
	for other, o := range h.members {
		if other != id && !o.gone && o.squadron == m.squadron {
			out = append(out, other)
		}
	}
	slices.Sort(out)

	return out
}

// collect grants a pickup id flew over to them and their squadmates, each
// unlocking the part or raising its tier (#6, decisions 9 and 11). Nobody
// able to use it leaves it for someone who can.
func (h *Hub) collect(id string, m *member, pickupID uint32) {
	p, ok := h.pickups[pickupID]
	if !ok {
		return
	}
	var gains []*pb.PickupGain
	for _, who := range append([]string{id}, h.squadmates(id, m)...) {
		unlocks := h.members[who].unlocks
		if !unlocks.Grant(p.part) {
			continue
		}
		tier := unlocks[p.part]
		gains = append(gains, &pb.PickupGain{
			PlayerId: who,
			Unlock: &pb.Unlock{
				Part: pbPart(p.part),
				Tier: wireTier(tier),
			},
		})
		if h.saveUnlock != nil {
			part := p.part
			h.saves <- func() { h.saveUnlock(who, part, tier) }
		}
	}
	if len(gains) == 0 {
		return
	}
	delete(h.pickups, pickupID)
	h.broadcast(&pb.ServerMessage{Kind: &pb.ServerMessage_PickupTaken{PickupTaken: &pb.PickupTaken{
		Id:       pickupID,
		PlayerId: id,
		Gains:    gains,
	}}}, "")
}

// expirePickups forgets the pickups whose time is up; clients know the tick.
func (h *Hub) expirePickups() {
	for id, p := range h.pickups {
		if h.tick >= p.goneTick {
			delete(h.pickups, id)
		}
	}
}

// pickupMessages are the pickups on the ground, for a Welcome, in id order.
func (h *Hub) pickupMessages() []*pb.PickupDropped {
	out := make([]*pb.PickupDropped, 0, len(h.pickups))
	for _, id := range slices.Sorted(maps.Keys(h.pickups)) {
		out = append(out, pickupMessage(id, h.pickups[id]))
	}

	return out
}

func pickupMessage(id uint32, p *pickup) *pb.PickupDropped {
	return &pb.PickupDropped{
		Id:       id,
		Part:     pbPart(p.part),
		X:        float32(p.x),
		Y:        float32(p.y),
		Tick:     p.tick,
		GoneTick: p.goneTick,
	}
}

// pbUnlocks are unlocks on the wire, in sim.Parts order.
func pbUnlocks(unlocks sim.Unlocks) []*pb.Unlock {
	var out []*pb.Unlock
	for _, part := range sim.Parts() {
		if tier, ok := unlocks[part]; ok {
			out = append(
				out,
				&pb.Unlock{Part: pbPart(part), Tier: wireTier(tier)},
			)
		}
	}

	return out
}

// pbPart is a part on the wire.
func pbPart(part sim.Part) *pb.Part {
	switch {
	case slices.Contains(sim.Weapons(), sim.WeaponID(part)):
		return &pb.Part{Kind: &pb.Part_Weapon{Weapon: pbWeapon(sim.WeaponID(part))}}
	case slices.Contains(sim.Engines(), sim.EngineID(part)):
		return &pb.Part{Kind: &pb.Part_Engine{Engine: pbEngine(sim.EngineID(part))}}
	default:
		return &pb.Part{Kind: &pb.Part_Shield{Shield: pbShield(sim.ShieldID(part))}}
	}
}

// wireTier is a tier on the wire.
func wireTier(t sim.Tier) uint32 {
	return uint32(min(max(t, sim.TierPlain), sim.TierHyper)) //nolint:gosec // held to 0 through 3.
}

// WithSaveLoadout has the hub call save with each loadout a player fits at
// home (#78). save runs off the tick goroutine.
func WithSaveLoadout(save func(player string, l sim.Loadout)) HubOption {
	return func(o *hubOptions) {
		o.saveLoadout = save
	}
}

// saveFittedLoadout saves the loadout m's ship reports, when it changed and
// is made of parts the player owns, wherever it was fitted (#191); tiers
// come from the unlocks, so they aren't saved.
func (h *Hub) saveFittedLoadout(id string, m *member) {
	l := simLoadout(m.state.GetLoadout())
	l.WeaponTier, l.EngineTier, l.ShieldTier = 0, 0, 0
	if l == m.loadout || !m.unlocks.Allows(l) {
		return
	}
	m.loadout = l
	if h.saveLoadout != nil {
		h.saves <- func() { h.saveLoadout(id, l) }
	}
}

// savedLoadout is a saved loadout for a Welcome, at the player's tiers; nil
// for none, or one with a part they no longer own.
func savedLoadout(l sim.Loadout, unlocks sim.Unlocks) *pb.Loadout {
	if l.Weapon == "" || !unlocks.Allows(l) {
		return nil
	}

	return &pb.Loadout{
		Weapon:     pbWeapon(l.Weapon),
		Engine:     pbEngine(l.Engine),
		Shield:     pbShield(l.Shield),
		WeaponTier: wireTier(unlocks[sim.Part(l.Weapon)]),
		EngineTier: wireTier(unlocks[sim.Part(l.Engine)]),
		ShieldTier: wireTier(unlocks[sim.Part(l.Shield)]),
	}
}

// WithDevelopment tells the players this is a development server, where the
// 1/2/3 keys fit any part (#78, decision 6).
func WithDevelopment() HubOption {
	return func(o *hubOptions) {
		o.development = true
	}
}
