package game_test

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
)

// testHub runs a hub stepped by hand through the returned tick function.
func testHub(t *testing.T, opts ...HubOption) (*Hub, func(n int)) {
	t.Helper()

	ctx, cancel := context.WithCancel(t.Context())
	ticks := make(chan time.Time)
	hub := NewHub(slog.New(slog.DiscardHandler), append([]HubOption{WithSeed(1)}, opts...)...)
	done := make(chan struct{})
	go func() {
		hub.Run(ctx, ticks)
		close(done)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})

	return hub, func(n int) {
		for range n {
			ticks <- time.Time{}
		}
	}
}

func join(t *testing.T, hub *Hub, id string) (*Session, *pb.Welcome) {
	t.Helper()

	s, w, err := hub.Join(t.Context(), players.Player{ID: id, Name: "name-" + id})
	if err != nil {
		t.Fatalf("Join(%s) error = %v", id, err)
	}

	return s, w
}

// next returns the next message for s, failing if none comes.
func next(t *testing.T, s *Session) *pb.ServerMessage {
	t.Helper()

	select {
	case msg, ok := <-s.Out:
		if !ok {
			t.Fatal("session closed, want a message")
		}

		return msg
	case <-time.After(time.Second):
		t.Fatal("no message for the session")

		return nil
	}
}

// drain discards queued messages for s.
func drain(s *Session) {
	for {
		select {
		case _, ok := <-s.Out:
			if !ok {
				return
			}
		default:
			return
		}
	}
}

func closed(s *Session) bool {
	for {
		select {
		case _, ok := <-s.Out:
			if !ok {
				return true
			}
		case <-time.After(time.Second):
			return false
		}
	}
}

// nextShot returns the next shot for s, skipping the snapshots that may still
// arrive from earlier ticks.
func nextShot(t *testing.T, s *Session) *pb.RemoteShot {
	t.Helper()

	for {
		if shot := next(t, s).GetShot(); shot != nil {
			return shot
		}
	}
}

func state(x, y float32) *pb.ClientMessage {
	return &pb.ClientMessage{Kind: &pb.ClientMessage_State{State: &pb.ShipState{X: x, Y: y}}}
}

func TestHub_JoinWelcomes(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	_, first := join(t, hub, "a")
	_, second := join(t, hub, "b")

	if got, want := first.GetTickRate(), uint32(TickRate); got != want {
		t.Errorf("TickRate = %d, want %d", got, want)
	}
	if first.GetColor() == second.GetColor() {
		t.Errorf("both players got color %06x", first.GetColor())
	}
	if got, want := first.GetPlayerId(), "a"; got != want {
		t.Errorf("PlayerId = %q, want %q", got, want)
	}
	if got, want := first.GetName(), "name-a"; got != want {
		t.Errorf("Name = %q, want %q", got, want)
	}
}

func TestHub_SpawnsApart(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, first := join(t, hub, "a")
	a.Send(state(first.GetSpawnX(), first.GetSpawnY()))
	_, second := join(t, hub, "b")

	if first.GetSpawnX() == second.GetSpawnX() && first.GetSpawnY() == second.GetSpawnY() {
		t.Errorf("both spawned at (%v, %v)", first.GetSpawnX(), first.GetSpawnY())
	}
}

func TestHub_SnapshotShowsOthers(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(state(10, 20))
	b.Send(state(30, 40))
	tick(1)

	snap := next(t, a).GetSnapshot()
	if got, want := len(snap.GetPlayers()), 1; got != want {
		t.Fatalf("a sees %d players, want %d", got, want)
	}
	other := snap.GetPlayers()[0]
	if got, want := other.GetPlayerId(), "b"; got != want {
		t.Errorf("a sees %q, want %q", got, want)
	}
	if got, want := other.GetState().GetX(), float32(30); got != want {
		t.Errorf("b's x = %v, want %v", got, want)
	}
	if got, want := other.GetName(), "name-b"; got != want {
		t.Errorf("b's name = %q, want %q", got, want)
	}
}

func TestHub_SnapshotSkipsPlayersWithoutState(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	join(t, hub, "b")
	tick(1)

	if got, want := len(next(t, a).GetSnapshot().GetPlayers()), 0; got != want {
		t.Errorf("a sees %d players, want %d", got, want)
	}
}

func TestHub_RelaysShots(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	tick(3)

	a.Send(
		&pb.ClientMessage{
			Kind: &pb.ClientMessage_Shot{
				Shot: &pb.ShotFired{Id: 9, Weapon: pb.Weapon_WEAPON_ZAPPER},
			},
		},
	)
	shot := nextShot(t, b)

	if got, want := shot.GetPlayerId(), "a"; got != want {
		t.Errorf("shot from %q, want %q", got, want)
	}
	if got, want := shot.GetTick(), uint32(3); got != want {
		t.Errorf("shot tick = %d, want %d", got, want)
	}
	if got, want := shot.GetShot().GetId(), uint32(9); got != want {
		t.Errorf("shot id = %d, want %d", got, want)
	}

	tick(1)
	for {
		msg := next(t, a)
		if msg.GetShot() != nil {
			t.Fatal("the shooter got their own shot back")
		}
		if msg.GetSnapshot().GetTick() == 4 {
			break
		}
	}
}

func TestHub_Full(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	for i := range MaxPlayers {
		join(t, hub, strconv.Itoa(i))
	}

	_, _, err := hub.Join(t.Context(), players.Player{ID: "late"})
	if got, want := err, ErrFull; !errors.Is(got, want) {
		t.Errorf("Join() error = %v, want %v", got, want)
	}
}

func TestHub_RejoinReplacesSession(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	old, _ := join(t, hub, "a")
	join(t, hub, "a")

	if !closed(old) {
		t.Error("the old session is still open")
	}
}

func TestHub_LeaveTellsOthers(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, first := join(t, hub, "a")
	b, _ := join(t, hub, "b")

	a.Leave()
	if got, want := next(t, b).GetLeft().GetPlayerId(), "a"; got != want {
		t.Errorf("left = %q, want %q", got, want)
	}
	if !closed(a) {
		t.Error("the leaving session is still open")
	}

	_, again := join(t, hub, "c")
	if got, want := again.GetColor(), first.GetColor(); got != want {
		t.Errorf("color = %06x, want the freed %06x", got, want)
	}
}

func TestHub_StaleLeaveIsIgnored(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	old, _ := join(t, hub, "a")
	current, _ := join(t, hub, "a")

	old.Leave()
	tick(1)
	if msg := next(t, current); msg.GetSnapshot() == nil {
		t.Errorf("got %v, want a snapshot: the old session's leave removed the new one", msg)
	}
}

func TestHub_SilentPlayerLeaves(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")

	// Five seconds of silence, as a hidden tab or a blip, is ridden out.
	// a still reads, so it isn't dropped as too slow instead.
	for range 5 * TickRate {
		b.Send(state(0, 0))
		tick(1)
		drain(b)
		drain(a)
	}
	if closed(a) {
		t.Fatal("a player silent for 5 s was dropped, want kept")
	}
	for range SilenceTicks - 5*TickRate {
		b.Send(state(0, 0))
		tick(1)
		drain(b)
		drain(a)
	}
	b.Send(state(0, 0))
	tick(1)

	if !closed(a) {
		t.Error("the silent session is still open")
	}
	var left bool
	for !left {
		msg := next(t, b)
		left = msg.GetLeft().GetPlayerId() == "a"
	}
}

func TestHub_SlowClientIsDropped(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	slow, _ := join(t, hub, "slow")
	fast, _ := join(t, hub, "fast")

	for range 100 {
		fast.Send(state(0, 0))
		slow.Send(state(0, 0))
		tick(1)
		drain(fast)
	}

	if !closed(slow) {
		t.Error("the slow session is still open")
	}
}

func TestHub_StopClosesSessions(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(t.Context())
	hub := NewHub(slog.New(slog.DiscardHandler))
	done := make(chan struct{})
	go func() {
		hub.Run(ctx, nil)
		close(done)
	}()

	s, _, err := hub.Join(t.Context(), players.Player{ID: "a"})
	if err != nil {
		t.Fatalf("Join() error = %v", err)
	}
	cancel()
	<-done

	if !closed(s) {
		t.Error("the session is still open after the hub stopped")
	}
	s.Send(state(0, 0))
	s.Leave()

	_, _, err = hub.Join(t.Context(), players.Player{ID: "b"})
	if got, want := err, ErrStopped; !errors.Is(got, want) {
		t.Errorf("Join() after stop error = %v, want %v", got, want)
	}
}

func TestHub_JoinHonorsContext(t *testing.T) {
	t.Parallel()

	hub := NewHub(slog.New(slog.DiscardHandler))
	ctx, cancel := context.WithCancel(t.Context())
	cancel()

	_, _, err := hub.Join(ctx, players.Player{ID: "a"})
	if got, want := err, context.Canceled; !errors.Is(got, want) {
		t.Errorf("Join() error = %v, want %v", got, want)
	}
}
