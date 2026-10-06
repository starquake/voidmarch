// src/sim/rules.gen.ts
var ENEMY_FACTIONS = ["klaed", "nairan", "nautolan"];
var TICK_RATE = 60;
var TICK_SECONDS = 1 / TICK_RATE;
var SECTOR_RADIUS = 990;
var GRID_RINGS = 3;
var MAX_DAMAGE = 3;
var RESPAWN_DELAY = 3;

// src/sim/loading.ts
var LOAD_CATEGORIES = ["ships", "enemies", "space", "sounds"];
var LOAD_CATEGORY_NAMES = {
  ships: "Ships",
  enemies: "Enemies",
  space: "Space",
  sounds: "Sounds"
};
var SHIP_PREFIXES = ["hull-", "engine-", "flame-", "shield-", "weapon-", "projectile-", "pickup-"];
var SPACE_KEYS = ["planet", "asteroid"];
function loadCategory(key2) {
  if (ENEMY_FACTIONS.some((faction) => key2.startsWith(`${faction}-`))) {
    return "enemies";
  }
  if (SHIP_PREFIXES.some((prefix) => key2.startsWith(prefix))) {
    return "ships";
  }
  if (key2.startsWith("background-") || SPACE_KEYS.includes(key2)) {
    return "space";
  }
  if (key2.startsWith("sfx-")) {
    return "sounds";
  }
  return void 0;
}
function codeView() {
  return {
    label: "Loading game",
    percent: void 0,
    categories: LOAD_CATEGORIES.map((category) => ({ category, name: LOAD_CATEGORY_NAMES[category], state: "waiting" }))
  };
}
var LoadProgress = class {
  pending;
  total;
  constructor(keys) {
    this.pending = new Set(keys);
    this.total = this.pending.size;
  }
  /** A file is in, or failed: either way it's no longer waited for. */
  finish(key2) {
    this.pending.delete(key2);
  }
  get complete() {
    return this.pending.size === 0;
  }
  view() {
    const left = /* @__PURE__ */ new Map();
    for (const key2 of this.pending) {
      const category = loadCategory(key2);
      if (category !== void 0) {
        left.set(category, (left.get(category) ?? 0) + 1);
      }
    }
    const current = LOAD_CATEGORIES.find((c) => left.has(c));
    const categories = LOAD_CATEGORIES.map((category) => ({
      category,
      name: LOAD_CATEGORY_NAMES[category],
      state: stateOf(category, current, left)
    }));
    const done = this.total - this.pending.size;
    const percent = this.complete ? 100 : Math.min(99, Math.floor(done * 100 / this.total));
    let label = "Loading";
    if (this.complete) {
      label = "Starting";
    } else if (current !== void 0) {
      label = `Loading ${LOAD_CATEGORY_NAMES[current].toLowerCase()}`;
    }
    return { label, percent, categories };
  }
};
function stateOf(category, current, left) {
  if (!left.has(category)) {
    return "done";
  }
  return category === current ? "loading" : "waiting";
}

// src/frontdoor.ts
var LoadingStrip = class {
  doc;
  strip;
  what;
  amount;
  percent;
  bar;
  fill;
  categories;
  constructor(doc) {
    this.doc = doc;
    this.strip = doc.querySelector("#loading-strip");
    this.what = doc.querySelector("#loading-what");
    this.amount = doc.querySelector("#loading-amount");
    this.percent = doc.querySelector("#loading-percent");
    this.bar = doc.querySelector("#loading-bar");
    this.fill = doc.querySelector("#loading-fill");
    this.categories = doc.querySelector("#loading-categories");
  }
  show(view) {
    if (this.strip === null) {
      return;
    }
    const percent = `${String(view.percent ?? 0)}%`;
    if (this.what !== null) {
      this.what.textContent = view.label;
    }
    if (this.amount !== null) {
      this.amount.hidden = view.percent === void 0;
    }
    if (this.percent !== null) {
      this.percent.textContent = percent;
    }
    if (view.percent === void 0) {
      this.bar?.removeAttribute("aria-valuenow");
    } else {
      this.bar?.setAttribute("aria-valuenow", String(view.percent));
    }
    if (this.fill !== null) {
      this.fill.style.width = percent;
    }
    this.categories?.replaceChildren(
      ...view.categories.map((c) => {
        const li = this.doc.createElement("li");
        li.className = c.state;
        li.textContent = c.name;
        return li;
      })
    );
    this.strip.hidden = false;
    this.doc.documentElement.classList.add("loading");
  }
  hide() {
    if (this.strip !== null) {
      this.strip.hidden = true;
    }
    this.doc.documentElement.classList.remove("loading");
  }
};
var FrontDoor = class {
  doc;
  /** Undefined until the game's code is in and says what it loads. */
  progress;
  strip;
  intro;
  entered = false;
  started = false;
  /** Until the game is up, F1 has nothing to toggle, and some browsers would open their own help. */
  keepHelpClosed = (event) => {
    if (event.code === "F1") {
      event.preventDefault();
    }
  };
  constructor(intro, doc = document) {
    this.doc = doc;
    this.strip = new LoadingStrip(doc);
    this.intro = intro;
    doc.addEventListener("keydown", this.keepHelpClosed);
  }
  /** The game's code is in: from now on the strip counts keys, everything still to load. */
  count(keys) {
    this.progress = new LoadProgress(keys);
    this.draw();
  }
  /** A file is in, or failed. */
  loaded(key2) {
    this.progress?.finish(key2);
    this.draw();
  }
  /** Past the name screen: the intro on a first visit, and the strip until the game is up. */
  enter(showIntro, touch) {
    this.entered = true;
    if (showIntro) {
      this.intro.show(touch, !this.started);
    }
    this.draw();
  }
  /** The game is up: the strip goes, and the intro can be closed. */
  start() {
    this.started = true;
    this.doc.removeEventListener("keydown", this.keepHelpClosed);
    this.strip.hide();
    this.intro.ready();
  }
  draw() {
    if (this.entered && !this.started) {
      this.strip.show(this.progress?.view() ?? codeView());
    }
  }
};

// src/sim/tuning.ts
var UI_FONT_NAME = "Exo 2";
var HEADING_FONT_NAME = "Orbitron";
var UI_FONT = `'${UI_FONT_NAME}', sans-serif`;
var HEADING_FONT = `${HEADING_FONT_NAME}, sans-serif`;
var TELEPORT_DREADNOUGHT_SIZE = 128 / 48;

// src/sim/sectors.ts
var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
var SQRT3 = Math.sqrt(3);
function ring({ q, r }) {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}
function hexName({ q, r }) {
  const row = r + (q - (q & 1)) / 2 + GRID_RINGS;
  return `${LETTERS.charAt(q + GRID_RINGS)}${String(row + 1)}`;
}
function sectorName(x, y) {
  const q = 2 / 3 * x / SECTOR_RADIUS;
  const r = (-x / 3 + SQRT3 * y / 3) / SECTOR_RADIUS;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  const hex = { q: rq + 0, r: rr + 0 };
  return ring(hex) <= GRID_RINGS ? hexName(hex) : void 0;
}
var GRID_EXTENT = { x: SECTOR_RADIUS * (1.5 * GRID_RINGS + 1), y: SECTOR_RADIUS * SQRT3 * (GRID_RINGS + 0.5) };
var SECTOR_NAMES = (() => {
  const names = [];
  for (let q = -GRID_RINGS; q <= GRID_RINGS; q++) {
    for (let r = -GRID_RINGS; r <= GRID_RINGS; r++) {
      if (ring({ q, r }) <= GRID_RINGS) {
        names.push(hexName({ q, r }));
      }
    }
  }
  return names;
})();
var HOME_SECTOR = sectorName(0, 0) ?? "";

// src/sim/intro.ts
var plain = (text) => ({ text });
var gold = (text) => ({ text, mark: "gold" });
var blue = (text) => ({ text, mark: "blue" });
var red = (text) => ({ text, mark: "red" });
var key = (text) => ({ text, mark: "key" });
var NUMBER_WORDS = ["no", "one", "two", "three", "four", "five"];
function numberWord(n, capital = false) {
  const word = NUMBER_WORDS[n] ?? String(n);
  return capital ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}
var PREMISE = [
  plain("The "),
  gold("Kla'ed"),
  plain(", "),
  gold("Nairan"),
  plain(" and "),
  gold("Nautolan"),
  plain(
    " fleets hold the sectors around your home planet. Clear them ring by ring with your friends and your companions. Rescue derelict ships for the hangar, and bring down each ring's Dreadnought to open the next. Win the season together."
  )
];
var KEYBOARD = {
  title: "Keyboard",
  style: "keys",
  rows: [
    { keys: ["W", "A", "S", "D"], text: "move" },
    { keys: ["G"], text: "draw a companion, at home" },
    { keys: ["Q"], text: "hold for orders, tap to repeat" },
    { keys: ["1", "2", "3"], text: "switch weapon, engine, shield" },
    { keys: ["M"], text: "map" },
    { keys: ["Tab"], text: "hold for the standings" },
    { keys: ["H", "J"], text: "when down: respawn home, or by a squadmate" },
    { keys: ["C"], text: "when down: switch squadrons" },
    { keys: ["O"], text: "the season's victory screen" },
    { keys: ["Esc"], text: "settings, or close a screen" },
    { keys: ["F1"], text: "this screen" }
  ]
};
var MOUSE = {
  title: "Mouse",
  style: "plain",
  rows: [
    { keys: ["point"], text: "aim" },
    { keys: ["hold left"], text: "fire; the big space gun charges, and fires when you let go" },
    { keys: ["click"], text: "on the map: send your squadron to a sector" },
    { keys: ["click a slot"], text: "bottom left: pick another part you own" }
  ],
  note: "W flies up the screen, or toward the mouse with ship-relative controls in the settings."
};
var THUMBS = {
  title: "Thumbs",
  style: "plain",
  rows: [
    { keys: ["left half"], text: "a stick where your thumb lands: move that way" },
    { keys: ["right half"], text: "a stick: aim that way and fire while pushed; the big space gun fires on release" },
    { keys: ["minimap"], text: "the full map: tap a sector to send your squadron there" },
    { keys: ["a slot"], text: "bottom left: tap it, then a part you own" }
  ]
};
var BUTTONS = {
  title: "Buttons",
  style: "buttons",
  rows: [
    { keys: ["Summon"], text: "draw a companion, at home" },
    { keys: ["Orders"], text: "hold for the order ring, tap to repeat" },
    { keys: ["Respawn"], text: "when down: at home, or beside a squadmate" },
    { keys: ["Squadron"], text: "when down: switch squadrons" },
    { keys: ["Settings"], text: "sound, controls, effects" },
    { keys: ["Help"], text: "this screen" }
  ]
};
var SECTORS = [
  [
    plain("The world is "),
    blue(`${String(SECTOR_NAMES.length)} hexagonal sectors`),
    plain(`: home in ${HOME_SECTOR} and ${numberWord(GRID_RINGS)} rings around it.`)
  ],
  [plain("Destroy a sector's whole garrison to "), blue("clear it"), plain(" for good. Its losses stay, so you can wear it down over several visits.")],
  [
    plain("Your squadron's "),
    gold("mission"),
    plain(" is the nearest uncleared sector: the "),
    gold("gold arrow"),
    plain(" at the screen's edge points the way.")
  ],
  [plain("A "), red("red force field"), plain(" closes the outer rings until the ring's Dreadnought falls.")]
];
function extras(touch) {
  return [
    [blue("Companions"), plain(" are AI wingmates from the shared hangar, up to three. They follow your squadron's orders from the order ring.")],
    [
      blue("Parts"),
      plain(
        ` drop from enemies: fly over one to take it for your squadron, or raise its tier. Switch anywhere with ${touch ? "the slots bottom left" : "1, 2, 3 or the slots"}.`
      )
    ],
    [
      blue("Going down:"),
      plain(
        ` ${numberWord(MAX_DAMAGE, true)} hull hits. A friend hovering beside you revives you, or after ${String(RESPAWN_DELAY)} s respawn at home or beside a squadmate.`
      )
    ],
    [blue("Squadrons"), plain(" are up to 4 ships, companions included. An order from anyone reaches every companion in it.")],
    [blue("The season"), plain(" is won when the Nautolan Dreadnought in ring 3 falls; the victory screen then shows everyone's stats.")]
  ];
}
function hint(touch, loading) {
  if (touch) {
    return [key("Help"), plain(loading ? ", top left, opens this again" : ", top left, opens this again \xB7 tap beside it to close")];
  }
  return loading ? [key("F1"), plain(" opens and closes this")] : [key("F1"), plain(" opens and closes this \xB7 "), key("Esc"), plain(" closes \xB7 the world keeps playing behind it")];
}
function introContent(touch, loading = false) {
  return {
    premise: PREMISE,
    hint: hint(touch, loading),
    controls: touch ? [THUMBS, BUTTONS] : [KEYBOARD, MOUSE],
    sectors: SECTORS,
    extras: extras(touch),
    friends: "Everyone with this link plays in the same world, up to 16 ships."
  };
}
function shareLink(location) {
  return location.origin + location.pathname;
}

// src/introscreen.ts
var COPIED_MS = 2e3;
var IntroScreen = class {
  doc;
  form;
  link;
  copy;
  share;
  play;
  closed = [];
  copiedTimer;
  touch = false;
  /** While the game loads behind it, Play waits and the screen stays (#227, decision 5). */
  loading = false;
  constructor(doc = document) {
    this.doc = doc;
    this.form = doc.querySelector("#intro-form");
    this.link = doc.querySelector("#intro-link");
    this.copy = doc.querySelector("#intro-copy");
    this.share = doc.querySelector("#intro-share");
    this.play = doc.querySelector("#intro-play");
    this.form?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.hide();
    });
    this.copy?.addEventListener("click", () => {
      this.copyLink();
    });
    this.share?.addEventListener("click", () => {
      this.shareLink();
    });
  }
  get open() {
    return this.form !== null && !this.form.hidden;
  }
  /** listener runs each time the screen closes. */
  onClose(listener) {
    this.closed.push(listener);
  }
  /**
   * Opens the screen with the controls of the device, keeping the screens
   * behind it hidden and from taking focus or clicks. While loading, Play
   * waits until ready.
   */
  show(touch, loading = false) {
    if (this.form === null) {
      return;
    }
    this.touch = touch;
    this.loading = loading;
    this.fill();
    for (const other of this.doc.querySelectorAll(".name-screen")) {
      other.inert = other !== this.form;
    }
    this.form.hidden = false;
    this.form.scrollTop = 0;
    this.focusPlay();
  }
  /** The game is up behind the screen: Play is enabled, and the screen can close. */
  ready() {
    if (!this.loading) {
      return;
    }
    this.loading = false;
    this.fillLoading();
    if (this.open) {
      this.focusPlay();
    }
  }
  hide() {
    if (!this.open || this.loading || this.form === null) {
      return;
    }
    this.form.hidden = true;
    for (const other of this.doc.querySelectorAll(".name-screen")) {
      other.inert = false;
    }
    for (const listener of this.closed) {
      listener();
    }
  }
  /** Enter plays, once it can; on touch there's no keyboard to press it. */
  focusPlay() {
    if (!this.touch && !this.loading) {
      this.play?.focus({ preventScroll: true });
    }
  }
  fill() {
    const touch = this.touch;
    const content = introContent(touch, this.loading);
    const location = this.doc.defaultView?.location;
    this.fillLoading();
    this.text("#intro-premise", content.premise);
    this.doc.querySelector("#intro-friends")?.replaceChildren(content.friends);
    if (this.link !== null && location !== void 0) {
      this.link.value = shareLink(location);
    }
    this.resetCopy();
    if (this.share !== null) {
      this.share.hidden = !touch || typeof this.doc.defaultView?.navigator.share !== "function";
    }
    this.doc.querySelector("#intro-controls")?.replaceChildren(...content.controls.map((column) => this.column(column)));
    this.list("#intro-sectors", content.sectors);
    this.list("#intro-extras", content.extras);
  }
  /** What changes once the game is up: the hint, and Play. */
  fillLoading() {
    this.text("#intro-hint", introContent(this.touch, this.loading).hint);
    if (this.play !== null) {
      this.play.disabled = this.loading;
    }
  }
  /** Copies the link and says so for a moment; where the clipboard is out of reach, selects it to copy by hand. */
  copyLink() {
    const link = this.link?.value ?? "";
    const clipboard = this.doc.defaultView?.navigator.clipboard;
    const fallback = () => {
      this.link?.focus();
      this.link?.select();
    };
    if (clipboard === void 0) {
      fallback();
      return;
    }
    clipboard.writeText(link).then(() => {
      this.copied();
    }, fallback);
  }
  copied() {
    const view = this.doc.defaultView;
    if (this.copy === null || view === null) {
      return;
    }
    this.copy.textContent = "Copied";
    this.copy.classList.add("copied");
    view.clearTimeout(this.copiedTimer);
    this.copiedTimer = view.setTimeout(() => {
      this.resetCopy();
    }, COPIED_MS);
  }
  resetCopy() {
    this.doc.defaultView?.clearTimeout(this.copiedTimer);
    this.copiedTimer = void 0;
    if (this.copy !== null) {
      this.copy.textContent = "Copy link";
      this.copy.classList.remove("copied");
    }
  }
  /** Opens the device's share sheet with the link; closing it unshared is fine. */
  shareLink() {
    const nav = this.doc.defaultView?.navigator;
    nav?.share({ title: "Voidmarch", url: this.link?.value ?? "" }).catch(() => void 0);
  }
  text(selector, line) {
    this.doc.querySelector(selector)?.replaceChildren(...this.spans(line));
  }
  list(selector, lines) {
    this.doc.querySelector(selector)?.replaceChildren(
      ...lines.map((line) => {
        const li = this.doc.createElement("li");
        li.append(...this.spans(line));
        return li;
      })
    );
  }
  spans(line) {
    return line.map(({ text, mark }) => {
      if (mark === void 0) {
        return text;
      }
      const el = this.doc.createElement(mark === "key" ? "b" : "span");
      if (mark !== "key") {
        el.className = `mark-${mark}`;
      }
      el.textContent = text;
      return el;
    });
  }
  column(column) {
    const el = this.doc.createElement("div");
    const title = this.doc.createElement("h3");
    title.textContent = column.title;
    const rows = this.doc.createElement("div");
    rows.className = "intro-rows";
    for (const row of column.rows) {
      const keys = this.doc.createElement("span");
      keys.className = column.style === "buttons" ? "intro-keys buttons" : "intro-keys";
      keys.append(
        ...row.keys.map((k) => {
          if (column.style !== "keys") {
            return k;
          }
          const cap = this.doc.createElement("kbd");
          cap.textContent = k;
          return cap;
        })
      );
      const text = this.doc.createElement("span");
      text.textContent = row.text;
      rows.append(keys, text);
    }
    el.append(title, rows);
    if (column.note !== void 0) {
      const note = this.doc.createElement("p");
      note.className = "intro-note";
      note.textContent = column.note;
      el.append(note);
    }
    return el;
  }
};

// src/name.ts
var MAX_NAME_LENGTH = 16;
var NAME = /^[\p{L}\p{N} _-]+$/u;
function nameProblem(raw) {
  const name = raw.trim();
  if (name === "") {
    return "Pick a name first.";
  }
  if (Array.from(name).length > MAX_NAME_LENGTH) {
    return `A name is at most ${MAX_NAME_LENGTH} characters.`;
  }
  if (!NAME.test(name)) {
    return "Use letters, digits, spaces, - or _.";
  }
  return void 0;
}
async function register(name, fetcher = fetch) {
  const response = await fetcher("/api/players", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() })
  });
  const body = await response.json();
  if (!response.ok || body.token === void 0) {
    throw new RegisterError(body.error ?? `The server said ${response.status}.`);
  }
  return body.token;
}
var RegisterError = class extends Error {
  name = "RegisterError";
};
function askName() {
  const form = document.querySelector("#name-form");
  const input = document.querySelector("#name");
  const error = document.querySelector("#name-error");
  const alone = document.querySelector("#play-alone");
  if (form === null || input === null || error === null || alone === null) {
    return Promise.resolve(void 0);
  }
  form.hidden = false;
  input.focus();
  return new Promise((resolve) => {
    const done = (token) => {
      form.hidden = true;
      resolve(token);
    };
    alone.addEventListener("click", () => {
      done(void 0);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const problem = nameProblem(input.value);
      if (problem !== void 0) {
        error.textContent = problem;
        return;
      }
      error.textContent = "";
      register(input.value).then(done).catch((err) => {
        error.textContent = err instanceof RegisterError ? err.message : "Can't reach the server. Try again, or play alone for now.";
        alone.hidden = false;
      });
    });
  });
}

// src/sim/math.ts
var TAU = Math.PI * 2;

// src/settings.ts
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return void 0;
  }
}
var TOKEN_KEY = "voidmarch.token";
function loadToken(store = browserStorage()) {
  try {
    return store?.getItem(TOKEN_KEY) ?? void 0;
  } catch {
    return void 0;
  }
}
function saveToken(token, store = browserStorage()) {
  try {
    store?.setItem(TOKEN_KEY, token);
  } catch {
  }
}
var INTRO_SEEN_KEY = "voidmarch.introSeen";
function loadIntroSeen(store = browserStorage()) {
  try {
    return store?.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function saveIntroSeen(store = browserStorage()) {
  try {
    store?.setItem(INTRO_SEEN_KEY, "1");
  } catch {
  }
}

// src/sim/touch.ts
function touchMode(matches, search) {
  const asked = new URLSearchParams(search).get("touch");
  if (asked !== null) {
    return asked === "1";
  }
  return matches("(pointer: coarse)") && !matches("(any-pointer: fine)");
}

// src/entry.ts
function enter() {
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
  void import("./main.js").then(({ start }) => {
    start({ door, intro, token });
  });
}
async function askToken() {
  const saved = loadToken();
  if (saved !== void 0) {
    return saved;
  }
  const token = await askName();
  if (token !== void 0) {
    saveToken(token);
  }
  return token;
}
enter();
