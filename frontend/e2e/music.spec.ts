import { expect, test } from './fixtures.ts';
import { flyOut, state } from './hunt.ts';

/** The music's volume, in audio.ts. */
const MUSIC_VOLUME = 0.3;

const music = async (
  page: Parameters<typeof state>[0],
): Promise<{ place: string; playing: string | null; volume: number; fading: number }> => {
  const { audio } = await state(page);

  return { place: audio.musicPlace, playing: audio.playingMusic, volume: Math.round(audio.musicVolume * 100) / 100, fading: audio.fadingMusic };
};

test('Eerie Space Music plays at home, and crossfades to an Under Pressure theme in a fight (#187)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  // Browsers keep audio locked until the first input.
  const box = await page.locator('#game canvas').boundingBox();
  await page.mouse.click((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
  // Another spec's ship can draw an enemy past home: the fight's music calms down again.
  await expect
    .poll(() => music(page), { message: 'the home track plays', timeout: 30_000 })
    .toEqual({ place: 'home', playing: 'music-eerie-1', volume: MUSIC_VOLUME, fading: 0 });

  // D5's garrison never runs out (#99), so the ship flies into a fight.
  await flyOut(page);
  await expect
    .poll(() => music(page), { message: 'an Under Pressure theme fades in, and the tracks before it fade out', timeout: 30_000 })
    .toEqual({ place: 'battle', playing: expect.stringMatching(/^music-explorer-under-pressure-/), volume: MUSIC_VOLUME, fading: 0 });
});
