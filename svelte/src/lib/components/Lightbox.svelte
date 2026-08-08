<script lang="ts">
  import {loadMediaUrl, type MessageItem} from '$lib/telegram/chats';

  let {
    peerId,
    items,
    index = $bindable(),
    onclose
  }: {
    peerId: number;
    items: MessageItem[];
    index: number;
    onclose: () => void;
  } = $props();

  let url = $state<string | null>(null);

  const current = $derived(items[index]);

  $effect(() => {
    const message = current;
    if(!message) return;
    url = null;
    // Full resolution here, not the bubble-sized thumb.
    loadMediaUrl(peerId, message.mid, 1600).then((resolved) => {
      if(current?.mid === message.mid) url = resolved;
    });
  });

  function step(delta: number) {
    const next = index + delta;
    if(next >= 0 && next < items.length) index = next;
  }

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape') onclose();
    else if(e.key === 'ArrowLeft') step(-1);
    else if(e.key === 'ArrowRight') step(1);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="stage" onclick={(e) => e.stopPropagation()} role="presentation">
    {#if !url}
      <p class="muted">Loading…</p>
    {:else if current?.media?.kind === 'video'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={url} controls autoplay></video>
    {:else}
      <img src={url} alt="" />
    {/if}
  </div>

  {#if index > 0}
    <button class="nav prev" onclick={(e) => { e.stopPropagation(); step(-1); }} aria-label="Previous">‹</button>
  {/if}
  {#if index < items.length - 1}
    <button class="nav next" onclick={(e) => { e.stopPropagation(); step(1); }} aria-label="Next">›</button>
  {/if}

  <button class="close" onclick={onclose} aria-label="Close">✕</button>
  <span class="counter">{index + 1} / {items.length}</span>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    display: grid;
    place-items: center;
    z-index: 100;
  }

  .stage {
    max-width: 92vw;
    max-height: 88vh;
    display: grid;
    place-items: center;
  }

  img,
  video {
    max-width: 92vw;
    max-height: 88vh;
    object-fit: contain;
  }

  .nav,
  .close {
    position: absolute;
    background: rgba(255, 255, 255, 0.12);
    border: none;
    color: #fff;
    cursor: pointer;
    border-radius: 50%;
    width: 44px;
    height: 44px;
    font-size: 26px;
    line-height: 1;
  }

  .nav:hover,
  .close:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  .prev {
    left: 20px;
  }

  .next {
    right: 20px;
  }

  .close {
    top: 20px;
    right: 20px;
    font-size: 18px;
  }

  .counter {
    position: absolute;
    top: 28px;
    left: 24px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 13px;
  }

  .muted {
    color: rgba(255, 255, 255, 0.7);
  }
</style>
