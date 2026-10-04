import { MISSION_AIM_MIN_SHOTS, STANDINGS_TOP } from './tuning.ts';

/** A player's stats as the server sends them (#154, #167). */
export interface PlayerStatsRow {
  playerId: string;
  name: string;
  kills: number;
  companionKills: number;
  shots: number;
  hits: number;
  deaths: number;
  rescues: number;
  sectors: number;
}

/** One row of the season-so-far table (#167), as text. */
export interface StandingRow {
  name: string;
  kills: string;
  hitRate: string;
  killsDeaths: string;
  you: boolean;
}

const PERCENT = 100;
const SECONDS_PER_HOUR = 3600;
const HOURS_PER_DAY = 24;

/** Hits over shots fired, as a whole percentage, or a dash with no shots. */
export function hitRate(hits: number, shots: number): string {
  return shots === 0 ? '–' : `${String(Math.round((PERCENT * hits) / shots))}%`;
}

/**
 * The table's rows (#167 decision): the top few by kills, in the server's
 * order, and the player's own row after them when they're not among them.
 */
export function standingRows(players: readonly PlayerStatsRow[], playerId: string | undefined, top = STANDINGS_TOP): StandingRow[] {
  const row = (p: PlayerStatsRow): StandingRow => ({
    name: p.name,
    kills: String(p.kills),
    hitRate: hitRate(p.hits, p.shots),
    killsDeaths: `${String(p.kills)} / ${String(p.deaths)}`,
    you: p.playerId === playerId,
  });
  const rows = players.slice(0, top).map(row);
  const own = players.slice(top).find((p) => p.playerId === playerId);
  if (own !== undefined) {
    rows.push(row(own));
  }

  return rows;
}

/** How long the season has run: "day 2 · 26 h", counting the first day as day 1. */
export function seasonAge(startedSeconds: number, nowSeconds: number): string {
  const hours = Math.max(0, Math.floor((nowSeconds - startedSeconds) / SECONDS_PER_HOUR));

  return `day ${String(Math.floor(hours / HOURS_PER_DAY) + 1)} · ${String(hours)} h`;
}

/**
 * The mission banner's stats line (#167): who made the most kills, who aimed
 * best over enough shots, and who went down, or that nobody did; undefined
 * when nobody fought there.
 */
export function missionStatsLine(mission: readonly PlayerStatsRow[], minShots = MISSION_AIM_MIN_SHOTS): string | undefined {
  if (mission.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  const killer = mission.reduce((best, p) => (p.kills > best.kills ? p : best));
  if (killer.kills > 0) {
    parts.push(`Most kills: ${killer.name} ${String(killer.kills)}`);
  }
  const aimers = mission.filter((p) => p.shots >= minShots);
  if (aimers.length > 0) {
    const aim = aimers.reduce((best, p) => (p.hits / p.shots > best.hits / best.shots ? p : best));
    parts.push(`Best aim: ${aim.name} ${hitRate(aim.hits, aim.shots)}`);
  }
  const down = mission.filter((p) => p.deaths > 0).map((p) => p.name);
  parts.push(down.length === 0 ? 'Nobody went down' : `Went down: ${down.join(', ')}`);

  return parts.join(' · ');
}
