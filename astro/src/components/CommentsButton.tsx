/*
 * Ported from svelte/src/lib/components/CommentsButton.svelte.
 *
 * Both derived values come from props alone, so they are plain `const`s in the
 * body: a Preact body runs on every render, which is exactly when a prop-derived
 * value has to be recomputed. A `useComputed` tracks signal reads only and would
 * freeze at the props of the first render.
 */
import {Avatar} from './Avatar';

import './CommentsButton.css';

interface Props {
  count?: number;
  commenters?: number[];
  onopen: () => void;
}

export function CommentsButton({count = 0, commenters = [], onopen}: Props) {
  // Telegram shows at most three faces before the label; more than that and the
  // stack stops being readable at bubble scale.
  const faces = commenters.slice(0, 3);
  const label = count ? `${count} ${count === 1 ? 'comment' : 'comments'}` : 'Leave a comment';

  return (
    <button class="comments" onClick={onopen}>
      {faces.length > 0 && (
        <span class="faces">
          {faces.map((peerId) => (
            <span key={peerId} class="face"><Avatar peerId={peerId} title="" size={18} /></span>
          ))}
        </span>
      )}
      <span class="label">{label}</span>
    </button>
  );
}
