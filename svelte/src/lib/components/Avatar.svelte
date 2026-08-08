<script lang="ts">
  import {loadAvatarUrl} from '$lib/telegram/chats';

  let {peerId, title, size = 42}: {peerId: number; title: string; size?: number} = $props();

  let url = $state<string | null>(null);

  // Re-resolve whenever the peer changes; a peer with no photo stays on the
  // initial-letter fallback.
  $effect(() => {
    const id = peerId;
    url = null;
    loadAvatarUrl(id).then((resolved) => {
      if(id === peerId) url = resolved;
    });
  });
</script>

<span class="avatar" style="width: {size}px; height: {size}px; font-size: {Math.round(size / 2.4)}px">
  {#if url}
    <img src={url} alt="" />
  {:else}
    {title.slice(0, 1).toUpperCase()}
  {/if}
</span>

<style>
  .avatar {
    flex: none;
    border-radius: 50%;
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
