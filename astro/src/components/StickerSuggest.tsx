/*
 * Ported from svelte/src/lib/components/StickerSuggest.svelte.
 *
 * Both `$effect`s here depend on the `draft` prop rather than on a signal, so
 * they are `useEffect`s with `draft` in the dependency list — `useSignalEffect`
 * tracks signal reads only and would never re-run (CONVERSION.md §4). `visible`
 * goes the other way: it derives from the `dismissed` and `suggestions` signals
 * and nothing else, so it is a `useComputed`.
 *
 * The `keydown` listener is registered for the life of the component, but the
 * handler it captures reaches the `onpick` prop, so `onpick` is in that effect's
 * dependency list; everything else the handler reads is a signal, whose object is
 * stable across renders.
 */
import {useEffect} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import {Sticker} from './Sticker';
import {stickerTrigger, stickersForEmoji, stickersForQuery} from '$lib/telegram/stickers';
import type {StickerItem} from '$lib/telegram/chats';

import './StickerSuggest.css';

interface Props {
  draft: string;
  onpick: (docId: string) => void;
}

export function StickerSuggest({draft, onpick}: Props) {
  const suggestions = useSignal<StickerItem[]>([]);
  const active = useSignal(0);
  const dismissed = useSignal(false);

  // The strip is driven entirely by the draft: a bare emoji or a ":shortcode"
  // asks the server for stickers, anything else clears it.
  useEffect(() => {
    const trigger = stickerTrigger(draft);
    let cancelled = false;

    if(!trigger) {
      suggestions.value = [];
      return;
    }

    const timer = setTimeout(async() => {
      try {
        const found =
          trigger.kind === 'emoji' ?
            await stickersForEmoji(trigger.value) :
            await stickersForQuery(trigger.value);
        if(cancelled) return;
        suggestions.value = found;
        active.value = 0;
      } catch(err) {
        if(!cancelled) suggestions.value = [];
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft]);

  // Typing again brings a dismissed strip back.
  useEffect(() => {
    dismissed.value = false;
  }, [draft]);

  const visible = useComputed(() => !dismissed.value && suggestions.value.length > 0);

  /**
   * Capture phase, so Enter picks the highlighted sticker before the composer's
   * own keydown handler turns it into "send the text".
   */
  function onKey(e: KeyboardEvent) {
    if(!visible.value || e.isComposing) return;

    if(e.key === 'Escape') {
      dismissed.value = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if(e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const next = active.value + (e.key === 'ArrowRight' ? 1 : -1);
      if(next < 0 || next >= suggestions.value.length) return;
      active.value = next;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if(e.key === 'Enter' || e.key === 'Tab') {
      if(e.shiftKey || e.ctrlKey || e.metaKey) return;
      const sticker = suggestions.value[active.value];
      if(!sticker) return;
      e.preventDefault();
      e.stopPropagation();
      pick(sticker.docId);
    }
  }

  function pick(docId: string) {
    suggestions.value = [];
    onpick(docId);
  }

  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onpick]);

  return (
    <>
      {visible.value && (
        <div class="suggest">
          {suggestions.value.map((sticker, i) => (
            <button
              class={['tile', i === active.value && 'active'].filter(Boolean).join(' ')}
              key={sticker.docId}
              onClick={() => pick(sticker.docId)}
              onMouseEnter={() => (active.value = i)}
            >
              <Sticker sticker={sticker} size={56} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
