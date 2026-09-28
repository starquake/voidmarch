package wire_test

import (
	"strings"
	"testing"

	"google.golang.org/protobuf/proto"

	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	. "github.com/starquake/voidmarch/internal/wire"
)

func state() *pb.ShipState {
	return &pb.ShipState{
		X:         12.5,
		Y:         -40,
		Vx:        3,
		Vy:        -1.5,
		Angle:     1.25,
		Thrusting: true,
		Damage:    2,
		Loadout: &pb.Loadout{
			Weapon: pb.Weapon_WEAPON_ZAPPER,
			Engine: pb.Engine_ENGINE_BURST,
			Shield: pb.Shield_SHIELD_ROUND,
		},
	}
}

func shot() *pb.ShotFired {
	return &pb.ShotFired{
		Id:     7,
		Weapon: pb.Weapon_WEAPON_ROCKETS,
		Muzzle: 1,
		X:      1,
		Y:      2,
		Angle:  -0.5,
	}
}

// every message kind, so a new one can't skip the round trip.
func messages() []proto.Message {
	return []proto.Message{
		&pb.ClientMessage{Kind: &pb.ClientMessage_Hello{Hello: &pb.Hello{Token: "abc"}}},
		&pb.ClientMessage{Kind: &pb.ClientMessage_State{State: state()}},
		&pb.ClientMessage{Kind: &pb.ClientMessage_Shot{Shot: shot()}},
		&pb.ServerMessage{Kind: &pb.ServerMessage_Welcome{Welcome: &pb.Welcome{
			PlayerId: "p1", Colour: 0x8fd8ff, SpawnX: 180, SpawnY: 0, Tick: 42, TickRate: 20,
		}}},
		&pb.ServerMessage{
			Kind: &pb.ServerMessage_Snapshot{
				Snapshot: &pb.Snapshot{Tick: 43, Players: []*pb.PlayerSnapshot{
					{PlayerId: "p2", Name: "Mo", Colour: 0xffb070, State: state()},
				}},
			},
		},
		&pb.ServerMessage{
			Kind: &pb.ServerMessage_Shot{
				Shot: &pb.RemoteShot{PlayerId: "p2", Tick: 44, Shot: shot()},
			},
		},
		&pb.ServerMessage{Kind: &pb.ServerMessage_Left{Left: &pb.PlayerLeft{PlayerId: "p2"}}},
		&pb.ServerMessage{Kind: &pb.ServerMessage_Full{Full: &pb.Full{}}},
		&pb.ClientMessage{
			Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{EnemyId: 3, ShotId: 9, Damage: 4}},
		},
		&pb.ServerMessage{
			Kind: &pb.ServerMessage_Snapshot{
				Snapshot: &pb.Snapshot{Tick: 5, Enemies: []*pb.EnemyState{
					{EnemyId: 3, Kind: pb.EnemyKind_ENEMY_KIND_FIGHTER, X: 1, Y: 2, Angle: 0.5},
				}},
			},
		},
		&pb.ServerMessage{Kind: &pb.ServerMessage_EnemyFired{EnemyFired: &pb.EnemyFired{
			EnemyId: 3,
			Kind:    pb.EnemyKind_ENEMY_KIND_SCOUT,
			Tick:    6,
			Seed:    42,
			X:       1,
			Y:       2,
			Angle:   -1,
		}}},
		&pb.ServerMessage{Kind: &pb.ServerMessage_EnemyDestroyed{EnemyDestroyed: &pb.EnemyDestroyed{
			EnemyId: 3, Kind: pb.EnemyKind_ENEMY_KIND_SCOUT, ByPlayerId: "p1", Tick: 7, X: 1, Y: 2,
		}}},
		&pb.ServerMessage{
			Kind: &pb.ServerMessage_ShotEnded{ShotEnded: &pb.ShotEnded{PlayerId: "p1", ShotId: 9}},
		},
		&pb.ClientMessage{Kind: &pb.ClientMessage_Summon{Summon: &pb.Summon{}}},
		//nolint:staticcheck // old clients may still send it, so it still decodes.
		&pb.ClientMessage{Kind: &pb.ClientMessage_Companion{Companion: &pb.CompanionState{
			Companion: 2, State: &pb.ShipState{X: 1, Y: 2},
		}}},
		&pb.ClientMessage{Kind: &pb.ClientMessage_Dismiss{Dismiss: &pb.Dismiss{Companion: 2}}},
		&pb.ServerMessage{Kind: &pb.ServerMessage_CompanionGranted{
			CompanionGranted: &pb.CompanionGranted{Companion: 1, X: 3, Y: 4},
		}},
		&pb.ServerMessage{Kind: &pb.ServerMessage_CompanionRefused{
			CompanionRefused: &pb.CompanionRefused{Reason: "your wing is full"},
		}},
		&pb.ServerMessage{Kind: &pb.ServerMessage_CompanionDismissed{
			CompanionDismissed: &pb.CompanionDismissed{Companion: 3},
		}},
		&pb.ServerMessage{Kind: &pb.ServerMessage_Snapshot{Snapshot: &pb.Snapshot{
			Tick:    8,
			Players: []*pb.PlayerSnapshot{{PlayerId: "p1/1", Name: "Sanne", OwnerId: "p1"}},
		}}},
	}
}

func TestFormat_RoundTrip(t *testing.T) {
	t.Parallel()

	for _, format := range []Format{Binary, JSON} {
		for _, msg := range messages() {
			t.Run(format.String(), func(t *testing.T) {
				t.Parallel()

				data, err := format.Marshal(msg)
				if err != nil {
					t.Fatalf("Marshal() error = %v", err)
				}
				got := msg.ProtoReflect().New().Interface()
				if err := format.Unmarshal(data, got); err != nil {
					t.Fatalf("Unmarshal() error = %v", err)
				}
				if !proto.Equal(got, msg) {
					t.Errorf("round trip = %v, want %v", got, msg)
				}
			})
		}
	}
}

func TestFormat_JSONIsReadable(t *testing.T) {
	t.Parallel()

	data, err := JSON.Marshal(
		&pb.ClientMessage{Kind: &pb.ClientMessage_Hello{Hello: &pb.Hello{Token: "abc"}}},
	)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	compact := strings.ReplaceAll(string(data), " ", "")
	if got, want := compact, `"token":"abc"`; !strings.Contains(got, want) {
		t.Errorf("JSON = %s, should contain %s", got, want)
	}
}

func TestFormat_UnmarshalError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		format Format
		data   string
	}{
		{format: Binary, data: "\xff\xff\xff"},
		{format: JSON, data: "{not json"},
	}

	for _, tc := range tests {
		t.Run(tc.format.String(), func(t *testing.T) {
			t.Parallel()

			err := tc.format.Unmarshal([]byte(tc.data), &pb.ClientMessage{})
			if got, want := err.Error(), "error decoding "+tc.format.String(); !strings.Contains(
				got,
				want,
			) {
				t.Errorf("err.Error() = %q, should contain %q", got, want)
			}
		})
	}
}
