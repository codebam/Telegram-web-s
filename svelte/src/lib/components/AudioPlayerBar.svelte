<script lang="ts">
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

  /**
   * The persistent playback bar. It renders whatever the module-level player
   * happens to be playing, so it survives switching chats — the component is
   * a view over that state, never its owner.
   */
  let state = $state<PlayerState>(playerState());

  $effect(() => subscribePlayer((next) => (state = next)));

  const progress = $derived(state.duration ? (state.time / state.duration) * 100 : 0);

  function time(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  function onSeek(e: Event) {
    const value = Number((e.currentTarget as HTMLInputElement).value);
    seekPlayer((value / 100) * (state.duration || 0));
  }

  function onVolume(e: Event) {
    setPlayerVolume(Number((e.currentTarget as HTMLInputElement).value) / 100);
  }
</script>

{#if state.track}
  <div class="player-bar" role="region" aria-label="Audio player">
    <button class="round" onclick={() => playPrev()} disabled={!state.hasPrev} aria-label="Previous">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 4.5v11L7.5 10 15 4.5zM6 4.5h-1.5v11H6v-11z" /></svg>
    </button>

    <button class="round play" onclick={togglePlay} aria-label={state.playing ? 'Pause' : 'Play'}>
      {#if state.loading}
        <span class="spinner"></span>
      {:else if state.playing}
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z" /></svg>
      {:else}
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l10 6-10 6V4z" /></svg>
      {/if}
    </button>

    <button class="round" onclick={() => playNext()} disabled={!state.hasNext} aria-label="Next">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4.5v11L12.5 10 5 4.5zM14 4.5h1.5v11H14v-11z" /></svg>
    </button>

    <div class="body">
      <div class="labels">
        <span class="title">{state.track.title}</span>
        {#if state.track.subtitle}
          <span class="subtitle">{state.track.subtitle}</span>
        {/if}
        {#if state.error}
          <span class="error">{state.error}</span>
        {/if}
      </div>

      <div class="seek">
        <span class="time">{time(state.time)}</span>
        <input
          class="range"
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          oninput={onSeek}
          aria-label="Seek"
          style="--fill: {progress}%"
        />
        <span class="time">{time(state.duration || state.track.duration)}</span>
      </div>
    </div>

    <button class="chip" onclick={cyclePlayerSpeed} aria-label="Playback speed">{state.speed}×</button>

    {#if !state.track.isVoice}
      <button
        class="round small"
        class:active={state.shuffle}
        onclick={toggleShuffle}
        aria-label="Shuffle"
        aria-pressed={state.shuffle}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 5h3l8 10h3M3 15h3l2-2.5M14 5h3M12.5 3.5L14 5l-1.5 1.5M12.5 13.5L14 15l-1.5 1.5" />
        </svg>
      </button>

      <button
        class="round small"
        class:active={state.repeat !== 'none'}
        onclick={cycleRepeat}
        aria-label="Repeat: {state.repeat}"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M5 8V7a2 2 0 012-2h8M15 12v1a2 2 0 01-2 2H5" />
          <path d="M13 3l2 2-2 2M7 13l-2 2 2 2" />
        </svg>
        {#if state.repeat === 'one'}<span class="badge">1</span>{/if}
      </button>
    {/if}

    <div class="volume">
      <button class="round small" onclick={togglePlayerMute} aria-label={state.muted ? 'Unmute' : 'Mute'}>
        {#if state.muted || !state.volume}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4V8z" /><path d="M13 8l4 4M17 8l-4 4" stroke="currentColor" stroke-width="1.5" fill="none" /></svg>
        {:else}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8h3l4-3v10l-4-3H4V8z" /><path d="M13.5 7.5a3.5 3.5 0 010 5M15.5 5.5a6 6 0 010 9" stroke="currentColor" stroke-width="1.5" fill="none" /></svg>
        {/if}
      </button>
      <input
        class="range volume-range"
        type="range"
        min="0"
        max="100"
        value={state.muted ? 0 : state.volume * 100}
        oninput={onVolume}
        aria-label="Volume"
        style="--fill: {state.muted ? 0 : state.volume * 100}%"
      />
    </div>

    <button class="round small" onclick={closePlayer} aria-label="Close player">
      <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2" />
      </svg>
    </button>
  </div>
{/if}

<style>
  .player-bar {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 90;
    width: min(720px, calc(100vw - 24px));
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 14px;
    background: var(--surface, #1c1c1e);
    color: var(--text, #fff);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
    border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  }

  .body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  .labels {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .title {
    font-weight: 500;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtitle {
    font-size: 12px;
    opacity: 0.65;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error {
    font-size: 12px;
    color: #ff6b6b;
  }

  .seek {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .time {
    font-size: 11px;
    opacity: 0.6;
    font-variant-numeric: tabular-nums;
    min-width: 34px;
    text-align: center;
  }

  .range {
    flex: 1;
    appearance: none;
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--accent, #3390ec) var(--fill),
      color-mix(in srgb, currentColor 20%, transparent) var(--fill)
    );
    cursor: pointer;
  }

  .range::-webkit-slider-thumb {
    appearance: none;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--accent, #3390ec);
  }

  .range::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border: none;
    border-radius: 50%;
    background: var(--accent, #3390ec);
  }

  .volume {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .volume-range {
    width: 68px;
  }

  .round {
    position: relative;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex: none;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
  }

  .round svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  .round.small svg {
    width: 17px;
    height: 17px;
  }

  .round.small {
    width: 28px;
    height: 28px;
    opacity: 0.7;
  }

  .round:hover {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }

  .round:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .round.active {
    opacity: 1;
    color: var(--accent, #3390ec);
  }

  .play {
    background: var(--accent, #3390ec);
    color: #fff;
  }

  .play:hover {
    background: var(--accent, #3390ec);
    filter: brightness(1.1);
  }

  .badge {
    position: absolute;
    right: 1px;
    bottom: 0;
    font-size: 9px;
    font-weight: 600;
  }

  .chip {
    flex: none;
    border: none;
    background: color-mix(in srgb, currentColor 12%, transparent);
    color: inherit;
    border-radius: 999px;
    font-size: 12px;
    padding: 3px 8px;
    cursor: pointer;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 600px) {
    .volume-range {
      display: none;
    }
  }
</style>
