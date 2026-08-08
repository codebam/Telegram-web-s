<script lang="ts">
  import {onMount, tick} from 'svelte';

  import Avatar from './Avatar.svelte';
  import FormattedText from './FormattedText.svelte';
  import Media from './Media.svelte';
  import {
    deleteMessage,
    editMessage,
    getMessage,
    getPresence,
    loadDialogs,
    loadHistory,
    loadOlder,
    loadTopics,
    markRead,
    onNewMessage,
    onTyping,
    searchDialogs,
    sendFiles,
    sendMessage,
    sendTyping,
    type DialogItem,
    type MessageItem,
    type TopicItem
  } from '$lib/telegram/chats';

  let dialogs = $state<DialogItem[]>([]);
  let topics = $state<TopicItem[]>([]);
  let messages = $state<MessageItem[]>([]);

  let activePeerId = $state<number | null>(null);
  let activeThreadId = $state<number | undefined>(undefined);
  let activeTitle = $state('');
  let activeIsForum = $state(false);

  let loadingChats = $state(true);
  let loadingHistory = $state(false);
  let draft = $state('');
  let replyTo = $state<MessageItem | null>(null);
  let error = $state('');
  let scroller: HTMLDivElement | undefined = $state();
  /** First unread message id, used for the divider and the open position. */
  let firstUnreadMid = $state<number | null>(null);
  let pinned = false;
  let pinnedAnchor: number | null = null;
  let observer: ResizeObserver | undefined;

  let query = $state('');
  let searching = $state(false);
  let loadingOlder = $state(false);
  let reachedStart = $state(false);
  let presence = $state('');
  let typingNames = $state<string[]>([]);
  let editing = $state<MessageItem | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let dragging = $state(false);
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  // An async onMount callback cannot return a cleanup function (Svelte only
  // honours a synchronous return), so hold the unsubscribe in a local.
  onMount(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    (async () => {
      try {
        dialogs = await loadDialogs();
      } catch (err: any) {
        error = errorOf(err, 'Failed to load chats');
      } finally {
        loadingChats = false;
      }

      // Live updates append a single message instead of reloading the whole
      // history — no flicker, no lost scroll position, one round-trip per event.
      const off = await onNewMessage(async (peerId, mid, threadId) => {
        const isActive =
          peerId === activePeerId &&
          (activeThreadId === undefined || threadId === activeThreadId);

        if (isActive && !messages.some((m) => m.mid === mid)) {
          const item = await getMessage(peerId, mid);
          if (item) {
            const atBottom = isScrolledToBottom();
            messages = [...messages, item];
            if (atBottom) await scrollToBottom();
          }
        }

        dialogs = await loadDialogs();
      });

      const offTyping = await onTyping((peerId, threadId, names) => {
        if (peerId === activePeerId && (activeThreadId === undefined || threadId === activeThreadId)) {
          typingNames = names;
        }
      });

      const both = () => {
        off();
        offTyping();
      };

      if (disposed) both();
      else unsubscribe = both;
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      observer?.disconnect();
    };
  });

  /* ---------- search ---------- */

  function onQueryInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      searching = true;
      try {
        dialogs = await searchDialogs(query);
      } catch (err: any) {
        error = errorOf(err, 'Search failed');
      } finally {
        searching = false;
      }
    }, 250);
  }

  /* ---------- scrollback ---------- */

  async function maybeLoadOlder() {
    if (loadingOlder || reachedStart || !scroller || activePeerId === null) return;
    if (scroller.scrollTop > 200 || !messages.length) return;

    loadingOlder = true;
    const previousHeight = scroller.scrollHeight;
    const previousTop = scroller.scrollTop;

    try {
      const older = await loadOlder(activePeerId, messages[0].mid, {threadId: activeThreadId});
      const fresh = older.filter((m) => !messages.some((existing) => existing.mid === m.mid));

      if (!fresh.length) {
        reachedStart = true;
      } else {
        messages = [...fresh, ...messages];
        // Keep the viewport on the same message instead of jumping to the top.
        await tick();
        scroller.scrollTop = scroller.scrollHeight - previousHeight + previousTop;
      }
    } catch (err: any) {
      error = errorOf(err, 'Failed to load older messages');
    } finally {
      loadingOlder = false;
    }
  }

  /* ---------- attachments ---------- */

  async function attach(files: FileList | null) {
    if (!files?.length || activePeerId === null) return;

    const caption = draft.trim();
    draft = '';
    const replyToMsgId = replyTo?.mid;
    replyTo = null;

    try {
      await sendFiles(activePeerId, Array.from(files), {
        caption,
        threadId: activeThreadId,
        replyToMsgId
      });
    } catch (err: any) {
      error = errorOf(err, 'Upload failed');
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    attach(e.dataTransfer?.files ?? null);
  }

  /* ---------- message actions ---------- */

  function startEdit(message: MessageItem) {
    editing = message;
    replyTo = null;
    draft = message.text;
  }

  function cancelEdit() {
    editing = null;
    draft = '';
  }

  async function removeMessage(message: MessageItem) {
    if (activePeerId === null) return;
    try {
      await deleteMessage(activePeerId, message.mid);
      messages = messages.filter((m) => m.mid !== message.mid);
    } catch (err: any) {
      error = errorOf(err, 'Delete failed');
    }
  }

  function onDraftInput() {
    if (activePeerId === null || editing) return;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      sendTyping(activePeerId!, activeThreadId).catch(() => {});
    }, 300);
  }

  function errorOf(err: any, fallback: string) {
    return err?.type || err?.message || fallback;
  }

  async function openChat(dialog: DialogItem) {
    activePeerId = dialog.peerId;
    activeTitle = dialog.title;
    activeIsForum = dialog.isForum;
    activeThreadId = undefined;
    topics = [];
    messages = [];
    replyTo = null;
    error = '';

    if (dialog.isForum) {
      try {
        topics = await loadTopics(dialog.peerId);
      } catch (err: any) {
        error = errorOf(err, 'Failed to load topics');
      }
      return;
    }

    await openHistory(dialog.peerId, undefined, dialog.unread, dialog.readMaxId);
  }

  async function openTopic(topic: TopicItem) {
    activeThreadId = topic.threadId;
    activeTitle = topic.title;
    replyTo = null;
    await openHistory(activePeerId!, topic.threadId, topic.unread, 0);
  }

  async function openHistory(peerId: number, threadId?: number, unread = 0, readMaxId = 0) {
    loadingHistory = true;
    messages = [];
    firstUnreadMid = null;
    reachedStart = false;
    typingNames = [];
    editing = null;
    getPresence(peerId).then((info) => (presence = info.text)).catch(() => (presence = ''));

    try {
      messages = await loadHistory(peerId, {threadId});

      // Open on the first unread message, like the official clients — not at
      // the top, and not at the bottom when there is unread history.
      if (unread > 0 && readMaxId) {
        firstUnreadMid = messages.find((m) => m.mid > readMaxId && !m.out)?.mid ?? null;
      }

      await tick();
      pinScroll(firstUnreadMid);
      await markRead(peerId, threadId).catch(() => {});
    } catch (err: any) {
      error = errorOf(err, 'Failed to load messages');
    } finally {
      loadingHistory = false;
    }
  }

  function backToChats() {
    if (activeThreadId !== undefined) {
      activeThreadId = undefined;
      messages = [];
      const dialog = dialogs.find((d) => d.peerId === activePeerId);
      activeTitle = dialog?.title ?? '';
      return;
    }
    activePeerId = null;
    topics = [];
  }

  function isScrolledToBottom() {
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }

  async function scrollToBottom() {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  /**
   * Media resolves well after the first paint and keeps growing the list, so a
   * one-shot scrollTop assignment always lands short. Hold the anchor with a
   * ResizeObserver and release it only when the *user* scrolls — a timeout
   * loses the race against slow image downloads.
   */
  function pinScroll(anchorMid: number | null) {
    if (!scroller) return;

    pinnedAnchor = anchorMid;
    pinned = true;
    applyPin();

    observer?.disconnect();
    observer = new ResizeObserver(() => {
      if (pinned) applyPin();
    });
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);
  }

  function applyPin() {
    if (!scroller) return;

    if (pinnedAnchor !== null) {
      const el = scroller.querySelector<HTMLElement>(`[data-mid="${pinnedAnchor}"]`);
      if (el) {
        scroller.scrollTop = el.offsetTop - 12;
        return;
      }
    }
    scroller.scrollTop = scroller.scrollHeight;
  }

  /** A real user gesture releases the pin; scrolling back down restores it. */
  function releasePin() {
    pinned = false;
    pinnedAnchor = null;
  }

  function onScroll() {
    if (!pinned && isScrolledToBottom()) {
      pinned = true;
      pinnedAnchor = null;
    }
    maybeLoadOlder();
  }

  async function submit(e: Event) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || activePeerId === null) return;

    if (editing) {
      const target = editing;
      editing = null;
      draft = '';
      try {
        await editMessage(activePeerId, target.mid, text);
        const updated = await getMessage(activePeerId, target.mid);
        if (updated) messages = messages.map((m) => (m.mid === target.mid ? updated : m));
      } catch (err: any) {
        error = errorOf(err, 'Edit failed');
      }
      return;
    }

    const replyToMsgId = replyTo?.mid;
    draft = '';
    replyTo = null;

    try {
      await sendMessage(activePeerId, text, {replyToMsgId, threadId: activeThreadId});
      // The outgoing message arrives back through history_multiappend.
      await scrollToBottom();
    } catch (err: any) {
      error = errorOf(err, 'Failed to send');
    }
  }

  function timeOf(unix: number) {
    if (!unix) return '';
    return new Date(unix * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }
</script>

<div class="shell">
  <aside>
    <header>
      {#if activeIsForum && activePeerId !== null}
        <button class="back" onclick={backToChats} aria-label="Back">←</button>
        <span>{dialogs.find((d) => d.peerId === activePeerId)?.title ?? 'Topics'}</span>
      {:else}
        <span>Chats</span>
      {/if}
    </header>

    {#if !(activeIsForum && activePeerId !== null)}
      <div class="search">
        <input placeholder="Search chats" bind:value={query} oninput={onQueryInput} />
      </div>
    {/if}

    <div class="list">
      {#if loadingChats || searching}
        <p class="muted">Loading chats…</p>
      {:else if activeIsForum && activePeerId !== null}
        {#if !topics.length}
          <p class="muted">No topics.</p>
        {:else}
          {#each topics as topic (topic.threadId)}
            <button
              class="row-button"
              class:active={topic.threadId === activeThreadId}
              onclick={() => openTopic(topic)}
            >
              <span class="topic-glyph">#</span>
              <span class="meta">
                <span class="row">
                  <span class="title">{topic.title}</span>
                  <span class="time">{timeOf(topic.date)}</span>
                </span>
                <span class="row">
                  <span class="preview">{topic.preview}</span>
                  {#if topic.unread}<span class="badge">{topic.unread}</span>{/if}
                </span>
              </span>
            </button>
          {/each}
        {/if}
      {:else if !dialogs.length}
        <p class="muted">No chats yet.</p>
      {:else}
        {#each dialogs as dialog (dialog.peerId)}
          <button
            class="row-button"
            class:active={dialog.peerId === activePeerId}
            onclick={() => openChat(dialog)}
          >
            <Avatar peerId={dialog.peerId} title={dialog.title} />
            <span class="meta">
              <span class="row">
                <span class="title">{dialog.title}</span>
                <span class="time">{timeOf(dialog.date)}</span>
              </span>
              <span class="row">
                <span class="preview">{dialog.preview}</span>
                {#if dialog.unread}<span class="badge">{dialog.unread}</span>{/if}
              </span>
            </span>
          </button>
        {/each}
      {/if}
    </div>
  </aside>

  <section
    class:dragging
    ondragover={(e) => {
      e.preventDefault();
      dragging = activePeerId !== null;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
    aria-label="Conversation"
  >
    {#if activePeerId === null || (activeIsForum && activeThreadId === undefined)}
      <div class="empty">
        <p class="muted">{activeIsForum ? 'Select a topic' : 'Select a chat'}</p>
      </div>
    {:else}
      <header>
        <span>{activeTitle}</span>
        {#if activeThreadId !== undefined}<span class="thread-tag">topic</span>{/if}
        <span class="presence">
          {typingNames.length
            ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…`
            : presence}
        </span>
      </header>

      <div
        class="messages"
        bind:this={scroller}
        onscroll={onScroll}
        onwheel={releasePin}
        ontouchmove={releasePin}
        role="log"
        aria-label="Messages"
      >
        {#if loadingHistory}
          <p class="muted">Loading…</p>
        {:else}
          {#if loadingOlder}
            <p class="muted centered">Loading older…</p>
          {:else if reachedStart}
            <p class="muted centered">Beginning of the chat</p>
          {/if}
          {#each messages as message (message.mid)}
            {#if message.mid === firstUnreadMid}
              <p class="unread-divider" data-mid={message.mid}>Unread messages</p>
            {/if}
            {#if message.service}
              <p class="service" data-mid={message.mid}>{message.text}</p>
            {:else}
              <div class="bubble" class:out={message.out} data-mid={message.mid}>
                {#if !message.out && message.fromTitle}
                  <span class="author">{message.fromTitle}</span>
                {/if}

                {#if message.reply}
                  <span class="reply-quote">
                    <span class="reply-title">{message.reply.title}</span>
                    <span class="reply-text">{message.reply.text}</span>
                  </span>
                {/if}

                {#if message.media}
                  <Media peerId={activePeerId} mid={message.mid} media={message.media} />
                {/if}

                {#if message.parts.length}<FormattedText parts={message.parts} />{/if}

                <span class="stamp">
                  {#if message.repliesCount}
                    <span class="replies">{message.repliesCount} 💬</span>
                  {/if}
                  <button class="reply-btn" onclick={() => (replyTo = message)}>Reply</button>
                  {#if message.editable}
                    <button class="reply-btn" onclick={() => startEdit(message)}>Edit</button>
                    <button class="reply-btn" onclick={() => removeMessage(message)}>Delete</button>
                  {/if}
                  {#if message.edited}<span class="edited">edited</span>{/if}
                  <span class="time">{timeOf(message.date)}</span>
                </span>
              </div>
            {/if}
          {/each}
        {/if}
      </div>

      {#if replyTo || editing}
        <div class="reply-bar">
          <span class="reply-quote">
            <span class="reply-title">
              {editing ? 'Editing message' : `Replying to ${replyTo?.fromTitle}`}
            </span>
            <span class="reply-text">{(editing ?? replyTo)?.text || 'Media'}</span>
          </span>
          <button
            class="cancel"
            onclick={() => (editing ? cancelEdit() : (replyTo = null))}
            aria-label="Cancel"
          >✕</button>
        </div>
      {/if}

      <form onsubmit={submit}>
        <button
          type="button"
          class="attach"
          onclick={() => fileInput?.click()}
          aria-label="Attach file"
          disabled={!!editing}
        >📎</button>
        <input
          class="file"
          type="file"
          multiple
          bind:this={fileInput}
          onchange={(e) => attach((e.currentTarget as HTMLInputElement).files)}
        />
        <input placeholder="Message" bind:value={draft} oninput={onDraftInput} />
        <button type="submit" disabled={!draft.trim()}>{editing ? 'Save' : 'Send'}</button>
      </form>
    {/if}
  </section>
</div>

{#if error}<p class="error">{error}</p>{/if}

<style>
  /* 100dvh (not vh) so mobile browser chrome does not push the composer off
     screen, and min-height: 0 on every flex/grid child so the message list is
     what scrolls — without it the list forces the shell taller than the
     viewport and the whole page scrolls while history loads. */
  .shell {
    display: grid;
    grid-template-columns: minmax(240px, 340px) 1fr;
    height: 100dvh;
    max-height: 100dvh;
    overflow: hidden;
  }

  aside,
  section {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  aside {
    border-right: 1px solid var(--border);
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
    flex: none;
  }

  .back,
  .cancel {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 16px;
    padding: 0;
  }

  .thread-tag {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 1px 8px;
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .search {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .search input {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    outline: none;
  }

  .search input:focus {
    border-color: var(--accent);
  }

  .presence {
    margin-left: auto;
    font-size: 12px;
    font-weight: 400;
    color: var(--text-dim);
  }

  section.dragging {
    outline: 2px dashed var(--accent);
    outline-offset: -8px;
  }

  .attach {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
  }

  .attach:disabled {
    opacity: 0.4;
    cursor: default;
  }

  input.file {
    display: none;
  }

  .centered {
    align-self: center;
    padding: 6px;
    font-size: 12px;
  }

  .edited {
    font-style: italic;
  }

  .row-button {
    display: flex;
    gap: 12px;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    align-items: center;
    color: inherit;
  }

  .row-button:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .row-button.active {
    background: var(--accent);
    color: #fff;
  }

  .topic-glyph {
    width: 42px;
    height: 42px;
    flex: none;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 600;
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .meta {
    display: grid;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }

  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  }

  .title {
    font-weight: 600;
    font-size: 15px;
  }

  .title,
  .preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview,
  .time {
    font-size: 13px;
    color: var(--text-dim);
  }

  .row-button.active .preview,
  .row-button.active .time {
    color: rgba(255, 255, 255, 0.8);
  }

  .badge {
    flex: none;
    background: var(--accent);
    color: #fff;
    border-radius: 999px;
    padding: 1px 7px;
    font-size: 12px;
  }

  .row-button.active .badge {
    background: #fff;
    color: var(--accent);
  }

  .empty {
    display: grid;
    place-items: center;
    height: 100%;
  }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    /* Wide content (code blocks, long file names) scrolls inside its own
       bubble — the message list itself must never scroll sideways. */
    overflow-x: hidden;
    overscroll-behavior: contain;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .bubble {
    max-width: min(620px, 72%);
    min-width: 0;
    padding: 8px 12px;
    border-radius: 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    align-self: flex-start;
    display: grid;
    gap: 6px;
  }

  .bubble.out {
    align-self: flex-end;
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .author {
    font-size: 13px;
    font-weight: 600;
    color: var(--accent);
  }

  .bubble.out .author {
    color: rgba(255, 255, 255, 0.9);
  }

  .reply-quote {
    display: grid;
    gap: 1px;
    padding-left: 8px;
    border-left: 2px solid currentColor;
    font-size: 13px;
    opacity: 0.85;
    min-width: 0;
  }

  .reply-title {
    font-weight: 600;
  }

  .reply-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stamp {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: flex-end;
    font-size: 11px;
    opacity: 0.75;
  }

  .reply-btn {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    cursor: pointer;
    font-size: 11px;
    text-decoration: underline;
  }

  .service {
    align-self: center;
    color: var(--text-dim);
    font-size: 13px;
  }

  .unread-divider {
    align-self: stretch;
    margin: 6px 0;
    padding: 4px 0;
    text-align: center;
    font-size: 12px;
    color: var(--accent);
    border-top: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .reply-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 18px;
    border-top: 1px solid var(--border);
    flex: none;
  }

  .reply-bar .reply-quote {
    flex: 1;
    border-left-color: var(--accent);
  }

  form {
    display: flex;
    gap: 10px;
    padding: 14px 18px;
    border-top: 1px solid var(--border);
    flex: none;
  }

  form input {
    flex: 1;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    outline: none;
  }

  form input:focus {
    border-color: var(--accent);
  }

  form button {
    padding: 12px 20px;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }

  form button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .muted {
    color: var(--text-dim);
    padding: 16px;
  }

  .error {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 10px 16px;
    border-radius: 10px;
    background: var(--danger);
    color: #fff;
  }
</style>
