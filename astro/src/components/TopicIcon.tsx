/*
 * Ported from svelte/src/lib/components/TopicIcon.svelte.
 *
 * The `$effect` depends on the `iconEmojiId` *prop*, not on a signal, so it is a
 * `useEffect` with that prop in its dependency list — `useSignalEffect` tracks
 * signal reads only and would never reload the icon (CONVERSION.md §4). Svelte
 * read the prop inside the async callback and always saw the current value; a
 * closure in JSX would see the one from the render that started the load, so the
 * latest is kept in a ref. `letter` was `$derived` over the `title` prop, so it
 * is a plain `const` recomputed on each render.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Sticker} from './Sticker';
import type {StickerItem} from '$lib/telegram/chats';
import {loadTopicIcon, topicIconColor} from '$lib/telegram/topics';

import './TopicIcon.css';

interface Props {
  iconEmojiId?: string;
  iconColor?: number;
  title?: string;
  isGeneral?: boolean;
  size?: number;
}

export function TopicIcon({iconEmojiId = '', iconColor = 0, title = '', isGeneral = false, size = 22}: Props) {
  const icon = useSignal<StickerItem | null>(null);

  const currentEmojiId = useRef(iconEmojiId);
  currentEmojiId.current = iconEmojiId;

  useEffect(() => {
    const docId = iconEmojiId;
    icon.value = null;
    if(!docId) return;
    loadTopicIcon(docId).then((resolved) => {
      if(docId === currentEmojiId.current) icon.value = resolved;
    });
  }, [iconEmojiId]);

  // Without a custom emoji Telegram draws a coloured hash carrying the topic's
  // first letter, which is what makes a topic list scannable at a glance.
  const letter = title.trim().charAt(0).toUpperCase();

  return (
    <span class="topic-icon" style={{width: `${size}px`, height: `${size}px`}}>
      {icon.value ?
        <Sticker sticker={icon.value} size={size} /> :
        isGeneral ?
          <span class="general" style={{fontSize: `${Math.round(size * 0.8)}px`}}>≡</span> :
          <span
            class="fallback"
            style={{background: topicIconColor(iconColor), fontSize: `${Math.round(size * 0.5)}px`}}
          >
            {letter || '#'}
          </span>}
    </span>
  );
}
