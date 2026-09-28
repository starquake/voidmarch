package sim_test

import (
	"encoding/json"
	"math"
	"os"
	"strconv"
	"testing"

	. "github.com/starquake/voidmarch/internal/sim"
)

// tolerance allows for the last bits of Math.sin, Math.exp and friends
// differing between V8 and Go, and for Go fusing multiply-adds on arm64.
const tolerance = 1e-9

// golden is internal/sim/testdata/golden.json, written by the TypeScript
// sim before the port (#50); the TypeScript rules and that script are gone
// since #53, so the file is a fixed record.
type golden struct {
	Math        goldenMath         `json:"math"`
	Ships       []goldenShip       `json:"ships"`
	Weapons     []goldenWeapon     `json:"weapons"`
	Projectiles []goldenProjectile `json:"projectiles"`
	Hits        []goldenHit        `json:"hits"`
	WorldEdge   []goldenEdge       `json:"worldEdge"`
	Patterns    []goldenPattern    `json:"patterns"`
	Brain       []goldenBrain      `json:"brain"`
	Sandboxes   []goldenSandbox    `json:"sandboxes"`
	OrderSets   []Orders           `json:"orderSets"`
}

type goldenMath struct {
	WrapAngle    [][2]float64   `json:"wrapAngle"`
	SnapAngle    [][3]float64   `json:"snapAngle"`
	Normalize    [][4]float64   `json:"normalize"`
	RotateOffset [][5]float64   `json:"rotateOffset"`
	TriangleWave [][2]float64   `json:"triangleWave"`
	Random       []goldenRandom `json:"random"`
}

type goldenRandom struct {
	Seed   uint32    `json:"seed"`
	Values []float64 `json:"values"`
}

type goldenShip struct {
	Engine   EngineID    `json:"engine"`
	Snap     int         `json:"snap"`
	X        float64     `json:"x"`
	Y        float64     `json:"y"`
	Commands []Command   `json:"commands"`
	States   [][]float64 `json:"states"`
}

type goldenWeapon struct {
	Weapon  WeaponID             `json:"weapon"`
	Ticks   []goldenWeaponTick   `json:"ticks"`
	Results []goldenWeaponResult `json:"results"`
}

type goldenWeaponTick struct {
	Fire  bool    `json:"fire"`
	Angle float64 `json:"angle"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

type goldenWeaponResult struct {
	ChargeStarted bool        `json:"chargeStarted"`
	Shots         [][]float64 `json:"shots"`
	State         []float64   `json:"state"`
}

type goldenProjectile struct {
	Kind      ProjectileKind `json:"kind"`
	Origin    [3]float64     `json:"origin"`
	Travelled [][2]float64   `json:"travelled"`
	Trace     [][4]float64   `json:"trace"`
}

type goldenHit struct {
	Targets []Target[int] `json:"targets"`
	Segment [4]float64    `json:"segment"`
	Hit     int           `json:"hit"`
}

type goldenEdge struct {
	Before [4]float64 `json:"before"`
	After  [4]float64 `json:"after"`
}

type goldenPattern struct {
	Kind    EnemyKind   `json:"kind"`
	X       float64     `json:"x"`
	Y       float64     `json:"y"`
	Angle   float64     `json:"angle"`
	Seed    uint32      `json:"seed"`
	Bullets [][]float64 `json:"bullets"`
}

type goldenBrain struct {
	Self      []float64    `json:"self"`
	Weapon    WeaponID     `json:"weapon"`
	Owner     Mover        `json:"owner"`
	Slot      int          `json:"slot"`
	Enemies   []BrainEnemy `json:"enemies"`
	Orders    Orders       `json:"orders"`
	Seed      uint32       `json:"seed"`
	Command   [5]float64   `json:"command"`
	Done      bool         `json:"done"`
	Formation [2]float64   `json:"formation"`
	Arrive    [2]float64   `json:"arrive"`
}

type goldenSandbox struct {
	ControlMode ControlMode   `json:"controlMode"`
	Frames      []goldenFrame `json:"frames"`
	Trace       []goldenTrace `json:"trace"`
}

type goldenFrame struct {
	Input   Input        `json:"input"`
	Seconds float64      `json:"seconds"`
	Enemies []BrainEnemy `json:"enemies"`
	Order   int          `json:"order"`
}

type goldenTrace struct {
	Ship       []float64   `json:"ship"`
	Companions [][]float64 `json:"companions"`
	Shots      [][]float64 `json:"shots"`
	Ticks      int         `json:"ticks"`
}

func loadGolden(t *testing.T) *golden {
	t.Helper()

	data, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatalf("os.ReadFile() error = %v", err)
	}
	var g golden
	if err := json.Unmarshal(data, &g); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}

	return &g
}

func near(got, want float64) bool {
	return math.Abs(got-want) <= tolerance*math.Max(1, math.Abs(want))
}

func checkNear(t *testing.T, what string, got, want []float64) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("%s = %v, want %v", what, got, want)
	}
	for i := range got {
		if !near(got[i], want[i]) {
			t.Fatalf("%s[%d] = %v, want %v (all: %v, want %v)", what, i, got[i], want[i], got, want)
		}
	}
}

// shipState matches the golden script's: position, velocity, aim and weapon.
func shipState(s *Ship) []float64 {
	return []float64{s.X, s.Y, s.VX, s.VY, s.Angle, s.Cooldown, s.Charging, float64(s.NextMuzzle)}
}

func TestGolden_Math(t *testing.T) {
	t.Parallel()

	g := loadGolden(t)
	for _, c := range g.Math.WrapAngle {
		checkNear(t, "WrapAngle", []float64{WrapAngle(c[0])}, c[1:])
	}
	for _, c := range g.Math.SnapAngle {
		checkNear(t, "SnapAngle", []float64{SnapAngle(c[0], int(c[1]))}, c[2:])
	}
	for _, c := range g.Math.Normalize {
		n := Normalize(c[0], c[1])
		checkNear(t, "Normalize", []float64{n.X, n.Y}, c[2:])
	}
	for _, c := range g.Math.RotateOffset {
		o := RotateOffset(c[0], c[1], c[2])
		checkNear(t, "RotateOffset", []float64{o.X, o.Y}, c[3:])
	}
	for _, c := range g.Math.TriangleWave {
		checkNear(t, "TriangleWave", []float64{TriangleWave(c[0])}, c[1:])
	}
	for _, c := range g.Math.Random {
		r := NewRandom(c.Seed)
		for i, want := range c.Values {
			if got := r.Next(); got != want {
				t.Errorf("NewRandom(%d) value %d = %v, want %v", c.Seed, i, got, want)
			}
		}
	}
}

func TestGolden_Ships(t *testing.T) {
	t.Parallel()

	for _, c := range loadGolden(t).Ships {
		ship := NewShip(
			c.X,
			c.Y,
			Loadout{Weapon: WeaponAutoCannon, Engine: c.Engine, Shield: ShieldFront},
		)
		ship.RotationSnap = c.Snap
		for i, cmd := range c.Commands {
			StepShip(ship, cmd, TickSeconds)
			got := shipState(ship)
			checkNear(t, string(c.Engine)+" tick "+strconv.Itoa(i), got[:5], c.States[i][:5])
		}
	}
}

func TestGolden_Weapons(t *testing.T) {
	t.Parallel()

	for _, c := range loadGolden(t).Weapons {
		ship := NewShip(0, 0, Loadout{Weapon: c.Weapon, Engine: EngineBase, Shield: ShieldFront})
		for i, tick := range c.Ticks {
			ship.Angle, ship.X, ship.Y = tick.Angle, tick.X, tick.Y
			step := StepWeapon(ship, tick.Fire, TickSeconds)
			want := c.Results[i]
			what := string(c.Weapon) + " tick " + strconv.Itoa(i)
			if step.ChargeStarted != want.ChargeStarted {
				t.Fatalf(
					"%s: ChargeStarted = %t, want %t",
					what,
					step.ChargeStarted,
					want.ChargeStarted,
				)
			}
			if len(step.Shots) != len(want.Shots) {
				t.Fatalf("%s: %d shots, want %d", what, len(step.Shots), len(want.Shots))
			}
			for k, s := range step.Shots {
				checkNear(
					t,
					what+" shot",
					[]float64{float64(s.Muzzle), s.X, s.Y, s.Angle},
					want.Shots[k],
				)
			}
			checkNear(t, what+" state", shipState(ship), want.State)
		}
	}
}

func TestGolden_Projectiles(t *testing.T) {
	t.Parallel()

	for _, c := range loadGolden(t).Projectiles {
		stats := ProjectileStatsOf(c.Kind)
		for _, tr := range c.Travelled {
			checkNear(t, string(c.Kind)+" Travelled", []float64{Travelled(stats, tr[0])}, tr[1:])
		}
		pool := NewPool(4)
		p := pool.Spawn(
			ProjectileSpawn{Kind: c.Kind, X: c.Origin[0], Y: c.Origin[1], Angle: c.Origin[2]},
			SpawnOptions{},
		)
		for i, want := range c.Trace {
			expired := pool.Step(TickSeconds, func(float64, float64) bool { return true })
			got := []float64{p.X, p.Y, p.Age, 0}
			if len(expired) > 0 {
				got[3] = 1
			}
			checkNear(t, string(c.Kind)+" tick "+strconv.Itoa(i), got, want[:])
		}
	}
}

func TestGolden_Hits(t *testing.T) {
	t.Parallel()

	for i, c := range loadGolden(t).Hits {
		hit, ok := HitTargetAlong(c.Segment[0], c.Segment[1], c.Segment[2], c.Segment[3], c.Targets)
		got := -1
		if ok {
			got = hit.ID
		}
		if got != c.Hit {
			t.Errorf("case %d: hit = %d, want %d", i, got, c.Hit)
		}
	}
}

func TestGolden_WorldEdge(t *testing.T) {
	t.Parallel()

	for _, c := range loadGolden(t).WorldEdge {
		ship := NewShip(c.Before[0], c.Before[1], DefaultLoadout())
		ship.VX, ship.VY = c.Before[2], c.Before[3]
		ApplyWorldEdge(ship, TickSeconds)
		checkNear(t, "ApplyWorldEdge", []float64{ship.X, ship.Y, ship.VX, ship.VY}, c.After[:])
	}
}

func TestGolden_Patterns(t *testing.T) {
	t.Parallel()

	for _, c := range loadGolden(t).Patterns {
		bullets := EnemyPattern(c.Kind, c.X, c.Y, c.Angle, c.Seed)
		if len(bullets) != len(c.Bullets) {
			t.Fatalf("EnemyPattern(%s) = %d bullets, want %d", c.Kind, len(bullets), len(c.Bullets))
		}
		for i, b := range bullets {
			checkNear(t, "EnemyPattern", []float64{b.X, b.Y, b.Angle}, c.Bullets[i])
		}
	}
}

func TestGolden_Brain(t *testing.T) {
	t.Parallel()

	for i, c := range loadGolden(t).Brain {
		self := NewShip(
			c.Self[0],
			c.Self[1],
			Loadout{Weapon: c.Weapon, Engine: EngineBase, Shield: ShieldFront},
		)
		self.VX, self.VY, self.Angle = c.Self[2], c.Self[3], c.Self[4]
		self.Damage = int(c.Self[8])
		view := BrainView{Self: self, Owner: c.Owner, Slot: c.Slot, Enemies: c.Enemies}
		what := "brain case " + strconv.Itoa(i)

		f := FormationPoint(c.Owner, c.Slot, 1)
		checkNear(t, what+" FormationPoint", []float64{f.X, f.Y}, c.Formation[:])
		a := Arrive(self, Vec{}, Vec{})
		checkNear(t, what+" Arrive", []float64{a.X, a.Y}, c.Arrive[:])

		step := Think(view, c.Orders, NewRandom(c.Seed))
		fire := 0.0
		if step.Command.Fire {
			fire = 1
		}
		got := []float64{
			step.Command.MoveX,
			step.Command.MoveY,
			step.Command.AimX,
			step.Command.AimY,
			fire,
		}
		checkNear(t, what+" Think", got, c.Command[:])
		if step.Done != c.Done {
			t.Errorf("%s: Done = %t, want %t", what, step.Done, c.Done)
		}
	}
}

func TestGolden_Sandbox(t *testing.T) {
	t.Parallel()

	g := loadGolden(t)
	for v, c := range g.Sandboxes {
		s := NewSandbox()
		s.ControlMode = c.ControlMode
		for n := 1; n <= 3; n++ {
			s.AddCompanion(n, float64(n*30), 120)
		}
		companionShots := 0
		for f, frame := range c.Frames {
			if frame.Order >= 0 {
				next := g.OrderSets[(frame.Order*2+v)%len(g.OrderSets)]
				for _, comp := range s.Companions {
					s.Order(comp, next)
				}
			}
			events := s.Advance(frame.Seconds, frame.Input, frame.Enemies)
			want := c.Trace[f]
			what := string(c.ControlMode) + " frame " + strconv.Itoa(f)
			if events.Ticks != want.Ticks {
				t.Fatalf("%s: %d ticks, want %d", what, events.Ticks, want.Ticks)
			}
			checkNear(t, what+" ship", shipState(s.Ship), want.Ship)
			for k, comp := range s.Companions {
				checkNear(t, what+" companion", shipState(comp.Ship), want.Companions[k])
			}
			if len(events.Shots) != len(want.Shots) {
				t.Fatalf("%s: %d shots, want %d", what, len(events.Shots), len(want.Shots))
			}
			for k, shot := range events.Shots {
				if shot.Companion > 0 {
					companionShots++
				}
				got := []float64{
					float64(shot.Companion),
					float64(shot.ID),
					shot.X,
					shot.Y,
					shot.Angle,
				}
				checkNear(t, what+" shot", got, want.Shots[k])
			}
		}
		if companionShots == 0 {
			t.Errorf("%s: companions never fired, so the scenario proves little", c.ControlMode)
		}
	}
}
