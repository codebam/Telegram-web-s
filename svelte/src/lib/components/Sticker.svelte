<script lang="ts">
  import AnimatedSticker from './AnimatedSticker.svelte';
  import {loadDocUrl, type StickerItem} from '$lib/telegram/chats';
  import {enqueueLoad} from '$lib/telegram/loadQueue';

  let {
    sticker,
    size = 128,
    autoplay = false
  }: {sticker: StickerItem; size?: number; autoplay?: boolean} = $props();

  let url = $state<string | null>(null);
  let el = $state<HTMLSpanElement | null>(null);
  // Nothing downloads until the tile is actually near the viewport: a saved-GIF
  // grid is hundreds of items deep and every one of them is a whole video file.
  let seen = $state(false);

  $effect(() => {
    if(!el || seen) return;

    const observer = new IntersectionObserver((entries) => {
      if(entries.some((entry) => entry.isIntersecting)) {
        seen = true;
        observer.disconnect();
      }
    }, {rootMargin: '150px'});

    observer.observe(el);
    return () => observer.disconnect();
  });

  $effect(() => {
    const id = sticker.docId;
    if(sticker.kind === 'animated') return; // rendered by the Lottie worker
    if(!seen) return;
    url = null;
    enqueueLoad(() => loadDocUrl(id)).then((resolved) => {
      if(id === sticker.docId) url = resolved;
    });
  });
</script>

<span class="sticker" bind:this={el} style="width: {size}px; height: {size}px">
  {#if !seen}
    <span class="placeholder">{sticker.emoji || '⬜'}</span>
  {:else if sticker.kind === 'animated'}
    <AnimatedSticker docId={sticker.docId} {size} />
  {:else if !url}
    <span class="placeholder">{sticker.emoji || '⬜'}</span>
  {:else if sticker.kind === 'video'}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={url} autoplay={autoplay || true} loop muted playsinline></video>
  {:else}
    <img src={url} alt={sticker.emoji} />
  {/if}
</span>

<style>
  .sticker {
    display: grid;
    place-items: center;
    overflow: hidden;
  }

  img,
  video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  .placeholder {
    font-size: 24px;
    opacity: 0.5;
  }
</style>
