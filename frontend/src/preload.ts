import { RULES, loadRank } from './sim/loading.ts';
import { HEADING_FONT_NAME, UI_FONT_NAME } from './sim/tuning.ts';
import { effectFiles, type SoundFile } from './sounds.ts';
import { keys, layerSheets, sheets, type Sheet } from './sprites.ts';

/** What the boot scene loads before the game starts. */
export interface BootFiles {
  sheets: Sheet[];
  sounds: SoundFile[];
}

/** The game's fonts (#170), each loaded before the first text; the URLs are style.css's. */
export const FONTS = [
  { key: `font-${UI_FONT_NAME}`, name: UI_FONT_NAME, url: '/static/fonts/exo2.woff2' },
  { key: `font-${HEADING_FONT_NAME}`, name: HEADING_FONT_NAME, url: '/static/fonts/orbitron.woff2' },
] as const;

/** The boot scene's files in the loading strip's order (#227), so the loader works through the categories in turn. */
export function bootFiles(): BootFiles {
  const byRank = <T extends { key: string }>(files: T[]): T[] => files.sort((a, b) => loadRank(a.key) - loadRank(b.key));

  return { sheets: byRank(sheets()), sounds: byRank(effectFiles()) };
}

/** A file loaded before play, under its key, with the URLs it can come from: a sound has one per format, best first. */
export interface BootUrl {
  key: string;
  urls: readonly string[];
}

/** The boot scene's files in its order: the sheets, the pieced layers and their layouts (#222), then the sounds. */
function bootSceneUrls(): BootUrl[] {
  const { sheets: s, sounds } = bootFiles();
  const layers = layerSheets().flatMap((layer) => [
    { key: layer.key, urls: [layer.url] },
    { key: keys.layerLayout(layer.key), urls: [layer.layoutUrl] },
  ]);

  return [...s.map((f) => ({ key: f.key, urls: [f.url] })), ...layers, ...sounds];
}

/** Every key the boot scene loads, in its order. */
export function bootKeys(): string[] {
  return bootSceneUrls().map((file) => file.key);
}

/** Every file loaded before play beside the game's code: the rules, the fonts and the boot scene's files, for the loading bar's sizes (#227). */
export function bootUrls(): BootUrl[] {
  return [{ key: RULES.key, urls: [RULES.url] }, ...FONTS.map((font) => ({ key: font.key, urls: [font.url] })), ...bootSceneUrls()];
}
