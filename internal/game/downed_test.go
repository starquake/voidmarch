package game_test

import (
	"math"
	"slices"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

// companionDown flies a's stealthy companion out with a, parked at (0, 1000) in D5,
// until enemy fire takes it down, and returns its state then.
func companionDown(t *testing.T, a *Session, tick func(int)) *pb.ShipState {
	t.Helper()

	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_SquadronOrder{SquadronOrder: &pb.SquadronOrder{
		Mode: pb.CompanionMode_COMPANION_MODE_STEALTH,
	}}})
	var down *pb.ShipState
	for range 120 * TickRate {
		snap, _ := latest(t, a, tick, 1, 0, 1000)
		for _, p := range snap.GetPlayers() {
			if p.GetPlayerId() == "a/1" && p.GetState().GetDamage() >= sim.MaxDamage {
				down = p.GetState()
			}
		}
		if down != nil {
			return down
		}
	}
	t.Fatal("a/1 never went down in two minutes")

	return nil
}

func companion(snap *pb.Snapshot) *pb.ShipState {
	return shipOf(snap, "a/1")
}

// shipOf is the state of the ship id in snap, or nil.
func shipOf(snap *pb.Snapshot, id string) *pb.ShipState {
	for _, p := range snap.GetPlayers() {
		if p.GetPlayerId() == id {
			return p.GetState()
		}
	}

	return nil
}

var respawnHome = &pb.ClientMessage{
	Kind: &pb.ClientMessage_RespawnHome{RespawnHome: &pb.RespawnHome{}},
}

// downAt is a ship report of a player down at (x, y).
func downAt(x, y float32) *pb.ClientMessage {
	return &pb.ClientMessage{Kind: &pb.ClientMessage_State{State: &pb.ShipState{
		X: x, Y: y, Damage: sim.MaxDamage,
	}}}
}

// dockedWithin steps the hub n ticks, a at home, and reports whether a/1
// docked meanwhile; it fails if a/1 left any other way.
func dockedWithin(t *testing.T, a *Session, tick func(int), n int) bool {
	t.Helper()

	var docked, gone bool
	for range n {
		_, messages := latest(t, a, tick, 1, 0, sim.HomeSpawnY)
		for _, msg := range messages {
			if msg.GetCompanionDismissed().GetCompanion() == 1 {
				docked = true
			}
			if msg.GetLeft().GetPlayerId() == "a/1" {
				gone = true
			}
		}
	}
	if docked != gone {
		t.Errorf("a/1 docked = %v, but left = %v", docked, gone)
	}

	return docked
}

func TestDowned_RespawnHomeDocksADownedCompanion(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t, WithPoolStart(1))
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	down := companionDown(t, a, tick)

	b, _ := pilot(t, hub, "b")
	b.Send(state(0, -sim.HomeSpawnY))

	// a went down beside it, far from home, and respawns at home.
	a.Send(downAt(down.GetX(), down.GetY()-300))
	a.Send(state(0, sim.HomeSpawnY))
	a.Send(respawnHome)
	var dismissed, left, docked bool
	for !dismissed || !left || !docked {
		msg := next(t, a)
		if d := msg.GetCompanionDismissed(); d != nil {
			if got, want := d.GetCompanion(), uint32(1); got != want {
				t.Errorf("dismissed companion %d, want %d", got, want)
			}
			dismissed = true
		}
		if msg.GetLeft().GetPlayerId() == "a/1" {
			left = true
		}
		if msg.GetSquadrons().GetHangar() == 1 {
			docked = true
		}
	}
	if got, want := nextLeft(t, b), "a/1"; got != want {
		t.Errorf("b was told %q left, want %q", got, want)
	}
	if g, reason := summonReply(t, a); g == nil {
		t.Errorf("summon after the respawn refused: %q", reason)
	}
}

// flyOutWithCompanion has b fetch b/1 from home and fly it out to (x, y),
// beside the downed a/1. a keeps out of revive reach, and in Stealth b/1
// doesn't revive it.
func flyOutWithCompanion(
	t *testing.T,
	a, b *Session,
	tick func(int),
	down *pb.ShipState,
	x, y float32,
) {
	t.Helper()

	b.Send(state(0, 180))
	grant(t, b)
	var snap *pb.Snapshot
	for range 5 * TickRate {
		b.Send(state(x, y))
		snap, _ = latest(t, a, tick, 1, down.GetX(), down.GetY()-600)
		drain(b)
	}
	down = companion(snap)
	mate := shipOf(snap, "b/1")
	d := math.Hypot(float64(mate.GetX()-down.GetX()), float64(mate.GetY()-down.GetY()))
	if mate.GetDamage() >= sim.MaxDamage || d > sim.BrainReviveRange {
		t.Fatalf(
			"b/1 at damage %d, %v px from a/1: want it up and in revive range",
			mate.GetDamage(),
			d,
		)
	}
}

func TestDowned_RespawnHomeLeavesOneNearAnUpSquadmate(t *testing.T) {
	t.Parallel()

	const (
		escort = pb.CompanionMode_COMPANION_MODE_ESCORT
		hold   = pb.CompanionMode_COMPANION_MODE_HOLD
		// stealth is no order: companionDown left the squadron in Stealth.
		stealth = pb.CompanionMode_COMPANION_MODE_UNSPECIFIED
	)
	tests := []struct {
		name string
		// near is b's offset from the downed a/1, or 0 for b staying away.
		near float32
		// mate puts b in a's squadron, and bDown sends b down.
		mate, bDown bool
		// bCompanion gives b a companion, up beside b.
		bCompanion bool
		// second gives a another companion, up, flown out with a this far
		// above a/1, or 0 for none.
		second float32
		// mode is ordered to the squadron's companions just before H.
		mode  pb.CompanionMode
		stays bool
	}{
		{name: "alone", near: 0},
		{name: "squadmate up within reach", near: 400, mate: true, stays: true},
		{name: "squadmate up out of reach", near: 1200, mate: true},
		{name: "player up outside the squadron", near: 400},
		{name: "squadmate down within reach", near: 400, mate: true, bDown: true},
		{name: "own companion escorting within reach", second: 250, mode: escort, stays: true},
		{name: "own companion escorting out of reach", second: 650, mode: escort},
		{name: "own companion holding within reach", second: 250, mode: hold},
		{name: "own companion in stealth within reach", second: 250, mode: stealth},
		{
			name: "squadmate's companion escorting within reach", near: 250, mate: true,
			bDown: true, bCompanion: true, mode: escort, stays: true,
		},
		{
			name: "squadmate's companion in stealth within reach", near: 250, mate: true,
			bDown: true, bCompanion: true, mode: stealth,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			hub, tick := testHub(t)
			a, _ := pilot(t, hub, "a")
			a.Send(state(0, 180))
			grant(t, a)
			down := companionDown(t, a, tick)
			var holdX, holdY float32
			if tc.second != 0 {
				// a fetches a/2 from home and flies it out near a/1; in Stealth it doesn't revive it.
				a.Send(state(0, 180))
				grant(t, a)
				snap, _ := latest(t, a, tick, 5*TickRate, down.GetX(), down.GetY()-tc.second)
				down = companion(snap)
				other := shipOf(snap, "a/2")
				holdX, holdY = other.GetX(), other.GetY()
				d := math.Hypot(float64(holdX-down.GetX()), float64(holdY-down.GetY()))
				far := tc.second > sim.BrainReviveRange
				if other.GetDamage() >= sim.MaxDamage || (d > sim.BrainReviveRange) != far ||
					d > sim.CompanionWaitRadius {
					t.Fatalf(
						"a/2 at damage %d, %v px from a/1: want it up, past revive range %v",
						other.GetDamage(),
						d,
						far,
					)
				}
			}
			if tc.near != 0 {
				b, _ := join(t, hub, "b")
				squadron := ""
				if tc.mate {
					squadron = "Alpha"
				}
				chooseAndWait(t, b, squadron)
				x, y := down.GetX()+tc.near, down.GetY()
				if tc.bCompanion {
					flyOutWithCompanion(t, a, b, tick, down, x, y)
				}
				if tc.bDown {
					b.Send(downAt(x, y))
				} else {
					b.Send(state(x, y))
				}
			}

			a.Send(state(0, sim.HomeSpawnY))
			if tc.mode != stealth {
				order := &pb.SquadronOrder{Mode: tc.mode, X: holdX, Y: holdY}
				a.Send(
					&pb.ClientMessage{Kind: &pb.ClientMessage_SquadronOrder{SquadronOrder: order}},
				)
			}
			a.Send(respawnHome)
			if got := !dockedWithin(t, a, tick, TickRate); got != tc.stays {
				t.Errorf("a/1 stayed down = %v, want %v", got, tc.stays)
			}
		})
	}
}

func TestDowned_ARespawnWithoutRespawnHomeLeavesThemDown(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	down := companionDown(t, a, tick)

	// An old client, or J beside a squadmate at home, reports only the respawn.
	a.Send(downAt(down.GetX(), down.GetY()-300))
	a.Send(state(0, sim.HomeSpawnY))
	if dockedWithin(t, a, tick, 5*TickRate) {
		t.Error("a/1 docked on a respawn without RespawnHome")
	}
}

func TestDowned_ItsOwnerRevivesACompanion(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	down := companionDown(t, a, tick)

	// a flies over beside it: a squadmate, so it's up within
	// ReviveSquadmateSeconds and some. Still under fire, it may go straight
	// back down within the same hub tick: its progress starting over counts.
	x, y := down.GetX()+20, down.GetY()
	progress := float32(0)
	for range int(2 * sim.ReviveSquadmateSeconds * TickRate) {
		snap, _ := latest(t, a, tick, 1, x, y)
		c := companion(snap)
		if c == nil {
			t.Fatal("a/1 left while down beside its owner")
		}
		up := c.GetDamage() < sim.MaxDamage
		if up && c.GetDamage() != sim.MaxDamage-1 {
			t.Errorf("revived a/1 at damage %d, want %d", c.GetDamage(), sim.MaxDamage-1)
		}
		if up || c.GetRevive() < progress-0.5 {
			return
		}
		progress = c.GetRevive()
	}
	t.Errorf("a/1 still down beside its owner, progress %v", progress)
}

func TestDowned_ALostCompanionGoesHome(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	grant(t, a)
	companionDown(t, a, tick)

	// a leaves it where it drifts, far enough that nobody revives it.
	for range int(sim.CompanionLostSeconds*TickRate) + TickRate {
		snap, messages := latest(t, a, tick, 1, 0, -1500)
		for _, msg := range messages {
			if d := msg.GetCompanionDismissed(); d != nil {
				if got, want := d.GetCompanion(), uint32(1); got != want {
					t.Errorf("dismissed companion %d, want %d", got, want)
				}
				if c := companion(snap); c != nil {
					t.Error("a/1 is still in snapshots after going home")
				}
				// Its owner's client drops its ship on Left, like everyone else's (#129).
				gone := slices.ContainsFunc(messages, func(m *pb.ServerMessage) bool {
					return m.GetLeft().GetPlayerId() == "a/1"
				})
				if !gone {
					t.Error("a wasn't told a/1 left, so a's client keeps drawing it")
				}

				return
			}
		}
	}
	t.Errorf("a/1 down for %v s didn't go home", sim.CompanionLostSeconds)
}
