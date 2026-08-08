<script lang="ts">
  import AnimatedSticker from './AnimatedSticker.svelte';
  import {loadDocUrl, type StickerItem} from '$lib/telegram/chats';

  let {
    sticker,
    size = 128,
    autoplay = false
  }: {sticker: StickerItem; size?: number; autoplay?: boolean} = $props();

  let url = $state<string | null>(null);

  $effect(() => {
    const id = sticker.docId;
    if(sticker.kind === 'animated') return; // rendered by the Lottie worker
    url = null;
    loadDocUrl(id).then((resolved) => {
      if(id === sticker.docId) url = resolved;
    });
  });
</script>

<span class="sticker" style="width: {size}px; height: {size}px">
  {#if sticker.kind === 'animated'}
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
