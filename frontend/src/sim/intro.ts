import { GRID_RINGS, MAX_DAMAGE, RESPAWN_DELAY } from './rules.gen.ts';
import { HOME_SECTOR, SECTOR_NAMES } from './sectors.ts';

/** How a run of text stands out: a gold, blue or red word, or a key's name. */
export type Mark = 'gold' | 'blue' | 'red' | 'key';

/** A run of text, marked or plain. */
export interface Span {
  text: string;
  mark?: Mark;
}

/** A line of text in runs. */
export type Line = readonly Span[];

/** One control: the keys, buttons or gestures, and what they do. */
export interface ControlRow {
  keys: readonly string[];
  text: string;
}

/** A column of controls: keycaps for a keyboard, gold names for touch buttons, plain names for the rest. */
export interface ControlColumn {
  title: string;
  style: 'keys' | 'buttons' | 'plain';
  rows: readonly ControlRow[];
  note?: string;
}

/** What the intro screen says (#193), for keyboard and mouse or for touch. */
export interface IntroContent {
  premise: Line;
  /** How to open and close the screen, beside the title. */
  hint: Line;
  controls: readonly [ControlColumn, ControlColumn];
  sectors: readonly Line[];
  extras: readonly Line[];
  friends: string;
}

const plain = (text: string): Span => ({ text });
const gold = (text: string): Span => ({ text, mark: 'gold' });
const blue = (text: string): Span => ({ text, mark: 'blue' });
const red = (text: string): Span => ({ text, mark: 'red' });
const key = (text: string): Span => ({ text, mark: 'key' });

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'];

/** A small number as a word, capitalized to start a sentence. */
function numberWord(n: number, capital = false): string {
  const word = NUMBER_WORDS[n] ?? String(n);

  return capital ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

// #193's decision 3, word for word; pinned by intro.test.ts.
const PREMISE: Line = [
  plain('The '),
  gold("Kla'ed"),
  plain(', '),
  gold('Nairan'),
  plain(' and '),
  gold('Nautolan'),
  plain(
    " fleets hold the sectors around your home planet. Clear them ring by ring with your friends and your companions. Rescue derelict ships for the hangar, and bring down each ring's Dreadnought to open the next. Win the season together.",
  ),
];

const KEYBOARD: ControlColumn = {
  title: 'Keyboard',
  style: 'keys',
  rows: [
    { keys: ['W', 'A', 'S', 'D'], text: 'move' },
    { keys: ['G'], text: 'draw a companion, at home' },
    { keys: ['Q'], text: 'hold for orders, tap to repeat' },
    { keys: ['1', '2', '3'], text: 'switch weapon, engine, shield' },
    { keys: ['M'], text: 'map' },
    { keys: ['Tab'], text: 'hold for the standings' },
    { keys: ['H', 'J'], text: 'when down: respawn home, or by a squadmate' },
    { keys: ['C'], text: 'when down: switch squadrons' },
    { keys: ['O'], text: "the season's victory screen" },
    { keys: ['Esc'], text: 'settings, or close a screen' },
    { keys: ['F1'], text: 'this screen' },
  ],
};

const MOUSE: ControlColumn = {
  title: 'Mouse',
  style: 'plain',
  rows: [
    { keys: ['point'], text: 'aim' },
    { keys: ['hold left'], text: 'fire; the big space gun charges, and fires when you let go' },
    { keys: ['click'], text: 'on the map: send your squadron to a sector' },
    { keys: ['click a slot'], text: 'bottom left: pick another part you own' },
  ],
  note: 'W flies up the screen, or toward the mouse with ship-relative controls in the settings.',
};

const THUMBS: ControlColumn = {
  title: 'Thumbs',
  style: 'plain',
  rows: [
    { keys: ['left half'], text: 'a stick where your thumb lands: move that way' },
    { keys: ['right half'], text: 'a stick: aim that way and fire while pushed; the big space gun fires on release' },
    { keys: ['minimap'], text: 'the full map: tap a sector to send your squadron there' },
    { keys: ['a slot'], text: 'bottom left: tap it, then a part you own' },  ],
};

const BUTTONS: ControlColumn = {
  title: 'Buttons',
  style: 'buttons',
  rows: [
    { keys: ['Summon'], text: 'draw a companion, at home' },
    { keys: ['Orders'], text: 'hold for the order ring, tap to repeat' },
    { keys: ['Respawn'], text: 'when down: at home, or beside a squadmate' },
    { keys: ['Squadron'], text: 'when down: switch squadrons' },
    { keys: ['Settings'], text: 'sound, controls, effects' },
    { keys: ['Help'], text: 'this screen' },
  ],
};

const SECTORS: readonly Line[] = [
  [
    plain('The world is '),
    blue(`${String(SECTOR_NAMES.length)} hexagonal sectors`),
    plain(`: home in ${HOME_SECTOR} and ${numberWord(GRID_RINGS)} rings around it.`),
  ],
  [plain("Destroy a sector's whole garrison to "), blue('clear it'), plain(' for good. Its losses stay, so you can wear it down over several visits.')],
  [
    plain("Your squadron's "),
    gold('mission'),
    plain(' is the nearest uncleared sector: the '),
    gold('gold arrow'),
    plain(" at the screen's edge points the way."),
  ],
  [plain('A '), red('red force field'), plain(" closes the outer rings until the ring's Dreadnought falls.")],
];

/** The five extras (decision 5), with the parts line for keys or for touch. */
function extras(touch: boolean): Line[] {
  return [
    [blue('Companions'), plain(' are AI wingmates from the shared hangar, up to three. They follow your squadron\'s orders from the order ring.')],
    [
      blue('Parts'),
      plain(
        ` drop from enemies: fly over one to take it for your squadron, or raise its tier. Switch anywhere with ${
          touch ? 'the slots bottom left' : '1, 2, 3 or the slots'
        }.`,
      ),
    ],
    [
      blue('Going down:'),
      plain(
        ` ${numberWord(MAX_DAMAGE, true)} hull hits. A friend hovering beside you revives you, or after ${String(RESPAWN_DELAY)} s respawn at home or beside a squadmate.`,
      ),
    ],
    [blue('Squadrons'), plain(' are up to 4 ships, companions included. An order from anyone reaches every companion in it.')],
    [blue('The season'), plain(" is won when the Nautolan Dreadnought in ring 3 falls; the victory screen then shows everyone's stats.")],
  ];
}

/** How to open and close the screen; while the game loads behind it (#227), it closes only once that is done. */
function hint(touch: boolean, loading: boolean): Line {
  if (touch) {
    return [key('Help'), plain(loading ? ', top left, opens this again' : ', top left, opens this again · tap beside it to close')];
  }

  return loading
    ? [key('F1'), plain(' opens and closes this')]
    : [key('F1'), plain(' opens and closes this · '), key('Esc'), plain(' closes · the world keeps playing behind it')];
}

/** The intro screen's content, with the controls of the device: keyboard and mouse, or touch (decision 6). */
export function introContent(touch: boolean, loading = false): IntroContent {
  return {
    premise: PREMISE,
    hint: hint(touch, loading),
    controls: touch ? [THUMBS, BUTTONS] : [KEYBOARD, MOUSE],
    sectors: SECTORS,
    extras: extras(touch),
    friends: 'Everyone with this link plays in the same world, up to 16 ships.',
  };
}

/** A line's text without its marks. */
export function lineText(line: Line): string {
  return line.map((s) => s.text).join('');
}

/** The link to share: the page's address without its query, so `?touch=1` and `?wire=json` stay with this browser. */
export function shareLink(location: Pick<Location, 'origin' | 'pathname'>): string {
  return location.origin + location.pathname;
}
