/*
 * The viewer's video player: the browser's native controls are replaced so
 * the seek bar, speed, quality and picture-in-picture all live in one place
 * (a `<video controls>` cannot offer quality switching at all, since the
 * renditions are separate documents).
 *
 * Ported from svelte/src/lib/components/VideoPlayer.svelte. Three things needed
 * a decision:
 *  - `bind:this` is a `ref` object. The effect that wires the picture-in-picture
 *    events reads that ref rather than a signal, so it takes an empty dependency
 *    list: the ref keeps its identity, and the element is attached before any
 *    effect runs.
 *  - the `$effect` that builds the hover-preview `<video>` reads the `src` *prop*,
 *    so it is a `useEffect` with `src` in its dependency list — `useSignalEffect`
 *    tracks signal reads only and would never re-run for a new source.
 *  - what was a plain `let` (the preview element, its pending seek, `scrubbing`,
 *    `resumeAt`) is a ref: a Preact body runs on every render, so a plain local
 *    would be reset on each pass. Everything the markup reacts to is a signal.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import type {VideoQuality} from '$lib/telegram/viewer';

import './VideoPlayer.css';

interface Props {
  src: string;
  poster?: string;
  qualities?: VideoQuality[];
  activeQuality?: string;
  onquality?: (docId: string) => void;
  autoplay?: boolean;
}

export function VideoPlayer({
  src,
  poster = '',
  qualities = [],
  activeQuality = '',
  onquality,
  autoplay = true
}: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const playing = useSignal(false);
  const time = useSignal(0);
  const duration = useSignal(0);
  const buffered = useSignal(0);
  const volume = useSignal(1);
  const muted = useSignal(false);
  const speed = useSignal(1);
  const speedOpen = useSignal(false);
  const qualityOpen = useSignal(false);
  const fullscreen = useSignal(false);
  const pip = useSignal(false);

  /** Hover scrubbing: {x} is where on the bar, {t} which second it maps to. */
  const hover = useSignal<{x: number; t: number} | null>(null);
  const previewVideo = useRef<HTMLVideoElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const previewSeeking = useRef(false);
  const previewPending = useRef<number | null>(null);
  const previewReady = useSignal(false);

  const speeds = [0.5, 1, 1.5, 2];

  const progress = useComputed(() => duration.value ? (time.value / duration.value) * 100 : 0);
  const bufferedPercent = useComputed(() => duration.value ? (buffered.value / duration.value) * 100 : 0);

  /**
   * A second, muted copy of the file feeds the hover thumbnails. The file is
   * already downloaded — this only decodes the frame under the cursor, which
   * is what the official clients show while scrubbing.
   */
  useEffect(() => {
    const url = src;
    previewReady.value = false;
    if(!url) return;

    const element = document.createElement('video');
    element.src = url;
    element.muted = true;
    element.preload = 'metadata';
    element.addEventListener('loadeddata', () => (previewReady.value = true));
    element.addEventListener('seeked', () => {
      previewSeeking.current = false;
      drawPreview();
      if(previewPending.current !== null) {
        const next = previewPending.current;
        previewPending.current = null;
        seekPreview(next);
      }
    });

    previewVideo.current = element;

    return () => {
      element.removeAttribute('src');
      element.load();
      previewVideo.current = null;
    };
  }, [src]);

  function drawPreview() {
    if(!previewCanvas.current || !previewVideo.current) return;
    const context = previewCanvas.current.getContext('2d');
    if(!context) return;
    context.drawImage(previewVideo.current, 0, 0, previewCanvas.current.width, previewCanvas.current.height);
  }

  function seekPreview(seconds: number) {
    if(!previewVideo.current || !previewReady.value) return;
    if(previewSeeking.current) {
      previewPending.current = seconds;
      return;
    }
    previewSeeking.current = true;
    previewVideo.current.currentTime = seconds;
  }

  function toggle() {
    if(!video.current) return;
    if(video.current.paused) video.current.play().catch(() => {});
    else video.current.pause();
  }

  function onTimeUpdate() {
    if(!video.current) return;
    time.value = video.current.currentTime;
    const ranges = video.current.buffered;
    buffered.value = ranges.length ? ranges.end(ranges.length - 1) : 0;
  }

  function seekTo(fraction: number) {
    if(!video.current || !duration.value) return;
    video.current.currentTime = Math.max(0, Math.min(1, fraction)) * duration.value;
    time.value = video.current.currentTime;
  }

  function barFraction(e: PointerEvent | MouseEvent, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    return rect.width ? (e.clientX - rect.left) / rect.width : 0;
  }

  function onBarMove(e: PointerEvent) {
    const bar = e.currentTarget as HTMLElement;
    const fraction = Math.max(0, Math.min(1, barFraction(e, bar)));
    hover.value = {x: fraction * bar.getBoundingClientRect().width, t: fraction * duration.value};
    seekPreview(fraction * duration.value);
  }

  const scrubbing = useRef(false);

  function onBarDown(e: PointerEvent) {
    const bar = e.currentTarget as HTMLElement;
    bar.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    seekTo(barFraction(e, bar));
  }

  function onBarDrag(e: PointerEvent) {
    onBarMove(e);
    if(scrubbing.current) seekTo(barFraction(e, e.currentTarget as HTMLElement));
  }

  function onBarUp(e: PointerEvent) {
    scrubbing.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  function setSpeed(value: number) {
    speed.value = value;
    if(video.current) video.current.playbackRate = value;
    speedOpen.value = false;
  }

  function setVolume(value: number) {
    volume.value = value;
    muted.value = value === 0;
    if(video.current) {
      video.current.volume = value;
      video.current.muted = muted.value;
    }
  }

  function toggleMute() {
    muted.value = !muted.value;
    if(video.current) video.current.muted = muted.value;
  }

  async function togglePip() {
    if(!video.current) return;
    try {
      if(document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.current.requestPictureInPicture();
    } catch (err) {
      // Firefox exposes PiP only through its own button; nothing to do here.
    }
  }

  async function toggleFullscreen() {
    if(!wrapper.current) return;
    try {
      if(document.fullscreenElement) await document.exitFullscreen();
      else await wrapper.current.requestFullscreen();
    } catch (err) {
      // A denied fullscreen request is not worth surfacing.
    }
  }

  useEffect(() => {
    const onChange = () => (fullscreen.value = !!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // The picture-in-picture events are not in the element typings, so they are
  // wired by hand rather than as attributes.
  useEffect(() => {
    const element = video.current;
    if(!element) return;

    const enter = () => (pip.value = true);
    const leave = () => (pip.value = false);
    element.addEventListener('enterpictureinpicture', enter);
    element.addEventListener('leavepictureinpicture', leave);

    return () => {
      element.removeEventListener('enterpictureinpicture', enter);
      element.removeEventListener('leavepictureinpicture', leave);
    };
  }, []);

  /**
   * Switching quality swaps the source document, so the new file has to resume
   * where the old one stopped rather than restarting.
   */
  const resumeAt = useRef(0);

  function pickQuality(docId: string) {
    qualityOpen.value = false;
    if(docId === activeQuality) return;
    resumeAt.current = time.value;
    onquality?.(docId);
  }

  function onLoaded() {
    if(!video.current) return;
    duration.value = video.current.duration || 0;
    video.current.playbackRate = speed.value;
    video.current.volume = volume.value;
    video.current.muted = muted.value;
    if(resumeAt.current) {
      video.current.currentTime = Math.min(resumeAt.current, duration.value || resumeAt.current);
      resumeAt.current = 0;
      video.current.play().catch(() => {});
    }
  }

  function label(seconds: number) {
    if(!Number.isFinite(seconds) || seconds < 0) return '0:00';
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
    if(e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    } else if(e.key === 'm') {
      toggleMute();
    } else if(e.key === 'f') {
      toggleFullscreen();
    }
  }

  // No caption track is rendered — the original carried the equivalent
  // svelte-ignore a11y_media_has_caption for the same reason.
  return (
    <div class="video-player" ref={wrapper} onKeyDown={onKey} role="group" tabIndex={-1}>
      <video
        ref={video}
        src={src}
        poster={poster || undefined}
        autoplay={autoplay}
        playsinline
        onClick={toggle}
        onPlay={() => (playing.value = true)}
        onPause={() => (playing.value = false)}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoaded}
      ></video>

      <div class="controls">
        <div
          class="bar"
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration.value)}
          aria-valuenow={Math.round(time.value)}
          onPointerDown={onBarDown}
          onPointerMove={onBarDrag}
          onPointerUp={onBarUp}
          onPointerLeave={() => (hover.value = null)}
          onKeyDown={(e) => {
            if(e.key === 'ArrowRight') seekTo((time.value + 5) / (duration.value || 1));
            else if(e.key === 'ArrowLeft') seekTo((time.value - 5) / (duration.value || 1));
          }}
        >
          <span class="track"></span>
          <span class="buffered" style={{width: `${bufferedPercent.value}%`}}></span>
          <span class="fill" style={{width: `${progress.value}%`}}></span>
          <span class="knob" style={{left: `${progress.value}%`}}></span>

          {hover.value && (
            <div class="preview" style={{left: `${hover.value.x}px`}}>
              {previewReady.value && <canvas ref={previewCanvas} width="144" height="81"></canvas>}
              <span>{label(hover.value.t)}</span>
            </div>
          )}
        </div>

        <div class="row">
          <button class="icon" onClick={toggle} aria-label={playing.value ? 'Pause' : 'Play'}>
            {playing.value ?
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z" /></svg> :
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l10 6-10 6V4z" /></svg>}
          </button>

          <span class="time">{label(time.value)} / {label(duration.value)}</span>

          <span class="spacer"></span>

          <div class="volume">
            <button class="icon" onClick={toggleMute} aria-label={muted.value ? 'Unmute' : 'Mute'}>
              {muted.value || !volume.value ?
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4V8z" /><path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" stroke-width="1.5" fill="none" /></svg> :
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4V8z" /><path d="M13.5 7.5a3.5 3.5 0 010 5M15.5 5.5a6 6 0 010 9" stroke="currentColor" stroke-width="1.5" fill="none" /></svg>}
            </button>
            <input
              class="volume-range"
              type="range"
              min="0"
              max="100"
              value={muted.value ? 0 : volume.value * 100}
              onInput={(e) => setVolume(Number((e.currentTarget as HTMLInputElement).value) / 100)}
              aria-label="Volume"
            />
          </div>

          <div class="menu-holder">
            <button class="chip" onClick={() => (speedOpen.value = !speedOpen.value)} aria-label="Playback speed">
              {speed.value}×
            </button>
            {speedOpen.value && (
              <div class="menu">
                {speeds.map((value) => (
                  <button
                    key={value}
                    class={['menu-item', value === speed.value && 'on'].filter(Boolean).join(' ')}
                    onClick={() => setSpeed(value)}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            )}
          </div>

          {qualities.length > 1 && (
            <div class="menu-holder">
              <button class="chip" onClick={() => (qualityOpen.value = !qualityOpen.value)} aria-label="Quality">
                {qualities.find((q) => q.docId === activeQuality)?.label ?? 'Auto'}
              </button>
              {qualityOpen.value && (
                <div class="menu">
                  {qualities.map((quality) => (
                    <button
                      key={quality.docId || 'main'}
                      class={['menu-item', quality.docId === activeQuality && 'on'].filter(Boolean).join(' ')}
                      onClick={() => pickQuality(quality.docId)}
                    >
                      {quality.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button class={['icon', pip.value && 'on'].filter(Boolean).join(' ')} onClick={togglePip} aria-label="Picture in picture">
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2.5" y="4" width="15" height="12" rx="2" />
              <rect x="10" y="9.5" width="6" height="5" rx="1" fill="currentColor" stroke="none" />
            </svg>
          </button>

          <button class="icon" onClick={toggleFullscreen} aria-label="Fullscreen">
            {fullscreen.value ?
              <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M8 3v5H3M12 17v-5h5" />
              </svg> :
              <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M3 7.5V3h4.5M17 12.5V17h-4.5M17 7.5V3h-4.5M3 12.5V17h4.5" />
              </svg>}
          </button>
        </div>
      </div>
    </div>
  );
}
