<script lang="ts">
  /**
   * The sidebar's search pane: recent peers and top peers on an empty box,
   * and Chats / Global / Messages results once something is typed.
   *
   * It replaces the dialog list while searching rather than filtering it, so
   * results that are not dialogs at all — a public channel found by username,
   * a message from a chat far down the list — have somewhere to live.
   */
  import Avatar from './Avatar.svelte';
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

  let {
    query,
    onOpenPeer,
    onOpenMessage
  }: {
    query: string;
    onOpenPeer: (peerId: number) => void;
    onOpenMessage: (peerId: number, mid: number) => void;
  } = $props();

  type Tab = 'chats' | 'global' | 'messages';

  let tab = $state<Tab>('chats');
  let recent = $state<SearchPeerItem[]>([]);
  let top = $state<SearchPeerItem[]>([]);
  let localPeers = $state<SearchPeerItem[]>([]);
  let globalPeers = $state<SearchPeerItem[]>([]);
  let messages = $state<MessageResultItem[]>([]);
  let page = $state<MessagePage | null>(null);
  let loading = $state(false);
  let loadingMore = $state(false);
  let failed = $state('');

  // Guards every async result against a newer query having started meanwhile.
  let runId = 0;

  async function refreshEmptyState() {
    const id = ++runId;
    const [recentPeers, topPeers] = await Promise.all([loadRecentSearches(), loadTopPeers()]);
    if (id !== runId) return;
    recent = recentPeers;
    top = topPeers;
  }

  async function run(trimmed: string) {
    const id = ++runId;
    loading = true;
    failed = '';

    try {
      const [chats, global, first] = await Promise.all([
        searchLocalPeers(trimmed),
        searchGlobalPeers(trimmed),
        searchGlobalMessages(trimmed)
      ]);
      if (id !== runId) return;

      localPeers = chats;
      globalPeers = global;
      messages = first.items;
      page = first;

      // Land on a tab that actually has something in it.
      if (!chats.length && tab === 'chats') tab = global.length ? 'global' : 'messages';
      else if (!global.length && tab === 'global') tab = chats.length ? 'chats' : 'messages';
    } catch (err: any) {
      if (id !== runId) return;
      failed = err?.message ?? 'Search failed';
    } finally {
      if (id === runId) loading = false;
    }
  }

  $effect(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      ++runId;
      loading = false;
      localPeers = [];
      globalPeers = [];
      messages = [];
      page = null;
      tab = 'chats';
      refreshEmptyState();
      return;
    }

    const timer = setTimeout(() => run(trimmed), 250);
    return () => clearTimeout(timer);
  });

  /** Next page of message results, appended as the list is scrolled. */
  async function loadMoreMessages() {
    const current = page;
    if (!current || current.isEnd || loadingMore || loading) return;

    const id = runId;
    loadingMore = true;
    try {
      const next = await searchGlobalMessages(query, {
        offsetId: current.offsetId,
        offsetPeerId: current.offsetPeerId,
        nextRate: current.nextRate
      });
      if (id !== runId) return;

      const known = new Set(messages.map((item) => item.key));
      const fresh = next.items.filter((item) => !known.has(item.key));
      messages = [...messages, ...fresh];
      // The server can answer with nothing new even when it did not say "end";
      // treating that as the end stops an endless request loop at the bottom.
      page = {...next, isEnd: next.isEnd || !fresh.length};
    } catch (err: any) {
      failed = err?.message ?? 'Search failed';
    } finally {
      if (id === runId) loadingMore = false;
    }
  }

  function onScroll(e: Event) {
    if (tab !== 'messages') return;
    const el = e.currentTarget as HTMLElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) loadMoreMessages();
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
    recent = recent.filter((item) => item.peerId !== peerId);
  }

  function clearRecent() {
    clearRecentSearches();
    recent = [];
  }

  function timeOf(date: number): string {
    if (!date) return '';
    return new Date(date * 1000).toLocaleDateString([], {day: 'numeric', month: 'short'});
  }

  const empty = $derived(!query.trim());
  const counts = $derived({
    chats: localPeers.length,
    global: globalPeers.length,
    messages: page?.count ?? messages.length
  });
</script>

<div class="global-search" onscroll={onScroll}>
  {#if empty}
    {#if recent.length}
      <div class="section-head">
        <span>Recent</span>
        <button class="link" onclick={clearRecent}>Clear</button>
      </div>
      {#each recent as item (item.peerId)}
        <div class="recent-row">
          <button class="peer-row" onclick={() => openPeer(item.peerId)}>
            <Avatar peerId={item.peerId} title={item.title} size={38} />
            <span class="meta">
              <span class="title">{item.title}</span>
              <span class="subtitle">{item.subtitle}</span>
            </span>
          </button>
          <button class="forget" onclick={() => forget(item.peerId)} aria-label="Remove from recent">✕</button>
        </div>
      {/each}
    {/if}

    {#if top.length}
      <div class="section-head"><span>People you talk to</span></div>
      <div class="top-peers">
        {#each top as item (item.peerId)}
          <button class="top-peer" onclick={() => openPeer(item.peerId)}>
            <Avatar peerId={item.peerId} title={item.title} size={48} />
            <span class="top-name">{item.title}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if !recent.length && !top.length}
      <p class="muted">Search for chats, channels and messages.</p>
    {/if}
  {:else}
    <div class="tabs">
      <button class:active={tab === 'chats'} onclick={() => (tab = 'chats')}>
        Chats{counts.chats ? ` ${counts.chats}` : ''}
      </button>
      <button class:active={tab === 'global'} onclick={() => (tab = 'global')}>
        Global{counts.global ? ` ${counts.global}` : ''}
      </button>
      <button class:active={tab === 'messages'} onclick={() => (tab = 'messages')}>
        Messages{counts.messages ? ` ${counts.messages}` : ''}
      </button>
    </div>

    {#if failed}
      <p class="muted">{failed}</p>
    {:else if loading}
      <p class="muted">Searching…</p>
    {:else if tab === 'messages'}
      {#if !messages.length}
        <p class="muted">No messages found.</p>
      {:else}
        {#each messages as item (item.key)}
          <button class="peer-row" onclick={() => openMessage(item)}>
            <Avatar peerId={item.peerId} title={item.chatTitle} size={38} />
            <span class="meta">
              <span class="row">
                <span class="title">{item.chatTitle}</span>
                <span class="time">{timeOf(item.message.date)}</span>
              </span>
              <span class="subtitle">
                {#if !item.isUser && item.message.fromTitle}<em>{item.message.fromTitle}:</em>{/if}
                {item.message.text || 'Media'}
              </span>
            </span>
          </button>
        {/each}
        {#if loadingMore}<p class="muted">Loading more…</p>{/if}
      {/if}
    {:else}
      {@const list = tab === 'chats' ? localPeers : globalPeers}
      {#if !list.length}
        <p class="muted">{tab === 'chats' ? 'No chats found.' : 'Nothing public found.'}</p>
      {:else}
        {#each list as item (item.peerId)}
          <button class="peer-row" onclick={() => openPeer(item.peerId)}>
            <Avatar peerId={item.peerId} title={item.title} size={38} />
            <span class="meta">
              <span class="title">{item.title}</span>
              <span class="subtitle">{item.subtitle}</span>
            </span>
          </button>
        {/each}
      {/if}
    {/if}
  {/if}
</div>

<style>
  .global-search {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 4px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .link {
    background: none;
    border: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
    padding: 0;
  }

  .tabs {
    display: flex;
    gap: 4px;
    padding: 8px 10px;
    position: sticky;
    top: 0;
    background: var(--bg-solid);
    z-index: 1;
  }

  .tabs button {
    flex: 1;
    border: 0;
    border-radius: 8px;
    padding: 6px 8px;
    font-size: 13px;
    cursor: pointer;
    background: transparent;
    color: inherit;
    opacity: 0.7;
  }

  .tabs button.active {
    background: var(--row-active);
    opacity: 1;
  }

  .recent-row {
    display: flex;
    align-items: center;
  }

  .peer-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 14px;
    background: none;
    border: 0;
    color: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }

  .peer-row:hover {
    background: var(--bg-elevated);
  }

  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtitle {
    font-size: 12px;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .time {
    font-size: 11px;
    color: var(--text-dim);
    flex: none;
  }

  .forget {
    background: none;
    border: 0;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0 12px;
  }

  .top-peers {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 4px 10px 10px;
  }

  .top-peer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 68px;
    flex: none;
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
  }

  .top-name {
    font-size: 11px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    padding: 14px;
    color: var(--text-dim);
    font-size: 13px;
  }
</style>
