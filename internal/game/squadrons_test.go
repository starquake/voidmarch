package game_test

import (
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
	a.Send(companionState(3, 60, 210))
	b, _ := join(t, hub, "b")

	joined := chooseAndWait(t, b, "Alpha")
	if !joined.GetTookOver() || joined.GetX() != 60 || joined.GetY() != 210 {
		t.Errorf("joined = %v, want a takeover at the newest companion's (60, 210)", joined)
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
