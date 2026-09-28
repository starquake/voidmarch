package sim

// Mode is a companion mode (docs/design.md, section 13): each is a whole set
// of standing orders, so no two orders can contradict each other.
type Mode string

// The modes on the order ring.
const (
	ModeEscort  Mode = "escort"
	ModeAttack  Mode = "attack"
	ModeGuard   Mode = "guard"
	ModeHold    Mode = "hold"
	ModeStealth Mode = "stealth"
)

// ModeOrders are the standing orders mode stands for, from current: a mode
// replaces every standing order and ends a one-shot in progress. Hold holds
// at (x, y); the others keep current's hold point.
func ModeOrders(mode Mode, current Orders, x, y float64) Orders {
	o := DefaultOrders()
	o.HoldX, o.HoldY = current.HoldX, current.HoldY
	switch mode {
	case ModeAttack:
		// Hunt around the owner, big shots at will, Support Ships first.
		o.Stance, o.SupportFirst = StanceAggressive, true
	case ModeGuard:
		// Tight, between the owner and the fire, answering attackers only,
		// falling back when hurt.
		o.Stance, o.Fire, o.Resources = StanceDefensive, FireReturn, ResourcesConserve
	case ModeHold:
		// Stay at a point and shoot what comes in range.
		o.Stance, o.HoldX, o.HoldY = StanceHold, x, y
	case ModeStealth:
		// Follow and never fire: sneak past, don't wake a boss.
		o.Fire, o.Resources = FireHold, ResourcesConserve
	case ModeEscort:
		fallthrough
	default:
		// Formation on the owner, shooting anything near.
	}

	return o
}

// WithOneShot is current with a one-shot order under way, keeping the mode.
// Focus needs an enemy: with focusEnemyID 0 it can't be given.
func WithOneShot(kind OneShotKind, current Orders, focusEnemyID int) (Orders, bool) {
	if kind == OneShotFocus && focusEnemyID == 0 {
		return current, false
	}
	current.OneShot = OneShot{Kind: kind}
	if kind == OneShotFocus {
		current.OneShot.EnemyID = focusEnemyID
	}

	return current, true
}

// ModeOf is the mode a set of orders came from.
func ModeOf(o Orders) Mode {
	switch o.Stance {
	case StanceAggressive:
		return ModeAttack
	case StanceDefensive:
		return ModeGuard
	case StanceHold:
		return ModeHold
	case StanceEscort:
		fallthrough
	default:
		if o.Fire == FireHold {
			return ModeStealth
		}

		return ModeEscort
	}
}
