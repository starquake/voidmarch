package sim

import "math"

// TakeHit applies a hit coming from direction fromAngle (radians, where the
// shot came from as seen from the ship): the shield takes it when it covers
// that side and has a charge, else the hull does. It reports whether the
// shield absorbed it.
func TakeHit(ship *Ship, fromAngle float64) bool {
	if ship.Downed() {
		return false
	}
	ship.SinceHit = 0
	ship.hullRegen = 0
	shield := ShieldStatsOf(ship.Loadout.Shield)
	if shield.Covers(fromAngle-ship.Angle) && ship.Shield >= 1 {
		ship.Shield--

		return true
	}
	ship.Damage = min(ship.Damage+1, MaxDamage)
	if ship.Downed() {
		ship.Shield, ship.DownFor, ship.Revive = 0, 0, 0
	}

	return false
}

// Recover advances a ship's recovery by dt seconds: after a spell without
// hits the shield recharges, faster with the nearest squadmate
// squadmateDistance away within FormationRadius, and later the hull heals a
// step at a time.
func Recover(ship *Ship, dt, squadmateDistance float64) {
	if ship.Downed() {
		return
	}
	ship.SinceHit += dt
	// Only the part of dt past a delay counts, however long the step.
	past := func(delay float64) float64 {
		return math.Max(0, math.Min(dt, ship.SinceHit-delay))
	}
	shield := ShieldStatsOf(ship.Loadout.Shield)
	if recharging := past(ShieldRechargeDelay); recharging > 0 && ship.Shield < shield.Strength {
		rate := shield.Strength / shield.Recharge
		if squadmateDistance <= FormationRadius {
			rate *= FormationRecharge
		}
		ship.Shield = math.Min(shield.Strength, ship.Shield+rate*recharging)
	}
	if ship.Damage == 0 {
		ship.hullRegen = 0

		return
	}
	ship.hullRegen += past(HullRegenDelay)
	for ship.hullRegen >= HullRegenEvery && ship.Damage > 0 {
		ship.hullRegen -= HullRegenEvery
		ship.Damage--
	}
}

// ShipTarget is a ship as enemy bullets meet it: its shield's arc while it
// holds a charge, then its hull.
type ShipTarget struct {
	X, Y, Angle float64
	Shield      ShieldID
	// Charges is the shield's charges left.
	Charges float64
}

// TargetOf is the ship as a target.
func TargetOf(s *Ship) ShipTarget {
	return ShipTarget{X: s.X, Y: s.Y, Angle: s.Angle, Shield: s.Loadout.Shield, Charges: s.Shield}
}

// ShipHitAlong is where a bullet flying from (x0, y0) to (x1, y1) first
// meets the ship: how far along its path (0 to 1), and the direction of the
// contact as seen from the ship, for TakeHit. A charged shield meets it
// first, on the side it covers; otherwise the hull does.
func ShipHitAlong(t ShipTarget, x0, y0, x1, y1 float64) (along, from float64, ok bool) {
	shield := ShieldStatsOf(t.Shield)
	if t.Charges >= 1 {
		shieldAlong, shieldFrom, met := enters(t.X, t.Y, shield.Radius+ShotRadius, x0, y0, x1, y1)
		if met && shield.Covers(shieldFrom-t.Angle) {
			return shieldAlong, shieldFrom, true
		}
	}

	return enters(t.X, t.Y, ShipRadius+ShotRadius, x0, y0, x1, y1)
}

// FirstShipHit is the ship a bullet flying from (x0, y0) to (x1, y1) meets
// first, by its index in ships, and the direction of the contact from it.
func FirstShipHit(ships []ShipTarget, x0, y0, x1, y1 float64) (index int, from float64, ok bool) {
	first := math.Inf(1)
	for i, s := range ships {
		along, direction, met := ShipHitAlong(s, x0, y0, x1, y1)
		if met && along < first {
			index, from, ok, first = i, direction, true, along
		}
	}

	return index, from, ok
}

// enters is where the path from (x0, y0) to (x1, y1) first touches the
// circle at (cx, cy): how far along it, and the direction of that point from
// the center. A path that starts inside touches at its start.
func enters(cx, cy, radius, x0, y0, x1, y1 float64) (along, from float64, ok bool) {
	dx, dy := x1-x0, y1-y0
	fx, fy := x0-cx, y0-cy
	outside := fx*fx + fy*fy - radius*radius
	if outside <= 0 {
		return 0, math.Atan2(fy, fx), true
	}
	a := dx*dx + dy*dy
	b := fx*dx + fy*dy
	disc := b*b - a*outside
	if a == 0 || b >= 0 || disc < 0 {
		return 0, 0, false
	}
	along = (-b - math.Sqrt(disc)) / a
	if along > 1 {
		return 0, 0, false
	}

	return along, math.Atan2(fy+along*dy, fx+along*dx), true
}
