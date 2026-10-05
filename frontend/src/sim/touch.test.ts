import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TouchControls, buttonAt, touchButtons, touchMode, touchUnit, type ButtonRect, type TouchScreen } from './touch.ts';
import { TOUCH_DEAD_ZONE, TOUCH_MIN_SCALE, TOUCH_STICK_RADIUS_PX } from './tuning.ts';

const screen: TouchScreen = { width: 1000, height: 800, dpr: 1, down: false, canRespawn: false, beside: undefined, fullscreen: undefined };

test('the left half moves, the right half aims and fires, and each stick takes one touch', () => {
  const t = new TouchControls();
  assert.equal(t.start(1, 100, 600, 1000, [], false, 1), 'move');
  assert.equal(t.start(2, 800, 600, 1000, [], false, 1), 'aim');
  assert.equal(t.start(3, 150, 600, 1000, [], false, 1), undefined, 'a second thumb on the move half');
  t.moveTo(1, 100 + TOUCH_STICK_RADIUS_PX * 2, 600);
  assert.deepEqual(t.stick('move'), { x: 1, y: 0 }, 'capped at full deflection');
  assert.equal(t.firing, false, 'the aim stick still rests');
  t.moveTo(2, 800, 600 - TOUCH_STICK_RADIUS_PX / 2);
  assert.deepEqual(t.aim(), { x: 0, y: -1 });
  assert.equal(t.firing, true);
  assert.equal(t.end(2), 'aim');
  assert.equal(t.firing, false, 'letting go stops firing');
  t.clear();
  assert.deepEqual(t.stick('move'), { x: 0, y: 0 });
});

test('a small push inside the dead zone does nothing', () => {
  const t = new TouchControls();
  t.start(1, 800, 600, 1000, [], false, 2);
  t.moveTo(1, 800 + TOUCH_STICK_RADIUS_PX * 2 * TOUCH_DEAD_ZONE * 0.9, 600);
  assert.deepEqual(t.stick('aim'), { x: 0, y: 0 });
  assert.equal(t.aim(), undefined);
  const [drawn] = t.sticks();
  assert.equal(drawn?.firing, false);
});

test('a knob is drawn within its stick reach', () => {
  const t = new TouchControls();
  t.start(1, 100, 100, 1000, [], false, 1);
  t.moveTo(1, 100 + TOUCH_STICK_RADIUS_PX * 3, 100);
  assert.deepEqual(t.sticks()[0]?.knob, { x: 100 + TOUCH_STICK_RADIUS_PX, y: 100 });
});

/** The buttons for playing, without the top-left Settings, Help and fullscreen switch. */
const play = (s: TouchScreen): ButtonRect[] => touchButtons(s).filter((b) => !['settings', 'help', 'fullscreen'].includes(b.button));

test('buttons and the minimap take their touches before the sticks', () => {
  const buttons = touchButtons(screen);
  assert.deepEqual(
    buttons.map((b) => b.button),
    ['summon', 'orders', 'settings', 'help'],
  );
  const orders = buttons[1];
  assert.ok(orders);
  const t = new TouchControls();
  assert.equal(t.start(1, orders.x + 5, orders.y + 5, 1000, buttons, false, 1), 'orders');
  assert.deepEqual(t.position('orders'), { x: orders.x + 5, y: orders.y + 5 });
  t.moveTo(1, 10, 10);
  assert.deepEqual(t.position('orders'), { x: 10, y: 10 });
  assert.equal(t.held('orders'), true);
  assert.equal(t.start(2, 900, 20, 1000, buttons, true, 1), 'map');
  assert.equal(buttonAt(buttons, 0, 0), undefined);
  assert.equal(t.position('aim'), undefined);
});

test('while down, only the respawns show', () => {
  assert.equal(play(screen).length, 2);
  assert.deepEqual(play({ ...screen, down: true }), [], 'not yet allowed to respawn');
  const respawns = play({ ...screen, down: true, canRespawn: true, beside: 'Mira' });
  assert.deepEqual(
    respawns.map((b) => b.label),
    ['Respawn at home', 'Respawn beside Mira'],
  );
  const [home, beside] = respawns;
  assert.ok(home && beside);
  assert.equal(home.x + home.width / 2 + (beside.x + beside.width / 2), 1000, 'centered as a pair');
  assert.equal(play({ ...screen, down: true, canRespawn: true }).length, 1);
});

test('touch shows on a touch screen without a mouse, or when the page asks', () => {
  const tablet = (q: string): boolean => q === '(pointer: coarse)';
  const laptop = (q: string): boolean => q === '(pointer: coarse)' || q === '(any-pointer: fine)';
  assert.equal(touchMode(tablet, ''), true);
  assert.equal(touchMode(laptop, ''), false, 'a touchscreen laptop keeps its mouse');
  assert.equal(touchMode(() => false, '?touch=1'), true);
  assert.equal(touchMode(tablet, '?wire=json&touch=0'), false);
});

test('on a short screen the touch UI shrinks, down to a floor', () => {
  assert.equal(touchUnit(1640, 2), 2, 'an iPad at full size');
  assert.equal(touchUnit(1170, 3), 3 * TOUCH_MIN_SCALE, 'a phone in landscape: 390 CSS pixels tall');
  assert.equal(touchUnit(560, 1), 0.8);
  const phone = touchButtons({ ...screen, width: 2532, height: 1170, dpr: 3 });
  const tablet = touchButtons({ ...screen, width: 2360, height: 1640, dpr: 2 });
  assert.ok((phone[0]?.height ?? 0) / 3 < (tablet[0]?.height ?? 0) / 2, 'smaller buttons, in CSS pixels');
});

test('a touch that starts on the minimap and moves aims instead of opening the map', () => {
  const t = new TouchControls();
  assert.equal(t.start(1, 900, 100, 1000, [], true, 1), 'map');
  t.moveTo(1, 902, 101);
  assert.equal(t.held('map'), true, 'a tap still opens the map');
  t.moveTo(1, 900 + TOUCH_STICK_RADIUS_PX, 100);
  assert.deepEqual(t.aim(), { x: 1, y: 0 });
  assert.equal(t.end(1), 'aim');
});

test('the buttons keep clear of a notch', () => {
  const plain = touchButtons({ ...screen, fullscreen: false });
  const notched = touchButtons({ ...screen, fullscreen: false, insetLeft: 40, insetRight: 30 });
  assert.equal((notched[0]?.x ?? 0) - (plain[0]?.x ?? 0), -30, 'Summon moves in from the right');
  assert.equal((notched.at(-1)?.x ?? 0) - (plain.at(-1)?.x ?? 0), 40, 'the top-left buttons move in from the left');
});

test('Settings sits in the top left, with the fullscreen switch beside it where the browser can switch (#145)', () => {
  const fullscreen = (s: TouchScreen): ButtonRect | undefined => touchButtons(s).find((b) => b.button === 'fullscreen');
  assert.equal(buttonAt(touchButtons(screen), 30, 30)?.button, 'settings');
  assert.equal(fullscreen(screen), undefined, 'no switch where the browser cannot switch');
  const windowed = fullscreen({ ...screen, fullscreen: false });
  assert.equal(windowed?.label, 'Full screen');
  const settings = touchButtons(screen).find((b) => b.button === 'settings');
  assert.ok(settings);
  assert.ok(windowed);
  assert.ok(windowed.x > settings.x + settings.width, 'the switch is right of Settings');
  assert.equal(fullscreen({ ...screen, fullscreen: true })?.label, 'Windowed');
  assert.deepEqual(
    touchButtons({ ...screen, down: true, fullscreen: false }).slice(-3).map((b) => b.button),
    ['settings', 'help', 'fullscreen'],
    'all three also while down',
  );
});

test('Help sits between Settings and the fullscreen switch (#193)', () => {
  const buttons = touchButtons({ ...screen, fullscreen: false });
  const find = (button: string): ButtonRect | undefined => buttons.find((b) => b.button === button);
  const settings = find('settings');
  const help = find('help');
  const fullscreen = find('fullscreen');
  assert.ok(settings && help && fullscreen);
  assert.equal(help.label, 'Help');
  assert.equal(help.y, settings.y);
  assert.ok(help.x > settings.x + settings.width, 'Help is right of Settings');
  assert.ok(fullscreen.x > help.x + help.width, 'the switch is right of Help');
  assert.equal(buttonAt(buttons, help.x + 1, help.y + 1)?.button, 'help');
});
