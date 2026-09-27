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
