import type { EnemyKind } from '../sim/enemies.ts';
import { FRIGATE_REACH, FRIGATE_SHIELD } from '../sim/rules.gen.ts';

/** A boss's health as the server sends it (#89). */
export interface BossHealth {
  hp: number;
  maxHp: number;
  shield: number;
  /** The players its health was scaled for, a companion counting half. */
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

const BOSS_NAMES: Partial<Record<EnemyKind, string>> = { frigate: "KLA'ED FRIGATE" };

/** The bar for the nearest boss within reach of (x, y), or undefined when none is. */
export function bossBar(bosses: readonly DrawnBoss[], x: number, y: number): BossBar | undefined {
  let nearest: DrawnBoss | undefined;
  let distance = FRIGATE_REACH;
  for (const boss of bosses) {
    const d = Math.hypot(boss.x - x, boss.y - y);
    if (d <= distance && BOSS_NAMES[boss.kind] !== undefined) {
      nearest = boss;
      distance = d;
    }
  }
  if (nearest === undefined || nearest.maxHp <= 0) {
    return undefined;
  }
  const hp = Math.max(0, Math.ceil(nearest.hp));
  const max = Math.round(nearest.maxHp);
  const scaled = nearest.scaledFor > 0 ? ` · scaled for ${String(nearest.scaledFor)} nearby` : '';

  return {
    name: BOSS_NAMES[nearest.kind] ?? '',
    health: Math.min(hp / max, 1),
    shield: Math.min(Math.max(nearest.shield / FRIGATE_SHIELD, 0), 1),
    text: `${String(hp)} / ${String(max)}${scaled}`,
  };
}
