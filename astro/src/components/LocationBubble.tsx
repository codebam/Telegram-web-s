/*
 * Ported from svelte/src/lib/components/LocationBubble.svelte.
 *
 * `live` and `venue` are picked off the `location` prop, so they are plain
 * consts recomputed on each render; `remaining`, `expired` and `progress` also
 * read the `now` signal in the component body, which is what subscribes the
 * bubble to its one-second tick.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {
  loadMapPreview,
  stopLiveLocation,
  type LocationExtra,
  type LiveLocationExtra,
  type VenueExtra
} from '$lib/telegram/messageTypes';

import './LocationBubble.css';

interface Props {
  peerId: number;
  mid: number;
  location: LocationExtra | LiveLocationExtra | VenueExtra;
  onerror?: (message: string) => void;
}

export function LocationBubble({peerId, mid, location, onerror}: Props) {
  const url = useSignal<string | null>(null);
  // The countdown ticks off its own clock rather than the message: a live
  // location expires while the bubble is on screen and nothing re-renders it.
  const now = useSignal(Math.floor(Date.now() / 1000));
  const stopping = useSignal(false);

  const live = location.kind === 'geoLive' ? (location as LiveLocationExtra) : null;
  const venue = location.kind === 'venue' ? (location as VenueExtra) : null;
  const remaining = live ? Math.max(0, live.expiresAt - now.value) : 0;
  const expired = !!live && remaining <= 0;
  const progress = live && live.period ? remaining / live.period : 0;

  // Svelte read `peerId` and `mid` inside the async callback and always saw the
  // current pair — that is what makes the stale-response check below mean
  // anything. A closure in JSX would compare the values from the render that
  // started the load, so the latest pair is kept in refs.
  const currentPeerId = useRef(peerId);
  currentPeerId.current = peerId;
  const currentMid = useRef(mid);
  currentMid.current = mid;

  useEffect(() => {
    const key = `${peerId}_${mid}`;
    url.value = null;
    loadMapPreview(peerId, mid).then((resolved) => {
      if(key === `${currentPeerId.current}_${currentMid.current}`) url.value = resolved;
    });
  }, [peerId, mid]);

  useEffect(() => {
    if(!live || expired) return;
    const timer = setInterval(() => (now.value = Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [live, expired]);

  function countdown(seconds: number) {
    if(seconds >= 3600) return `${Math.round(seconds / 3600)}h left`;
    if(seconds >= 60) return `${Math.round(seconds / 60)}m left`;
    return `${seconds}s left`;
  }

  function updatedAgo(editDate: number) {
    const ago = now.value - editDate;
    if(ago < 60) return 'updated just now';
    if(ago < 3600) return `updated ${Math.floor(ago / 60)} min ago`;
    return `updated ${Math.floor(ago / 3600)} h ago`;
  }

  async function stop() {
    if(stopping.value) return;
    stopping.value = true;
    try {
      await stopLiveLocation(peerId, mid);
    } catch(err: any) {
      onerror?.(err?.message || 'Could not stop sharing');
    } finally {
      stopping.value = false;
    }
  }

  return (
    <div class="geo">
      <a class="map" href={location.mapUrl} target="_blank" rel="noopener noreferrer">
        {url.value ?
          <img src={url.value} alt={venue ? venue.title : 'Map'} /> :
          <span class="map-placeholder">📍</span>}
        <span class={['pin', live && !expired && 'live'].filter(Boolean).join(' ')}>📍</span>
      </a>

      {venue ?
        <div class="foot">
          <span class="title">{venue.title}</span>
          <span class="address">{venue.address}</span>
        </div> :
        live ?
          <>
            <div class="foot">
              <span class="title">{expired ? 'Live location ended' : 'Live location'}</span>
              <span class="address">
                {expired ? `shared for ${Math.round(live.period / 60)} min` : updatedAgo(live.editDate)}
              </span>
              {!expired ?
                <span class="timer" style={{'--left': progress}}>{countdown(remaining)}</span> :
                null}
            </div>
            {!expired && live.mine ?
              <button class="stop" onClick={stop} disabled={stopping.value}>
                {stopping.value ? 'Stopping…' : 'Stop sharing'}
              </button> :
              null}
          </> :
          null}
    </div>
  );
}
