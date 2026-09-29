package integration_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/proto"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
)

// wsPlayer is a player connected over a real WebSocket, in binary protobuf.
type wsPlayer struct {
	t    *testing.T
	conn *websocket.Conn
}

func connect(t *testing.T, baseURL, name string) (*wsPlayer, *pb.Welcome) {
	t.Helper()

	return joinAs(t, baseURL, registerPlayer(t, baseURL, name))
}

// joinAs connects with a token registered earlier.
func joinAs(t *testing.T, baseURL, token string) (*wsPlayer, *pb.Welcome) {
	t.Helper()

	wsURL := "ws" + strings.TrimPrefix(baseURL, "http") + "/ws"
	//nolint:bodyclose // coder/websocket closes the handshake response body itself.
	conn, _, err := websocket.Dial(t.Context(), wsURL, nil)
	if err != nil {
		t.Fatalf("Dial() error = %v", err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })

	p := &wsPlayer{t: t, conn: conn}
	p.send(&pb.ClientMessage{Kind: &pb.ClientMessage_Hello{Hello: &pb.Hello{Token: token}}})
	welcome := p.recv().GetWelcome()
	if welcome == nil {
		t.Fatal("no welcome")
	}

	return p, welcome
}

func (p *wsPlayer) send(msg *pb.ClientMessage) {
	p.t.Helper()

	data, err := proto.Marshal(msg)
	if err != nil {
		p.t.Fatalf("Marshal() error = %v", err)
	}
	if err = p.conn.Write(p.t.Context(), websocket.MessageBinary, data); err != nil {
		p.t.Fatalf("Write() error = %v", err)
	}
}

func (p *wsPlayer) recv() *pb.ServerMessage {
	p.t.Helper()

	ctx, cancel := context.WithTimeout(p.t.Context(), 5*time.Second)
	defer cancel()
	_, data, err := p.conn.Read(ctx)
	if err != nil {
		p.t.Fatalf("Read() error = %v", err)
	}
	msg := &pb.ServerMessage{}
	if err = proto.Unmarshal(data, msg); err != nil {
		p.t.Fatalf("Unmarshal() error = %v", err)
	}

	return msg
}

func TestWS_TwoPlayersSeeEachOther(t *testing.T) {
	t.Parallel()

	baseURL := startServer(t, nil)
	sanne, welcome := connect(t, baseURL, "Sanne")
	mo, _ := connect(t, baseURL, "Mo")

	sanne.send(&pb.ClientMessage{Kind: &pb.ClientMessage_State{State: &pb.ShipState{X: 42, Y: 7}}})

	for {
		for _, other := range mo.recv().GetSnapshot().GetPlayers() {
			if other.GetPlayerId() == welcome.GetPlayerId() && other.GetState().GetX() == 42 {
				if got, want := other.GetName(), "Sanne"; got != want {
					t.Errorf("name = %q, want %q", got, want)
				}

				return
			}
		}
	}
}
