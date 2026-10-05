import { sectorRing } from '../src/sim/sectors.ts';
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

test('Title Screen plays at home, and crossfades to the ring\'s Level track in D5 (#187)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  // Browsers keep audio locked until the first input.
  const box = await page.locator('#game canvas').boundingBox();
  await page.mouse.click((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
  await expect
    .poll(() => music(page), { message: 'the home track plays', timeout: 15_000 })
    .toEqual({ place: 'home', playing: 'music-title-screen', volume: MUSIC_VOLUME, fading: 0 });

  const ring = sectorRing('D5');
  await flyOut(page);
  await expect
    .poll(() => music(page), { message: 'the ring\'s track fades in, and the home track fades out', timeout: 15_000 })
    .toEqual({ place: `ring${String(ring)}`, playing: `music-level-${String(ring)}`, volume: MUSIC_VOLUME, fading: 0 });
});
