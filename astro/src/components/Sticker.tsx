/*
 * Ported from svelte/src/lib/components/Sticker.svelte.
 *
 * `el` was `$state` only because `bind:this` needed somewhere to write, so it is a
 * ref here. The loading effect reads the `sticker` prop as well as the `seen`
 * signal, so it is a `useEffect` with both in its dependency list — reading
 * `seen.value` there is what re-runs it when the observer fires (and what
 * subscribes this component to that signal).
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal, useSignalEffect} from '@preact/signals';

import {AnimatedSticker} from './AnimatedSticker';
import {loadDocUrl, type StickerItem} from '$lib/telegram/chats';
import {enqueueLoad} from '$lib/telegram/loadQueue';

import './Sticker.css';

interface Props {
  sticker: StickerItem;
  size?: number;
  autoplay?: boolean;
}

export function Sticker({sticker, size = 128, autoplay = false}: Props) {
  const url = useSignal<string | null>(null);
  const el = useRef<HTMLSpanElement>(null);
  // Nothing downloads until the tile is actually near the viewport: a saved-GIF
  // grid is hundreds of items deep and every one of them is a whole video file.
  const seen = useSignal(false);

  // Svelte read the doc id inside the async callback and always saw the current
  // sticker; a closure in JSX would see the value from the render that started the
  // load, so the latest one is kept in a ref.
  const currentDocId = useRef(sticker.docId);
  currentDocId.current = sticker.docId;

  useSignalEffect(() => {
    const node = el.current;
    if(!node || seen.value) return;

    const observer = new IntersectionObserver((entries) => {
      if(entries.some((entry) => entry.isIntersecting)) {
        seen.value = true;
        observer.disconnect();
      }
    }, {rootMargin: '150px'});

    observer.observe(node);
    return () => observer.disconnect();
  });

  useEffect(() => {
    const id = sticker.docId;
    if(sticker.kind === 'animated') return; // rendered by the Lottie worker
    if(!seen.value) return;
    url.value = null;
    enqueueLoad(() => loadDocUrl(id)).then((resolved) => {
      if(id === currentDocId.current) url.value = resolved;
    });
  }, [sticker.docId, sticker.kind, seen.value]);

  return (
    <span class="sticker" ref={el} style={{width: `${size}px`, height: `${size}px`}}>
      {!seen.value ?
        <span class="placeholder">{sticker.emoji || '⬜'}</span> :
        sticker.kind === 'animated' ?
          <AnimatedSticker docId={sticker.docId} size={size} /> :
          !url.value ?
            <span class="placeholder">{sticker.emoji || '⬜'}</span> :
            sticker.kind === 'video' ?
              /* No caption track is rendered — the original carried the equivalent
                 svelte-ignore a11y_media_has_caption for the same reason. */
              <video src={url.value} autoplay={autoplay || true} loop muted playsinline></video> :
              <img src={url.value} alt={sticker.emoji} />}
    </span>
  );
}
