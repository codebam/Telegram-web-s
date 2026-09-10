/*
 * Ported from svelte/src/lib/components/ChatAdminDiscussion.svelte.
 *
 * The `$effect` tracked the `chat.peerId` prop and `linkedPeerId`, which is itself
 * derived from the `chat` prop — so it is a `useEffect` keyed on both, since
 * `useSignalEffect` tracks signal reads only. The guard inside `.then()` compares
 * against the chat that is open *now*, which a JSX closure cannot see, so the
 * latest peer id is kept in a ref, as in `Avatar.tsx`.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {
  loadDiscussionCandidates,
  loadLinkedChat,
  setDiscussionGroup,
  unlinkDiscussionGroup,
  type AdminChat,
  type DiscussionCandidate
} from '$lib/telegram/admin';

import './ChatAdminDiscussion.css';

interface Props {
  chat: AdminChat;
  onchanged: () => void;
}

export function ChatAdminDiscussion({chat, onchanged}: Props) {
  const candidates = useSignal<DiscussionCandidate[]>([]);
  const linked = useSignal<DiscussionCandidate | null>(null);
  const loading = useSignal(true);
  const error = useSignal('');
  const busy = useSignal(false);

  // The linked chat lives on the channel's full info as a chat id. Read from the
  // `chat` prop rather than a signal, so it stays a plain constant.
  const linkedPeerId = chat.linkedChatId ? -chat.linkedChatId : 0;

  const currentPeerId = useRef(chat.peerId);
  currentPeerId.current = chat.peerId;

  useEffect(() => {
    const peerId = chat.peerId;
    const wanted = linkedPeerId;
    loading.value = true;
    error.value = '';

    // `getGroupsForDiscussion` only offers free groups, so the one already
    // linked has to be read separately or its name never shows.
    Promise.all([
      wanted ? Promise.resolve([]) : loadDiscussionCandidates(),
      loadLinkedChat(wanted)
    ])
      .then(([available, current]) => {
        if(peerId !== currentPeerId.current) return;
        candidates.value = available;
        linked.value = current;
      })
      .catch((err: any) => (error.value = err?.type || err?.message || 'Failed to load the groups'))
      .finally(() => (loading.value = false));
  }, [chat.peerId, linkedPeerId]);

  async function run(action: () => Promise<void>, fallback: string) {
    if(busy.value) return;
    busy.value = true;
    error.value = '';
    try {
      await action();
      onchanged();
    } catch(err: any) {
      error.value = err?.type || err?.message || fallback;
    } finally {
      busy.value = false;
    }
  }

  function link(candidate: DiscussionCandidate) {
    // Linking unhides the group's history: everyone who can read the channel
    // must be able to read the comments, and the API enforces it.
    if(!confirm(`Link “${candidate.title}” as the discussion group? Its past messages become visible to everyone.`)) {
      return;
    }
    run(() => setDiscussionGroup(chat.peerId, candidate.peerId), 'Failed to link the group');
  }

  const unlink = () =>
    run(() => unlinkDiscussionGroup(chat.peerId), 'Failed to unlink the group');

  return (
    <div class="pane">
      {linkedPeerId ?
        <>
          <p class="admin-label">Discussion group</p>
          <div class="admin-row">
            <span class="admin-peer">
              <Avatar peerId={linkedPeerId} title={linked.value?.title ?? 'Group'} size={32} />
              <span class="admin-name">
                <span>{linked.value?.title ?? 'Linked group'}</span>
                {linked.value?.username && <span class="admin-sub">@{linked.value.username}</span>}
              </span>
            </span>
            <button class="admin-btn danger" onClick={unlink} disabled={busy.value}>Unlink</button>
          </div>
          <p class="admin-hint">Comments on posts in this channel go to that group.</p>
        </> :
        <>
          <p class="admin-hint">
            Pick a group where readers can comment on the posts in this channel.
          </p>

          {loading.value ?
            <p class="admin-muted">Loading…</p> :
            !candidates.value.length ?
              <p class="admin-muted">No group you own can be linked.</p> :
              candidates.value.map((candidate) => (
                <div key={candidate.peerId} class="admin-row">
                  <span class="admin-peer">
                    <Avatar peerId={candidate.peerId} title={candidate.title} size={32} />
                    <span class="admin-name">
                      <span>{candidate.title}</span>
                      {candidate.username && <span class="admin-sub">@{candidate.username}</span>}
                    </span>
                  </span>
                  <button class="admin-btn" onClick={() => link(candidate)} disabled={busy.value}>Link</button>
                </div>
              ))}
        </>}

      {error.value && <p class="admin-error">{error.value}</p>}
    </div>
  );
}
