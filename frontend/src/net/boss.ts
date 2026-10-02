import type { EnemyKind } from '../sim/enemies.ts';
import { DREADNOUGHT_SHIELD, FRIGATE_REACH, FRIGATE_SHIELD } from '../sim/rules.gen.ts';

/** A boss's health as the server sends it (#89). */
export interface BossHealth {
  hp: number;
  maxHp: number;
  shield: number;
  /** The players online its health was scaled for, a companion counting half. */
  scaledFor: number;
}

/** A boss as drawn, with its health. */
export interface DrawnBoss extends BossHealth {
  kind: EnemyKind;
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

/** The bosses with a bar: their names, and the most their shields hold. */
const BOSSES: Partial<Record<EnemyKind, { name: string; shield: number }>> = {
  frigate: { name: "KLA'ED FRIGATE", shield: FRIGATE_SHIELD },
  dreadnought: { name: "KLA'ED DREADNOUGHT", shield: DREADNOUGHT_SHIELD },
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
  const scaled = nearest.scaledFor > 0 ? ` · scaled for ${String(nearest.scaledFor)} online` : '';

  return {
    name: boss.name,
    health: Math.min(hp / max, 1),
    shield: Math.min(Math.max(nearest.shield / boss.shield, 0), 1),
    text: `${String(hp)} / ${String(max)}${scaled}`,
  };
}
