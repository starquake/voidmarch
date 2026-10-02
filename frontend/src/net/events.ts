import { WorldEventKind, type WorldEvent } from '../gen/voidmarch/v1/messages_pb.js';

/** m:ss of the time between two ticks, never below 0:00. */
function timeLeft(endsTick: number, tick: number, tickRate: number): string {
  const seconds = Math.max(0, Math.ceil((endsTick - tick) / tickRate));

  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The HUD's line for the world event running (#102): "D3 under attack · 9:12". */
export function eventLine(event: WorldEvent | undefined, tick: number, tickRate: number): string {
  if (event === undefined) {
    return '';
  }
  const left = timeLeft(event.endsTick, tick, tickRate);

  return event.kind === WorldEventKind.ATTACK
    ? `${event.sector} under attack · ${left}`
    : `Distress call in ${event.sector} · ${left}`;
}

/** The banner when a world event starts: what happened, what to do, and the arrow. */
export function eventStartBanner(event: WorldEvent): string[] {
  return event.kind === WorldEventKind.ATTACK
    ? [
        `Sector ${event.sector} is under attack!`,
        'Destroy the Frigate and its fleet before time runs out, or lose the sector.',
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
