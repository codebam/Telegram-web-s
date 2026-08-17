<script lang="ts">
  import {onMount, tick} from 'svelte';

  import Avatar from './Avatar.svelte';
  import Glyph from './Glyph.svelte';
  import ChatInfo from './ChatInfo.svelte';
  import ChecklistBubble from './ChecklistBubble.svelte';
  import ContactBubble from './ContactBubble.svelte';
  import GameBubble from './GameBubble.svelte';
  import GiftBubble from './GiftBubble.svelte';
  import InvoiceBubble from './InvoiceBubble.svelte';
  import LocationBubble from './LocationBubble.svelte';
  import LocationSender from './LocationSender.svelte';
  import PollComposer from './PollComposer.svelte';
  import PollResults from './PollResults.svelte';
  import FolderEditor from './FolderEditor.svelte';
  import FormatBar from './FormatBar.svelte';
  import FormattedText from './FormattedText.svelte';
  import InlinePreview from './InlinePreview.svelte';
  import Lightbox from './Lightbox.svelte';
  import AudioPlayerBar from './AudioPlayerBar.svelte';
  import Media from './Media.svelte';
  import CallScreen from './CallScreen.svelte';
  import MiniApp from './MiniApp.svelte';
  import NewChat from './NewChat.svelte';
  import PeerPicker from './PeerPicker.svelte';
  import ForwardSheet from './ForwardSheet.svelte';
  import ForwardHeader from './ForwardHeader.svelte';
  import ReplyHeader from './ReplyHeader.svelte';
  import SendFiles from './SendFiles.svelte';
  import {sendFilesGrouped, type SendFileItem, type UploadHandle, type UploadProgress} from '$lib/telegram/upload';
  import Settings from './Settings.svelte';
  import Stories from './Stories.svelte';
  import Picker from './Picker.svelte';
  import GlobalSearch from './GlobalSearch.svelte';
  import EmojiStatus from './EmojiStatus.svelte';
  import {customEmojiEntities, type PendingCustomEmoji} from '$lib/telegram/emoji';
  import ReactionBar from './ReactionBar.svelte';
  import ReactionPicker from './ReactionPicker.svelte';
  import StarReactionSheet from './StarReactionSheet.svelte';
  import RichMessage from './RichMessage.svelte';
  import Sticker from './Sticker.svelte';
  import VoiceRecorder from './VoiceRecorder.svelte';
  import StickerSetSheet from './StickerSetSheet.svelte';
  import StickerSuggest from './StickerSuggest.svelte';
  import GifSaveAction from './GifSaveAction.svelte';
  import CommentsButton from './CommentsButton.svelte';
  import SavedTags from './SavedTags.svelte';
  import TopicEditor from './TopicEditor.svelte';
  import TopicIcon from './TopicIcon.svelte';
  import {parseStickerSetLink} from '$lib/telegram/stickers';
  import {GIT_COMMIT, GIT_COMMIT_SHORT, GIT_COMMIT_URL} from '$lib/buildInfo';
  import {
    sendQuickReaction,
    sendReaction as sendMessageReaction,
    type ReactionOption
  } from '$lib/telegram/reactions';
  import {
    clickSponsored,
    deleteMessage,
    deleteMessages,
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
    loadSponsored,
    hidePinnedMessage,
    loadOlder,
    markDialogRead,
    markDialogUnread,
    onDialogsUpdate,
    onFoldersUpdate,
    onMessageEdited,
    onMessageSent,
    onMessagesDeleted,
    onNewMessage,
    onReadStateChange,
    readMediaContents,
    readParticipants,
    onTyping,
    onUserUpdate,
    pressCallbackButton,
    readUpTo,
    resolveUsername,
    saveDraftText,
    setOwnOnline,
    sendDocument,
    sendMessage,
    sendTyping,
    toggleMute,
    togglePin,
    viewSponsored,
    votePoll,
    type DialogItem,
    type FolderItem,
    type MessageButton,
    type MessageItem,
    type PollPreview,
    type SponsoredItem
  } from '$lib/telegram/chats';
  import {sendContact} from '$lib/telegram/messageTypes';
  import {
    FOLDER_ID_ARCHIVE,
    getArchiveSummary,
    isPeerOnline,
    loadArchivedDialogs,
    loadFolderMemberships,
    reorderPinnedDialogs,
    setDialogArchived,
    toggleFolderMembership,
    type ArchiveSummary,
    type FolderMembership
  } from '$lib/telegram/archive';
  import {
    clearTrackedQuote,
    forwardTo,
    quoteFromSelection,
    replySendOptions,
    trackQuoteSelection,
    trackedQuote,
    type ForwardOptions,
    type ReplyQuote
  } from '$lib/telegram/reply';
  import {
    canCreateTopic,
    deleteTopic,
    isSavedViewedAsChats,
    isViewingForumAsMessages,
    loadSavedDialogs,
    loadTopics,
    openCommentThread,
    setSavedViewedAsChats,
    setTopicClosed,
    setTopicHidden,
    setViewForumAsMessages,
    toggleTopicPin,
    type SavedDialogItem,
    type TopicItem
  } from '$lib/telegram/topics';
  import {
    getBotMenuButton,
    openBotAppLink,
    parseMiniAppLink,
    type MiniAppRequest
  } from '$lib/telegram/miniApps';
  import {
    isPeerMuted,
    notifyMessage,
    onPushClick,
    setActiveNotificationPeer,
    syncPushSubscription
  } from '$lib/telegram/notifications';
  import {parseComposerText, partsToMarkdown} from '$lib/telegram/composerFormat';
  import {queryInlineBot, sendInlineResult, type InlineQueryAnswer, type InlineResultItem} from '$lib/telegram/settings';
  import {
    dialogTargetFor,
    findMessageIdByDate,
    searchChatMembers,
    searchChatMessages,
    MEDIA_FILTERS,
    type MediaFilter,
    type SearchPeerItem
  } from '$lib/telegram/search';
  import {applyAccent, applyDensity, applyTheme} from '$lib/telegram/theme';
  import {playAudioMessage} from '$lib/telegram/player';
  import {applyAppearance} from '$lib/telegram/appearance';
  import {
    getBusinessBot,
    onPeerSettings,
    removeBusinessBot,
    setBusinessBotPaused,
    startCall,
    type BusinessBot
  } from '$lib/telegram/extras';
  import EffectOverlay from './EffectOverlay.svelte';
  import EffectPicker from './EffectPicker.svelte';
  import ScheduledMessages from './ScheduledMessages.svelte';
  import SendAsPicker from './SendAsPicker.svelte';
  import SendOptionsSheet from './SendOptionsSheet.svelte';
  import {
    countScheduled,
    getCurrentSendAs,
    getSlowMode,
    isSilentByDefault,
    onChatFullUpdate,
    onScheduledUpdate,
    sendMessageWithOptions,
    type SlowMode
  } from '$lib/telegram/sendOptions';

  let dialogs = $state<DialogItem[]>([]);
  let topics = $state<TopicItem[]>([]);
  let messages = $state<MessageItem[]>([]);

  let activePeerId = $state<number | null>(null);
  let activeThreadId = $state<number | undefined>(undefined);
  let activeTitle = $state('');
  let activeIsForum = $state(false);
  /**
   * Whether a row in a topic chat has been opened. "All messages" has no
   * threadId, so the thread id alone cannot distinguish "showing the main
   * timeline" from "nothing picked yet".
   */
  let topicOpen = $state(false);
  /**
   * The synthetic "All messages" row above a forum's topics — thread id 0 means
   * the chat's own timeline, which `openTopic` maps back to no thread at all.
   */
  const allMessagesRow: TopicItem = {
    threadId: 0,
    title: 'All messages',
    preview: '',
    date: 0,
    unread: 0,
    closed: false,
    hidden: false,
    pinned: false,
    isGeneral: false,
    iconColor: 0,
    iconEmojiId: '',
    canManage: false
  };
  /** Right-clicked topic row, keyed by thread id. */
  let topicMenuFor = $state<number | null>(null);
  /** Open topic editor: `{topic: null}` creates, `{topic}` edits. */
  let topicEditor = $state<{topic: TopicItem | null} | null>(null);
  let canManageForum = $state(false);
  /** Forum shown as one flat timeline instead of a topic list. */
  let forumAsMessages = $state(false);
  /**
   * What the open thread actually is. A thread id alone cannot tell a forum
   * topic from a comment thread from a saved sub-chat, and the header, the
   * back button and the composer all behave differently for each.
   */
  let threadKind = $state<'' | 'topic' | 'comments' | 'saved'>('');
  /** Comments already on the channel post whose thread is open. */
  let threadCommentCount = $state(0);
  /** Where a comment thread was entered from, for the back button. */
  let commentsOrigin = $state<{peerId: number; title: string} | null>(null);
  /** Saved Messages split per original sender instead of one timeline. */
  let savedAsChats = $state(false);
  let savedDialogs = $state<SavedDialogItem[]>([]);
  /** Tag currently filtering Saved Messages, '' for no filter. */
  let savedTag = $state('');
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
  /**
   * The sidebar shows a sub-list instead of the chat list: a forum's topics, or
   * Saved Messages split per sender. Both replace the search box and folders
   * with a back button to the chat list.
   */
  let topicListOpen = $derived(activeIsForum && activePeerId !== null && !forumAsMessages);
  let savedListOpen = $derived(activeIsSelf && activePeerId !== null && savedAsChats);
  let sublistOpen = $derived(topicListOpen || savedListOpen);
  /** Names of the people who have read a message, fetched on demand. */
  let readByFor = $state<{mid: number; names: string[]} | null>(null);
  /** Open reaction picker, anchored where it was summoned from. */
  let reactionPickerFor = $state<{mid: number; x: number; y: number} | null>(null);
  /** Message whose paid (star) reaction sheet is open. */
  let starReactionFor = $state<number | null>(null);
  /**
   * Bumped per message whenever a reaction is sent from here, so that bubble's
   * bar re-reads its counters even when the server update lands later. Keyed by
   * mid so one reaction does not make every bubble re-read.
   */
  let reactionRevisions = $state<Record<number, number>>({});

  function bumpReaction(mid: number) {
    reactionRevisions = {...reactionRevisions, [mid]: (reactionRevisions[mid] ?? 0) + 1};
  }

  let loadingChats = $state(true);
  let loadingHistory = $state(false);
  let draft = $state('');
  let replyTo = $state<MessageItem | null>(null);
  /**
   * Everything about the pending reply that a `MessageItem` cannot carry: the
   * quoted excerpt and, for a reply into another chat, where the original
   * lives. Kept beside `replyTo` rather than inside it because the reply target
   * is cleared from a dozen places; `mid` is what ties the two together, so a
   * stale context is simply ignored instead of attaching to the wrong message.
   */
  let replyContext = $state<{
    mid: number;
    peerId: number;
    chatTitle: string;
    quote: ReplyQuote | null;
  } | null>(null);
  /** The message a "Reply in…" pick is about to carry into another chat. */
  let replyingElsewhere = $state<MessageItem | null>(null);
  /** Its quote, captured before the picker took the selection away. */
  let replyElsewhereQuote: ReplyQuote | null = null;
  let error = $state('');
  let scroller: HTMLDivElement | undefined = $state();
  /** First unread message id, used for the divider and the open position. */
  let firstUnreadMid = $state<number | null>(null);
  let pinned = false;
  let pinnedAnchor: number | null = null;
  let observer: ResizeObserver | undefined;

  let query = $state('');
  /** True while the sidebar search pane replaces the chat list. */
  let searchOpen = $state(false);
  let loadingOlder = $state(false);
  let reachedStart = $state(false);
  // False while the loaded window is centred on an older message (a jump), when
  // the bottom of the list is not the bottom of the chat.
  let windowAtLatest = $state(true);
  let presence = $state('');
  let typingNames = $state<string[]>([]);
  let editing = $state<MessageItem | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let mediaInput: HTMLInputElement | undefined = $state();
  let composer: HTMLTextAreaElement | undefined = $state();
  let searchBox: HTMLInputElement | undefined = $state();
  let dragging = $state(false);
  let typingTimer: ReturnType<typeof setTimeout> | undefined;

  let folders = $state<FolderItem[]>([]);
  let activeFolder = $state(0);
  let editingFolder = $state<FolderItem | null>(null);
  let allDialogs = $state<DialogItem[]>([]);
  let folderEditorOpen = $state(false);
  let newChatOpen = $state(false);
  let menuFor = $state<DialogItem | null>(null);

  /* ---------- archive, folder membership, presence, pinned order ---------- */

  /** True while the list shows folder 1 instead of the current folder. */
  let archiveOpen = $state(false);
  let archivedDialogs = $state<DialogItem[]>([]);
  let archiveSummary = $state<ArchiveSummary>({total: 0, unread: 0});
  let loadingArchive = $state(false);
  /** Peer ids currently online, for the dot on private rows. */
  let onlinePeerIds = $state<number[]>([]);
  /** peerId → names typing in that chat right now, for the row preview. */
  let typingByPeer = $state<Record<number, string[]>>({});
  /** Peer whose "Add to folder" submenu is open, if any. */
  let folderMenuFor = $state<number | null>(null);
  let folderMemberships = $state<FolderMembership[]>([]);
  let dragPeerId = $state<number | null>(null);
  let dragOverPeerId = $state<number | null>(null);

  /** The rows on screen: the archive when it is open, the folder otherwise. */
  let listedDialogs = $derived(archiveOpen ? archivedDialogs : dialogs);

  onMount(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    (async () => {
      archiveSummary = await getArchiveSummary();

      const offDialogs = await onDialogsUpdate(async () => {
        archiveSummary = await getArchiveSummary();
        if (archiveOpen) archivedDialogs = await loadArchivedDialogs();
      });

      // The list shows "typing…" for any chat, not just the open one, so it
      // keeps its own subscription rather than widening the header's.
      const offTyping = await onTyping((peerId, _threadId, names) => {
        typingByPeer = {...typingByPeer, [peerId]: names};
      });

      const offUsers = await onUserUpdate(async (userId) => {
        const online = await isPeerOnline(userId);
        const has = onlinePeerIds.includes(userId);
        if (online && !has) onlinePeerIds = [...onlinePeerIds, userId];
        else if (!online && has) onlinePeerIds = onlinePeerIds.filter((id) => id !== userId);
      });

      const all = () => {
        offDialogs();
        offTyping();
        offUsers();
      };

      if (disposed) all();
      else unsubscribe = all;
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  });

  // Presence for the rows on screen. Statuses are already cached with the peer,
  // so this costs a worker round-trip per row and nothing on the network.
  $effect(() => {
    const peerIds = listedDialogs.filter((d) => d.isUser && !d.isSelf).map((d) => d.peerId);
    let cancelled = false;

    (async () => {
      const states = await Promise.all(peerIds.map((peerId) => isPeerOnline(peerId)));
      if (!cancelled) onlinePeerIds = peerIds.filter((_, index) => states[index]);
    })();

    return () => {
      cancelled = true;
    };
  });

  function typingTextFor(peerId: number): string {
    const names = typingByPeer[peerId] ?? [];
    if (!names.length) return '';
    return `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…`;
  }

  async function openArchive() {
    archiveOpen = true;
    menuFor = null;
    folderMenuFor = null;
    loadingArchive = true;
    try {
      archivedDialogs = await loadArchivedDialogs();
    } catch (err: any) {
      error = errorOf(err, 'Failed to load the archive');
    } finally {
      loadingArchive = false;
    }
  }

  function closeArchive() {
    archiveOpen = false;
    menuFor = null;
    folderMenuFor = null;
  }

  async function openFolderMenu(dialog: DialogItem) {
    if (folderMenuFor === dialog.peerId) {
      folderMenuFor = null;
      return;
    }

    folderMenuFor = dialog.peerId;
    folderMemberships = await loadFolderMemberships(dialog.peerId);
  }

  /* ---------- drag-to-reorder pinned chats ---------- */

  function onRowDragStart(event: DragEvent, dialog: DialogItem) {
    if (!dialog.pinned) return;
    dragPeerId = dialog.peerId;
    event.dataTransfer?.setData('text/plain', String(dialog.peerId));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onRowDragOver(event: DragEvent, dialog: DialogItem) {
    if (dragPeerId === null || !dialog.pinned) return;
    // Only a prevented dragover marks the row as a valid drop target.
    event.preventDefault();
    dragOverPeerId = dialog.peerId;
  }

  function onRowDragEnd() {
    dragPeerId = null;
    dragOverPeerId = null;
  }

  async function onRowDrop(event: DragEvent, dialog: DialogItem) {
    const from = dragPeerId;
    dragPeerId = null;
    dragOverPeerId = null;
    if (from === null || !dialog.pinned || from === dialog.peerId) return;
    event.preventDefault();

    const list = listedDialogs;
    const order = list.filter((d) => d.pinned).map((d) => d.peerId);
    const fromIndex = order.indexOf(from);
    const toIndex = order.indexOf(dialog.peerId);
    if (fromIndex === -1 || toIndex === -1) return;
    order.splice(toIndex, 0, ...order.splice(fromIndex, 1));

    // Show the new order straight away; the server confirms it right after.
    const byPeerId = new Map(list.map((d) => [d.peerId, d]));
    const reordered = [
      ...order.map((peerId) => byPeerId.get(peerId)!),
      ...list.filter((d) => !d.pinned)
    ];
    if (archiveOpen) archivedDialogs = reordered;
    else dialogs = reordered;

    try {
      await reorderPinnedDialogs(order, archiveOpen ? FOLDER_ID_ARCHIVE : activeFolder);
    } catch (err: any) {
      error = errorOf(err, 'Failed to reorder pinned chats');
      if (archiveOpen) archivedDialogs = await loadArchivedDialogs();
      else dialogs = await loadDialogs(40, activeFolder);
    }
  }
  let showInfo = $state(false);
  /** Profile being viewed from a message sender or member list, if any. */
  let profilePeerId = $state<number | null>(null);
  let showPicker = $state(false);
  /**
   * Custom emoji sitting in the draft as their plain alt text; on send they
   * become messageEntityCustomEmoji entities over those characters.
   */
  let pendingCustomEmoji = $state<PendingCustomEmoji[]>([]);
  /** Sticker-pack preview, opened from an addstickers link or "View pack". */
  let packSheet = $state<{setKey: string; docId: string} | null>(null);
  let lightboxIndex = $state<number | null>(null);
  let highlightedMid = $state<number | null>(null);
  let pinnedMessage = $state<MessageItem | null>(null);
  /**
   * The channel's sponsored message. Telegram's API terms require third-party
   * clients to show these unmodified and to report views and clicks, so nothing
   * below filters or hides what the server returns.
   */
  let sponsored = $state<SponsoredItem | null>(null);
  let sponsoredViewed = '';
  /**
   * Set while the open peer is restricted on this platform. Its history is not
   * loaded at all — the server's reason is shown in place of the timeline.
   */
  let activeRestriction = $state('');
  let businessBot = $state<BusinessBot | null>(null);
  let businessBotBusy = $state(false);
  /** Messages queued for the forward sheet, empty when it is closed. */
  let forwarding = $state<MessageItem[]>([]);
  let atBottom = $state(true);
  let chatQuery = $state('');
  let chatResults = $state<MessageItem[] | null>(null);
  let chatSearchOpen = $state(false);
  let chatSearchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Server-side total for the current in-chat search — the M in "N of M". */
  let chatResultCount = $state(0);
  let chatResultIndex = $state(-1);
  let chatResultsEnd = $state(true);
  let chatSearching = $state(false);
  /** Sender filter: groups and channels only, a DM has just two of them. */
  let chatFrom = $state<SearchPeerItem | null>(null);
  let chatFromOpen = $state(false);
  let chatFromQuery = $state('');
  let chatMembers = $state<SearchPeerItem[]>([]);
  let chatFilter = $state<MediaFilter>('all');
  let chatDate = $state('');
  let chatFiltersOpen = $state(false);
  let selecting = $state(false);
  let selected = $state<Set<number>>(new Set());
  let messageMenu = $state<{mid: number; x: number; y: number} | null>(null);
  let lastTypingSent = 0;
  let showSidebarOnMobile = $state(true);
  let showSettings = $state(false);
  /** The mini app currently hosted in an iframe, null when none is open. */
  let miniApp = $state<MiniAppRequest | null>(null);
  let inlineResults = $state<InlineResultItem[]>([]);
  let inlineSwitch = $state<InlineQueryAnswer | null>(null);
  let inlineBot = $state('');
  let inlineTimer: ReturnType<typeof setTimeout> | undefined;
  /** The web-app button a bot pins next to the composer, if this chat is a bot. */
  let botMenuButton = $state<{text: string; url: string} | null>(null);
  /** Files queued by paste, drop or the attach button, pending confirmation. */
  let pendingFiles = $state<File[]>([]);
  /** The batch currently uploading, null when nothing is in flight. */
  let upload = $state<UploadHandle | null>(null);
  let uploadProgress = $state<UploadProgress[] | null>(null);
  /** Nesting depth of the drag currently over the pane — see onDragEnter. */
  let dragDepth = 0;

  /** Batch progress as one number, for the bar on the pending bubble. */
  const uploadOverall = $derived(
    uploadProgress?.length ?
      uploadProgress.reduce((sum, item) => sum + item.progress, 0) / uploadProgress.length :
      null
  );

  /** Media messages in order — the lightbox pages through these. */
  const mediaMessages = $derived(
    messages.filter(
      (m) =>
        m.media &&
        !m.media.selfDestruct &&
        !m.restrictionText &&
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
    // Wallpaper, text size, bubble spacing and the power-saving flags — all of
    // them land as CSS variables on <html>.
    applyAppearance();

    (async () => {
      try {
        [dialogs, folders] = await Promise.all([loadDialogs(), loadFolders()]);
      } catch (err: any) {
        error = errorOf(err, 'Failed to load chats');
      } finally {
        loadingChats = false;
      }

      // Re-register the push subscription on every boot: the browser can drop
      // one, and the token Telegram pushes to has to be the current one.
      syncPushSubscription();
      onPushClick((peerId) => {
        window.focus();
        openPeerChat(peerId);
      });

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
          // Ask the notification settings rather than the loaded dialog list:
          // a peer outside the current folder — or one muted only by the
          // per-type default — has no entry there and used to notify anyway.
          const muted = item && !item.out ? await isPeerMuted(peerId, threadId) : true;
          if (item && !item.out && !muted) {
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

      // Streaming bots edit their reply as it is generated.
      const offEdited = await onMessageEdited(async (peerId, mid) => {
        if (peerId !== activePeerId) return;
        if (!messages.some((m) => m.mid === mid)) return;
        const updated = await getMessage(peerId, mid);
        if (updated) upsertMessage(updated);
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
        offEdited();
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

  async function openNewChat() {
    // Members are picked from every chat, not just the folder currently shown.
    allDialogs = await loadDialogs(100, 0);
    newChatOpen = true;
  }

  async function onChatCreated(peerId: number) {
    newChatOpen = false;
    query = '';
    activeFolder = 0;

    try {
      dialogs = await loadDialogs(40, 0);
    } catch (err: any) {
      error = errorOf(err, 'Failed to reload chats');
    }

    // The dialog may not have landed in the list yet; openPeerChat works off
    // the peer itself, so it opens either way.
    await openPeerChat(peerId);
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
    folderMenuFor = null;
    try {
      await action();
      dialogs = await loadDialogs(40, activeFolder);
      archiveSummary = await getArchiveSummary();
      if (archiveOpen) archivedDialogs = await loadArchivedDialogs();
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

  function openReactionPicker(event: MouseEvent, mid: number) {
    event.preventDefault();
    event.stopPropagation();
    reactionPickerFor = {mid, x: event.clientX, y: event.clientY};
  }

  async function pickReaction(option: ReactionOption) {
    const picker = reactionPickerFor;
    reactionPickerFor = null;
    if (!picker || activePeerId === null) return;

    try {
      await sendMessageReaction(activePeerId, picker.mid, option);
      bumpReaction(picker.mid);
    } catch (err: any) {
      error = errorOf(err, 'Reaction failed');
    }
  }

  /** Double-click a bubble to send the configured quick reaction. */
  async function quickReact(message: MessageItem) {
    if (activePeerId === null || message.service || selecting) return;

    try {
      await sendQuickReaction(activePeerId, message.mid);
      bumpReaction(message.mid);
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

  /** Filters narrow the search on their own — an empty query is fine with one. */
  const chatSearchNarrowed = $derived(
    !!chatQuery.trim() || chatFilter !== 'all' || !!chatFrom
  );

  /** Sender picking only makes sense where there is more than one sender. */
  const canFilterBySender = $derived(activePeerId !== null && activePeerId < 0);

  function chatSearchOptions(offsetId = 0) {
    return {
      threadId: activeThreadId,
      fromPeerId: chatFrom?.peerId,
      filter: chatFilter,
      offsetId
    };
  }

  async function runChatSearch() {
    if (activePeerId === null || !chatSearchNarrowed) {
      chatResults = null;
      chatResultCount = 0;
      chatResultIndex = -1;
      chatResultsEnd = true;
      return;
    }

    const peerId = activePeerId;
    chatSearching = true;
    try {
      const page = await searchChatMessages(peerId, chatQuery, chatSearchOptions());
      if (activePeerId !== peerId) return;
      chatResults = page.items.map((item) => item.message);
      chatResultCount = page.count;
      chatResultIndex = page.items.length ? 0 : -1;
      chatResultsEnd = page.isEnd;
    } catch (err: any) {
      error = errorOf(err, 'Search failed');
    } finally {
      chatSearching = false;
    }
  }

  function onChatQueryInput() {
    clearTimeout(chatSearchTimer);
    chatSearchTimer = setTimeout(runChatSearch, 300);
  }

  /** A filter change is a deliberate click, so it searches without the debounce. */
  function applyChatFilter(filter: MediaFilter) {
    chatFilter = filter;
    clearTimeout(chatSearchTimer);
    runChatSearch();
  }

  async function openFromPicker() {
    chatFromOpen = !chatFromOpen;
    if (chatFromOpen && activePeerId !== null) {
      chatMembers = await searchChatMembers(activePeerId, chatFromQuery);
    }
  }

  async function onFromQueryInput() {
    if (activePeerId === null) return;
    chatMembers = await searchChatMembers(activePeerId, chatFromQuery);
  }

  function pickFrom(member: SearchPeerItem | null) {
    chatFrom = member;
    chatFromOpen = false;
    chatFromQuery = '';
    clearTimeout(chatSearchTimer);
    runChatSearch();
  }

  /** Older results, pulled in when the user pages past the loaded ones. */
  async function loadMoreChatResults() {
    if (activePeerId === null || chatResultsEnd || chatSearching || !chatResults?.length) return;

    const peerId = activePeerId;
    chatSearching = true;
    try {
      const page = await searchChatMessages(
        peerId,
        chatQuery,
        chatSearchOptions(chatResults[chatResults.length - 1].mid)
      );
      if (activePeerId !== peerId) return;

      const known = new Set(chatResults.map((m) => m.mid));
      const fresh = page.items.map((item) => item.message).filter((m) => !known.has(m.mid));
      chatResults = [...chatResults, ...fresh];
      chatResultsEnd = page.isEnd || !fresh.length;
    } catch (err: any) {
      error = errorOf(err, 'Search failed');
    } finally {
      chatSearching = false;
    }
  }

  /** Step through results newest-first; `step` of 1 goes towards older ones. */
  async function stepResult(step: number) {
    if (!chatResults?.length) return;

    const next = chatResultIndex + step;
    if (next < 0) return;

    if (next >= chatResults.length) {
      await loadMoreChatResults();
      if (next >= (chatResults?.length ?? 0)) return;
    }

    chatResultIndex = next;
    jumpTo(chatResults[next].mid);
  }

  function selectResult(index: number) {
    chatResultIndex = index;
    if (chatResults?.[index]) jumpTo(chatResults[index].mid);
  }

  /** Jump the timeline to the first message on the picked day. */
  async function jumpToDate(value: string) {
    chatDate = value;
    if (!value || activePeerId === null) return;

    // The day's last second: the server answers with the newest message at or
    // before the offset, which is the bottom of that day.
    const end = new Date(`${value}T23:59:59`);
    const mid = await findMessageIdByDate(activePeerId, Math.floor(end.getTime() / 1000), activeThreadId);
    if (mid) jumpTo(mid);
    else error = 'No messages on that day';
  }

  function closeChatSearch() {
    chatSearchOpen = false;
    chatQuery = '';
    chatResults = null;
    chatResultCount = 0;
    chatResultIndex = -1;
    chatResultsEnd = true;
    chatFrom = null;
    chatFromOpen = false;
    chatFromQuery = '';
    chatFilter = 'all';
    chatDate = '';
    chatFiltersOpen = false;
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
    // Oldest first, so the batch lands in the target chat in the order it was
    // written rather than the order it happened to be clicked in.
    forwarding = messages.filter((m) => selected.has(m.mid)).sort((a, b) => a.mid - b.mid);
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

  /**
   * A channel post's comments live in the linked discussion group, so opening
   * them swaps the peer as well as the thread. The channel is remembered so the
   * back button returns to the post instead of the chat list.
   */
  async function openComments(message: MessageItem) {
    if (activePeerId === null) return;
    try {
      const thread = await openCommentThread(activePeerId, message.mid);
      if (!thread) {
        error = 'No discussion for this post';
        return;
      }

      commentsOrigin = {peerId: activePeerId, title: activeTitle};
      activePeerId = thread.peerId;
      activeThreadId = thread.threadId;
      activeTitle = 'Comments';
      threadKind = 'comments';
      threadCommentCount = thread.count || message.repliesCount;
      activeIsForum = false;
      // The discussion group is a megagroup: ticks, not view counts, and the
      // composer must be live so a comment can actually be posted.
      activeIsChannel = false;
      activeIsUser = false;
      activeIsSelf = false;
      activeRestriction = '';
      topicOpen = true;
      replyTo = null;
      await openHistory(thread.peerId, thread.threadId, thread.count, thread.readMaxId);
    } catch (err: any) {
      error = errorOf(err, 'Could not open comments');
    }
  }

  /** Back out of a comment thread to the channel post it belongs to. */
  async function leaveCommentThread() {
    const origin = commentsOrigin;
    commentsOrigin = null;
    threadKind = '';
    threadCommentCount = 0;
    activeThreadId = undefined;
    if (!origin) {
      activePeerId = null;
      return;
    }

    const dialog = dialogs.find((d) => d.peerId === origin.peerId);
    if (dialog) {
      await openChat(dialog);
      return;
    }

    activePeerId = origin.peerId;
    activeTitle = origin.title;
    await openHistory(origin.peerId);
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
        windowAtLatest = false;
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

  /**
   * Jump from a reply header to the message it answers. A cross-chat reply
   * points into another conversation, so that one is opened first.
   */
  async function jumpToReply(reply: NonNullable<MessageItem['reply']>) {
    if (reply.deleted) return;

    if (reply.peerId !== activePeerId) {
      await openPeerChat(reply.peerId);
    }

    await jumpTo(reply.mid);
  }

  /* ---------- forward and copy ---------- */

  async function openForward(message: MessageItem) {
    forwarding = [message];
    allDialogs = await loadDialogs(100, 0);
  }

  async function doForward(targets: number[], options: ForwardOptions) {
    const mids = forwarding.map((m) => m.mid);
    const fromPeerId = activePeerId;
    forwarding = [];
    selecting = false;
    selected = new Set();
    if (!mids.length || !targets.length || fromPeerId === null) return;

    try {
      await forwardTo(fromPeerId, mids, targets, options);
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
   * Open the profile behind an @mention. A username has to be resolved through
   * the server; a mentionName entity already carries the user id.
   */
  async function openMention(mention: string, kind: 'username' | 'userId') {
    if (kind === 'userId') {
      profilePeerId = Number(mention);
      return;
    }

    const peerId = await resolveUsername(mention);
    if (peerId === null) {
      error = `No account found for @${mention}`;
      return;
    }
    profilePeerId = peerId;
  }

  /** Place a call, explaining the failure rather than opening a dead screen. */
  async function placeCall() {
    if (activePeerId === null) return;

    const result = await startCall(activePeerId);
    if (result.ok) return;

    error =
      result.reason === 'mic-blocked' ?
        'Microphone blocked. Allow microphone access for this site in your browser settings, then try again.' :
      result.reason === 'no-mic' ?
        (result.detail ?? 'No microphone found. Connect one and try again.') :
        `Could not start the call${result.detail ? `: ${result.detail}` : ''}`;
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
      topicOpen = false;
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

  /**
   * Music and voice play in the persistent bar rather than in the bubble, so
   * playback survives leaving the chat. The bar is the single audio source:
   * starting a track stops anything else the page is playing.
   */
  function openInPlayer(message: MessageItem) {
    const kind = message.media?.kind;
    if (kind !== 'audio' && kind !== 'voice') return;
    if (message.media?.selfDestruct || activePeerId === null) return;
    playAudioMessage(activePeerId, message.mid).catch(() => {});
  }

  function openLightbox(message: MessageItem) {
    const index = mediaMessages.findIndex((m) => m.mid === message.mid);
    if (index >= 0) lightboxIndex = index;

    // Opening unwatched media is what makes it watched; the sender is owed
    // that receipt just as much as a read text message.
    if (message.media?.unread && !message.out && activePeerId !== null) {
      readMediaContents(activePeerId, [message.mid]).catch(() => {});
    }
  }

  /* ---------- global search ---------- */

  /**
   * The search pane owns its own results and debounce; the box here only holds
   * the query and decides when the pane replaces the chat list.
   */
  function openSearch() {
    searchOpen = true;
  }

  function closeSearch() {
    searchOpen = false;
    query = '';
    searchBox?.blur();
  }

  function onQueryKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
    }
  }

  /** A search result opens like a chat-list row, dialog or not. */
  async function openSearchPeer(peerId: number) {
    try {
      const target = await dialogTargetFor(peerId);
      closeSearch();
      await openChat(target);
    } catch (err: any) {
      error = errorOf(err, 'Could not open that chat');
    }
  }

  /** Open the chat a found message lives in, then jump to the message itself. */
  async function openSearchMessage(peerId: number, mid: number) {
    try {
      const target = await dialogTargetFor(peerId);
      closeSearch();
      await openChat(target);
      if (activePeerId === peerId) await jumpTo(mid);
    } catch (err: any) {
      error = errorOf(err, 'Could not open that message');
    }
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

  let attachMenu = $state(false);
  let locationSender = $state(false);
  let pollComposer = $state(false);
  /** Picking someone to share as a contact card, rather than to forward to. */
  let contactPicking = $state(false);
  let pollResults = $state<{mid: number; poll: PollPreview} | null>(null);

  async function openContactPicker() {
    attachMenu = false;
    if (activePeerId === null) return;
    allDialogs = await loadDialogs(100, 0);
    contactPicking = true;
  }

  async function shareContact(contactPeerId: number) {
    contactPicking = false;
    if (activePeerId === null) return;

    const replyToMsgId = replyTo?.mid;
    replyTo = null;

    try {
      await sendContact(activePeerId, contactPeerId, {threadId: activeThreadId, replyToMsgId});
    } catch (err: any) {
      error = errorOf(err, 'Could not share the contact');
    }
  }

  /** Queue files for confirmation rather than sending them blind. */
  function attach(files: FileList | File[] | null) {
    // Queuing a second batch over one that is mid-upload would strand the
    // progress the dialog is showing; make the user finish or cancel first.
    if (!files || activePeerId === null || upload) return;
    const list = Array.from(files);
    if (list.length) pendingFiles = list;
  }

  /**
   * Upload the confirmed batch, keeping the dialog up while it runs so the
   * progress bars and the cancel button have somewhere to live.
   */
  async function confirmSend(items: SendFileItem[], caption: string) {
    if (activePeerId === null || upload) return;

    const replyToMsgId = replyTo?.mid;
    replyTo = null;
    draft = '';

    uploadProgress = items.map(() => ({progress: 0, error: ''}));

    const handle = sendFilesGrouped(activePeerId, items, {
      caption,
      threadId: activeThreadId,
      replyToMsgId,
      onprogress: (state) => (uploadProgress = state)
    });
    upload = handle;

    try {
      await handle.promise;
    } catch (err: any) {
      // A cancel rejects the same way a failure does; only a real failure is
      // worth putting in front of the user.
      if (upload === handle) error = errorOf(err, 'Upload failed');
    } finally {
      if (upload === handle) {
        upload = null;
        uploadProgress = null;
        pendingFiles = [];
      }
    }
  }

  /** Abort the batch in flight and put the dialog back to its editable state. */
  function cancelUpload() {
    upload?.cancel();
    upload = null;
    uploadProgress = null;
    pendingFiles = [];
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth = 0;
    dragging = false;
    attach(e.dataTransfer?.files ?? null);
  }

  /**
   * `dragenter`/`dragleave` fire for every element the pointer crosses, so a
   * bare `dragleave` handler flickers the overlay off over each child. Counting
   * enters against leaves is what keeps it steady.
   */
  function onDragEnter(e: DragEvent) {
    if (activePeerId === null || !hasFiles(e)) return;
    dragDepth++;
    dragging = true;
  }

  function onDragLeave() {
    if (dragDepth > 0) dragDepth--;
    if (!dragDepth) dragging = false;
  }

  /** Ignore drags of selected text or a link — only files open the dialog. */
  function hasFiles(e: DragEvent) {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
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

  /**
   * Put the caret back in the composer. Clicking Reply moves focus to the
   * button, and opening a chat leaves it wherever it was, so anything that
   * sets up a message has to hand focus back itself.
   *
   * Skipped on touch, where stealing focus pops the on-screen keyboard over
   * the conversation the moment it opens. The test asks for a coarse pointer
   * rather than a fine one: a device with no pointer at all reports neither,
   * and should still get a focused composer.
   */
  async function focusComposer() {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    await tick();
    composer?.focus();
  }

  /**
   * The text currently selected inside a message's bubble, as a quote. Telegram
   * attaches the excerpt the user highlighted, so replying while text is
   * selected quotes exactly that fragment instead of the whole message.
   */
  function quoteOf(message: MessageItem): ReplyQuote | null {
    if (!message.text) return null;

    // Clicking the button collapses the live selection, so the tracked one is
    // what survives that far; the live read is the fallback for a keyboard path.
    const remembered = trackedQuote(message.mid);
    if (remembered) return remembered;

    const bubble = scroller?.querySelector<HTMLElement>(`[data-mid="${message.mid}"]`);
    return bubble ? quoteFromSelection(bubble, message.text) : null;
  }

  // Quoting needs the selection as it was made, not as it survives the click
  // that acts on it, so it is captured while it happens.
  $effect(() => trackQuoteSelection((mid) => messages.find((m) => m.mid === mid)?.text ?? ''));

  function replyToMessage(message: MessageItem) {
    const quote = quoteOf(message);
    clearTrackedQuote();
    replyTo = message;
    replyContext = activePeerId === null ?
      null :
      {mid: message.mid, peerId: activePeerId, chatTitle: '', quote};
    focusComposer();
  }

  /**
   * "Reply in…" — keep this message as the reply target but write the answer in
   * a different chat. The reply then carries `replyToPeerId`, and the bubble it
   * produces renders as a cross-chat reply on both sides.
   */
  async function openReplyElsewhere(message: MessageItem) {
    // The selection is read now: picking a chat takes several clicks, and none
    // of them leaves it intact.
    replyElsewhereQuote = quoteOf(message);
    clearTrackedQuote();
    replyingElsewhere = message;
    allDialogs = await loadDialogs(100, 0);
  }

  async function doReplyElsewhere(toPeerId: number) {
    const message = replyingElsewhere;
    const sourcePeerId = activePeerId;
    const sourceTitle = activeTitle;
    const quote = replyElsewhereQuote;
    replyElsewhereQuote = null;
    replyingElsewhere = null;
    if (!message || sourcePeerId === null) return;

    // Opening the chat clears the pending reply, so the target is set after.
    await openPeerChat(toPeerId);
    replyTo = message;
    replyContext = {mid: message.mid, peerId: sourcePeerId, chatTitle: sourceTitle, quote};
    focusComposer();
  }

  function cancelReply() {
    replyTo = null;
    replyContext = null;
  }

  /** Drops the quote but keeps replying, like Telegram's "remove quote". */
  function dropQuote() {
    if (replyContext) replyContext = {...replyContext, quote: null};
  }

  /** The reply context, but only while it still describes the reply target. */
  const activeReplyContext = $derived(
    replyTo && replyContext?.mid === replyTo.mid ? replyContext : null
  );

  function startEdit(message: MessageItem) {
    editing = message;
    replyTo = null;
    // Markers back in, so the formatting the message already carries survives
    // the round trip instead of being flattened by the save.
    draft = message.parts?.length ? partsToMarkdown(message.parts) : message.text;
    focusComposer();
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
    // The query part is optional: "@bot" alone already asks the bot for its
    // default results, which is where an "open app" button usually lives.
    const match = /^@(\w{3,32})(?:\s+([\s\S]*))?$/.exec(draft);
    clearTimeout(inlineTimer);

    if (!match || activePeerId === null) {
      inlineResults = [];
      inlineSwitch = null;
      inlineBot = '';
      return;
    }

    const [, bot, query] = match;
    inlineBot = bot;
    inlineTimer = setTimeout(async () => {
      const answer = await queryInlineBot(activePeerId!, bot, query ?? '');
      if (inlineBot !== bot) return;
      inlineResults = answer.results;
      inlineSwitch = answer;
    }, 400);
  }

  async function pickInline(result: InlineResultItem) {
    if (activePeerId === null) return;
    const bot = inlineBot;
    inlineResults = [];
    inlineSwitch = null;
    draft = '';

    try {
      await sendInlineResult(activePeerId, bot, result.queryAndResultId);
    } catch (err: any) {
      error = errorOf(err, 'Failed to send inline result');
    }
  }

  /** The "open app" button an inline bot puts above its results. */
  function openInlineWebApp() {
    const answer = inlineSwitch;
    if (!answer?.switchWebView || activePeerId === null) return;

    miniApp = {
      botId: answer.botId,
      peerId: activePeerId,
      url: answer.switchWebView.url,
      buttonText: answer.switchWebView.text,
      title: answer.switchWebView.text,
      isSimpleWebView: true,
      fromSwitchWebView: true
    };
  }

  /* ---------- bot keyboards and mini apps ---------- */

  /**
   * A t.me link can point at a mini app rather than a chat — that is how a
   * game's "join" button is sent. Those open in the app; anything else is an
   * ordinary link.
   */
  function openLink(url: string): boolean {
    // A t.me/addstickers link opens the pack in place instead of the browser.
    const stickerSet = parseStickerSetLink(url);
    if (stickerSet) {
      packSheet = {setKey: stickerSet, docId: ''};
      return true;
    }

    const link = parseMiniAppLink(url);
    if (!link) return false;

    const peerId = activePeerId;
    openBotAppLink(link, peerId ?? 0)
      .then((request) => {
        if (activePeerId === peerId) miniApp = request;
      })
      .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));

    return true;
  }

  /** Same rule, for places that must open the link themselves when it is not an app. */
  function followLink(url: string) {
    if (!openLink(url)) window.open(url, '_blank', 'noopener,noreferrer');
  }

  /* ---------- sponsored messages ---------- */

  /**
   * Report the impression once the ad has actually been on screen — a view sent
   * on mount would be a view the user never had.
   */
  function sponsoredSeen(node: HTMLElement, key: string) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      if (sponsoredViewed === key) return;
      sponsoredViewed = key;
      viewSponsored(key).catch(() => {});
    });

    observer.observe(node);
    return {destroy: () => observer.disconnect()};
  }

  function openSponsored(item: SponsoredItem) {
    clickSponsored(item.key).catch(() => {});
    followLink(item.url);
  }

  function openBotMenuApp() {
    if (activePeerId === null || !botMenuButton) return;

    miniApp = {
      botId: activePeerId,
      peerId: activePeerId,
      url: botMenuButton.url,
      buttonText: botMenuButton.text,
      title: botMenuButton.text,
      fromBotMenu: true
    };
  }

  async function pressButton(message: MessageItem, button: MessageButton) {
    if (activePeerId === null) return;
    // Keyboards belong to the bot that sent the message.
    const botId = message.fromId;

    switch (button.kind) {
      case 'url':
        if (button.url) followLink(button.url);
        break;

      case 'webview':
        miniApp = {
          botId,
          peerId: activePeerId,
          url: button.url,
          buttonText: button.text,
          title: button.text
        };
        break;

      case 'simpleWebView':
        miniApp = {
          botId,
          peerId: activePeerId,
          url: button.url,
          buttonText: button.text,
          title: button.text,
          isSimpleWebView: true
        };
        break;

      case 'callback':
        try {
          const answer = await pressCallbackButton(activePeerId, message.mid, button.row, button.column);
          if (answer.url) followLink(answer.url);
          else if (answer.message) error = answer.message;
        } catch (err: any) {
          error = errorOf(err, 'The bot did not answer');
        }
        break;

      case 'switchInline':
        draft = `@${await botUsername(botId)} ${button.payload}`.trimEnd();
        onDraftInput();
        composer?.focus();
        break;

      case 'copy':
        try {
          await navigator.clipboard.writeText(button.payload);
        } catch (err) {
          // Clipboard access can be denied; nothing else to do here.
        }
        break;

      case 'text':
        try {
          await sendMessage(activePeerId, button.text, {threadId: activeThreadId});
        } catch (err: any) {
          error = errorOf(err, 'Send failed');
        }
        break;
    }
  }

  async function botUsername(botId: number): Promise<string> {
    const peer = await getPeerBrief(botId);
    return peer?.username ?? '';
  }

  /**
   * Whether this chat's bot pins a web app next to the composer. Fetched after
   * the chat has rendered so it never delays opening one.
   */
  $effect(() => {
    const peerId = activePeerId;
    botMenuButton = null;
    if (peerId === null) return;

    let cancelled = false;
    getBotMenuButton(peerId).then((button) => {
      if (!cancelled) botMenuButton = button;
    });

    return () => {
      cancelled = true;
    };
  });

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
      // Nothing to send: treat it as "take me back to the end", which is where
      // Enter leaves you after a send anyway.
      if (!draft.trim() && !editing) jumpToLatest();
      else submit(e);
      return;
    }

    // Bare Up on an empty composer picks up the last message you can still
    // edit — the desktop shortcut for "fix what I just sent". With text in the
    // box Up is caret movement and must stay that way.
    if (
      e.key === 'ArrowUp' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey &&
      !e.altKey &&
      !draft &&
      !editing
    ) {
      const last = [...messages].reverse().find((m) => m.editable && m.text && !m.service);
      if (!last) return;
      e.preventDefault();
      startEdit(last);
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

  /**
   * Escape peels one layer off the chat at a time and, once nothing is left to
   * dismiss, closes the conversation back to the chat list.
   *
   * Overlays that own their own Escape (the lightbox, the file confirmation,
   * the story viewer) or that are not modal (a mini app) get skipped: this
   * handler is on window and would otherwise fire behind them. The story
   * viewer keeps its state inside Stories, so it is detected in the DOM.
   */
  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.isComposing) return;

    if (
      lightboxIndex !== null ||
      pendingFiles.length ||
      miniApp ||
      showSettings ||
      folderEditorOpen ||
      topicEditor ||
      newChatOpen ||
      editingFolder ||
      forwarding.length ||
      replyingElsewhere ||
      profilePeerId !== null ||
      showInfo ||
      document.querySelector('.viewer')
    ) {
      return;
    }

    if (packSheet) packSheet = null;
    else if (messageMenu) messageMenu = null;
    else if (menuFor) menuFor = null;
    else if (topicMenuFor !== null) topicMenuFor = null;
    else if (starReactionFor !== null) starReactionFor = null;
    else if (reactionPickerFor) reactionPickerFor = null;
    else if (readByFor) readByFor = null;
    else if (selecting) {
      selecting = false;
      selected = new Set();
    }
    else if (showPicker) showPicker = false;
    else if (chatSearchOpen) closeChatSearch();
    else if (editing) cancelEdit();
    else if (replyTo) replyTo = null;
    else if (activePeerId !== null || topicOpen) {
      backToChats();
      // Landing back on the list, not on a forum's topic list: the search box
      // only exists in that state, and only after the pane re-renders.
      if (activePeerId === null) focusSearchBox();
    }
    else return;

    e.preventDefault();
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
    // A peer the server restricts on this platform: its history is never
    // requested, only the reason is shown.
    activeRestriction = dialog.restrictionText;
    sponsored = null;

    topicOpen = false;
    topicMenuFor = null;
    threadKind = '';
    threadCommentCount = 0;
    commentsOrigin = null;
    savedDialogs = [];
    savedTag = '';

    if (activeRestriction) return;

    // Saved Messages can be split per original sender. The preference is local,
    // so the split list is only fetched when it is actually the active view.
    if (dialog.isSelf) {
      savedAsChats = isSavedViewedAsChats();
      if (savedAsChats) {
        await refreshSavedDialogs();
        return;
      }
    }

    if (dialog.isForum) {
      forumAsMessages = await isViewingForumAsMessages(dialog.peerId);
      if (forumAsMessages) {
        // "View as messages": one flat timeline, no topic list in between.
        topicOpen = true;
        await openHistory(dialog.peerId, undefined, dialog.unread, dialog.readMaxId);
        return;
      }

      canManageForum = await canCreateTopic(dialog.peerId);
      await refreshTopics();
      return;
    }

    await openHistory(dialog.peerId, undefined, dialog.unread, dialog.readMaxId);
  }

  /* ---------- forum topics ---------- */

  async function refreshTopics() {
    if (activePeerId === null) return;
    const peerId = activePeerId;
    try {
      const loaded = await loadTopics(peerId);
      if (activePeerId !== peerId) return;
      // Pinned topics sit above the rest, hidden ones drop out entirely — the
      // General topic is hidden rather than deleted.
      topics = loaded
        .filter((topic) => !topic.hidden)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.date - a.date);
    } catch (err: any) {
      error = errorOf(err, 'Failed to load topics');
    }
  }

  async function runTopicAction(action: () => Promise<unknown>) {
    topicMenuFor = null;
    try {
      await action();
      await refreshTopics();
    } catch (err: any) {
      error = errorOf(err, 'Topic action failed');
    }
  }

  async function removeTopic(topic: TopicItem) {
    if (!confirm(`Delete the topic "${topic.title}" and all its messages?`)) return;
    await runTopicAction(() => deleteTopic(activePeerId!, topic.threadId));
    if (activeThreadId === topic.threadId) backToChats();
  }

  async function onTopicSaved(threadId: number) {
    const creating = !topicEditor?.topic;
    topicEditor = null;
    await refreshTopics();
    if (creating) {
      const created = topics.find((topic) => topic.threadId === threadId);
      if (created) await openTopic(created);
    }
  }

  async function toggleForumAsMessages() {
    if (activePeerId === null) return;
    const peerId = activePeerId;
    const next = !forumAsMessages;
    try {
      await setViewForumAsMessages(peerId, next);
      forumAsMessages = next;
      const dialog = dialogs.find((d) => d.peerId === peerId);
      if (next) {
        topicOpen = true;
        activeThreadId = undefined;
        activeTitle = dialog?.title ?? activeTitle;
        threadKind = '';
        await openHistory(peerId, undefined, dialog?.unread ?? 0, dialog?.readMaxId ?? 0);
      } else {
        topicOpen = false;
        activeThreadId = undefined;
        messages = [];
        canManageForum = await canCreateTopic(peerId);
        await refreshTopics();
      }
    } catch (err: any) {
      error = errorOf(err, 'Could not switch the forum view');
    }
  }

  async function openTopic(topic: TopicItem) {
    // threadId 0 is the synthetic "all messages" row: the chat's own history,
    // not a thread. A forum still has a main timeline and hiding it makes
    // anything posted outside a topic unreachable.
    const threadId = topic.threadId || undefined;
    topicOpen = true;
    topicMenuFor = null;
    threadKind = threadId === undefined ? '' : 'topic';
    activeThreadId = threadId;
    activeTitle = threadId === undefined ? (dialogs.find((d) => d.peerId === activePeerId)?.title ?? 'All messages') : topic.title;
    replyTo = null;
    await openHistory(activePeerId!, threadId, topic.unread, 0);
  }

  /* ---------- Saved Messages sub-dialogs ---------- */

  async function refreshSavedDialogs() {
    const peerId = activePeerId;
    try {
      const loaded = await loadSavedDialogs();
      if (activePeerId !== peerId) return;
      savedDialogs = loaded.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.date - a.date);
    } catch (err: any) {
      error = errorOf(err, 'Failed to load saved chats');
    }
  }

  async function toggleSavedAsChats() {
    const next = !savedAsChats;
    savedAsChats = next;
    setSavedViewedAsChats(next);
    savedTag = '';
    if (next) {
      topicOpen = false;
      threadKind = '';
      activeThreadId = undefined;
      messages = [];
      await refreshSavedDialogs();
    } else {
      savedDialogs = [];
      await openSavedTimeline();
    }
  }

  /** All of Saved Messages as one timeline, the default view. */
  async function openSavedTimeline() {
    if (activePeerId === null) return;
    topicOpen = true;
    threadKind = '';
    activeThreadId = undefined;
    activeTitle = 'Saved Messages';
    replyTo = null;
    await openHistory(activePeerId, undefined, 0, 0);
  }

  /**
   * One sender's saved messages. Their peer id doubles as the thread id the
   * saved timeline is filtered by.
   */
  async function openSavedDialog(saved: SavedDialogItem) {
    if (activePeerId === null) return;
    showSidebarOnMobile = false;
    topicOpen = true;
    threadKind = 'saved';
    savedTag = '';
    activeThreadId = saved.savedPeerId;
    activeTitle = saved.title;
    replyTo = null;
    await openHistory(activePeerId, saved.savedPeerId, 0, 0);
  }

  /** Reload the open Saved view with a tag filter applied (or cleared). */
  async function applySavedTag(emoticon: string) {
    savedTag = emoticon;
    if (activePeerId === null) return;
    loadingHistory = true;
    try {
      messages = await loadHistory(activePeerId, {
        threadId: activeThreadId,
        savedReaction: emoticon || undefined
      });
      await tick();
      await scrollToBottom();
    } catch (err: any) {
      error = errorOf(err, 'Could not filter by tag');
    } finally {
      loadingHistory = false;
    }
  }

  async function openHistory(peerId: number, threadId?: number, unread = 0, readMaxId = 0) {
    loadingHistory = true;
    messages = [];
    firstUnreadMid = null;
    reachedStart = false;
    windowAtLatest = true;
    typingNames = [];
    editing = null;
    getPresence(peerId).then((info) => (presence = info.text)).catch(() => (presence = ''));
    loadPinned(peerId, threadId).then((message) => (pinnedMessage = message)).catch(() => (pinnedMessage = null));
    businessBot = null;
    refreshBusinessBot(peerId);
    // Off the chat-open path on purpose: the ad is fetched after the history
    // renders, never awaited before it. Only non-user peers carry one, and the
    // manager itself returns nothing for channels we can post to.
    sponsored = null;
    if (peerId < 0) {
      loadSponsored(peerId)
        .then((item) => {
          if (activePeerId === peerId) sponsored = item;
        })
        .catch(() => {});
    }
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
      focusComposer();
    } catch (err: any) {
      error = errorOf(err, 'Failed to load messages');
    } finally {
      loadingHistory = false;
    }
  }

  /**
   * Hide the pinned bar for this chat. The manager remembers which message was
   * dismissed, so pinning something newer shows the bar again.
   */
  async function dismissPinned() {
    if (activePeerId === null) return;

    const peerId = activePeerId;
    const previous = pinnedMessage;
    pinnedMessage = null;
    try {
      await hidePinnedMessage(peerId);
    } catch (err: any) {
      if (activePeerId === peerId) pinnedMessage = previous;
      error = errorOf(err, 'Could not hide the pinned message');
    }
  }

  /* ---------- business bot ---------- */

  /**
   * A business bot only ever manages a private chat, and the bar it gets is
   * per-chat: leaving the conversation must not carry its state over.
   */
  async function refreshBusinessBot(peerId: number) {
    if (peerId <= 0) return;

    const bot = await getBusinessBot(peerId);
    if (activePeerId === peerId) businessBot = bot;
  }

  $effect(() => {
    let disposed = false;
    let off: (() => void) | undefined;

    onPeerSettings((peerId) => {
      if (peerId === activePeerId) refreshBusinessBot(peerId);
    }).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else off = unsubscribe;
    });

    return () => {
      disposed = true;
      off?.();
    };
  });

  async function toggleBusinessBot() {
    if (!businessBot || activePeerId === null || businessBotBusy) return;

    const peerId = activePeerId;
    const paused = !businessBot.paused;
    businessBotBusy = true;
    try {
      await setBusinessBotPaused(peerId, paused);
      if (activePeerId === peerId && businessBot) businessBot = {...businessBot, paused};
    } catch (err: any) {
      error = errorOf(err, paused ? 'Could not stop the bot' : 'Could not start the bot');
    } finally {
      businessBotBusy = false;
    }
  }

  async function disconnectBusinessBot() {
    if (!businessBot || activePeerId === null || businessBotBusy) return;

    const peerId = activePeerId;
    businessBotBusy = true;
    try {
      await removeBusinessBot(peerId);
      if (activePeerId === peerId) businessBot = null;
    } catch (err: any) {
      error = errorOf(err, 'Could not remove the bot');
    } finally {
      businessBotBusy = false;
    }
  }

  async function focusSearchBox() {
    await tick();
    // select(), not focus(): whatever was searched for last is left highlighted
    // so the next keystroke replaces it instead of appending to it.
    searchBox?.select();
  }

  function backToChats() {
    showSidebarOnMobile = true;

    // A comment thread lives in a different peer than the post it belongs to,
    // so leaving it is a navigation, not just a thread reset.
    if (threadKind === 'comments') {
      leaveCommentThread();
      return;
    }

    // "View as messages" has no list to fall back to: the forum's timeline is
    // the whole view, so backing out leaves the chat entirely.
    if (topicOpen && !(activeIsForum && forumAsMessages) && !(activeIsSelf && !savedAsChats)) {
      topicOpen = false;
      threadKind = '';
      threadCommentCount = 0;
      savedTag = '';
      activeThreadId = undefined;
      messages = [];
      const dialog = dialogs.find((d) => d.peerId === activePeerId);
      activeTitle = dialog?.title ?? '';
      return;
    }

    exitSublist();
  }

  /** Drop the forum/saved sublist and whatever thread was open inside it. */
  function exitSublist() {
    activePeerId = null;
    topics = [];
    savedDialogs = [];
    topicOpen = false;
    threadKind = '';
    threadCommentCount = 0;
    savedTag = '';
    activeThreadId = undefined;
    messages = [];
    activeTitle = '';
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
   * Back to the end of the conversation. After a jump the loaded window sits
   * around an older message, so the newest page has to be fetched again before
   * scrolling means anything.
   */
  async function jumpToLatest() {
    releasePin();

    if (!windowAtLatest && activePeerId !== null) {
      loadingHistory = true;
      try {
        messages = await loadHistory(activePeerId, {threadId: activeThreadId});
        windowAtLatest = true;
        reachedStart = false;
        highlightedMid = null;
      } catch (err: any) {
        error = errorOf(err, 'Failed to load messages');
      } finally {
        loadingHistory = false;
      }
    }

    await scrollToBottom();
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

  /* ---------- send options: schedule, silent, effects, slow mode, send-as ---------- */

  let sendOptionsOpen = $state(false);
  let scheduledOpen = $state(false);
  let effectPickerOpen = $state(false);
  let sendAsPickerOpen = $state(false);

  /** Effect armed for the next message, '' for none. */
  let sendEffect = $state('');
  /** Emoticon of the armed effect, for the button label. */
  let sendEffectEmoticon = $state('');
  /** Per-chat "send without sound" preference. */
  let silentDefault = $state(false);
  /** Identity we post as here, null when posting as ourselves. */
  let sendAsPeerId = $state<number | null>(null);
  let slowMode = $state<SlowMode | null>(null);
  let scheduledCount = $state(0);
  /** Ticks once a second, but only while a slow-mode cooldown is running. */
  let nowSeconds = $state(Math.floor(Date.now() / 1000));
  /** Long-press timer on the send button, for touch devices. */
  let sendHoldTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set when a long press opened the sheet, so the release does not also send. */
  let sendHeld = false;

  const slowModeLeft = $derived(
    slowMode?.nextSendDate ? Math.max(0, slowMode.nextSendDate - nowSeconds) : 0
  );

  function slowModeLabel(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}:${`${seconds % 60}`.padStart(2, '0')}` : `${seconds}`;
  }

  /**
   * Refresh slow mode and send-as from **cached** full-chat state only. Both
   * readers are cache-only by design, so this never adds a request to the
   * chat-open path; the real values land later through `chat_full_update`.
   */
  function refreshChatSendState(peer: number) {
    getSlowMode(peer)
    .then((state) => {
      if (peer === activePeerId) slowMode = state;
    })
    .catch(() => {});

    getCurrentSendAs(peer)
    .then((id) => {
      if (peer === activePeerId) sendAsPeerId = id;
    })
    .catch(() => {});
  }

  function refreshScheduledCount(peer: number) {
    countScheduled(peer)
    .then((count) => {
      if (peer === activePeerId) scheduledCount = count;
    })
    .catch(() => {});
  }

  $effect(() => {
    const peer = activePeerId;

    sendOptionsOpen = false;
    scheduledOpen = false;
    effectPickerOpen = false;
    sendAsPickerOpen = false;
    sendEffect = '';
    sendEffectEmoticon = '';
    slowMode = null;
    sendAsPeerId = null;
    scheduledCount = 0;

    if (peer === null) {
      silentDefault = false;
      return;
    }

    silentDefault = isSilentByDefault(peer);
    refreshChatSendState(peer);
    refreshScheduledCount(peer);
  });

  $effect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    onChatFullUpdate((peer) => {
      if (!cancelled && peer === activePeerId) refreshChatSendState(peer);
    }).then((off) => {
      if (cancelled) off();
      else unsubscribe = off;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  });

  $effect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    onScheduledUpdate((peer) => {
      if (!cancelled && peer === activePeerId) refreshScheduledCount(peer);
    }).then((off) => {
      if (cancelled) off();
      else unsubscribe = off;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  });

  // Only run a clock while there is a cooldown to count down.
  $effect(() => {
    if (!slowMode?.nextSendDate) return;
    nowSeconds = Math.floor(Date.now() / 1000);
    const timer = setInterval(() => (nowSeconds = Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  });

  /** Right-click / long-press on the send button opens the options sheet. */
  function openSendOptions(e: Event) {
    e.preventDefault();
    if (activePeerId === null || editing) return;
    sendOptionsOpen = true;
  }

  function onSendPointerDown() {
    if (activePeerId === null || editing) return;
    clearTimeout(sendHoldTimer);
    sendHeld = false;
    sendHoldTimer = setTimeout(() => {
      sendHeld = true;
      sendOptionsOpen = true;
    }, 450);
  }

  function cancelSendHold() {
    clearTimeout(sendHoldTimer);
  }

  function pickEffect(effectId: string, emoticon: string) {
    sendEffect = effectId;
    sendEffectEmoticon = emoticon;
    effectPickerOpen = false;
  }

  async function submit(e: Event) {
    e.preventDefault();
    // The release of a long press must not send as well as open the sheet.
    if (sendHeld) {
      sendHeld = false;
      return;
    }
    await deliver();
  }

  async function deliver(options: {scheduleDate?: number; silent?: boolean} = {}) {
    const typed = draft.trim();
    if (!typed || activePeerId === null) return;
    // Slow mode blocks sending now, but never blocks scheduling for later.
    if (!editing && !options.scheduleDate && slowModeLeft > 0) return;

    // Markdown markers become entities here; what goes to the API is the text
    // with the markers stripped.
    const {text, entities: markupEntities} = parseComposerText(typed);
    if (!text) return;

    // Custom emoji only exist as entities over the alt text already in `text`.
    const entities = [...markupEntities, ...customEmojiEntities(text, pendingCustomEmoji)].sort(
      (a, b) => a.offset - b.offset
    );
    pendingCustomEmoji = [];

    // The debounced draft save is still pending with the text being sent; let
    // it fire and it writes the message back as a draft right after sendText
    // cleared it.
    clearTimeout(typingTimer);

    if (editing) {
      const target = editing;
      editing = null;
      draft = '';
      try {
        await editMessage(activePeerId, target.mid, text, entities);
        const updated = await getMessage(activePeerId, target.mid);
        if (updated) messages = messages.map((m) => (m.mid === target.mid ? updated : m));
      } catch (err: any) {
        error = errorOf(err, 'Edit failed');
      }
      return;
    }

    const context = activeReplyContext;
    const reply = replyTo ?
      replySendOptions(
        {
          mid: replyTo.mid,
          peerId: context?.peerId ?? activePeerId,
          title: replyTo.fromTitle,
          text: replyTo.text,
          chatTitle: context?.chatTitle ?? '',
          quote: context?.quote ?? null
        },
        activePeerId
      ) :
      {};
    const peer = activePeerId;
    const scheduleDate = options.scheduleDate;
    const effect = sendEffect;
    draft = '';
    cancelReply();
    sendEffect = '';
    sendEffectEmoticon = '';

    try {
      await sendMessageWithOptions(peer, text, {
        ...reply,
        threadId: activeThreadId,
        entities,
        scheduleDate,
        silent: options.silent ?? silentDefault,
        effect: effect || undefined,
        sendAsPeerId: sendAsPeerId ?? undefined
      });
      lastTypingSent = 0;
      sendTyping(peer, activeThreadId, 'cancel').catch(() => {});

      if (scheduleDate) {
        // A scheduled message never joins the timeline — it joins the queue.
        refreshScheduledCount(peer);
      } else {
        // Start the next cooldown immediately; the server-side value arrives
        // with the next chat_full_update and overwrites this.
        if (slowMode?.seconds) {
          nowSeconds = Math.floor(Date.now() / 1000);
          slowMode = {...slowMode, nextSendDate: nowSeconds + slowMode.seconds};
        }
        // The outgoing message arrives back through history_multiappend.
        await scrollToBottom();
      }
    } catch (err: any) {
      error = errorOf(err, 'Failed to send');
    }
  }

  function timeOf(unix: number) {
    if (!unix) return '';
    return new Date(unix * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }
</script>

<svelte:window onpaste={onPaste} onkeydown={onWindowKey} />

<CallScreen />

<div class="shell" class:show-sidebar={showSidebarOnMobile} class:show-chat={!showSidebarOnMobile}>
  <aside>
    <header>
      <button class="icon-button settings-open" onclick={() => (showSettings = true)} aria-label="Settings"><Glyph name="settings" /></button>
      {#if sublistOpen}
        <!-- Leaving the sublist leaves the peer entirely, so the open thread has
             to be torn down too — not just the list beside it. -->
        <button class="back" onclick={exitSublist} aria-label="Back">←</button>
        <span>{dialogs.find((d) => d.peerId === activePeerId)?.title ?? 'Topics'}</span>
        {#if topicListOpen}
          {#if canManageForum}
            <button
              class="icon-button"
              onclick={() => (topicEditor = {topic: null})}
              aria-label="New topic"
              title="New topic">＋</button
            >
          {/if}
          <button
            class="icon-button"
            onclick={toggleForumAsMessages}
            aria-label="View as messages"
            title="View as messages">≡</button
          >
        {:else}
          <button
            class="icon-button"
            onclick={toggleSavedAsChats}
            aria-label="View as messages"
            title="View as messages">≡</button
          >
        {/if}
      {:else}
        <span>Chats</span>
        <button class="icon-button new-chat" onclick={openNewChat} aria-label="New group or channel" title="New group or channel"><Glyph name="edit" /></button>
      {/if}
    </header>

    {#if !sublistOpen}
      <div class="search">
        <input
          bind:this={searchBox}
          placeholder="Search chats, channels and messages"
          bind:value={query}
          onfocus={openSearch}
          onkeydown={onQueryKey}
        />
        {#if searchOpen}
          <button class="search-cancel" onclick={closeSearch} aria-label="Close search">✕</button>
        {/if}
      </div>
      <Stories {dialogs} />
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

    {#if searchOpen}
      <GlobalSearch {query} onOpenPeer={openSearchPeer} onOpenMessage={openSearchMessage} />
    {:else}
    <div class="list">
      {#if loadingChats}
        <p class="muted">Loading chats…</p>
      {:else if topicListOpen}
        <button
          class="row-button"
          class:active={activeThreadId === undefined && topicOpen}
          onclick={() => openTopic(allMessagesRow)}
        >
          <span class="topic-glyph">≡</span>
          <span class="meta">
            <span class="row"><span class="title">All messages</span></span>
            <span class="row"><span class="preview">Everything in this chat</span></span>
          </span>
        </button>

        {#each topics as topic (topic.threadId)}
          <button
            class="row-button"
            class:active={topic.threadId === activeThreadId}
            onclick={() => openTopic(topic)}
            oncontextmenu={(e) => {
              e.preventDefault();
              topicMenuFor = topicMenuFor === topic.threadId ? null : topic.threadId;
            }}
          >
            <TopicIcon
              iconEmojiId={topic.iconEmojiId}
              iconColor={topic.iconColor}
              title={topic.title}
              isGeneral={topic.isGeneral}
            />
            <span class="meta">
              <span class="row">
                <span class="title">
                  {#if topic.pinned}
                    <span class="flag" title="Pinned"><Glyph name="pin" size={13} /></span>
                  {/if}
                  {#if topic.closed}<span class="flag" title="Closed">🔒</span>{/if}
                  {topic.title}
                </span>
                <span class="time">{timeOf(topic.date)}</span>
              </span>
              <span class="row">
                <span class="preview">{topic.preview}</span>
                {#if topic.unread}<span class="badge">{topic.unread}</span>{/if}
              </span>
            </span>
          </button>

          {#if topicMenuFor === topic.threadId && topic.canManage}
            <div class="menu">
              <button onclick={() => (topicEditor = {topic})}>Edit</button>
              <button onclick={() => runTopicAction(() => toggleTopicPin(activePeerId!, topic.threadId))}>
                {topic.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                onclick={() =>
                  runTopicAction(() => setTopicClosed(activePeerId!, topic.threadId, !topic.closed))}
              >
                {topic.closed ? 'Reopen' : 'Close'}
              </button>
              {#if topic.isGeneral}
                <!-- General cannot be deleted, only folded away. -->
                <button onclick={() => runTopicAction(() => setTopicHidden(activePeerId!, topic.threadId, true))}>
                  Hide
                </button>
              {:else}
                <button class="danger" onclick={() => removeTopic(topic)}>Delete</button>
              {/if}
            </div>
          {/if}
        {/each}
      {:else if savedListOpen}
        {#if !savedDialogs.length}
          <p class="muted">Nothing saved yet.</p>
        {:else}
          {#each savedDialogs as saved (saved.savedPeerId)}
            <button
              class="row-button"
              class:active={saved.savedPeerId === activeThreadId}
              onclick={() => openSavedDialog(saved)}
            >
              <Avatar peerId={saved.savedPeerId} title={saved.title} />
              <span class="meta">
                <span class="row">
                  <span class="title">
                    {#if saved.pinned}
                      <span class="flag" title="Pinned"><Glyph name="pin" size={13} /></span>
                    {/if}
                    {saved.title}
                  </span>
                  <span class="time">{timeOf(saved.date)}</span>
                </span>
                <span class="row"><span class="preview">{saved.preview}</span></span>
              </span>
            </button>
          {/each}
        {/if}
      {:else if archiveOpen && loadingArchive}
        <p class="muted">Loading archive…</p>
      {:else if !listedDialogs.length}
        {#if archiveOpen}
          <button class="row-button archive-row" onclick={closeArchive}>
            <span class="topic-glyph">←</span>
            <span class="meta"><span class="title">Back to chats</span></span>
          </button>
        {/if}
        <p class="muted">{archiveOpen ? 'The archive is empty.' : 'No chats yet.'}</p>
      {:else}
        {#if archiveOpen}
          <button class="row-button archive-row" onclick={closeArchive}>
            <span class="topic-glyph">←</span>
            <span class="meta">
              <span class="row">
                <span class="title">Archived chats</span>
              </span>
              <span class="row">
                <span class="preview">Back to chats</span>
              </span>
            </span>
          </button>
        {:else if archiveSummary.total && !query && activeFolder === 0}
          <button class="row-button archive-row" onclick={openArchive}>
            <span class="topic-glyph"><Glyph name="archive" size={18} /></span>
            <span class="meta">
              <span class="row">
                <span class="title">Archived chats</span>
              </span>
              <span class="row">
                <span class="preview">
                  {archiveSummary.total} chat{archiveSummary.total === 1 ? '' : 's'}
                </span>
                {#if archiveSummary.unread}<span class="badge">{archiveSummary.unread}</span>{/if}
              </span>
            </span>
          </button>
        {/if}

        {#each listedDialogs as dialog (dialog.peerId)}
          <button
            class="row-button"
            class:active={dialog.peerId === activePeerId}
            class:drag-over={dragOverPeerId === dialog.peerId}
            draggable={dialog.pinned}
            ondragstart={(e) => onRowDragStart(e, dialog)}
            ondragover={(e) => onRowDragOver(e, dialog)}
            ondragend={onRowDragEnd}
            ondrop={(e) => onRowDrop(e, dialog)}
            onclick={() => openChat(dialog)}
            oncontextmenu={(e) => {
              e.preventDefault();
              folderMenuFor = null;
              menuFor = menuFor?.peerId === dialog.peerId ? null : dialog;
            }}
          >
            <span class="avatar-wrap">
              <Avatar peerId={dialog.peerId} title={dialog.title} />
              {#if dialog.isUser && !dialog.isSelf && onlinePeerIds.includes(dialog.peerId)}
                <span class="online-dot" title="Online"></span>
              {/if}
            </span>
            <span class="meta">
              <span class="row">
                <span class="title">
                  {#if dialog.pinned}
                    <span class="flag" title="Pinned"><Glyph name="pin" size={13} /></span>
                  {/if}
                  {#if dialog.muted}
                    <span class="flag" title="Muted"><Glyph name="muted" size={13} /></span>
                  {/if}
                  {dialog.title}
                </span>
                <span class="time">{timeOf(dialog.date)}</span>
              </span>
              <span class="row">
                {#if typingTextFor(dialog.peerId)}
                  <span class="preview typing">{typingTextFor(dialog.peerId)}</span>
                {:else}
                  <span class="preview">{dialog.preview}</span>
                {/if}
                {#if dialog.unread}<span class="badge">{dialog.unread}</span>{/if}
              </span>
            </span>
          </button>

          {#if menuFor?.peerId === dialog.peerId}
            <div class="menu">
              <button
                onclick={() =>
                  runDialogAction(() =>
                    togglePin(dialog.peerId, archiveOpen ? FOLDER_ID_ARCHIVE : activeFolder)
                  )}
              >
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
              <button onclick={() => runDialogAction(() => setDialogArchived(dialog.peerId, !archiveOpen))}>
                {archiveOpen ? 'Unarchive' : 'Archive'}
              </button>
              <button class="submenu-trigger" onclick={() => openFolderMenu(dialog)}>
                Add to folder
                <span class="chevron">{folderMenuFor === dialog.peerId ? '▾' : '▸'}</span>
              </button>
              {#if folderMenuFor === dialog.peerId}
                {#if !folderMemberships.length}
                  <span class="submenu-empty">No folders yet</span>
                {:else}
                  {#each folderMemberships as membership (membership.folderId)}
                    <button
                      class="submenu-item"
                      onclick={() =>
                        runDialogAction(() =>
                          toggleFolderMembership(membership.folderId, dialog.peerId, !membership.included)
                        )}
                    >
                      <span class="check">{membership.included ? '✓' : ''}</span>
                      {membership.emoticon}
                      {membership.title}
                    </button>
                  {/each}
                {/if}
              {/if}
              {#if dialog.isSelf}
                <button
                  onclick={() => {
                    menuFor = null;
                    // Toggling the open chat has to redraw it; toggling a chat
                    // that is not open only needs the stored preference.
                    if (activePeerId === dialog.peerId) toggleSavedAsChats();
                    else setSavedViewedAsChats(!isSavedViewedAsChats());
                  }}
                >
                  {(activePeerId === dialog.peerId ? savedAsChats : isSavedViewedAsChats())
                    ? 'View as messages'
                    : 'View as chats'}
                </button>
              {/if}
              {#if dialog.isForum}
                <button
                  onclick={() => {
                    menuFor = null;
                    if (activePeerId === dialog.peerId) toggleForumAsMessages();
                    else openChat(dialog).then(toggleForumAsMessages);
                  }}
                >
                  {forumAsMessages && activePeerId === dialog.peerId
                    ? 'View as topics'
                    : 'View as messages'}
                </button>
              {/if}
              <button class="danger" onclick={() => runDialogAction(() => leaveOrDelete(dialog.peerId))}>
                Delete / Leave
              </button>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
    {/if}
  </aside>

  <section
    class:dragging
    ondragenter={onDragEnter}
    ondragover={(e) => {
      // Without preventDefault the browser refuses the drop and navigates to
      // the file instead.
      if (activePeerId !== null && hasFiles(e)) e.preventDefault();
    }}
    ondragleave={onDragLeave}
    ondrop={onDrop}
    aria-label="Conversation"
  >
    {#if dragging}
      <div class="drop-overlay">
        <div class="drop-card">
          <Glyph name="attach" size={28} />
          <strong>Drop to send</strong>
          <span class="muted">Photos and videos go as an album, anything else as a file</span>
        </div>
      </div>
    {/if}
    {#if activePeerId === null || (sublistOpen && !topicOpen)}
      <div class="empty">
        <p class="muted">
          {topicListOpen ? 'Select a topic' : savedListOpen ? 'Select a saved chat' : 'Select a chat'}
        </p>
        <!-- Same disclosure the sign-in card carries; required for a
             third-party client by https://core.telegram.org/api/terms. -->
        <p class="disclosure">
          Web S is an unofficial client built on the Telegram API. Not affiliated with Telegram.
        </p>
        {#if GIT_COMMIT_URL}
          <a
            class="build-commit"
            href={GIT_COMMIT_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Built from {GIT_COMMIT}"
          >
            {GIT_COMMIT_SHORT}
          </a>
        {/if}
      </div>
    {:else}
      <header>
        <button class="back-mobile" onclick={() => (showSidebarOnMobile = true)} aria-label="Back">←</button>
        <button class="title-button" onclick={() => (showInfo = !showInfo)}
        >{activeTitle}{#if activePeerId !== null}<EmojiStatus peerId={activePeerId} size={16} />{/if}</button>
        {#if threadKind === 'comments'}
          <button class="thread-tag thread-back" onclick={leaveCommentThread} title="Back to the post">
            {threadCommentCount
              ? `${threadCommentCount} ${threadCommentCount === 1 ? 'comment' : 'comments'}`
              : 'comments'}
          </button>
        {:else if threadKind === 'topic'}
          <span class="thread-tag">topic</span>
        {:else if threadKind === 'saved'}
          <span class="thread-tag">saved</span>
        {/if}
        <span class="presence">
          {typingNames.length
            ? `${typingNames.join(', ')} ${typingNames.length > 1 ? 'are' : 'is'} typing…`
            : presence}
        </span>
        {#if activeIsUser && !activeIsSelf}
          <button class="icon-button" onclick={placeCall} aria-label="Call"><Glyph name="call" /></button>
        {/if}
        <button class="icon-button" onclick={() => (chatSearchOpen = !chatSearchOpen)} aria-label="Search messages"><Glyph name="search" /></button>
      </header>

      {#if activeIsSelf}
        <SavedTags
          savedPeerId={threadKind === 'saved' ? activeThreadId : undefined}
          active={savedTag}
          onselect={applySavedTag}
        />
      {/if}

      {#if chatSearchOpen}
        <div class="chat-search">
          <input placeholder="Search in chat" bind:value={chatQuery} oninput={onChatQueryInput} />
          {#if chatResults?.length}
            <span class="result-counter">
              {chatResultIndex + 1} of {Math.max(chatResultCount, chatResults.length)}
            </span>
            <button
              class="step"
              onclick={() => stepResult(1)}
              disabled={chatResultIndex + 1 >= chatResults.length && chatResultsEnd}
              aria-label="Older result"
            >↓</button>
            <button
              class="step"
              onclick={() => stepResult(-1)}
              disabled={chatResultIndex <= 0}
              aria-label="Newer result"
            >↑</button>
          {/if}
          <button
            class="filters-toggle"
            class:on={chatFiltersOpen || chatFilter !== 'all' || !!chatFrom || !!chatDate}
            onclick={() => (chatFiltersOpen = !chatFiltersOpen)}
          >Filters</button>
          <button onclick={closeChatSearch} aria-label="Close search">✕</button>
        </div>

        {#if chatFiltersOpen}
          <div class="chat-filters">
            <div class="filter-chips">
              {#each MEDIA_FILTERS as option (option.value)}
                <button
                  class="chip"
                  class:on={chatFilter === option.value}
                  onclick={() => applyChatFilter(option.value)}
                >{option.label}</button>
              {/each}
            </div>

            <div class="filter-row">
              {#if canFilterBySender}
                <button class="chip" class:on={!!chatFrom} onclick={openFromPicker}>
                  {chatFrom ? `From: ${chatFrom.title}` : 'From sender'}
                </button>
                {#if chatFrom}
                  <button class="chip" onclick={() => pickFrom(null)} aria-label="Clear sender">✕</button>
                {/if}
              {/if}
              <label class="date-jump">
                Jump to date
                <input type="date" value={chatDate} onchange={(e) => jumpToDate(e.currentTarget.value)} />
              </label>
            </div>

            {#if chatFromOpen}
              <div class="from-picker">
                <input
                  placeholder="Search members"
                  bind:value={chatFromQuery}
                  oninput={onFromQueryInput}
                />
                {#if !chatMembers.length}
                  <p class="muted">No members found.</p>
                {:else}
                  {#each chatMembers as member (member.peerId)}
                    <button class="from-row" onclick={() => pickFrom(member)}>
                      <Avatar peerId={member.peerId} title={member.title} size={28} />
                      <span class="from-name">{member.title}</span>
                    </button>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        {#if chatResults}
          <div class="results">
            {#if !chatResults.length}
              <p class="muted">{chatSearching ? 'Searching…' : 'Nothing found.'}</p>
            {:else}
              {#each chatResults as result, index (result.mid)}
                <button
                  class="result"
                  class:current={index === chatResultIndex}
                  onclick={() => selectResult(index)}
                >
                  <span class="result-from">{result.fromTitle}</span>
                  <span class="result-text">{result.text || 'Media'}</span>
                </button>
              {/each}
              {#if !chatResultsEnd}
                <button class="result more" onclick={loadMoreChatResults} disabled={chatSearching}>
                  {chatSearching ? 'Loading…' : 'Load more'}
                </button>
              {/if}
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

      {#if businessBot}
        <div class="business-bar">
          <Avatar peerId={businessBot.botId} title={businessBot.title} size={28} />
          <span class="business-text">
            <span class="business-title">{businessBot.title}</span>
            <span class="business-note">
              {businessBot.paused ? 'Stopped for this chat' : 'Replying to this chat for you'}
            </span>
          </span>
          <button class="business-action" disabled={businessBotBusy} onclick={toggleBusinessBot}>
            {businessBot.paused ? 'Start bot' : 'Stop bot'}
          </button>
          {#if businessBot.manageUrl}
            <button class="business-action" onclick={() => openLink(businessBot!.manageUrl!)}>
              Manage
            </button>
          {/if}
          <button class="business-action danger" disabled={businessBotBusy} onclick={disconnectBusinessBot}>
            Remove
          </button>
        </div>
      {/if}

      {#if pinnedMessage}
        <div class="pinned-bar">
          <button class="pinned-jump" onclick={() => jumpTo(pinnedMessage!.mid)}>
            <span class="pinned-label">Pinned message</span>
            <span class="pinned-text">{pinnedMessage.text || 'Media'}</span>
          </button>
          <button class="pinned-dismiss" onclick={dismissPinned} aria-label="Hide pinned message" title="Hide pinned message">
            <Glyph name="close" />
          </button>
        </div>
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
        {#if activeRestriction}
          <p class="muted centered restricted-peer">{activeRestriction}</p>
        {:else if loadingHistory}
          <p class="muted">Loading…</p>
        {:else}
          {#if loadingOlder}
            <p class="muted centered">Loading older…</p>
          {:else if reachedStart}
            <p class="muted centered">Beginning of the chat</p>
          {/if}
          {#each rendered as group, groupIndex (group.key)}
            {@const message = group.items[0]}
            <!-- An album carries one caption for the whole group, and the server
                 is free to hang it off any item — so the bubble shows whichever
                 item actually has the text. -->
            {@const captioned = group.items.find((item) => item.rich || item.parts.length) ?? message}
            {#if startsNewDay(groupIndex)}
              <p class="day-divider">{dayLabel(message.date)}</p>
            {/if}
            {#if message.mid === firstUnreadMid}
              <p class="unread-divider" data-mid={message.mid}>Unread messages</p>
            {/if}
            {#if message.service && message.extra?.kind === 'gift'}
              <!-- A gift arrives as a service message, but it is a card: the
                   sticker, who sent it and what it is worth. -->
              <div class="service-card" data-mid={message.mid}>
                <GiftBubble gift={message.extra} fromTitle={message.fromTitle} />
              </div>
            {:else if message.service}
              <p
                class="service"
                class:highlighted={highlightedMid === message.mid}
                data-mid={message.mid}
              >{message.text}</p>
            {:else if message.restrictionText}
              <!-- The server restricts this message on this platform. Only its
                   own wording is shown; body, media and buttons stay hidden. -->
              <div class="line" class:out={message.out}>
                <div
                  class="bubble restricted"
                  class:out={message.out}
                  data-mid={message.mid}
                  use:observeForRead={message.mid}
                >
                  <span class="restricted-text">{message.restrictionText}</span>
                  <span class="stamp"><span class="time">{timeOf(message.date)}</span></span>
                </div>
              </div>
            {:else if message.stickerDocId}
              <!-- Wrapped in the same .line as a bubble, avatar and all, so a
                   sticker starts on the same column as the messages around it
                   instead of hugging the pane edge. -->
              <div class="line" class:out={message.out}>
                {#if !message.out}
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
                  class="sticker-bubble"
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
                    <button class="reply-btn" onclick={() => replyToMessage(message)}>Reply</button>
                    <button class="reply-btn" onclick={() => openForward(message)}>Forward</button>
                    <span class="time">{timeOf(message.date)}</span>
                  </span>
                </div>
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
                onclick={() => (selecting ? toggleSelected(message.mid) : openInPlayer(message))}
                ondblclick={() => quickReact(message)}
                role="presentation"
              >
                {#if !message.out && message.fromTitle}
                  <button class="author" onclick={() => (profilePeerId = message.fromId)}>
                    {message.fromTitle}<EmojiStatus peerId={message.fromId} size={14} />
                  </button>
                {/if}

                {#if message.forward}
                  <ForwardHeader forward={message.forward} onopenpeer={openPeerChat} />
                {/if}

                {#if message.reply}
                  <ReplyHeader reply={message.reply} onjump={() => jumpToReply(message.reply!)} />
                {/if}

                {#if group.items.length > 1}
                  <!-- Album tiling, the way the official clients lay it out: a
                       pair side by side, a hero plus a stack at three, a hero
                       over a strip at four, an even grid beyond that. -->
                  <div class="album" class:n2={group.items.length === 2} class:n3={group.items.length === 3} class:n4={group.items.length === 4} class:many={group.items.length > 4}>
                    {#each group.items as item, tileIndex (item.mid)}
                      <button class="album-item" class:first={tileIndex === 0} onclick={() => openLightbox(item)}>
                        <Media peerId={activePeerId} mid={item.mid} media={item.media!} fill />
                      </button>
                    {/each}
                  </div>
                {:else if message.media?.selfDestruct}
                  <!-- Self-destructing media is never rendered here: this client
                       cannot enforce the expiry, and showing a copy that outlives
                       it would interfere with the feature. -->
                  <span class="self-destruct">
                    🔥 {message.out ? 'Self-destructing media sent' : 'Self-destructing media — open it in an official Telegram app'}
                  </span>
                {:else if message.media}
                  {#if message.media.kind === 'photo' || message.media.kind === 'video' || message.media.kind === 'gif'}
                    <button class="media-button" onclick={() => openLightbox(message)}>
                      <Media peerId={activePeerId} mid={message.mid} media={message.media} />
                    </button>
                  {:else}
                    <Media peerId={activePeerId} mid={message.mid} media={message.media} />
                  {/if}
                {/if}

                {#if message.extra && activePeerId !== null}
                  {#if message.extra.kind === 'geo' || message.extra.kind === 'geoLive' || message.extra.kind === 'venue'}
                    <LocationBubble
                      peerId={activePeerId}
                      mid={message.mid}
                      location={message.extra}
                      onerror={(text) => (error = text)}
                    />
                  {:else if message.extra.kind === 'contact'}
                    <ContactBubble
                      contact={message.extra}
                      onmessage={openPeerChat}
                      onerror={(text) => (error = text)}
                    />
                  {:else if message.extra.kind === 'game'}
                    <GameBubble
                      peerId={activePeerId}
                      mid={message.mid}
                      game={message.extra}
                      onerror={(text) => (error = text)}
                    />
                  {:else if message.extra.kind === 'invoice'}
                    <InvoiceBubble
                      peerId={activePeerId}
                      mid={message.mid}
                      invoice={message.extra}
                      onerror={(text) => (error = text)}
                    />
                  {:else if message.extra.kind === 'checklist'}
                    <ChecklistBubble
                      peerId={activePeerId}
                      mid={message.mid}
                      checklist={message.extra}
                      onerror={(text) => (error = text)}
                    />
                  {:else if message.extra.kind === 'paidMedia'}
                    <!-- Paid media stays locked here: unlocking it is a Stars
                         purchase, and this client has no checkout. -->
                    <span class="paid-media">
                      🔒 {message.extra.count} paid item{message.extra.count === 1 ? '' : 's'} ·
                      {message.extra.stars} ⭐
                      {message.extra.unlocked ? '' : '— unlock in an official Telegram app'}
                    </span>
                  {/if}
                {/if}

                {#if message.pending && message.media && uploadOverall !== null}
                  <!-- The optimistic bubble shows the batch's progress; the
                       cancel here is the same abort the dialog offers. -->
                  <div class="upload-row">
                    <div
                      class="upload-bar"
                      role="progressbar"
                      aria-valuenow={Math.round(uploadOverall * 100)}
                    >
                      <div class="upload-fill" style="width: {Math.round(uploadOverall * 100)}%"></div>
                    </div>
                    <button class="upload-cancel" onclick={cancelUpload} aria-label="Cancel upload">
                      <Glyph name="close" size={12} />
                    </button>
                  </div>
                {/if}

                {#if captioned.rich}
                  <RichMessage blocks={captioned.rich} onmention={openMention} />
                {:else if captioned.parts.length}
                  <FormattedText parts={captioned.parts} onmention={openMention} onlink={openLink} />
                {/if}

                {#if message.webpage}
                  <a
                    class="webpage"
                    href={message.webpage.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onclick={(e) => {
                      if (openLink(message.webpage!.url)) e.preventDefault();
                    }}
                  >
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
                    {#if message.poll.totalVoters}
                      <button
                        class="poll-results-btn"
                        onclick={() => (pollResults = {mid: message.mid, poll: message.poll!})}
                      >View results</button>
                    {/if}
                  </div>
                {/if}

                {#if message.buttons.length}
                  <div class="keyboard">
                    {#each message.buttons as row, rowIndex (rowIndex)}
                      <div class="keyboard-row">
                        {#each row as button (button.column)}
                          <button
                            class="keyboard-btn"
                            disabled={button.kind === 'unsupported'}
                            onclick={() => pressButton(message, button)}
                          >
                            {#if button.kind === 'webview' || button.kind === 'simpleWebView'}
                              <span class="kb-icon">▸</span>
                            {/if}
                            {button.text}
                          </button>
                        {/each}
                      </div>
                    {/each}
                  </div>
                {/if}

                {#if !message.service && activePeerId !== null}
                  <ReactionBar
                    peerId={activePeerId}
                    mid={message.mid}
                    count={message.reactions.length}
                    revision={reactionRevisions[message.mid] ?? 0}
                    onopenpicker={(event) => openReactionPicker(event, message.mid)}
                    onopenstars={() => (starReactionFor = message.mid)}
                    onerror={(text) => (error = text)}
                  />
                {/if}

                {#if readByFor?.mid === message.mid}
                  <span class="read-by">
                    {readByFor.names.length
                      ? `Read by ${readByFor.names.slice(0, 8).join(', ')}${readByFor.names.length > 8 ? ` +${readByFor.names.length - 8}` : ''}`
                      : 'Read receipts are not available for this chat'}
                  </span>
                {/if}

                {#if activeIsChannel && threadKind !== 'comments'}
                  <!-- Channel posts get the full comments bar with the newest
                       commenters' faces, the way the official clients show it. -->
                  <CommentsButton
                    count={message.repliesCount}
                    commenters={message.commenters}
                    onopen={() => openComments(message)}
                  />
                {/if}

                <span class="stamp">
                  {#if message.repliesCount && !activeIsChannel}
                    <button class="reply-btn" onclick={() => openComments(message)}>
                      {message.repliesCount} 💬
                    </button>
                  {/if}
                  <button
                    class="reply-btn"
                    onclick={(event) => openReactionPicker(event, message.mid)}
                  >React</button>
                  <button class="reply-btn" onclick={() => replyToMessage(message)}>Reply</button>
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

          {#if sponsored}
            <div class="sponsored" use:sponsoredSeen={sponsored.key}>
              <span class="sponsored-label">
                {sponsored.recommended ? 'Recommended' : 'Sponsored'}
              </span>
              {#if sponsored.title}
                <span class="sponsored-title">{sponsored.title}</span>
              {/if}
              <span class="sponsored-text">{sponsored.text}</span>
              {#if sponsored.sponsorInfo || sponsored.additionalInfo}
                <span class="sponsored-info">
                  {[sponsored.sponsorInfo, sponsored.additionalInfo].filter(Boolean).join(' · ')}
                </span>
              {/if}
              <button class="sponsored-btn" onclick={() => openSponsored(sponsored!)}>
                {sponsored.buttonText}
              </button>
            </div>
          {/if}
        {/if}
      </div>

      {#if !atBottom}
        <button class="to-bottom" onclick={jumpToLatest} aria-label="Scroll to latest">
          <Glyph name="down" />
        </button>
      {/if}

      {#if inlineSwitch?.switchWebView}
        <div class="inline-switch">
          <button onclick={openInlineWebApp}>{inlineSwitch.switchWebView.text}</button>
        </div>
      {/if}

      {#if inlineResults.length}
        {@const isGallery = inlineSwitch?.gallery || inlineResults.every((r) => r.isGif || r.type === 'photo' || r.type === 'gif' || r.type === 'sticker')}
        <div class="inline-results" class:is-gallery={isGallery}>
          {#each inlineResults as result (result.queryAndResultId)}
            <button
              class:gallery-item={isGallery}
              onclick={() => pickInline(result)}
              title={result.title || result.description}
            >
              <InlinePreview {result} size={isGallery ? 80 : 44} isGrid={isGallery} />
              {#if !isGallery}
                <div class="inline-text">
                  <span class="inline-title">{result.title}</span>
                  {#if result.description}
                    <span class="inline-desc">{result.description}</span>
                  {/if}
                </div>
              {/if}
            </button>
          {/each}
        </div>
      {/if}

      {#if !editing}
        <StickerSuggest
          {draft}
          onpick={(docId) => {
            draft = '';
            pickDocument(docId);
          }}
        />
      {/if}

      {#if replyTo || editing}
        <div class="reply-bar">
          <span class="reply-quote">
            <span class="reply-title">
              {#if editing}
                Editing message
              {:else}
                {activeReplyContext?.quote ? 'Quoting' : 'Replying to'}
                {replyTo?.fromTitle}
                {#if activeReplyContext?.chatTitle}
                  <!-- The original is in another chat; say which one. -->
                  <span class="reply-in">in {activeReplyContext.chatTitle}</span>
                {/if}
              {/if}
            </span>
            <span class="reply-text">
              {activeReplyContext?.quote?.text || (editing ?? replyTo)?.text || 'Media'}
            </span>
          </span>
          {#if activeReplyContext?.quote}
            <button class="cancel" onclick={dropQuote} title="Reply without the quote">❝✕</button>
          {/if}
          <button
            class="cancel"
            onclick={() => (editing ? cancelEdit() : cancelReply())}
            aria-label="Cancel"
          >✕</button>
        </div>
      {/if}

      <form onsubmit={submit}>
        {#if showPicker}
          <Picker
            onemoji={(emoji) => (draft += emoji)}
            ondocument={pickDocument}
            oncustomemoji={(item) => {
              draft += item.emoji;
              pendingCustomEmoji = [...pendingCustomEmoji, item];
            }}
          />
        {/if}
        {#if sendAsPickerOpen && activePeerId !== null}
          <SendAsPicker
            peerId={activePeerId}
            current={sendAsPeerId}
            onpick={(id) => (sendAsPeerId = id)}
            onclose={() => (sendAsPickerOpen = false)}
          />
        {/if}
        {#if effectPickerOpen}
          <EffectPicker
            selected={sendEffect}
            onpick={pickEffect}
            onclose={() => (effectPickerOpen = false)}
          />
        {/if}
        {#if sendAsPeerId !== null}
          <button
            type="button"
            class="attach send-as"
            onclick={() => (sendAsPickerOpen = !sendAsPickerOpen)}
            title="Send message as…"
            aria-label="Send message as…"
            disabled={!!editing}
          ><Avatar peerId={sendAsPeerId} title="" size={22} /></button>
        {/if}
        {#if botMenuButton}
          <button
            type="button"
            class="attach bot-menu"
            onclick={openBotMenuApp}
            title={botMenuButton.text}
            aria-label={botMenuButton.text}
          ><Glyph name="app" size={20} /></button>
        {/if}
        <button
          type="button"
          class="attach"
          onclick={() => (showPicker = !showPicker)}
          aria-label="Emoji, stickers and GIFs"
          disabled={!!editing}
        ><Glyph name="emoji" size={20} /></button>
        <div class="attach-wrap">
          <button
            type="button"
            class="attach"
            onclick={() => (attachMenu = !attachMenu)}
            aria-label="Attach"
            disabled={!!editing}
          ><Glyph name="attach" size={20} /></button>
          {#if attachMenu}
            <div class="attach-menu">
              <button type="button" onclick={() => { attachMenu = false; mediaInput?.click(); }}>Photo or video</button>
              <button type="button" onclick={() => { attachMenu = false; fileInput?.click(); }}>File</button>
              <button type="button" onclick={() => { attachMenu = false; locationSender = true; }}>Location</button>
              <button type="button" onclick={openContactPicker}>Contact</button>
              <button type="button" onclick={() => { attachMenu = false; pollComposer = true; }}>Poll</button>
            </div>
          {/if}
        </div>
        <input
          class="file"
          type="file"
          multiple
          bind:this={fileInput}
          onchange={(e) => attach((e.currentTarget as HTMLInputElement).files)}
        />
        <!-- Same queue as the file input; only the picker's filter differs, and
             each item still gets its own photo/file choice in the dialog. -->
        <input
          class="file"
          type="file"
          multiple
          accept="image/*,video/*"
          bind:this={mediaInput}
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
        <FormatBar textarea={composer} />
        {#if !editing}
          <button
            type="button"
            class="attach effect-button"
            class:armed={!!sendEffect}
            onclick={() => (effectPickerOpen = !effectPickerOpen)}
            title={sendEffect ? 'Message effect armed' : 'Add a message effect'}
            aria-label="Add a message effect"
          >{sendEffectEmoticon || '✨'}</button>
        {/if}
        {#if scheduledCount > 0 && !editing}
          <button
            type="button"
            class="attach scheduled-button"
            onclick={() => (scheduledOpen = true)}
            title="Scheduled messages"
            aria-label="Scheduled messages"
          >🕑<span class="scheduled-count">{scheduledCount}</span></button>
        {/if}
        {#if !draft.trim() && !editing && activePeerId !== null}
          <!-- Empty composer: the send button gives way to the recorder, the
               same swap the official clients do. -->
          <VoiceRecorder
            peerId={activePeerId}
            threadId={activeThreadId}
            replyToMsgId={replyTo?.mid}
            onsent={() => {
              replyTo = null;
              scrollToBottom();
            }}
            onerror={(message) => (error = message)}
          />
        {:else}
          <button
            type="submit"
            class="send-button"
            class:silent={silentDefault && !editing}
            disabled={!draft.trim() || (!editing && slowModeLeft > 0)}
            aria-label={editing ? 'Save' : 'Send'}
            title={editing ?
              'Save' :
              slowModeLeft > 0 ?
                `Slow mode — wait ${slowModeLabel(slowModeLeft)}` :
                'Send. Right-click or hold for scheduled and silent send'}
            oncontextmenu={openSendOptions}
            onpointerdown={onSendPointerDown}
            onpointerup={cancelSendHold}
            onpointerleave={cancelSendHold}
          >
            {#if !editing && slowModeLeft > 0}
              <span class="slowmode">{slowModeLabel(slowModeLeft)}</span>
            {:else}
              <Glyph name={editing ? 'check' : 'send'} />
            {/if}
          </button>
        {/if}
      </form>

      {#if sendOptionsOpen && activePeerId !== null}
        <SendOptionsSheet
          peerId={activePeerId}
          isUser={activeIsUser}
          defaultSilent={silentDefault}
          onsend={(options) => {
            sendOptionsOpen = false;
            silentDefault = isSilentByDefault(activePeerId!);
            deliver(options);
          }}
          onclose={() => (sendOptionsOpen = false)}
        />
      {/if}

      {#if scheduledOpen && activePeerId !== null}
        <ScheduledMessages
          peerId={activePeerId}
          title={activeTitle}
          onclose={() => (scheduledOpen = false)}
        />
      {/if}

      <EffectOverlay peerId={activePeerId} />
    {/if}
  </section>

  {#if showSettings}
    <Settings
      onclose={() => (showSettings = false)}
      onminiapp={(botId) => {
        miniApp = {botId, peerId: activePeerId ?? botId, fromAttachMenu: true};
        showSettings = false;
      }}
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
      onmigrated={openPeerChat}
      onjump={(mid) => { showInfo = false; jumpTo(mid); }}
    />
  {/if}
</div>

{#if lightboxIndex !== null && activePeerId !== null}
  <Lightbox
    peerId={activePeerId}
    items={mediaMessages}
    bind:index={lightboxIndex}
    threadId={activeThreadId}
    onclose={() => (lightboxIndex = null)}
    onforward={openForward}
    onjump={jumpTo}
  />
{/if}

<AudioPlayerBar />


{#if pendingFiles.length}
  <!-- Keyed on the batch: the dialog seeds its per-item choices once, so a new
       batch has to arrive as a new component rather than a stale one. -->
  {#key pendingFiles}
    <SendFiles
      files={pendingFiles}
      progress={uploadProgress}
      onsend={confirmSend}
      oncancelupload={cancelUpload}
      onclose={() => (pendingFiles = [])}
    />
  {/key}
{/if}

{#if miniApp}
  <MiniApp
    request={miniApp}
    onclose={() => (miniApp = null)}
    onlink={openLink}
    onswitchinline={async (query) => {
      draft = `@${await botUsername(miniApp?.botId ?? 0)} ${query}`.trimEnd();
      onDraftInput();
      composer?.focus();
    }}
  />
{/if}

{#if reactionPickerFor && activePeerId !== null}
  <ReactionPicker
    peerId={activePeerId}
    mid={reactionPickerFor.mid}
    x={reactionPickerFor.x}
    y={reactionPickerFor.y}
    onpick={pickReaction}
    onpaid={() => {
      starReactionFor = reactionPickerFor?.mid ?? null;
      reactionPickerFor = null;
    }}
    onclose={() => (reactionPickerFor = null)}
  />
{/if}

{#if starReactionFor !== null && activePeerId !== null}
  <StarReactionSheet
    peerId={activePeerId}
    mid={starReactionFor}
    onsent={() => bumpReaction(starReactionFor!)}
    onclose={() => (starReactionFor = null)}
  />
{/if}

{#if messageMenu}
  {@const menuMessage = messages.find((m) => m.mid === messageMenu!.mid)}
  <div class="menu-backdrop" onclick={() => (messageMenu = null)} role="presentation"></div>
  <div class="context-menu" style="left: {messageMenu.x}px; top: {messageMenu.y}px">
    {#if menuMessage}
      <button onclick={() => { replyToMessage(menuMessage); messageMenu = null; }}>
        {trackedQuote(menuMessage.mid) ? 'Reply with quote' : 'Reply'}
      </button>
      <button onclick={() => { openReplyElsewhere(menuMessage); messageMenu = null; }}>
        Reply in…
      </button>
      {#if !menuMessage.service}
        <button
          onclick={() => {
            reactionPickerFor = {mid: menuMessage.mid, x: messageMenu!.x, y: messageMenu!.y};
            messageMenu = null;
          }}
        >React…</button>
      {/if}
      {#if menuMessage.text}
        <button onclick={() => { copyText(menuMessage); messageMenu = null; }}>Copy text</button>
      {/if}
      <button onclick={() => { openForward(menuMessage); messageMenu = null; }}>Forward</button>
      {#if menuMessage.stickerDocId}
        <button
          onclick={() => { packSheet = {setKey: '', docId: menuMessage.stickerDocId}; messageMenu = null; }}
        >View pack</button>
      {/if}
      {#if menuMessage.media?.kind === 'gif' && menuMessage.media.docId}
        <GifSaveAction docId={menuMessage.media.docId} ondone={() => (messageMenu = null)} />
      {/if}
      <button onclick={() => startSelecting(menuMessage.mid)}>Select</button>
      <!-- A sticker or a bare media message is editable in the API sense but
           has no text to edit; deleting it is still fair game. -->
      {#if menuMessage.editable && menuMessage.text}
        <button onclick={() => { startEdit(menuMessage); messageMenu = null; }}>Edit</button>
      {/if}
      {#if menuMessage.editable}
        <button class="danger" onclick={() => { removeMessage(menuMessage); messageMenu = null; }}>Delete</button>
      {/if}
    {/if}
  </div>
{/if}

{#if packSheet}
  <StickerSetSheet
    setKey={packSheet.setKey}
    docId={packSheet.docId}
    onsend={pickDocument}
    onclose={() => (packSheet = null)}
  />
{/if}

{#if forwarding.length}
  <ForwardSheet
    dialogs={allDialogs}
    count={forwarding.length}
    hasCaptions={forwarding.some((m) => m.media && m.text)}
    onforward={doForward}
    onclose={() => (forwarding = [])}
  />
{/if}

{#if replyingElsewhere}
  <PeerPicker
    title="Reply in…"
    dialogs={allDialogs}
    onpick={doReplyElsewhere}
    onclose={() => (replyingElsewhere = null)}
  />
{/if}

{#if contactPicking}
  <PeerPicker
    title="Share a contact"
    dialogs={allDialogs.filter((dialog) => dialog.isUser)}
    onpick={shareContact}
    onclose={() => (contactPicking = false)}
  />
{/if}

{#if locationSender && activePeerId !== null}
  <LocationSender
    peerId={activePeerId}
    threadId={activeThreadId}
    replyToMsgId={replyTo?.mid}
    onclose={() => { locationSender = false; replyTo = null; }}
    onerror={(text) => (error = text)}
  />
{/if}

{#if pollComposer && activePeerId !== null}
  <PollComposer
    peerId={activePeerId}
    threadId={activeThreadId}
    replyToMsgId={replyTo?.mid}
    onclose={() => { pollComposer = false; replyTo = null; }}
    onerror={(text) => (error = text)}
  />
{/if}

{#if pollResults && activePeerId !== null}
  <PollResults
    peerId={activePeerId}
    mid={pollResults.mid}
    poll={pollResults.poll}
    onclose={() => (pollResults = null)}
    onpeer={(id) => { pollResults = null; profilePeerId = id; }}
  />
{/if}

{#if newChatOpen}
  <NewChat
    dialogs={allDialogs}
    onclose={() => (newChatOpen = false)}
    oncreated={onChatCreated}
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

{#if topicEditor && activePeerId !== null}
  <TopicEditor
    peerId={activePeerId}
    topic={topicEditor.topic}
    onclose={() => (topicEditor = null)}
    onsaved={onTopicSaved}
  />
{/if}

{#if error}
  <button class="error" onclick={() => (error = '')} title="Dismiss">{error}</button>
{/if}

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
    background: var(--pane);
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

  .thread-back {
    background: none;
    cursor: pointer;
    font-family: inherit;
  }

  .thread-back:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .search-cancel {
    background: none;
    border: 0;
    color: var(--text-dim);
    cursor: pointer;
    padding: 4px;
    flex: none;
  }

  .search input {
    width: 100%;
    min-width: 0;
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

  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg-solid, var(--bg-elevated)) 82%, transparent);
    /* The overlay must not eat the dragenter/dragleave pair it depends on. */
    pointer-events: none;
  }

  .drop-card {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 24px 32px;
    border: 2px dashed var(--accent);
    border-radius: 16px;
    text-align: center;
  }

  .drop-card strong {
    font-size: 17px;
  }

  .attach {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 4px;
    display: grid;
    place-items: center;
    border-radius: 8px;
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
    display: inline-flex;
    color: var(--text-dim);
    flex: none;
  }

  .menu .submenu-trigger {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  .menu .submenu-item {
    display: flex;
    gap: 6px;
    padding-left: 20px;
  }

  .menu .check {
    width: 12px;
    flex: none;
    color: var(--accent);
  }

  .submenu-empty {
    padding: 9px 12px 9px 20px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .chevron {
    color: var(--text-dim);
  }

  .archive-row .topic-glyph {
    color: var(--text-dim);
  }

  .avatar-wrap {
    position: relative;
    display: flex;
    flex: none;
  }

  .online-dot {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #4dcb5f;
    border: 2px solid var(--bg);
  }

  .preview.typing {
    color: var(--accent);
  }

  .row-button.drag-over {
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .title-button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  /* Inside .line, which is a flex row: horizontal placement is the row's job
     (justify-content), so this only sets the internal layout. */
  .sticker-bubble {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .sticker-bubble.out {
    justify-items: end;
  }

  .album {
    display: grid;
    gap: 2px;
    width: 100%;
    max-width: 320px;
    border-radius: 10px;
    overflow: hidden;
  }

  .album.n2 {
    grid-template-columns: 1fr 1fr;
    aspect-ratio: 2 / 1;
  }

  .album.n3 {
    grid-template-columns: 2fr 1fr;
    grid-template-rows: 1fr 1fr;
    aspect-ratio: 3 / 2;
  }

  .album.n3 .first {
    grid-row: span 2;
  }

  .album.n4 {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: 2fr 1fr;
    aspect-ratio: 1 / 1;
  }

  .album.n4 .first {
    grid-column: span 3;
  }

  .album.many {
    grid-template-columns: repeat(3, 1fr);
  }

  .album.many .album-item {
    aspect-ratio: 1;
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

  .album-item {
    min-height: 0;
    overflow: hidden;
  }

  .upload-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }

  .upload-bar {
    flex: 1;
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text) 15%, transparent);
    overflow: hidden;
  }

  .upload-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.15s linear;
  }

  .upload-cancel {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--text) 10%, transparent);
    color: inherit;
    cursor: pointer;
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

  .row-button {
    display: flex;
    gap: 12px;
    width: 100%;
    padding: 7px 14px 7px 12px;
    background: none;
    /* border-left comes after the shorthand, or the reset wipes the rail. */
    border: none;
    border-left: 2px solid transparent;
    text-align: left;
    cursor: pointer;
    align-items: center;
    color: inherit;
  }

  .row-button:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  /* A rail and a flat fill. The gradient wash this replaces sat on top of the
     field behind it and the two fought. */
  .row-button.active {
    background: var(--row-active);
    border-left-color: var(--row-active-rail);
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

  .folder-badge {
    background: var(--action);
    color: var(--action-ink);
  }

  .empty {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 8px;
    height: 100%;
  }

  .empty .disclosure {
    max-width: 320px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-dim);
    text-align: center;
  }

  /* Which commit the running bundle came from — only while no chat is open, so
     it never sits on top of a conversation. */
  .empty .build-commit {
    position: absolute;
    right: 12px;
    bottom: 10px;
    padding: 2px 6px;
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-dim);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    text-decoration: none;
    opacity: 0.7;
    transition: opacity 0.15s;
  }

  .empty .build-commit:hover {
    opacity: 1;
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
    /* minmax(0, …) rather than the default 1fr: a grid track is min-content
       wide by default, so one long unbroken line — a fenced command, a URL —
       grew the track straight past the bubble's max-width, and the code block
       inside never got narrow enough to use its own overflow-x. */
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  /* Tinted, not filled — see the note above --bubble-out in app.css. Text stays
     the normal foreground, so an image or a screenshot keeps its own colour. */
  .bubble.out {
    align-self: flex-end;
    border-radius: var(--bubble-radius) var(--bubble-radius) 5px var(--bubble-radius);
    background: var(--bubble-out);
    border-color: var(--bubble-out-border);
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

  /* Links and mentions read normally now that the bubble is a tint rather than
     a slab of the accent they are coloured with. */

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

  .new-chat {
    margin-left: auto;
    font-size: 16px;
  }

  .keyboard {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
  }

  .keyboard-row {
    display: flex;
    gap: 4px;
  }

  .keyboard-btn {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-elevated);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }

  .keyboard-btn:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .keyboard-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .kb-icon {
    color: var(--accent);
    margin-right: 4px;
  }

  .inline-switch {
    padding: 6px 10px 0;
  }

  .inline-switch button {
    width: 100%;
    padding: 10px;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }

  .bot-menu {
    color: var(--accent);
  }

  .inline-results {
    max-height: 220px;
    overflow-y: auto;
    border-top: 1px solid var(--border);
    flex: none;
  }

  .inline-results.is-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 4px;
    padding: 8px 12px;
  }

  .inline-results button {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 8px 18px;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .inline-results button.gallery-item {
    display: block;
    padding: 0;
    border-radius: 6px;
    overflow: hidden;
  }

  .inline-results button:hover {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .inline-text {
    display: grid;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .inline-title {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .inline-desc {
    font-size: 12px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    display: grid;
    place-items: center;
    padding: 4px;
    border-radius: 8px;
  }

  .icon-button:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
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

  .result.current {
    background: var(--row-active);
  }

  .result.more {
    color: var(--accent);
    font-size: 13px;
    text-align: center;
  }

  .result-counter {
    font-size: 12px;
    color: var(--text-dim);
    align-self: center;
    white-space: nowrap;
  }

  .step:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .filters-toggle {
    font-size: 12px !important;
    padding: 4px 10px !important;
    border: 1px solid var(--border) !important;
    border-radius: 999px !important;
  }

  .filters-toggle.on {
    border-color: var(--accent) !important;
    color: var(--accent);
  }

  .chat-filters {
    padding: 8px 18px 10px;
    border-bottom: 1px solid var(--border);
    flex: none;
    display: grid;
    gap: 8px;
  }

  .filter-chips,
  .filter-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .chip {
    background: none;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    color: inherit;
    cursor: pointer;
  }

  .chip.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .date-jump {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .date-jump input {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: inherit;
    padding: 3px 6px;
    font: inherit;
    font-size: 12px;
  }

  .from-picker {
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 6px;
  }

  .from-picker input {
    width: 100%;
    padding: 6px 10px;
    margin-bottom: 4px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    outline: none;
  }

  .from-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 6px;
    background: none;
    border: 0;
    border-radius: 8px;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .from-row:hover {
    background: var(--bg-elevated);
  }

  .from-name {
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

  .bubble.selected,
  .sticker-bubble.selected {
    outline: 2px solid var(--accent);
    border-radius: 8px;
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

  .poll-results-btn {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
  }

  .paid-media {
    display: block;
    font-size: 13px;
    color: var(--text-dim);
  }

  .service-card {
    align-self: center;
    display: flex;
    justify-content: center;
    margin: 4px 0;
  }

  .attach-wrap {
    position: relative;
    display: flex;
  }

  .attach-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 140px;
    padding: 6px;
    border-radius: var(--pane-radius);
    border: 1px solid var(--border);
    background: var(--bg-solid);
  }

  .attach-menu button {
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .attach-menu button:hover {
    background: var(--bubble-in);
  }

  .pinned-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 12px;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    flex: none;
  }

  .pinned-jump {
    display: grid;
    gap: 1px;
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: 8px 18px;
    border: none;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  .pinned-dismiss {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--text-dim);
    cursor: pointer;
  }

  .pinned-dismiss:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
    color: var(--text);
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

  .bubble.restricted {
    font-style: italic;
    color: var(--text-dim);
  }

  .restricted-text {
    white-space: pre-wrap;
  }

  .restricted-peer {
    margin: auto;
    max-width: 420px;
  }

  .self-destruct {
    display: inline-block;
    padding: 6px 10px;
    border-radius: 10px;
    border: 1px dashed var(--border);
    font-size: 13px;
    color: var(--text-dim);
  }

  .sponsored {
    align-self: flex-start;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 560px;
    margin: 8px 0;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--surface-2, rgba(127, 127, 127, 0.08));
  }

  .sponsored-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .sponsored-title {
    font-weight: 600;
  }

  .sponsored-text {
    font-size: 14px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .sponsored-info {
    font-size: 11px;
    color: var(--text-dim);
  }

  .sponsored-btn {
    align-self: flex-start;
    margin-top: 4px;
    padding: 6px 12px;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .business-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 18px;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    flex: none;
  }

  .business-text {
    display: grid;
    gap: 1px;
    min-width: 0;
    margin-right: auto;
  }

  .business-title {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .business-note {
    font-size: 11px;
    color: var(--text-dim);
  }

  .business-action {
    flex: none;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: none;
    color: var(--accent);
    font-size: 12px;
    cursor: pointer;
  }

  .business-action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .business-action.danger {
    color: var(--danger);
  }

  .to-bottom {
    position: absolute;
    right: 24px;
    bottom: 84px;
    width: 42px;
    height: 42px;
    padding: 0;
    /* The glyph is a block-level SVG; without this it sits wherever the
       button's text baseline happens to fall, which is not the middle. */
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid var(--border);
    /* Solid, not the elevated tint: it floats over the conversation and has to
       stay readable against whatever is behind it. */
    background: var(--bg-solid);
    color: var(--text);
    font-size: 18px;
    cursor: pointer;
    z-index: 10;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
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
    min-width: 0;
    border-left-color: var(--accent);
  }

  .reply-in {
    font-weight: 400;
    color: var(--text-dim);
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

  /* ---------- send options ---------- */

  .send-as {
    display: grid;
    place-items: center;
    padding: 0;
    opacity: 1;
  }

  .effect-button {
    line-height: 1;
  }

  .effect-button.armed {
    opacity: 1;
    filter: drop-shadow(0 0 4px var(--accent));
  }

  .scheduled-button {
    position: relative;
    line-height: 1;
  }

  .scheduled-count {
    position: absolute;
    top: -2px;
    right: -4px;
    min-width: 14px;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 9px;
    line-height: 14px;
    text-align: center;
  }

  .send-button.silent {
    /* A muted send reads as a quieter button, the way the official clients
       swap the icon for the crossed-out bell. */
    background: color-mix(in srgb, var(--action) 55%, transparent);
  }

  .send-button:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .slowmode {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
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
  @media (max-width: 860px) {
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
    z-index: 130;
    max-width: min(520px, calc(100vw - 32px));
    margin: 0;
    padding: 10px 16px;
    border: none;
    border-radius: 10px;
    background: var(--danger);
    color: #fff;
    font: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
  }
</style>
