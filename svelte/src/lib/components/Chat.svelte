<script lang="ts">
  import {onMount, tick} from 'svelte';

  import Avatar from './Avatar.svelte';
  import ChatInfo from './ChatInfo.svelte';
  import FolderEditor from './FolderEditor.svelte';
  import FormattedText from './FormattedText.svelte';
  import Lightbox from './Lightbox.svelte';
  import Media from './Media.svelte';
  import CallScreen from './CallScreen.svelte';
  import MiniApp from './MiniApp.svelte';
  import PeerPicker from './PeerPicker.svelte';
  import SendFiles from './SendFiles.svelte';
  import Settings from './Settings.svelte';
  import Stories from './Stories.svelte';
  import Picker from './Picker.svelte';
  import Sticker from './Sticker.svelte';
  import {
    availableReactions,
    deleteMessage,
    deleteMessages,
    forwardMessage,
    getDraftText,
    editMessage,
    getMessage,
    getPeerBrief,
    getPresence,
    getReadOutboxMaxId,
    leaveOrDelete,
    loadDialogs,
    loadAround,
    loadFolders,
    loadHistory,
    loadPinned,
    loadOlder,
    loadTopics,
    markDialogRead,
    markDialogUnread,
    onDialogsUpdate,
    onFoldersUpdate,
    onMessageSent,
    onMessagesDeleted,
    onNewMessage,
    onReadStateChange,
    readParticipants,
    onTyping,
    onUserUpdate,
    openDiscussion,
    readUpTo,
    saveDraftText,
    searchMessages,
    setOwnOnline,
    searchDialogs,
    sendDocument,
    sendFiles,
    sendMessage,
    sendTyping,
    toggleMute,
    togglePin,
    toggleReaction,
    votePoll,
    type DialogItem,
    type FolderItem,
    type MessageItem,
    type TopicItem
  } from '$lib/telegram/chats';
  import {
    notifyMessage,
    setActiveNotificationPeer
  } from '$lib/telegram/notifications';
  import {queryInlineBot, sendInlineResult, type InlineResultItem} from '$lib/telegram/settings';
  import {applyAccent, applyDensity, applyTheme} from '$lib/telegram/theme';
  import {startCall} from '$lib/telegram/extras';

  let dialogs = $state<DialogItem[]>([]);
  let topics = $state<TopicItem[]>([]);
  let messages = $state<MessageItem[]>([]);

  let activePeerId = $state<number | null>(null);
  let activeThreadId = $state<number | undefined>(undefined);
  let activeTitle = $state('');
  let activeIsForum = $state(false);
  /** Calls are one-to-one only, and never to Saved Messages. */
  let activeIsUser = $state(false);
  let activeIsSelf = $state(false);
  /**
   * Highest outgoing message the other side has read. In a group this is the
   * position up to which *everyone* has read, which is what the second tick
   * means there too.
   */
  let readOutboxMaxId = $state(0);
  let activeIsChannel = $state(false);
  /** Names of the people who have read a message, fetched on demand. */
  let readByFor = $state<{mid: number; names: string[]} | null>(null);

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
  let composer: HTMLTextAreaElement | undefined = $state();
  let dragging = $state(false);
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  let folders = $state<FolderItem[]>([]);
  let activeFolder = $state(0);
  let editingFolder = $state<FolderItem | null>(null);
  let allDialogs = $state<DialogItem[]>([]);
  let folderEditorOpen = $state(false);
  let menuFor = $state<DialogItem | null>(null);
  let showInfo = $state(false);
  /** Profile being viewed from a message sender or member list, if any. */
  let profilePeerId = $state<number | null>(null);
  let showPicker = $state(false);
  let reactionPalette = $state<string[]>([]);
  let reactingTo = $state<number | null>(null);
  let lightboxIndex = $state<number | null>(null);
  let highlightedMid = $state<number | null>(null);
  let pinnedMessage = $state<MessageItem | null>(null);
  let forwarding = $state<MessageItem | null>(null);
  let atBottom = $state(true);
  let chatQuery = $state('');
  let chatResults = $state<MessageItem[] | null>(null);
  let chatSearchOpen = $state(false);
  let chatSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let selecting = $state(false);
  let selected = $state<Set<number>>(new Set());
  let messageMenu = $state<{mid: number; x: number; y: number} | null>(null);
  let lastTypingSent = 0;
  let showSidebarOnMobile = $state(true);
  let showSettings = $state(false);
  let miniAppBotId = $state<number | null>(null);
  let inlineResults = $state<InlineResultItem[]>([]);
  let inlineBot = $state('');
  let inlineTimer: ReturnType<typeof setTimeout> | undefined;
  /** Files queued by paste, drop or the attach button, pending confirmation. */
  let pendingFiles = $state<File[]>([]);

  /** Media messages in order — the lightbox pages through these. */
  const mediaMessages = $derived(
    messages.filter(
      (m) =>
        m.media &&
        (m.media.kind === 'photo' || m.media.kind === 'video' || m.media.kind === 'gif') &&
        !m.stickerDocId
    )
  );

  /**
   * Albums: Telegram sends each item of a media group as its own message with a
   * shared grouped_id. Collapse consecutive ones into a single render unit.
   */
  const rendered = $derived.by(() => {
    const groups: {key: string; items: MessageItem[]}[] = [];

    for (const message of messages) {
      const previous = groups[groups.length - 1];
      if (message.groupedId && previous?.items[0]?.groupedId === message.groupedId) {
        previous.items.push(message);
      } else {
        groups.push({key: `${message.mid}`, items: [message]});
      }
    }

    return groups;
  });

  /**
   * Insert or replace a message by id.
   *
   * Both the append event and the send confirmation can deliver the same
   * message, and each re-checks membership only before its own await — so the
   * loser of that race used to append a second copy. Duplicate ids then break
   * the keyed each block, which stops rendering entirely rather than showing
   * two bubbles. Every write goes through here so that cannot happen.
   */
  function upsertMessage(item: MessageItem) {
    const index = messages.findIndex((m) => m.mid === item.mid);
    if (index === -1) messages = [...messages, item];
    else messages = messages.map((m, i) => (i === index ? item : m));
  }

  /* ---------- read tracking ---------- */

  let readObserver: IntersectionObserver | undefined;
  let pendingReadMid = 0;
  let readTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Mark read from what is actually on screen. Opening a chat must not mark
   * hundreds of unseen messages read, so the highest *visible* incoming mid is
   * debounced into readHistory instead of calling readAllHistory on open.
   */
  function observeForRead(node: HTMLElement, mid: number) {
    node.dataset.readMid = String(mid);
    // Created lazily: message elements mount before the scroller's bind:this is
    // assigned, so an observer built in openHistory would miss every node.
    ensureReadObserver().observe(node);

    return {
      destroy() {
        readObserver?.unobserve(node);
      }
    };
  }

  function ensureReadObserver(): IntersectionObserver {
    // root: null (the viewport) rather than the scroller — the scroller fills
    // the viewport, and it avoids depending on bind:this timing.
    return (readObserver ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const mid = Number((entry.target as HTMLElement).dataset.readMid ?? 0);
          if (mid > pendingReadMid) pendingReadMid = mid;
        }
        flushRead();
      },
      {threshold: 0.5}
    ));
  }

  function flushRead() {
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      if (!pendingReadMid || activePeerId === null) return;
      const mid = pendingReadMid;
      pendingReadMid = 0;
      try {
        await readUpTo(activePeerId, mid, activeThreadId);
        // dialogs_multiupdate does not always fire for our own read, so refresh
        // the list explicitly to clear the badge.
        dialogs = await loadDialogs(40, activeFolder);
      } catch (err) {
        // Read receipts are best-effort; a failure must not break the view.
      }
    }, 400);
  }

  // An async onMount callback cannot return a cleanup function (Svelte only
  // honours a synchronous return), so hold the unsubscribe in a local.
  onMount(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;
    const stopPresence = trackOwnPresence();
    applyTheme();
    applyAccent();
    applyDensity();

    (async () => {
      try {
        [dialogs, folders, reactionPalette] = await Promise.all([
          loadDialogs(),
          loadFolders(),
          availableReactions()
        ]);
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
            const wasAtBottom = isScrolledToBottom();
            upsertMessage(item);
            if (wasAtBottom) await scrollToBottom();
          }
        }

        // Desktop notification for anything not already on screen.
        if (!isActive) {
          const item = await getMessage(peerId, mid);
          const dialog = dialogs.find((d) => d.peerId === peerId);
          if (item && !item.out && !dialog?.muted) {
            notifyMessage({
              title: dialog?.title ?? item.fromTitle,
              body: item.text || 'Media',
              peerId,
              onclick: () => {
                const target = dialogs.find((d) => d.peerId === peerId);
                if (target) openChat(target);
              }
            });
          }
        }

        dialogs = await loadDialogs(40, activeFolder);
      });

      // Unread counts change from other devices too — keep the list honest.
      const offDialogs = await onDialogsUpdate(async () => {
        dialogs = await loadDialogs(40, activeFolder);
        folders = await loadFolders();
      });

      // Folders can be created or edited from another client.
      const offFolders = await onFoldersUpdate(async () => {
        folders = await loadFolders();
        if (!folders.some((f) => f.id === activeFolder)) activeFolder = 0;
      });

      // A sent message first appears under a temporary id, then the server
      // confirms it under a real one. Drop the temporary copy first and
      // unconditionally — bailing out when the confirmed message is not
      // readable yet leaves the optimistic copy on screen, stuck on "Sending".
      const offSent = await onMessageSent(async (peerId, tempId, mid) => {
        if (peerId !== activePeerId) return;

        messages = messages.filter((m) => m.mid !== tempId);

        const confirmed = await getMessage(peerId, mid);
        if (confirmed) upsertMessage(confirmed);
      });

      const offDeleted = await onMessagesDeleted((peerId, mids) => {
        if (peerId === activePeerId) {
          messages = messages.filter((m) => !mids.includes(m.mid));
        }
        loadDialogs(40, activeFolder).then((list) => (dialogs = list)).catch(() => {});
      });

      const offRead = await onReadStateChange(async () => {
        if (activePeerId !== null) readOutboxMaxId = await getReadOutboxMaxId(activePeerId);
      });

      const offUsers = await onUserUpdate(async (userId) => {
        if (userId === activePeerId) {
          presence = (await getPresence(userId)).text;
        }
      });

      const offTyping = await onTyping((peerId, threadId, names) => {
        if (peerId === activePeerId && (activeThreadId === undefined || threadId === activeThreadId)) {
          typingNames = names;
        }
      });

      const all = () => {
        off();
        offTyping();
        offDialogs();
        offFolders();
        offUsers();
        offRead();
        offSent();
        offDeleted();
      };

      if (disposed) all();
      else unsubscribe = all;
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      stopPresence();
      observer?.disconnect();
      readObserver?.disconnect();
    };
  });

  /* ---------- folders and chat-list actions ---------- */

  async function openFolder(folder: FolderItem) {
    activeFolder = folder.id;
    query = '';
    loadingChats = true;
    try {
      dialogs = await loadDialogs(40, folder.id);
    } catch (err: any) {
      error = errorOf(err, 'Failed to load folder');
    } finally {
      loadingChats = false;
    }
  }

  async function openFolderEditor(folder: FolderItem | null) {
    editingFolder = folder;
    // The editor picks from every chat, not just the folder currently shown.
    allDialogs = await loadDialogs(100, 0);
    folderEditorOpen = true;
  }

  async function onFolderSaved() {
    folderEditorOpen = false;
    editingFolder = null;
    folders = await loadFolders();
    if (!folders.some((f) => f.id === activeFolder)) {
      await openFolder(folders[0]);
    }
  }

  async function runDialogAction(action: () => Promise<void>) {
    menuFor = null;
    try {
      await action();
      dialogs = await loadDialogs(40, activeFolder);
    } catch (err: any) {
      error = errorOf(err, 'Action failed');
    }
  }

  /* ---------- stickers, GIFs, reactions ---------- */

  async function pickDocument(docId: string) {
    if (activePeerId === null) return;
    showPicker = false;
    const replyToMsgId = replyTo?.mid;
    replyTo = null;

    try {
      await sendDocument(activePeerId, docId, {threadId: activeThreadId, replyToMsgId});
    } catch (err: any) {
      error = errorOf(err, 'Failed to send');
    }
  }

  async function react(message: MessageItem, emoticon: string) {
    if (activePeerId === null) return;
    reactingTo = null;
    try {
      await toggleReaction(activePeerId, message.mid, emoticon);
      const updated = await getMessage(activePeerId, message.mid);
      if (updated) messages = messages.map((m) => (m.mid === message.mid ? updated : m));
    } catch (err: any) {
      error = errorOf(err, 'Reaction failed');
    }
  }

  /** True when the previous rendered group came from the same sender. */
  function sameSenderAsPrevious(group: {items: MessageItem[]}): boolean {
    const index = rendered.indexOf(group);
    const previous = rendered[index - 1]?.items[0];
    return !!previous && !previous.service && previous.fromId === group.items[0].fromId;
  }

  /* ---------- own presence ---------- */

  /**
   * Publish our own online status: once on load, refreshed every minute (the
   * server expires it), and switched to offline when the tab is hidden or
   * unloaded so contacts do not see us online forever.
   */
  function trackOwnPresence() {
    let timer: ReturnType<typeof setInterval> | undefined;

    const goOnline = () => setOwnOnline(true).catch(() => {});
    const goOffline = () => setOwnOnline(false).catch(() => {});

    const onVisibility = () => {
      if (document.hidden) goOffline();
      else goOnline();
    };

    goOnline();
    timer = setInterval(() => {
      if (!document.hidden) goOnline();
    }, 60_000);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', goOffline);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', goOffline);
      goOffline();
    };
  }

  /* ---------- in-chat search ---------- */

  function onChatQueryInput() {
    clearTimeout(chatSearchTimer);
    chatSearchTimer = setTimeout(async () => {
      if (activePeerId === null || !chatQuery.trim()) {
        chatResults = null;
        return;
      }
      try {
        chatResults = await searchMessages(activePeerId, chatQuery, {threadId: activeThreadId});
      } catch (err: any) {
        error = errorOf(err, 'Search failed');
      }
    }, 300);
  }

  function closeChatSearch() {
    chatSearchOpen = false;
    chatQuery = '';
    chatResults = null;
  }

  /* ---------- selection ---------- */

  function toggleSelected(mid: number) {
    const next = new Set(selected);
    if (next.has(mid)) next.delete(mid);
    else next.add(mid);
    selected = next;
    if (!next.size) selecting = false;
  }

  function startSelecting(mid: number) {
    selecting = true;
    selected = new Set([mid]);
    messageMenu = null;
  }

  async function deleteSelected() {
    if (activePeerId === null || !selected.size) return;
    const mids = [...selected];
    selecting = false;
    selected = new Set();

    try {
      await deleteMessages(activePeerId, mids);
      messages = messages.filter((m) => !mids.includes(m.mid));
    } catch (err: any) {
      error = errorOf(err, 'Delete failed');
    }
  }

  async function forwardSelected() {
    if (!selected.size) return;
    forwarding = messages.find((m) => selected.has(m.mid)) ?? null;
    allDialogs = await loadDialogs(100, 0);
  }

  /* ---------- polls and discussions ---------- */

  async function vote(message: MessageItem, index: number) {
    if (activePeerId === null || message.poll?.closed) return;
    try {
      await votePoll(activePeerId, message.mid, [index]);
      const updated = await getMessage(activePeerId, message.mid);
      if (updated) messages = messages.map((m) => (m.mid === message.mid ? updated : m));
    } catch (err: any) {
      error = errorOf(err, 'Vote failed');
    }
  }

  async function openComments(message: MessageItem) {
    if (activePeerId === null) return;
    try {
      const discussion = await openDiscussion(activePeerId, message.mid);
      if (!discussion) {
        error = 'No discussion for this post';
        return;
      }
      activePeerId = discussion.peerId;
      activeThreadId = discussion.threadId;
      activeTitle = 'Comments';
      activeIsForum = false;
      await openHistory(discussion.peerId, discussion.threadId);
    } catch (err: any) {
      error = errorOf(err, 'Could not open comments');
    }
  }

  /* ---------- jumping to a message ---------- */

  /**
   * Scroll to `mid`, loading the surrounding history first when it is not in
   * the currently loaded window (a reply can point far above what is loaded).
   */
  async function jumpTo(mid: number) {
    if (activePeerId === null) return;

    if (!messages.some((m) => m.mid === mid)) {
      loadingHistory = true;
      try {
        messages = await loadAround(activePeerId, mid, {threadId: activeThreadId});
        reachedStart = false;
      } catch (err: any) {
        error = errorOf(err, 'Could not load that message');
        return;
      } finally {
        loadingHistory = false;
      }
      await tick();
    }

    releasePin();
    const node = scroller?.querySelector<HTMLElement>(`[data-mid="${mid}"]`);
    if (!node) return;

    node.scrollIntoView({block: 'center', behavior: 'smooth'});
    highlightedMid = mid;
    setTimeout(() => {
      if (highlightedMid === mid) highlightedMid = null;
    }, 1600);
  }

  /* ---------- forward and copy ---------- */

  async function openForward(message: MessageItem) {
    forwarding = message;
    allDialogs = await loadDialogs(100, 0);
  }

  async function doForward(toPeerId: number) {
    const message = forwarding;
    const mids = selecting && selected.size ? [...selected] : message ? [message.mid] : [];
    forwarding = null;
    selecting = false;
    selected = new Set();
    if (!mids.length || activePeerId === null) return;

    try {
      await forwardMessage(activePeerId, mids, toPeerId);
    } catch (err: any) {
      error = errorOf(err, 'Forward failed');
    }
  }

  async function copyText(message: MessageItem) {
    try {
      await navigator.clipboard.writeText(message.text);
    } catch (err) {
      error = 'Clipboard unavailable';
    }
  }

  /* ---------- date separators ---------- */

  function dayOf(unix: number) {
    return new Date(unix * 1000).toDateString();
  }

  function dayLabel(unix: number) {
    const date = new Date(unix * 1000);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], {day: 'numeric', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric'});
  }

  /** True when this group starts a new calendar day. */
  function startsNewDay(index: number): boolean {
    if (index === 0) return true;
    const previous = rendered[index - 1]?.items[0];
    const current = rendered[index]?.items[0];
    return !!previous && !!current && dayOf(previous.date) !== dayOf(current.date);
  }

  /**
   * Open any peer as a chat, even one with no dialog yet — clicking a group
   * member you have never messaged should still land in a conversation.
   */
  async function openPeerChat(peerId: number) {
    profilePeerId = null;
    showInfo = false;
    showSidebarOnMobile = false;

    try {
      const brief = await getPeerBrief(peerId);
      activePeerId = brief.peerId;
      activeTitle = brief.title;
      activeIsUser = brief.isUser;
      activeIsSelf = brief.isSelf;
      activeIsChannel = brief.isBroadcast;
      activeIsForum = brief.isForum;
      activeThreadId = undefined;
      topics = [];
      replyTo = null;

      if (brief.isForum) {
        topics = await loadTopics(peerId);
        return;
      }

      await openHistory(peerId);
    } catch (err: any) {
      error = errorOf(err, 'Could not open that chat');
    }
  }

  /** Small groups can list who has read a message; larger ones cannot. */
  async function showReadBy(message: MessageItem) {
    if (activePeerId === null || activeIsUser) return;

    if (readByFor?.mid === message.mid) {
      readByFor = null;
      return;
    }

    const names = await readParticipants(activePeerId, message.mid);
    readByFor = {mid: message.mid, names};
  }

  function openLightbox(message: MessageItem) {
    const index = mediaMessages.findIndex((m) => m.mid === message.mid);
    if (index >= 0) lightboxIndex = index;
  }

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

  /** Queue files for confirmation rather than sending them blind. */
  function attach(files: FileList | File[] | null) {
    if (!files || activePeerId === null) return;
    const list = Array.from(files);
    if (list.length) pendingFiles = list;
  }

  async function confirmSend(files: File[], asPhoto: boolean, caption: string) {
    pendingFiles = [];
    if (activePeerId === null) return;

    const replyToMsgId = replyTo?.mid;
    replyTo = null;
    draft = '';

    try {
      await sendFiles(activePeerId, files, {
        caption,
        asPhoto,
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

  /**
   * Ctrl+V anywhere in the chat. Clipboard images arrive as items with no
   * filename, so give them one — otherwise the upload has nothing to show.
   */
  function onPaste(e: ClipboardEvent) {
    if (activePeerId === null || !e.clipboardData) return;

    const files = Array.from(e.clipboardData.files);
    const items = files.length ? files : Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    if (!items.length) return;

    e.preventDefault();
    attach(items.map((file, index) => file.name ?
      file :
      new File([file], `pasted-${index + 1}.${(file.type.split('/')[1] || 'bin')}`, {type: file.type})
    ));
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

  /**
   * Inline bots: "@botname query" in the composer queries that bot and shows
   * its results above the input.
   */
  function onInlineInput() {
    const match = /^@(\w{3,32})\s+(.*)$/.exec(draft);
    clearTimeout(inlineTimer);

    if (!match || activePeerId === null) {
      inlineResults = [];
      inlineBot = '';
      return;
    }

    const [, bot, query] = match;
    inlineBot = bot;
    inlineTimer = setTimeout(async () => {
      inlineResults = await queryInlineBot(activePeerId!, bot, query);
    }, 400);
  }

  async function pickInline(result: InlineResultItem) {
    if (activePeerId === null) return;
    const bot = inlineBot;
    inlineResults = [];
    draft = '';

    try {
      await sendInlineResult(activePeerId, bot, result.queryAndResultId);
    } catch (err: any) {
      error = errorOf(err, 'Failed to send inline result');
    }
  }

  /**
   * Ctrl+Up / Ctrl+Down walks the reply target through recent messages, like
   * the desktop client. Ctrl+Up from nothing selects the newest message.
   */
  function onComposerKey(e: KeyboardEvent) {
    // Enter sends; Shift+Enter (or Ctrl/Cmd+Enter) inserts a newline. isComposing
    // guards IME candidate selection, which also arrives as Enter.
    if (e.key === 'Enter' && !e.isComposing) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      submit(e);
      return;
    }

    if (!e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (!messages.length) return;
    e.preventDefault();

    const order = messages.filter((m) => !m.service);
    if (!order.length) return;

    const current = replyTo ? order.findIndex((m) => m.mid === replyTo!.mid) : order.length;
    const next = e.key === 'ArrowUp' ? current - 1 : current + 1;

    if (next < 0) return;
    if (next >= order.length) {
      replyTo = null;
      return;
    }

    replyTo = order[next];
    jumpTo(order[next].mid);
  }

  /** Grow with the content instead of scrolling a single line. */
  function resizeComposer() {
    if (!composer) return;
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`;
  }

  // Also runs when the draft is set from elsewhere: restoring a draft, editing
  // a message, or picking an emoji.
  $effect(() => {
    void draft;
    resizeComposer();
  });

  function onDraftInput() {
    resizeComposer();
    onInlineInput();
    if (activePeerId === null || editing) return;

    // The server expires a typing status after ~6s, so keep re-sending while
    // the user is still typing rather than firing once per keystroke.
    const now = Date.now();
    if (now - lastTypingSent > 4000) {
      lastTypingSent = now;
      sendTyping(activePeerId, activeThreadId).catch(() => {});
    }

    // Persist the draft so it survives switching chats or reloading.
    clearTimeout(typingTimer);
    const peerId = activePeerId;
    const threadId = activeThreadId;
    const text = draft;
    typingTimer = setTimeout(() => {
      saveDraftText(peerId, threadId, text).catch(() => {});
    }, 700);
  }

  function errorOf(err: any, fallback: string) {
    return err?.type || err?.message || fallback;
  }

  async function openChat(dialog: DialogItem) {
    // On a phone the two panes are stacked; opening a chat swaps the view.
    showSidebarOnMobile = false;
    activePeerId = dialog.peerId;
    activeTitle = dialog.title;
    activeIsForum = dialog.isForum;
    activeIsUser = dialog.isUser;
    activeIsSelf = dialog.isSelf;
    readOutboxMaxId = dialog.readOutboxMaxId;
    // Only real broadcast channels swap ticks for view counts; megagroups are
    // negative-id peers too, so the id sign cannot be used to tell them apart.
    activeIsChannel = dialog.isBroadcast;
    readByFor = null;
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
    loadPinned(peerId, threadId).then((message) => (pinnedMessage = message)).catch(() => (pinnedMessage = null));
    setActiveNotificationPeer(peerId);
    getReadOutboxMaxId(peerId).then((maxId) => {
      if (activePeerId === peerId) readOutboxMaxId = maxId;
    }).catch(() => {});
    getDraftText(peerId, threadId).then((text) => {
      if (activePeerId === peerId && activeThreadId === threadId) draft = text;
    }).catch(() => {});

    try {
      messages = await loadHistory(peerId, {threadId});

      // Open on the first unread message, like the official clients — not at
      // the top, and not at the bottom when there is unread history.
      if (unread > 0 && readMaxId) {
        firstUnreadMid = messages.find((m) => m.mid > readMaxId && !m.out)?.mid ?? null;
      }

      await tick();
      pinScroll(firstUnreadMid);
    } catch (err: any) {
      error = errorOf(err, 'Failed to load messages');
    } finally {
      loadingHistory = false;
    }
  }

  function backToChats() {
    showSidebarOnMobile = true;
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
    atBottom = isScrolledToBottom();
    if (!pinned && atBottom) {
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
      lastTypingSent = 0;
      sendTyping(activePeerId, activeThreadId, 'cancel').catch(() => {});
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

<svelte:window onpaste={onPaste} />

<CallScreen />

<div class="shell" class:show-sidebar={showSidebarOnMobile} class:show-chat={!showSidebarOnMobile}>
  <aside>
    <header>
      <button class="icon-button settings-open" onclick={() => (showSettings = true)} aria-label="Settings">⚙</button>
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
      <Stories />
      {#if folders.length > 1}
        <div class="folders">
          {#each folders as folder (folder.id)}
            <button
              class:active={folder.id === activeFolder}
              onclick={() => openFolder(folder)}
              ondblclick={() => folder.editable && openFolderEditor(folder)}
              title={folder.editable ? 'Double-click to edit' : ''}
            >
              {#if folder.emoticon}<span class="folder-icon">{folder.emoticon}</span>{/if}
              {folder.title}
              {#if folder.unread}<span class="folder-badge">{folder.unread}</span>{/if}
            </button>
          {/each}
          <button class="add-folder" onclick={() => openFolderEditor(null)} title="New folder">＋</button>
        </div>
      {/if}
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
            oncontextmenu={(e) => {
              e.preventDefault();
              menuFor = menuFor?.peerId === dialog.peerId ? null : dialog;
            }}
          >
            <Avatar peerId={dialog.peerId} title={dialog.title} />
            <span class="meta">
              <span class="row">
                <span class="title">
                  {#if dialog.pinned}<span class="flag">📌</span>{/if}
                  {#if dialog.muted}<span class="flag">🔕</span>{/if}
                  {dialog.title}
                </span>
                <span class="time">{timeOf(dialog.date)}</span>
              </span>
              <span class="row">
                <span class="preview">{dialog.preview}</span>
                {#if dialog.unread}<span class="badge">{dialog.unread}</span>{/if}
              </span>
            </span>
          </button>

          {#if menuFor?.peerId === dialog.peerId}
            <div class="menu">
              <button onclick={() => runDialogAction(() => togglePin(dialog.peerId, activeFolder))}>
                {dialog.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button onclick={() => runDialogAction(() => toggleMute(dialog.peerId, !dialog.muted))}>
                {dialog.muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onclick={() =>
                  runDialogAction(() =>
                    dialog.unread ? markDialogRead(dialog.peerId) : markDialogUnread(dialog.peerId)
                  )}
              >
                {dialog.unread ? 'Mark as read' : 'Mark as unread'}
              </button>
              <button class="danger" onclick={() => runDialogAction(() => leaveOrDelete(dialog.peerId))}>
                Delete / Leave
              </button>
            </div>
          {/if}
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
        <button class="back-mobile" onclick={() => (showSidebarOnMobile = true)} aria-label="Back">←</button>
        <button class="title-button" onclick={() => (showInfo = !showInfo)}>{activeTitle}</button>
        {#if activeThreadId !== undefined}<span class="thread-tag">topic</span>{/if}
        <span class="presence">
          {typingNames.length
            ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…`
            : presence}
        </span>
        {#if activeIsUser && !activeIsSelf}
          <button class="icon-button" onclick={() => startCall(activePeerId!)} aria-label="Call">📞</button>
        {/if}
        <button class="icon-button" onclick={() => (chatSearchOpen = !chatSearchOpen)} aria-label="Search messages">🔍</button>
      </header>

      {#if chatSearchOpen}
        <div class="chat-search">
          <input placeholder="Search in chat" bind:value={chatQuery} oninput={onChatQueryInput} />
          <button onclick={closeChatSearch} aria-label="Close search">✕</button>
        </div>
        {#if chatResults}
          <div class="results">
            {#if !chatResults.length}
              <p class="muted">Nothing found.</p>
            {:else}
              {#each chatResults as result (result.mid)}
                <button class="result" onclick={() => { closeChatSearch(); jumpTo(result.mid); }}>
                  <span class="result-from">{result.fromTitle}</span>
                  <span class="result-text">{result.text || 'Media'}</span>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      {/if}

      {#if selecting}
        <div class="selection-bar">
          <span>{selected.size} selected</span>
          <span class="spacer"></span>
          <button onclick={forwardSelected}>Forward</button>
          <button class="danger" onclick={deleteSelected}>Delete</button>
          <button onclick={() => { selecting = false; selected = new Set(); }}>Cancel</button>
        </div>
      {/if}

      {#if pinnedMessage}
        <button class="pinned-bar" onclick={() => jumpTo(pinnedMessage!.mid)}>
          <span class="pinned-label">Pinned message</span>
          <span class="pinned-text">{pinnedMessage.text || 'Media'}</span>
        </button>
      {/if}

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
          {#each rendered as group, groupIndex (group.key)}
            {@const message = group.items[0]}
            {#if startsNewDay(groupIndex)}
              <p class="day-divider">{dayLabel(message.date)}</p>
            {/if}
            {#if message.mid === firstUnreadMid}
              <p class="unread-divider" data-mid={message.mid}>Unread messages</p>
            {/if}
            {#if message.service}
              <p
                class="service"
                class:highlighted={highlightedMid === message.mid}
                data-mid={message.mid}
              >{message.text}</p>
            {:else if message.stickerDocId}
              <div
                class="sticker-bubble"
                class:out={message.out}
                class:highlighted={highlightedMid === message.mid}
                data-mid={message.mid}
                use:observeForRead={message.mid}
              >
                <Sticker
                  sticker={{
                    docId: message.stickerDocId,
                    kind: message.stickerKind || 'static',
                    emoji: '',
                    width: message.media?.width ?? 128,
                    height: message.media?.height ?? 128
                  }}
                  size={140}
                />
                <span class="stamp">
                  <button class="reply-btn" onclick={() => (replyTo = message)}>Reply</button>
                  <span class="time">{timeOf(message.date)}</span>
                </span>
              </div>
            {:else}
              <div class="line" class:out={message.out}>
                {#if !message.out}
                  <!-- Sender photo, like the official clients. Hidden on
                       consecutive messages from the same person. -->
                  <button
                    class="line-avatar"
                    class:hidden={sameSenderAsPrevious(group)}
                    onclick={() => (profilePeerId = message.fromId)}
                    aria-label="View {message.fromTitle}"
                  >
                    <Avatar peerId={message.fromId} title={message.fromTitle} size={32} />
                  </button>
                {/if}
              <div
                class="bubble"
                class:out={message.out}
                class:highlighted={highlightedMid === message.mid}
                class:selected={selected.has(message.mid)}
                data-mid={message.mid}
                use:observeForRead={message.mid}
                oncontextmenu={(e) => {
                  e.preventDefault();
                  messageMenu = {mid: message.mid, x: e.clientX, y: e.clientY};
                }}
                onclick={() => selecting && toggleSelected(message.mid)}
                role="presentation"
              >
                {#if !message.out && message.fromTitle}
                  <button class="author" onclick={() => (profilePeerId = message.fromId)}>
                    {message.fromTitle}
                  </button>
                {/if}

                {#if message.forwardedFrom}
                  <span class="forwarded">Forwarded from {message.forwardedFrom}</span>
                {/if}

                {#if message.reply}
                  <button class="reply-quote jump" onclick={() => jumpTo(message.reply!.mid)}>
                    <span class="reply-title">{message.reply.title}</span>
                    <span class="reply-text">{message.reply.text}</span>
                  </button>
                {/if}

                {#if group.items.length > 1}
                  <div class="album" style="--cols: {group.items.length > 2 ? 2 : group.items.length}">
                    {#each group.items as item (item.mid)}
                      <button class="album-item" onclick={() => openLightbox(item)}>
                        <Media peerId={activePeerId} mid={item.mid} media={item.media!} />
                      </button>
                    {/each}
                  </div>
                {:else if message.media}
                  {#if message.media.kind === 'photo' || message.media.kind === 'video' || message.media.kind === 'gif'}
                    <button class="media-button" onclick={() => openLightbox(message)}>
                      <Media peerId={activePeerId} mid={message.mid} media={message.media} />
                    </button>
                  {:else}
                    <Media peerId={activePeerId} mid={message.mid} media={message.media} />
                  {/if}
                {/if}

                {#if message.parts.length}<FormattedText parts={message.parts} />{/if}

                {#if message.webpage}
                  <a class="webpage" href={message.webpage.url} target="_blank" rel="noopener noreferrer">
                    {#if message.webpage.siteName}
                      <span class="site">{message.webpage.siteName}</span>
                    {/if}
                    {#if message.webpage.title}
                      <span class="wp-title">{message.webpage.title}</span>
                    {/if}
                    {#if message.webpage.description}
                      <span class="wp-desc">{message.webpage.description}</span>
                    {/if}
                  </a>
                {/if}

                {#if message.poll}
                  <div class="poll">
                    <span class="poll-q">{message.poll.question}</span>
                    {#each message.poll.answers as answer, answerIndex}
                      <button
                        class="poll-a"
                        class:chosen={answer.chosen}
                        disabled={message.poll.closed}
                        onclick={() => vote(message, answerIndex)}
                      >
                        <span class="poll-bar" style="width: {answer.percent}%"></span>
                        <span class="poll-text">{answer.text}</span>
                        <span class="poll-pct">{answer.percent}%</span>
                      </button>
                    {/each}
                    <span class="poll-total">
                      {message.poll.totalVoters} voters{message.poll.closed ? ' · closed' : ''}
                    </span>
                  </div>
                {/if}

                {#if message.reactions.length}
                  <span class="reactions">
                    {#each message.reactions as reaction (reaction.emoticon)}
                      <button
                        class="chip"
                        class:chosen={reaction.chosen}
                        onclick={() => react(message, reaction.emoticon)}
                      >{reaction.emoticon} {reaction.count}</button>
                    {/each}
                  </span>
                {/if}

                {#if reactingTo === message.mid}
                  <span class="palette">
                    {#each reactionPalette as emoticon}
                      <button onclick={() => react(message, emoticon)}>{emoticon}</button>
                    {/each}
                  </span>
                {/if}

                {#if readByFor?.mid === message.mid}
                  <span class="read-by">
                    {readByFor.names.length
                      ? `Read by ${readByFor.names.slice(0, 8).join(', ')}${readByFor.names.length > 8 ? ` +${readByFor.names.length - 8}` : ''}`
                      : 'Read receipts are not available for this chat'}
                  </span>
                {/if}

                <span class="stamp">
                  {#if message.repliesCount}
                    <button class="reply-btn" onclick={() => openComments(message)}>
                      {message.repliesCount} 💬
                    </button>
                  {/if}
                  <button
                    class="reply-btn"
                    onclick={() => (reactingTo = reactingTo === message.mid ? null : message.mid)}
                  >React</button>
                  <button class="reply-btn" onclick={() => (replyTo = message)}>Reply</button>
                  <button class="reply-btn" onclick={() => openForward(message)}>Forward</button>
                  {#if message.text}
                    <button class="reply-btn" onclick={() => copyText(message)}>Copy</button>
                  {/if}
                  {#if message.editable}
                    <button class="reply-btn" onclick={() => startEdit(message)}>Edit</button>
                    <button class="reply-btn" onclick={() => removeMessage(message)}>Delete</button>
                  {/if}
                  {#if message.edited}<span class="edited">edited</span>{/if}
                  <span class="time">{timeOf(message.date)}</span>
                  {#if message.out && activeIsChannel && message.views}
                    <span class="views" title="Views">👁 {message.views.toLocaleString()}</span>
                  {:else if message.out && !activeIsSelf && !activeIsChannel}
                    <button
                      class="ticks"
                      class:read={message.mid <= readOutboxMaxId}
                      onclick={() => showReadBy(message)}
                      title={message.pending
                        ? 'Sending'
                        : message.mid <= readOutboxMaxId
                          ? 'Read'
                          : 'Delivered'}
                    >{message.pending ? '🕗' : message.mid <= readOutboxMaxId ? '✓✓' : '✓'}</button>
                  {/if}
                </span>
              </div>
              </div>
            {/if}
          {/each}
        {/if}
      </div>

      {#if !atBottom}
        <button class="to-bottom" onclick={() => { releasePin(); scrollToBottom(); }} aria-label="Scroll to latest">
          ↓
        </button>
      {/if}

      {#if inlineResults.length}
        <div class="inline-results">
          {#each inlineResults as result (result.queryAndResultId)}
            <button onclick={() => pickInline(result)}>
              <span class="inline-title">{result.title}</span>
              {#if result.description}
                <span class="inline-desc">{result.description}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}

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
        {#if showPicker}
          <Picker
            onemoji={(emoji) => (draft += emoji)}
            ondocument={pickDocument}
          />
        {/if}
        <button
          type="button"
          class="attach"
          onclick={() => (showPicker = !showPicker)}
          aria-label="Emoji, stickers and GIFs"
          disabled={!!editing}
        >😊</button>
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
        <textarea
          placeholder="Message"
          rows="1"
          bind:this={composer}
          bind:value={draft}
          oninput={onDraftInput}
          onkeydown={onComposerKey}
        ></textarea>
        <button type="submit" disabled={!draft.trim()} aria-label={editing ? 'Save' : 'Send'}>
          {editing ? '✓' : '↑'}
        </button>
      </form>
    {/if}
  </section>

  {#if showSettings}
    <Settings
      onclose={() => (showSettings = false)}
      onminiapp={(botId) => { miniAppBotId = botId; showSettings = false; }}
    />
  {/if}

  {#if profilePeerId !== null}
    <ChatInfo
      peerId={profilePeerId}
      onclose={() => (profilePeerId = null)}
      onmessage={openPeerChat}
      onpeer={(id) => (profilePeerId = id)}
    />
  {:else if showInfo && activePeerId !== null}
    <ChatInfo
      peerId={activePeerId}
      onclose={() => (showInfo = false)}
      onpeer={(id) => (profilePeerId = id)}
    />
  {/if}
</div>

{#if lightboxIndex !== null && activePeerId !== null}
  <Lightbox
    peerId={activePeerId}
    items={mediaMessages}
    bind:index={lightboxIndex}
    onclose={() => (lightboxIndex = null)}
  />
{/if}

{#if pendingFiles.length}
  <SendFiles
    files={pendingFiles}
    onsend={confirmSend}
    onclose={() => (pendingFiles = [])}
  />
{/if}

{#if miniAppBotId !== null}
  <MiniApp
    botId={miniAppBotId}
    peerId={activePeerId ?? miniAppBotId}
    onclose={() => (miniAppBotId = null)}
  />
{/if}

{#if messageMenu}
  {@const menuMessage = messages.find((m) => m.mid === messageMenu!.mid)}
  <div class="menu-backdrop" onclick={() => (messageMenu = null)} role="presentation"></div>
  <div class="context-menu" style="left: {messageMenu.x}px; top: {messageMenu.y}px">
    {#if menuMessage}
      <button onclick={() => { replyTo = menuMessage; messageMenu = null; }}>Reply</button>
      {#if menuMessage.text}
        <button onclick={() => { copyText(menuMessage); messageMenu = null; }}>Copy text</button>
      {/if}
      <button onclick={() => { openForward(menuMessage); messageMenu = null; }}>Forward</button>
      <button onclick={() => startSelecting(menuMessage.mid)}>Select</button>
      {#if menuMessage.editable}
        <button onclick={() => { startEdit(menuMessage); messageMenu = null; }}>Edit</button>
        <button class="danger" onclick={() => { removeMessage(menuMessage); messageMenu = null; }}>Delete</button>
      {/if}
    {/if}
  </div>
{/if}

{#if forwarding}
  <PeerPicker
    title="Forward to"
    dialogs={allDialogs}
    onpick={doForward}
    onclose={() => (forwarding = null)}
  />
{/if}

{#if folderEditorOpen}
  <FolderEditor
    folder={editingFolder}
    dialogs={allDialogs}
    onclose={() => (folderEditorOpen = false)}
    onsaved={onFolderSaved}
  />
{/if}

{#if error}<p class="error">{error}</p>{/if}

<style>
  /* 100dvh (not vh) so mobile browser chrome does not push the composer off
     screen, and min-height: 0 on every flex/grid child so the message list is
     what scrolls — without it the list forces the shell taller than the
     viewport and the whole page scrolls while history loads. */
  /* Panes float over the gradient field rather than tiling the viewport. */
  .shell {
    display: grid;
    grid-template-columns: minmax(240px, 340px) 1fr auto;
    height: 100dvh;
    max-height: 100dvh;
    overflow: hidden;
    gap: 10px;
    padding: 10px;
  }

  :global(:root[data-density='console']) .shell {
    gap: 0;
    padding: 0;
  }

  /* Floating panes: each is its own translucent card over the gradient field,
     separated by the shell's gap rather than by dividing borders. */
  aside,
  section {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--pane-radius);
    backdrop-filter: blur(var(--blur));
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  }

  :global(:root[data-density='console']) aside,
  :global(:root[data-density='console']) section {
    border-radius: 0;
    border: none;
    border-right: 1px solid var(--border);
    backdrop-filter: none;
    box-shadow: none;
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

  .folders {
    display: flex;
    gap: 4px;
    padding: 0 10px 8px;
    overflow-x: auto;
    flex: none;
    border-bottom: 1px solid var(--border);
  }

  .folders button {
    flex: none;
    padding: 6px 12px;
    background: none;
    border: none;
    border-radius: 999px;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
  }

  .folders button.active {
    background: var(--accent);
    color: #fff;
  }

  .folder-icon {
    margin-right: 2px;
  }

  .folder-badge {
    margin-left: 5px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
  }

  .folders button.active .folder-badge {
    background: #fff;
    color: var(--accent);
  }

  .add-folder {
    font-size: 16px;
    line-height: 1;
  }

  .menu {
    display: grid;
    margin: 0 14px 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .menu button {
    padding: 9px 12px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font-size: 13px;
  }

  .menu button:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .menu .danger {
    color: var(--danger);
  }

  .flag {
    font-size: 11px;
  }

  .title-button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .sticker-bubble {
    align-self: flex-start;
    display: grid;
    gap: 2px;
  }

  .sticker-bubble.out {
    align-self: flex-end;
    justify-items: end;
  }

  .album {
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    gap: 3px;
  }

  .album-item,
  .media-button {
    background: none;
    border: none;
    padding: 0;
    cursor: zoom-in;
    display: block;
    min-width: 0;
  }

  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    background: rgba(0, 0, 0, 0.28);
    border: none;
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 12px;
    color: inherit;
    cursor: pointer;
  }

  .chip.chosen {
    background: var(--action);
    color: var(--action-ink);
  }

  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  .palette button {
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    padding: 2px;
  }

  form {
    position: relative;
  }

  .edited {
    font-style: italic;
  }

  .ticks {
    letter-spacing: -2px;
    opacity: 0.75;
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    cursor: pointer;
    font-size: inherit;
  }

  .views {
    opacity: 0.75;
  }

  .read-by {
    font-size: 11px;
    opacity: 0.8;
    border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    padding-top: 4px;
  }

  .ticks.read {
    color: #7fe0c0;
    opacity: 1;
  }

  .bubble.out .ticks.read {
    color: #d6ffee;
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
    background: linear-gradient(100deg,
      color-mix(in srgb, var(--accent) 70%, transparent),
      color-mix(in srgb, var(--action) 40%, transparent));
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

  .preview {
    font-size: 13px;
    color: var(--text-dim);
  }

  .time {
    font-size: 11px;
    color: var(--text-dim);
    opacity: 0.75;
    flex: none;
  }

  .row-button.active .preview,
  .row-button.active .time {
    color: rgba(255, 255, 255, 0.8);
  }

  .badge {
    flex: none;
    min-width: 19px;
    height: 19px;
    display: grid;
    place-items: center;
    background: var(--action);
    color: var(--action-ink);
    font-weight: 700;
    border-radius: 999px;
    padding: 0 6px;
    font-size: 11px;
  }

  .row-button.active .badge {
    background: #fff;
    color: var(--accent);
  }

  .folder-badge {
    background: var(--action);
    color: var(--action-ink);
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

  .line {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    max-width: 100%;
    min-width: 0;
  }

  .line.out {
    justify-content: flex-end;
  }

  .line-avatar {
    flex: none;
    align-self: flex-end;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    line-height: 0;
  }

  .line-avatar.hidden {
    visibility: hidden;
  }

  /* Asymmetric corners point back at the speaker. */
  .bubble {
    max-width: min(620px, 72%);
    min-width: 0;
    padding: 8px 12px;
    border-radius: var(--bubble-radius) var(--bubble-radius) var(--bubble-radius) 5px;
    background: var(--bubble-in);
    border: 1px solid var(--border);
    align-self: flex-start;
    display: grid;
    gap: 6px;
  }

  .bubble.out {
    align-self: flex-end;
    border-radius: var(--bubble-radius) var(--bubble-radius) 5px var(--bubble-radius);
    background: linear-gradient(120deg, var(--accent), var(--accent-hover));
    border-color: transparent;
    color: #fff;
  }

  .author {
    font-size: 12px;
    font-weight: 600;
    color: var(--action);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    justify-self: start;
  }

  .author:hover {
    text-decoration: underline;
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

  /* Actions are revealed on hover so a thread reads as content, not chrome. */
  .stamp .reply-btn {
    opacity: 0;
    transition: opacity 0.12s;
  }

  .bubble:hover .stamp .reply-btn,
  .stamp .reply-btn:focus-visible {
    opacity: 1;
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

  .settings-open {
    font-size: 16px;
  }

  .inline-results {
    max-height: 200px;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    flex: none;
  }

  .inline-results button {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 8px 18px;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .inline-results button:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .inline-title {
    font-size: 14px;
  }

  .inline-desc {
    font-size: 12px;
    color: var(--text-dim);
  }

  .chat-search {
    display: flex;
    gap: 8px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .chat-search input {
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    outline: none;
  }

  .chat-search button,
  .icon-button {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 15px;
  }

  .results {
    max-height: 40%;
    overflow-y: auto;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .result {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 8px 18px;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .result:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .result-from {
    font-size: 12px;
    color: var(--accent);
  }

  .result-text {
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selection-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .selection-bar button {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  .selection-bar .danger {
    color: var(--danger);
  }

  .bubble.selected {
    outline: 2px solid var(--accent);
  }

  button.poll-a {
    width: 100%;
    border: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  button.poll-a:disabled {
    cursor: default;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
  }

  .context-menu {
    position: fixed;
    z-index: 61;
    display: grid;
    min-width: 160px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  }

  .context-menu button {
    padding: 9px 12px;
    background: none;
    border: none;
    text-align: left;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  .context-menu button:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .context-menu .danger {
    color: var(--danger);
  }

  .back-mobile {
    display: none;
    background: none;
    border: none;
    color: var(--accent);
    font-size: 18px;
    cursor: pointer;
    padding: 0;
  }

  .day-divider {
    align-self: center;
    margin: 10px 0 4px;
    padding: 2px 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: var(--text-dim);
    font-size: 12px;
  }

  .bubble.highlighted,
  .sticker-bubble.highlighted,
  .service.highlighted {
    animation: flash 1.6s ease-out;
    border-radius: 14px;
  }

  @keyframes flash {
    0%,
    40% {
      box-shadow: 0 0 0 2px var(--accent);
    }
    100% {
      box-shadow: 0 0 0 2px transparent;
    }
  }

  .forwarded {
    font-size: 12px;
    font-style: italic;
    opacity: 0.8;
  }

  button.reply-quote.jump {
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    border-top: none;
    border-right: none;
    border-bottom: none;
  }

  .webpage {
    display: grid;
    gap: 2px;
    padding-left: 8px;
    border-left: 2px solid var(--accent);
    color: inherit;
    text-decoration: none;
    font-size: 13px;
  }

  .site {
    color: var(--accent);
    font-weight: 600;
  }

  .wp-title {
    font-weight: 600;
  }

  .wp-desc {
    opacity: 0.85;
  }

  .poll {
    display: grid;
    gap: 4px;
    min-width: 220px;
  }

  .poll-q {
    font-weight: 600;
  }

  .poll-a {
    position: relative;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 8px;
    overflow: hidden;
    font-size: 13px;
  }

  .poll-bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .poll-a.chosen .poll-bar {
    background: color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .poll-text,
  .poll-pct {
    position: relative;
  }

  .poll-total {
    font-size: 11px;
    opacity: 0.7;
  }

  .pinned-bar {
    display: grid;
    gap: 1px;
    text-align: left;
    padding: 8px 18px;
    border: none;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    background: none;
    color: inherit;
    cursor: pointer;
    flex: none;
  }

  .pinned-label {
    font-size: 11px;
    color: var(--accent);
    font-weight: 600;
  }

  .pinned-text {
    font-size: 13px;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .to-bottom {
    position: absolute;
    right: 24px;
    bottom: 84px;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text);
    font-size: 18px;
    cursor: pointer;
    z-index: 10;
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
    align-items: center;
    gap: 8px;
    margin: 10px;
    padding: 6px 6px 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 6%, transparent);
    flex: none;
  }

  :global(:root[data-density='console']) form {
    margin: 0;
    border-radius: 0;
    border: none;
    border-top: 1px solid var(--border);
    padding: 8px 12px;
  }

  form textarea {
    flex: 1;
    min-width: 0;
    padding: 8px 4px;
    border: none;
    background: transparent;
    outline: none;
    resize: none;
    font: inherit;
    line-height: 1.4;
    max-height: 160px;
    overflow-y: auto;
  }

  form button[type='submit'] {
    width: 36px;
    height: 36px;
    flex: none;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--action);
    color: var(--action-ink);
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
    display: grid;
    place-items: center;
  }

  .attach {
    opacity: 0.65;
    font-size: 17px;
    transition: opacity 0.12s;
  }

  .attach:hover {
    opacity: 1;
  }

  form button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .muted {
    color: var(--text-dim);
    padding: 16px;
  }

  /* Phones: one pane at a time, driven by .show-sidebar / .show-chat. */
  @media (max-width: 720px) {
    .shell {
      grid-template-columns: 1fr;
      gap: 0;
      padding: 0;
    }

    aside,
    section {
      border-radius: 0;
      border: none;
    }

    .shell.show-sidebar section,
    .shell.show-chat aside {
      display: none;
    }

    .back-mobile {
      display: block;
    }

    .bubble {
      max-width: 88%;
    }

    .to-bottom {
      right: 14px;
      bottom: 78px;
    }

    form,
    .chat-search,
    .selection-bar,
    header {
      padding-left: 12px;
      padding-right: 12px;
    }

    .messages {
      padding: 12px;
    }
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
