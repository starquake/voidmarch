package game_test

import (
	"slices"
	"sync"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
	"github.com/starquake/voidmarch/internal/sim"
)

// joinWith joins id owning unlocks.
func joinWith(t *testing.T, hub *Hub, id string, unlocks sim.Unlocks) (*Session, *pb.Welcome) {
	t.Helper()

	s, w, err := hub.Join(t.Context(), players.Player{ID: id, Name: "name-" + id, Unlocks: unlocks})
	if err != nil {
		t.Fatalf("Join(%s) error = %v", id, err)
	}

	return s, w
}

// nextPickupDropped reads s's messages until a pickup drops.
func nextPickupDropped(t *testing.T, s *Session) *pb.PickupDropped {
	t.Helper()

	for {
		if p := next(t, s).GetPickupDropped(); p != nil {
			return p
		}
	}
}

// nextPickupTaken reads s's messages until a pickup is taken.
func nextPickupTaken(t *testing.T, s *Session) *pb.PickupTaken {
	t.Helper()

	for {
		if p := next(t, s).GetPickupTaken(); p != nil {
			return p
		}
	}
}

// killEnemy has s report a hit that destroys enemy 1, the one WithEnemyAt
// adds, and returns the part it drops.
func killEnemy(t *testing.T, s *Session) *pb.PickupDropped {
	t.Helper()

	s.Send(
		&pb.ClientMessage{
			Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{EnemyId: 1, ShotId: 1, Damage: 12}},
		},
	)

	return nextPickupDropped(t, s)
}

func collect(id uint32) *pb.ClientMessage {
	return &pb.ClientMessage{Kind: &pb.ClientMessage_Collect{Collect: &pb.Collect{Id: id}}}
}

// hyperEverything owns every part at Hyper.
func hyperEverything() sim.Unlocks {
	u := sim.Unlocks{}
	for _, p := range sim.Parts() {
		u[p] = sim.TierHyper
	}

	return u
}

// partOf is a wire part as the sim's.
func partOf(p *pb.Part) sim.Part {
	for _, part := range sim.Parts() {
		if pbPartMatches(p, part) {
			return part
		}
	}

	return ""
}

func pbPartMatches(p *pb.Part, part sim.Part) bool {
	names := map[sim.Part]string{
		sim.Part(sim.WeaponAutoCannon):    "WEAPON_AUTO_CANNON",
		sim.Part(sim.WeaponRockets):       "WEAPON_ROCKETS",
		sim.Part(sim.WeaponBigSpaceGun):   "WEAPON_BIG_SPACE_GUN",
		sim.Part(sim.WeaponZapper):        "WEAPON_ZAPPER",
		sim.Part(sim.EngineBase):          "ENGINE_BASE",
		sim.Part(sim.EngineBigPulse):      "ENGINE_BIG_PULSE",
		sim.Part(sim.EngineBurst):         "ENGINE_BURST",
		sim.Part(sim.EngineSupercharged):  "ENGINE_SUPERCHARGED",
		sim.Part(sim.ShieldFront):         "SHIELD_FRONT",
		sim.Part(sim.ShieldFrontAndSide):  "SHIELD_FRONT_AND_SIDE",
		sim.Part(sim.ShieldRound):         "SHIELD_ROUND",
		sim.Part(sim.ShieldInvincibility): "SHIELD_INVINCIBILITY",
	}
	switch k := p.GetKind().(type) {
	case *pb.Part_Weapon:
		return k.Weapon.String() == names[part]
	case *pb.Part_Engine:
		return k.Engine.String() == names[part]
	case *pb.Part_Shield:
		return k.Shield.String() == names[part]
	default:
		return false
	}
}

func TestPickups_AKillDropsAPartTheCollectorLacks(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	var saved []string
	save := func(player string, part sim.Part, tier sim.Tier) {
		mu.Lock()
		defer mu.Unlock()
		saved = append(saved, player+" "+string(part)+" "+tier.Name())
	}
	hub, _ := testHub(t, WithEnemyAt(0, 200), WithDropChance(1), WithSaveUnlock(save))
	a, welcome := join(t, hub, "a")
	if got, want := len(welcome.GetUnlocks()), 3; got != want {
		t.Errorf("a new player's unlocks = %d parts, want the %d defaults", got, want)
	}
	a.Send(state(0, 180))

	dropped := killEnemy(t, a)
	part := partOf(dropped.GetPart())
	if !sim.DefaultUnlocks().Lacks(part) {
		t.Errorf("dropped %q, which a already owns; want a part they lack", part)
	}
	lifetime := dropped.GetGoneTick() - dropped.GetTick()
	if want := uint32(sim.PickupLifetime * TickRate); lifetime != want {
		t.Errorf("pickup lasts %d ticks, want %d", lifetime, want)
	}

	a.Send(collect(dropped.GetId()))
	taken := nextPickupTaken(t, a)
	if got, want := len(taken.GetGains()), 1; got != want {
		t.Fatalf("gains = %d, want %d", got, want)
	}
	gain := taken.GetGains()[0]
	if gain.GetPlayerId() != "a" || partOf(gain.GetUnlock().GetPart()) != part ||
		gain.GetUnlock().GetTier() != 0 {
		t.Errorf("gain = %v, want a unlocking %q plain", gain, part)
	}

	// A reconnect keeps it, and the saver got it.
	_, again := join(t, hub, "a")
	if got, want := len(again.GetUnlocks()), 4; got != want {
		t.Errorf("unlocks after collecting = %d parts, want %d", got, want)
	}
	mu.Lock()
	defer mu.Unlock()
	if got, want := saved, []string{"a " + string(part) + " "}; !slices.Equal(got, want) {
		t.Errorf("saved = %q, want %q", got, want)
	}
}

func TestPickups_TheWholeSquadronGetsIt(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithEnemyAt(0, 200), WithDropChance(1))
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	c, _ := join(t, hub, "c")
	squadron := chooseAndWait(t, a, "").GetName()
	chooseAndWait(t, b, squadron)
	a.Send(state(0, 180))
	// b is across the world, and c flies alone next to a.
	b.Send(state(1500, 1500))
	c.Send(state(20, 180))

	dropped := killEnemy(t, a)
	a.Send(collect(dropped.GetId()))
	taken := nextPickupTaken(t, a)

	got := make([]string, 0, len(taken.GetGains()))
	for _, g := range taken.GetGains() {
		got = append(got, g.GetPlayerId())
	}
	if want := []string{"a", "b"}; !slices.Equal(got, want) {
		t.Errorf(
			"gains went to %v, want %v: the collector's squadron, wherever they are",
			got,
			want,
		)
	}
	_ = c
}

func TestPickups_APickupNobodyCanUseStays(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithEnemyAt(0, 200), WithDropChance(1))
	a, _ := join(t, hub, "a")
	veteran, _ := joinWith(t, hub, "v", hyperEverything())
	a.Send(state(0, 180))
	veteran.Send(state(10, 180))

	dropped := killEnemy(t, a)
	veteran.Send(collect(dropped.GetId()))
	// The veteran can't use it, so it's still there for a.
	a.Send(collect(dropped.GetId()))
	if got := nextPickupTaken(t, a).GetPlayerId(); got != "a" {
		t.Errorf("taken by %q, want a: the veteran had no use for it", got)
	}
}

func TestPickups_ALaterPlayerSeesThemUntilTheyGo(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithEnemyAt(0, 200), WithDropChance(1))
	a, _ := join(t, hub, "a")
	a.Send(state(0, 180))
	dropped := killEnemy(t, a)

	_, w := join(t, hub, "b")
	if got := w.GetPickups(); len(got) != 1 || got[0].GetId() != dropped.GetId() {
		t.Fatalf("b's welcome pickups = %v, want the one on the ground", got)
	}

	tick(int(dropped.GetGoneTick() - dropped.GetTick()))
	drain(a)
	_, w = join(t, hub, "c")
	if got := w.GetPickups(); len(got) != 0 {
		t.Errorf("c's welcome pickups = %v, want none after the lifetime", got)
	}
}
