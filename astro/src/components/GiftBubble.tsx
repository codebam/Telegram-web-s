/*
 * Ported from svelte/src/lib/components/GiftBubble.svelte.
 *
 * `class:unique={gift.unique}` becomes the class-string form (CONVERSION.md §5),
 * and the collectible number keeps the ternary form: `gift.num` is a number, so
 * a bare `gift.unique && gift.num && <span>` would render a `0`.
 */
import {Sticker} from './Sticker';
import type {GiftExtra} from '$lib/telegram/messageTypes';

import './GiftBubble.css';

interface Props {
  gift: GiftExtra;
  fromTitle: string;
}

export function GiftBubble({gift, fromTitle}: Props) {
  return (
    <div class={['gift', gift.unique && 'unique'].filter(Boolean).join(' ')}>
      {gift.sticker ?
        <Sticker sticker={gift.sticker} size={96} autoplay /> :
        <span class="fallback">🎁</span>}

      <span class="title">
        {gift.title}{gift.unique && gift.num ? <span class="num"> #{gift.num}</span> : null}
      </span>
      <span class="who">
        {gift.incoming ? `from ${fromTitle || 'someone'}` : 'you sent this gift'}
      </span>

      {gift.valueText && <span class="value">{gift.valueText}</span>}

      {gift.message && <span class="note">{gift.message}</span>}

      <span class="sub">{gift.converted ? 'Converted to Stars' : gift.subtitle}</span>
    </div>
  );
}
