/*
 * Ported from svelte/src/lib/components/ForwardHeader.svelte.
 *
 * `style="--peer-color: {forward.color}"` is a custom property, which is only
 * expressible in JSX as a style object key.
 */
import type {ForwardInfo} from '$lib/telegram/reply';

import './ForwardHeader.css';

interface Props {
  forward: ForwardInfo;
  /** Opening the original author's profile; never called for a hidden sender. */
  onopenpeer?: (peerId: number) => void;
}

export function ForwardHeader({forward, onopenpeer}: Props) {
  return (
    <span class="forwarded" style={{'--peer-color': forward.color}}>
      <span class="label">Forwarded from</span>
      {/* The sender forbids being linked back to: their chosen name is all
          Telegram gives out, and it must not turn into a profile link. */}
      {forward.hidden || !forward.peerId ?
        <span class="who hidden-sender">{forward.title}</span> :
        <button class="who" onClick={() => onopenpeer?.(forward.peerId)}>{forward.title}</button>}
      {forward.postAuthor && (
        <span class="author">({forward.postAuthor})</span>
      )}
      {forward.link && (
        <a class="source" href={forward.link} target="_blank" rel="noopener noreferrer">original</a>
      )}
    </span>
  );
}
