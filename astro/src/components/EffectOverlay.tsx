/*
 * Ported from svelte/src/lib/components/EffectOverlay.svelte.
 *
 * `use:play` is the `usePlay` hook below (CONVERSION.md §6): the hook body is the
 * action's `mounted` logic and its dependency list is the action's parameter. The
 * dependency is the whole `playing` value rather than just its `effectId` because
 * of the `{#key playing.key}` block that wrapped the action — a repeat of the same
 * effect on the next message has to play again, and the fresh object that the key
 * carries is what says so here.
 */
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {loadEffectAnimation, onMessageEffect} from '$lib/telegram/sendOptions';

import './EffectOverlay.css';

type Playing = {key: number; effectId: string};

interface Props {
  peerId: number | null;
}

/** Renders one effect: Lottie through the worker, WebM/still through the DOM. */
function usePlay(playing: Playing | null) {
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = node.current;
    // The action only existed while the overlay was on screen: with nothing
    // playing there is no stage node and nothing to start.
    if(!target || !playing) return;

    let cancelled = false;
    let player: any = null;
    let objectUrl: string | null = null;

    (async() => {
      const animation = await loadEffectAnimation(playing.effectId);
      if(cancelled || !animation) return;

      if(animation.kind === 'animated' && animation.blob) {
        const {default: lottieLoader} = await import('@lib/lottie/lottieLoader');
        if(cancelled) return;
        try {
          const instance = await lottieLoader.loadAnimationWorker({
            container: target,
            animationData: animation.blob,
            width: 240,
            height: 240,
            loop: false,
            autoplay: true,
            name: `effect${playing.effectId}`,
            needUpscale: true
          });
          if(cancelled) instance.remove();
          else player = instance;
        } catch(err) {
          // A decode failure just means no animation — never a broken chat.
        }
        return;
      }

      if(!animation.url) return;
      objectUrl = animation.url;

      if(animation.kind === 'video') {
        const video = document.createElement('video');
        video.src = objectUrl;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.width = 240;
        video.height = 240;
        target.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.src = objectUrl;
        img.alt = '';
        img.width = 240;
        img.height = 240;
        target.appendChild(img);
      }
    })();

    return () => {
      cancelled = true;
      player?.remove();
      target.replaceChildren();
    };
  }, [playing]);

  return node;
}

export function EffectOverlay({peerId}: Props) {
  /** Effect currently on screen; the key forces a fresh play per message. */
  const playing = useSignal<Playing | null>(null);
  /** Messages already played, so a re-render never replays an old effect. */
  const seen = useMemo(() => new Set<string>(), []);

  const played = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stage = usePlay(playing.value);

  useEffect(() => {
    const active = peerId;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    onMessageEffect((messagePeerId, mid, effectId) => {
      if(cancelled || active === null || messagePeerId !== active) return;

      const key = `${messagePeerId}_${mid}`;
      if(seen.has(key)) return;
      seen.add(key);

      clearTimeout(hideTimer.current);
      playing.value = {key: ++played.current, effectId};
      // Effects are short one-shots; nothing signals the end of a video or a
      // Lottie play from here, so the overlay retires itself.
      hideTimer.current = setTimeout(() => (playing.value = null), 4000);
    }).then((off) => {
      if(cancelled) off();
      else unsubscribe = off;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [peerId]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  return (
    <>
      {playing.value && (
        <div class="effect-overlay" key={playing.value.key} aria-hidden="true">
          <div class="stage" ref={stage}></div>
        </div>
      )}
    </>
  );
}
