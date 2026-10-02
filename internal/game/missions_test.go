package game_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

func pickMission(sector string) *pb.ClientMessage {
	return &pb.ClientMessage{
		Kind: &pb.ClientMessage_PickMission{PickMission: &pb.PickMission{Sector: sector}},
	}
}

// missionOf is the named squadron's mission in list.
func missionOf(list *pb.Squadrons, name string) string {
	for _, sq := range list.GetSquadrons() {
		if sq.GetName() == name {
			return sq.GetMission()
		}
	}

	return ""
}

func TestMissions_ANewSquadronGetsTheNearestRing1Sector(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t)
	a, _ := join(t, hub, "a")
	j := chooseAndWait(t, a, "")
	if got := missionOf(nextSquadrons(t, a), j.GetName()); got != "C3" {
		t.Errorf("mission = %q, want C3: ring 1, the first by name of those nearest home", got)
	}
}

func TestMissions_ASquadmatePicksAnUnclearedSector(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithClearedSectors([]string{"C3"}))
	a, _ := join(t, hub, "a")
	j := chooseAndWait(t, a, "")
	nextSquadrons(t, a)

	for _, bad := range []string{"C3", "D4", "Z9", "E5"} {
		a.Send(pickMission(bad))
	}
	a.Send(pickMission("E4"))
	if got := missionOf(nextSquadrons(t, a), j.GetName()); got != "E4" {
		t.Errorf(
			"mission = %q after picks of C3 (cleared), D4 (home), Z9, E5 (closed) and E4; want E4",
			got,
		)
	}
}

func TestMissions_ASectorInAnOpenRingCanBePicked(t *testing.T) {
	t.Parallel()

	hub, _ := testHub(t, WithOpenRings(3))
	a, _ := join(t, hub, "a")
	j := chooseAndWait(t, a, "")
	nextSquadrons(t, a)
	a.Send(pickMission("E5"))
	if got := missionOf(nextSquadrons(t, a), j.GetName()); got != "E5" {
		t.Errorf("mission = %q after a pick of E5 with every ring open, want E5", got)
	}
}

func TestMissions_AClearedSectorRewardsEveryoneAndMovesTheMissionOn(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", Garrisons: map[string]int{"E4": 1}}
	hub, tick := testHub(t, WithMap(m), WithPoolStart(3))
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	j := chooseAndWait(t, a, "")
	a.Send(pickMission("E4"))
	nextSquadrons(t, a)
	b.Send(state(0, 0))

	snap, _ := latest(t, a, tick, 1, enterX, enterY)
	killAll(a, snap)
	var cleared *pb.SectorCleared
	var list *pb.Squadrons
	for cleared == nil || list == nil {
		msg := next(t, a)
		if c := msg.GetSectorCleared(); c != nil {
			cleared = c
		}
		if l := msg.GetSquadrons(); l != nil && cleared != nil {
			list = l
		}
	}

	gained := map[string]bool{}
	for _, g := range cleared.GetGains() {
		gained[g.GetPlayerId()] = true
	}
	if !gained["a"] || !gained["b"] {
		t.Errorf("gains for %v, want a part for a and for b, who was at home", gained)
	}
	if got := list.GetHangar(); got != 4 {
		t.Errorf("hangar = %d after the clear, want one more than 3", got)
	}
	if got := missionOf(list, j.GetName()); got == "E4" || got == "" {
		t.Errorf("mission = %q after E4 was cleared, want the next sector", got)
	}
}

func TestMissions_AFullFleetGetsNoShip(t *testing.T) {
	t.Parallel()

	m := &world.Map{Name: "test", Garrisons: map[string]int{"E4": 1}}
	hub, tick := testHub(t, WithMap(m), WithPoolStart(sim.MaxFleet))
	a, _ := join(t, hub, "a")
	snap, _ := latest(t, a, tick, 1, enterX, enterY)
	killAll(a, snap)
	for {
		if l := next(t, a).GetSquadrons(); l != nil {
			if got := l.GetHangar(); got != sim.MaxFleet {
				t.Errorf("hangar = %d, want it kept at the cap, %d", got, sim.MaxFleet)
			}

			return
		}
	}
}
