package sim

import "math"

// Downed reports whether the ship is down: out of hull, drifting until a
// friend revives it or its player respawns (#47).
func (s *Ship) Downed() bool {
	return s.Damage >= MaxDamage
}

// Drift moves a downed ship dt seconds with no thrust, keeping its facing.
func Drift(s *Ship, dt float64) {
	angle := s.Angle
	StepShip(s, Command{}, dt)
	s.Angle = angle
}

// ReviveStep advances a downed ship's revive by dt seconds, given how far
// the nearest friendly ship that is up and the nearest such squadmate are:
// either within ReviveRadius revives it, a squadmate faster. With nobody
// near, the progress holds. A revived ship is back one hull step above
// down. It reports whether the ship came back up.
func ReviveStep(s *Ship, dt, friendDistance, squadmateDistance float64) bool {
	if !s.Downed() {
		s.DownFor, s.Revive = 0, 0

		return false
	}
	s.DownFor += dt
	switch {
	case squadmateDistance <= ReviveRadius:
		s.Revive += dt / ReviveSquadmateSeconds
	case friendDistance <= ReviveRadius:
		s.Revive += dt / ReviveSeconds
	default:
	}
	if s.Revive < 1 {
		return false
	}
	s.Damage = MaxDamage - 1
	s.DownFor, s.Revive = 0, 0
	s.SinceHit, s.hullRegen = 0, 0

	return true
}

// Helpers is how far from (x, y) the nearest friend that is up is, and the
// nearest such squadmate; NoSquadmate when there's none.
func Helpers(x, y float64, friends []Friend) (friend, squadmate float64) {
	friend, squadmate = NoSquadmate, NoSquadmate
	for _, f := range friends {
		if f.Downed {
			continue
		}
		d := math.Hypot(f.X-x, f.Y-y)
		friend = math.Min(friend, d)
		if f.Squadmate {
			squadmate = math.Min(squadmate, d)
		}
	}

	return friend, squadmate
}

// CanRespawn reports whether a downed ship's player may respawn yet.
func CanRespawn(s *Ship) bool {
	return s.Downed() && s.DownFor >= RespawnDelay
}

// Respawn puts the ship at (x, y) at rest, facing up, with a whole hull and
// a full shield: nothing is lost.
func Respawn(s *Ship, x, y float64) {
	fresh := NewShip(x, y, s.Loadout)
	fresh.RotationSnap = s.RotationSnap
	*s = *fresh
}
