/*
 * Ported from svelte/src/lib/components/Media.svelte.
 *
 * This is the component that decides what a message's document is — a photo, a
 * video, a GIF, a sticker, a round video note, a voice note, an audio track or a
 * plain file — and every branch resolves its own URL lazily.
 *
 * Details of the port:
 *  - `retry` sat in the component body, which Svelte ran once per instance. A
 *    Preact body runs on every render, so it is memoised; a fresh retry budget on
 *    each pass would defeat the bound it exists to enforce.
 *  - the load `$effect` reads props (`peerId`, `mid`, `media`) and no signal, so
 *    it is a `useEffect` with those in its dependency list. `useSignalEffect`
 *    tracks signal reads only and would never re-run.
 *  - Svelte read `peerId`/`mid` inside the async callback and always saw the
 *    current message; a closure in JSX would see the values from the render that
 *    started the load, so the latest pair is kept in refs.
 *  - `reportedRead` is a plain flag rather than a signal, so it lives in a ref: a
 *    local variable would be reset by the next render and the read receipt would
 *    go out on every play.
 *  - `roundVideo` and `audio` are only ever read from handlers, never by the
 *    markup, so they are plain refs and their reads gained `.current`.
 *  - `total` and `progress` are recomputed in the body instead of being held in a
 *    `useComputed`: `total` reads the `media` prop, which a computed does not
 *    track and would therefore never see change.
 */
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Glyph} from './Glyph';
import {
  invalidateMediaUrl,
  loadMediaUrl,
  readMediaContents,
  saveMediaToDisk,
  type MediaItem
} from '$lib/telegram/chats';
import {staleUrlRetry} from '$lib/telegram/staleUrl';
import {decodeWaveform} from '$lib/telegram/voice';

import './Media.css';

interface Props {
  peerId: number;
  mid: number;
  media: MediaItem;
  /**
   * Stretch to the tile the caller sized, instead of reserving the media's
   * own aspect ratio. Album tiles are laid out by the grid, not by the photo.
   */
  fill?: boolean;
}

export function Media({peerId, mid, media, fill = false}: Props) {
  const url = useSignal<string | null>(null);
  const failed = useSignal(false);

  // A round video note plays inline, so it needs the file itself rather than
  // the poster frame a rectangular video gets in a bubble.
  const wantsFullFile = media.kind === 'round';

  /**
   * Spoilered media stays covered until it is clicked, the same as the official
   * clients. Reset per message so paging the list never uncovers the next one.
   */
  const revealed = useSignal(false);
  const hidden = media.spoiler && !revealed.value;

  function reveal(e: MouseEvent) {
    if(!hidden) return;
    // Swallow the click that uncovers it — otherwise the same tap also opens
    // the lightbox on the media it was meant to keep hidden.
    e.stopPropagation();
    e.preventDefault();
    revealed.value = true;
  }

  const retry = useMemo(() => staleUrlRetry(), []);

  // Svelte read the current `peerId`/`mid` when the load resolved; a closure in
  // JSX would compare against the render that started it, so the latest pair is
  // kept in refs.
  const currentPeerId = useRef(peerId);
  currentPeerId.current = peerId;
  const currentMid = useRef(mid);
  currentMid.current = mid;

  function resolve() {
    const key = `${peerId}_${mid}`;
    loadMediaUrl(peerId, mid, 480, wantsFullFile).then((resolved) => {
      if(key !== `${currentPeerId.current}_${currentMid.current}`) return;
      url.value = resolved;
      failed.value = !resolved;
    }).catch(() => (failed.value = true));
  }

  // Re-resolve whenever the message changes: a recycled component gets a fresh
  // URL, failure state and reveal.
  useEffect(() => {
    url.value = null;
    failed.value = false;
    // A recycled component must never carry the previous message's reveal.
    revealed.value = false;
    retry.reset();
    resolve();
  }, [peerId, mid, media]);

  /**
   * The URL went stale — the worker's LRU evicted it and revoked it out from
   * under the element. Forget it and download again.
   */
  function reload() {
    if(!retry.shouldRetry()) {
      url.value = null;
      failed.value = true;
      return;
    }

    invalidateMediaUrl(peerId, mid);
    url.value = null;
    resolve();
  }

  // Keep the bubble from collapsing then jumping once the image decodes:
  // reserve the real aspect ratio up front, capped to the bubble width.
  const ratio = media.width && media.height ? media.width / media.height : 4 / 3;

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

  const saving = useSignal(false);
  const saveError = useSignal('');

  async function save() {
    if(saving.value) return;
    saving.value = true;
    saveError.value = '';
    try {
      await saveMediaToDisk(peerId, mid);
    } catch(err: any) {
      saveError.value = err?.type || err?.message || 'Download failed';
    } finally {
      saving.value = false;
    }
  }

  /**
   * Playing an unheard voice message owes the sender a receipt — the official
   * clients send it on play, and only once.
   */
  const reportedRead = useRef(false);

  function onPlay() {
    if(reportedRead.current || !media.unread) return;
    reportedRead.current = true;
    readMediaContents(peerId, [mid]).catch(() => {});
  }

  function duration(seconds: number) {
    if(!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /* ---------- round video note ---------- */

  const roundVideo = useRef<HTMLVideoElement>(null);
  const roundMuted = useSignal(true);

  function toggleRoundSound() {
    roundMuted.value = !roundMuted.value;
    // Unmuting mid-loop should restart the note, otherwise the first thing you
    // hear is the middle of a sentence.
    if(!roundMuted.value && roundVideo.current) {
      roundVideo.current.currentTime = 0;
      roundVideo.current.play().catch(() => {});
    }
  }

  /* ---------- voice / audio player ---------- */

  /**
   * The 100 five-bit samples the sender recorded. Music has no waveform, and an
   * old client may omit it on a voice note — a flat bar set still gives a
   * scrubber to drag, so the control never degrades into nothing.
   */
  const FALLBACK_BARS = 48;
  const bars = useMemo(() => {
    const decoded = decodeWaveform(media.waveform);
    if(decoded.length) return decoded.map((value) => Math.max(0.08, value / 31));
    return Array.from({length: FALLBACK_BARS}, () => 0.25);
  }, [media]);

  const audio = useRef<HTMLAudioElement>(null);
  const playing = useSignal(false);
  const position = useSignal(0);
  const speed = useSignal(1);

  // Opus streams often report `Infinity` until fully buffered, so the
  // attribute's duration is the reliable one; the element's is a fallback.
  const loadedDuration = useSignal(0);
  const total = media.duration || loadedDuration.value;
  const progress = total ? Math.min(1, position.value / total) : 0;

  function togglePlay() {
    if(!audio.current) return;
    if(audio.current.paused) {
      audio.current.playbackRate = speed.value;
      audio.current.play().catch(() => {});
    } else {
      audio.current.pause();
    }
  }

  function cycleSpeed() {
    speed.value = speed.value === 1 ? 1.5 : speed.value === 1.5 ? 2 : 1;
    if(audio.current) audio.current.playbackRate = speed.value;
  }

  function seek(e: MouseEvent) {
    if(!audio.current) return;
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if(!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seconds = (audio.current.duration || media.duration || 0) * ratio;
    if(Number.isFinite(seconds)) {
      audio.current.currentTime = seconds;
      position.value = seconds;
    }
  }

  // The `{#if} {:else if} … {:else}` chain that picked the body by media kind,
  // resolved before the single return.
  let body: preact.JSX.Element;

  if(media.kind === 'photo' || media.kind === 'video' || media.kind === 'gif' || media.kind === 'sticker') {
    body = (
      <div
        class={['frame', media.kind === 'sticker' && 'sticker', fill && 'fill', hidden && 'hidden'].filter(Boolean).join(' ')}
        style={fill ? '' : `aspect-ratio: ${ratio}`}
      >
        {url.value && media.kind === 'gif' && !hidden ?
          <>
            {/* No caption track is rendered — the original carried the equivalent
                svelte-ignore a11y_media_has_caption for the same reason. */}
            <video src={url.value} autoplay loop muted playsinline onError={reload}></video>
            <span class="play">GIF</span>
          </> :
          url.value ?
            <>
              <img src={url.value} alt={media.kind} onError={reload} />
              {media.kind === 'video' && !hidden && (
                <span class="play">▶ {duration(media.duration)}</span>
              )}
            </> :
            failed.value ?
              <span class="fallback">{media.kind === 'video' ? '🎬 Video' : '📷 Photo'}</span> :
              <span class="fallback">Loading…</span>}

        {hidden && (
          <button class="spoiler" onClick={reveal} aria-label="Show hidden media">
            <span class="dots" aria-hidden="true"></span>
            <span class="spoiler-label">Spoiler</span>
          </button>
        )}
      </div>
    );
  } else if(media.kind === 'round') {
    /* A video note plays on sight, muted, and unmutes on a click — the same
       affordance the official clients give it. */
    body = (
      <button
        class="round"
        onClick={toggleRoundSound}
        aria-label={roundMuted.value ? 'Unmute video message' : 'Mute video message'}
      >
        {url.value ?
          <>
            {/* No caption track is rendered — the original carried the equivalent
                svelte-ignore a11y_media_has_caption for the same reason. */}
            <video
              ref={roundVideo}
              src={url.value}
              autoplay
              loop
              muted={roundMuted.value}
              playsinline
              onPlay={onPlay}
              onError={reload}
            ></video>
            <span class="round-badge">{roundMuted.value ? '🔇' : '🔊'} {duration(media.duration)}</span>
          </> :
          failed.value ?
            <span class="fallback">📹</span> :
            <span class="fallback">…</span>}
      </button>
    );
  } else if(media.kind === 'voice' || media.kind === 'audio') {
    body = (
      <div class="player">
        <button
          class="play-btn"
          onClick={togglePlay}
          disabled={!url.value}
          aria-label={playing.value ? 'Pause' : 'Play'}
        >
          {playing.value ?
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <rect x="5.5" y="4" width="3.4" height="12" rx="1" />
              <rect x="11.1" y="4" width="3.4" height="12" rx="1" />
            </svg> :
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M6.5 4.2l9 5.8-9 5.8V4.2z" />
            </svg>}
        </button>

        <span class="track">
          {/* No keyboard interaction of its own — the original carried the
              equivalent svelte-ignore a11y_click_events_have_key_events,
              a11y_no_static_element_interactions. */}
          <span class="wave" onClick={seek} title="Seek">
            {bars.map((bar, i) => (
              <span
                key={i}
                class={['bar', (bars.length ? i / bars.length < progress : false) && 'played'].filter(Boolean).join(' ')}
                style={{height: `${Math.round(bar * 100)}%`}}
              ></span>
            ))}
          </span>
          <span class="sub">
            {failed.value ?
              'Unavailable' :
              <>
                {duration(position.value || 0) || '0:00'} / {duration(total) || '—'}{' '}
                {media.unread && '· new'}
              </>}
          </span>
        </span>

        <button class="speed" onClick={cycleSpeed} disabled={!url.value} aria-label="Playback speed">
          {speed.value}x
        </button>

        {url.value && (
          <audio
            ref={audio}
            src={url.value}
            preload="metadata"
            onPlay={() => { playing.value = true; onPlay(); }}
            onPause={() => (playing.value = false)}
            onEnded={() => { playing.value = false; position.value = 0; }}
            onTimeUpdate={() => (position.value = audio.current?.currentTime ?? 0)}
            onDurationChange={() => {
              const value = audio.current?.duration ?? 0;
              if(Number.isFinite(value)) loadedDuration.value = value;
            }}
          ></audio>
        )}
      </div>
    );
  } else {
    /* A document has no URL until it is asked for: see saveMediaToDisk. */
    body = (
      <button class="file" onClick={save} disabled={saving.value} title={`Download ${media.name || 'file'}`}>
        <span class="glyph"><Glyph name={saving.value ? 'file' : 'save'} size={20} /></span>
        <span class="info">
          <span class="name">{media.name || 'File'}</span>
          <span class="sub">
            {saveError.value ||
              [duration(media.duration), humanSize(media.size), saving.value ? 'Saving…' : 'Download']
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </button>
    );
  }

  return body;
}
