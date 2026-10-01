package game_test

import (
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
)

func TestSimEnemyKind(t *testing.T) {
	t.Parallel()

	tests := []struct {
		kind pb.EnemyKind
		want sim.EnemyKind
	}{
		{pb.EnemyKind_ENEMY_KIND_SCOUT, sim.EnemyScout},
		{pb.EnemyKind_ENEMY_KIND_FIGHTER, sim.EnemyFighter},
		{pb.EnemyKind_ENEMY_KIND_FRIGATE, sim.EnemyFrigate},
		{pb.EnemyKind_ENEMY_KIND_UNSPECIFIED, sim.EnemyScout},
	}
	for _, tc := range tests {
		if got := SimEnemyKind(tc.kind); got != tc.want {
			t.Errorf("SimEnemyKind(%v) = %q, want %q", tc.kind, got, tc.want)
		}
	}
}
