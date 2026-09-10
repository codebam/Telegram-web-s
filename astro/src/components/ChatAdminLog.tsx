/*
 * Ported from svelte/src/lib/components/ChatAdminLog.svelte.
 *
 * The `$effect` reads the `chat.peerId` prop, so it becomes a `useEffect` with
 * that in its dependency list — `useSignalEffect` tracks signal reads only. The
 * guard inside `.then()` compares the peer it loaded against the chat that is open
 * now, which a JSX closure cannot see, so the latest peer id is kept in a ref, as
 * in `Avatar.tsx`.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {formatDate, loadRecentActions, type AdminChat, type RecentAction} from '$lib/telegram/admin';

import './ChatAdminLog.css';

interface Props {
  chat: AdminChat;
  onpeer?: (peerId: number) => void;
}

export function ChatAdminLog({chat, onpeer}: Props) {
  const actions = useSignal<RecentAction[]>([]);
  const loading = useSignal(true);
  const error = useSignal('');

  const currentPeerId = useRef(chat.peerId);
  currentPeerId.current = chat.peerId;

  useEffect(() => {
    const peerId = chat.peerId;
    loading.value = true;
    error.value = '';

    loadRecentActions(peerId)
      .then((loaded) => {
        if(peerId === currentPeerId.current) actions.value = loaded;
      })
      .catch((err: any) => (error.value = err?.type || err?.message || 'Failed to load recent actions'))
      .finally(() => (loading.value = false));
  }, [chat.peerId]);

  return (
    <div class="pane">
      {loading.value ?
        <p class="admin-muted">Loading…</p> :
        error.value ?
          <p class="admin-error">{error.value}</p> :
          !actions.value.length ?
            <p class="admin-muted">Nothing has happened here yet.</p> :
            <>
              <p class="admin-hint">Admin actions from the last 48 hours.</p>

              {actions.value.map((action) => (
                <div key={action.id} class="event">
                  <button class="admin-peer" onClick={() => onpeer?.(action.peerId)}>
                    <Avatar peerId={action.peerId} title={action.title} size={28} />
                    <span class="admin-name">
                      <span><strong>{action.title}</strong> {action.text}</span>
                      <span class="admin-sub">{formatDate(action.date)}</span>
                    </span>
                  </button>
                  {action.detail && <p class="detail">{action.detail}</p>}
                </div>
              ))}
            </>}
    </div>
  );
}
