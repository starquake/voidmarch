/** The parts, as the Go sim numbers them, and the hull's damage sprites. */
export {
  DEFAULT_LOADOUT,
  ENGINES,
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

/** Returns the entry after current in list, wrapping around. */
export function nextInCycle<T>(list: readonly T[], current: T): T {
  const next = list[(list.indexOf(current) + 1) % list.length];
  if (next === undefined) {
    throw new Error('nextInCycle: empty list');
  }

  return next;
}
