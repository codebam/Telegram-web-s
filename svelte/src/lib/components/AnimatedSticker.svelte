<script lang="ts">
  import {onDestroy} from 'svelte';

  import {loadStickerBlob} from '$lib/telegram/chats';

  let {
    docId,
    size = 128,
    loop = true,
    autoplay = true
  }: {docId: string; size?: number; loop?: boolean; autoplay?: boolean} = $props();

  let container: HTMLDivElement | undefined = $state();
  let failed = $state(false);
  let player: any = null;

  /**
   * .tgs stickers are gzipped Lottie JSON rendered by tweb's tlottie worker
   * pool (WASM + OffscreenCanvas). lottieLoader owns that pipeline, so the blob
   * goes straight to it — there is no URL we could hand to an <img>.
   */
  $effect(() => {
    const id = docId;
    const node = container;
    if(!node) return;

    let cancelled = false;
    failed = false;

    (async () => {
      const [blob, {default: lottieLoader}] = await Promise.all([
        loadStickerBlob(id),
        import('@lib/lottie/lottieLoader')
      ]);

      if(cancelled || !blob) {
        if(!blob) failed = true;
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

        player = animation;
      } catch(err) {
        failed = true;
      }
    })();

    return () => {
      cancelled = true;
      player?.remove();
      player = null;
    };
  });

  onDestroy(() => player?.remove());
</script>

<div
  class="animated"
  bind:this={container}
  style="width: {size}px; height: {size}px"
>
  {#if failed}<span class="fallback">🎞</span>{/if}
</div>

<style>
  .animated {
    display: grid;
    place-items: center;
    overflow: hidden;
  }

  .animated :global(canvas) {
    max-width: 100%;
    max-height: 100%;
  }

  .fallback {
    font-size: 28px;
    opacity: 0.5;
  }
</style>
