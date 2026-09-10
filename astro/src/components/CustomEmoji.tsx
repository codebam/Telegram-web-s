/*
 * Ported from svelte/src/lib/components/CustomEmoji.svelte.
 *
 * Two mechanical details of the port: `el` and `container` were `$state` only
 * because `bind:this` needed somewhere to write, so they are refs here; and the
 * loading effect is a `useEffect` rather than a `useSignalEffect` because it
 * depends on the `docId`/`animate` props as well as on the `seen` signal —
 * reading `seen.value` in its dependency list is what re-runs it when the
 * observer fires (and what subscribes this component to that signal).
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal, useSignalEffect} from '@preact/signals';

import {
  loadCustomEmoji,
  loadCustomEmojiBlob,
  loadCustomEmojiUrl,
  type CustomEmojiItem
} from '$lib/telegram/emoji';
import {enqueueLoad} from '$lib/telegram/loadQueue';

import './CustomEmoji.css';

interface Props {
  docId: string;
  size?: number;
  /** Unicode emoji to show while loading, or when the document is gone. */
  fallback?: string;
  /** Off inside message text of a long chat: hundreds of Lottie players is a lot. */
  animate?: boolean;
}

export function CustomEmoji({docId, size = 20, fallback = '', animate = true}: Props) {
  const item = useSignal<CustomEmojiItem | null>(null);
  const url = useSignal<string | null>(null);
  const el = useRef<HTMLSpanElement>(null);
  const container = useRef<HTMLSpanElement>(null);
  const seen = useSignal(false);
  const player = useRef<any>(null);

  // Nothing downloads until the glyph is near the viewport — an emoji set is
  // hundreds of documents and a chat can carry as many again.
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
    const id = docId;
    if(!seen.value) return;

    let cancelled = false;
    item.value = null;
    url.value = null;

    enqueueLoad(async() => {
      const resolved = await loadCustomEmoji(id);
      if(cancelled || !resolved) return;
      item.value = resolved;

      if(resolved.kind === 'animated' && animate) return; // played by the Lottie worker
      const resolvedUrl = await loadCustomEmojiUrl(id);
      if(!cancelled) url.value = resolvedUrl;
    });

    return () => {
      cancelled = true;
    };
  }, [docId, animate, seen.value]);

  /**
   * .tgs custom emoji are gzipped Lottie JSON that only tweb's worker pool can
   * decode — same pipeline as AnimatedSticker, but fed from the custom emoji
   * document cache rather than the sticker one.
   */
  useEffect(() => {
    const id = docId;
    const node = container.current;
    if(!node || !item.value || item.value.kind !== 'animated' || !animate) return;

    let cancelled = false;

    (async() => {
      const [blob, {default: lottieLoader}] = await Promise.all([
        loadCustomEmojiBlob(id),
        import('@lib/lottie/lottieLoader')
      ]);

      if(cancelled || !blob) {
        if(!blob) url.value = await loadCustomEmojiUrl(id);
        return;
      }

      try {
        const animation = await lottieLoader.loadAnimationWorker({
          container: node,
          animationData: blob,
          width: size,
          height: size,
          loop: true,
          autoplay: true,
          name: `customEmoji${id}`,
          needUpscale: true
        });

        if(cancelled) {
          animation.remove();
          return;
        }

        player.current = animation;
      } catch(err) {
        url.value = await loadCustomEmojiUrl(id);
      }
    })();

    return () => {
      cancelled = true;
      player.current?.remove();
      player.current = null;
    };
  }, [docId, item.value, animate]);

  useEffect(() => () => player.current?.remove(), []);

  return (
    <span
      class="custom-emoji"
      ref={el}
      style={{width: `${size}px`, height: `${size}px`, fontSize: `${size}px`}}
      title={item.value?.emoji || fallback}
    >
      {item.value?.kind === 'animated' && animate && !url.value ?
        <span class="lottie" ref={container} style={{width: `${size}px`, height: `${size}px`}}></span> :
        url.value && item.value?.kind === 'video' ?
          <video src={url.value} autoplay={animate} loop muted playsinline></video> :
          url.value ?
            <img src={url.value} alt={item.value?.emoji || fallback} /> :
            <span class="placeholder">{item.value?.emoji || fallback}</span>}
    </span>
  );
}
