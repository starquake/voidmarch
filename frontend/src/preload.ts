import { loadRank } from './sim/loading.ts';
import { effectFiles, type SoundFile } from './sounds.ts';
import { keys, layerSheets, sheets, type Sheet } from './sprites.ts';

/** What the boot scene loads before the game starts. */
export interface BootFiles {
  sheets: Sheet[];
  sounds: SoundFile[];
}

/** The boot scene's files in the loading strip's order (#227), so the loader works through the categories in turn. */
export function bootFiles(): BootFiles {
  const byRank = <T extends { key: string }>(files: T[]): T[] => files.sort((a, b) => loadRank(a.key) - loadRank(b.key));

  return { sheets: byRank(sheets()), sounds: byRank(effectFiles()) };
}

/** Every key the boot scene loads, in its order: the sheets, the pieced layers and their layouts (#222), then the sounds. */
export function bootKeys(): string[] {
  const { sheets: s, sounds } = bootFiles();
  const layers = layerSheets().flatMap((layer) => [layer.key, keys.layerLayout(layer.key)]);

  return [...s.map((f) => f.key), ...layers, ...sounds.map((f) => f.key)];
}
