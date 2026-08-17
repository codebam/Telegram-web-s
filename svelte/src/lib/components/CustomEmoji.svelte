<script lang="ts">
  import {onDestroy} from 'svelte';

  import {
    loadCustomEmoji,
    loadCustomEmojiBlob,
    loadCustomEmojiUrl,
    type CustomEmojiItem
  } from '$lib/telegram/emoji';
  import {enqueueLoad} from '$lib/telegram/loadQueue';

  let {
    docId,
    size = 20,
    fallback = '',
    animate = true
  }: {
    docId: string;
    size?: number;
    /** Unicode emoji to show while loading, or when the document is gone. */
    fallback?: string;
    /** Off inside message text of a long chat: hundreds of Lottie players is a lot. */
    animate?: boolean;
  } = $props();

  let item = $state<CustomEmojiItem | null>(null);
  let url = $state<string | null>(null);
  let el = $state<HTMLSpanElement | null>(null);
  let container = $state<HTMLSpanElement | null>(null);
  let seen = $state(false);
  let player: any = null;

  // Nothing downloads until the glyph is near the viewport — an emoji set is
  // hundreds of documents and a chat can carry as many again.
  $effect(() => {
    if (!el || seen) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        seen = true;
        observer.disconnect();
      }
    }, {rootMargin: '150px'});

    observer.observe(el);
    return () => observer.disconnect();
  });

  $effect(() => {
    const id = docId;
    if (!seen) return;

    let cancelled = false;
    item = null;
    url = null;

    enqueueLoad(async () => {
      const resolved = await loadCustomEmoji(id);
      if (cancelled || !resolved) return;
      item = resolved;

      if (resolved.kind === 'animated' && animate) return; // played by the Lottie worker
      const resolvedUrl = await loadCustomEmojiUrl(id);
      if (!cancelled) url = resolvedUrl;
    });

    return () => {
      cancelled = true;
    };
  });

  /**
   * .tgs custom emoji are gzipped Lottie JSON that only tweb's worker pool can
   * decode — same pipeline as AnimatedSticker, but fed from the custom emoji
   * document cache rather than the sticker one.
   */
  $effect(() => {
    const id = docId;
    const node = container;
    if (!node || !item || item.kind !== 'animated' || !animate) return;

    let cancelled = false;

    (async () => {
      const [blob, {default: lottieLoader}] = await Promise.all([
        loadCustomEmojiBlob(id),
        import('@lib/lottie/lottieLoader')
      ]);

      if (cancelled || !blob) {
        if (!blob) url = await loadCustomEmojiUrl(id);
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

        if (cancelled) {
          animation.remove();
          return;
        }

        player = animation;
      } catch (err) {
        url = await loadCustomEmojiUrl(id);
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

<span
  class="custom-emoji"
  bind:this={el}
  style="width: {size}px; height: {size}px; font-size: {size}px"
  title={item?.emoji || fallback}
>
  {#if item?.kind === 'animated' && animate && !url}
    <span class="lottie" bind:this={container} style="width: {size}px; height: {size}px"></span>
  {:else if url && item?.kind === 'video'}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={url} autoplay={animate} loop muted playsinline></video>
  {:else if url}
    <img src={url} alt={item?.emoji || fallback} />
  {:else}
    <span class="placeholder">{item?.emoji || fallback}</span>
  {/if}
</span>

<style>
  .custom-emoji {
    display: inline-grid;
    place-items: center;
    vertical-align: -0.2em;
    overflow: hidden;
  }

  .lottie {
    display: grid;
    place-items: center;
  }

  .lottie :global(canvas),
  img,
  video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .placeholder {
    font-size: 0.9em;
    line-height: 1;
    opacity: 0.6;
  }
</style>
