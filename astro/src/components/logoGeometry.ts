/*
 * The Web S mark, as geometry rather than artwork — so the bubble in the client,
 * the favicon and the installed app's icon are the same drawing.
 *
 * The mark is a speech bubble with the client's initial cut out of it: the shape
 * the app has always shipped as its PWA icon, redrawn as a path. It is drawn on a
 * 32×32 grid, and the `S` is stroked rather than filled so it can be punched out of
 * the bubble with a mask — which means the letter shows whatever surface the mark
 * sits on (the accent, or the tile's gradient) and no second colour has to be kept
 * in step with the first.
 *
 * `astro/scripts/generate-icons.mjs` reads these constants to write
 * `public/icon.svg` and to rasterise the PNGs, so an edit here reaches every
 * surface at once.
 */
export const LOGO_GRID = 32;

/* A round bubble, with the tail running down and to the left:
 *   M16 3.6                top centre
 *   C …                    round the right, along the bottom, in to the tail mouth
 *   L3.7 28.6 C… L4 21.2   the tail out to its point and back
 *   C … Z                  up the left side, closed at the top
 *
 * One string on purpose: a path is a list of numbers read in groups, so a line
 * break inserted without a separating space merges two of them.
 */
export const LOGO_BUBBLE =
  'M16 3.6C23.2 3.6 28.4 8.4 28.4 14.4 28.4 20.4 23.2 25.2 16 25.2 13.4 25.2 11 24.6 9 23.6' +
  'L3.7 28.6C3 29.2 2.2 28.6 2.4 27.7L4 21.2C3.7 19 3.6 16.8 3.6 14.4 3.6 8.4 8.8 3.6 16 3.6Z';

/** The capital S: two tangent three-quarter circles, the shape a geometric S is. */
export const LOGO_LETTER =
  'M18.9 11.5A2.9 2.9 0 1 0 16 14.4A2.9 2.9 0 1 1 13.1 17.3';

/** How wide that centre line is drawn. */
export const LOGO_LETTER_STROKE = 2.6;
