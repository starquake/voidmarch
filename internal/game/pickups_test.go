package game_test

import (
	"slices"
	"testing"
	"time"

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

	// The hub saves off its tick goroutine, so a save can land after the
	// messages the test waits on (#86).
	saved := make(chan string, 4)
	save := func(player string, part sim.Part, tier sim.Tier) {
		saved <- player + " " + string(part) + " " + tier.Name()
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
	select {
	case got := <-saved:
		if want := "a " + string(part) + " "; got != want {
			t.Errorf("saved %q, want %q", got, want)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the unlock was never saved")
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

// stateWith is a ship state at (0, y), on the line through home, with a loadout.
func stateWith(y float32, l *pb.Loadout) *pb.ClientMessage {
	return &pb.ClientMessage{
		Kind: &pb.ClientMessage_State{State: &pb.ShipState{Y: y, Loadout: l}},
	}
}

func TestLoadouts_OnlyOwnedChangedLoadoutsAreSaved(t *testing.T) {
	t.Parallel()

	saved := make(chan sim.Loadout, 8)
	save := func(_ string, l sim.Loadout) { saved <- l }
	hub, _ := testHub(t, WithSaveLoadout(save))
	unlocks := sim.DefaultUnlocks()
	unlocks[sim.Part(sim.WeaponZapper)] = sim.TierMega
	unlocks[sim.Part(sim.EngineBurst)] = sim.TierPlain
	a, _ := joinWith(t, hub, "a", unlocks)

	zapper := &pb.Loadout{
		Weapon: pb.Weapon_WEAPON_ZAPPER,
		Engine: pb.Engine_ENGINE_BASE,
		Shield: pb.Shield_SHIELD_FRONT,
	}
	zapperFast := &pb.Loadout{
		Weapon: pb.Weapon_WEAPON_ZAPPER,
		Engine: pb.Engine_ENGINE_BURST,
		Shield: pb.Shield_SHIELD_FRONT,
	}
	locked := &pb.Loadout{
		Weapon: pb.Weapon_WEAPON_ROCKETS,
		Engine: pb.Engine_ENGINE_BASE,
		Shield: pb.Shield_SHIELD_FRONT,
	}
	a.Send(stateWith(180, zapper))
	a.Send(
		stateWith(180, zapper),
	) // unchanged: no second save
	a.Send(
		stateWith(180, locked),
	) // a part a doesn't own
	// Away from home counts too: parts switch anywhere (#191, decision 1).
	a.Send(stateWith(1000, zapperFast))

	for _, want := range []sim.Loadout{
		{Weapon: sim.WeaponZapper, Engine: sim.EngineBase, Shield: sim.ShieldFront},
		{Weapon: sim.WeaponZapper, Engine: sim.EngineBurst, Shield: sim.ShieldFront},
	} {
		select {
		case got := <-saved:
			if got != want {
				t.Errorf("saved %+v, want %+v", got, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("the fitted loadout %+v was never saved", want)
		}
	}
	// A reconnect gets it back, at a's tiers.
	_, w := join(t, hub, "a")
	if got := w.GetLoadout(); got.GetEngine() != pb.Engine_ENGINE_BURST ||
		got.GetWeaponTier() != uint32(sim.TierMega) {
		t.Errorf("welcome loadout = %v, want the Mega zapper on the burst engine", got)
	}
	select {
	case got := <-saved:
		t.Errorf("saved %+v too: only an owned, changed loadout counts", got)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestLoadouts_ASavedLoadoutComesBackInTheWelcome(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	unlocks := sim.Unlocks{sim.Part(sim.ShieldRound): sim.TierSuper}
	s, w, err := hub.Join(t.Context(), players.Player{
		ID:      "a",
		Name:    "a",
		Unlocks: unlocks,
		Loadout: sim.Loadout{
			Weapon: sim.WeaponAutoCannon,
			Engine: sim.EngineBase,
			Shield: sim.ShieldRound,
		},
	})
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	_ = s
	if got := w.GetLoadout(); got.GetShield() != pb.Shield_SHIELD_ROUND ||
		got.GetShieldTier() != uint32(sim.TierSuper) {
		t.Errorf("welcome loadout = %v, want the Super round shield", got)
	}
	_, fresh := join(t, hub, "b")
	if fresh.GetLoadout() != nil {
		t.Errorf("a new player's welcome loadout = %v, want none", fresh.GetLoadout())
	}
}

func TestWelcome_SaysWhetherTheServerIsForDevelopment(t *testing.T) {
	t.Parallel()

	dev, _ := testHub(t, WithDevelopment())
	if _, w := join(t, dev, "a"); !w.GetDevelopment() {
		t.Error("a development server's welcome says it isn't")
	}
	prod, _ := testHub(t)
	if _, w := join(t, prod, "a"); w.GetDevelopment() {
		t.Error("a production server's welcome says it's for development")
	}
}

func TestLoadouts_AQuickRejoinGetsTheHubsNewestCopy(t *testing.T) {
	t.Parallel()

	saved := make(chan sim.Loadout, 1)
	hub, _ := testHub(t, WithSaveLoadout(func(_ string, l sim.Loadout) { saved <- l }))
	unlocks := sim.DefaultUnlocks()
	unlocks[sim.Part(sim.WeaponZapper)] = sim.TierMega
	a, _ := joinWith(t, hub, "a", unlocks)
	a.Send(stateWith(180, &pb.Loadout{
		Weapon: pb.Weapon_WEAPON_ZAPPER,
		Engine: pb.Engine_ENGINE_BASE,
		Shield: pb.Shield_SHIELD_FRONT,
	}))
	<-saved
	a.Leave()
	if !closed(a) {
		t.Fatal("the leaving session is still open")
	}

	// The record read at connect predates the save: no zapper, no loadout (#93).
	_, w := joinWith(t, hub, "a", sim.DefaultUnlocks())
	if got := w.GetLoadout(); got.GetWeapon() != pb.Weapon_WEAPON_ZAPPER {
		t.Errorf("welcome loadout = %v, want the zapper fitted before leaving", got)
	}
	zapper := false
	for _, u := range w.GetUnlocks() {
		zapper = zapper ||
			(u.GetPart().GetWeapon() == pb.Weapon_WEAPON_ZAPPER && u.GetTier() == uint32(sim.TierMega))
	}
	if !zapper {
		t.Errorf("welcome unlocks = %v, want the Mega zapper owned before leaving", w.GetUnlocks())
	}
}
