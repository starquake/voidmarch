package game_test

import (
	"maps"
	"math"
	"slices"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
)

// nextSquadrons reads s's messages until a squadron list arrives.
func nextSquadrons(t *testing.T, s *Session) *pb.Squadrons {
	t.Helper()

	for {
		if list := next(t, s).GetSquadrons(); list != nil {
			return list
		}
	}
}

// names lists the squadrons' names and their members' ids, in order.
func names(list *pb.Squadrons) map[string][]string {
	out := map[string][]string{}
	for _, sq := range list.GetSquadrons() {
		for _, m := range sq.GetMembers() {
			out[sq.GetName()] = append(out[sq.GetName()], m.GetPlayerId())
		}
	}

	return out
}

func TestSquadrons_NewOnesGetTheNextGreekName(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, welcome := join(t, hub, "a")
	if got, want := welcome.GetSquadrons().GetNextName(), "Alpha"; got != want {
		t.Errorf("next name in welcome = %q, want %q", got, want)
	}
	b, _ := join(t, hub, "b")
	if got, want := chooseAndWait(t, a, "").GetName(), "Alpha"; got != want {
		t.Errorf("a's squadron = %q, want %q", got, want)
	}
	if got, want := chooseAndWait(t, b, "").GetName(), "Beta"; got != want {
		t.Errorf("b's squadron = %q, want %q", got, want)
	}

	// Alpha empties when a moves to Beta, and its name is free again.
	chooseAndWait(t, a, "Beta")
	c, _ := join(t, hub, "c")
	if got, want := chooseAndWait(t, c, "").GetName(), "Alpha"; got != want {
		t.Errorf("c's squadron = %q, want the freed %q", got, want)
	}
}

func TestSquadrons_JoinAndListTheFullestFirst(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
	c, _ := join(t, hub, "c")
	chooseAndWait(t, c, "Beta")

	list := nextSquadrons(t, a)
	for len(names(list)["Beta"]) < 2 {
		list = nextSquadrons(t, a)
	}
	if got := list.GetSquadrons()[0].GetName(); got != "Beta" {
		t.Errorf("first squadron = %q, want Beta, which has more players", got)
	}
	if got, want := names(list)["Beta"], []string{"b", "c"}; !slices.Equal(got, want) {
		t.Errorf("Beta = %v, want %v", got, want)
	}
	drain(b)
}

func TestSquadrons_FullOnesRefuse(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	pilot(t, hub, "a")
	for _, id := range []string{"b", "c", "d"} {
		s, _ := join(t, hub, id)
		chooseAndWait(t, s, "Alpha")
	}
	e, _ := join(t, hub, "e")
	e.Send(chooseSquadron("Alpha"))

	for {
		msg := next(t, e)
		if r := msg.GetSquadronRefused(); r != nil {
			if got, want := r.GetReason(), "Alpha is full"; got != want {
				t.Errorf("reason = %q, want %q", got, want)
			}

			return
		}
		if msg.GetSquadronJoined() != nil {
			t.Fatal("joined a squadron of four players")
		}
	}
}

func TestSquadrons_JoiningAFullSquadronTakesOverACompanion(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := pilot(t, hub, "a")
	a.Send(state(0, 180))
	for range 3 {
		grant(t, a)
	}
	b, _ := join(t, hub, "b")

	// No tick has run, so the newest companion is still where it was granted, at a.
	joined := chooseAndWait(t, b, "Alpha")
	if !joined.GetTookOver() || joined.GetX() != 0 || joined.GetY() != 180 {
		t.Errorf("joined = %v, want a takeover where the newest companion is, (0, 180)", joined)
	}
	for {
		if d := next(t, a).GetCompanionDismissed(); d != nil {
			if got, want := d.GetCompanion(), uint32(3); got != want {
				t.Errorf("a lost companion %d, want the newest, %d", got, want)
			}
			if got, want := d.GetTakenBy(), "name-b"; got != want {
				t.Errorf("taken by %q, want %q", got, want)
			}

			return
		}
	}
}

func TestSquadrons_OrdersReachTheOthers(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := join(t, hub, "b")
	chooseAndWait(t, b, "Alpha")
	outsider, _ := pilot(t, hub, "c")
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_SquadronOrder{SquadronOrder: &pb.SquadronOrder{
		Mode: pb.CompanionMode_COMPANION_MODE_ATTACK,
	}}})

	for {
		msg := next(t, b)
		if o := msg.GetSquadronOrdered(); o != nil {
			if o.GetPlayerId() != "a" || o.GetName() != "name-a" ||
				o.GetOrder().GetMode() != pb.CompanionMode_COMPANION_MODE_ATTACK {
				t.Errorf("ordered = %v, want a's Attack", o)
			}

			break
		}
	}
	for {
		list := nextSquadrons(t, outsider)
		i := slices.IndexFunc(
			list.GetSquadrons(),
			func(sq *pb.SquadronInfo) bool { return sq.GetName() == "Alpha" },
		)
		if i >= 0 && list.GetSquadrons()[i].GetMode() == pb.CompanionMode_COMPANION_MODE_ATTACK {
			return
		}
	}
}

func TestSquadrons_KeptOnReconnectAndLeftOnDrop(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")

	again, welcome := join(t, hub, "a")
	if got, want := welcome.GetSquadron(), "Alpha"; got != want {
		t.Errorf("squadron after reconnecting = %q, want %q", got, want)
	}
	again.Leave()
	for {
		if _, ok := names(nextSquadrons(t, b))["Alpha"]; !ok {
			return
		}
	}
}

func TestSquadrons_SnapshotsNameThem(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := join(t, hub, "b")
	a.Send(state(0, 180))

	if got, want := snapshotPlayers(t, b, tick)["a"].GetSquadron(), "Alpha"; got != want {
		t.Errorf("a's squadron in b's snapshot = %q, want %q", got, want)
	}
}

func TestSquadrons_OrdersReachEveryCompanion(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := join(t, hub, "b")
	chooseAndWait(t, b, "Alpha")
	a.Send(state(0, 180))
	b.Send(state(0, -180))
	grant(t, a)
	grant(t, b)

	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_SquadronOrder{SquadronOrder: &pb.SquadronOrder{
		Mode: pb.CompanionMode_COMPANION_MODE_HOLD, X: 150, Y: 150,
	}}})
	var snap *pb.Snapshot
	for range 4 * TickRate {
		b.Send(state(0, -180))
		drain(b)
		snap, _ = latest(t, a, tick, 1, 0, 180)
	}
	for _, p := range snap.GetPlayers() {
		if p.GetOwnerId() == "" {
			continue
		}
		x, y := float64(p.GetState().GetX()), float64(p.GetState().GetY())
		if math.Hypot(x-150, y-150) > 40 {
			t.Errorf(
				"%s at (%v, %v), want holding near (150, 150)",
				p.GetPlayerId(),
				p.GetState().GetX(),
				p.GetState().GetY(),
			)
		}
	}
	if len(snap.GetPlayers()) != 3 {
		t.Errorf("a sees %d ships, want b, a/1 and b/1", len(snap.GetPlayers()))
	}
}

func TestSquadrons_MovingLeavesTheOldOne(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		stays bool
		want  map[string][]string
	}{
		{name: "emptied, it goes", want: map[string][]string{"Beta": {"b", "a"}}},
		{name: "with someone left, it stays", stays: true, want: map[string][]string{"Alpha": {"c"}, "Beta": {"b", "a"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			hub, _ := testHub(t)
			a, _ := pilot(t, hub, "a")
			b, _ := pilot(t, hub, "b")
			if tc.stays {
				c, _ := join(t, hub, "c")
				chooseAndWait(t, c, "Alpha")
			}

			if got, want := chooseAndWait(t, a, "Beta").GetName(), "Beta"; got != want {
				t.Errorf("a's squadron = %q, want %q", got, want)
			}
			list := nextSquadrons(t, b)
			for !slices.Contains(names(list)["Beta"], "a") {
				list = nextSquadrons(t, b)
			}
			if got := names(list); !maps.EqualFunc(got, tc.want, slices.Equal) {
				t.Errorf("squadrons = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSquadrons_MovingToAFullOneIsRefused(t *testing.T) {
	t.Parallel()

	hub, tick := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
	for _, id := range []string{"c", "d", "e"} {
		s, _ := join(t, hub, id)
		chooseAndWait(t, s, "Beta")
	}

	a.Send(chooseSquadron("Beta"))
	for {
		msg := next(t, a)
		if r := msg.GetSquadronRefused(); r != nil {
			if got, want := r.GetReason(), "Beta is full"; got != want {
				t.Errorf("reason = %q, want %q", got, want)
			}

			break
		}
		if msg.GetSquadronJoined() != nil {
			t.Fatal("moved into a squadron of four players")
		}
	}
	a.Send(state(0, 180))
	if got, want := snapshotPlayers(t, b, tick)["a"].GetSquadron(), "Alpha"; got != want {
		t.Errorf("a's squadron after the refusal = %q, want %q", got, want)
	}
}

func TestSquadrons_MovingBringsCompanionsAsFarAsThereIsRoom(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := pilot(t, hub, "a")
	b, _ := pilot(t, hub, "b")
	a.Send(state(0, 180))
	b.Send(state(0, -180))
	grant(t, a)
	grant(t, a)
	grant(t, b)

	// Beta has b and a companion: a and one of a's two fit, and the newest goes home.
	a.Send(chooseSquadron("Beta"))
	var sentHome []uint32
	for {
		msg := next(t, a)
		if d := msg.GetCompanionDismissed(); d != nil {
			sentHome = append(sentHome, d.GetCompanion())
		}
		if j := msg.GetSquadronJoined(); j != nil {
			if j.GetName() != "Beta" || j.GetTookOver() {
				t.Errorf("joined = %v, want Beta without a takeover", j)
			}

			break
		}
	}
	if want := []uint32{2}; !slices.Equal(sentHome, want) {
		t.Errorf("companions sent home = %v, want %v", sentHome, want)
	}
	for {
		for _, sq := range nextSquadrons(t, b).GetSquadrons() {
			if sq.GetName() != "Beta" || len(sq.GetMembers()) < 2 {
				continue
			}
			if got, want := sq.GetMembers()[1].GetCompanions(), uint32(1); got != want {
				t.Errorf("a's companions in Beta = %d, want %d", got, want)
			}

			return
		}
	}
}
