<script lang="ts">
  import {onDestroy} from 'svelte';

  import {reactionDocBlob, reactionDocKind, reactionDocUrl} from '$lib/telegram/reactions';

  let {
    docId,
    size = 20,
    fallback = '',
    loop = true,
    autoplay = true,
    onfinish
  }: {
    docId: string;
    size?: number;
    /** Plain emoji drawn until the document resolves, or when it has none. */
    fallback?: string;
    loop?: boolean;
    autoplay?: boolean;
    onfinish?: () => void;
  } = $props();

  let url = $state<string | null>(null);
  let container: HTMLSpanElement | undefined = $state();
  let player: any = null;

  const kind = $derived(docId ? reactionDocKind(docId) : 'static');

  $effect(() => {
    const id = docId;
    if (!id || reactionDocKind(id) === 'animated') return;

    url = null;
    reactionDocUrl(id).then((resolved) => {
      if (id === docId) url = resolved;
    });
  });

  /**
   * .tgs reactions are gzipped Lottie that only tweb's worker pool can decode,
   * so the blob goes straight to lottieLoader — there is no URL for an <img>.
   */
  $effect(() => {
    const id = docId;
    const node = container;
    if (!node || !id || reactionDocKind(id) !== 'animated') return;

    let cancelled = false;

    (async () => {
      const [blob, {default: lottieLoader}] = await Promise.all([
        reactionDocBlob(id),
        import('@lib/lottie/lottieLoader')
      ]);
      if (cancelled || !blob) return;

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

        if (cancelled) {
          animation.remove();
          return;
        }

        player = animation;
        if (!loop && onfinish) animation.addEventListener('enterFrame', onEnterFrame(animation));
      } catch (err) {
        // A reaction that will not render falls back to its emoji below.
      }
    })();

    return () => {
      cancelled = true;
      player?.remove();
      player = null;
    };
  });

  /** lottieLoader has no 'complete' event on a non-looping worker animation. */
  function onEnterFrame(animation: any) {
    return () => {
      if (animation.currentFrame >= animation.maxFrame - 1) onfinish?.();
    };
  }

  onDestroy(() => player?.remove());
</script>

<span class="reaction-sticker" style="width: {size}px; height: {size}px">
  {#if kind === 'animated'}
    <span class="lottie" bind:this={container}></span>
  {:else if url && kind === 'video'}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={url} autoplay {loop} muted playsinline></video>
  {:else if url}
    <img src={url} alt={fallback} />
  {:else}
    <span class="fallback" style="font-size: {Math.round(size * 0.9)}px">{fallback}</span>
  {/if}
</span>

<style>
  .reaction-sticker {
    display: inline-grid;
    place-items: center;
    vertical-align: middle;
    flex: none;
  }

  .reaction-sticker > :global(*) {
    max-width: 100%;
    max-height: 100%;
  }

  .lottie {
    display: block;
    width: 100%;
    height: 100%;
  }

  .fallback {
    line-height: 1;
  }
</style>
