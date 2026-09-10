/*
 * Ported from svelte/src/lib/components/ReactionSticker.svelte.
 *
 * The component body runs once per instance in Svelte and on every render here,
 * so the two values that outlive a render — the Lottie player handle and the
 * latest `docId` — live in refs. The `docId` one matters: Svelte read the prop
 * inside the async callbacks and always saw the current value, while a closure
 * in JSX would see the value from the render that started the work.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {reactionDocBlob, reactionDocKind, reactionDocUrl} from '$lib/telegram/reactions';

import './ReactionSticker.css';

interface Props {
  docId: string;
  size?: number;
  /** Plain emoji drawn until the document resolves, or when it has none. */
  fallback?: string;
  loop?: boolean;
  autoplay?: boolean;
  onfinish?: () => void;
}

export function ReactionSticker({
  docId,
  size = 20,
  fallback = '',
  loop = true,
  autoplay = true,
  onfinish
}: Props) {
  const url = useSignal<string | null>(null);
  const container = useRef<HTMLSpanElement>(null);
  const player = useRef<any>(null);

  // Recomputed each render rather than memoised: `docId` is a prop, so a
  // `useComputed` would never notice it change. See CONVERSION.md.
  const kind = docId ? reactionDocKind(docId) : 'static';

  // Svelte read `docId` in the async callback and always saw the current one; a
  // closure in JSX would see the value from the render that started the load.
  const currentDocId = useRef(docId);
  currentDocId.current = docId;

  useEffect(() => {
    const id = docId;
    if(!id || reactionDocKind(id) === 'animated') return;

    url.value = null;
    reactionDocUrl(id).then((resolved) => {
      if(id === currentDocId.current) url.value = resolved;
    });
  }, [docId]);

  /**
   * .tgs reactions are gzipped Lottie that only tweb's worker pool can decode,
   * so the blob goes straight to lottieLoader — there is no URL for an <img>.
   */
  // Only `docId` is a dependency, which is what the original effect tracked:
  // `size`, `loop`, `autoplay` and `onfinish` are read after the await, so a
  // parent re-render (a fresh `onfinish` arrow, say) must not restart the
  // animation. The container ref is read here rather than tracked — it is
  // filled in before effects run, and a new doc always re-runs this effect.
  useEffect(() => {
    const id = docId;
    const node = container.current;
    if(!node || !id || reactionDocKind(id) !== 'animated') return;

    let cancelled = false;

    (async() => {
      const [blob, {default: lottieLoader}] = await Promise.all([
        reactionDocBlob(id),
        import('@lib/lottie/lottieLoader')
      ]);
      if(cancelled || !blob) return;

      try {
        const animation = await lottieLoader.loadAnimationWorker({
          container: node,
          animationData: blob,
          width: size,
          height: size,
          loop,
          autoplay,
          name: `reaction${id}`,
          needUpscale: true
        });

        if(cancelled) {
          animation.remove();
          return;
        }

        player.current = animation;
        if(!loop && onfinish) animation.addEventListener('enterFrame', onEnterFrame(animation));
      } catch (err) {
        // A reaction that will not render falls back to its emoji below.
      }
    })();

    return () => {
      cancelled = true;
      player.current?.remove();
      player.current = null;
    };
  }, [docId]);

  /**
   * lottieLoader has no 'complete' event on a non-looping worker animation, so
   * the last frame stands in for one. The frame number arrives as the event's
   * argument — the player exposes `curFrame`, never `currentFrame`, and
   * comparing against that typo left every burst mounted forever.
   */
  function onEnterFrame(animation: any) {
    return (frameNo: number) => {
      const frame = frameNo ?? animation.curFrame;
      if(frame >= animation.maxFrame - 1) onfinish?.();
    };
  }

  // The original's `onDestroy`, which the effect above may already have run.
  useEffect(() => () => player.current?.remove(), []);

  return (
    <span class="reaction-sticker" style={{width: `${size}px`, height: `${size}px`}}>
      {kind === 'animated' ?
        <span class="lottie" ref={container}></span> :
        url.value && kind === 'video' ?
          /* No caption track is rendered — the original carried the equivalent
             svelte-ignore a11y_media_has_caption for the same reason. */
          <video src={url.value} autoplay loop={loop} muted playsinline></video> :
          url.value ?
            <img src={url.value} alt={fallback} /> :
            <span class="fallback" style={{fontSize: `${Math.round(size * 0.9)}px`}}>{fallback}</span>}
    </span>
  );
}
