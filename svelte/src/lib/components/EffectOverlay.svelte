<script lang="ts">
  import {onDestroy} from 'svelte';

  import {loadEffectAnimation, onMessageEffect} from '$lib/telegram/sendOptions';

  let {peerId}: {peerId: number | null} = $props();

  /** Effect currently on screen; the key forces a fresh play per message. */
  let playing = $state<{key: number; effectId: string} | null>(null);
  /** Messages already played, so a re-render never replays an old effect. */
  const seen = new Set<string>();

  let played = 0;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const active = peerId;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    onMessageEffect((messagePeerId, mid, effectId) => {
      if (cancelled || active === null || messagePeerId !== active) return;

      const key = `${messagePeerId}_${mid}`;
      if (seen.has(key)) return;
      seen.add(key);

      clearTimeout(hideTimer);
      playing = {key: ++played, effectId};
      // Effects are short one-shots; nothing signals the end of a video or a
      // Lottie play from here, so the overlay retires itself.
      hideTimer = setTimeout(() => (playing = null), 4000);
    }).then((off) => {
      if (cancelled) off();
      else unsubscribe = off;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  });

  onDestroy(() => clearTimeout(hideTimer));

  /** Renders one effect: Lottie through the worker, WebM/still through the DOM. */
  function play(node: HTMLDivElement, effectId: string) {
    let cancelled = false;
    let player: any = null;
    let objectUrl: string | null = null;

    (async () => {
      const animation = await loadEffectAnimation(effectId);
      if (cancelled || !animation) return;

      if (animation.kind === 'animated' && animation.blob) {
        const {default: lottieLoader} = await import('@lib/lottie/lottieLoader');
        if (cancelled) return;
        try {
          const instance = await lottieLoader.loadAnimationWorker({
            container: node,
            animationData: animation.blob,
            width: 240,
            height: 240,
            loop: false,
            autoplay: true,
            name: `effect${effectId}`,
            needUpscale: true
          });
          if (cancelled) instance.remove();
          else player = instance;
        } catch (err) {
          // A decode failure just means no animation — never a broken chat.
        }
        return;
      }

      if (!animation.url) return;
      objectUrl = animation.url;

      if (animation.kind === 'video') {
        const video = document.createElement('video');
        video.src = objectUrl;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.width = 240;
        video.height = 240;
        node.appendChild(video);
      } else {
        const img = document.createElement('img');
        img.src = objectUrl;
        img.alt = '';
        img.width = 240;
        img.height = 240;
        node.appendChild(img);
      }
    })();

    return {
      destroy() {
        cancelled = true;
        player?.remove();
        node.replaceChildren();
      }
    };
  }
</script>

{#if playing}
  {#key playing.key}
    <div class="effect-overlay" aria-hidden="true">
      <div class="stage" use:play={playing.effectId}></div>
    </div>
  {/key}
{/if}

<style>
  .effect-overlay {
    /* Fixed, not absolute: the overlay must not depend on which ancestor in
       the chat pane happens to be positioned. */
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    z-index: 60;
  }

  .stage {
    width: 240px;
    height: 240px;
    display: grid;
    place-items: center;
  }

  .stage :global(canvas),
  .stage :global(video),
  .stage :global(img) {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
</style>
