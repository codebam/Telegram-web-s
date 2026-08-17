<script lang="ts">
  import {
    loadMapPreview,
    stopLiveLocation,
    type LocationExtra,
    type LiveLocationExtra,
    type VenueExtra
  } from '$lib/telegram/messageTypes';

  let {
    peerId,
    mid,
    location,
    onerror
  }: {
    peerId: number;
    mid: number;
    location: LocationExtra | LiveLocationExtra | VenueExtra;
    onerror?: (message: string) => void;
  } = $props();

  let url = $state<string | null>(null);
  // The countdown ticks off its own clock rather than the message: a live
  // location expires while the bubble is on screen and nothing re-renders it.
  let now = $state(Math.floor(Date.now() / 1000));
  let stopping = $state(false);

  const live = $derived(location.kind === 'geoLive' ? (location as LiveLocationExtra) : null);
  const venue = $derived(location.kind === 'venue' ? (location as VenueExtra) : null);
  const remaining = $derived(live ? Math.max(0, live.expiresAt - now) : 0);
  const expired = $derived(!!live && remaining <= 0);
  const progress = $derived(live && live.period ? remaining / live.period : 0);

  $effect(() => {
    const key = `${peerId}_${mid}`;
    url = null;
    loadMapPreview(peerId, mid).then((resolved) => {
      if (key === `${peerId}_${mid}`) url = resolved;
    });
  });

  $effect(() => {
    if (!live || expired) return;
    const timer = setInterval(() => (now = Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  });

  function countdown(seconds: number) {
    if (seconds >= 3600) return `${Math.round(seconds / 3600)}h left`;
    if (seconds >= 60) return `${Math.round(seconds / 60)}m left`;
    return `${seconds}s left`;
  }

  function updatedAgo(editDate: number) {
    const ago = now - editDate;
    if (ago < 60) return 'updated just now';
    if (ago < 3600) return `updated ${Math.floor(ago / 60)} min ago`;
    return `updated ${Math.floor(ago / 3600)} h ago`;
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    try {
      await stopLiveLocation(peerId, mid);
    } catch (err: any) {
      onerror?.(err?.message || 'Could not stop sharing');
    } finally {
      stopping = false;
    }
  }
</script>

<div class="geo">
  <a class="map" href={location.mapUrl} target="_blank" rel="noopener noreferrer">
    {#if url}
      <img src={url} alt={venue ? venue.title : 'Map'} />
    {:else}
      <span class="map-placeholder">📍</span>
    {/if}
    <span class="pin" class:live={!!live && !expired}>📍</span>
  </a>

  {#if venue}
    <div class="foot">
      <span class="title">{venue.title}</span>
      <span class="address">{venue.address}</span>
    </div>
  {:else if live}
    <div class="foot">
      <span class="title">{expired ? 'Live location ended' : 'Live location'}</span>
      <span class="address">
        {expired ? `shared for ${Math.round(live.period / 60)} min` : updatedAgo(live.editDate)}
      </span>
      {#if !expired}
        <span class="timer" style="--left: {progress}">{countdown(remaining)}</span>
      {/if}
    </div>
    {#if !expired && live.mine}
      <button class="stop" onclick={stop} disabled={stopping}>
        {stopping ? 'Stopping…' : 'Stop sharing'}
      </button>
    {/if}
  {/if}
</div>

<style>
  .geo {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 320px;
  }

  .map {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: 10px;
    overflow: hidden;
    background: var(--bubble-in);
    border: 1px solid var(--border);
  }

  .map img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .map-placeholder {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    font-size: 24px;
    opacity: 0.5;
  }

  .pin {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 26px;
    pointer-events: none;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  }

  .pin.live {
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.12); }
  }

  .foot {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0 8px;
    align-items: center;
  }

  .title {
    font-weight: 600;
    font-size: 14px;
  }

  .address {
    grid-column: 1;
    font-size: 12px;
    color: var(--text-dim);
  }

  .timer {
    grid-row: 1 / span 2;
    grid-column: 2;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 999px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) calc(18% * var(--left, 1)), transparent);
  }

  .stop {
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--danger);
    font-size: 13px;
    cursor: pointer;
  }

  .stop:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>
