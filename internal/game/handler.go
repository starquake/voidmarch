package game

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
	"github.com/starquake/voidmarch/internal/wire"
)

const (
	// StatusUnknownToken closes a connection whose Hello token the server
	// doesn't know (a server restart forgets names); the client registers again.
	StatusUnknownToken websocket.StatusCode = 4001

	helloTimeout = 5 * time.Second
	writeTimeout = 5 * time.Second
	// maxMessageSize caps a client frame; the largest real one is a ShipState.
	maxMessageSize = 4096
)

// errNoHello is why a connection that doesn't open with Hello is closed.
var errNoHello = errors.New("the first message must be hello")

// HandleWS serves the game over a WebSocket: Hello with a player token, then
// ship states and shots in, snapshots and other players' shots out. Each
// connection talks in the format its client uses; wireLog logs every message.
func HandleWS(logger *slog.Logger, hub *Hub, store *players.Store, wireLog bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The default options reject other origins.
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			logger.InfoContext(r.Context(), "websocket upgrade refused", slog.Any("err", err))

			return
		}
		defer func() { _ = conn.CloseNow() }()
		conn.SetReadLimit(maxMessageSize)

		c := &connection{logger: logger, conn: conn, wireLog: wireLog}
		c.serve(r.Context(), hub, store)
	})
}

type connection struct {
	logger  *slog.Logger
	conn    *websocket.Conn
	format  wire.Format
	wireLog bool
	player  string
}

func (c *connection) serve(ctx context.Context, hub *Hub, store *players.Store) {
	hello, err := c.readHello(ctx)
	if err != nil {
		c.logger.InfoContext(ctx, "connection closed before hello", slog.Any("err", err))
		_ = c.conn.Close(websocket.StatusPolicyViolation, errNoHello.Error())

		return
	}

	player, ok := store.ByToken(hello.GetToken())
	if !ok {
		_ = c.conn.Close(StatusUnknownToken, "unknown token")

		return
	}
	c.player = player.ID

	session, welcome, err := hub.Join(ctx, player)
	if errors.Is(err, ErrFull) {
		_ = c.write(ctx, &pb.ServerMessage{Kind: &pb.ServerMessage_Full{Full: &pb.Full{}}})
		_ = c.conn.Close(websocket.StatusTryAgainLater, ErrFull.Error())

		return
	}
	if err != nil {
		_ = c.conn.Close(websocket.StatusGoingAway, "server stopping")

		return
	}
	welcomeMsg := &pb.ServerMessage{Kind: &pb.ServerMessage_Welcome{Welcome: welcome}}
	if err = c.write(ctx, welcomeMsg); err != nil {
		session.Leave()

		return
	}

	written := make(chan struct{})
	go func() {
		defer close(written)
		c.writeAll(ctx, session)
	}()

	c.readAll(ctx, session)
	session.Leave()
	<-written
}

// readHello reads the first message, which picks the connection's format.
func (c *connection) readHello(ctx context.Context) (*pb.Hello, error) {
	ctx, cancel := context.WithTimeout(ctx, helloTimeout)
	defer cancel()

	msg, format, err := c.read(ctx)
	if err != nil {
		return nil, err
	}
	// Fixed here, before the writer starts, so only the writer reads it after.
	c.format = format
	hello := msg.GetHello()
	if hello == nil {
		return nil, errNoHello
	}

	return hello, nil
}

// readAll passes messages to the hub until the connection ends.
func (c *connection) readAll(ctx context.Context, session *Session) {
	for {
		msg, _, err := c.read(ctx)
		if err != nil {
			return
		}
		session.Send(msg)
	}
}

// writeAll sends the session's messages until the hub closes it.
func (c *connection) writeAll(ctx context.Context, session *Session) {
	for msg := range session.Out {
		if err := c.write(ctx, msg); err != nil {
			_ = c.conn.CloseNow()

			return
		}
	}
	_ = c.conn.Close(websocket.StatusNormalClosure, "")
}

// read decodes one frame in the format its frame type says.
func (c *connection) read(ctx context.Context) (*pb.ClientMessage, wire.Format, error) {
	typ, data, err := c.conn.Read(ctx)
	if err != nil {
		return nil, wire.Binary, fmt.Errorf("error reading: %w", err)
	}
	format := wire.Binary
	if typ == websocket.MessageText {
		format = wire.JSON
	}

	msg := &pb.ClientMessage{}
	if err = format.Unmarshal(data, msg); err != nil {
		return nil, format, err //nolint:wrapcheck // already wrapped by wire.
	}
	c.log(ctx, "in", format, msg)

	return msg, format, nil
}

func (c *connection) write(ctx context.Context, msg *pb.ServerMessage) error {
	data, err := c.format.Marshal(msg)
	if err != nil {
		return err //nolint:wrapcheck // already wrapped by wire.
	}
	typ := websocket.MessageBinary
	if c.format == wire.JSON {
		typ = websocket.MessageText
	}

	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	c.log(ctx, "out", c.format, msg)

	if err = c.conn.Write(ctx, typ, data); err != nil {
		return fmt.Errorf("error writing to %s: %w", c.player, err)
	}

	return nil
}

func (c *connection) log(
	ctx context.Context,
	direction string,
	format wire.Format,
	msg proto.Message,
) {
	if !c.wireLog {
		return
	}
	c.logger.DebugContext(ctx, "wire",
		slog.String("dir", direction),
		slog.String("playerId", c.player),
		slog.String("format", format.String()),
		slog.String("msg", protojson.Format(msg)),
	)
}
