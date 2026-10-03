package game_test

import (
	"sync"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/players"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// savedStats collects the stats a hub saves, off its tick goroutine.
type savedStats struct {
	mu    sync.Mutex
	stats map[string]players.Stats
}

func (s *savedStats) save(player string, st players.Stats) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stats == nil {
		s.stats = map[string]players.Stats{}
	}
	s.stats[player] = st
}

// settle waits up to a second for player's saved stats to be want, and
// returns them.
func (s *savedStats) settle(player string, want players.Stats) players.Stats {
	deadline := time.Now().Add(time.Second)
	for {
		s.mu.Lock()
		got := s.stats[player]
		s.mu.Unlock()
		if got == want || time.Now().After(deadline) {
			return got
		}
		time.Sleep(time.Millisecond)
	}
}

func shotFired(id uint32) *pb.ClientMessage {
	return &pb.ClientMessage{Kind: &pb.ClientMessage_Shot{Shot: &pb.ShotFired{Id: id}}}
}

func hitBy(enemy, shot, shard uint32) *pb.ClientMessage {
	return &pb.ClientMessage{Kind: &pb.ClientMessage_Hit{Hit: &pb.Hit{
		EnemyId: enemy, ShotId: shot, Shard: shard, Damage: MaxHitDamage,
	}}}
}

func TestStats_CountWhatAPlayersOwnShipDoes(t *testing.T) {
	t.Parallel()

	saved := &savedStats{}
	hub, tick := testHub(t, WithEnemyAt(0, 900), WithSaveStats(saved.save))
	a, _, err := hub.Join(t.Context(), players.Player{
		ID: "a", Name: "name-a", Stats: players.Stats{Kills: 5, Shots: 10},
	})
	if err != nil {
		t.Fatalf("Join(a) error = %v", err)
	}
	snap, _ := latest(t, a, tick, 1, 0, 0)
	enemy := snap.GetEnemies()[0].GetEnemyId()

	for id := range uint32(3) {
		a.Send(shotFired(id + 1))
	}
	// Shot 1 kills, pierces on to another hit, and shot 2's burst shard
	// hits: one hit each for shots 1 and 3, the miss's ram none.
	a.Send(hitBy(enemy, 1, 0))
	a.Send(hitBy(enemy+1, 1, 0))
	a.Send(hitBy(enemy+1, 2, 1))
	a.Send(hitBy(enemy+1, 3, 0))
	a.Send(hitBy(enemy+1, 0, 0))
	must(latest(t, a, tick, 1, 0, 0))
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_State{State: &pb.ShipState{
		Damage: sim.MaxDamage,
	}}})
	tick(1)
	a.Leave()

	want := players.Stats{Kills: 6, Shots: 13, Hits: 2, Deaths: 1}
	if got := saved.settle("a", want); got != want {
		t.Errorf("saved stats = %+v, want %+v, counted on from what a joined with", got, want)
	}
}

func TestStats_ACompanionsKillIsItsOwners(t *testing.T) {
	t.Parallel()

	got := KillsCounted("a", "a/1", "a/2", "b/1")
	if want := (players.Stats{Kills: 1, CompanionKills: 2}); got != want {
		t.Errorf("a's stats = %+v, want %+v: b's companion's kill isn't a's", got, want)
	}
}

func TestStats_ARescueCountsForThePlayerWhoDockedIt(t *testing.T) {
	t.Parallel()

	saved := &savedStats{}
	hub, tick := testHub(t, WithDerelictAt(0, -600), WithPoolStart(3), WithSaveStats(saved.save))
	a, _ := join(t, hub, "a")
	for range rescueTicks + 2 {
		latest(t, a, tick, 1, 60, -600)
	}
	a.Leave()

	want := players.Stats{Rescues: 1}
	if got := saved.settle("a", want); got != want {
		t.Errorf("saved stats = %+v, want %+v", got, want)
	}
}

func TestStats_ASectorClearCountsForEveryoneInIt(t *testing.T) {
	t.Parallel()

	saved := &savedStats{}
	m := &world.Map{Name: "test", Garrisons: map[string]int{"E4": 1}, NoEvents: true}
	hub, tick := testHub(t, WithMap(m), WithSaveStats(saved.save))
	a, _ := join(t, hub, "a")
	b, _ := join(t, hub, "b")
	b.Send(state(0, 0))
	snap := must(latest(t, a, tick, 1, enterX, enterY))
	killAll(a, snap)
	must(latest(t, a, tick, 2, enterX, enterY))
	tick(StatsSaveEvery)

	want := players.Stats{Kills: 1, Hits: 1, Sectors: 1}
	if got := saved.settle("a", want); got != want {
		t.Errorf("a's saved stats = %+v, want %+v: in E4 when it was cleared", got, want)
	}
	if got := saved.settle("b", players.Stats{}); got.Sectors != 0 {
		t.Errorf("b's saved stats = %+v, want no sector: at home", got)
	}
}
