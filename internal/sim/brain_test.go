package sim_test

import (
	"math"
	"reflect"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

type flight struct {
	orders       *Orders
	ownerCommand *Command
	enemies      []BrainEnemy
	slot         int
}

// fly steps a companion and its owner together for the given seconds.
func fly(self, owner *Ship, seconds float64, f flight) {
	random := NewRandom(7)
	orders := DefaultOrders()
	if f.orders != nil {
		orders = *f.orders
	}
	for tick := 0.0; tick < seconds; tick += TickSeconds {
		step := Think(
			BrainView{Self: self, Owner: owner.Mover(), Slot: f.slot, Enemies: f.enemies},
			orders,
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
func fromSlot(self, owner *Ship, scale float64) float64 {
	p := FormationPoint(owner.Mover(), 0, scale)

	return dist(self.X, self.Y, p.X, p.Y)
}

func orders(change func(*Orders)) *Orders {
	o := DefaultOrders()
	change(&o)

	return &o
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
	if d := fromSlot(self, owner, 1); d >= BrainInFormation || math.Hypot(self.VX, self.VY) >= 30 {
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
	if d := fromSlot(self, owner, 1); d >= BrainInFormation {
		t.Errorf("after a turn: %v from its slot, want in it", d)
	}

	owner, self = newShip(0, 0), newShip(0, 60)
	fly(self, owner, 4, flight{ownerCommand: &Command{MoveX: 1, AimX: 10_000}})
	if d := fromSlot(self, owner, 1); d >= 40 {
		t.Errorf("at full speed: %v from its slot, want within 40", d)
	}
	fly(self, owner, 2, flight{})
	if d := fromSlot(self, owner, 1); d >= BrainInFormation {
		t.Errorf("once the owner stops: %v from its slot, want in it", d)
	}
}

func TestThink_NothingToShoot(t *testing.T) {
	t.Parallel()

	owner := Mover{}
	self := newShip(-40, 40)
	step := Think(BrainView{Self: self, Owner: owner}, DefaultOrders(), NewRandom(1))
	if step.Command.Fire || step.Command.AimX <= self.X ||
		math.Abs(step.Command.AimY-self.Y) >= 1 ||
		step.Done {
		t.Errorf("Think() = %+v, want holding fire, looking where the owner looks", step)
	}
}

func TestThink_Stances(t *testing.T) {
	t.Parallel()

	owner, self := newShip(0, 0), newShip(100, 100)
	fly(self, owner, 3, flight{orders: orders(func(o *Orders) { o.Stance = StanceDefensive })})
	if fromSlot(self, owner, BrainTightFormation) >= BrainInFormation {
		t.Error("defensive: not in the tight formation")
	}

	owner, self = newShip(0, 0), newShip(0, 60)
	hold := orders(func(o *Orders) { o.Stance, o.HoldX, o.HoldY = StanceHold, -150, 80 })
	fly(self, owner, 4, flight{orders: hold, ownerCommand: &Command{MoveX: 1, AimX: 10_000}})
	if dist(self.X, self.Y, -150, 80) >= BrainInFormation ||
		dist(self.X, self.Y, owner.X, owner.Y) <= 300 {
		t.Errorf(
			"holding at (%v, %v), want at (-150, 80) while the owner flies off",
			self.X,
			self.Y,
		)
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
	return BrainEnemy{ID: id, Kind: EnemyScout, X: x, Y: y}
}

func attacker(id int, x, y float64) BrainEnemy {
	e := enemy(id, x, y)
	e.AttackedWing = true

	return e
}

func decide(self *Ship, owner Mover, enemies []BrainEnemy, change func(*Orders)) BrainStep {
	o := DefaultOrders()
	if change != nil {
		change(&o)
	}

	return Think(BrainView{Self: self, Owner: owner, Enemies: enemies}, o, NewRandom(3))
}

func aimAngle(self *Ship, cmd Command) float64 {
	return math.Atan2(cmd.AimY-self.Y, cmd.AimX-self.X)
}

func TestThink_Escorting(t *testing.T) {
	t.Parallel()

	self, owner := facing(-40, 40, 150, -150)
	step := decide(self, owner, []BrainEnemy{enemy(1, 150, -150)}, nil)
	if !step.Command.Fire || math.Abs(aimAngle(self, step.Command)-self.Angle) >= 0.1 {
		t.Errorf("facing an enemy near the owner: %+v, want aimed and firing", step.Command)
	}
	self.Angle++
	if decide(self, owner, []BrainEnemy{enemy(1, 150, -150)}, nil).Command.Fire {
		t.Error("fired while facing away")
	}

	self, owner = facing(-40, 40, 500, -300)
	if decide(self, owner, []BrainEnemy{enemy(1, 500, -300)}, nil).Command.Fire {
		t.Error("fired at an enemy far from its owner")
	}
	self, owner = facing(-280, 280, 250, -250)
	if decide(self, owner, []BrainEnemy{enemy(1, 250, -250)}, nil).Command.Fire {
		t.Error("fired past its weapon's range")
	}
}

func TestThink_Aggressive(t *testing.T) {
	t.Parallel()

	aggressive := func(o *Orders) { o.Stance = StanceAggressive }
	self, owner := facing(-40, 40, 0, -400)
	fighter := enemy(1, -100, -150)
	fighter.Kind = EnemyFighter
	scout := enemy(2, 200, -350)
	cmd := decide(self, owner, []BrainEnemy{fighter, scout}, aggressive).Command
	if math.Abs(aimAngle(self, cmd)-math.Atan2(scout.Y-self.Y, scout.X-self.X)) >= 0.1 {
		t.Error("aimed at the nearer Fighter, want the weaker Scout")
	}
	if cmd.MoveX <= 0 || cmd.MoveY >= 0 {
		t.Errorf("move = (%v, %v), want toward the Scout", cmd.MoveX, cmd.MoveY)
	}
	if decide(self, owner, []BrainEnemy{enemy(3, 0, -700)}, aggressive).Command.MoveY < 0 {
		t.Error("hunted past the leash")
	}

	self, ownerShip := newShip(-40, 40), newShip(0, 0)
	fly(
		self,
		ownerShip,
		3,
		flight{orders: orders(aggressive), enemies: []BrainEnemy{enemy(1, 250, -300)}},
	)
	if d := dist(self.X, self.Y, 250, -300); math.Abs(d-BrainAttackDistance) >= 20 {
		t.Errorf("%v from its target, want about %v", d, BrainAttackDistance)
	}
}

func TestThink_FireDiscipline(t *testing.T) {
	t.Parallel()

	self, owner := facing(-40, 40, 100, -100)
	for _, change := range []func(*Orders){
		func(o *Orders) { o.Fire = FireReturn },
		func(o *Orders) { o.Stance = StanceDefensive },
	} {
		if decide(self, owner, []BrainEnemy{enemy(1, 100, -100)}, change).Command.Fire {
			t.Error("fired at an enemy that hadn't attacked")
		}
		if !decide(self, owner, []BrainEnemy{attacker(2, 100, -100)}, change).Command.Fire {
			t.Error("held fire at an attacker")
		}
	}

	target := attacker(5, 100, -100)
	if decide(
		self,
		owner,
		[]BrainEnemy{target},
		func(o *Orders) { o.Fire = FireHold },
	).Command.Fire {
		t.Error("fired under hold fire")
	}
	focused := decide(self, owner, []BrainEnemy{target}, func(o *Orders) {
		o.Fire, o.OneShot = FireHold, OneShot{Kind: OneShotFocus, EnemyID: 5}
	})
	if !focused.Command.Fire || focused.Done {
		t.Errorf("focus under hold fire: %+v, want firing, not done", focused)
	}
}

func TestThink_Focus(t *testing.T) {
	t.Parallel()

	self, owner := facing(-40, 40, 0, -1000)
	focus := func(o *Orders) { o.OneShot = OneShot{Kind: OneShotFocus, EnemyID: 9} }
	if decide(
		self,
		owner,
		[]BrainEnemy{enemy(9, 0, -900), enemy(1, 60, -60)},
		focus,
	).Command.MoveY >= 0 {
		t.Error("not heading for the focus target past the nearer enemy")
	}
	if !decide(self, owner, []BrainEnemy{enemy(1, 60, -60)}, focus).Done {
		t.Error("focus not done once its enemy is gone")
	}
}

func TestThink_HoldShootsInReach(t *testing.T) {
	t.Parallel()

	self, owner := facing(-600, 0, -600, -300)
	step := decide(self, owner, []BrainEnemy{enemy(1, -600, -300)}, func(o *Orders) {
		o.Stance, o.HoldX, o.HoldY = StanceHold, -600, 0
	})
	if !step.Command.Fire {
		t.Error("holding position, didn't shoot what its weapon reaches")
	}
}

func TestThink_SupportFirstIsANoOpForNow(t *testing.T) {
	t.Parallel()

	self, owner := facing(-40, 40, 100, -100)
	fighter := enemy(2, -150, -100)
	fighter.Kind = EnemyFighter
	enemies := []BrainEnemy{enemy(1, 100, -100), fighter}
	a := decide(self, owner, enemies, func(o *Orders) { o.SupportFirst = true })
	if b := decide(self, owner, enemies, nil); !reflect.DeepEqual(a, b) {
		t.Errorf("Support Ships first = %+v, without = %+v, want the same", a, b)
	}
}

// untilDone flies a companion under orders until its one-shot is done and
// returns the seconds it took, or +Inf.
func untilDone(self *Ship, owner Mover, o Orders, enemies []BrainEnemy, limit float64) float64 {
	random := NewRandom(11)
	for tick := 0.0; tick < limit; tick += TickSeconds {
		step := Think(BrainView{Self: self, Owner: owner, Enemies: enemies}, o, random)
		if step.Done {
			return tick
		}
		StepShip(self, step.Command, TickSeconds)
	}

	return math.Inf(1)
}

func TestThink_OneShots(t *testing.T) {
	t.Parallel()

	self, owner := facing(250, -250, 300, -300)
	regroup := *orders(func(o *Orders) { o.Stance, o.OneShot = StanceAggressive, OneShot{Kind: OneShotRegroup} })
	scout := attacker(1, 300, -300)
	if decide(self, owner, []BrainEnemy{scout}, func(o *Orders) { *o = regroup }).Command.Fire {
		t.Error("regrouping, it fired")
	}
	if took := untilDone(self, owner, regroup, []BrainEnemy{scout}, 8); took >= 4 {
		t.Errorf("regroup took %v s, want under 4", took)
	}
	if p := FormationPoint(owner, 0, 1); dist(self.X, self.Y, p.X, p.Y) > BrainInFormation {
		t.Error("regroup done, but not in its slot")
	}

	self = newShip(900, -400)
	goHome := *orders(func(o *Orders) { o.OneShot = OneShot{Kind: OneShotGoHome} })
	if took := untilDone(self, newShip(900, -350).Mover(), goHome, nil, 8); took >= 8 ||
		math.Hypot(self.X, self.Y) > BrainHomeRadius {
		t.Errorf(
			"going home took %v s, ended at (%v, %v), want inside %v",
			took,
			self.X,
			self.Y,
			BrainHomeRadius,
		)
	}
}

func TestThink_Shielding(t *testing.T) {
	t.Parallel()

	shieldMe := orders(func(o *Orders) { o.OneShot = OneShot{Kind: OneShotShieldMe} })
	attackers := []BrainEnemy{attacker(1, 150, -200), attacker(2, -150, -200)}
	self, owner := newShip(-40, 40), newShip(0, 0)
	fly(self, owner, 3, flight{orders: shieldMe, enemies: attackers})
	if dist(self.X, self.Y, 0, -BrainShieldDistance) >= BrainInFormation {
		t.Errorf("shielding at (%v, %v), want straight toward the attackers", self.X, self.Y)
	}
	set := func(o *Orders) { *o = *shieldMe }
	if decide(self, owner.Mover(), attackers, set).Done {
		t.Error("shield me done while attackers remain")
	}
	if !decide(self, owner.Mover(), []BrainEnemy{enemy(3, 100, -100)}, set).Done {
		t.Error("shield me not done once nobody attacks")
	}

	self, owner = newShip(-40, 40), newShip(0, 0)
	fly(self, owner, 3, flight{
		orders:  orders(func(o *Orders) { o.Stance = StanceDefensive }),
		enemies: []BrainEnemy{attacker(1, 0, -250)},
	})
	if dist(self.X, self.Y, 0, -BrainShieldDistance) >= BrainInFormation {
		t.Errorf("defensive at (%v, %v), want between its owner and the attacker", self.X, self.Y)
	}
}

func TestThink_ConservingSavesTheBigGun(t *testing.T) {
	t.Parallel()

	self, owner := facing(-40, 40, 40, -40)
	self.Loadout.Weapon = WeaponBigSpaceGun
	scout := []BrainEnemy{enemy(1, 40, -40)}
	conserve := func(o *Orders) { o.Resources = ResourcesConserve }
	if !decide(self, owner, scout, nil).Command.Fire {
		t.Error("spending, the big gun held its volley")
	}
	if decide(self, owner, scout, conserve).Command.Fire {
		t.Error("conserving, the big gun fired at a Scout")
	}
	if !decide(self, owner, scout, func(o *Orders) {
		o.Resources, o.OneShot = ResourcesConserve, OneShot{Kind: OneShotFocus, EnemyID: 1}
	}).Command.Fire {
		t.Error("conserving, the big gun held its volley from a focus target")
	}
	self.Loadout.Weapon = WeaponAutoCannon
	if !decide(self, owner, scout, conserve).Command.Fire {
		t.Error("conserving, the auto cannon held fire")
	}
}

func TestThink_BadlyDamagedFallsBack(t *testing.T) {
	t.Parallel()

	hunt := func(resources ResourceOrder) float64 {
		self, owner := newShip(-40, 40), newShip(0, 0)
		self.Damage = BrainBadlyDamaged
		fly(self, owner, 3, flight{
			orders: orders(
				func(o *Orders) { o.Stance, o.Resources = StanceAggressive, resources },
			),
			enemies: []BrainEnemy{attacker(1, 250, -300)},
		})

		return dist(self.X, self.Y, owner.X, owner.Y)
	}
	if d := hunt(ResourcesSpend); d <= 200 {
		t.Errorf("spending: %v from its owner, want fighting on", d)
	}
	if d := hunt(ResourcesConserve); d >= 100 {
		t.Errorf("conserving: %v from its owner, want staying close", d)
	}
}
