import { expect, test } from './fixtures.ts';
import { flyOut, state } from './hunt.ts';

/** The music's volume, in audio.ts. */
const MUSIC_VOLUME = 0.3;

const music = async (page: Parameters<typeof state>[0]): Promise<{ playing: string | null; volume: number; fading: number }> => {
  const { audio } = await state(page);

  return { playing: audio.playingMusic, volume: Math.round(audio.musicVolume * 100) / 100, fading: audio.fadingMusic };
};

test('Eerie Space Music plays at home, and crossfades to an Explorer theme beyond it (#187)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.voidmarch?.net.status === 'online');
  // Browsers keep audio locked until the first input.
  const box = await page.locator('#game canvas').boundingBox();
  await page.mouse.click((box?.x ?? 0) + 100, (box?.y ?? 0) + 100);
  await expect.poll(() => music(page), { message: 'the home track plays' }).toEqual({ playing: 'music-eerie-1', volume: MUSIC_VOLUME, fading: 0 });

  await flyOut(page);
  await expect
    .poll(() => music(page), { message: 'an Explorer theme fades in out of the home sector, and the home track fades out' })
    .toEqual({ playing: expect.stringMatching(/^music-explorer-theme-/), volume: MUSIC_VOLUME, fading: 0 });
});
