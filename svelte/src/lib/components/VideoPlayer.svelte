<script lang="ts">
  import type {VideoQuality} from '$lib/telegram/viewer';

  /**
   * The viewer's video player: the browser's native controls are replaced so
   * the seek bar, speed, quality and picture-in-picture all live in one place
   * (a `<video controls>` cannot offer quality switching at all, since the
   * renditions are separate documents).
   */
  let {
    src,
    poster = '',
    qualities = [],
    activeQuality = '',
    onquality,
    autoplay = true
  }: {
    src: string;
    poster?: string;
    qualities?: VideoQuality[];
    activeQuality?: string;
    onquality?: (docId: string) => void;
    autoplay?: boolean;
  } = $props();

  let video = $state<HTMLVideoElement | null>(null);
  let wrapper = $state<HTMLDivElement | null>(null);
  let playing = $state(false);
  let time = $state(0);
  let duration = $state(0);
  let buffered = $state(0);
  let volume = $state(1);
  let muted = $state(false);
  let speed = $state(1);
  let speedOpen = $state(false);
  let qualityOpen = $state(false);
  let fullscreen = $state(false);
  let pip = $state(false);

  /** Hover scrubbing: {x} is where on the bar, {t} which second it maps to. */
  let hover = $state<{x: number; t: number} | null>(null);
  let previewVideo: HTMLVideoElement | null = null;
  let previewCanvas = $state<HTMLCanvasElement | null>(null);
  let previewSeeking = false;
  let previewPending: number | null = null;
  let previewReady = $state(false);

  const speeds = [0.5, 1, 1.5, 2];

  const progress = $derived(duration ? (time / duration) * 100 : 0);
  const bufferedPercent = $derived(duration ? (buffered / duration) * 100 : 0);

  /**
   * A second, muted copy of the file feeds the hover thumbnails. The file is
   * already downloaded — this only decodes the frame under the cursor, which
   * is what the official clients show while scrubbing.
   */
  $effect(() => {
    const url = src;
    previewReady = false;
    if (!url) return;

    const element = document.createElement('video');
    element.src = url;
    element.muted = true;
    element.preload = 'metadata';
    element.addEventListener('loadeddata', () => (previewReady = true));
    element.addEventListener('seeked', () => {
      previewSeeking = false;
      drawPreview();
      if (previewPending !== null) {
        const next = previewPending;
        previewPending = null;
        seekPreview(next);
      }
    });

    previewVideo = element;

    return () => {
      element.removeAttribute('src');
      element.load();
      previewVideo = null;
    };
  });

  function drawPreview() {
    if (!previewCanvas || !previewVideo) return;
    const context = previewCanvas.getContext('2d');
    if (!context) return;
    context.drawImage(previewVideo, 0, 0, previewCanvas.width, previewCanvas.height);
  }

  function seekPreview(seconds: number) {
    if (!previewVideo || !previewReady) return;
    if (previewSeeking) {
      previewPending = seconds;
      return;
    }
    previewSeeking = true;
    previewVideo.currentTime = seconds;
  }

  function toggle() {
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function onTimeUpdate() {
    if (!video) return;
    time = video.currentTime;
    const ranges = video.buffered;
    buffered = ranges.length ? ranges.end(ranges.length - 1) : 0;
  }

  function seekTo(fraction: number) {
    if (!video || !duration) return;
    video.currentTime = Math.max(0, Math.min(1, fraction)) * duration;
    time = video.currentTime;
  }

  function barFraction(e: PointerEvent | MouseEvent, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    return rect.width ? (e.clientX - rect.left) / rect.width : 0;
  }

  function onBarMove(e: PointerEvent) {
    const bar = e.currentTarget as HTMLElement;
    const fraction = Math.max(0, Math.min(1, barFraction(e, bar)));
    hover = {x: fraction * bar.getBoundingClientRect().width, t: fraction * duration};
    seekPreview(fraction * duration);
  }

  let scrubbing = false;

  function onBarDown(e: PointerEvent) {
    const bar = e.currentTarget as HTMLElement;
    bar.setPointerCapture(e.pointerId);
    scrubbing = true;
    seekTo(barFraction(e, bar));
  }

  function onBarDrag(e: PointerEvent) {
    onBarMove(e);
    if (scrubbing) seekTo(barFraction(e, e.currentTarget as HTMLElement));
  }

  function onBarUp(e: PointerEvent) {
    scrubbing = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  function setSpeed(value: number) {
    speed = value;
    if (video) video.playbackRate = value;
    speedOpen = false;
  }

  function setVolume(value: number) {
    volume = value;
    muted = value === 0;
    if (video) {
      video.volume = value;
      video.muted = muted;
    }
  }

  function toggleMute() {
    muted = !muted;
    if (video) video.muted = muted;
  }

  async function togglePip() {
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (err) {
      // Firefox exposes PiP only through its own button; nothing to do here.
    }
  }

  async function toggleFullscreen() {
    if (!wrapper) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapper.requestFullscreen();
    } catch (err) {
      // A denied fullscreen request is not worth surfacing.
    }
  }

  $effect(() => {
    const onChange = () => (fullscreen = !!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  });

  // The picture-in-picture events are not in Svelte's element typings, so they
  // are wired by hand rather than as attributes.
  $effect(() => {
    const element = video;
    if (!element) return;

    const enter = () => (pip = true);
    const leave = () => (pip = false);
    element.addEventListener('enterpictureinpicture', enter);
    element.addEventListener('leavepictureinpicture', leave);

    return () => {
      element.removeEventListener('enterpictureinpicture', enter);
      element.removeEventListener('leavepictureinpicture', leave);
    };
  });

  /**
   * Switching quality swaps the source document, so the new file has to resume
   * where the old one stopped rather than restarting.
   */
  let resumeAt = 0;

  function pickQuality(docId: string) {
    qualityOpen = false;
    if (docId === activeQuality) return;
    resumeAt = time;
    onquality?.(docId);
  }

  function onLoaded() {
    if (!video) return;
    duration = video.duration || 0;
    video.playbackRate = speed;
    video.volume = volume;
    video.muted = muted;
    if (resumeAt) {
      video.currentTime = Math.min(resumeAt, duration || resumeAt);
      resumeAt = 0;
      video.play().catch(() => {});
    }
  }

  function label(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Keys the player owns while it has focus; the viewer keeps the rest. */
  function onKey(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    } else if (e.key === 'm') {
      toggleMute();
    } else if (e.key === 'f') {
      toggleFullscreen();
    }
  }
</script>

<!-- svelte-ignore a11y_media_has_caption -->
<div class="video-player" bind:this={wrapper} onkeydown={onKey} role="group" tabindex="-1">
  <video
    bind:this={video}
    {src}
    poster={poster || undefined}
    autoplay={autoplay}
    playsinline
    onclick={toggle}
    onplay={() => (playing = true)}
    onpause={() => (playing = false)}
    ontimeupdate={onTimeUpdate}
    onloadedmetadata={onLoaded}
  ></video>

  <div class="controls">
    <div
      class="bar"
      role="slider"
      tabindex="0"
      aria-label="Seek"
      aria-valuemin="0"
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      onpointerdown={onBarDown}
      onpointermove={onBarDrag}
      onpointerup={onBarUp}
      onpointerleave={() => (hover = null)}
      onkeydown={(e) => {
        if (e.key === 'ArrowRight') seekTo((time + 5) / (duration || 1));
        else if (e.key === 'ArrowLeft') seekTo((time - 5) / (duration || 1));
      }}
    >
      <span class="track"></span>
      <span class="buffered" style="width: {bufferedPercent}%"></span>
      <span class="fill" style="width: {progress}%"></span>
      <span class="knob" style="left: {progress}%"></span>

      {#if hover}
        <div class="preview" style="left: {hover.x}px">
          {#if previewReady}
            <canvas bind:this={previewCanvas} width="144" height="81"></canvas>
          {/if}
          <span>{label(hover.t)}</span>
        </div>
      {/if}
    </div>

    <div class="row">
      <button class="icon" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {#if playing}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z" /></svg>
        {:else}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l10 6-10 6V4z" /></svg>
        {/if}
      </button>

      <span class="time">{label(time)} / {label(duration)}</span>

      <span class="spacer"></span>

      <div class="volume">
        <button class="icon" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
          {#if muted || !volume}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4V8z" /><path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" stroke-width="1.5" fill="none" /></svg>
          {:else}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4V8z" /><path d="M13.5 7.5a3.5 3.5 0 010 5M15.5 5.5a6 6 0 010 9" stroke="currentColor" stroke-width="1.5" fill="none" /></svg>
          {/if}
        </button>
        <input
          class="volume-range"
          type="range"
          min="0"
          max="100"
          value={muted ? 0 : volume * 100}
          oninput={(e) => setVolume(Number((e.currentTarget as HTMLInputElement).value) / 100)}
          aria-label="Volume"
        />
      </div>

      <div class="menu-holder">
        <button class="chip" onclick={() => (speedOpen = !speedOpen)} aria-label="Playback speed">
          {speed}×
        </button>
        {#if speedOpen}
          <div class="menu">
            {#each speeds as value (value)}
              <button class="menu-item" class:on={value === speed} onclick={() => setSpeed(value)}>
                {value}×
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if qualities.length > 1}
        <div class="menu-holder">
          <button class="chip" onclick={() => (qualityOpen = !qualityOpen)} aria-label="Quality">
            {qualities.find((q) => q.docId === activeQuality)?.label ?? 'Auto'}
          </button>
          {#if qualityOpen}
            <div class="menu">
              {#each qualities as quality (quality.docId || 'main')}
                <button
                  class="menu-item"
                  class:on={quality.docId === activeQuality}
                  onclick={() => pickQuality(quality.docId)}
                >
                  {quality.label}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <button class="icon" class:on={pip} onclick={togglePip} aria-label="Picture in picture">
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2.5" y="4" width="15" height="12" rx="2" />
          <rect x="10" y="9.5" width="6" height="5" rx="1" fill="currentColor" stroke="none" />
        </svg>
      </button>

      <button class="icon" onclick={toggleFullscreen} aria-label="Fullscreen">
        {#if fullscreen}
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M8 3v5H3M12 17v-5h5" />
          </svg>
        {:else}
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7.5V3h4.5M17 12.5V17h-4.5M17 7.5V3h-4.5M3 12.5V17h4.5" />
          </svg>
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  .video-player {
    position: relative;
    display: grid;
    place-items: center;
    max-width: 92vw;
    max-height: 86vh;
    background: #000;
  }

  video {
    max-width: 92vw;
    max-height: 86vh;
    object-fit: contain;
    display: block;
  }

  .controls {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 18px 12px 8px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent);
    color: #fff;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .video-player:hover .controls,
  .video-player:focus-within .controls {
    opacity: 1;
  }

  .bar {
    position: relative;
    height: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
  }

  .track,
  .buffered,
  .fill {
    position: absolute;
    height: 4px;
    border-radius: 999px;
    pointer-events: none;
  }

  .track {
    left: 0;
    right: 0;
    background: rgba(255, 255, 255, 0.25);
  }

  .buffered {
    left: 0;
    background: rgba(255, 255, 255, 0.4);
  }

  .fill {
    left: 0;
    background: var(--accent, #3390ec);
  }

  .knob {
    position: absolute;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #fff;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .preview {
    position: absolute;
    bottom: 22px;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.85);
    border-radius: 6px;
    padding: 4px;
    display: grid;
    gap: 2px;
    justify-items: center;
    pointer-events: none;
  }

  .preview canvas {
    display: block;
    border-radius: 4px;
  }

  .preview span {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }

  .spacer {
    flex: 1;
  }

  .time {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #fff;
    cursor: pointer;
    padding: 0;
  }

  .icon svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }

  .icon:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .icon.on {
    color: var(--accent, #3390ec);
  }

  .volume {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .volume-range {
    width: 64px;
    accent-color: var(--accent, #3390ec);
    cursor: pointer;
  }

  .chip {
    border: none;
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
    border-radius: 999px;
    font-size: 12px;
    padding: 3px 8px;
    cursor: pointer;
  }

  .menu-holder {
    position: relative;
  }

  .menu {
    position: absolute;
    bottom: 30px;
    right: 0;
    background: rgba(0, 0, 0, 0.9);
    border-radius: 8px;
    padding: 4px;
    display: grid;
    min-width: 74px;
  }

  .menu-item {
    border: none;
    background: transparent;
    color: #fff;
    font-size: 12px;
    padding: 5px 8px;
    text-align: left;
    border-radius: 5px;
    cursor: pointer;
  }

  .menu-item:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  .menu-item.on {
    color: var(--accent, #3390ec);
  }

  @media (max-width: 600px) {
    .volume-range {
      display: none;
    }
  }
</style>
