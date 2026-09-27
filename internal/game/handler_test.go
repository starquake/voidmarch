package game_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
	"github.com/starquake/voidmarch/internal/wire"
)

// syncBuffer is a bytes.Buffer safe for the handler's goroutines to log into.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.buf.String()
}

type wsServer struct {
	url   string
	hub   *Hub
	store *players.Store
	tick  func(n int)
	logs  *syncBuffer
}

func newWSServer(t *testing.T) *wsServer {
	t.Helper()

	hub, tick := testHub(t)
	store := players.NewStore()
	logs := &syncBuffer{}
	logger := slog.New(slog.NewTextHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	srv := httptest.NewServer(HandleWS(logger, hub, store, true))
	t.Cleanup(srv.Close)

	return &wsServer{
		url:   "ws" + strings.TrimPrefix(srv.URL, "http"),
		hub:   hub,
		store: store,
		tick:  tick,
		logs:  logs,
	}
}

func (s *wsServer) register(t *testing.T, name string) string {
	t.Helper()

	_, token, err := s.store.Register(name)
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}

	return token
}

type wsClient struct {
	t      *testing.T
	conn   *websocket.Conn
	format wire.Format
}

func dialWS(t *testing.T, url string, format wire.Format) *wsClient {
	t.Helper()

	//nolint:bodyclose // coder/websocket closes the handshake response body itself.
	conn, _, err := websocket.Dial(t.Context(), url, nil)
	if err != nil {
		t.Fatalf("Dial() error = %v", err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })

	return &wsClient{t: t, conn: conn, format: format}
}

func (c *wsClient) send(msg *pb.ClientMessage) {
	c.t.Helper()

	data, err := c.format.Marshal(msg)
	if err != nil {
		c.t.Fatalf("Marshal() error = %v", err)
	}
	typ := websocket.MessageBinary
	if c.format == wire.JSON {
		typ = websocket.MessageText
	}
	if err = c.conn.Write(c.t.Context(), typ, data); err != nil {
		c.t.Fatalf("Write() error = %v", err)
	}
}

// recv returns the next message, or the error that ended the connection.
func (c *wsClient) recv() (*pb.ServerMessage, error) {
	ctx, cancel := context.WithTimeout(c.t.Context(), 2*time.Second)
	defer cancel()

	typ, data, err := c.conn.Read(ctx)
	if err != nil {
		return nil, err
	}
	if got, want := typ == websocket.MessageText, c.format == wire.JSON; got != want {
		c.t.Errorf(
			"frame is text = %t, want %t: the server answers in the client's format",
			got,
			want,
		)
	}
	msg := &pb.ServerMessage{}
	if err = c.format.Unmarshal(data, msg); err != nil {
		c.t.Fatalf("Unmarshal() error = %v", err)
	}

	return msg, nil
}

func (c *wsClient) must() *pb.ServerMessage {
	c.t.Helper()

	msg, err := c.recv()
	if err != nil {
		c.t.Fatalf("recv() error = %v", err)
	}

	return msg
}

func hello(token string) *pb.ClientMessage {
	return &pb.ClientMessage{Kind: &pb.ClientMessage_Hello{Hello: &pb.Hello{Token: token}}}
}

// joinWS dials, says hello and returns the client with its welcome.
func joinWS(t *testing.T, s *wsServer, name string, format wire.Format) (*wsClient, *pb.Welcome) {
	t.Helper()

	c := dialWS(t, s.url, format)
	c.send(hello(s.register(t, name)))
	welcome := c.must().GetWelcome()
	if welcome == nil {
		t.Fatal("the first message is not a welcome")
	}

	return c, welcome
}

func closeStatus(t *testing.T, c *wsClient) websocket.StatusCode {
	t.Helper()

	for {
		if _, err := c.recv(); err != nil {
			return websocket.CloseStatus(err)
		}
	}
}

func TestHandleWS_Welcome(t *testing.T) {
	t.Parallel()

	for _, format := range []wire.Format{wire.Binary, wire.JSON} {
		t.Run(format.String(), func(t *testing.T) {
			t.Parallel()

			s := newWSServer(t)
			_, welcome := joinWS(t, s, "Sanne", format)

			if welcome.GetPlayerId() == "" {
				t.Error("empty player id")
			}
			if got, want := welcome.GetTickRate(), uint32(TickRate); got != want {
				t.Errorf("TickRate = %d, want %d", got, want)
			}
		})
	}
}

func TestHandleWS_PlayersSeeEachOther(t *testing.T) {
	t.Parallel()

	s := newWSServer(t)
	sanne, _ := joinWS(t, s, "Sanne", wire.JSON)
	mo, _ := joinWS(t, s, "Mo", wire.Binary)

	sanne.send(&pb.ClientMessage{Kind: &pb.ClientMessage_State{State: &pb.ShipState{X: 42, Y: 7}}})
	sanne.send(
		&pb.ClientMessage{
			Kind: &pb.ClientMessage_Shot{
				Shot: &pb.ShotFired{Id: 1, Weapon: pb.Weapon_WEAPON_ROCKETS},
			},
		},
	)

	var sawShot, sawShip bool
	for !sawShot || !sawShip {
		s.tick(1)
		msg := mo.must()
		if shot := msg.GetShot(); shot != nil {
			sawShot = shot.GetShot().GetWeapon() == pb.Weapon_WEAPON_ROCKETS
		}
		for _, p := range msg.GetSnapshot().GetPlayers() {
			sawShip = sawShip || (p.GetName() == "Sanne" && p.GetState().GetX() == 42)
		}
	}
}

func TestHandleWS_UnknownToken(t *testing.T) {
	t.Parallel()

	s := newWSServer(t)
	c := dialWS(t, s.url, wire.Binary)
	c.send(hello("not-a-token"))

	if got, want := closeStatus(t, c), StatusUnknownToken; got != want {
		t.Errorf("close status = %d, want %d", got, want)
	}
}

func TestHandleWS_HelloFirst(t *testing.T) {
	t.Parallel()

	s := newWSServer(t)
	c := dialWS(t, s.url, wire.Binary)
	c.send(&pb.ClientMessage{Kind: &pb.ClientMessage_State{State: &pb.ShipState{}}})

	if got, want := closeStatus(t, c), websocket.StatusPolicyViolation; got != want {
		t.Errorf("close status = %d, want %d", got, want)
	}
}

func TestHandleWS_Full(t *testing.T) {
	t.Parallel()

	s := newWSServer(t)
	for i := range MaxPlayers {
		if _, _, err := s.hub.Join(t.Context(), players.Player{ID: strconv.Itoa(i)}); err != nil {
			t.Fatalf("Join() error = %v", err)
		}
	}

	c := dialWS(t, s.url, wire.Binary)
	c.send(hello(s.register(t, "Late")))

	if msg := c.must(); msg.GetFull() == nil {
		t.Errorf("got %v, want full", msg)
	}
	if got, want := closeStatus(t, c), websocket.StatusTryAgainLater; got != want {
		t.Errorf("close status = %d, want %d", got, want)
	}
}

func TestHandleWS_LeavingTellsOthers(t *testing.T) {
	t.Parallel()

	s := newWSServer(t)
	sanne, welcome := joinWS(t, s, "Sanne", wire.Binary)
	mo, _ := joinWS(t, s, "Mo", wire.Binary)

	_ = sanne.conn.Close(websocket.StatusNormalClosure, "")

	for {
		if mo.must().GetLeft().GetPlayerId() == welcome.GetPlayerId() {
			return
		}
	}
}

func TestHandleWS_RejectsOtherOrigins(t *testing.T) {
	t.Parallel()

	s := newWSServer(t)
	header := http.Header{"Origin": {"https://evil.example"}}
	_, resp, err := websocket.Dial(t.Context(), s.url, &websocket.DialOptions{HTTPHeader: header})
	if resp != nil {
		_ = resp.Body.Close()
	}

	if err == nil {
		t.Fatal("Dial() from another origin succeeded")
	}
	if got, want := resp.StatusCode, http.StatusForbidden; got != want {
		t.Errorf("status = %d, want %d", got, want)
	}
}

func TestHandleWS_LogsTheWire(t *testing.T) {
	t.Parallel()

	s := newWSServer(t)
	joinWS(t, s, "Sanne", wire.JSON)

	for _, want := range []string{"msg=wire", "dir=in", "dir=out", "format=json"} {
		if got := s.logs.String(); !strings.Contains(got, want) {
			t.Errorf("logs should contain %q", want)
		}
	}
}

func TestHandleWS_HubStopped(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(t.Context())
	hub := NewHub(slog.New(slog.DiscardHandler))
	done := make(chan struct{})
	go func() {
		hub.Run(ctx, nil)
		close(done)
	}()
	cancel()
	<-done

	store := players.NewStore()
	_, token, err := store.Register("Mo")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	srv := httptest.NewServer(HandleWS(slog.New(slog.DiscardHandler), hub, store, false))
	t.Cleanup(srv.Close)

	c := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http"), wire.Binary)
	c.send(hello(token))

	if got, want := closeStatus(t, c), websocket.StatusGoingAway; got != want {
		t.Errorf("close status = %d, want %d", got, want)
	}
}

func TestHandleWS_HubStopClosesConnections(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(t.Context())
	hub := NewHub(slog.New(slog.DiscardHandler))
	go hub.Run(ctx, nil)

	store := players.NewStore()
	_, token, err := store.Register("Mo")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	srv := httptest.NewServer(HandleWS(slog.New(slog.DiscardHandler), hub, store, false))
	t.Cleanup(srv.Close)

	c := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http"), wire.Binary)
	c.send(hello(token))
	if c.must().GetWelcome() == nil {
		t.Fatal("no welcome")
	}
	cancel()

	if got, want := closeStatus(t, c), websocket.StatusNormalClosure; got != want {
		t.Errorf("close status = %d, want %d", got, want)
	}
}

func TestHandleWS_BadFrameEndsConnection(t *testing.T) {
	t.Parallel()

	s := newWSServer(t)
	c, _ := joinWS(t, s, "Mo", wire.Binary)
	bad := []byte{0xff, 0xff, 0xff}
	if err := c.conn.Write(t.Context(), websocket.MessageBinary, bad); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	for {
		if _, err := c.recv(); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				t.Fatal("the connection stayed open after a bad frame")
			}

			return
		}
		s.tick(1)
	}
}
