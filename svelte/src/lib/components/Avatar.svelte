<script lang="ts">
  import {invalidateAvatarUrl, loadAvatarUrl} from '$lib/telegram/chats';
  import {staleUrlRetry} from '$lib/telegram/staleUrl';

  let {peerId, title, size = 42}: {peerId: number; title: string; size?: number} = $props();

  let url = $state<string | null>(null);
  const retry = staleUrlRetry();

  function resolve(id: number) {
    loadAvatarUrl(id).then((resolved) => {
      if(id === peerId) url = resolved;
    });
  }

  // Re-resolve whenever the peer changes; a peer with no photo stays on the
  // initial-letter fallback.
  $effect(() => {
    const id = peerId;
    url = null;
    retry.reset();
    resolve(id);
  });

  /** The URL went stale — the worker revoked it. Ask for a fresh one. */
  function reload() {
    if(!retry.shouldRetry()) {
      url = null;
      return;
    }

    const id = peerId;
    invalidateAvatarUrl(id);
    url = null;
    resolve(id);
  }
</script>

<span
  class="avatar"
  style="width: {size}px; height: {size}px; font-size: {Math.round(size / 2.4)}px; border-radius: {Math.max(6, Math.round(size / 2.8))}px"
>
  {#if url}
    <img src={url} alt="" onerror={reload} />
  {:else}
    {title.slice(0, 1).toUpperCase()}
  {/if}
</span>

<style>
  /* Rounded squares, not circles — the squircle reads as current and keeps
     initials optically centred at small sizes. */
  .avatar {
    flex: none;
    display: grid;
    place-items: center;
    overflow: hidden;
    font-weight: 600;
    background: radial-gradient(circle at 30% 25%, var(--accent-hover), var(--accent));
    color: #fff;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
