package sim_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

type flight struct {
	ownerCommand *Command
	enemies      []BrainEnemy
	slot         int
}

// fly steps a companion and its owner together for the given seconds.
func fly(self, owner *Ship, seconds float64, f flight) {
	random := NewRandom(7)
	for tick := 0.0; tick < seconds; tick += TickSeconds {
		step := Think(
			BrainView{Self: self, Owner: owner.Mover(), Slot: f.slot, Enemies: f.enemies},
			random,
		)
		StepShip(self, step.Command, TickSeconds)
		ownerCmd := Command{AimX: owner.X, AimY: owner.Y - 1000}
		if f.ownerCommand != nil {
			ownerCmd = *f.ownerCommand
		}
		StepShip(owner, ownerCmd, TickSeconds)
	}
}

func dist(ax, ay, bx, by float64) float64 {
	return math.Hypot(ax-bx, ay-by)
}

// fromSlot is how far self is from slot 0 of owner's formation.
func fromSlot(self, owner *Ship) float64 {
	p := FormationPoint(owner.Mover(), 0, 1)

	return dist(self.X, self.Y, p.X, p.Y)
}

func newShip(x, y float64) *Ship {
	return NewShip(x, y, DefaultLoadout())
}

func TestFormationPoint(t *testing.T) {
	t.Parallel()

	owner := Mover{Angle: -math.Pi / 2}
	for slot := range FormationSlots() {
		if p := FormationPoint(owner, slot, 1); p.Y <= 0 {
			t.Errorf("slot %d at %v, want behind an owner facing up", slot, p)
		}
	}
	if FormationPoint(owner, 0, 1).X >= 0 || FormationPoint(owner, 1, 1).X <= 0 {
		t.Error("slots 0 and 1 are not left and right")
	}
	owner.Angle = 0
	if FormationPoint(owner, 2, 1).X >= 0 {
		t.Error("behind an owner facing right is not to the left")
	}

	owner.Angle = -math.Pi / 2
	points := make([]Vec, 0, 15)
	for slot := range 15 {
		points = append(points, FormationPoint(owner, slot, 1))
	}
	for i, a := range points {
		for _, b := range points[i+1:] {
			if dist(a.X, a.Y, b.X, b.Y) <= 20 {
				t.Fatalf("slots at %v and %v, want no two sharing a point", a, b)
			}
		}
	}
	if dist(points[3].X, points[3].Y, 0, 0) <= dist(points[0].X, points[0].Y, 0, 0) {
		t.Error("slot 3 is not on a wider ring than slot 0")
	}
}

func TestThink_SettlesIntoItsSlot(t *testing.T) {
	t.Parallel()

	owner, self := newShip(0, 0), newShip(220, 160)
	fly(self, owner, 3, flight{})
	if d := fromSlot(self, owner); d >= BrainInFormation || math.Hypot(self.VX, self.VY) >= 30 {
		t.Errorf(
			"%v from its slot at speed %v, want in it and at rest",
			d,
			math.Hypot(self.VX, self.VY),
		)
	}

	a, b := newShip(100, 100), newShip(100, 100)
	fly(a, owner, 3, flight{slot: 0})
	fly(b, owner, 3, flight{slot: 1})
	if dist(a.X, a.Y, b.X, b.Y) <= 60 {
		t.Error("two companions share a slot")
	}
}

func TestThink_FollowsTheOwner(t *testing.T) {
	t.Parallel()

	owner, self := newShip(0, 0), newShip(0, 60)
	fly(self, owner, 2, flight{})
	owner.Angle = 0
	fly(self, owner, 3, flight{ownerCommand: &Command{AimX: 1000}})
	if d := fromSlot(self, owner); d >= BrainInFormation {
		t.Errorf("after a turn: %v from its slot, want in it", d)
	}

	owner, self = newShip(0, 0), newShip(0, 60)
	fly(self, owner, 4, flight{ownerCommand: &Command{MoveX: 1, AimX: 10_000}})
	if d := fromSlot(self, owner); d >= 40 {
		t.Errorf("at full speed: %v from its slot, want within 40", d)
	}
	fly(self, owner, 2, flight{})
	if d := fromSlot(self, owner); d >= BrainInFormation {
		t.Errorf("once the owner stops: %v from its slot, want in it", d)
	}
}

func TestThink_NothingToShoot(t *testing.T) {
	t.Parallel()

	owner := Mover{}
	self := newShip(-40, 40)
	step := Think(BrainView{Self: self, Owner: owner}, NewRandom(1))
	if step.Command.Fire || step.Command.AimX <= self.X ||
		math.Abs(step.Command.AimY-self.Y) >= 1 ||
		step.Home {
		t.Errorf("Think() = %+v, want holding fire, looking where the owner looks", step)
	}
}

// facing is a companion at (x, y) facing (fx, fy), with its owner at the
// origin facing up.
func facing(x, y, fx, fy float64) (*Ship, Mover) {
	self := newShip(x, y)
	self.Angle = math.Atan2(fy-y, fx-x)

	return self, newShip(0, 0).Mover()
}

func enemy(id int, x, y float64) BrainEnemy {
	return BrainEnemy{ID: id, X: x, Y: y}
}

func decide(self *Ship, owner Mover, enemies []BrainEnemy) BrainStep {
	return Think(BrainView{Self: self, Owner: owner, Enemies: enemies}, NewRandom(3))
}

func aimAngle(self *Ship, cmd Command) float64 {
	return math.Atan2(cmd.AimY-self.Y, cmd.AimX-self.X)
}

func TestThink_Escorting(t *testing.T) {
	t.Parallel()

	self, owner := facing(-40, 40, 150, -150)
	step := decide(self, owner, []BrainEnemy{enemy(1, 150, -150)})
	if !step.Command.Fire || math.Abs(aimAngle(self, step.Command)-self.Angle) >= 0.1 {
		t.Errorf("facing an enemy near the owner: %+v, want aimed and firing", step.Command)
	}
	self.Angle++
	if decide(self, owner, []BrainEnemy{enemy(1, 150, -150)}).Command.Fire {
		t.Error("fired while facing away")
	}

	self, owner = facing(-40, 40, 500, -300)
	if decide(self, owner, []BrainEnemy{enemy(1, 500, -300)}).Command.Fire {
		t.Error("fired at an enemy far from its owner")
	}
	self, owner = facing(-280, 280, 250, -250)
	if decide(self, owner, []BrainEnemy{enemy(1, 250, -250)}).Command.Fire {
		t.Error("fired past its weapon's range")
	}
}

func TestChooseTarget_CompanionsSpreadOverTheNearestEnemies(t *testing.T) {
	t.Parallel()

	self, owner := newShip(0, 0), newShip(0, 0)
	far := enemy(4, 160, 300)
	all := []BrainEnemy{enemy(1, 100, -100), enemy(2, -110, -100), enemy(3, 0, 130), far}
	const near = 3
	picked := map[int]bool{}
	for key := range uint32(12) {
		view := BrainView{
			Self:      self,
			Owner:     owner.Mover(),
			SpreadKey: key,
			Enemies:   all,
		}
		target, ok := ChooseTarget(view)
		if !ok {
			t.Fatalf("key %d: no target among %v", key, view.Enemies)
		}
		if target.ID == far.ID {
			t.Errorf(
				"key %d: picked the far enemy, over %v from the nearest",
				key,
				TargetSpreadReach,
			)
		}
		picked[target.ID] = true
		if again, _ := ChooseTarget(view); again.ID != target.ID {
			t.Errorf(
				"key %d: picked %d, then %d from the same view, want it held",
				key,
				target.ID,
				again.ID,
			)
		}
	}
	if len(picked) != near {
		t.Errorf("12 companions picked %v, want all %d near enemies covered", picked, near)
	}
}

func TestThink_TheBigGunFiresAtAnything(t *testing.T) {
	t.Parallel()

	self, owner := facing(-40, 40, 40, -40)
	self.Loadout.Weapon = WeaponBigSpaceGun
	if !decide(self, owner, []BrainEnemy{enemy(1, 40, -40)}).Command.Fire {
		t.Error("the big space gun held its volley from a Scout")
	}
}

func TestThink_BadlyDamagedKeepsItsSlot(t *testing.T) {
	t.Parallel()

	self, owner := newShip(-40, 40), newShip(0, 0)
	self.Damage = MaxDamage - 1
	fly(self, owner, 3, flight{enemies: []BrainEnemy{enemy(1, 150, -150)}})
	if d := fromSlot(self, owner); d >= BrainInFormation {
		t.Errorf("one hit from down: %v from its slot, want in it", d)
	}
}

// untilHome flies a companion going home until it is there and returns the
// seconds it took, or +Inf.
func untilHome(self *Ship, owner Mover, limit float64) float64 {
	random := NewRandom(11)
	for tick := 0.0; tick < limit; tick += TickSeconds {
		step := Think(BrainView{Self: self, Owner: owner, GoingHome: true}, random)
		if step.Home {
			return tick
		}
		StepShip(self, step.Command, TickSeconds)
	}

	return math.Inf(1)
}

func TestThink_GoingHome(t *testing.T) {
	t.Parallel()

	self := newShip(900, -400)
	if took := untilHome(self, newShip(900, -350).Mover(), 8); took >= 8 ||
		math.Hypot(self.X, self.Y) > BrainHomeRadius {
		t.Errorf(
			"going home took %v s, ended at (%v, %v), want inside %v",
			took,
			self.X,
			self.Y,
			BrainHomeRadius,
		)
	}
	downed := Mover{X: 900, Y: -350, Downed: true}
	view := BrainView{Self: newShip(900, -400), Owner: downed, GoingHome: true}
	if step := Think(view, NewRandom(1)); step.Command.MoveX >= 0 {
		t.Errorf("going home past its downed owner: move %+v, want home", step.Command)
	}
}
