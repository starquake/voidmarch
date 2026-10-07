import assert from 'node:assert/strict';
import { test } from 'node:test';

import { introContent, lineText, shareLink, type IntroContent } from './intro.ts';

const PREMISE =
  "The Kla'ed, Nairan and Nautolan fleets hold the sectors around your home planet. Clear them ring by ring with your friends and your companions. Rescue derelict ships for the hangar, and bring down each ring's Dreadnought to open the next. Win the season together.";

/** Every word the screen shows, joined. */
function allText(content: IntroContent): string {
  return [
    lineText(content.premise),
    lineText(content.hint),
    ...content.controls.flatMap((c) => [c.title, ...c.rows.flatMap((r) => [...r.keys, r.text]), c.note ?? '']),
    ...content.sectors.map(lineText),
    ...content.extras.map(lineText),
    content.friends,
  ].join('\n');
}

test('the premise is decision 3 word for word, with the three factions marked', () => {
  for (const touch of [false, true]) {
    const { premise } = introContent(touch);
    assert.equal(lineText(premise), PREMISE);
    assert.deepEqual(
      premise.filter((s) => s.mark === 'gold').map((s) => s.text),
      ["Kla'ed", 'Nairan', 'Nautolan'],
    );
  }
});

test('the keyboard variant names every key the game answers to, and no loadout', () => {
  const { controls } = introContent(false);
  assert.deepEqual(
    controls.map((c) => c.title),
    ['Keyboard', 'Mouse'],
  );
  const keys = controls[0].rows.flatMap((r) => r.keys);
  for (const key of ['W', 'A', 'S', 'D', 'G', 'Q', '1', '2', '3', 'M', 'Tab', 'C', 'H', 'J', 'O', 'Esc', 'F1']) {
    assert.ok(keys.includes(key), `${key} is listed`);
  }
  assert.match(controls[0].rows.find((r) => r.keys.includes('1'))?.text ?? '', /hold/, 'holding 1, 2 or 3 opens the list (#259)');
  const text = allText(introContent(false));
  assert.doesNotMatch(text, /\bL\b|loadout/i, 'the loadout screen and L are gone (#191)');
  assert.match(text, /slot/, 'the gauge slots can be clicked');
});

test('the touch variant names the thumbs and buttons, Help among them, and no key', () => {
  const content = introContent(true);
  assert.deepEqual(
    content.controls.map((c) => c.title),
    ['Thumbs', 'Buttons'],
  );
  assert.ok(content.controls[1].rows.some((r) => r.keys.includes('Help')));
  assert.ok(content.controls[1].rows.some((r) => r.keys.includes('Squadron')), 'a button switches squadrons while down (#45)');
  const text = allText(content);
  for (const key of ['WASD', 'F1', 'Esc', 'Tab', 'mouse']) {
    assert.ok(!text.includes(key), `${key} is not mentioned on touch`);
  }
  assert.doesNotMatch(text, /loadout/i);
});

test('the hint says how to open and close the screen on each device', () => {
  assert.match(lineText(introContent(false).hint), /F1.*Esc/);
  assert.match(lineText(introContent(true).hint), /Help.*tap beside it/);
});

test('while the game loads behind it, the hint leaves out Esc and a tap beside it', () => {
  assert.equal(lineText(introContent(false, true).hint), 'F1 opens and closes this');
  assert.equal(lineText(introContent(true, true).hint), 'Help, top left, opens this again');
});

test('the sectors and the five extras each get a line', () => {
  for (const touch of [false, true]) {
    const { sectors, extras } = introContent(touch);
    assert.equal(sectors.length, 4);
    assert.match(lineText(sectors[0] ?? []), /37 hexagonal sectors/);
    assert.deepEqual(
      extras.map((line) => line[0]?.text),
      ['Companions', 'Parts', 'Going down:', 'Squadrons', 'The season'],
    );
  }
});

test('the shared link is the page without its query', () => {
  assert.equal(shareLink(new URL('https://voidmarch.example/?touch=1&wire=json#top')), 'https://voidmarch.example/');
  assert.equal(shareLink(new URL('http://localhost:8080/play?touch=1')), 'http://localhost:8080/play');
});
