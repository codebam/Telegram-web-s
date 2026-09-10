/*
 * Ported from svelte/src/lib/components/AnimatedSticker.svelte.
 *
 * The `$effect` read props (`docId`, `size`, `loop`, `autoplay`), so it becomes
 * a `useEffect` with those in its dependency list — `useSignalEffect` tracks
 * signal reads only and would never re-run when the sticker changes. The
 * container is a ref, and so is the player: the async load writes it after the
 * render that started it, and it has to survive that render.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {loadStickerBlob} from '$lib/telegram/chats';
import type LottiePlayer from '@lib/lottie/lottiePlayer';

import './AnimatedSticker.css';

interface Props {
  docId: string;
  size?: number;
  loop?: boolean;
  autoplay?: boolean;
}

export function AnimatedSticker({docId, size = 128, loop = true, autoplay = true}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const failed = useSignal(false);
  const player = useRef<LottiePlayer | null>(null);

  /**
   * .tgs stickers are gzipped Lottie JSON rendered by tweb's tlottie worker
   * pool (WASM + OffscreenCanvas). lottieLoader owns that pipeline, so the blob
   * goes straight to it — there is no URL we could hand to an <img>.
   */
  useEffect(() => {
    const id = docId;
    const node = container.current;
    if(!node) return;

    let cancelled = false;
    failed.value = false;

    (async() => {
      const [blob, {default: lottieLoader}] = await Promise.all([
        loadStickerBlob(id),
        import('@lib/lottie/lottieLoader')
      ]);

      if(cancelled || !blob) {
        if(!blob) failed.value = true;
        return;
      }

      try {
        const animation = await lottieLoader.loadAnimationWorker({
          container: node,
          animationData: blob,
          width: size,
          height: size,
          loop,
          autoplay,
          name: `doc${id}`,
          needUpscale: true
        });

        if(cancelled) {
          animation.remove();
          return;
        }

        player.current = animation;
      } catch(err) {
        failed.value = true;
      }
    })();

    return () => {
      cancelled = true;
      player.current?.remove();
      player.current = null;
    };
  }, [docId, size, loop, autoplay]);

  // The original's `onDestroy(() => player?.remove())`, as its own cleanup: a
  // player that resolved after the teardown above ran would otherwise outlive
  // the sticker.
  useEffect(() => () => player.current?.remove(), []);

  return (
    <div class="animated" ref={container} style={{width: `${size}px`, height: `${size}px`}}>
      {failed.value && <span class="fallback">🎞</span>}
    </div>
  );
}
