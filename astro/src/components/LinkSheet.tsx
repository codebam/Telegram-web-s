/*
 * Ported from svelte/src/lib/components/LinkSheet.svelte.
 *
 * `selected` is seeded from the `action` prop once, when the signal is created —
 * the sheet is mounted fresh per link, so that is the intended behaviour rather
 * than a missed dependency.
 */
import {useSignal} from '@preact/signals';

import {joinChatByInvite, joinChatlistByInvite, type LinkAction} from '$lib/telegram/links';

import './LinkSheet.css';

interface Props {
  action: Extract<LinkAction, {type: 'joinChat'} | {type: 'addList'}>;
  onclose: () => void;
  onopenpeer: (peerId: number) => void;
}

export function LinkSheet({action, onclose, onopenpeer}: Props) {
  const busy = useSignal(false);
  const error = useSignal('');

  // Shared folders let you pick which of their chats to import; default to all.
  const selected = useSignal(new Set<number>(action.type === 'addList' ? action.peers.map((p) => p.peerId) : []));

  function toggle(peerId: number) {
    const next = new Set(selected.value);
    if(next.has(peerId)) next.delete(peerId);
    else next.add(peerId);
    selected.value = next;
  }

  async function confirm() {
    if(busy.value) return;
    busy.value = true;
    error.value = '';

    try {
      if(action.type === 'joinChat') {
        const peerId = await joinChatByInvite(action.invite);
        onclose();
        // A request-to-join chat is not joined yet; there is nothing to open.
        if(!action.requestNeeded && peerId) onopenpeer(peerId);
        return;
      }

      // A plain Set is not structured-cloneable across the worker boundary, and
      // `selected` is a signal besides — hand over a plain array.
      await joinChatlistByInvite(action.slug, [...selected.value]);
      onclose();
    } catch(err: any) {
      error.value = err?.type || err?.message || 'Could not complete that';
      busy.value = false;
    }
  }

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        {action.type === 'joinChat' ?
          <>
            <header>{action.title}</header>
            {action.about ? <p class="about">{action.about}</p> : null}
            <p class="hint">
              {action.participantsCount ? `${action.participantsCount.toLocaleString()} members` : null}
            </p>
            <p class="hint">
              {action.requestNeeded ?
                'An admin has to approve your request before you can join.' :
                'Do you want to join this chat?'}
            </p>
          </> :
          <>
            <header>{action.title}</header>
            <p class="hint">
              {action.peers.length ?
                `Add ${action.peers.length} chat${action.peers.length === 1 ? '' : 's'} to this folder?` :
                'You have already added every chat from this folder.'}
            </p>

            <div class="list">
              {action.peers.map((peer) => (
                <button
                  key={peer.peerId}
                  class={['row', selected.value.has(peer.peerId) && 'on'].filter(Boolean).join(' ')}
                  onClick={() => toggle(peer.peerId)}
                >
                  <span class="check">{selected.value.has(peer.peerId) ? '☑' : '☐'}</span>
                  <span class="name">{peer.title}</span>
                </button>
              ))}
            </div>
          </>
        }

        {error.value ? <p class="error">{error.value}</p> : null}

        <footer>
          <span class="spacer"></span>
          <button onClick={onclose} disabled={busy.value}>Cancel</button>
          <button
            class="primary"
            onClick={confirm}
            disabled={busy.value || (action.type === 'addList' && !selected.value.size)}
          >
            {busy.value ?
              'Working…' :
              action.type === 'joinChat' ?
                (action.requestNeeded ? 'Request to join' : 'Join') :
                'Add folder'}
          </button>
        </footer>
      </div>
    </div>
  );
}
