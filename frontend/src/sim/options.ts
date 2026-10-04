import { CONTROL_MODES, type ControlMode } from './input.ts';
import { FPS_CAP, ROTATION_SNAP_STEPS } from './tuning.ts';

/** The settings screen's options (#145), as the player has them. */
export interface Options {
  sound: boolean;
  music: boolean;
  controls: ControlMode;
  snapRotation: boolean;
  effects: boolean;
  fpsCap: boolean;
  lowResolution: boolean;
}

export type OptionId = keyof Options;

/** The options in the screen's order. */
export const OPTION_IDS: readonly OptionId[] = ['sound', 'music', 'controls', 'snapRotation', 'effects', 'fpsCap', 'lowResolution'];

/** One row of the settings screen: the option, its name and its value, as text. */
export interface OptionRow {
  id: OptionId;
  label: string;
  value: string;
}

const onOff = (on: boolean): string => (on ? 'on' : 'off');

/** The screen's rows for options. */
export function optionRows(options: Options): OptionRow[] {
  const values: Record<OptionId, [string, string]> = {
    sound: ['Sound', onOff(options.sound)],
    music: ['Music', onOff(options.music)],
    controls: ['Controls', options.controls === 'ship' ? 'ship-relative' : 'screen-relative'],
    snapRotation: ['Rotation', options.snapRotation ? `${String(ROTATION_SNAP_STEPS)} directions` : 'free'],
    effects: ['Effects', onOff(options.effects)],
    fpsCap: ['Frame rate', options.fpsCap ? `capped at ${String(FPS_CAP)}` : 'the display\'s own'],
    lowResolution: ['Resolution', options.lowResolution ? 'low' : 'full'],
  };

  return OPTION_IDS.map((id) => ({ id, label: values[id][0], value: values[id][1] }));
}

/** Options with id changed to its next value. */
export function changeOption(options: Options, id: OptionId): Options {
  if (id === 'controls') {
    const next = CONTROL_MODES[(CONTROL_MODES.indexOf(options.controls) + 1) % CONTROL_MODES.length] ?? options.controls;

    return { ...options, controls: next };
  }

  return { ...options, [id]: !options[id] };
}

/** The selected row after moving by step, wrapping round the rows. */
export function moveSelection(selected: number, step: number, rows: number): number {
  return rows === 0 ? 0 : (((selected + step) % rows) + rows) % rows;
}
