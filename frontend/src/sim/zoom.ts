/** The smallest pixel scale, so sprites never render smaller than 2x. */
export const MIN_ZOOM = 2;

/**
 * Returns the largest whole-number scale at which a view of at least
 * targetWidth by targetHeight art pixels fits in the viewport. Whole numbers
 * keep every art pixel the same size on screen.
 */
export function integerZoom(
  viewportWidth: number,
  viewportHeight: number,
  targetWidth: number,
  targetHeight: number,
): number {
  const fit = Math.floor(Math.min(viewportWidth / targetWidth, viewportHeight / targetHeight));

  return Math.max(MIN_ZOOM, fit);
}

/**
 * Returns the whole-number scale at which one background tile of tileWidth
 * by tileHeight covers a view of viewWidth by viewHeight art pixels, so no
 * view shows the same part of the tile twice (#163). Whole numbers keep the
 * tile's pixels even.
 */
export function backgroundScale(viewWidth: number, viewHeight: number, tileWidth: number, tileHeight: number): number {
  return Math.max(1, Math.ceil(Math.max(viewWidth / tileWidth, viewHeight / tileHeight)));
}
