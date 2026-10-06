package game_test

import (
	"math"
	"testing"

	. "github.com/starquake/voidmarch/internal/game"
	pb "github.com/starquake/voidmarch/internal/gen/voidmarch/v1"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/world"
)

// The simulated Dreadnought fight (#223): how long the companions fight,
// how far from it their owner stands, and how many fly.
const (
	rateMinutes  = 5
	rateWarmUp   = 90 * TickRate
	rateStandOff = 380
	rateWingSize = 3
	rateTicks    = rateMinutes * 60 * TickRate
	// rateHealthScale gives the Dreadnought enough health to outlast the
	// fight at any weapon and tier; the rate is per minute, whatever it has.
	rateHealthScale = 10
)

// noGarrisons is a map whose sectors hold no garrison, so a companion's
// only target is the Dreadnought.
func noGarrisons() map[string]int {
	out := map[string]int{}
	for _, s := range sim.Sectors() {
		out[s.Name()] = 0
	}

	return out
}

// wingFight is what a wing did against the Dreadnought.
type wingFight struct {
	// taken is the health it took off, and upTicks the ticks its companions
	// were up between them.
	taken   float64
	upTicks int
	hits    int
	downs   int
}

// perShipMinute is the health taken off per companion a minute, the time
// they spent down included.
func (f wingFight) perShipMinute() float64 {
	return f.taken / rateWingSize / rateMinutes
}

// perUpMinute is the health taken off per minute a companion was up.
func (f wingFight) perUpMinute() float64 {
	return f.taken / (float64(f.upTicks) / TickRate / 60)
}

// owner flies the wing's owner: standing off toward home, or flying at a
// base engine's top speed to a downed companion to revive it, as a player
// would.
type owner struct {
	x, y   float64
	standX float64
	standY float64
}

// step moves the owner one tick toward a downed companion in snap, or back
// to its stand-off point.
func (o *owner) step(snap *pb.Snapshot) {
	goalX, goalY := o.standX, o.standY
	for _, p := range snap.GetPlayers() {
		if p.GetState().GetDamage() >= sim.MaxDamage {
			goalX, goalY = float64(p.GetState().GetX()), float64(p.GetState().GetY())

			break
		}
	}
	reach := sim.EngineStatsOf(sim.EngineBase).MaxSpeed / TickRate
	dx, dy := goalX-o.x, goalY-o.y
	if d := math.Hypot(dx, dy); d > reach {
		dx, dy = dx*reach/d, dy*reach/d
	}
	o.x, o.y = o.x+dx, o.y+dy
}

// fightDreadnought flies a wing of companions, every one with weapon at
// tier, in attack mode against an awake Kla'ed Dreadnought for rateMinutes
// once they've reached it, their owner reviving any that go down.
func fightDreadnought(t *testing.T, weapon sim.WeaponID, tier sim.Tier) wingFight {
	t.Helper()

	m := &world.Map{
		Name: "rate", DreadnoughtAwake: true, NoEvents: true, Garrisons: noGarrisons(),
	}
	hub, tick := testHub(
		t, WithMap(m), WithPoolStart(rateWingSize), WithDreadnoughtHealthScale(rateHealthScale),
	)
	a, _ := joinWith(t, hub, "a", sim.Unlocks{sim.Part(weapon): tier})
	chooseAndWait(t, a, "")
	a.Send(state(0, sim.HomeSpawnY))
	for range rateWingSize {
		grant(t, a)
	}
	a.Send(&pb.ClientMessage{Kind: &pb.ClientMessage_SquadronOrder{SquadronOrder: &pb.SquadronOrder{
		Mode: pb.CompanionMode_COMPANION_MODE_ATTACK,
	}}})
	d := dreadnoughtIn(must(latest(t, a, tick, 1, 0, sim.HomeSpawnY)))
	dx, dy := float64(d.GetX()), float64(d.GetY())
	reach := math.Hypot(dx, dy)
	o := &owner{standX: dx - rateStandOff*dx/reach, standY: dy - rateStandOff*dy/reach}
	o.x, o.y = o.standX, o.standY

	full := d.GetHp()
	for range rateWarmUp {
		d = dreadnoughtIn(must(latest(t, a, tick, 1, float32(o.x), float32(o.y))))
		if d.GetHp() < full {
			break
		}
	}
	if d.GetHp() >= full {
		t.Fatalf("the wing never hurt the Dreadnought in %d s", rateWarmUp/TickRate)
	}

	var fight wingFight
	damage := map[string]uint32{}
	share := float64(d.GetHp()) / float64(d.GetMaxHp())
	for range rateTicks {
		snap := must(latest(t, a, tick, 1, float32(o.x), float32(o.y)))
		if d = dreadnoughtIn(snap); d == nil {
			t.Fatal("the Dreadnought fell: give it more health to measure against")
		}
		// Its share of health, not its health, since its maximum follows the
		// ships online; its regeneration is given back.
		now := float64(d.GetHp()) / float64(d.GetMaxHp())
		fight.taken += (share - now + sim.DreadnoughtRegenPerHour/3600/TickRate) *
			float64(d.GetMaxHp())
		share = now
		for _, p := range snap.GetPlayers() {
			id, hull := p.GetPlayerId(), p.GetState().GetDamage()
			if hull > damage[id] {
				fight.hits += int(hull - damage[id])
				if hull >= sim.MaxDamage {
					fight.downs++
				}
			}
			if hull < sim.MaxDamage {
				fight.upTicks++
			}
			damage[id] = hull
		}
		o.step(snap)
	}

	return fight
}

func TestDreadnought_DamageRate(t *testing.T) {
	t.Parallel()

	if testing.Short() {
		t.Skip("flies minutes of a Dreadnought fight")
	}
	for _, weapon := range sim.Weapons() {
		for _, tier := range []sim.Tier{sim.TierPlain, sim.TierHyper} {
			name := string(weapon) + "/" + tierWord(tier)
			t.Run(name, func(t *testing.T) {
				t.Parallel()

				fight := fightDreadnought(t, weapon, tier)
				t.Logf(
					"%s: %.0f health a ship a minute, %.0f a minute up; %d hull hits, %d downs in %d minutes",
					name,
					fight.perShipMinute(),
					fight.perUpMinute(),
					fight.hits,
					fight.downs,
					rateMinutes,
				)
				// Loose: the test documents the rate rather than pinning it.
				if fight.perShipMinute() <= 0 || fight.hits == 0 {
					t.Errorf(
						"%s took off %.0f a ship a minute and took %d hits, want both above 0",
						name,
						fight.perShipMinute(),
						fight.hits,
					)
				}
			})
		}
	}
}

// tierWord is a tier's name, "plain" for plain.
func tierWord(tier sim.Tier) string {
	if tier == sim.TierPlain {
		return "plain"
	}

	return tier.Name()
}
