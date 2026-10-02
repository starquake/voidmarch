package sim

import (
	"math"
	"slices"
)

// Tier is a part's upgrade: plain, then Super, Mega and Hyper (#6, decision 5).
type Tier int

// The tiers, plain first.
const (
	TierPlain Tier = iota
	TierSuper
	TierMega
	TierHyper
)

// Boost is the factor a tier multiplies a part's own strength by.
func (t Tier) Boost() float64 {
	return 1 + TierBoost*float64(t)
}

// Name is the tier's word before a part's name; empty for plain.
func (t Tier) Name() string {
	switch t {
	case TierSuper:
		return "Super"
	case TierMega:
		return "Mega"
	case TierHyper:
		return "Hyper"
	case TierPlain:
		fallthrough
	default:
		return ""
	}
}

// WeaponStatsAt is a weapon's stats at a tier: it fires faster.
func WeaponStatsAt(id WeaponID, tier Tier) WeaponStats {
	stats := WeaponStatsOf(id)
	stats.Interval /= tier.Boost()

	return stats
}

// EngineStatsAt is an engine's stats at a tier: it accelerates harder.
func EngineStatsAt(id EngineID, tier Tier) EngineStats {
	stats := EngineStatsOf(id)
	stats.Acceleration *= tier.Boost()

	return stats
}

// ShieldStatsAt is a shield's stats at a tier: it recharges faster.
func ShieldStatsAt(id ShieldID, tier Tier) ShieldStats {
	stats := ShieldStatsOf(id)
	stats.Recharge /= tier.Boost()

	return stats
}

// Part is any weapon, engine or shield; their ids don't overlap.
type Part string

// Parts lists every part, weapons, then engines, then shields.
func Parts() []Part {
	parts := make([]Part, 0, len(Weapons())+len(Engines())+len(Shields()))
	for _, w := range Weapons() {
		parts = append(parts, Part(w))
	}
	for _, e := range Engines() {
		parts = append(parts, Part(e))
	}
	for _, s := range Shields() {
		parts = append(parts, Part(s))
	}

	return parts
}

// Unlocks are the parts a player owns, each at its tier.
type Unlocks map[Part]Tier

// DefaultUnlocks are a new player's parts: the default loadout, plain.
func DefaultUnlocks() Unlocks {
	l := DefaultLoadout()

	return Unlocks{Part(l.Weapon): TierPlain, Part(l.Engine): TierPlain, Part(l.Shield): TierPlain}
}

// Lacks reports whether the player doesn't own part yet.
func (u Unlocks) Lacks(part Part) bool {
	_, owned := u[part]

	return !owned
}

// CanUse reports whether collecting part would change anything: the player
// lacks it or can raise its tier.
func (u Unlocks) CanUse(part Part) bool {
	tier, owned := u[part]

	return !owned || tier < TierHyper
}

// Grant unlocks part, or raises its tier, and reports whether it changed.
func (u Unlocks) Grant(part Part) bool {
	tier, owned := u[part]
	switch {
	case !owned:
		u[part] = TierPlain
	case tier < TierHyper:
		u[part] = tier + 1
	default:
		return false
	}

	return true
}

// Allows reports whether the player owns every part of l.
func (u Unlocks) Allows(l Loadout) bool {
	return !u.Lacks(Part(l.Weapon)) && !u.Lacks(Part(l.Engine)) && !u.Lacks(Part(l.Shield))
}

// Level is how far a player has come: a point for each part owned and each
// tier above plain.
func (u Unlocks) Level() int {
	level := 0
	for _, tier := range u {
		level += 1 + int(tier)
	}

	return level
}

// Behind reports whether a player is below the average level of their
// squadmates, which makes drops near them likelier (#6, decision 14).
func Behind(player Unlocks, squadmates []Unlocks) bool {
	if len(squadmates) == 0 {
		return false
	}
	total := 0
	for _, u := range squadmates {
		total += u.Level()
	}

	return float64(player.Level()) < float64(total)/float64(len(squadmates))
}

// DropChance is the chance a kill of kind drops a part, before catch-up.
func DropChance(kind EnemyKind) float64 {
	switch kind {
	case EnemyFighter, EnemyBomber, EnemyTorpedo:
		return FighterDropChance
	case EnemyFrigate, EnemyDreadnought:
		return FrigateDropChance
	case EnemyScout:
		fallthrough
	default:
		return ScoutDropChance
	}
}

// DropFor rolls a kill's drop at chance (DropChance for its kind), pure and
// seeded. nearby are the players within DropReach, behind those of them
// below their squadron. The chance doubles when anyone is behind, and the part is one a player behind can
// use, else one a nearby player lacks, else one a nearby player can raise.
// No part anyone nearby can use means no drop.
func DropFor(nearby, behind []Unlocks, chance float64, seed uint32) (Part, bool) {
	r := NewRandom(seed)
	if len(behind) > 0 {
		chance *= CatchUpDrops
	}
	if r.Next() >= chance {
		return "", false
	}
	candidates := partsWhere(behind, Unlocks.CanUse)
	if len(candidates) == 0 {
		candidates = partsWhere(nearby, Unlocks.Lacks)
	}
	if len(candidates) == 0 {
		candidates = partsWhere(nearby, Unlocks.CanUse)
	}
	if len(candidates) == 0 {
		return "", false
	}

	return candidates[int(r.Next()*float64(len(candidates)))], true
}

// partsWhere lists the parts, in Parts order, that ok holds for with any of
// players.
func partsWhere(players []Unlocks, ok func(Unlocks, Part) bool) []Part {
	var out []Part
	for _, p := range Parts() {
		if slices.ContainsFunc(players, func(u Unlocks) bool { return ok(u, p) }) {
			out = append(out, p)
		}
	}

	return out
}

// CompanionLoadout is what a new companion flies (#6, decision 13): in each
// slot, the owner's unlocked part the squadron's ships use least, so the
// weapons spread out; ties go to the higher tier, then to the first in Parts
// order. Each part comes at the owner's tier.
func CompanionLoadout(owner Unlocks, squadron []Loadout) Loadout {
	pick := func(slot []Part, fitted func(Loadout) Part) (Part, Tier) {
		best, bestTier, bestUses := Part(""), TierPlain, 0
		for _, part := range slot {
			tier, owned := owner[part]
			if !owned {
				continue
			}
			uses := 0
			for _, l := range squadron {
				if fitted(l) == part {
					uses++
				}
			}
			if best == "" || uses < bestUses || (uses == bestUses && tier > bestTier) {
				best, bestTier, bestUses = part, tier, uses
			}
		}

		return best, bestTier
	}
	l := DefaultLoadout()
	if p, t := pick(partsOf(Weapons()), func(l Loadout) Part { return Part(l.Weapon) }); p != "" {
		l.Weapon, l.WeaponTier = WeaponID(p), t
	}
	if p, t := pick(partsOf(Engines()), func(l Loadout) Part { return Part(l.Engine) }); p != "" {
		l.Engine, l.EngineTier = EngineID(p), t
	}
	if p, t := pick(partsOf(Shields()), func(l Loadout) Part { return Part(l.Shield) }); p != "" {
		l.Shield, l.ShieldTier = ShieldID(p), t
	}

	return l
}

// partsOf lists a slot's ids as parts.
func partsOf[T ~string](ids []T) []Part {
	parts := make([]Part, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, Part(id))
	}

	return parts
}

// CanChangeLoadout reports whether a ship at (x, y) can change its parts:
// only at the home planet, inside the safe zone (#6, decision 3).
func CanChangeLoadout(x, y float64) bool {
	return math.Hypot(x, y) <= SafeZoneRadius
}
