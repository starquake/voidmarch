/**
 * The part keys 1, 2 and 3 (#259): a tap cycles its slot on release, and a
 * hold opens the slot's list instead. While a list is open, its key fits the
 * next part at once, and the list closes once the keys leave it alone.
 */
import { PART_HOLD_MS, PART_LIST_IDLE_MS } from './tuning.ts';

/** What the part keys do: fit a slot's next part, open its list, or close the open one. */
export type PartKeyAction<S extends string> = { kind: 'cycle'; slot: S } | { kind: 'open'; slot: S } | { kind: 'close' };

/** A key down and not yet released, and whether it has opened its list. */
interface Press<S extends string> {
  slot: S;
  at: number;
  opened: boolean;
}

/** The open list: when a key last acted on it, if one has. */
interface List<S extends string> {
  slot: S;
  at: number;
  keyed: boolean;
}

/** Steps through count items from index, wrapping both ways. */
export function stepIndex(index: number, by: number, count: number): number {
  return count === 0 ? 0 : (((index + by) % count) + count) % count;
}

/**
 * Tells a tap from a hold, and times the open list. Every call takes the
 * slot whose list is open now, since the pointer opens and closes lists
 * too; times are milliseconds on one clock.
 */
export class PartKeys<S extends string> {
  private press: Press<S> | undefined;
  private list: List<S> | undefined;

  /** A part key goes down: the open list's key fits at once, and any other waits to tell a tap from a hold. */
  down(slot: S, at: number, open: S | undefined): PartKeyAction<S>[] {
    this.see(open);
    this.touch(at, open);
    if (this.list?.slot === slot) {
      return [{ kind: 'cycle', slot }];
    }
    this.press = { slot, at, opened: false };

    return [];
  }

  /** A part key comes up: a tap cycles, closing another slot's list, and a hold that no frame saw opens. */
  up(slot: S, at: number, open: S | undefined): PartKeyAction<S>[] {
    this.see(open);
    const press = this.press;
    if (press?.slot !== slot) {
      return [];
    }
    this.press = undefined;
    if (press.opened) {
      this.touch(at, open);

      return [];
    }
    if (at - press.at >= PART_HOLD_MS) {
      this.list = { slot, at, keyed: true };

      return [{ kind: 'open', slot }];
    }
    const closing = this.list !== undefined;
    this.list = undefined;

    return closing ? [{ kind: 'cycle', slot }, { kind: 'close' }] : [{ kind: 'cycle', slot }];
  }

  /** Every frame: a key held long enough opens its list, once, and a list left alone long enough closes. */
  tick(at: number, open: S | undefined): PartKeyAction<S>[] {
    this.see(open);
    const press = this.press;
    if (press !== undefined && !press.opened && at - press.at >= PART_HOLD_MS) {
      press.opened = true;
      this.list = { slot: press.slot, at, keyed: true };

      return [{ kind: 'open', slot: press.slot }];
    }
    const list = this.list;
    const held = press?.opened === true && press.slot === list?.slot;
    if (list?.keyed === true && !held && at - list.at >= PART_LIST_IDLE_MS) {
      this.list = undefined;

      return [{ kind: 'close' }];
    }

    return [];
  }

  /** A key acted on the open list, an arrow or Enter: its idle time starts again. */
  touch(at: number, open: S | undefined): void {
    this.see(open);
    if (this.list !== undefined) {
      this.list.at = at;
      this.list.keyed = true;
    }
  }

  /** Drops a pending press: the window lost focus, or a screen opened. */
  cancel(): void {
    this.press = undefined;
  }

  /** Follows the list that is open now, which the pointer may have opened, closed or moved. */
  private see(open: S | undefined): void {
    if (open === undefined) {
      this.list = undefined;
    } else if (this.list?.slot !== open) {
      this.list = { slot: open, at: 0, keyed: false };
    }
  }
}
