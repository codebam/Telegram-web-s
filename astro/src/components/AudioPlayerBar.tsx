/*
 * Ported from svelte/src/lib/components/AudioPlayerBar.svelte.
 *
 * The player state lives in a module-level emitter rather than a signal, so the
 * bar keeps a signal of its own and the subscription copies each snapshot into
 * it. That effect reads no prop, so it is a `useEffect` with an empty dependency
 * list, and the unsubscribe `subscribePlayer` hands back is its cleanup — the
 * same shape as the `onDestroy` that owned it before.
 *
 * `progress` is derived from that signal, not from a prop: a plain `const` would
 * be computed once per render and never move, so it is a `useComputed`.
 */
import {useEffect} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import {
  closePlayer,
  cyclePlayerSpeed,
  cycleRepeat,
  playNext,
  playPrev,
  playerState,
  seekPlayer,
  setPlayerVolume,
  subscribePlayer,
  toggleShuffle,
  togglePlay,
  togglePlayerMute,
  type PlayerState
} from '$lib/telegram/player';

import './AudioPlayerBar.css';

export function AudioPlayerBar() {
  /**
   * The persistent playback bar. It renders whatever the module-level player
   * happens to be playing, so it survives switching chats — the component is
   * a view over that state, never its owner.
   */
  const state = useSignal<PlayerState>(playerState());

  useEffect(() => subscribePlayer((next) => (state.value = next)), []);

  const progress = useComputed(() =>
    state.value.duration ? (state.value.time / state.value.duration) * 100 : 0
  );

  function time(seconds: number) {
    if(!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ?
      `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` :
      `${m}:${String(s).padStart(2, '0')}`;
  }

  function onSeek(e: Event) {
    const value = Number((e.currentTarget as HTMLInputElement).value);
    seekPlayer((value / 100) * (state.value.duration || 0));
  }

  function onVolume(e: Event) {
    setPlayerVolume(Number((e.currentTarget as HTMLInputElement).value) / 100);
  }

  const track = state.value.track;
  if(!track) return null;

  return (
    <div class="player-bar" role="region" aria-label="Audio player">
      <button class="round" onClick={() => playPrev()} disabled={!state.value.hasPrev} aria-label="Previous">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 4.5v11L7.5 10 15 4.5zM6 4.5h-1.5v11H6v-11z" /></svg>
      </button>

      <button class="round play" onClick={togglePlay} aria-label={state.value.playing ? 'Pause' : 'Play'}>
        {state.value.loading ?
          <span class="spinner"></span> :
          state.value.playing ?
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z" /></svg> :
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l10 6-10 6V4z" /></svg>}
      </button>

      <button class="round" onClick={() => playNext()} disabled={!state.value.hasNext} aria-label="Next">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4.5v11L12.5 10 5 4.5zM14 4.5h1.5v11H14v-11z" /></svg>
      </button>

      <div class="body">
        <div class="labels">
          <span class="title">{track.title}</span>
          {track.subtitle && <span class="subtitle">{track.subtitle}</span>}
          {state.value.error && <span class="error">{state.value.error}</span>}
        </div>

        <div class="seek">
          <span class="time">{time(state.value.time)}</span>
          <input
            class="range"
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progress.value}
            onInput={onSeek}
            aria-label="Seek"
            style={{'--fill': `${progress.value}%`}}
          />
          <span class="time">{time(state.value.duration || track.duration)}</span>
        </div>
      </div>

      <button class="chip" onClick={cyclePlayerSpeed} aria-label="Playback speed">{state.value.speed}×</button>

      {!track.isVoice && (
        <>
          <button
            class={['round small', state.value.shuffle && 'active'].filter(Boolean).join(' ')}
            onClick={toggleShuffle}
            aria-label="Shuffle"
            aria-pressed={state.value.shuffle}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 5h3l8 10h3M3 15h3l2-2.5M14 5h3M12.5 3.5L14 5l-1.5 1.5M12.5 13.5L14 15l-1.5 1.5" />
            </svg>
          </button>

          <button
            class={['round small', state.value.repeat !== 'none' && 'active'].filter(Boolean).join(' ')}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${state.value.repeat}`}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M5 8V7a2 2 0 012-2h8M15 12v1a2 2 0 01-2 2H5" />
              <path d="M13 3l2 2-2 2M7 13l-2 2 2 2" />
            </svg>
            {state.value.repeat === 'one' && <span class="badge">1</span>}
          </button>
        </>
      )}

      <div class="volume">
        <button class="round small" onClick={togglePlayerMute} aria-label={state.value.muted ? 'Unmute' : 'Mute'}>
          {state.value.muted || !state.value.volume ?
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4V8z" /><path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" stroke-width="1.5" fill="none" /></svg> :
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4V8z" /><path d="M13.5 7.5a3.5 3.5 0 010 5M15.5 5.5a6 6 0 010 9" stroke="currentColor" stroke-width="1.5" fill="none" /></svg>}
        </button>
        <input
          class="range volume-range"
          type="range"
          min="0"
          max="100"
          value={state.value.muted ? 0 : state.value.volume * 100}
          onInput={onVolume}
          aria-label="Volume"
          style={{'--fill': `${state.value.muted ? 0 : state.value.volume * 100}%`}}
        />
      </div>

      <button class="round small" onClick={closePlayer} aria-label="Close player">
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2" />
        </svg>
      </button>
    </div>
  );
}
