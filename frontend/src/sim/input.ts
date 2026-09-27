import { normalize } from './math.ts';

/** Raw controls for one tick: WASD, the pointer in world space, and the fire button. */
export interface InputSnapshot {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  pointerX: number;
  pointerY: number;
  fire: boolean;
}

/** What the ship is told to do for one tick. move is unit length or zero. */
export interface ShipCommand {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
}

/** Turns held keys into a movement direction, so diagonals are no faster. */
export function toCommand(input: InputSnapshot): ShipCommand {
  const move = normalize(Number(input.right) - Number(input.left), Number(input.down) - Number(input.up));

  return { moveX: move.x, moveY: move.y, aimX: input.pointerX, aimY: input.pointerY, fire: input.fire };
}
