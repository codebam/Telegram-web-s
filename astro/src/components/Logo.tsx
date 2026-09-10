/*
 * The client mark: the speech bubble the app is named for, with its initial cut
 * out of it — see logoGeometry.ts for the drawing and why it is a mask.
 *
 * The letter is a hole rather than a second shape, so the mark takes the colour
 * of whatever it is placed on: the accent tile in the sign-in card and the empty
 * conversation, or any other surface later. It ships no stylesheet of its own —
 * the tile belongs to whoever places it (`.empty-logo` in styles/app.css, the
 * splash's `.logo` in pages/index.astro).
 */
import {useMemo} from 'preact/hooks';

import {
  LOGO_BUBBLE,
  LOGO_GRID,
  LOGO_LETTER,
  LOGO_LETTER_STROKE
} from './logoGeometry';

/** Masks are addressed by id, so every instance needs its own. */
let instances = 0;

export function Logo({size = 96}: {size?: number}) {
  const maskId = useMemo(() => `ws-logo-${++instances}`, []);

  return (
    <svg
      viewBox={`0 0 ${LOGO_GRID} ${LOGO_GRID}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{display: 'block'}}
    >
      <mask id={maskId}>
        <rect width={LOGO_GRID} height={LOGO_GRID} fill="#fff" />
        <path
          d={LOGO_LETTER}
          fill="none"
          stroke="#000"
          stroke-width={LOGO_LETTER_STROKE}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </mask>
      <path d={LOGO_BUBBLE} fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
