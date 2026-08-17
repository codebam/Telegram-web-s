<script lang="ts">
  import {
    currentPosition,
    liveShareState,
    onLiveShareChange,
    sendLocation,
    startLiveLocation,
    stopLiveLocation,
    LIVE_PERIODS,
    type Coords
  } from '$lib/telegram/messageTypes';

  let {
    peerId,
    threadId,
    replyToMsgId,
    onclose,
    onerror
  }: {
    peerId: number;
    threadId?: number;
    replyToMsgId?: number;
    onclose: () => void;
    onerror?: (message: string) => void;
  } = $props();

  let coords = $state<Coords | null>(null);
  let locating = $state(true);
  let busy = $state(false);
  let sharing = $state(liveShareState(peerId).active);

  $effect(() => onLiveShareChange(() => (sharing = liveShareState(peerId).active)));

  $effect(() => {
    let alive = true;
    currentPosition()
      .then((position) => {
        if (alive) coords = position;
      })
      .catch((err: any) => {
        if (alive) onerror?.(err?.message || 'Could not get your location');
      })
      .finally(() => {
        if (alive) locating = false;
      });
    return () => (alive = false);
  });

  function label(period: number) {
    if (period >= 3600) return `${period / 3600} hour${period > 3600 ? 's' : ''}`;
    return `${period / 60} minutes`;
  }

  async function send() {
    if (!coords || busy) return;
    busy = true;
    try {
      await sendLocation(peerId, coords, {threadId, replyToMsgId});
      onclose();
    } catch (err: any) {
      onerror?.(err?.message || err?.type || 'Could not send the location');
    } finally {
      busy = false;
    }
  }

  async function share(period: number) {
    if (busy) return;
    busy = true;
    try {
      await startLiveLocation(peerId, period, {threadId, replyToMsgId});
      onclose();
    } catch (err: any) {
      onerror?.(err?.message || err?.type || 'Could not start sharing');
    } finally {
      busy = false;
    }
  }

  async function stop() {
    if (busy) return;
    busy = true;
    try {
      await stopLiveLocation(peerId);
      onclose();
    } catch (err: any) {
      onerror?.(err?.message || 'Could not stop sharing');
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop" onclick={onclose} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>Location</header>

    {#if locating}
      <p class="muted">Getting your location…</p>
    {:else if coords}
      <p class="coords">{coords.lat.toFixed(5)}, {coords.long.toFixed(5)} · ±{coords.accuracy} m</p>
    {:else}
      <p class="muted">No location available. Allow location access and reopen this.</p>
    {/if}

    <button class="primary" onclick={send} disabled={!coords || busy}>Send this location</button>

    <span class="section">Share live location for</span>
    <div class="periods">
      {#each LIVE_PERIODS as period (period)}
        <button onclick={() => share(period)} disabled={busy || sharing}>{label(period)}</button>
      {/each}
    </div>

    {#if sharing}
      <button class="danger" onclick={stop} disabled={busy}>Stop sharing live location</button>
    {/if}

    <footer><button onclick={onclose}>Cancel</button></footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: grid;
    place-items: center;
    z-index: 95;
  }

  .dialog {
    width: min(360px, calc(100vw - 32px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px;
    background: var(--bg-solid);
    border: 1px solid var(--border);
    border-radius: var(--pane-radius);
    color: var(--text);
  }

  header {
    font-weight: 600;
  }

  .muted,
  .coords {
    margin: 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  .section {
    font-size: 12px;
    color: var(--text-dim);
  }

  .periods {
    display: flex;
    gap: 6px;
  }

  button {
    padding: 8px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }

  .periods button {
    flex: 1;
  }

  .primary {
    color: var(--accent);
  }

  .danger {
    color: var(--danger);
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  footer {
    display: flex;
    justify-content: flex-end;
  }
</style>
