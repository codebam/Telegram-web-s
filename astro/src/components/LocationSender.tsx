/*
 * Ported from svelte/src/lib/components/LocationSender.svelte.
 *
 * Both `$effect`s became `useEffect`s, and each one's teardown is the function
 * its callback returns — the originals were already written as "return the
 * cleanup", so that part ports unchanged.
 *
 * Their dependency lists differ, and deliberately:
 *  - the live-share subscription reads the `peerId` prop, so it is re-created
 *    whenever the peer changes;
 *  - the location read depends on nothing reactive: its `$effect` body only
 *    read `onerror`, and inside an async continuation, which Svelte does not
 *    track. It therefore runs once on mount, the way `onMount` did.
 */
import {useEffect} from 'preact/hooks';
import {useSignal} from '@preact/signals';

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

import './LocationSender.css';

interface Props {
  peerId: number;
  threadId?: number;
  replyToMsgId?: number;
  onclose: () => void;
  onerror?: (message: string) => void;
}

export function LocationSender({peerId, threadId, replyToMsgId, onclose, onerror}: Props) {
  const coords = useSignal<Coords | null>(null);
  const locating = useSignal(true);
  const busy = useSignal(false);
  const sharing = useSignal(liveShareState(peerId).active);

  // The unsubscribe this returns is the effect's cleanup, so leaving the peer —
  // or the component — stops listening.
  useEffect(() => onLiveShareChange(() => (sharing.value = liveShareState(peerId).active)), [peerId]);

  useEffect(() => {
    let alive = true;
    currentPosition()
      .then((position) => {
        if(alive) coords.value = position;
      })
      .catch((err: any) => {
        if(alive) onerror?.(err?.message || 'Could not get your location');
      })
      .finally(() => {
        if(alive) locating.value = false;
      });

    return () => (alive = false);
  }, []);

  function label(period: number) {
    if(period >= 3600) return `${period / 3600} hour${period > 3600 ? 's' : ''}`;
    return `${period / 60} minutes`;
  }

  async function send() {
    if(!coords.value || busy.value) return;
    busy.value = true;
    try {
      await sendLocation(peerId, coords.value, {threadId, replyToMsgId});
      onclose();
    } catch(err: any) {
      onerror?.(err?.message || err?.type || 'Could not send the location');
    } finally {
      busy.value = false;
    }
  }

  async function share(period: number) {
    if(busy.value) return;
    busy.value = true;
    try {
      await startLiveLocation(peerId, period, {threadId, replyToMsgId});
      onclose();
    } catch(err: any) {
      onerror?.(err?.message || err?.type || 'Could not start sharing');
    } finally {
      busy.value = false;
    }
  }

  async function stop() {
    if(busy.value) return;
    busy.value = true;
    try {
      await stopLiveLocation(peerId);
      onclose();
    } catch(err: any) {
      onerror?.(err?.message || 'Could not stop sharing');
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>Location</header>

        {locating.value ?
          <p class="muted">Getting your location…</p> :
          coords.value ?
            <p class="coords">{coords.value.lat.toFixed(5)}, {coords.value.long.toFixed(5)} · ±{coords.value.accuracy} m</p> :
            <p class="muted">No location available. Allow location access and reopen this.</p>}

        <button class="primary" onClick={send} disabled={!coords.value || busy.value}>Send this location</button>

        <span class="section">Share live location for</span>
        <div class="periods">
          {LIVE_PERIODS.map((period) => (
            <button key={period} onClick={() => share(period)} disabled={busy.value || sharing.value}>{label(period)}</button>
          ))}
        </div>

        {sharing.value ?
          <button class="danger" onClick={stop} disabled={busy.value}>Stop sharing live location</button> :
          null}

        <footer><button onClick={onclose}>Cancel</button></footer>
      </div>
    </div>
  );
}
