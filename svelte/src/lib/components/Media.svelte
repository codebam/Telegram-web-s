<script lang="ts">
  import Glyph from './Glyph.svelte';
  import {
    invalidateMediaUrl,
    loadMediaUrl,
    readMediaContents,
    saveMediaToDisk,
    type MediaItem
  } from '$lib/telegram/chats';
  import {staleUrlRetry} from '$lib/telegram/staleUrl';
  import {decodeWaveform} from '$lib/telegram/voice';

  let {
    peerId,
    mid,
    media,
    fill = false
  }: {
    peerId: number;
    mid: number;
    media: MediaItem;
    /**
     * Stretch to the tile the caller sized, instead of reserving the media's
     * own aspect ratio. Album tiles are laid out by the grid, not by the photo.
     */
    fill?: boolean;
  } = $props();

  let url = $state<string | null>(null);
  let failed = $state(false);

  // A round video note plays inline, so it needs the file itself rather than
  // the poster frame a rectangular video gets in a bubble.
  const wantsFullFile = $derived(media.kind === 'round');

  /**
   * Spoilered media stays covered until it is clicked, the same as the official
   * clients. Reset per message so paging the list never uncovers the next one.
   */
  let revealed = $state(false);
  const hidden = $derived(media.spoiler && !revealed);

  function reveal(e: MouseEvent) {
    if (!hidden) return;
    // Swallow the click that uncovers it — otherwise the same tap also opens
    // the lightbox on the media it was meant to keep hidden.
    e.stopPropagation();
    e.preventDefault();
    revealed = true;
  }

  const retry = staleUrlRetry();

  function resolve() {
    const key = `${peerId}_${mid}`;
    loadMediaUrl(peerId, mid, 480, wantsFullFile).then((resolved) => {
      if(key !== `${peerId}_${mid}`) return;
      url = resolved;
      failed = !resolved;
    }).catch(() => (failed = true));
  }

  $effect(() => {
    url = null;
    failed = false;
    // A recycled component must never carry the previous message's reveal.
    revealed = false;
    retry.reset();
    resolve();
  });

  /**
   * The URL went stale — the worker's LRU evicted it and revoked it out from
   * under the element. Forget it and download again.
   */
  function reload() {
    if(!retry.shouldRetry()) {
      url = null;
      failed = true;
      return;
    }

    invalidateMediaUrl(peerId, mid);
    url = null;
    resolve();
  }

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

  /**
   * Playing an unheard voice message owes the sender a receipt — the official
   * clients send it on play, and only once.
   */
  let reportedRead = false;

  function onPlay() {
    if(reportedRead || !media.unread) return;
    reportedRead = true;
    readMediaContents(peerId, [mid]).catch(() => {});
  }

  function duration(seconds: number) {
    if(!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /* ---------- round video note ---------- */

  let roundVideo: HTMLVideoElement | undefined = $state();
  let roundMuted = $state(true);

  function toggleRoundSound() {
    roundMuted = !roundMuted;
    // Unmuting mid-loop should restart the note, otherwise the first thing you
    // hear is the middle of a sentence.
    if (!roundMuted && roundVideo) {
      roundVideo.currentTime = 0;
      roundVideo.play().catch(() => {});
    }
  }

  /* ---------- voice / audio player ---------- */

  /**
   * The 100 five-bit samples the sender recorded. Music has no waveform, and an
   * old client may omit it on a voice note — a flat bar set still gives a
   * scrubber to drag, so the control never degrades into nothing.
   */
  const FALLBACK_BARS = 48;
  const bars = $derived.by(() => {
    const decoded = decodeWaveform(media.waveform);
    if (decoded.length) return decoded.map((value) => Math.max(0.08, value / 31));
    return Array.from({length: FALLBACK_BARS}, () => 0.25);
  });

  let audio: HTMLAudioElement | undefined = $state();
  let playing = $state(false);
  let position = $state(0);
  let speed = $state(1);

  // Opus streams often report `Infinity` until fully buffered, so the
  // attribute's duration is the reliable one; the element's is a fallback.
  let loadedDuration = $state(0);
  const total = $derived(media.duration || loadedDuration);
  const progress = $derived(total ? Math.min(1, position / total) : 0);

  function togglePlay() {
    if (!audio) return;
    if (audio.paused) {
      audio.playbackRate = speed;
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }

  function cycleSpeed() {
    speed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    if (audio) audio.playbackRate = speed;
  }

  function seek(e: MouseEvent) {
    if (!audio) return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seconds = (audio.duration || media.duration || 0) * ratio;
    if (Number.isFinite(seconds)) {
      audio.currentTime = seconds;
      position = seconds;
    }
  }
</script>

{#if media.kind === 'photo' || media.kind === 'video' || media.kind === 'gif' || media.kind === 'sticker'}
  <div
    class="frame"
    class:sticker={media.kind === 'sticker'}
    class:fill
    class:hidden
    style={fill ? '' : `aspect-ratio: ${ratio}`}
  >
    {#if url && media.kind === 'gif' && !hidden}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video src={url} autoplay loop muted playsinline onerror={reload}></video>
      <span class="play">GIF</span>
    {:else if url}
      <img src={url} alt={media.kind} onerror={reload} />
      {#if media.kind === 'video' && !hidden}
        <span class="play">▶ {duration(media.duration)}</span>
      {/if}
    {:else if failed}
      <span class="fallback">{media.kind === 'video' ? '🎬 Video' : '📷 Photo'}</span>
    {:else}
      <span class="fallback">Loading…</span>
    {/if}

    {#if hidden}
      <button class="spoiler" onclick={reveal} aria-label="Show hidden media">
        <span class="dots" aria-hidden="true"></span>
        <span class="spoiler-label">Spoiler</span>
      </button>
    {/if}
  </div>
{:else if media.kind === 'round'}
  <!-- A video note plays on sight, muted, and unmutes on a click — the same
       affordance the official clients give it. -->
  <button
    class="round"
    onclick={toggleRoundSound}
    aria-label={roundMuted ? 'Unmute video message' : 'Mute video message'}
  >
    {#if url}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={roundVideo}
        src={url}
        autoplay
        loop
        muted={roundMuted}
        playsinline
        onplay={onPlay}
        onerror={reload}
      ></video>
      <span class="round-badge">{roundMuted ? '🔇' : '🔊'} {duration(media.duration)}</span>
    {:else if failed}
      <span class="fallback">📹</span>
    {:else}
      <span class="fallback">…</span>
    {/if}
  </button>
{:else if media.kind === 'voice' || media.kind === 'audio'}
  <div class="player">
    <button
      class="play-btn"
      onclick={togglePlay}
      disabled={!url}
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {#if playing}
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <rect x="5.5" y="4" width="3.4" height="12" rx="1" />
          <rect x="11.1" y="4" width="3.4" height="12" rx="1" />
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M6.5 4.2l9 5.8-9 5.8V4.2z" />
        </svg>
      {/if}
    </button>

    <span class="track">
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <span class="wave" onclick={seek} title="Seek">
        {#each bars as bar, i}
          <span
            class="bar"
            class:played={bars.length ? i / bars.length < progress : false}
            style="height: {Math.round(bar * 100)}%"
          ></span>
        {/each}
      </span>
      <span class="sub">
        {#if failed}
          Unavailable
        {:else}
          {duration(position || 0) || '0:00'} / {duration(total) || '—'}
          {#if media.unread}· new{/if}
        {/if}
      </span>
    </span>

    <button class="speed" onclick={cycleSpeed} disabled={!url} aria-label="Playback speed">
      {speed}x
    </button>

    {#if url}
      <audio
        bind:this={audio}
        src={url}
        preload="metadata"
        onplay={() => { playing = true; onPlay(); }}
        onpause={() => (playing = false)}
        onended={() => { playing = false; position = 0; }}
        ontimeupdate={() => (position = audio?.currentTime ?? 0)}
        ondurationchange={() => {
          const value = audio?.duration ?? 0;
          if (Number.isFinite(value)) loadedDuration = value;
        }}
      ></audio>
    {/if}
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

  /* Album tiles are sized by the grid, so the media fills whatever it is
     given instead of reserving its own aspect ratio. */
  .frame.fill {
    max-width: none;
    max-height: none;
    height: 100%;
    border-radius: 0;
  }

  .frame.hidden img,
  .frame.hidden video {
    filter: blur(18px);
    transform: scale(1.15);
  }

  .spoiler {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border: none;
    padding: 0;
    background: rgba(0, 0, 0, 0.25);
    cursor: pointer;
  }

  /* Two offset dot grids drifting past each other stand in for the particle
     field the official clients animate over a spoiler. */
  .dots {
    position: absolute;
    inset: -8px;
    background-image:
      radial-gradient(rgba(255, 255, 255, 0.9) 1px, transparent 1px),
      radial-gradient(rgba(255, 255, 255, 0.55) 1px, transparent 1px);
    background-size: 7px 7px, 11px 11px;
    animation: spoiler-drift 6s linear infinite;
  }

  .spoiler-label {
    position: relative;
    padding: 3px 10px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
  }

  @keyframes spoiler-drift {
    from {
      background-position: 0 0, 0 0;
    }
    to {
      background-position: 21px 14px, -22px 11px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dots {
      animation: none;
    }
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
    display: none;
  }

  .player {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 220px;
    max-width: 280px;
  }

  .play-btn {
    width: 34px;
    height: 34px;
    flex: none;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--action);
    color: var(--action-ink);
    cursor: pointer;
    display: grid;
    place-items: center;
  }

  .play-btn:disabled,
  .speed:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .track {
    display: grid;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .wave {
    display: flex;
    align-items: center;
    gap: 1px;
    height: 24px;
    cursor: pointer;
  }

  .bar {
    flex: 1;
    min-width: 1px;
    border-radius: 1px;
    background: color-mix(in srgb, currentColor 35%, transparent);
  }

  .bar.played {
    background: var(--action, currentColor);
  }

  .speed {
    flex: none;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .round {
    position: relative;
    width: 200px;
    height: 200px;
    max-width: 60vw;
    max-height: 60vw;
    padding: 0;
    border: none;
    border-radius: 50%;
    overflow: hidden;
    background: color-mix(in srgb, var(--text) 8%, transparent);
    display: grid;
    place-items: center;
    cursor: pointer;
  }

  .round video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .round-badge {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    padding: 1px 8px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 11px;
    white-space: nowrap;
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
