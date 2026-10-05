import { FACTION_NAMES, type EnemyFaction, type EnemyKind } from '../sim/enemies.ts';
import { DREADNOUGHT_SHIELD, FRIGATE_REACH, FRIGATE_SHIELD } from '../sim/rules.gen.ts';

/** A boss's health as the server sends it (#89). */
export interface BossHealth {
  hp: number;
  maxHp: number;
  shield: number;
  /** Whether it's a Dreadnought raiding a sector (#223). */
  raiding: boolean;
}

/** A boss as drawn, with its health. */
export interface DrawnBoss extends BossHealth {
  kind: EnemyKind;
  faction: EnemyFaction;
  x: number;
  y: number;
}

/** What the health bar at the top shows. */
export interface BossBar {
  name: string;
  /** The health and the shield, each from 0 to 1. */
  health: number;
  shield: number;
  text: string;
}

/** The bosses with a bar: their class's name after their faction's, and the most their shields hold. */
const BOSSES: Partial<Record<EnemyKind, { name: string; shield: number }>> = {
  frigate: { name: 'FRIGATE', shield: FRIGATE_SHIELD },
  dreadnought: { name: 'DREADNOUGHT', shield: DREADNOUGHT_SHIELD },
};

/** The bar for the nearest boss within reach of (x, y), or undefined when none is. */
export function bossBar(bosses: readonly DrawnBoss[], x: number, y: number): BossBar | undefined {
  let nearest: DrawnBoss | undefined;
  let distance = FRIGATE_REACH;
  for (const boss of bosses) {
    const d = Math.hypot(boss.x - x, boss.y - y);
    if (d <= distance && BOSSES[boss.kind] !== undefined) {
      nearest = boss;
      distance = d;
    }
  }
  const boss = nearest === undefined ? undefined : BOSSES[nearest.kind];
  if (nearest === undefined || boss === undefined || nearest.maxHp <= 0) {
    return undefined;
  }
  const hp = Math.max(0, Math.ceil(nearest.hp));
  const max = Math.round(nearest.maxHp);

  return {
    name: `${FACTION_NAMES[nearest.faction].toUpperCase()} ${boss.name}${nearest.raiding ? ' · RAID' : ''}`,
    health: Math.min(hp / max, 1),
    shield: Math.min(Math.max(nearest.shield / boss.shield, 0), 1),
    text: `${String(hp)} / ${String(max)}`,
  };
}
