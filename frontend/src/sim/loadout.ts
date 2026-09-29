/** The parts, as the Go sim numbers them, and the hull's damage sprites. */
export {
  DEFAULT_LOADOUT,
  ENGINES,
  SHIELD_STATS,
  SHIELDS,
  WEAPONS,
  type EngineId,
  type ShieldId,
  type WeaponId,
} from './rules.gen.ts';
export type { Loadout } from '../simwasm.ts';

/** Hull sprites from full health to downed; the index is the hits taken. */
export const DAMAGE_STATES = ['fullHealth', 'slightDamage', 'damaged', 'veryDamaged'] as const;
export type DamageState = (typeof DAMAGE_STATES)[number];

/** The hull sprite for the hits taken, clamped to the ones there are. */
export const damageState = (damage: number): DamageState =>
  DAMAGE_STATES[Math.min(Math.max(0, Math.floor(damage)), DAMAGE_STATES.length - 1)] ?? 'fullHealth';

/** Returns the entry after current in list, wrapping around. */
export function nextInCycle<T>(list: readonly T[], current: T): T {
  const next = list[(list.indexOf(current) + 1) % list.length];
  if (next === undefined) {
    throw new Error('nextInCycle: empty list');
  }

  return next;
}
