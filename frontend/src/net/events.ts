import { WorldEventKind, type WorldEvent } from '../gen/voidmarch/v1/messages_pb.js';
import { ATTACK_REMINDER_SECONDS } from '../sim/tuning.ts';

/** What an attack costs if it isn't stopped: on its start banner, and again near its end (#272). */
export const ATTACK_WARNING = 'Destroy the Frigate and its fleet before time runs out, or lose the sector.';

/** Whole seconds between two ticks, rounded up as the HUD counts them, never below 0. */
function secondsLeft(endsTick: number, tick: number, tickRate: number): number {
  return Math.max(0, Math.ceil((endsTick - tick) / tickRate));
}

/** m:ss of the time between two ticks, never below 0:00. */
function timeLeft(endsTick: number, tick: number, tickRate: number): string {
  const seconds = secondsLeft(endsTick, tick, tickRate);

  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The HUD's line for the world event running (#102): "D3 under attack · 9:12 to save it" (#272). */
export function eventLine(event: WorldEvent | undefined, tick: number, tickRate: number): string {
  if (event === undefined) {
    return '';
  }
  const left = timeLeft(event.endsTick, tick, tickRate);

  return event.kind === WorldEventKind.ATTACK
    ? `${event.sector} under attack · ${left} to save it`
    : `Distress call in ${event.sector} · ${left}`;
}

/** The banner when a world event starts: what happened, what to do, and the arrow. */
export function eventStartBanner(event: WorldEvent): string[] {
  return event.kind === WorldEventKind.ATTACK
    ? [
        `Sector ${event.sector} is under attack!`,
        ATTACK_WARNING,
        'Follow the red arrow at the edge of the screen.',
      ]
    : [
        `Distress call from sector ${event.sector}`,
        'Destroy its guard, then hover beside the derelict ship to rescue it.',
        'Follow the red arrow at the edge of the screen.',
      ];
}

/** The banner when a world event ends, won or lost. */
export function eventEndBanner(event: WorldEvent, won: boolean): string[] {
  if (event.kind === WorldEventKind.ATTACK) {
    return won ? [`Sector ${event.sector} held!`, 'A ship joins the hangar.'] : [`Sector ${event.sector} has fallen`];
  }

  return won ? [`Derelict rescued in sector ${event.sector}`] : [`The derelict in sector ${event.sector} was lost`];
}

/**
 * The attack's warning once more, as its time left drops to a minute (#272):
 * once per attack, and only for a player who saw it with more time left.
 */
export class AttackReminder {
  /** The attack last checked, by sector and end tick, so a reconnect's copy of it counts as the same. */
  private attack: string | undefined;
  private armed = false;

  /** Checks the event running at tick; returns the banner the one time it's due. */
  check(event: WorldEvent | undefined, tick: number, tickRate: number): string[] | undefined {
    if (event?.kind !== WorldEventKind.ATTACK) {
      return undefined;
    }
    const seconds = secondsLeft(event.endsTick, tick, tickRate);
    const attack = `${event.sector}@${String(event.endsTick)}`;
    if (attack !== this.attack) {
      this.attack = attack;
      this.armed = seconds > ATTACK_REMINDER_SECONDS;
    }
    if (!this.armed || seconds > ATTACK_REMINDER_SECONDS) {
      return undefined;
    }
    this.armed = false;

    return seconds > 0 ? [ATTACK_WARNING] : undefined;
  }
}
