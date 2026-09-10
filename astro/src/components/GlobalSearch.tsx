/*
 * The sidebar's search pane: recent peers and top peers on an empty box,
 * and Chats / Global / Messages results once something is typed.
 *
 * It replaces the dialog list while searching rather than filtering it, so
 * results that are not dialogs at all — a public channel found by username,
 * a message from a chat far down the list — have somewhere to live.
 *
 * Ported from svelte/src/lib/components/GlobalSearch.svelte. Two mappings are
 * worth knowing when reading this:
 *  - the effect that debounces and re-runs the search keys off the `query`
 *    *prop*, not a signal, so it is a `useEffect` with `query` in its dependency
 *    list; `useSignalEffect` only tracks signal reads and would never re-run;
 *  - `runId` guarded every async result against a newer query in the Svelte
 *    component, whose body ran once per instance. A Preact body runs on every
 *    render, so the counter lives in a ref — as a plain local it would reset on
 *    each pass and the guard would never fire.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import {Avatar} from './Avatar';
import {
  addRecentSearch,
  clearRecentSearches,
  loadRecentSearches,
  loadTopPeers,
  removeRecentSearch,
  searchGlobalMessages,
  searchGlobalPeers,
  searchLocalPeers,
  type MessagePage,
  type MessageResultItem,
  type SearchPeerItem
} from '$lib/telegram/search';

import './GlobalSearch.css';

interface Props {
  query: string;
  onOpenPeer: (peerId: number) => void;
  onOpenMessage: (peerId: number, mid: number) => void;
}

type Tab = 'chats' | 'global' | 'messages';

export function GlobalSearch({query, onOpenPeer, onOpenMessage}: Props) {
  const tab = useSignal<Tab>('chats');
  const recent = useSignal<SearchPeerItem[]>([]);
  const top = useSignal<SearchPeerItem[]>([]);
  const localPeers = useSignal<SearchPeerItem[]>([]);
  const globalPeers = useSignal<SearchPeerItem[]>([]);
  const messages = useSignal<MessageResultItem[]>([]);
  const page = useSignal<MessagePage | null>(null);
  const loading = useSignal(false);
  const loadingMore = useSignal(false);
  const failed = useSignal('');

  // Guards every async result against a newer query having started meanwhile.
  const runId = useRef(0);

  async function refreshEmptyState() {
    const id = ++runId.current;
    const [recentPeers, topPeers] = await Promise.all([loadRecentSearches(), loadTopPeers()]);
    if(id !== runId.current) return;
    recent.value = recentPeers;
    top.value = topPeers;
  }

  async function run(trimmed: string) {
    const id = ++runId.current;
    loading.value = true;
    failed.value = '';

    try {
      const [chats, global, first] = await Promise.all([
        searchLocalPeers(trimmed),
        searchGlobalPeers(trimmed),
        searchGlobalMessages(trimmed)
      ]);
      if(id !== runId.current) return;

      localPeers.value = chats;
      globalPeers.value = global;
      messages.value = first.items;
      page.value = first;

      // Land on a tab that actually has something in it.
      if(!chats.length && tab.value === 'chats') tab.value = global.length ? 'global' : 'messages';
      else if(!global.length && tab.value === 'global') tab.value = chats.length ? 'chats' : 'messages';
    } catch(err: any) {
      if(id !== runId.current) return;
      failed.value = err?.message ?? 'Search failed';
    } finally {
      if(id === runId.current) loading.value = false;
    }
  }

  useEffect(() => {
    const trimmed = query.trim();

    if(!trimmed) {
      ++runId.current;
      loading.value = false;
      localPeers.value = [];
      globalPeers.value = [];
      messages.value = [];
      page.value = null;
      tab.value = 'chats';
      refreshEmptyState();
      return;
    }

    const timer = setTimeout(() => run(trimmed), 250);
    return () => clearTimeout(timer);
  }, [query]);

  /** Next page of message results, appended as the list is scrolled. */
  async function loadMoreMessages() {
    const current = page.value;
    if(!current || current.isEnd || loadingMore.value || loading.value) return;

    const id = runId.current;
    loadingMore.value = true;
    try {
      const next = await searchGlobalMessages(query, {
        offsetId: current.offsetId,
        offsetPeerId: current.offsetPeerId,
        nextRate: current.nextRate
      });
      if(id !== runId.current) return;

      const known = new Set(messages.value.map((item) => item.key));
      const fresh = next.items.filter((item) => !known.has(item.key));
      messages.value = [...messages.value, ...fresh];
      // The server can answer with nothing new even when it did not say "end";
      // treating that as the end stops an endless request loop at the bottom.
      page.value = {...next, isEnd: next.isEnd || !fresh.length};
    } catch(err: any) {
      failed.value = err?.message ?? 'Search failed';
    } finally {
      if(id === runId.current) loadingMore.value = false;
    }
  }

  function onScroll(e: Event) {
    if(tab.value !== 'messages') return;
    const el = e.currentTarget as HTMLElement;
    if(el.scrollHeight - el.scrollTop - el.clientHeight < 240) loadMoreMessages();
  }

  function openPeer(peerId: number) {
    addRecentSearch(peerId);
    onOpenPeer(peerId);
  }

  function openMessage(item: MessageResultItem) {
    addRecentSearch(item.peerId);
    onOpenMessage(item.peerId, item.message.mid);
  }

  function forget(peerId: number) {
    removeRecentSearch(peerId);
    recent.value = recent.value.filter((item) => item.peerId !== peerId);
  }

  function clearRecent() {
    clearRecentSearches();
    recent.value = [];
  }

  function timeOf(date: number): string {
    if(!date) return '';
    return new Date(date * 1000).toLocaleDateString([], {day: 'numeric', month: 'short'});
  }

  const empty = !query.trim();
  const counts = useComputed(() => ({
    chats: localPeers.value.length,
    global: globalPeers.value.length,
    messages: page.value?.count ?? messages.value.length
  }));

  const list = tab.value === 'chats' ? localPeers.value : globalPeers.value;

  return (
    <div class="global-search" onScroll={onScroll}>
      {empty ? (
        <>
          {recent.value.length ? (
            <>
              <div class="section-head">
                <span>Recent</span>
                <button class="link" onClick={clearRecent}>Clear</button>
              </div>
              {recent.value.map((item) => (
                <div class="recent-row" key={item.peerId}>
                  <button class="peer-row" onClick={() => openPeer(item.peerId)}>
                    <Avatar peerId={item.peerId} title={item.title} size={38} />
                    <span class="meta">
                      <span class="title">{item.title}</span>
                      <span class="subtitle">{item.subtitle}</span>
                    </span>
                  </button>
                  <button class="forget" onClick={() => forget(item.peerId)} aria-label="Remove from recent">✕</button>
                </div>
              ))}
            </>
          ) : null}

          {top.value.length ? (
            <>
              <div class="section-head"><span>People you talk to</span></div>
              <div class="top-peers">
                {top.value.map((item) => (
                  <button class="top-peer" key={item.peerId} onClick={() => openPeer(item.peerId)}>
                    <Avatar peerId={item.peerId} title={item.title} size={48} />
                    <span class="top-name">{item.title}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {!recent.value.length && !top.value.length ? (
            <p class="muted">Search for chats, channels and messages.</p>
          ) : null}
        </>
      ) : (
        <>
          <div class="tabs">
            <button class={tab.value === 'chats' ? 'active' : ''} onClick={() => (tab.value = 'chats')}>
              Chats{counts.value.chats ? ` ${counts.value.chats}` : ''}
            </button>
            <button class={tab.value === 'global' ? 'active' : ''} onClick={() => (tab.value = 'global')}>
              Global{counts.value.global ? ` ${counts.value.global}` : ''}
            </button>
            <button class={tab.value === 'messages' ? 'active' : ''} onClick={() => (tab.value = 'messages')}>
              Messages{counts.value.messages ? ` ${counts.value.messages}` : ''}
            </button>
          </div>

          {failed.value ? (
            <p class="muted">{failed.value}</p>
          ) : loading.value ? (
            <p class="muted">Searching…</p>
          ) : tab.value === 'messages' ? (
            !messages.value.length ? (
              <p class="muted">No messages found.</p>
            ) : (
              <>
                {messages.value.map((item) => (
                  <button class="peer-row" key={item.key} onClick={() => openMessage(item)}>
                    <Avatar peerId={item.peerId} title={item.chatTitle} size={38} />
                    <span class="meta">
                      <span class="row">
                        <span class="title">{item.chatTitle}</span>
                        <span class="time">{timeOf(item.message.date)}</span>
                      </span>
                      <span class="subtitle">
                        {!item.isUser && item.message.fromTitle ? <em>{item.message.fromTitle}:</em> : null}
                        {' '}{item.message.text || 'Media'}
                      </span>
                    </span>
                  </button>
                ))}
                {loadingMore.value ? <p class="muted">Loading more…</p> : null}
              </>
            )
          ) : !list.length ? (
            <p class="muted">{tab.value === 'chats' ? 'No chats found.' : 'Nothing public found.'}</p>
          ) : (
            list.map((item) => (
              <button class="peer-row" key={item.peerId} onClick={() => openPeer(item.peerId)}>
                <Avatar peerId={item.peerId} title={item.title} size={38} />
                <span class="meta">
                  <span class="title">{item.title}</span>
                  <span class="subtitle">{item.subtitle}</span>
                </span>
              </button>
            ))
          )}
        </>
      )}
    </div>
  );
}
