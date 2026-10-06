import { FrontDoor } from './frontdoor.ts';
import { IntroScreen } from './introscreen.ts';
import { askName } from './name.ts';
import { loadIntroSeen, loadToken, saveIntroSeen, saveToken } from './settings.ts';
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
  const door = new FrontDoor(intro);
  const token = askToken().then((t) => {
    door.enter(!loadIntroSeen(), touch);

    return t;
  });
  void import('./main.ts').then(({ start }) => {
    start({ door, intro, token });
  });
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
