/*
 * Ported from svelte/src/lib/components/ChatAdminLog.svelte.
 *
 * The `$effect` reads the `chat.peerId` prop, so it becomes a `useEffect` with
 * that in its dependency list — `useSignalEffect` tracks signal reads only. The
 * guard inside `.then()` compares the peer it loaded against the chat that is open
 * now, which a JSX closure cannot see, so the latest peer id is kept in a ref, as
 * in `Avatar.tsx`.
 *
 * The log is paged and filtered here rather than all at once: the manager's
 * `getAdminLogs` keeps a fetcher per search/filter, so "load more" walks the same
 * cache the first page filled instead of refetching the head.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {
  ADMIN_LOG_FILTERS,
  formatDate,
  loadRecentActions,
  type AdminChat,
  type AdminLogFilterKey,
  type RecentAction
} from '$lib/telegram/admin';

import './ChatAdminLog.css';

interface Props {
  chat: AdminChat;
  onpeer?: (peerId: number) => void;
}

export function ChatAdminLog({chat, onpeer}: Props) {
  const actions = useSignal<RecentAction[]>([]);
  const loading = useSignal(true);
  const loadingMore = useSignal(false);
  const isEnd = useSignal(false);
  const error = useSignal('');

  // `query` is what is typed; `search` trails it by a beat so the server is not
  // asked once per keystroke.
  const query = useSignal('');
  const search = useSignal('');
  const filter = useSignal<AdminLogFilterKey | ''>('');

  const currentPeerId = useRef(chat.peerId);
  currentPeerId.current = chat.peerId;

  useEffect(() => {
    const handle = setTimeout(() => (search.value = query.value.trim()), 350);
    return () => clearTimeout(handle);
  }, [query.value]);

  useEffect(() => {
    const peerId = chat.peerId;
    loading.value = true;
    isEnd.value = false;
    error.value = '';

    loadRecentActions(peerId, {search: search.value, filter: filter.value || undefined})
      .then((page) => {
        if(peerId !== currentPeerId.current) return;
        actions.value = page.items;
        isEnd.value = page.isEnd;
      })
      .catch((err: any) => (error.value = err?.type || err?.message || 'Failed to load recent actions'))
      .finally(() => (loading.value = false));
  }, [chat.peerId, search.value, filter.value]);

  async function loadMore() {
    if(loadingMore.value || isEnd.value || !actions.value.length) return;
    const peerId = chat.peerId;
    loadingMore.value = true;
    error.value = '';

    try {
      const page = await loadRecentActions(peerId, {
        search: search.value,
        filter: filter.value || undefined,
        offsetId: actions.value[actions.value.length - 1].id
      });
      if(peerId !== currentPeerId.current) return;

      const seen = new Set(actions.value.map((action) => action.id));
      actions.value = [...actions.value, ...page.items.filter((action) => !seen.has(action.id))];
      isEnd.value = page.isEnd;
    } catch (err: any) {
      error.value = err?.type || err?.message || 'Failed to load more';
    } finally {
      loadingMore.value = false;
    }
  }

  return (
    <div class="pane">
      <label class="admin-field">
        <input
          value={query.value}
          onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
          placeholder="Search the log"
          spellcheck={false}
        />
      </label>

      <div class="admin-actions left">
        <button
          class={['admin-btn', filter.value === '' && 'primary'].filter(Boolean).join(' ')}
          onClick={() => (filter.value = '')}
        >
          All
        </button>
        {ADMIN_LOG_FILTERS.map((option) => (
          <button
            key={option.key}
            class={['admin-btn', filter.value === option.key && 'primary'].filter(Boolean).join(' ')}
            onClick={() => (filter.value = option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading.value ?
        <p class="admin-muted">Loading…</p> :
        error.value ?
          <p class="admin-error">{error.value}</p> :
          !actions.value.length ?
            <p class="admin-muted">
              {query.value.trim() || filter.value ?
                'No actions match.' :
                'Nothing has happened here yet.'}
            </p> :
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

              {!isEnd.value && (
                <div class="admin-actions">
                  <button class="admin-btn" onClick={loadMore} disabled={loadingMore.value}>
                    {loadingMore.value ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>}
    </div>
  );
}
