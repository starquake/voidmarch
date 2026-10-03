import { FACTION_NAMES } from '../sim/enemies.ts';
import { RING_FACTIONS, type EnemyFaction } from '../sim/rules.gen.ts';

/** The ring a faction's Dreadnought opens: the one beyond the last ring that faction holds (#140). */
export const ringOpenedBy = (faction: EnemyFaction): number => RING_FACTIONS.lastIndexOf(faction) + 1;

/** The banner when a Dreadnought falls (#125, #140): what it opened, and the part this player won, if any. */
export function bossFellBanner(faction: EnemyFaction, part: string | undefined): string[] {
  const lines = [`The ${FACTION_NAMES[faction]} Dreadnought has fallen`, `Ring ${String(ringOpenedBy(faction))} is open.`];
  if (part !== undefined) {
    lines.push(`Your reward: ${part}`);
  }

  return lines;
}

/** "Ring 3" or "Rings 2 and 3": the rings from first to last. */
function ringNames(first: number, last: number): string {
  if (first === last) {
    return `Ring ${String(last)} has`;
  }
  const rings = Array.from({ length: last - first + 1 }, (_, i) => String(first + i));

  return `Rings ${rings.slice(0, -1).join(', ')} and ${rings.at(-1) ?? ''} have`;
}

/**
 * The banner when open rings close again (#125, #140), or undefined for any
 * other change: the first frontier a client hears, or rings opening.
 */
export function ringsClosedBanner(before: number, after: number): string[] | undefined {
  if (before < 2 || after >= before) {
    return undefined;
  }

  return [
    `${ringNames(after + 1, before)} closed`,
    `Ring ${String(after)} fell below 4 cleared sectors. Take them back to wake a new Dreadnought.`,
  ];
}
