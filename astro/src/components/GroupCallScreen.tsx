/*
 * A new Astro-only component (no Svelte original): the voice-chat panel.
 *
 * The group-call controller owns the call; this only renders the snapshot
 * `onGroupCallState` emits — on every state change and once a second, because
 * participant rows arrive as their own worker events. Styling is global
 * (`.group-call*` in styles/app.css): a new component has no Svelte stylesheet
 * for the verbatim-copy rule to compare against.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal, useSignalEffect} from '@preact/signals';

import {
  canManageGroupCall,
  leaveGroupCall,
  muteGroupCallParticipant,
  onGroupCallState,
  toggleGroupCallMute,
  toggleGroupCallScreen,
  toggleGroupCallVideo,
  type GroupCallState
} from '$lib/telegram/extras';
import {Avatar} from './Avatar';

export function GroupCallScreen() {
  const call = useSignal<GroupCallState | null>(null);
  const error = useSignal('');
  const canManage = useSignal(false);
  const manageRequest = useRef(0);

  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;

    onGroupCallState((state) => (call.value = state)).then((unsubscribe) => {
      if(disposed) unsubscribe();
      else off = unsubscribe;
    }).catch(() => {});

    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  // Whether the current user may mute others; re-read only when the call changes
  // (the snapshot is replaced every second, so compare the chat id, not the value).
  const manageChatId = useRef<number | undefined>(undefined);
  useSignalEffect(() => {
    const chatId = call.value?.chatId;
    if(chatId === manageChatId.current) return;
    manageChatId.current = chatId;

    const request = ++manageRequest.current;
    if(chatId === undefined) {
      canManage.value = false;
      return;
    }

    canManageGroupCall(-chatId).then((rights) => {
      if(request === manageRequest.current) canManage.value = rights;
    }).catch(() => {});
  });

  async function run(action: () => Promise<void>, fallback: string) {
    error.value = '';
    try {
      await action();
    } catch(err: any) {
      error.value = err?.type || err?.message || fallback;
    }
  }

  const state = call.value;
  if(!state) return null;

  const status =
    state.phase === 'connecting' ? 'Connecting…' :
    state.phase === 'muted-by-admin' ? 'Muted by an admin' :
    state.phase === 'unmuted' ? 'Speaking' :
    state.phase === 'muted' ? 'Muted' :
    'Call ended';

  return (
    <div class="group-call">
      <header>
        <span class="group-call-title">{state.title}</span>
        <span class="group-call-count">
          {state.participants.length} {state.participants.length === 1 ? 'person' : 'people'} in the call
        </span>
      </header>

      <div class="group-call-participants">
        {state.participants.length ?
          state.participants.map((participant) => (
            <div
              key={participant.peerId}
              class={['group-call-row', participant.self && 'self'].filter(Boolean).join(' ')}
            >
              <Avatar peerId={participant.peerId} title={participant.title} size={32} />
              <span class="group-call-name">
                <span>{participant.title}{participant.self ? ' (you)' : ''}</span>
                <span class="group-call-sub">
                  {participant.raisedHand ? 'Hand raised' :
                    participant.video ? 'Video' :
                    participant.muted ? 'Muted' : ''}
                </span>
              </span>
              {canManage.value && !participant.self ? (
                <button
                  class="group-call-action"
                  onClick={() => run(
                    () => muteGroupCallParticipant(participant.peerId, !participant.muted),
                    'Could not change that microphone'
                  )}
                  aria-label={participant.muted ? 'Unmute' : 'Mute'}
                >{participant.muted ? '🎙' : '🔇'}</button>
              ) : null}
              <span class="group-call-icon">
                {participant.raisedHand ? '✋' : participant.video ? '🎥' : participant.muted ? '🔇' : ''}
              </span>
            </div>
          )) :
          <p class="group-call-empty">Waiting for others…</p>}
      </div>

      <div class="group-call-controls">
        <button
          class={['round', state.canSelfUnmute ? state.muted && 'active' : state.handRaised && 'active'].filter(Boolean).join(' ')}
          onClick={() => run(toggleGroupCallMute, 'Could not change the microphone')}
          disabled={!state.canSelfUnmute && state.handRaised}
          aria-label={state.canSelfUnmute ? (state.muted ? 'Unmute' : 'Mute') : (state.handRaised ? 'Hand raised' : 'Raise hand')}
        >{state.canSelfUnmute ? (state.muted ? '🔇' : '🎙') : '✋'}</button>
        <button
          class={['round', state.sharingVideo && 'active'].filter(Boolean).join(' ')}
          onClick={() => run(toggleGroupCallVideo, 'Could not change the camera')}
          aria-label="Camera"
        >🎥</button>
        <button
          class={['round', state.sharingScreen && 'active'].filter(Boolean).join(' ')}
          onClick={() => run(toggleGroupCallScreen, 'Could not share the screen')}
          aria-label="Share screen"
        >🖥</button>
        <button
          class="round decline"
          onClick={() => run(leaveGroupCall, 'Could not leave the call')}
          aria-label="Leave"
        >✕</button>
      </div>

      <p class="group-call-status">{status}</p>
      {error.value && <p class="group-call-error">{error.value}</p>}
    </div>
  );
}
