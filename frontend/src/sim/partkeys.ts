/**
 * The part keys 1, 2 and 3 (#259): a tap cycles its slot on release, and a
 * hold opens the slot's list instead.
 */
import { PART_HOLD_MS } from './tuning.ts';

/** What a part key does: fit the slot's next part, or open its list. */
export type PartKeyAction<S extends string> = { kind: 'cycle'; slot: S } | { kind: 'open'; slot: S };

/** A key down and not yet released, and whether it has opened its list. */
interface Press<S extends string> {
  slot: S;
  at: number;
  opened: boolean;
}

/** Tells a tap from a hold; times are milliseconds on one clock. */
export class PartKeys<S extends string> {
  private press: Press<S> | undefined;

  /** A part key goes down; the newest key down is the one that counts. */
  down(slot: S, at: number): PartKeyAction<S>[] {
    this.press = { slot, at, opened: false };

    return [];
  }

  /** A part key comes up: a tap cycles, and a hold that no frame saw opens. */
  up(slot: S, at: number): PartKeyAction<S>[] {
    const press = this.press;
    if (press?.slot !== slot) {
      return [];
    }
    this.press = undefined;
    if (press.opened) {
      return [];
    }

    return [at - press.at < PART_HOLD_MS ? { kind: 'cycle', slot } : { kind: 'open', slot }];
  }

  /** Every frame: a key held long enough opens its list, once. */
  tick(at: number): PartKeyAction<S>[] {
    const press = this.press;
    if (press === undefined || press.opened || at - press.at < PART_HOLD_MS) {
      return [];
    }
    press.opened = true;

    return [{ kind: 'open', slot: press.slot }];
  }

  /** Drops a pending press: the window lost focus, or a screen opened. */
  cancel(): void {
    this.press = undefined;
  }
}
