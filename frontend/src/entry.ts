import { CODE_BYTES, FILE_BYTES } from './bootsizes.gen.ts';
import { FrontDoor } from './frontdoor.ts';
import { IntroScreen } from './introscreen.ts';
import { askName } from './name.ts';
import { download } from './net/download.ts';
import { loadIntroSeen, loadToken, saveIntroSeen, saveToken } from './settings.ts';
import { LoadProgress, SOUND_TYPES, fileSizes } from './sim/loading.ts';
import { touchMode } from './sim/touch.ts';

/**
 * The page's first script (#227, decision 8). It carries no Phaser, so the
 * name screen or the loading strip shows as soon as it arrives, and the
 * game's code (main.ts) downloads behind them.
 */
function enter(): void {
  const touch = touchMode((query) => window.matchMedia(query).matches, window.location.search);
  const intro = new IntroScreen();
  intro.onClose(() => {
    saveIntroSeen();
  });
  const door = new FrontDoor(intro, new LoadProgress(new Map(Object.entries(CODE_BYTES)), fileSizes(FILE_BYTES, canPlay)));
  const token = askToken().then((t) => {
    door.enter(!loadIntroSeen(), touch);

    return t;
  });
  void Promise.all(Object.keys(CODE_BYTES).map((url) => prefetch(url, door)))
    .then(async () => {
      // The browser revalidates each module (no-cache): all at once, rather than main.js's imports after main.js.
      const imports = Object.keys(CODE_BYTES).filter((url) => !url.endsWith('/main.js'));
      const [game] = await Promise.all([import('./main.ts'), ...imports.map(async (url) => (await import(url)) as unknown)]);

      return game;
    })
    .then(({ start }) => {
      door.codeLoaded();
      start({ door, intro, token });
    });
}

const audio = document.createElement('audio');

/** Whether the browser plays a sound format, asked as Phaser's loader asks it. */
function canPlay(format: string): boolean {
  const type = SOUND_TYPES[format];

  return type !== undefined && !['', 'no'].includes(audio.canPlayType(type));
}

/**
 * Downloads one of the game's modules, counting its bytes as they arrive
 * (decision 9), so that import() finds it in the browser's cache. One that
 * fails is counted as done, and import() fetches it itself.
 */
async function prefetch(url: string, door: FrontDoor): Promise<void> {
  await download(url, (bytes) => {
    door.receive(url, bytes);
  }).catch(() => undefined);
  door.loaded(url);
}

/** The player's token: the saved one, or one from the name screen on the first visit; undefined to play alone. */
async function askToken(): Promise<string | undefined> {
  const saved = loadToken();
  if (saved !== undefined) {
    return saved;
  }
  const token = await askName();
  if (token !== undefined) {
    saveToken(token);
  }

  return token;
}

enter();
