<script lang="ts">
  import Glyph from './Glyph.svelte';
  import {loadMediaUrl, saveMediaToDisk, type MediaItem} from '$lib/telegram/chats';

  let {peerId, mid, media}: {peerId: number; mid: number; media: MediaItem} = $props();

  let url = $state<string | null>(null);
  let failed = $state(false);

  $effect(() => {
    const key = `${peerId}_${mid}`;
    url = null;
    failed = false;
    loadMediaUrl(peerId, mid).then((resolved) => {
      if(key !== `${peerId}_${mid}`) return;
      url = resolved;
      failed = !resolved;
    }).catch(() => (failed = true));
  });

  // Keep the bubble from collapsing then jumping once the image decodes:
  // reserve the real aspect ratio up front, capped to the bubble width.
  const ratio = $derived(media.width && media.height ? media.width / media.height : 4 / 3);

  function humanSize(bytes: number) {
    if(!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while(value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
  }

  let saving = $state(false);
  let saveError = $state('');

  async function save() {
    if(saving) return;
    saving = true;
    saveError = '';
    try {
      await saveMediaToDisk(peerId, mid);
    } catch(err: any) {
      saveError = err?.type || err?.message || 'Download failed';
    } finally {
      saving = false;
    }
  }

  function duration(seconds: number) {
    if(!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
</script>

{#if media.kind === 'photo' || media.kind === 'video' || media.kind === 'gif' || media.kind === 'sticker'}
  <div
    class="frame"
    class:sticker={media.kind === 'sticker'}
    style="aspect-ratio: {ratio}"
  >
    {#if url && media.kind === 'gif'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={url} autoplay loop muted playsinline></video>
      <span class="play">GIF</span>
    {:else if url}
      <img src={url} alt={media.kind} />
      {#if media.kind === 'video'}
        <span class="play">▶ {duration(media.duration)}</span>
      {/if}
    {:else if failed}
      <span class="fallback">{media.kind === 'video' ? '🎬 Video' : '📷 Photo'}</span>
    {:else}
      <span class="fallback">Loading…</span>
    {/if}
  </div>
{:else if media.kind === 'voice' || media.kind === 'audio'}
  <div class="file">
    <span class="glyph">{media.kind === 'voice' ? '🎤' : '🎵'}</span>
    <span class="info">
      <span class="name">{media.name || 'Voice message'}</span>
      {#if url}
        <audio src={url} controls preload="none"></audio>
      {:else if failed}
        <span class="sub">Unavailable</span>
      {:else}
        <span class="sub">Loading… {duration(media.duration)}</span>
      {/if}
    </span>
  </div>
{:else}
  <!-- A document has no URL until it is asked for: see saveMediaToDisk. -->
  <button class="file" onclick={save} disabled={saving} title="Download {media.name || 'file'}">
    <span class="glyph"><Glyph name={saving ? 'file' : 'save'} size={20} /></span>
    <span class="info">
      <span class="name">{media.name || 'File'}</span>
      <span class="sub">
        {saveError ||
          [duration(media.duration), humanSize(media.size), saving ? 'Saving…' : 'Download']
            .filter(Boolean)
            .join(' · ')}
      </span>
    </span>
  </button>
{/if}

<style>
  .frame {
    position: relative;
    width: 100%;
    max-width: 320px;
    max-height: 380px;
    border-radius: 10px;
    overflow: hidden;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    display: grid;
    place-items: center;
  }

  .frame.sticker {
    background: none;
    max-width: 160px;
  }

  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .frame.sticker img {
    object-fit: contain;
  }

  .fallback {
    font-size: 13px;
    opacity: 0.75;
  }

  .play {
    position: absolute;
    left: 8px;
    bottom: 8px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 12px;
  }

  .file {
    display: flex;
    gap: 10px;
    align-items: center;
    color: inherit;
    text-decoration: none;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  button.file:hover .name {
    text-decoration: underline;
  }

  button.file:disabled {
    cursor: default;
  }

  audio {
    height: 34px;
    max-width: 260px;
  }

  .glyph {
    display: grid;
    place-items: center;
    opacity: 0.75;
    font-size: 22px;
  }

  .info {
    display: grid;
    min-width: 0;
  }

  .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    font-size: 12px;
    opacity: 0.7;
  }
</style>
