<script lang="ts">
  import Avatar from './Avatar.svelte';
  import {
    loadStories,
    loadStoriesFeed,
    loadStoryUrl,
    markStoriesRead,
    type StoryItem,
    type StoryPeer
  } from '$lib/telegram/extras';

  let feed = $state<StoryPeer[]>([]);
  let openPeer = $state<StoryPeer | null>(null);
  let stories = $state<StoryItem[]>([]);
  let index = $state(0);
  let url = $state<string | null>(null);

  $effect(() => {
    loadStoriesFeed().then((loaded) => (feed = loaded));
  });

  // Resolve the media for whichever story is on screen.
  $effect(() => {
    const peer = openPeer;
    const story = stories[index];
    if(!peer || !story) return;

    url = null;
    loadStoryUrl(peer.peerId, story.id).then((resolved) => {
      if(openPeer?.peerId === peer.peerId && stories[index]?.id === story.id) url = resolved;
    });
  });

  async function open(peer: StoryPeer) {
    openPeer = peer;
    index = 0;
    stories = await loadStories(peer.peerId, peer.storyIds);
    if(stories.length) {
      await markStoriesRead(peer.peerId, stories[stories.length - 1].id);
      feed = feed.map((p) => (p.peerId === peer.peerId ? {...p, unread: false} : p));
    }
  }

  function close() {
    openPeer = null;
    stories = [];
    url = null;
  }

  function step(delta: number) {
    const next = index + delta;
    if(next < 0 || next >= stories.length) close();
    else index = next;
  }

  function onKey(e: KeyboardEvent) {
    if(!openPeer) return;
    if(e.key === 'Escape') close();
    else if(e.key === 'ArrowLeft') step(-1);
    else if(e.key === 'ArrowRight') step(1);
  }
</script>

<svelte:window onkeydown={onKey} />

{#if feed.length}
  <div class="strip">
    {#each feed as peer (peer.peerId)}
      <button class="story" onclick={() => open(peer)}>
        <span class="ring" class:unread={peer.unread}>
          <Avatar peerId={peer.peerId} title={peer.title} size={52} />
        </span>
        <span class="name">{peer.title}</span>
      </button>
    {/each}
  </div>
{/if}

{#if openPeer}
  <div class="viewer" onclick={close} role="presentation">
    <div class="stage" onclick={(e) => e.stopPropagation()} role="presentation">
      <div class="progress">
        {#each stories as _, i}
          <span class="segment" class:done={i <= index}></span>
        {/each}
      </div>

      <header>
        <Avatar peerId={openPeer.peerId} title={openPeer.title} size={32} />
        <span>{openPeer.title}</span>
        <button class="close" onclick={close} aria-label="Close">✕</button>
      </header>

      {#if !url}
        <p class="muted">Loading…</p>
      {:else if stories[index]?.isVideo}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={url} autoplay controls></video>
      {:else}
        <img src={url} alt="" />
      {/if}

      {#if stories[index]?.caption}
        <p class="caption">{stories[index].caption}</p>
      {/if}

      <button class="nav prev" onclick={() => step(-1)} aria-label="Previous">‹</button>
      <button class="nav next" onclick={() => step(1)} aria-label="Next">›</button>
    </div>
  </div>
{/if}

<style>
  .strip {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .story {
    display: grid;
    justify-items: center;
    gap: 3px;
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    width: 68px;
    flex: none;
  }

  .ring {
    padding: 2px;
    border-radius: 50%;
    border: 2px solid transparent;
    display: block;
  }

  .ring.unread {
    border-color: var(--accent);
  }

  .name {
    font-size: 11px;
    color: var(--text-dim);
    max-width: 64px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .viewer {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.92);
    display: grid;
    place-items: center;
    z-index: 98;
  }

  .stage {
    position: relative;
    width: min(420px, calc(100vw - 24px));
    height: min(760px, calc(100vh - 40px));
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: 8px;
    padding: 10px;
  }

  .progress {
    display: flex;
    gap: 4px;
  }

  .segment {
    flex: 1;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.25);
  }

  .segment.done {
    background: #fff;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #fff;
    font-size: 14px;
  }

  header .close {
    margin-left: auto;
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 16px;
  }

  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    min-height: 0;
  }

  .caption {
    margin: 0;
    color: #fff;
    font-size: 14px;
  }

  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    font-size: 22px;
    cursor: pointer;
  }

  .prev {
    left: -50px;
  }

  .next {
    right: -50px;
  }

  .muted {
    color: rgba(255, 255, 255, 0.7);
    align-self: center;
    justify-self: center;
  }

  @media (max-width: 720px) {
    .prev {
      left: 4px;
    }

    .next {
      right: 4px;
    }
  }
</style>
