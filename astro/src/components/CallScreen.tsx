/*
 * Ported from svelte/src/lib/components/CallScreen.svelte.
 *
 * Three details of the port:
 *  - the state subscription is a `useEffect` with an empty dependency list, and
 *    the `disposed` flag plus the unsubscribe it used to register are now that
 *    effect's cleanup;
 *  - the effect that mounts the call's <video> elements reads `call` and
 *    `minimised`, so it is a `useSignalEffect` — it is the hook that tracks
 *    signal reads;
 *  - `remoteSlot` / `localSlot` are signals written by a callback ref rather
 *    than plain refs — the mapping this port uses for a `bind:this` that an
 *    effect reads. The callbacks are memoised so an ordinary re-render does not
 *    rewrite them.
 */
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {
  acceptCall,
  getCallVideo,
  hangUp,
  onCallState,
  toggleCallMute,
  toggleCallScreen,
  toggleCallVideo,
  type CallState
} from '$lib/telegram/extras';

import {Avatar} from './Avatar';

import './CallScreen.css';

export function CallScreen() {
  const call = useSignal<CallState | null>(null);
  const minimised = useSignal(false);
  /** Shown briefly after a call ends, so it does not just vanish. */
  const farewell = useSignal('');
  const farewellTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remoteSlot = useSignal<HTMLDivElement | null>(null);
  const localSlot = useSignal<HTMLDivElement | null>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;

    onCallState((state) => {
      const previous = call.value;

      if(state?.phase === 'ended' || (!state && previous)) {
        const reason = state?.endReason || previous?.endReason || '';
        farewell.value =
          reason === 'busy' ? `${previous?.title ?? 'They'} is on another call` :
          reason === 'missed' ? 'No answer' :
          reason === 'disconnected' ? 'Call disconnected' :
          previous && previous.phase !== 'connected' ? 'Call ended' : '';

        if(farewell.value) {
          clearTimeout(farewellTimer.current);
          farewellTimer.current = setTimeout(() => (farewell.value = ''), 4000);
        }
      }

      call.value = state;
      if(!state) minimised.value = false;
    }).then((unsubscribe) => {
      if(disposed) unsubscribe();
      else off = unsubscribe;
    });

    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  /**
   * The P2P engine owns the <video> elements, so mount whatever it hands back
   * rather than trying to re-derive a MediaStream.
   */
  useSignalEffect(() => {
    if(!call.value || call.value.phase !== 'connected' || minimised.value) return;

    let cancelled = false;

    (async() => {
      const [remote, local] = await Promise.all([getCallVideo('output'), getCallVideo('input')]);
      if(cancelled) return;

      if(remote && remoteSlot.value && remote.parentElement !== remoteSlot.value) {
        remoteSlot.value.replaceChildren(remote);
      }
      if(local && localSlot.value && local.parentElement !== localSlot.value) {
        local.muted = true;
        localSlot.value.replaceChildren(local);
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  const setRemoteSlot = useMemo(() => (node: HTMLDivElement | null) => {
    remoteSlot.value = node;
  }, []);
  const setLocalSlot = useMemo(() => (node: HTMLDivElement | null) => {
    localSlot.value = node;
  }, []);

  function clock(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const statusText = useComputed(() =>
    !call.value ? '' :
    call.value.phase === 'incoming' ? 'Incoming call' :
    call.value.phase === 'outgoing' ? 'Ringing…' :
    call.value.phase === 'connecting' ? 'Connecting…' :
    call.value.phase === 'connected' ? clock(call.value.duration) :
    'Call ended'
  );

  const hasVideo = useComputed(() => !!call.value?.sharingVideo || !!call.value?.sharingScreen);

  return (
    <>
      {farewell.value && !call.value &&
        <button class="farewell" onClick={() => (farewell.value = '')}>{farewell.value}</button>}

      {call.value && (minimised.value ?
        <button class="mini" onClick={() => (minimised.value = false)}>
          <span class="pip"></span>
          <span>{call.value.title}</span>
          <span class="mini-time">{statusText.value}</span>
        </button> :
        <div class={['screen', call.value.phase === 'incoming' && 'ringing'].filter(Boolean).join(' ')}>
          <div class="stage">
            <div
              class={['remote', hasVideo.value && 'has-video'].filter(Boolean).join(' ')}
              ref={setRemoteSlot}
            ></div>

            {!hasVideo.value &&
              <div class="portrait">
                <Avatar peerId={call.value.peerId} title={call.value.title} size={132} />
              </div>}

            <div
              class={['local', (call.value.sharingVideo || call.value.sharingScreen) && 'on'].filter(Boolean).join(' ')}
              ref={setLocalSlot}
            ></div>

            <div class="info">
              <h2>{call.value.title}</h2>
              <p class="status">{statusText.value}</p>

              {!!call.value.fingerprint.length &&
                <p class="fingerprint" title="Compare these with the other person to verify the call">
                  {call.value.fingerprint.join(' ')}
                </p>}
            </div>

            <button class="minimise" onClick={() => (minimised.value = true)} aria-label="Minimise call">▾</button>
          </div>

          <div class="controls">
            {call.value.phase === 'incoming' ?
              <>
                <button class="round decline" onClick={hangUp} aria-label="Decline">✕</button>
                <button class="round accept" onClick={acceptCall} aria-label="Accept">✆</button>
              </> :
              <>
                <button
                  class={['round', call.value.muted && 'active'].filter(Boolean).join(' ')}
                  onClick={toggleCallMute}
                  aria-label="Mute"
                >
                  {call.value.muted ? '🔇' : '🎙'}
                </button>
                <button
                  class={['round', call.value.sharingVideo && 'active'].filter(Boolean).join(' ')}
                  onClick={toggleCallVideo}
                  aria-label="Camera"
                >
                  🎥
                </button>
                <button
                  class={['round', call.value.sharingScreen && 'active'].filter(Boolean).join(' ')}
                  onClick={toggleCallScreen}
                  aria-label="Share screen"
                >
                  🖥
                </button>
                <button class="round decline" onClick={hangUp} aria-label="End call">✕</button>
              </>}
          </div>
        </div>)}
    </>
  );
}
