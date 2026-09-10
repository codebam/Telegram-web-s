/*
 * The chat: the chat list, the timeline, the composer, and every overlay the
 * app can open over them.
 *
 * Ported from svelte/src/lib/components/Chat.svelte — the largest file of the
 * Svelte client. What the conversion means here:
 *
 *  - every `$state` is a signal and every read/write of one gained `.value`.
 *    This component takes no props at all, so the dependency rule of
 *    CONVERSION.md §4 never forces a `useEffect` where a `useSignalEffect` would
 *    do: a signal is a stable object, and a callback that reads `x.value` sees
 *    the current value exactly like the rune it replaces did — which is what
 *    every `if (peerId === activePeerId)` guard in the async callbacks below
 *    relies on to drop a stale response;
 *  - everything Svelte kept in a plain `let` — `pinned`, `pinnedAnchor`,
 *    `dragDepth`, `suggestValues`, `sponsoredViewed`, `lastTypingSent`, the
 *    timers, the two observers, `readObserver` — is a ref: nothing renders from
 *    them, and a plain local in a Preact body is reset on every render;
 *  - `composer` stays a *signal* rather than a ref, because the element itself is
 *    passed down to FormatBar and the toolbar has to learn about it;
 *  - the three `use:` actions become refs, not hooks. `observeForRead` and
 *    `pressMenu` are built once per message row inside the list's `map`, where a
 *    hook would be unsafe — a component has to call the same hooks in the same
 *    order on every render and the row count is not stable — so they are *ref
 *    factories* returning a callback ref whose cleanup is the action's `destroy`.
 *    The two that share a bubble are composed by `mergeRefs`. `sponsoredSeen` has
 *    a single call site and stays an ordinary hook (`useSponsoredSeen`);
 *  - `await tick()` stays `await tick()`, now from `$lib/tick`: it flushes the
 *    render the state write just queued, which is what the scroll-position code
 *    below measures against.
 *
 * The tweb-behaviour comments are kept verbatim: they are the record of why the
 * scroll anchoring, the read receipts, the optimistic send and the draft saving
 * work the way they do.
 */
import {Fragment, type RefCallback} from 'preact';
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {tick} from '$lib/tick';

import {Avatar} from './Avatar';
import {Glyph} from './Glyph';
import {Logo} from './Logo';
import {ChatInfo} from './ChatInfo';
import {ChecklistBubble} from './ChecklistBubble';
import {Dice} from './Dice';
import {StoryBubble} from './StoryBubble';
import {ContactBubble} from './ContactBubble';
import {GameBubble} from './GameBubble';
import {GiftBubble} from './GiftBubble';
import {InvoiceBubble} from './InvoiceBubble';
import {LocationBubble} from './LocationBubble';
import {LocationSender} from './LocationSender';
import {PollComposer} from './PollComposer';
import {PollResults} from './PollResults';
import {FolderEditor} from './FolderEditor';
import {FormatBar} from './FormatBar';
import {FormattedText} from './FormattedText';
import {InlinePreview} from './InlinePreview';
import {BoostPanel} from './BoostPanel';
import {Lightbox} from './Lightbox';
import {AudioPlayerBar} from './AudioPlayerBar';
import {Media} from './Media';
import {MessagePayment} from './MessagePayment';
import {CallScreen} from './CallScreen';
import {MiniApp} from './MiniApp';
import {AccountSwitcher} from './AccountSwitcher';
import {ConnectionStatus} from './ConnectionStatus';
import {LinkSheet} from './LinkSheet';
import {NewChat} from './NewChat';
import {PeerPicker} from './PeerPicker';
import {ForwardSheet} from './ForwardSheet';
import {ForwardHeader} from './ForwardHeader';
import {ReplyHeader} from './ReplyHeader';
import {SendFiles} from './SendFiles';
import {sendFilesGrouped, type SendFileItem, type UploadHandle, type UploadProgress} from '$lib/telegram/upload';
import {Settings} from './Settings';
import {Stories} from './Stories';
import {Picker} from './Picker';
import {GlobalSearch} from './GlobalSearch';
import {EmojiStatus} from './EmojiStatus';
import {customEmojiEntities, type PendingCustomEmoji} from '$lib/telegram/emoji';
import {ReactionBar} from './ReactionBar';
import {ReactionPicker} from './ReactionPicker';
import {StarReactionSheet} from './StarReactionSheet';
import {RichMessage} from './RichMessage';
import {Sticker} from './Sticker';
import {VoiceRecorder} from './VoiceRecorder';
import {StickerSetSheet} from './StickerSetSheet';
import {StickerSuggest} from './StickerSuggest';
import {GifSaveAction} from './GifSaveAction';
import {CommentsButton} from './CommentsButton';
import {SavedTags} from './SavedTags';
import {TopicEditor} from './TopicEditor';
import {TopicIcon} from './TopicIcon';
import {BotBar} from './BotBar';
import {InlineKeyboard} from './InlineKeyboard';
import {ReplyKeyboard} from './ReplyKeyboard';
import {Suggestions} from './Suggestions';
import {parseStickerSetLink} from '$lib/telegram/stickers';
import {GIT_COMMIT, GIT_COMMIT_SHORT, GIT_COMMIT_URL} from '$lib/buildInfo';
import {
  sendQuickReaction,
  sendReaction as sendMessageReaction,
  type ReactionOption
} from '$lib/telegram/reactions';
import {
  parseTelegramLink,
  resolveLink,
  takeLaunchLink,
  type LinkAction,
  type TelegramLink
} from '$lib/telegram/links';
import {
  clickSponsored,
  canEditMessage,
  clearHistory,
  clearHistoryInfo,
  deleteMessage,
  deleteMessages,
  canPin,
  pinMessage,
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
  joinChat,
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
import {transcribeVoice, translateMessage} from '$lib/telegram/translation';
import {messageLink, type MessageLinkThread} from '$lib/telegram/messageLink';
import {startReport, submitReport, type ReportStep} from '$lib/telegram/profile';
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
import {
  acceptUrlAuth,
  clearBotHistory,
  filterBotCommands,
  getBotChatState,
  getReplyKeyboard,
  hostOf,
  loadBotCommands,
  needsUrlConfirmation,
  onReplyKeyboardChange,
  rememberHashtags,
  requestUrlAuth,
  searchHashtags,
  searchMentions,
  setBotBlocked,
  startBot,
  type BotChatState,
  type BotCommandItem,
  type ReplyKeyboardButton,
  type ReplyKeyboardState,
  type SuggestionItem
} from '$lib/telegram/botUi';
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
import {EffectOverlay} from './EffectOverlay';
import {EffectPicker} from './EffectPicker';
import {ScheduledMessages} from './ScheduledMessages';
import {SendAsPicker} from './SendAsPicker';
import {SendOptionsSheet} from './SendOptionsSheet';
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

import './Chat.css';

/**
 * Svelte allowed more than one `use:` action on the same element; JSX has a
 * single `ref`, so the two per-row action refs that share a bubble are composed
 * into one callback. A callback ref may return a cleanup function in this Preact
 * version, so the `destroy` halves of both actions are chained and run when the
 * element's ref is detached.
 */
function mergeRefs<T>(...refs: RefCallback<T>[]) {
  return (node: T) => {
    const cleanups = refs
    .map((ref) => ref(node))
    .filter((cleanup): cleanup is () => void => !!cleanup);

    if(cleanups.length) return () => cleanups.forEach((cleanup) => cleanup());
  };
}

/*
 * `{#key pendingFiles}` keyed the confirmation dialog on the *batch object*: the
 * dialog seeds its per-item choices once, so a second batch has to arrive as a
 * new component rather than a stale one. Preact keys have to be scalars, so each
 * batch array is handed a number the first time it is seen — the identity of the
 * array is still what the key tracks.
 */
const batchKeys = new WeakMap<File[], number>();
let lastBatchKey = 0;

function batchKey(files: File[]): number {
  let key = batchKeys.get(files);
  if(key === undefined) batchKeys.set(files, key = ++lastBatchKey);
  return key;
}

export function Chat() {
  /* ---------- chat list, topics, timeline ---------- */

  const dialogs = useSignal<DialogItem[]>([]);
  const topics = useSignal<TopicItem[]>([]);
  const messages = useSignal<MessageItem[]>([]);

  const activePeerId = useSignal<number | null>(null);
  const activeThreadId = useSignal<number | undefined>(undefined);
  const activeTitle = useSignal('');
  const activeIsForum = useSignal(false);
  /**
   * Whether a row in a topic chat has been opened. "All messages" has no
   * threadId, so the thread id alone cannot distinguish "showing the main
   * timeline" from "nothing picked yet".
   */
  const topicOpen = useSignal(false);
  /**
   * The synthetic "All messages" row above a forum's topics — thread id 0 means
   * the chat's own timeline, which `openTopic` maps back to no thread at all.
   */
  const allMessagesRow = useMemo<TopicItem>(() => ({
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
  }), []);
  /** Right-clicked topic row, keyed by thread id. */
  const topicMenuFor = useSignal<number | null>(null);
  /** Open topic editor: `{topic: null}` creates, `{topic}` edits. */
  const topicEditor = useSignal<{topic: TopicItem | null} | null>(null);
  const canManageForum = useSignal(false);
  /** Forum shown as one flat timeline instead of a topic list. */
  const forumAsMessages = useSignal(false);
  /**
   * What the open thread actually is. A thread id alone cannot tell a forum
   * topic from a comment thread from a saved sub-chat, and the header, the
   * back button and the composer all behave differently for each.
   */
  const threadKind = useSignal<'' | 'topic' | 'comments' | 'saved'>('');
  /** Comments already on the channel post whose thread is open. */
  const threadCommentCount = useSignal(0);
  /** Where a comment thread was entered from, for the back button. */
  const commentsOrigin = useSignal<{peerId: number; title: string} | null>(null);
  /** Saved Messages split per original sender instead of one timeline. */
  const savedAsChats = useSignal(false);
  const savedDialogs = useSignal<SavedDialogItem[]>([]);
  /** Tag currently filtering Saved Messages, '' for no filter. */
  const savedTag = useSignal('');
  /** Calls are one-to-one only, and never to Saved Messages. */
  const activeIsUser = useSignal(false);
  const activeIsSelf = useSignal(false);
  /**
   * Highest outgoing message the other side has read. In a group this is the
   * position up to which *everyone* has read, which is what the second tick
   * means there too.
   */
  const readOutboxMaxId = useSignal(0);
  const activeIsChannel = useSignal(false);
  /** Peer whose boost page is open, null when closed. */
  const boostPeerId = useSignal<number | null>(null);
  /** Names of the people who have read a message, fetched on demand. */
  const readByFor = useSignal<{mid: number; names: string[]} | null>(null);
  /** Open reaction picker, anchored where it was summoned from. */
  const reactionPickerFor = useSignal<{mid: number; x: number; y: number} | null>(null);
  /** Message whose paid (star) reaction sheet is open. */
  const starReactionFor = useSignal<number | null>(null);
  /**
   * Bumped per message whenever a reaction is sent from here, so that bubble's
   * bar re-reads its counters even when the server update lands later. Keyed by
   * mid so one reaction does not make every bubble re-read.
   */
  const reactionRevisions = useSignal<Record<number, number>>({});

  const loadingChats = useSignal(true);
  const loadingHistory = useSignal(false);
  const draft = useSignal('');
  const replyTo = useSignal<MessageItem | null>(null);
  /**
   * Everything about the pending reply that a `MessageItem` cannot carry: the
   * quoted excerpt and, for a reply into another chat, where the original
   * lives. Kept beside `replyTo` rather than inside it because the reply target
   * is cleared from a dozen places; `mid` is what ties the two together, so a
   * stale context is simply ignored instead of attaching to the wrong message.
   */
  const replyContext = useSignal<{
    mid: number;
    peerId: number;
    chatTitle: string;
    quote: ReplyQuote | null;
  } | null>(null);
  /** The message a "Reply in…" pick is about to carry into another chat. */
  const replyingElsewhere = useSignal<MessageItem | null>(null);
  /** Its quote, captured before the picker took the selection away. */
  const replyElsewhereQuote = useRef<ReplyQuote | null>(null);
  const error = useSignal('');
  const scroller = useRef<HTMLDivElement>(null);
  /** First unread message id, used for the divider and the open position. */
  const firstUnreadMid = useSignal<number | null>(null);
  const pinned = useRef(false);
  const pinnedAnchor = useRef<number | null>(null);
  const observer = useRef<ResizeObserver | undefined>(undefined);

  const query = useSignal('');
  /** True while the sidebar search pane replaces the chat list. */
  const searchOpen = useSignal(false);
  const loadingOlder = useSignal(false);
  const reachedStart = useSignal(false);
  // False while the loaded window is centred on an older message (a jump), when
  // the bottom of the list is not the bottom of the chat.
  const windowAtLatest = useSignal(true);
  const presence = useSignal('');
  const typingNames = useSignal<string[]>([]);
  const editing = useSignal<MessageItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  /*
   * A signal rather than a ref: the element itself is handed to FormatBar, which
   * only learns about it through a re-render. The setter is memoised because a
   * fresh ref callback on every render would detach and reattach the node each
   * pass, and each write to the signal would schedule another render.
   */
  const composer = useSignal<HTMLTextAreaElement | undefined>(undefined);
  const setComposer = useMemo(() => (node: HTMLTextAreaElement) => {
    composer.value = node;
  }, []);
  const searchBox = useRef<HTMLInputElement>(null);
  const dragging = useSignal(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const folders = useSignal<FolderItem[]>([]);
  const activeFolder = useSignal(0);
  const editingFolder = useSignal<FolderItem | null>(null);
  const allDialogs = useSignal<DialogItem[]>([]);
  const folderEditorOpen = useSignal(false);
  const newChatOpen = useSignal(false);
  const menuFor = useSignal<DialogItem | null>(null);

  /* ---------- archive, folder membership, presence, pinned order ---------- */

  /** True while the list shows folder 1 instead of the current folder. */
  const archiveOpen = useSignal(false);
  const archivedDialogs = useSignal<DialogItem[]>([]);
  const archiveSummary = useSignal<ArchiveSummary>({total: 0, unread: 0});
  const loadingArchive = useSignal(false);
  /** Peer ids currently online, for the dot on private rows. */
  const onlinePeerIds = useSignal<number[]>([]);
  /** peerId → names typing in that chat right now, for the row preview. */
  const typingByPeer = useSignal<Record<number, string[]>>({});
  /** Peer whose "Add to folder" submenu is open, if any. */
  const folderMenuFor = useSignal<number | null>(null);
  const folderMemberships = useSignal<FolderMembership[]>([]);
  const dragPeerId = useSignal<number | null>(null);
  const dragOverPeerId = useSignal<number | null>(null);

  const showInfo = useSignal(false);
  /** Profile being viewed from a message sender or member list, if any. */
  const profilePeerId = useSignal<number | null>(null);
  const showPicker = useSignal(false);
  /**
   * Custom emoji sitting in the draft as their plain alt text; on send they
   * become messageEntityCustomEmoji entities over those characters.
   */
  const pendingCustomEmoji = useSignal<PendingCustomEmoji[]>([]);
  /** Sticker-pack preview, opened from an addstickers link or "View pack". */
  const packSheet = useSignal<{setKey: string; docId: string} | null>(null);
  const lightboxIndex = useSignal<number | null>(null);
  const highlightedMid = useSignal<number | null>(null);
  const pinnedMessage = useSignal<MessageItem | null>(null);
  /**
   * Whether this chat's pin is ours to set (a private chat always, a group or
   * channel only with the `pin_messages` right). Loaded per peer rather than
   * asked at menu-open time, so the menu still renders in one pass.
   */
  const canPinHere = useSignal(false);
  /** True while a join is in flight, so the banner's button cannot be double-fired. */
  const joining = useSignal(false);
  /**
   * Translations and transcripts shown under a message, keyed by mid. Both are
   * fetched on demand from the message menu and live only as long as this chat
   * is open — the managers do their own caching.
   */
  const translations = useSignal<Map<number, string>>(new Map());
  const transcripts = useSignal<Map<number, string>>(new Map());
  const busyMids = useSignal<Set<number>>(new Set());
  /** A short-lived confirmation, for actions whose only result is a copy. */
  const notice = useSignal('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /**
   * What Clear History would mean for the chat whose menu is open — loaded when
   * that menu opens, because the permission is the server's to answer and the
   * dialog's own flags cannot express it.
   */
  const clearInfo = useSignal<{peerId: number; can: boolean; canRevokeForBoth: boolean} | null>(null);
  /**
   * The report flow for a message, when one is running. The steps and their
   * wording come from the server; this holds which message we are reporting and
   * the option the user picked, because every step has to send both back.
   */
  const reportState = useSignal<{peerId: number; mids: number[]; step: ReportStep} | null>(null);
  const reportComment = useSignal('');
  const reportOptionId = useSignal(0);
  const reportBusy = useSignal(false);
  /**
   * Whether the message whose menu is open can be edited — Telegram's own rules,
   * which the client-side `editable` flag cannot express (the 48-hour window, a
   * forwarded or bot-authored message, a sticker). Loaded when the menu opens.
   */
  const canEditHere = useSignal(false);
  /**
   * The channel's sponsored message. Telegram's API terms require third-party
   * clients to show these unmodified and to report views and clicks, so nothing
   * below filters or hides what the server returns.
   */
  const sponsored = useSignal<SponsoredItem | null>(null);
  const sponsoredViewed = useRef('');
  /**
   * Set while the open peer is restricted on this platform. Its history is not
   * loaded at all — the server's reason is shown in place of the timeline.
   */
  const activeRestriction = useSignal('');
  const businessBot = useSignal<BusinessBot | null>(null);
  const businessBotBusy = useSignal(false);
  /** Messages queued for the forward sheet, empty when it is closed. */
  const forwarding = useSignal<MessageItem[]>([]);
  const atBottom = useSignal(true);
  const chatQuery = useSignal('');
  const chatResults = useSignal<MessageItem[] | null>(null);
  const chatSearchOpen = useSignal(false);
  const chatSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Server-side total for the current in-chat search — the M in "N of M". */
  const chatResultCount = useSignal(0);
  const chatResultIndex = useSignal(-1);
  const chatResultsEnd = useSignal(true);
  const chatSearching = useSignal(false);
  /** Sender filter: groups and channels only, a DM has just two of them. */
  const chatFrom = useSignal<SearchPeerItem | null>(null);
  const chatFromOpen = useSignal(false);
  const chatFromQuery = useSignal('');
  const chatMembers = useSignal<SearchPeerItem[]>([]);
  const chatFilter = useSignal<MediaFilter>('all');
  const chatDate = useSignal('');
  const chatFiltersOpen = useSignal(false);
  const selecting = useSignal(false);
  const selected = useSignal<Set<number>>(new Set());
  const messageMenu = useSignal<{mid: number; x: number; y: number} | null>(null);
  const lastTypingSent = useRef(0);
  const showSidebarOnMobile = useSignal(true);
  const showSettings = useSignal(false);
  const showAccounts = useSignal(false);

  /*
   * The shell has one column for a side panel, so Settings and a profile cannot
   * both be open: a second one would wrap into a new grid row and tear the layout
   * apart. Settings closes the profile itself (see its button); this is the other
   * direction — a profile opened from anywhere at all (a sender's photo, a
   * mention, an inline button) closes Settings.
   */
  useSignalEffect(() => {
    if(profilePeerId.value !== null || showInfo.value) showSettings.value = false;
  });
  /** A join-chat / add-folder invite awaiting confirmation. */
  const linkSheet = useSignal<Extract<LinkAction, {type: 'joinChat'} | {type: 'addList'}> | null>(null);
  /** The mini app currently hosted in an iframe, null when none is open. */
  const miniApp = useSignal<MiniAppRequest | null>(null);
  const inlineResults = useSignal<InlineResultItem[]>([]);
  const inlineSwitch = useSignal<InlineQueryAnswer | null>(null);
  const inlineBot = useSignal('');
  const inlineTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The web-app button a bot pins next to the composer, if this chat is a bot. */
  const botMenuButton = useSignal<{text: string; url: string} | null>(null);
  /** Files queued by paste, drop or the attach button, pending confirmation. */
  const pendingFiles = useSignal<File[]>([]);
  /** The batch currently uploading, null when nothing is in flight. */
  const upload = useSignal<UploadHandle | null>(null);
  const uploadProgress = useSignal<UploadProgress[] | null>(null);
  /** Nesting depth of the drag currently over the pane — see onDragEnter. */
  const dragDepth = useRef(0);

  /* ---------- bot keyboards, commands and autocomplete ---------- */

  /** The keyboard the chat's bot last attached, null while it is unknown. */
  const replyKeyboard = useSignal<ReplyKeyboardState | null>(null);
  const replyKeyboardOpen = useSignal(false);
  /** The force-reply already honoured, so it does not re-arm on every update. */
  const forcedReplyMid = useRef(0);
  /** `row:column` of the callback button waiting on the bot. */
  const callbackBusyKey = useSignal('');
  /** A bot link the user has to approve before it opens. */
  const linkPrompt = useSignal<{text: string; confirm: string; onconfirm: () => void} | null>(null);
  const botState = useSignal<BotChatState | null>(null);
  const botBusy = useSignal(false);
  const botCommands = useRef<BotCommandItem[]>([]);
  /** Which trigger opened the suggestion strip, null when it is closed. */
  const suggestKind = useSignal<'command' | 'mention' | 'hashtag' | null>(null);
  const suggestItems = useSignal<SuggestionItem[]>([]);
  const suggestIndex = useSignal(0);
  /** Range in the draft the picked suggestion replaces. */
  const suggestFrom = useRef(0);
  const suggestTo = useRef(0);
  /** Guards a slow lookup against a newer keystroke. */
  const suggestToken = useRef(0);
  /** Text each suggestion drops into the draft, parallel to `suggestItems`. */
  const suggestValues = useRef<string[]>([]);

  /* ---------- attachments and send options ---------- */

  const attachMenu = useSignal(false);
  const locationSender = useSignal(false);
  const pollComposer = useSignal(false);
  /** Picking someone to share as a contact card, rather than to forward to. */
  const contactPicking = useSignal(false);
  const pollResults = useSignal<{mid: number; poll: PollPreview} | null>(null);

  const sendOptionsOpen = useSignal(false);
  const scheduledOpen = useSignal(false);
  const effectPickerOpen = useSignal(false);
  const sendAsPickerOpen = useSignal(false);

  /** Effect armed for the next message, '' for none. */
  const sendEffect = useSignal('');
  /** Emoticon of the armed effect, for the button label. */
  const sendEffectEmoticon = useSignal('');
  /** Per-chat "send without sound" preference. */
  const silentDefault = useSignal(false);
  /** Identity we post as here, null when posting as ourselves. */
  const sendAsPeerId = useSignal<number | null>(null);
  const slowMode = useSignal<SlowMode | null>(null);
  const scheduledCount = useSignal(0);
  /** Ticks once a second, but only while a slow-mode cooldown is running. */
  const nowSeconds = useSignal(Math.floor(Date.now() / 1000));
  /** Long-press timer on the send button, for touch devices. */
  const sendHoldTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Set when a long press opened the sheet, so the release does not also send. */
  const sendHeld = useRef(false);

  /* ---------- read tracking ---------- */

  const readObserver = useRef<IntersectionObserver | undefined>(undefined);
  const pendingReadMid = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* ---------- derived ---------- */

  /**
   * The sidebar shows a sub-list instead of the chat list: a forum's topics, or
   * Saved Messages split per sender. Both replace the search box and folders
   * with a back button to the chat list.
   */
  const topicListOpen = useComputed(() => activeIsForum.value && activePeerId.value !== null && !forumAsMessages.value);
  const savedListOpen = useComputed(() => activeIsSelf.value && activePeerId.value !== null && savedAsChats.value);
  const sublistOpen = useComputed(() => topicListOpen.value || savedListOpen.value);

  /** The rows on screen: the archive when it is open, the folder otherwise. */
  const listedDialogs = useComputed(() => archiveOpen.value ? archivedDialogs.value : dialogs.value);

  /** Batch progress as one number, for the bar on the pending bubble. */
  const uploadOverall = useComputed(() =>
    uploadProgress.value?.length ?
      uploadProgress.value.reduce((sum, item) => sum + item.progress, 0) / uploadProgress.value.length :
      null
  );

  /** Media messages in order — the lightbox pages through these. */
  const mediaMessages = useComputed(() =>
    messages.value.filter(
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
  const rendered = useComputed(() => {
    const groups: {key: string; items: MessageItem[]}[] = [];

    for (const message of messages.value) {
      const previous = groups[groups.length - 1];
      if (message.groupedId && previous?.items[0]?.groupedId === message.groupedId) {
        previous.items.push(message);
      } else {
        groups.push({key: `${message.mid}`, items: [message]});
      }
    }

    return groups;
  });

  /** Filters narrow the search on their own — an empty query is fine with one. */
  const chatSearchNarrowed = useComputed(() =>
    !!chatQuery.value.trim() || chatFilter.value !== 'all' || !!chatFrom.value
  );

  /** Sender picking only makes sense where there is more than one sender. */
  const canFilterBySender = useComputed(() => activePeerId.value !== null && activePeerId.value < 0);

  /** The reply context, but only while it still describes the reply target. */
  const activeReplyContext = useComputed(() =>
    replyTo.value && replyContext.value?.mid === replyTo.value.mid ? replyContext.value : null
  );

  const slowModeLeft = useComputed(() =>
    slowMode.value?.nextSendDate ? Math.max(0, slowMode.value.nextSendDate - nowSeconds.value) : 0
  );

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
    const index = messages.value.findIndex((m) => m.mid === item.mid);
    if(index === -1) messages.value = [...messages.value, item];
    else messages.value = messages.value.map((m, i) => (i === index ? item : m));
  }

  /* ---------- chat-list subscriptions ---------- */

  function bumpReaction(mid: number) {
    reactionRevisions.value = {...reactionRevisions.value, [mid]: (reactionRevisions.value[mid] ?? 0) + 1};
  }

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let disposed = false;

    (async () => {
      archiveSummary.value = await getArchiveSummary();

      const offDialogs = await onDialogsUpdate(async () => {
        archiveSummary.value = await getArchiveSummary();
        if(archiveOpen.value) archivedDialogs.value = await loadArchivedDialogs();
      });

      // The list shows "typing…" for any chat, not just the open one, so it
      // keeps its own subscription rather than widening the header's.
      const offTyping = await onTyping((peerId, _threadId, names) => {
        typingByPeer.value = {...typingByPeer.value, [peerId]: names};
      });

      const offUsers = await onUserUpdate(async (userId) => {
        const online = await isPeerOnline(userId);
        const has = onlinePeerIds.value.includes(userId);
        if(online && !has) onlinePeerIds.value = [...onlinePeerIds.value, userId];
        else if(!online && has) onlinePeerIds.value = onlinePeerIds.value.filter((id) => id !== userId);
      });

      const all = () => {
        offDialogs();
        offTyping();
        offUsers();
      };

      if(disposed) all();
      else unsubscribe = all;
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  // Presence for the rows on screen. Statuses are already cached with the peer,
  // so this costs a worker round-trip per row and nothing on the network.
  // Reads the `listedDialogs` derivation and nothing else, so it stays a
  // `useSignalEffect`.
  useSignalEffect(() => {
    const peerIds = listedDialogs.value.filter((d) => d.isUser && !d.isSelf).map((d) => d.peerId);
    let cancelled = false;

    (async () => {
      const states = await Promise.all(peerIds.map((peerId) => isPeerOnline(peerId)));
      if(!cancelled) onlinePeerIds.value = peerIds.filter((_, index) => states[index]);
    })();

    return () => {
      cancelled = true;
    };
  });

  function typingTextFor(peerId: number): string {
    const names = typingByPeer.value[peerId] ?? [];
    if(!names.length) return '';
    return `${names.join(', ')} ${names.length > 1 ? 'are' : 'is'} typing…`;
  }

  async function openArchive() {
    archiveOpen.value = true;
    menuFor.value = null;
    folderMenuFor.value = null;
    loadingArchive.value = true;
    try {
      archivedDialogs.value = await loadArchivedDialogs();
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to load the archive');
    } finally {
      loadingArchive.value = false;
    }
  }

  function closeArchive() {
    archiveOpen.value = false;
    menuFor.value = null;
    folderMenuFor.value = null;
  }

  async function openFolderMenu(dialog: DialogItem) {
    if(folderMenuFor.value === dialog.peerId) {
      folderMenuFor.value = null;
      return;
    }

    folderMenuFor.value = dialog.peerId;
    folderMemberships.value = await loadFolderMemberships(dialog.peerId);
  }

  /* ---------- drag-to-reorder pinned chats ---------- */

  function onRowDragStart(event: DragEvent, dialog: DialogItem) {
    if(!dialog.pinned) return;
    dragPeerId.value = dialog.peerId;
    event.dataTransfer?.setData('text/plain', String(dialog.peerId));
    if(event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onRowDragOver(event: DragEvent, dialog: DialogItem) {
    if(dragPeerId.value === null || !dialog.pinned) return;
    // Only a prevented dragover marks the row as a valid drop target.
    event.preventDefault();
    dragOverPeerId.value = dialog.peerId;
  }

  function onRowDragEnd() {
    dragPeerId.value = null;
    dragOverPeerId.value = null;
  }

  async function onRowDrop(event: DragEvent, dialog: DialogItem) {
    const from = dragPeerId.value;
    dragPeerId.value = null;
    dragOverPeerId.value = null;
    if(from === null || !dialog.pinned || from === dialog.peerId) return;
    event.preventDefault();

    const list = listedDialogs.value;
    const order = list.filter((d) => d.pinned).map((d) => d.peerId);
    const fromIndex = order.indexOf(from);
    const toIndex = order.indexOf(dialog.peerId);
    if(fromIndex === -1 || toIndex === -1) return;
    order.splice(toIndex, 0, ...order.splice(fromIndex, 1));

    // Show the new order straight away; the server confirms it right after.
    const byPeerId = new Map(list.map((d) => [d.peerId, d]));
    const reordered = [
      ...order.map((peerId) => byPeerId.get(peerId)!),
      ...list.filter((d) => !d.pinned)
    ];
    if(archiveOpen.value) archivedDialogs.value = reordered;
    else dialogs.value = reordered;

    try {
      await reorderPinnedDialogs(order, archiveOpen.value ? FOLDER_ID_ARCHIVE : activeFolder.value);
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to reorder pinned chats');
      if(archiveOpen.value) archivedDialogs.value = await loadArchivedDialogs();
      else dialogs.value = await loadDialogs(40, activeFolder.value);
    }
  }

  /* ---------- read tracking ---------- */

  /*
   * One set of refs per row, looked up rather than rebuilt. A fresh closure on
   * every render would make Preact detach and re-attach the row's ref each pass
   * — and Chat re-renders whenever any signal it reads changes, the once-a-second
   * timestamp ticker included — which runs the press timer's cleanup and would
   * make the touch long-press menu (the only way to open it on a phone) rarely
   * appear. `mid` is what identifies a row, and it is what the action's
   * `update(next)` used to write; the cache is dropped with the timeline in
   * `openHistory`.
   */
  const rowRefs = useMemo(
    () => new Map<number, {read: RefCallback<HTMLDivElement>; bubble: RefCallback<HTMLDivElement>}>(),
    []
  );

  /** The refs a message row needs: the read action, and the read+menu pair. */
  function rowRefsFor(mid: number) {
    let refs = rowRefs.get(mid);
    if(!refs) {
      const read = observeForReadRef(mid);
      // A restricted bubble took the read action only; every other bubble took
      // both, which is the pair JSX has to express as one `ref`.
      refs = {read, bubble: mergeRefs(read, pressMenuRef(mid))};
      rowRefs.set(mid, refs);
    }
    return refs;
  }

  /**
   * Mark read from what is actually on screen. Opening a chat must not mark
   * hundreds of unseen messages read, so the highest *visible* incoming mid is
   * debounced into readHistory instead of calling readAllHistory on open.
   *
   * This is the `observeForRead` action as a *ref factory*, not a hook: the
   * message list builds one of these per row inside its `map`, and a component
   * has to call the same hooks in the same order on every render — a row count
   * that grows when older history is prepended would leave per-row hook state
   * attached to the wrong row. A Svelte action was a per-element lifecycle
   * anyway: the factory body is its `mounted` logic and the function it returns
   * is its `destroy`, which Preact runs when the ref detaches.
   *
   * Called once per `mid` — `rowRefsFor` is what memoises it.
   */
  function observeForReadRef(mid: number) {
    return (node: HTMLDivElement | null) => {
      if(!node) return;

      node.dataset.readMid = String(mid);
      // Created lazily: message elements mount before the scroller's `ref` is
      // assigned, so an observer built in openHistory would miss every node.
      ensureReadObserver().observe(node);

      return () => {
        readObserver.current?.unobserve(node);
      };
    };
  }

  function ensureReadObserver(): IntersectionObserver {
    // root: null (the viewport) rather than the scroller — the scroller fills
    // the viewport, and it avoids depending on ref timing.
    return (readObserver.current ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if(!entry.isIntersecting) continue;
          const mid = Number((entry.target as HTMLElement).dataset.readMid ?? 0);
          if(mid > pendingReadMid.current) pendingReadMid.current = mid;
        }
        flushRead();
      },
      {threshold: 0.5}
    ));
  }

  function flushRead() {
    clearTimeout(readTimer.current);
    readTimer.current = setTimeout(async () => {
      if(!pendingReadMid.current || activePeerId.value === null) return;
      const mid = pendingReadMid.current;
      pendingReadMid.current = 0;
      try {
        await readUpTo(activePeerId.value, mid, activeThreadId.value);
        // dialogs_multiupdate does not always fire for our own read, so refresh
        // the list explicitly to clear the badge.
        dialogs.value = await loadDialogs(40, activeFolder.value);
      } catch (err) {
        // Read receipts are best-effort; a failure must not break the view.
      }
    }, 400);
  }

  /**
   * The `pressMenu(node, mid)` action: the message menu — reactions included — is
   * reached by right-clicking or long-pressing a bubble, the way the official
   * clients do it. Touch browsers fire `contextmenu` on a long press only
   * patchily, so the touch path is driven here, cancelled as soon as the finger
   * moves so a scroll never pops a menu, and the click that follows the press is
   * swallowed so the bubble's own tap handler does not fire behind it.
   *
   * A ref factory for the same reason as `observeForReadRef`: it is built once
   * per row inside the list's `map`, where a hook would be unsafe. The `mid` the
   * action's `update(next)` used to write is captured by the factory, and the
   * `destroy` half is the cleanup Preact runs when the ref detaches.
   *
   * Its per-node state (`timer`, `startX`, `startY`) is why the closure has to
   * survive re-renders: `rowRefsFor` caches it, or a re-render would cancel a
   * long press in progress.
   */
  function pressMenuRef(mid: number) {
    return (node: HTMLDivElement | null) => {
      if(!node) return;

      const currentMid = mid;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let startX = 0;
      let startY = 0;

      const swallowClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        node.removeEventListener('click', swallowClick, true);
      };

      const cancel = () => {
        if(timer) clearTimeout(timer);
        timer = null;
      };

      const oncontextmenu = (event: MouseEvent) => {
        event.preventDefault();
        messageMenu.value = {mid: currentMid, x: event.clientX, y: event.clientY};
        refreshEditable(currentMid);
      };

      const ontouchstart = (event: TouchEvent) => {
        const touch = event.touches[0];
        if(!touch) return;
        node.removeEventListener('click', swallowClick, true);
        startX = touch.clientX;
        startY = touch.clientY;
        cancel();
        timer = setTimeout(() => {
          timer = null;
          node.addEventListener('click', swallowClick, true);
          messageMenu.value = {mid: currentMid, x: startX, y: startY};
          refreshEditable(currentMid);
        }, 450);
      };

      const ontouchmove = (event: TouchEvent) => {
        const touch = event.touches[0];
        if(!touch) return;
        if(Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) cancel();
      };

      node.addEventListener('contextmenu', oncontextmenu);
      node.addEventListener('touchstart', ontouchstart, {passive: true});
      node.addEventListener('touchmove', ontouchmove, {passive: true});
      node.addEventListener('touchend', cancel);
      node.addEventListener('touchcancel', cancel);

      return () => {
        cancel();
        node.removeEventListener('contextmenu', oncontextmenu);
        node.removeEventListener('touchstart', ontouchstart);
        node.removeEventListener('touchmove', ontouchmove);
        node.removeEventListener('touchend', cancel);
        node.removeEventListener('touchcancel', cancel);
        node.removeEventListener('click', swallowClick, true);
      };
    };
  }

  // An async callback cannot return a cleanup function, so hold the unsubscribe
  // in a local.
  useEffect(() => {
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
        [dialogs.value, folders.value] = await Promise.all([loadDialogs(), loadFolders()]);
      } catch (err: any) {
        error.value = errorOf(err, 'Failed to load chats');
      } finally {
        loadingChats.value = false;
      }

      // A shared t.me link opened the app: `static/_redirects` serves the SPA
      // for every path, so the link is sitting in `location`. Handle it after
      // the dialog list is up so the chat it opens has somewhere to land.
      const launchLink = takeLaunchLink();
      if(launchLink) handleTelegramLink(launchLink);

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
          peerId === activePeerId.value &&
          (activeThreadId.value === undefined || threadId === activeThreadId.value);

        if(isActive && !messages.value.some((m) => m.mid === mid)) {
          const item = await getMessage(peerId, mid);
          if(item) {
            const wasAtBottom = isScrolledToBottom();
            upsertMessage(item);
            if(wasAtBottom) await scrollToBottom();
          }
        }

        // Desktop notification for anything not already on screen.
        if(!isActive) {
          const item = await getMessage(peerId, mid);
          const dialog = dialogs.value.find((d) => d.peerId === peerId);
          // Ask the notification settings rather than the loaded dialog list:
          // a peer outside the current folder — or one muted only by the
          // per-type default — has no entry there and used to notify anyway.
          const muted = item && !item.out ? await isPeerMuted(peerId, threadId) : true;
          if(item && !item.out && !muted) {
            notifyMessage({
              title: dialog?.title ?? item.fromTitle,
              body: item.text || 'Media',
              peerId,
              onclick: () => {
                const target = dialogs.value.find((d) => d.peerId === peerId);
                if(target) openChat(target);
              }
            });
          }
        }

        dialogs.value = await loadDialogs(40, activeFolder.value);
      });

      // Unread counts change from other devices too — keep the list honest.
      const offDialogs = await onDialogsUpdate(async () => {
        dialogs.value = await loadDialogs(40, activeFolder.value);
        folders.value = await loadFolders();
      });

      // Folders can be created or edited from another client.
      const offFolders = await onFoldersUpdate(async () => {
        folders.value = await loadFolders();
        if(!folders.value.some((f) => f.id === activeFolder.value)) activeFolder.value = 0;
      });

      // A sent message first appears under a temporary id, then the server
      // confirms it under a real one. Drop the temporary copy first and
      // unconditionally — bailing out when the confirmed message is not
      // readable yet leaves the optimistic copy on screen, stuck on "Sending".
      const offSent = await onMessageSent(async (peerId, tempId, mid) => {
        if(peerId !== activePeerId.value) return;

        messages.value = messages.value.filter((m) => m.mid !== tempId);

        const confirmed = await getMessage(peerId, mid);
        if(confirmed) upsertMessage(confirmed);
      });

      // Streaming bots edit their reply as it is generated.
      const offEdited = await onMessageEdited(async (peerId, mid) => {
        if(peerId !== activePeerId.value) return;
        if(!messages.value.some((m) => m.mid === mid)) return;
        const updated = await getMessage(peerId, mid);
        if(updated) upsertMessage(updated);
      });

      const offDeleted = await onMessagesDeleted((peerId, mids) => {
        if(peerId === activePeerId.value) {
          messages.value = messages.value.filter((m) => !mids.includes(m.mid));
        }
        loadDialogs(40, activeFolder.value).then((list) => (dialogs.value = list)).catch(() => {});
      });

      const offRead = await onReadStateChange(async () => {
        if(activePeerId.value !== null) readOutboxMaxId.value = await getReadOutboxMaxId(activePeerId.value);
      });

      const offUsers = await onUserUpdate(async (userId) => {
        if(userId === activePeerId.value) {
          presence.value = (await getPresence(userId)).text;
        }
      });

      const offTyping = await onTyping((peerId, threadId, names) => {
        if(peerId === activePeerId.value && (activeThreadId.value === undefined || threadId === activeThreadId.value)) {
          typingNames.value = names;
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

      if(disposed) all();
      else unsubscribe = all;
    })();

    return () => {
      disposed = true;
      unsubscribe?.();
      stopPresence();
      observer.current?.disconnect();
      readObserver.current?.disconnect();
    };
  }, []);

  /* ---------- folders and chat-list actions ---------- */

  async function openFolder(folder: FolderItem) {
    activeFolder.value = folder.id;
    query.value = '';
    loadingChats.value = true;
    try {
      dialogs.value = await loadDialogs(40, folder.id);
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to load folder');
    } finally {
      loadingChats.value = false;
    }
  }

  async function openFolderEditor(folder: FolderItem | null) {
    editingFolder.value = folder;
    // The editor picks from every chat, not just the folder currently shown.
    allDialogs.value = await loadDialogs(100, 0);
    folderEditorOpen.value = true;
  }

  async function openNewChat() {
    // Members are picked from every chat, not just the folder currently shown.
    allDialogs.value = await loadDialogs(100, 0);
    newChatOpen.value = true;
  }

  async function onChatCreated(peerId: number) {
    newChatOpen.value = false;
    query.value = '';
    activeFolder.value = 0;

    try {
      dialogs.value = await loadDialogs(40, 0);
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to reload chats');
    }

    // The dialog may not have landed in the list yet; openPeerChat works off
    // the peer itself, so it opens either way.
    await openPeerChat(peerId);
  }

  async function onFolderSaved() {
    folderEditorOpen.value = false;
    editingFolder.value = null;
    folders.value = await loadFolders();
    if(!folders.value.some((f) => f.id === activeFolder.value)) {
      await openFolder(folders.value[0]);
    }
  }

  async function runDialogAction(action: () => Promise<void>) {
    menuFor.value = null;
    folderMenuFor.value = null;
    try {
      await action();
      dialogs.value = await loadDialogs(40, activeFolder.value);
      archiveSummary.value = await getArchiveSummary();
      if(archiveOpen.value) archivedDialogs.value = await loadArchivedDialogs();
    } catch (err: any) {
      error.value = errorOf(err, 'Action failed');
    }
  }

  /* ---------- stickers, GIFs, reactions ---------- */

  async function pickDocument(docId: string) {
    if(activePeerId.value === null) return;
    showPicker.value = false;
    const replyToMsgId = replyTo.value?.mid;
    replyTo.value = null;

    try {
      await sendDocument(activePeerId.value, docId, {threadId: activeThreadId.value, replyToMsgId});
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to send');
    }
  }

  /** Opens the picker where the context menu was, and closes that menu. */
  function openReactionPicker(mid: number, x: number, y: number) {
    messageMenu.value = null;
    reactionPickerFor.value = {mid, x, y};
  }

  async function pickReaction(option: ReactionOption) {
    const picker = reactionPickerFor.value;
    reactionPickerFor.value = null;
    if(!picker || activePeerId.value === null) return;

    try {
      await sendMessageReaction(activePeerId.value, picker.mid, option);
      bumpReaction(picker.mid);
    } catch (err: any) {
      error.value = errorOf(err, 'Reaction failed');
    }
  }

  /** Double-click a bubble to send the configured quick reaction. */
  async function quickReact(message: MessageItem) {
    if(activePeerId.value === null || message.service || selecting.value) return;

    try {
      await sendQuickReaction(activePeerId.value, message.mid);
      bumpReaction(message.mid);
    } catch (err: any) {
      error.value = errorOf(err, 'Reaction failed');
    }
  }

  /** True when the previous rendered group came from the same sender. */
  function sameSenderAsPrevious(group: {key: string; items: MessageItem[]}): boolean {
    const index = rendered.value.indexOf(group);
    const previous = rendered.value[index - 1]?.items[0];
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
      if(document.hidden) goOffline();
      else goOnline();
    };

    goOnline();
    timer = setInterval(() => {
      if(!document.hidden) goOnline();
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

  function chatSearchOptions(offsetId = 0) {
    return {
      threadId: activeThreadId.value,
      fromPeerId: chatFrom.value?.peerId,
      filter: chatFilter.value,
      offsetId
    };
  }

  async function runChatSearch() {
    if(activePeerId.value === null || !chatSearchNarrowed.value) {
      chatResults.value = null;
      chatResultCount.value = 0;
      chatResultIndex.value = -1;
      chatResultsEnd.value = true;
      return;
    }

    const peerId = activePeerId.value;
    chatSearching.value = true;
    try {
      const page = await searchChatMessages(peerId, chatQuery.value, chatSearchOptions());
      if(activePeerId.value !== peerId) return;
      chatResults.value = page.items.map((item) => item.message);
      chatResultCount.value = page.count;
      chatResultIndex.value = page.items.length ? 0 : -1;
      chatResultsEnd.value = page.isEnd;
    } catch (err: any) {
      error.value = errorOf(err, 'Search failed');
    } finally {
      chatSearching.value = false;
    }
  }

  function onChatQueryInput() {
    clearTimeout(chatSearchTimer.current);
    chatSearchTimer.current = setTimeout(runChatSearch, 300);
  }

  /** A filter change is a deliberate click, so it searches without the debounce. */
  function applyChatFilter(filter: MediaFilter) {
    chatFilter.value = filter;
    clearTimeout(chatSearchTimer.current);
    runChatSearch();
  }

  async function openFromPicker() {
    chatFromOpen.value = !chatFromOpen.value;
    if(chatFromOpen.value && activePeerId.value !== null) {
      chatMembers.value = await searchChatMembers(activePeerId.value, chatFromQuery.value);
    }
  }

  async function onFromQueryInput() {
    if(activePeerId.value === null) return;
    chatMembers.value = await searchChatMembers(activePeerId.value, chatFromQuery.value);
  }

  function pickFrom(member: SearchPeerItem | null) {
    chatFrom.value = member;
    chatFromOpen.value = false;
    chatFromQuery.value = '';
    clearTimeout(chatSearchTimer.current);
    runChatSearch();
  }

  /** Older results, pulled in when the user pages past the loaded ones. */
  async function loadMoreChatResults() {
    if(activePeerId.value === null || chatResultsEnd.value || chatSearching.value || !chatResults.value?.length) return;

    const peerId = activePeerId.value;
    chatSearching.value = true;
    try {
      const page = await searchChatMessages(
        peerId,
        chatQuery.value,
        chatSearchOptions(chatResults.value[chatResults.value.length - 1].mid)
      );
      if(activePeerId.value !== peerId) return;

      const known = new Set(chatResults.value.map((m) => m.mid));
      const fresh = page.items.map((item) => item.message).filter((m) => !known.has(m.mid));
      chatResults.value = [...chatResults.value, ...fresh];
      chatResultsEnd.value = page.isEnd || !fresh.length;
    } catch (err: any) {
      error.value = errorOf(err, 'Search failed');
    } finally {
      chatSearching.value = false;
    }
  }

  /** Step through results newest-first; `step` of 1 goes towards older ones. */
  async function stepResult(step: number) {
    if(!chatResults.value?.length) return;

    const next = chatResultIndex.value + step;
    if(next < 0) return;

    if(next >= chatResults.value.length) {
      await loadMoreChatResults();
      if(next >= (chatResults.value?.length ?? 0)) return;
    }

    chatResultIndex.value = next;
    jumpTo(chatResults.value[next].mid);
  }

  function selectResult(index: number) {
    chatResultIndex.value = index;
    if(chatResults.value?.[index]) jumpTo(chatResults.value[index].mid);
  }

  /** Jump the timeline to the first message on the picked day. */
  async function jumpToDate(value: string) {
    chatDate.value = value;
    if(!value || activePeerId.value === null) return;

    // The day's last second: the server answers with the newest message at or
    // before the offset, which is the bottom of that day.
    const end = new Date(`${value}T23:59:59`);
    const mid = await findMessageIdByDate(activePeerId.value, Math.floor(end.getTime() / 1000), activeThreadId.value);
    if(mid) jumpTo(mid);
    else error.value = 'No messages on that day';
  }

  function closeChatSearch() {
    chatSearchOpen.value = false;
    chatQuery.value = '';
    chatResults.value = null;
    chatResultCount.value = 0;
    chatResultIndex.value = -1;
    chatResultsEnd.value = true;
    chatFrom.value = null;
    chatFromOpen.value = false;
    chatFromQuery.value = '';
    chatFilter.value = 'all';
    chatDate.value = '';
    chatFiltersOpen.value = false;
  }

  /* ---------- selection ---------- */

  function toggleSelected(mid: number) {
    const next = new Set(selected.value);
    if(next.has(mid)) next.delete(mid);
    else next.add(mid);
    selected.value = next;
    if(!next.size) selecting.value = false;
  }

  function startSelecting(mid: number) {
    selecting.value = true;
    selected.value = new Set([mid]);
    messageMenu.value = null;
  }

  async function deleteSelected() {
    if(activePeerId.value === null || !selected.value.size) return;
    const mids = [...selected.value];
    selecting.value = false;
    selected.value = new Set();

    try {
      await deleteMessages(activePeerId.value, mids);
      messages.value = messages.value.filter((m) => !mids.includes(m.mid));
    } catch (err: any) {
      error.value = errorOf(err, 'Delete failed');
    }
  }

  async function forwardSelected() {
    if(!selected.value.size) return;
    // Oldest first, so the batch lands in the target chat in the order it was
    // written rather than the order it happened to be clicked in.
    forwarding.value = messages.value.filter((m) => selected.value.has(m.mid)).sort((a, b) => a.mid - b.mid);
    allDialogs.value = await loadDialogs(100, 0);
  }

  /* ---------- polls and discussions ---------- */

  async function vote(message: MessageItem, index: number) {
    if(activePeerId.value === null || message.poll?.closed) return;
    try {
      await votePoll(activePeerId.value, message.mid, [index]);
      const updated = await getMessage(activePeerId.value, message.mid);
      if(updated) messages.value = messages.value.map((m) => (m.mid === message.mid ? updated : m));
    } catch (err: any) {
      error.value = errorOf(err, 'Vote failed');
    }
  }

  /**
   * A channel post's comments live in the linked discussion group, so opening
   * them swaps the peer as well as the thread. The channel is remembered so the
   * back button returns to the post instead of the chat list.
   */
  async function openComments(message: MessageItem) {
    if(activePeerId.value === null) return;
    try {
      const thread = await openCommentThread(activePeerId.value, message.mid);
      if(!thread) {
        error.value = 'No discussion for this post';
        return;
      }

      commentsOrigin.value = {peerId: activePeerId.value, title: activeTitle.value};
      activePeerId.value = thread.peerId;
      activeThreadId.value = thread.threadId;
      activeTitle.value = 'Comments';
      threadKind.value = 'comments';
      threadCommentCount.value = thread.count || message.repliesCount;
      activeIsForum.value = false;
      // The discussion group is a megagroup: ticks, not view counts, and the
      // composer must be live so a comment can actually be posted.
      activeIsChannel.value = false;
      activeIsUser.value = false;
      activeIsSelf.value = false;
      activeRestriction.value = '';
      topicOpen.value = true;
      replyTo.value = null;
      await openHistory(thread.peerId, thread.threadId, thread.count, thread.readMaxId);
    } catch (err: any) {
      error.value = errorOf(err, 'Could not open comments');
    }
  }

  /** Back out of a comment thread to the channel post it belongs to. */
  async function leaveCommentThread() {
    const origin = commentsOrigin.value;
    commentsOrigin.value = null;
    threadKind.value = '';
    threadCommentCount.value = 0;
    activeThreadId.value = undefined;
    if(!origin) {
      activePeerId.value = null;
      return;
    }

    const dialog = dialogs.value.find((d) => d.peerId === origin.peerId);
    if(dialog) {
      await openChat(dialog);
      return;
    }

    activePeerId.value = origin.peerId;
    activeTitle.value = origin.title;
    await openHistory(origin.peerId);
  }

  /* ---------- jumping to a message ---------- */

  /**
   * Scroll to `mid`, loading the surrounding history first when it is not in
   * the currently loaded window (a reply can point far above what is loaded).
   */
  async function jumpTo(mid: number) {
    if(activePeerId.value === null) return;

    if(!messages.value.some((m) => m.mid === mid)) {
      loadingHistory.value = true;
      try {
        messages.value = await loadAround(activePeerId.value, mid, {threadId: activeThreadId.value});
        reachedStart.value = false;
        windowAtLatest.value = false;
      } catch (err: any) {
        error.value = errorOf(err, 'Could not load that message');
        return;
      } finally {
        loadingHistory.value = false;
      }
      await tick();
    }

    releasePin();
    const node = scroller.current?.querySelector<HTMLElement>(`[data-mid="${mid}"]`);
    if(!node) return;

    node.scrollIntoView({block: 'center', behavior: 'smooth'});
    highlightedMid.value = mid;
    setTimeout(() => {
      if(highlightedMid.value === mid) highlightedMid.value = null;
    }, 1600);
  }

  /**
   * Jump from a reply header to the message it answers. A cross-chat reply
   * points into another conversation, so that one is opened first.
   */
  async function jumpToReply(reply: NonNullable<MessageItem['reply']>) {
    if(reply.deleted) return;

    if(reply.peerId !== activePeerId.value) {
      await openPeerChat(reply.peerId);
    }

    await jumpTo(reply.mid);
  }

  /* ---------- forward and copy ---------- */

  async function openForward(message: MessageItem) {
    forwarding.value = [message];
    allDialogs.value = await loadDialogs(100, 0);
  }

  async function doForward(targets: number[], options: ForwardOptions) {
    const mids = forwarding.value.map((m) => m.mid);
    const fromPeerId = activePeerId.value;
    forwarding.value = [];
    selecting.value = false;
    selected.value = new Set();
    if(!mids.length || !targets.length || fromPeerId === null) return;

    try {
      await forwardTo(fromPeerId, mids, targets, options);
    } catch (err: any) {
      error.value = errorOf(err, 'Forward failed');
    }
  }

  async function copyText(message: MessageItem) {
    try {
      await navigator.clipboard.writeText(message.text);
    } catch (err) {
      error.value = 'Clipboard unavailable';
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

    if(date.toDateString() === today.toDateString()) return 'Today';
    if(date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], {day: 'numeric', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric'});
  }

  /** True when this group starts a new calendar day. */
  function startsNewDay(index: number): boolean {
    if(index === 0) return true;
    const previous = rendered.value[index - 1]?.items[0];
    const current = rendered.value[index]?.items[0];
    return !!previous && !!current && dayOf(previous.date) !== dayOf(current.date);
  }

  /**
   * Open the profile behind an @mention. A username has to be resolved through
   * the server; a mentionName entity already carries the user id.
   */
  async function openMention(mention: string, kind: 'username' | 'userId') {
    if(kind === 'userId') {
      profilePeerId.value = Number(mention);
      return;
    }

    const peerId = await resolveUsername(mention);
    if(peerId === null) {
      error.value = `No account found for @${mention}`;
      return;
    }
    profilePeerId.value = peerId;
  }

  /**
   * A hashtag, a cashtag or a bot command tapped inside a message. Telegram
   * searches the current chat for a tag — a command is sent instead — and a
   * chat-specific `#tag@channel` switches to that chat first. The tag itself is
   * already the text of the run, which is what the search wants.
   */
  async function openTag(text: string, kind: 'hashtag' | 'cashtag' | 'botCommand') {
    if(kind === 'botCommand') {
      const peerId = activePeerId.value;
      if(peerId === null) return;

      try {
        await sendMessage(peerId, text.startsWith('/') ? text : `/${text}`, {
          threadId: activeThreadId.value ?? undefined
        });
        scrollToBottom();
      } catch (err: any) {
        error.value = errorOf(err, 'Could not send the command');
      }
      return;
    }

    // `#news@channel` and `$TON@channel` belong to another chat: open it, then
    // search there. Any failure falls through to searching the chat we are in.
    const at = text.lastIndexOf('@');
    const query = at > 0 ? text.slice(0, at) : text;
    const username = at > 0 ? text.slice(at + 1) : '';

    if(username) {
      try {
        const peerId = await resolveUsername(username);
        if(peerId !== null) await openChat(await dialogTargetFor(peerId));
      } catch (err) {
        // Not a chat we can open — keep the search local.
      }
    }

    closeChatSearch();
    chatQuery.value = query;
    chatSearchOpen.value = true;
    await runChatSearch();
  }

  /** The date under a formatted-date run, copied like any other text. */
  function copyDate(unix: number) {
    const text = new Date(unix * 1000).toLocaleString();
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  async function refreshEditable(mid: number) {
    canEditHere.value = false;

    const peerId = activePeerId.value;
    if(peerId === null) return;

    try {
      const allowed = await canEditMessage(peerId, mid);
      if(messageMenu.value?.mid === mid) canEditHere.value = allowed;
    } catch (err) {
      // No Edit entry rather than one that fails.
    }
  }

  function flash(text: string) {
    clearTimeout(noticeTimer.current);
    notice.value = text;
    noticeTimer.current = setTimeout(() => (notice.value = ''), 4000);
  }

  async function refreshClearInfo(peerId: number) {
    try {
      const info = await clearHistoryInfo(peerId);
      if(menuFor.value?.peerId === peerId) {
        clearInfo.value = {peerId, can: info.can, canRevokeForBoth: info.canRevokeForBoth};
      }
    } catch (err) {
      // No entry rather than a wrong one.
    }
  }

  /**
   * Clear History asks first, and the two halves of Telegram's checkbox are two
   * entries here: "just for me" is always on offer, "for everyone" only when the
   * server's rules allow it. The prompt reuses the bot-request overlay — it is a
   * message, a cancel and a confirm, which is all this needs.
   */
  function askClearHistory(dialog: DialogItem, revoke: boolean) {
    const title = dialog.title;
    const description = dialog.isSelf ?
      'Are you sure you want to clear Saved Messages?' :
      dialog.isBroadcast ?
        `Are you sure you want to clear the channel history in ${title}?` :
        dialog.isUser ?
          `Are you sure you want to clear your chat history with ${title}?` :
          'Are you sure you want to delete all messages in this chat?';

    menuFor.value = null;
    linkPrompt.value = {
      text: description,
      confirm: revoke ? 'Clear for everyone' : 'Clear history',
      onconfirm: () => clearChatHistory(dialog.peerId, revoke)
    };
  }

  /**
   * Reporting one message. Upstream offers it on a channel's or supergroup's
   * messages and not in a private chat, and the reason list is the server's —
   * the options, their order and their wording all come back from the first
   * call, so nothing is hardcoded here. Every step sends the same message ids
   * back: the server's state machine is keyed to the peer and the id list.
   */
  function canReportMessage(message: MessageItem) {
    if(message.service) return false;
    const dialog = dialogs.value.find((d) => d.peerId === activePeerId.value);
    return !!dialog && (dialog.isMegagroup || dialog.isBroadcast);
  }

  async function startMessageReport(message: MessageItem) {
    const peerId = activePeerId.value;
    if(peerId === null) return;

    reportBusy.value = true;
    try {
      const step = await startReport(peerId, [message.mid]);
      reportOptionId.value = 0;
      reportComment.value = '';

      if(step.kind === 'done') {
        finishReport(step);
        return;
      }

      reportState.value = {peerId, mids: [message.mid], step};
    } catch (err: any) {
      error.value = errorOf(err, 'Could not start the report');
    } finally {
      reportBusy.value = false;
    }
  }

  async function chooseReportOption(optionId: number) {
    const state = reportState.value;
    if(!state) return;

    reportBusy.value = true;
    reportOptionId.value = optionId;
    try {
      const step = await submitReport(state.peerId, optionId, '', state.mids);
      if(step.kind === 'done') {
        finishReport(step);
        return;
      }

      reportState.value = {...state, step};
    } catch (err: any) {
      error.value = errorOf(err, 'Could not send the report');
    } finally {
      reportBusy.value = false;
    }
  }

  async function sendReportComment() {
    const state = reportState.value;
    if(!state || !reportOptionId.value) return;

    reportBusy.value = true;
    try {
      const step = await submitReport(state.peerId, reportOptionId.value, reportComment.value.trim(), state.mids);
      finishReport(step);
    } catch (err: any) {
      error.value = errorOf(err, 'Could not send the report');
    } finally {
      reportBusy.value = false;
    }
  }

  function cancelReport() {
    reportState.value = null;
    reportComment.value = '';
    reportOptionId.value = 0;
  }

  function finishReport(step: ReportStep) {
    cancelReport();
    flash(step.title || 'Report sent');
  }

  async function clearChatHistory(peerId: number, revoke: boolean) {
    let cleared = false;
    await runDialogAction(async() => {
      await clearHistory(peerId, revoke);
      cleared = true;
    });

    if(!cleared) return;

    // The manager empties its own storage and dispatches the update, but the open
    // pane holds the messages, the pinned bar and the read divider itself.
    if(activePeerId.value === peerId) {
      messages.value = [];
      pinnedMessage.value = null;
      firstUnreadMid.value = null;
      selected.value = new Set();
      selecting.value = false;
      editing.value = null;
      replyTo.value = null;
    }

    flash('History cleared');
  }

  /**
   * Copy a t.me link to the message. Only a channel or supergroup has a link
   * that opens from outside, and a private channel's is member-only — which the
   * notice says, the way Telegram's own does. Unlike upstream we also offer it on
   * our own messages: copying a link to your own channel post is the common case,
   * and tweb hides it there.
   */
  function canCopyLink(message: MessageItem) {
    if(message.service || threadKind.value === 'saved') return false;
    const dialog = dialogs.value.find((d) => d.peerId === activePeerId.value);
    return !!dialog && (dialog.isMegagroup || dialog.isBroadcast);
  }

  async function copyMessageLink(message: MessageItem) {
    const peerId = activePeerId.value;
    if(peerId === null) return;

    const kind = threadKind.value;
    const rootMid = activeThreadId.value;
    const thread: MessageLinkThread | undefined =
      rootMid !== null && (kind === 'topic' || kind === 'comments') ?
        {kind, rootMid} :
        undefined;

    try {
      const link = await messageLink(peerId, message.mid, thread);
      if(!link.url) {
        flash('This chat has no message link');
        return;
      }

      await navigator.clipboard.writeText(link.url);
      flash(link.isPrivate ? 'This link will only work for members of this chat.' : 'Link copied to clipboard');
    } catch (err: any) {
      error.value = errorOf(err, 'Could not copy the link');
    }
  }

  /**
   * Where the message menu sits. Anchoring by the top edge alone drops the menu's
   * lower half — and its last actions — below the fold when the message is near
   * the bottom of the screen, so a click in the lower half anchors by the bottom
   * edge instead, the flip a native context menu does. The cap keeps the longest
   * menu (every action a message can offer) scrollable rather than clipped by the
   * stylesheet's own `overflow: hidden`.
   */
  function menuPosition(point: {x: number; y: number}) {
    const viewport = window.innerHeight;

    return {
      left: `${point.x}px`,
      ...(point.y > viewport / 2 ?
        {bottom: `${Math.max(8, viewport - point.y)}px`} :
        {top: `${point.y}px`}),
      maxHeight: 'calc(100dvh - 24px)',
      overflowY: 'auto' as const
    };
  }

  /** Place a call, explaining the failure rather than opening a dead screen. */
  async function placeCall() {
    if(activePeerId.value === null) return;

    const result = await startCall(activePeerId.value);
    if(result.ok) return;

    // `strictNullChecks` is off in this app, which also switches off TypeScript's
    // narrowing of a `boolean` discriminant; the failure fields are therefore
    // picked out by shape. The original read `result.reason` / `result.detail`.
    const failure = 'reason' in result ? result : {reason: 'failed', detail: undefined};

    error.value =
      failure.reason === 'mic-blocked' ?
        'Microphone blocked. Allow microphone access for this site in your browser settings, then try again.' :
      failure.reason === 'no-mic' ?
        (failure.detail ?? 'No microphone found. Connect one and try again.') :
        `Could not start the call${failure.detail ? `: ${failure.detail}` : ''}`;
  }

  /**
   * Open any peer as a chat, even one with no dialog yet — clicking a group
   * member you have never messaged should still land in a conversation.
   */
  async function openPeerChat(peerId: number) {
    profilePeerId.value = null;
    showInfo.value = false;
    showSidebarOnMobile.value = false;

    try {
      const brief = await getPeerBrief(peerId);
      activePeerId.value = brief.peerId;
      activeTitle.value = brief.title;
      activeIsUser.value = brief.isUser;
      activeIsSelf.value = brief.isSelf;
      activeIsChannel.value = brief.isBroadcast;
      activeIsForum.value = brief.isForum;
      activeThreadId.value = undefined;
      topicOpen.value = false;
      topics.value = [];
      replyTo.value = null;

      if(brief.isForum) {
        topics.value = await loadTopics(peerId);
        return;
      }

      await openHistory(peerId);
    } catch (err: any) {
      error.value = errorOf(err, 'Could not open that chat');
    }
  }

  /** Small groups can list who has read a message; larger ones cannot. */
  async function showReadBy(message: MessageItem) {
    if(activePeerId.value === null || activeIsUser.value) return;

    if(readByFor.value?.mid === message.mid) {
      readByFor.value = null;
      return;
    }

    const names = await readParticipants(activePeerId.value, message.mid);
    readByFor.value = {mid: message.mid, names};
  }

  /**
   * Music and voice play in the persistent bar rather than in the bubble, so
   * playback survives leaving the chat. The bar is the single audio source:
   * starting a track stops anything else the page is playing.
   */
  function openInPlayer(message: MessageItem) {
    const kind = message.media?.kind;
    if(kind !== 'audio' && kind !== 'voice') return;
    if(message.media?.selfDestruct || activePeerId.value === null) return;
    playAudioMessage(activePeerId.value, message.mid).catch(() => {});
  }

  function openLightbox(message: MessageItem) {
    const index = mediaMessages.value.findIndex((m) => m.mid === message.mid);
    if(index >= 0) lightboxIndex.value = index;

    // Opening unwatched media is what makes it watched; the sender is owed
    // that receipt just as much as a read text message.
    if(message.media?.unread && !message.out && activePeerId.value !== null) {
      readMediaContents(activePeerId.value, [message.mid]).catch(() => {});
    }
  }

  /* ---------- global search ---------- */

  /**
   * The search pane owns its own results and debounce; the box here only holds
   * the query and decides when the pane replaces the chat list.
   */
  function openSearch() {
    searchOpen.value = true;
  }

  function closeSearch() {
    searchOpen.value = false;
    query.value = '';
    searchBox.current?.blur();
  }

  function onQueryKey(e: KeyboardEvent) {
    if(e.key === 'Escape') {
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
      error.value = errorOf(err, 'Could not open that chat');
    }
  }

  /** Open the chat a found message lives in, then jump to the message itself. */
  async function openSearchMessage(peerId: number, mid: number) {
    try {
      const target = await dialogTargetFor(peerId);
      closeSearch();
      await openChat(target);
      if(activePeerId.value === peerId) await jumpTo(mid);
    } catch (err: any) {
      error.value = errorOf(err, 'Could not open that message');
    }
  }

  /* ---------- scrollback ---------- */

  async function maybeLoadOlder() {
    if(loadingOlder.value || reachedStart.value || !scroller.current || activePeerId.value === null) return;
    if(scroller.current.scrollTop > 200 || !messages.value.length) return;

    loadingOlder.value = true;
    const previousHeight = scroller.current.scrollHeight;
    const previousTop = scroller.current.scrollTop;

    try {
      const older = await loadOlder(activePeerId.value, messages.value[0].mid, {threadId: activeThreadId.value});
      const fresh = older.filter((m) => !messages.value.some((existing) => existing.mid === m.mid));

      if(!fresh.length) {
        reachedStart.value = true;
      } else {
        messages.value = [...fresh, ...messages.value];
        // Keep the viewport on the same message instead of jumping to the top.
        await tick();
        scroller.current.scrollTop = scroller.current.scrollHeight - previousHeight + previousTop;
      }
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to load older messages');
    } finally {
      loadingOlder.value = false;
    }
  }

  /* ---------- attachments ---------- */

  async function openContactPicker() {
    attachMenu.value = false;
    if(activePeerId.value === null) return;
    allDialogs.value = await loadDialogs(100, 0);
    contactPicking.value = true;
  }

  async function shareContact(contactPeerId: number) {
    contactPicking.value = false;
    if(activePeerId.value === null) return;

    const replyToMsgId = replyTo.value?.mid;
    replyTo.value = null;

    try {
      await sendContact(activePeerId.value, contactPeerId, {threadId: activeThreadId.value, replyToMsgId});
    } catch (err: any) {
      error.value = errorOf(err, 'Could not share the contact');
    }
  }

  /** Queue files for confirmation rather than sending them blind. */
  function attach(files: FileList | File[] | null) {
    // Queuing a second batch over one that is mid-upload would strand the
    // progress the dialog is showing; make the user finish or cancel first.
    if(!files || activePeerId.value === null || upload.value) return;
    const list = Array.from(files);
    if(list.length) pendingFiles.value = list;
  }

  /**
   * Upload the confirmed batch, keeping the dialog up while it runs so the
   * progress bars and the cancel button have somewhere to live.
   */
  async function confirmSend(items: SendFileItem[], caption: string) {
    if(activePeerId.value === null || upload.value) return;

    const replyToMsgId = replyTo.value?.mid;
    replyTo.value = null;
    draft.value = '';

    uploadProgress.value = items.map(() => ({progress: 0, error: ''}));

    const handle = sendFilesGrouped(activePeerId.value, items, {
      caption,
      threadId: activeThreadId.value,
      replyToMsgId,
      onprogress: (state) => (uploadProgress.value = state)
    });
    upload.value = handle;

    try {
      await handle.promise;
    } catch (err: any) {
      // A cancel rejects the same way a failure does; only a real failure is
      // worth putting in front of the user.
      if(upload.value === handle) error.value = errorOf(err, 'Upload failed');
    } finally {
      if(upload.value === handle) {
        upload.value = null;
        uploadProgress.value = null;
        pendingFiles.value = [];
      }
    }
  }

  /** Abort the batch in flight and put the dialog back to its editable state. */
  function cancelUpload() {
    upload.value?.cancel();
    upload.value = null;
    uploadProgress.value = null;
    pendingFiles.value = [];
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    dragging.value = false;
    attach(e.dataTransfer?.files ?? null);
  }

  /**
   * `dragenter`/`dragleave` fire for every element the pointer crosses, so a
   * bare `dragleave` handler flickers the overlay off over each child. Counting
   * enters against leaves is what keeps it steady.
   */
  function onDragEnter(e: DragEvent) {
    if(activePeerId.value === null || !hasFiles(e)) return;
    dragDepth.current++;
    dragging.value = true;
  }

  function onDragLeave() {
    if(dragDepth.current > 0) dragDepth.current--;
    if(!dragDepth.current) dragging.value = false;
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
    if(activePeerId.value === null || !e.clipboardData) return;

    const files = Array.from(e.clipboardData.files);
    const items = files.length ? files : Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    if(!items.length) return;

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
    if(window.matchMedia('(pointer: coarse)').matches) return;
    await tick();
    composer.value?.focus();
  }

  /**
   * The text currently selected inside a message's bubble, as a quote. Telegram
   * attaches the excerpt the user highlighted, so replying while text is
   * selected quotes exactly that fragment instead of the whole message.
   */
  function quoteOf(message: MessageItem): ReplyQuote | null {
    if(!message.text) return null;

    // Clicking the button collapses the live selection, so the tracked one is
    // what survives that far; the live read is the fallback for a keyboard path.
    const remembered = trackedQuote(message.mid);
    if(remembered) return remembered;

    const bubble = scroller.current?.querySelector<HTMLElement>(`[data-mid="${message.mid}"]`);
    return bubble ? quoteFromSelection(bubble, message.text) : null;
  }

  // Quoting needs the selection as it was made, not as it survives the click
  // that acts on it, so it is captured while it happens. The callback reads the
  // `messages` signal rather than a captured array, so it always looks at the
  // current timeline; the effect itself reads no signal and so runs once.
  useEffect(
    () => trackQuoteSelection((mid) => messages.value.find((m) => m.mid === mid)?.text ?? ''),
    []
  );

  function replyToMessage(message: MessageItem) {
    const quote = quoteOf(message);
    clearTrackedQuote();
    replyTo.value = message;
    replyContext.value = activePeerId.value === null ?
      null :
      {mid: message.mid, peerId: activePeerId.value, chatTitle: '', quote};
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
    replyElsewhereQuote.current = quoteOf(message);
    clearTrackedQuote();
    replyingElsewhere.value = message;
    allDialogs.value = await loadDialogs(100, 0);
  }

  async function doReplyElsewhere(toPeerId: number) {
    const message = replyingElsewhere.value;
    const sourcePeerId = activePeerId.value;
    const sourceTitle = activeTitle.value;
    const quote = replyElsewhereQuote.current;
    replyElsewhereQuote.current = null;
    replyingElsewhere.value = null;
    if(!message || sourcePeerId === null) return;

    // Opening the chat clears the pending reply, so the target is set after.
    await openPeerChat(toPeerId);
    replyTo.value = message;
    replyContext.value = {mid: message.mid, peerId: sourcePeerId, chatTitle: sourceTitle, quote};
    focusComposer();
  }

  function cancelReply() {
    replyTo.value = null;
    replyContext.value = null;
  }

  /** Drops the quote but keeps replying, like Telegram's "remove quote". */
  function dropQuote() {
    if(replyContext.value) replyContext.value = {...replyContext.value, quote: null};
  }

  function startEdit(message: MessageItem) {
    editing.value = message;
    replyTo.value = null;
    // Markers back in, so the formatting the message already carries survives
    // the round trip instead of being flattened by the save.
    draft.value = message.parts?.length ? partsToMarkdown(message.parts) : message.text;
    focusComposer();
  }

  function cancelEdit() {
    editing.value = null;
    draft.value = '';
  }

  async function removeMessage(message: MessageItem) {
    if(activePeerId.value === null) return;
    try {
      await deleteMessage(activePeerId.value, message.mid);
      messages.value = messages.value.filter((m) => m.mid !== message.mid);
    } catch (err: any) {
      error.value = errorOf(err, 'Delete failed');
    }
  }

  /**
   * Inline bots: "@botname query" in the composer queries that bot and shows
   * its results above the input.
   */
  function onInlineInput() {
    // The query part is optional: "@bot" alone already asks the bot for its
    // default results, which is where an "open app" button usually lives.
    const match = /^@(\w{3,32})(?:\s+([\s\S]*))?$/.exec(draft.value);
    clearTimeout(inlineTimer.current);

    if(!match || activePeerId.value === null) {
      inlineResults.value = [];
      inlineSwitch.value = null;
      inlineBot.value = '';
      return;
    }

    const [, bot, query] = match;
    inlineBot.value = bot;
    inlineTimer.current = setTimeout(async () => {
      const answer = await queryInlineBot(activePeerId.value!, bot, query ?? '');
      if(inlineBot.value !== bot) return;
      inlineResults.value = answer.results;
      inlineSwitch.value = answer;
    }, 400);
  }

  async function pickInline(result: InlineResultItem) {
    if(activePeerId.value === null) return;
    const bot = inlineBot.value;
    inlineResults.value = [];
    inlineSwitch.value = null;
    draft.value = '';

    try {
      await sendInlineResult(activePeerId.value, bot, result.queryAndResultId);
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to send inline result');
    }
  }

  /** The "open app" button an inline bot puts above its results. */
  function openInlineWebApp() {
    const answer = inlineSwitch.value;
    if(!answer?.switchWebView || activePeerId.value === null) return;

    miniApp.value = {
      botId: answer.botId,
      peerId: activePeerId.value,
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
    if(stickerSet) {
      packSheet.value = {setKey: stickerSet, docId: ''};
      return true;
    }

    const link = parseMiniAppLink(url);
    if(link) {
      const peerId = activePeerId.value;
      openBotAppLink(link, peerId ?? 0)
        .then((request) => {
          if(activePeerId.value === peerId) miniApp.value = request;
        })
        .catch(() => window.open(url, '_blank', 'noopener,noreferrer'));

      return true;
    }

    // Anything else that is a Telegram link stays in the app: usernames,
    // message links, invites, folder invites, stickers, phone and share links.
    const telegramLink = parseTelegramLink(url);
    if(!telegramLink) return false;

    handleTelegramLink(telegramLink);
    return true;
  }

  /**
   * Resolve a parsed deep link and act on it. Everything the app cannot render
   * itself (a sticker set, a share sheet) falls back to opening the original
   * link rather than dead-ending.
   */
  async function handleTelegramLink(link: TelegramLink) {
    let action: LinkAction;
    try {
      action = await resolveLink(link);
    } catch (err: any) {
      error.value = errorOf(err, 'Could not open that link');
      return;
    }

    switch (action.type) {
      case 'openPeer':
        await openPeerChat(action.peerId);
        if(action.mid) await jumpTo(action.mid);
        break;

      case 'openChat':
        await openPeerChat(action.peerId);
        break;

      case 'joinChat':
      case 'addList':
        linkSheet.value = action;
        break;

      case 'share':
        if(action.url) window.open(action.url, '_blank', 'noopener,noreferrer');
        break;

      case 'stickerSet':
        // Sticker packs open in place; an emoji pack has no in-app viewer yet,
        // so it still goes out to the official client.
        if(action.isEmoji) {
          window.open(`https://t.me/addemoji/${action.set}`, '_blank', 'noopener,noreferrer');
        } else {
          packSheet.value = {setKey: action.set, docId: ''};
        }
        break;

      case 'webApp':
        window.open(
          `https://t.me/${action.domain}${action.appname ? '/' + action.appname : ''}`,
          '_blank',
          'noopener,noreferrer'
        );
        break;

      case 'error':
        error.value = action.message;
        break;
    }
  }

  /** Same rule, for places that must open the link themselves when it is not an app. */
  function followLink(url: string) {
    if(!openLink(url)) window.open(url, '_blank', 'noopener,noreferrer');
  }

  /* ---------- sponsored messages ---------- */

  /**
   * Report the impression once the ad has actually been on screen — a view sent
   * on mount would be a view the user never had.
   *
   * The `sponsoredSeen(node, key)` action: the hook body is its `mounted` logic,
   * its cleanup the `destroy`, and the `key` its dependency.
   */
  function useSponsoredSeen(key: string) {
    const el = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const node = el.current;
      if(!node) return;

      const observer = new IntersectionObserver((entries) => {
        if(!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if(sponsoredViewed.current === key) return;
        sponsoredViewed.current = key;
        viewSponsored(key).catch(() => {});
      });

      observer.observe(node);
      return () => observer.disconnect();
    }, [key]);

    return el;
  }

  function openSponsored(item: SponsoredItem) {
    clickSponsored(item.key).catch(() => {});
    followLink(item.url);
  }

  function openBotMenuApp() {
    if(activePeerId.value === null || !botMenuButton.value) return;

    miniApp.value = {
      botId: activePeerId.value,
      peerId: activePeerId.value,
      url: botMenuButton.value.url,
      buttonText: botMenuButton.value.text,
      title: botMenuButton.value.text,
      fromBotMenu: true
    };
  }

  /**
   * A bot can label a link button anything, so anywhere outside Telegram's own
   * domains gets a confirmation carrying the real destination.
   */
  function openBotLink(url: string) {
    if(!url) return;
    if(!needsUrlConfirmation(url)) {
      followLink(url);
      return;
    }

    linkPrompt.value = {
      text: `Open ${hostOf(url) || url}? This link was sent by a bot.`,
      confirm: 'Open link',
      onconfirm: () => followLink(url)
    };
  }

  /** `keyboardButtonUrlAuth`: ask the server, then the user, then log in. */
  async function pressLoginButton(message: MessageItem, button: MessageButton) {
    if(activePeerId.value === null) return;
    const peerId = activePeerId.value;

    const prompt = await requestUrlAuth(peerId, message.mid, button.buttonId, button.url);
    if(prompt.kind === 'open') {
      openBotLink(prompt.url);
      return;
    }

    const who = prompt.botTitle ? ` and let ${prompt.botTitle} know who you are` : '';
    linkPrompt.value = {
      text: `Log in to ${hostOf(button.url) || button.url}${who}?`,
      confirm: 'Log in',
      onconfirm: async () => {
        const url = await acceptUrlAuth(
          peerId,
          message.mid,
          button.buttonId,
          button.url,
          prompt.requestWriteAccess
        );
        followLink(url);
      }
    };
  }

  async function pressButton(message: MessageItem, button: MessageButton) {
    if(activePeerId.value === null) return;
    // Keyboards belong to the bot that sent the message.
    const botId = message.fromId;

    switch (button.kind) {
      case 'url':
        openBotLink(button.url);
        break;

      case 'loginUrl':
        await pressLoginButton(message, button);
        break;

      case 'userProfile':
        if(button.userId) profilePeerId.value = button.userId;
        break;

      case 'buy':
        error.value = 'Payments are not supported in this client yet.';
        break;

      case 'game':
      case 'requestPhone':
      case 'requestGeo':
      case 'requestPoll':
        try {
          callbackBusyKey.value = `${button.row}:${button.column}`;
          const answer = await pressCallbackButton(
            activePeerId.value,
            message.mid,
            button.row,
            button.column,
            button.kind === 'game'
          );
          if(answer.url) openBotLink(answer.url);
          else if(answer.message) error.value = answer.message;
          else if(button.kind !== 'game') error.value = 'This button is not supported yet.';
        } catch (err: any) {
          error.value = errorOf(err, 'This button is not supported yet.');
        } finally {
          callbackBusyKey.value = '';
        }
        break;

      case 'webview':
        miniApp.value = {
          botId,
          peerId: activePeerId.value,
          url: button.url,
          buttonText: button.text,
          title: button.text
        };
        break;

      case 'simpleWebView':
        miniApp.value = {
          botId,
          peerId: activePeerId.value,
          url: button.url,
          buttonText: button.text,
          title: button.text,
          isSimpleWebView: true
        };
        break;

      case 'callback':
        try {
          // The bot can take a moment to answer, so the pressed button says so.
          callbackBusyKey.value = `${button.row}:${button.column}`;
          const answer = await pressCallbackButton(activePeerId.value, message.mid, button.row, button.column);
          if(answer.url) openBotLink(answer.url);
          // An alert is a modal the user must dismiss; a plain answer is a toast.
          else if(answer.message && answer.alert) {
            linkPrompt.value = {text: answer.message, confirm: 'OK', onconfirm: () => {}};
          } else if(answer.message) error.value = answer.message;
        } catch (err: any) {
          error.value = errorOf(err, 'The bot did not answer');
        } finally {
          callbackBusyKey.value = '';
        }
        break;

      case 'switchInline':
        draft.value = `@${await botUsername(botId)} ${button.payload}`.trimEnd();
        onDraftInput();
        composer.value?.focus();
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
          await sendMessage(activePeerId.value, button.text, {threadId: activeThreadId.value});
        } catch (err: any) {
          error.value = errorOf(err, 'Send failed');
        }
        break;
    }
  }

  async function botUsername(botId: number): Promise<string> {
    const peer = await getPeerBrief(botId);
    return peer?.username ?? '';
  }

  /* ---------- reply keyboards ---------- */

  /**
   * Pull the keyboard tweb has merged for this chat. A `forceReply` arms the
   * reply bar once — re-arming it on every refresh would fight the user
   * cancelling it.
   */
  async function refreshReplyKeyboard(peerId: number) {
    const state = await getReplyKeyboard(peerId);
    if(activePeerId.value !== peerId) return;

    replyKeyboard.value = state;
    if(state.kind !== 'markup') replyKeyboardOpen.value = false;

    if(state.kind === 'forceReply' && state.mid && forcedReplyMid.current !== state.mid) {
      forcedReplyMid.current = state.mid;
      const target = messages.value.find((m) => m.mid === state.mid);
      if(target) replyTo.value = target;
      focusComposer();
    }
  }

  // Reads the `activePeerId` signal, so it stays a `useSignalEffect`.
  useSignalEffect(() => {
    const peerId = activePeerId.value;
    replyKeyboard.value = null;
    replyKeyboardOpen.value = false;
    forcedReplyMid.current = 0;
    if(peerId === null) return;

    let cancelled = false;
    refreshReplyKeyboard(peerId).catch(() => {});

    const off = onReplyKeyboardChange((changed) => {
      if(!cancelled && changed === activePeerId.value) refreshReplyKeyboard(changed).catch(() => {});
    });

    return () => {
      cancelled = true;
      off.then((stop) => stop()).catch(() => {});
    };
  });

  async function pressReplyKeyboardButton(button: ReplyKeyboardButton) {
    if(activePeerId.value === null) return;

    // `single_use` keyboards fold away as soon as one button is pressed.
    if(replyKeyboard.value?.singleUse) replyKeyboardOpen.value = false;

    switch (button.kind) {
      case 'webview':
      case 'simpleWebView':
        miniApp.value = {
          botId: activePeerId.value,
          peerId: activePeerId.value,
          url: button.url,
          buttonText: button.text,
          title: button.text,
          isSimpleWebView: button.kind === 'simpleWebView'
        };
        return;

      case 'text':
        try {
          await sendMessage(activePeerId.value, button.text, {threadId: activeThreadId.value});
          await scrollToBottom();
        } catch (err: any) {
          error.value = errorOf(err, 'Send failed');
        }
        return;

      default:
        // Contact, location and poll requests need input this client cannot
        // collect yet; say so rather than sending the label as a message.
        error.value = 'This button is not supported in this client yet.';
    }
  }

  /* ---------- bot chats: start, stop, clear ---------- */

  useSignalEffect(() => {
    const peerId = activePeerId.value;
    botState.value = null;
    botCommands.current = [];
    if(peerId === null || peerId < 0) return;

    let cancelled = false;
    // `peek` so the effect does not re-run on every arriving message; the bot
    // state is only re-read when the peer changes.
    const hasMessages = messages.peek().some((m) => !m.service);
    getBotChatState(peerId, hasMessages).then((state) => {
      if(!cancelled && activePeerId.value === peerId) botState.value = state;
    });

    return () => {
      cancelled = true;
    };
  });

  async function runBotAction(action: () => Promise<void>) {
    if(botBusy.value) return;
    botBusy.value = true;
    try {
      await action();
    } catch (err: any) {
      error.value = errorOf(err, 'The bot did not respond');
    } finally {
      botBusy.value = false;
    }
  }

  function startBotChat() {
    const peerId = activePeerId.value;
    if(peerId === null) return;

    runBotAction(async () => {
      await startBot(peerId);
      if(activePeerId.value === peerId && botState.value) botState.value = {...botState.value, blocked: false, fresh: false};
    });
  }

  function stopBotChat() {
    const peerId = activePeerId.value;
    if(peerId === null) return;

    runBotAction(async () => {
      await setBotBlocked(peerId, true);
      if(activePeerId.value === peerId && botState.value) botState.value = {...botState.value, blocked: true};
    });
  }

  function clearBotChat() {
    const peerId = activePeerId.value;
    if(peerId === null) return;

    runBotAction(async () => {
      await clearBotHistory(peerId);
      if(activePeerId.value !== peerId) return;
      messages.value = [];
      if(botState.value) botState.value = {...botState.value, fresh: true};
    });
  }

  /* ---------- `/`, `@` and `#` autocomplete ---------- */

  function closeSuggestions() {
    suggestKind.value = null;
    suggestItems.value = [];
    suggestValues.current = [];
    suggestIndex.value = 0;
  }

  /**
   * Reads the token the caret sits in and fills the suggestion strip from it.
   * Only one strip is ever open, so it cannot fight the inline-bot results for
   * Enter or the arrow keys.
   */
  async function updateSuggestions() {
    const peerId = activePeerId.value;
    if(peerId === null || editing.value) {
      closeSuggestions();
      return;
    }

    const caret = composer.value?.selectionStart ?? draft.value.length;
    const before = draft.value.slice(0, caret);
    const match = /(?:^|\s)([@#/])([^\s@#/]*)$/.exec(before);
    if(!match) {
      closeSuggestions();
      return;
    }

    const [, trigger, query] = match;
    const from = caret - query.length - 1;

    // A command is only a command at the very start of a message, and a leading
    // "@bot " is the inline-bot syntax, which owns its own result list.
    if(trigger === '/' && from !== 0) {
      closeSuggestions();
      return;
    }
    if(trigger === '@' && from === 0 && inlineBot.value) {
      closeSuggestions();
      return;
    }

    const token = ++suggestToken.current;
    let items: SuggestionItem[] = [];
    let values: string[] = [];

    if(trigger === '/') {
      if(!botCommands.current.length) botCommands.current = await loadBotCommands(peerId);
      const found = filterBotCommands(botCommands.current, query);
      items = found.map((command) => ({
        key: `${command.botId}:${command.command}`,
        title: '/' + command.command + command.suffix,
        subtitle: command.description
      }));
      values = found.map((command) => `/${command.command}${command.suffix} `);
    } else if(trigger === '@') {
      const mentions = (await searchMentions(peerId, query, activeThreadId.value))
      .filter((mention) => mention.username);
      items = mentions.map((mention) => ({
        key: String(mention.peerId),
        title: '@' + mention.username,
        subtitle: mention.title
      }));
      values = mentions.map((mention) => `@${mention.username} `);
    } else {
      const tags = searchHashtags(query, messages.value.map((m) => m.text));
      items = tags.map((tag) => ({key: tag, title: '#' + tag, subtitle: ''}));
      values = tags.map((tag) => `#${tag} `);
    }

    if(token !== suggestToken.current || activePeerId.value !== peerId) return;

    if(!items.length) {
      closeSuggestions();
      return;
    }

    suggestKind.value = trigger === '/' ? 'command' : trigger === '@' ? 'mention' : 'hashtag';
    suggestItems.value = items;
    suggestValues.current = values;
    suggestIndex.value = 0;
    suggestFrom.current = from;
    suggestTo.current = caret;
  }

  /** The commands button next to the composer: the whole list, unfiltered. */
  async function openCommandList() {
    if(activePeerId.value === null) return;
    if(suggestKind.value === 'command') {
      closeSuggestions();
      return;
    }

    if(!botCommands.current.length) botCommands.current = await loadBotCommands(activePeerId.value);
    if(!botCommands.current.length) return;

    const caret = composer.value?.selectionStart ?? draft.value.length;
    suggestKind.value = 'command';
    suggestItems.value = botCommands.current.map((command) => ({
      key: `${command.botId}:${command.command}`,
      title: '/' + command.command + command.suffix,
      subtitle: command.description
    }));
    suggestValues.current = botCommands.current.map((command) => `/${command.command}${command.suffix} `);
    suggestIndex.value = 0;
    // Picking from the button inserts at the caret rather than replacing a token.
    suggestFrom.current = caret;
    suggestTo.current = caret;
    composer.value?.focus();
  }

  async function applySuggestion(index: number) {
    const value = suggestValues.current[index];
    if(value === undefined) return;

    const wasCommand = suggestKind.value === 'command';
    const before = draft.value.slice(0, suggestFrom.current);
    const after = draft.value.slice(suggestTo.current);
    draft.value = before + value + after;
    closeSuggestions();

    // A command picked on its own is what the user meant to send, the way the
    // other clients treat the command list.
    if(wasCommand && !before.trim() && !after.trim()) {
      await submit(new Event('submit'));
      return;
    }

    await tick();
    const caret = (before + value).length;
    composer.value?.focus();
    composer.value?.setSelectionRange(caret, caret);
    onDraftInput();
  }

  /** Arrow keys, Enter and Tab belong to the strip while it is open. */
  function onSuggestionKey(e: KeyboardEvent): boolean {
    if(!suggestKind.value || !suggestItems.value.length || e.isComposing) return false;

    if(e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Ctrl+Arrow is reply navigation and Alt/Meta are the OS's — only a bare
      // arrow moves the highlight.
      if(e.ctrlKey || e.metaKey || e.altKey) return false;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      suggestIndex.value = (suggestIndex.value + step + suggestItems.value.length) % suggestItems.value.length;
      return true;
    }

    if(e.key === 'Enter' || e.key === 'Tab') {
      if(e.shiftKey || e.ctrlKey || e.metaKey) return false;
      e.preventDefault();
      applySuggestion(suggestIndex.value);
      return true;
    }

    if(e.key === 'Escape') {
      e.preventDefault();
      // The window handler would otherwise close the chat behind the strip.
      e.stopPropagation();
      closeSuggestions();
      return true;
    }

    return false;
  }

  /**
   * Whether this chat's bot pins a web app next to the composer. Fetched after
   * the chat has rendered so it never delays opening one.
   */
  useSignalEffect(() => {
    const peerId = activePeerId.value;
    botMenuButton.value = null;
    if(peerId === null) return;

    let cancelled = false;
    getBotMenuButton(peerId).then((button) => {
      if(!cancelled) botMenuButton.value = button;
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
    // An open suggestion strip owns the arrows and Enter first.
    if(onSuggestionKey(e)) return;

    // Enter sends; Shift+Enter (or Ctrl/Cmd+Enter) inserts a newline. isComposing
    // guards IME candidate selection, which also arrives as Enter.
    if(e.key === 'Enter' && !e.isComposing) {
      if(e.shiftKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      // Nothing to send: treat it as "take me back to the end", which is where
      // Enter leaves you after a send anyway.
      if(!draft.value.trim() && !editing.value) jumpToLatest();
      else submit(e);
      return;
    }

    // Bare Up on an empty composer picks up the last message you can still
    // edit — the desktop shortcut for "fix what I just sent". With text in the
    // box Up is caret movement and must stay that way.
    if(
      e.key === 'ArrowUp' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.shiftKey &&
      !e.altKey &&
      !draft.value &&
      !editing.value
    ) {
      const last = [...messages.value].reverse().find((m) => m.editable && !m.service);
      if(!last) return;
      e.preventDefault();
      startEdit(last);
      return;
    }

    if(!e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if(!messages.value.length) return;
    e.preventDefault();

    const order = messages.value.filter((m) => !m.service);
    if(!order.length) return;

    const current = replyTo.value ? order.findIndex((m) => m.mid === replyTo.value!.mid) : order.length;
    const next = e.key === 'ArrowUp' ? current - 1 : current + 1;

    if(next < 0) return;
    if(next >= order.length) {
      replyTo.value = null;
      return;
    }

    replyTo.value = order[next];
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
    if(e.key !== 'Escape' || e.isComposing) return;

    if(
      lightboxIndex.value !== null ||
      pendingFiles.value.length ||
      miniApp.value ||
      showSettings.value ||
      showAccounts.value ||
      linkSheet.value ||
      folderEditorOpen.value ||
      topicEditor.value ||
      newChatOpen.value ||
      editingFolder.value ||
      forwarding.value.length ||
      replyingElsewhere.value ||
      profilePeerId.value !== null ||
      showInfo.value ||
      document.querySelector('.viewer')
    ) {
      return;
    }

    if(packSheet.value) packSheet.value = null;
    else if(messageMenu.value) messageMenu.value = null;
    else if(menuFor.value) menuFor.value = null;
    else if(topicMenuFor.value !== null) topicMenuFor.value = null;
    else if(starReactionFor.value !== null) starReactionFor.value = null;
    else if(reactionPickerFor.value) reactionPickerFor.value = null;
    else if(readByFor.value) readByFor.value = null;
    else if(selecting.value) {
      selecting.value = false;
      selected.value = new Set();
    }
    else if(showPicker.value) showPicker.value = false;
    else if(chatSearchOpen.value) closeChatSearch();
    else if(editing.value) cancelEdit();
    else if(replyTo.value) replyTo.value = null;
    else if(activePeerId.value !== null || topicOpen.value) {
      backToChats();
      // Landing back on the list, not on a forum's topic list: the search box
      // only exists in that state, and only after the pane re-renders.
      if(activePeerId.value === null) focusSearchBox();
    }
    else return;

    e.preventDefault();
  }

  /** Grow with the content instead of scrolling a single line. */
  function resizeComposer() {
    if(!composer.value) return;
    composer.value.style.height = 'auto';
    composer.value.style.height = `${Math.min(composer.value.scrollHeight, 160)}px`;
  }

  // Also runs when the draft is set from elsewhere: restoring a draft, editing
  // a message, or picking an emoji.
  useSignalEffect(() => {
    void draft.value;
    resizeComposer();
  });

  function onDraftInput() {
    resizeComposer();
    onInlineInput();
    updateSuggestions().catch(() => {});
    if(activePeerId.value === null || editing.value) return;

    // The server expires a typing status after ~6s, so keep re-sending while
    // the user is still typing rather than firing once per keystroke.
    const now = Date.now();
    if(now - lastTypingSent.current > 4000) {
      lastTypingSent.current = now;
      sendTyping(activePeerId.value, activeThreadId.value).catch(() => {});
    }

    // Persist the draft so it survives switching chats or reloading.
    clearTimeout(typingTimer.current);
    const peerId = activePeerId.value;
    const threadId = activeThreadId.value;
    const text = draft.value;
    typingTimer.current = setTimeout(() => {
      saveDraftText(peerId, threadId, text).catch(() => {});
    }, 700);
  }

  function errorOf(err: any, fallback: string) {
    return err?.type || err?.message || fallback;
  }

  async function openChat(dialog: DialogItem) {
    // On a phone the two panes are stacked; opening a chat swaps the view.
    showSidebarOnMobile.value = false;
    activePeerId.value = dialog.peerId;
    activeTitle.value = dialog.title;
    activeIsForum.value = dialog.isForum;
    activeIsUser.value = dialog.isUser;
    activeIsSelf.value = dialog.isSelf;
    readOutboxMaxId.value = dialog.readOutboxMaxId;
    // Only real broadcast channels swap ticks for view counts; megagroups are
    // negative-id peers too, so the id sign cannot be used to tell them apart.
    activeIsChannel.value = dialog.isBroadcast;
    readByFor.value = null;
    activeThreadId.value = undefined;
    topics.value = [];
    messages.value = [];
    replyTo.value = null;
    error.value = '';
    // A peer the server restricts on this platform: its history is never
    // requested, only the reason is shown.
    activeRestriction.value = dialog.restrictionText;
    sponsored.value = null;

    topicOpen.value = false;
    topicMenuFor.value = null;
    threadKind.value = '';
    threadCommentCount.value = 0;
    commentsOrigin.value = null;
    savedDialogs.value = [];
    savedTag.value = '';

    if(activeRestriction.value) return;

    // Saved Messages can be split per original sender. The preference is local,
    // so the split list is only fetched when it is actually the active view.
    if(dialog.isSelf) {
      savedAsChats.value = isSavedViewedAsChats();
      if(savedAsChats.value) {
        await refreshSavedDialogs();
        return;
      }
    }

    if(dialog.isForum) {
      forumAsMessages.value = await isViewingForumAsMessages(dialog.peerId);
      if(forumAsMessages.value) {
        // "View as messages": one flat timeline, no topic list in between.
        topicOpen.value = true;
        await openHistory(dialog.peerId, undefined, dialog.unread, dialog.readMaxId);
        return;
      }

      canManageForum.value = await canCreateTopic(dialog.peerId);
      await refreshTopics();
      return;
    }

    await openHistory(dialog.peerId, undefined, dialog.unread, dialog.readMaxId);
  }

  /* ---------- forum topics ---------- */

  async function refreshTopics() {
    if(activePeerId.value === null) return;
    const peerId = activePeerId.value;
    try {
      const loaded = await loadTopics(peerId);
      if(activePeerId.value !== peerId) return;
      // Pinned topics sit above the rest, hidden ones drop out entirely — the
      // General topic is hidden rather than deleted.
      topics.value = loaded
        .filter((topic) => !topic.hidden)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.date - a.date);
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to load topics');
    }
  }

  async function runTopicAction(action: () => Promise<unknown>) {
    topicMenuFor.value = null;
    try {
      await action();
      await refreshTopics();
    } catch (err: any) {
      error.value = errorOf(err, 'Topic action failed');
    }
  }

  async function removeTopic(topic: TopicItem) {
    if(!confirm(`Delete the topic "${topic.title}" and all its messages?`)) return;
    await runTopicAction(() => deleteTopic(activePeerId.value!, topic.threadId));
    if(activeThreadId.value === topic.threadId) backToChats();
  }

  async function onTopicSaved(threadId: number) {
    const creating = !topicEditor.value?.topic;
    topicEditor.value = null;
    await refreshTopics();
    if(creating) {
      const created = topics.value.find((topic) => topic.threadId === threadId);
      if(created) await openTopic(created);
    }
  }

  async function toggleForumAsMessages() {
    if(activePeerId.value === null) return;
    const peerId = activePeerId.value;
    const next = !forumAsMessages.value;
    try {
      await setViewForumAsMessages(peerId, next);
      forumAsMessages.value = next;
      const dialog = dialogs.value.find((d) => d.peerId === peerId);
      if(next) {
        topicOpen.value = true;
        activeThreadId.value = undefined;
        activeTitle.value = dialog?.title ?? activeTitle.value;
        threadKind.value = '';
        await openHistory(peerId, undefined, dialog?.unread ?? 0, dialog?.readMaxId ?? 0);
      } else {
        topicOpen.value = false;
        activeThreadId.value = undefined;
        messages.value = [];
        canManageForum.value = await canCreateTopic(peerId);
        await refreshTopics();
      }
    } catch (err: any) {
      error.value = errorOf(err, 'Could not switch the forum view');
    }
  }

  async function openTopic(topic: TopicItem) {
    // threadId 0 is the synthetic "all messages" row: the chat's own history,
    // not a thread. A forum still has a main timeline and hiding it makes
    // anything posted outside a topic unreachable.
    const threadId = topic.threadId || undefined;
    topicOpen.value = true;
    topicMenuFor.value = null;
    threadKind.value = threadId === undefined ? '' : 'topic';
    activeThreadId.value = threadId;
    activeTitle.value = threadId === undefined ? (dialogs.value.find((d) => d.peerId === activePeerId.value)?.title ?? 'All messages') : topic.title;
    replyTo.value = null;
    await openHistory(activePeerId.value!, threadId, topic.unread, 0);
  }

  /* ---------- Saved Messages sub-dialogs ---------- */

  async function refreshSavedDialogs() {
    const peerId = activePeerId.value;
    try {
      const loaded = await loadSavedDialogs();
      if(activePeerId.value !== peerId) return;
      savedDialogs.value = loaded.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.date - a.date);
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to load saved chats');
    }
  }

  async function toggleSavedAsChats() {
    const next = !savedAsChats.value;
    savedAsChats.value = next;
    setSavedViewedAsChats(next);
    savedTag.value = '';
    if(next) {
      topicOpen.value = false;
      threadKind.value = '';
      activeThreadId.value = undefined;
      messages.value = [];
      await refreshSavedDialogs();
    } else {
      savedDialogs.value = [];
      await openSavedTimeline();
    }
  }

  /** All of Saved Messages as one timeline, the default view. */
  async function openSavedTimeline() {
    if(activePeerId.value === null) return;
    topicOpen.value = true;
    threadKind.value = '';
    activeThreadId.value = undefined;
    activeTitle.value = 'Saved Messages';
    replyTo.value = null;
    await openHistory(activePeerId.value, undefined, 0, 0);
  }

  /**
   * One sender's saved messages. Their peer id doubles as the thread id the
   * saved timeline is filtered by.
   */
  async function openSavedDialog(saved: SavedDialogItem) {
    if(activePeerId.value === null) return;
    showSidebarOnMobile.value = false;
    topicOpen.value = true;
    threadKind.value = 'saved';
    savedTag.value = '';
    activeThreadId.value = saved.savedPeerId;
    activeTitle.value = saved.title;
    replyTo.value = null;
    await openHistory(activePeerId.value, saved.savedPeerId, 0, 0);
  }

  /** Reload the open Saved view with a tag filter applied (or cleared). */
  async function applySavedTag(emoticon: string) {
    savedTag.value = emoticon;
    if(activePeerId.value === null) return;
    loadingHistory.value = true;
    try {
      messages.value = await loadHistory(activePeerId.value, {
        threadId: activeThreadId.value,
        savedReaction: emoticon || undefined
      });
      await tick();
      await scrollToBottom();
    } catch (err: any) {
      error.value = errorOf(err, 'Could not filter by tag');
    } finally {
      loadingHistory.value = false;
    }
  }

  async function openHistory(peerId: number, threadId?: number, unread = 0, readMaxId = 0) {
    loadingHistory.value = true;
    messages.value = [];
    // Every row is about to unmount, so the refs cached for them go too —
    // otherwise a long session would hold one closure per message ever seen.
    rowRefs.clear();
    firstUnreadMid.value = null;
    reachedStart.value = false;
    windowAtLatest.value = true;
    typingNames.value = [];
    editing.value = null;
    getPresence(peerId).then((info) => (presence.value = info.text)).catch(() => (presence.value = ''));
    refreshPinned(peerId, threadId);
    businessBot.value = null;
    refreshBusinessBot(peerId);
    // Off the chat-open path on purpose: the ad is fetched after the history
    // renders, never awaited before it. Only non-user peers carry one, and the
    // manager itself returns nothing for channels we can post to.
    sponsored.value = null;
    if(peerId < 0) {
      loadSponsored(peerId)
        .then((item) => {
          if(activePeerId.value === peerId) sponsored.value = item;
        })
        .catch(() => {});
    }
    setActiveNotificationPeer(peerId);
    getReadOutboxMaxId(peerId).then((maxId) => {
      if(activePeerId.value === peerId) readOutboxMaxId.value = maxId;
    }).catch(() => {});
    getDraftText(peerId, threadId).then((text) => {
      if(activePeerId.value === peerId && activeThreadId.value === threadId) draft.value = text;
    }).catch(() => {});

    try {
      messages.value = await loadHistory(peerId, {threadId});

      // Open on the first unread message, like the official clients — not at
      // the top, and not at the bottom when there is unread history.
      if(unread > 0 && readMaxId) {
        firstUnreadMid.value = messages.value.find((m) => m.mid > readMaxId && !m.out)?.mid ?? null;
      }

      await tick();
      pinScroll(firstUnreadMid.value);
      focusComposer();
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to load messages');
    } finally {
      loadingHistory.value = false;
    }
  }

  /**
   * Re-read the pinned bar. Called when a chat opens and after a pin or unpin —
   * what the bar shows is what the manager stored, never an assumption about
   * what the server did with the request.
   */
  function refreshPinned(peerId: number, threadId?: number) {
    loadPinned(peerId, threadId).then((message) => {
      if(activePeerId.value === peerId) pinnedMessage.value = message;
    }).catch(() => {
      if(activePeerId.value === peerId) pinnedMessage.value = null;
    });
  }

  /**
   * Pin the message, or unpin it when it already is the pinned one. Only offered
   * where `pin_messages` is ours (see `canPinHere`).
   */
  async function toggleMessagePin(message: MessageItem) {
    if(activePeerId.value === null) return;

    const peerId = activePeerId.value;
    const unpin = message.pinned;
    try {
      await pinMessage(peerId, message.mid, unpin);
      messages.value = messages.value.map((m) => m.mid === message.mid ? {...m, pinned: !unpin} : m);
      refreshPinned(peerId, activeThreadId.value ?? undefined);
    } catch (err: any) {
      error.value = errorOf(err, unpin ? 'Could not unpin the message' : 'Could not pin the message');
    }
  }

  /**
   * Delete a message for me only — `revoke = false`, the same call the manager
   * makes for a local delete. It is the only delete a member has for someone
   * else's message.
   */
  async function removeMessageLocally(message: MessageItem) {
    if(activePeerId.value === null) return;
    try {
      await deleteMessage(activePeerId.value, message.mid, false);
      messages.value = messages.value.filter((m) => m.mid !== message.mid);
    } catch (err: any) {
      error.value = errorOf(err, 'Delete failed');
    }
  }

  /** The same, for the whole selection. */
  async function deleteSelectedLocally() {
    if(activePeerId.value === null || !selected.value.size) return;

    const mids = [...selected.value];
    selecting.value = false;
    selected.value = new Set();

    try {
      await deleteMessages(activePeerId.value, mids, false);
      messages.value = messages.value.filter((m) => !mids.includes(m.mid));
    } catch (err: any) {
      error.value = errorOf(err, 'Delete failed');
    }
  }

  /**
   * Whether a local delete is expressible here. Every supergroup and channel
   * goes through `channels.deleteMessages`, which has no revoke flag and always
   * deletes for everyone, so "just for me" cannot be asked for there and the
   * option is not offered. A private chat, a basic group and Saved Messages can.
   */
  function canDeleteLocally() {
    const dialog = dialogs.value.find((d) => d.peerId === activePeerId.value);
    return !!dialog && (dialog.isUser || dialog.isSelf || (!dialog.isMegagroup && !dialog.isBroadcast));
  }

  // Reads the `activePeerId` signal, so it stays a `useSignalEffect` (CONVERSION.md §4).
  useSignalEffect(() => {
    const peerId = activePeerId.value;
    canPinHere.value = false;
    if(peerId === null) return;

    let cancelled = false;
    canPin(peerId).then((allowed) => {
      if(!cancelled && activePeerId.value === peerId) canPinHere.value = allowed;
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  });

  /**
   * The open chat is one we are not in — a channel or supergroup found by
   * username, or one we left. Its history is readable, but nothing can be posted
   * until we join, so the composer gives way to a join banner.
   */
  const activeLeft = useComputed(() =>
    !!dialogs.value.find((d) => d.peerId === activePeerId.value)?.left
  );

  /**
   * Marks a mid busy while a translation or transcription is in flight, so the
   * menu item cannot be fired twice and the bubble can show that it is working.
   */
  function setMidBusy(mid: number, busy: boolean) {
    const next = new Set(busyMids.value);
    if(busy) next.add(mid);
    else next.delete(mid);
    busyMids.value = next;
  }

  async function translateOne(message: MessageItem) {
    const peerId = activePeerId.value;
    if(peerId === null || busyMids.value.has(message.mid)) return;

    setMidBusy(message.mid, true);
    try {
      const result = await translateMessage(peerId, message.mid);
      if(result?.text) {
        const next = new Map(translations.value);
        next.set(message.mid, result.text);
        translations.value = next;
      }
    } catch (err: any) {
      error.value = errorOf(err, 'Could not translate this message');
    } finally {
      setMidBusy(message.mid, false);
    }
  }

  async function transcribeOne(message: MessageItem) {
    const peerId = activePeerId.value;
    if(peerId === null || busyMids.value.has(message.mid)) return;

    setMidBusy(message.mid, true);
    try {
      const text = await transcribeVoice(peerId, message.mid);
      if(text) {
        const next = new Map(transcripts.value);
        next.set(message.mid, text);
        transcripts.value = next;
      }
    } catch (err: any) {
      error.value = errorOf(err, 'Could not transcribe this message');
    } finally {
      setMidBusy(message.mid, false);
    }
  }

  async function joinActiveChat() {
    const peerId = activePeerId.value;
    if(peerId === null || joining.value) return;

    joining.value = true;
    try {
      await joinChat(peerId);
      // The manager processed the update; re-reading the list is what lets the
      // banner go away and the composer come back on its own.
      dialogs.value = await loadDialogs(40, activeFolder.value);
    } catch (err: any) {
      error.value = errorOf(err, 'Could not join this chat');
    } finally {
      joining.value = false;
    }
  }

  /**
   * Hide the pinned bar for this chat. The manager remembers which message was
   * dismissed, so pinning something newer shows the bar again.
   */
  async function dismissPinned() {
    if(activePeerId.value === null) return;

    const peerId = activePeerId.value;
    const previous = pinnedMessage.value;
    pinnedMessage.value = null;
    try {
      await hidePinnedMessage(peerId);
    } catch (err: any) {
      if(activePeerId.value === peerId) pinnedMessage.value = previous;
      error.value = errorOf(err, 'Could not hide the pinned message');
    }
  }

  /* ---------- business bot ---------- */

  /**
   * A business bot only ever manages a private chat, and the bar it gets is
   * per-chat: leaving the conversation must not carry its state over.
   */
  async function refreshBusinessBot(peerId: number) {
    if(peerId <= 0) return;

    const bot = await getBusinessBot(peerId);
    if(activePeerId.value === peerId) businessBot.value = bot;
  }

  // The subscription reads no signal of its own, so it is an effect with an
  // empty dependency list; the callback compares against `activePeerId.value`,
  // which is always the current peer.
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;

    onPeerSettings((peerId) => {
      if(peerId === activePeerId.value) refreshBusinessBot(peerId);
    }).then((unsubscribe) => {
      if(disposed) unsubscribe();
      else off = unsubscribe;
    });

    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  async function toggleBusinessBot() {
    if(!businessBot.value || activePeerId.value === null || businessBotBusy.value) return;

    const peerId = activePeerId.value;
    const paused = !businessBot.value.paused;
    businessBotBusy.value = true;
    try {
      await setBusinessBotPaused(peerId, paused);
      if(activePeerId.value === peerId && businessBot.value) businessBot.value = {...businessBot.value, paused};
    } catch (err: any) {
      error.value = errorOf(err, paused ? 'Could not stop the bot' : 'Could not start the bot');
    } finally {
      businessBotBusy.value = false;
    }
  }

  async function disconnectBusinessBot() {
    if(!businessBot.value || activePeerId.value === null || businessBotBusy.value) return;

    const peerId = activePeerId.value;
    businessBotBusy.value = true;
    try {
      await removeBusinessBot(peerId);
      if(activePeerId.value === peerId) businessBot.value = null;
    } catch (err: any) {
      error.value = errorOf(err, 'Could not remove the bot');
    } finally {
      businessBotBusy.value = false;
    }
  }

  async function focusSearchBox() {
    await tick();
    // select(), not focus(): whatever was searched for last is left highlighted
    // so the next keystroke replaces it instead of appending to it.
    searchBox.current?.select();
  }

  function backToChats() {
    showSidebarOnMobile.value = true;

    // A comment thread lives in a different peer than the post it belongs to,
    // so leaving it is a navigation, not just a thread reset.
    if(threadKind.value === 'comments') {
      leaveCommentThread();
      return;
    }

    // "View as messages" has no list to fall back to: the forum's timeline is
    // the whole view, so backing out leaves the chat entirely.
    if(topicOpen.value && !(activeIsForum.value && forumAsMessages.value) && !(activeIsSelf.value && !savedAsChats.value)) {
      topicOpen.value = false;
      threadKind.value = '';
      threadCommentCount.value = 0;
      savedTag.value = '';
      activeThreadId.value = undefined;
      messages.value = [];
      const dialog = dialogs.value.find((d) => d.peerId === activePeerId.value);
      activeTitle.value = dialog?.title ?? '';
      return;
    }

    exitSublist();
  }

  /** Drop the forum/saved sublist and whatever thread was open inside it. */
  function exitSublist() {
    activePeerId.value = null;
    topics.value = [];
    savedDialogs.value = [];
    topicOpen.value = false;
    threadKind.value = '';
    threadCommentCount.value = 0;
    savedTag.value = '';
    activeThreadId.value = undefined;
    messages.value = [];
    activeTitle.value = '';
  }

  function isScrolledToBottom() {
    if(!scroller.current) return true;
    return scroller.current.scrollHeight - scroller.current.scrollTop - scroller.current.clientHeight < 80;
  }

  async function scrollToBottom() {
    await tick();
    if(scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }

  /**
   * Back to the end of the conversation. After a jump the loaded window sits
   * around an older message, so the newest page has to be fetched again before
   * scrolling means anything.
   */
  async function jumpToLatest() {
    releasePin();

    if(!windowAtLatest.value && activePeerId.value !== null) {
      loadingHistory.value = true;
      try {
        messages.value = await loadHistory(activePeerId.value, {threadId: activeThreadId.value});
        windowAtLatest.value = true;
        reachedStart.value = false;
        highlightedMid.value = null;
      } catch (err: any) {
        error.value = errorOf(err, 'Failed to load messages');
      } finally {
        loadingHistory.value = false;
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
    if(!scroller.current) return;

    pinnedAnchor.current = anchorMid;
    pinned.current = true;
    applyPin();

    observer.current?.disconnect();
    observer.current = new ResizeObserver(() => {
      if(pinned.current) applyPin();
    });
    observer.current.observe(scroller.current);
    for (const child of Array.from(scroller.current.children)) observer.current.observe(child);
  }

  function applyPin() {
    if(!scroller.current) return;

    if(pinnedAnchor.current !== null) {
      const el = scroller.current.querySelector<HTMLElement>(`[data-mid="${pinnedAnchor.current}"]`);
      if(el) {
        scroller.current.scrollTop = el.offsetTop - 12;
        return;
      }
    }
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }

  /** A real user gesture releases the pin; scrolling back down restores it. */
  function releasePin() {
    pinned.current = false;
    pinnedAnchor.current = null;
  }

  function onScroll() {
    atBottom.value = isScrolledToBottom();
    if(!pinned.current && atBottom.value) {
      pinned.current = true;
      pinnedAnchor.current = null;
    }
    maybeLoadOlder();
  }

  /* ---------- send options: schedule, silent, effects, slow mode, send-as ---------- */

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
      if(peer === activePeerId.value) slowMode.value = state;
    })
    .catch(() => {});

    getCurrentSendAs(peer)
    .then((id) => {
      if(peer === activePeerId.value) sendAsPeerId.value = id;
    })
    .catch(() => {});
  }

  function refreshScheduledCount(peer: number) {
    countScheduled(peer)
    .then((count) => {
      if(peer === activePeerId.value) scheduledCount.value = count;
    })
    .catch(() => {});
  }

  useSignalEffect(() => {
    const peer = activePeerId.value;

    sendOptionsOpen.value = false;
    scheduledOpen.value = false;
    effectPickerOpen.value = false;
    sendAsPickerOpen.value = false;
    sendEffect.value = '';
    sendEffectEmoticon.value = '';
    slowMode.value = null;
    sendAsPeerId.value = null;
    scheduledCount.value = 0;

    if(peer === null) {
      silentDefault.value = false;
      return;
    }

    silentDefault.value = isSilentByDefault(peer);
    refreshChatSendState(peer);
    refreshScheduledCount(peer);
  });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    onChatFullUpdate((peer) => {
      if(!cancelled && peer === activePeerId.value) refreshChatSendState(peer);
    }).then((off) => {
      if(cancelled) off();
      else unsubscribe = off;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    onScheduledUpdate((peer) => {
      if(!cancelled && peer === activePeerId.value) refreshScheduledCount(peer);
    }).then((off) => {
      if(cancelled) off();
      else unsubscribe = off;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // Only run a clock while there is a cooldown to count down.
  useSignalEffect(() => {
    if(!slowMode.value?.nextSendDate) return;
    nowSeconds.value = Math.floor(Date.now() / 1000);
    const timer = setInterval(() => (nowSeconds.value = Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  });

  /** Right-click / long-press on the send button opens the options sheet. */
  function openSendOptions(e: Event) {
    e.preventDefault();
    if(activePeerId.value === null || editing.value) return;
    sendOptionsOpen.value = true;
  }

  function onSendPointerDown() {
    if(activePeerId.value === null || editing.value) return;
    clearTimeout(sendHoldTimer.current);
    sendHeld.current = false;
    sendHoldTimer.current = setTimeout(() => {
      sendHeld.current = true;
      sendOptionsOpen.value = true;
    }, 450);
  }

  function cancelSendHold() {
    clearTimeout(sendHoldTimer.current);
  }

  function pickEffect(effectId: string, emoticon: string) {
    sendEffect.value = effectId;
    sendEffectEmoticon.value = emoticon;
    effectPickerOpen.value = false;
  }

  async function submit(e: Event) {
    e.preventDefault();
    // The release of a long press must not send as well as open the sheet.
    if(sendHeld.current) {
      sendHeld.current = false;
      return;
    }
    await deliver();
  }

  async function deliver(options: {scheduleDate?: number; silent?: boolean; scheduleRepeatPeriod?: number} = {}) {
    const typed = draft.value.trim();
    // Removing a caption is a legitimate edit of a media message, so empty text is
    // only fatal when there is nothing else to send either.
    if((!typed && !editing.value?.media) || activePeerId.value === null) return;
    // Slow mode blocks sending now, but never blocks scheduling for later.
    if(!editing.value && !options.scheduleDate && slowModeLeft.value > 0) return;

    // Markdown markers become entities here; what goes to the API is the text
    // with the markers stripped.
    const {text, entities: markupEntities} = parseComposerText(typed);
    if(!text) return;

    // Custom emoji only exist as entities over the alt text already in `text`.
    const entities = [...markupEntities, ...customEmojiEntities(text, pendingCustomEmoji.value)].sort(
      (a, b) => a.offset - b.offset
    );
    pendingCustomEmoji.value = [];

    // The debounced draft save is still pending with the text being sent; let
    // it fire and it writes the message back as a draft right after sendText
    // cleared it.
    clearTimeout(typingTimer.current);

    if(editing.value) {
      const target = editing.value;
      editing.value = null;
      draft.value = '';
      try {
        await editMessage(activePeerId.value, target.mid, text, entities);
        const updated = await getMessage(activePeerId.value, target.mid);
        if(updated) messages.value = messages.value.map((m) => (m.mid === target.mid ? updated : m));
      } catch (err: any) {
        error.value = errorOf(err, 'Edit failed');
      }
      return;
    }

    const context = activeReplyContext.value;
    const reply = replyTo.value ?
      replySendOptions(
        {
          mid: replyTo.value.mid,
          peerId: context?.peerId ?? activePeerId.value,
          title: replyTo.value.fromTitle,
          text: replyTo.value.text,
          chatTitle: context?.chatTitle ?? '',
          quote: context?.quote ?? null
        },
        activePeerId.value
      ) :
      {};
    const peer = activePeerId.value;
    const scheduleDate = options.scheduleDate;
    const effect = sendEffect.value;
    draft.value = '';
    cancelReply();
    sendEffect.value = '';
    sendEffectEmoticon.value = '';
    closeSuggestions();
    // The composer keeps its own recent-hashtag list; this is where it grows.
    rememberHashtags(text);
    if(botState.value?.fresh) botState.value = {...botState.value, fresh: false};

    try {
      await sendMessageWithOptions(peer, text, {
        ...reply,
        threadId: activeThreadId.value,
        entities,
        scheduleDate,
        scheduleRepeatPeriod: options.scheduleRepeatPeriod,
        silent: options.silent ?? silentDefault.value,
        effect: effect || undefined,
        sendAsPeerId: sendAsPeerId.value ?? undefined
      });
      lastTypingSent.current = 0;
      sendTyping(peer, activeThreadId.value, 'cancel').catch(() => {});

      if(scheduleDate) {
        // A scheduled message never joins the timeline — it joins the queue.
        refreshScheduledCount(peer);
      } else {
        // Start the next cooldown immediately; the server-side value arrives
        // with the next chat_full_update and overwrites this.
        if(slowMode.value?.seconds) {
          nowSeconds.value = Math.floor(Date.now() / 1000);
          slowMode.value = {...slowMode.value, nextSendDate: nowSeconds.value + slowMode.value.seconds};
        }
        // The outgoing message arrives back through history_multiappend.
        await scrollToBottom();
      }
    } catch (err: any) {
      error.value = errorOf(err, 'Failed to send');
    }
  }

  function timeOf(unix: number) {
    if(!unix) return '';
    return new Date(unix * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }

  /*
   * `<svelte:window onpaste={onPaste} onkeydown={onWindowKey} />`: the same two
   * listeners added and removed. Both handlers reach signals, so they always see
   * current state and the effect only has to run once.
   */
  useEffect(() => {
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onWindowKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onWindowKey);
    };
  }, []);

  /*
   * `{@const isGallery}` and `{@const menuMessage}` sat inside their `{#if}`
   * blocks; JSX has no statement slot among elements, so both are resolved here,
   * before the single return.
   */
  const inlineIsGallery = !!(
    inlineSwitch.value?.gallery ||
    inlineResults.value.every((r) => r.isGif || r.type === 'photo' || r.type === 'gif' || r.type === 'sticker')
  );
  const menuMessage = messageMenu.value ? messages.value.find((m) => m.mid === messageMenu.value.mid) : null;

  /*
   * The `use:sponsoredSeen={sponsored.key}` action's ref. Taken unconditionally
   * here — a hook cannot be called from inside the `{#if}` — with the key as its
   * dependency, so the observer attaches when the ad actually renders.
   */
  const sponsoredEl = useSponsoredSeen(sponsored.value?.key ?? '');

  return (
    <>
      <CallScreen />

      <div
        class={[
          'shell',
          showSidebarOnMobile.value && 'show-sidebar',
          !showSidebarOnMobile.value && 'show-chat'
        ].filter(Boolean).join(' ')}
      >
        <aside>
          <header>
            <button
              class="icon-button settings-open"
              onClick={() => {
                showSettings.value = true;
                // One side panel at a time — see the effect next to showSettings.
                showInfo.value = false;
                profilePeerId.value = null;
              }}
              aria-label="Settings"
            ><Glyph name="settings" /></button>
            {sublistOpen.value ? (
              <>
                {/* Leaving the sublist leaves the peer entirely, so the open thread has
                     to be torn down too — not just the list beside it. */}
                <button class="back" onClick={exitSublist} aria-label="Back">←</button>
                <span>{dialogs.value.find((d) => d.peerId === activePeerId.value)?.title ?? 'Topics'}</span>
                {topicListOpen.value ? (
                  <>
                    {canManageForum.value && (
                      <button
                        class="icon-button"
                        onClick={() => (topicEditor.value = {topic: null})}
                        aria-label="New topic"
                        title="New topic">＋</button>
                    )}
                    <button
                      class="icon-button"
                      onClick={toggleForumAsMessages}
                      aria-label="View as messages"
                      title="View as messages">≡</button>
                  </>
                ) : (
                  <button
                    class="icon-button"
                    onClick={toggleSavedAsChats}
                    aria-label="View as messages"
                    title="View as messages">≡</button>
                )}
              </>
            ) : (
              <>
                <span>Chats</span>
                <button class="icon-button new-chat" onClick={openNewChat} aria-label="New group or channel" title="New group or channel"><Glyph name="edit" /></button>
                <button
                  class="icon-button accounts-open"
                  onClick={() => (showAccounts.value = true)}
                  aria-label="Accounts"
                  title="Switch account"
                >@</button>
              </>
            )}
          </header>

          <ConnectionStatus />

          {!sublistOpen.value && (
            <>
              <div class="search">
                <input
                  ref={searchBox}
                  placeholder="Search chats, channels and messages"
                  value={query.value}
                  onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
                  onFocus={openSearch}
                  onKeyDown={onQueryKey}
                />
                {searchOpen.value && (
                  <button class="search-cancel" onClick={closeSearch} aria-label="Close search">✕</button>
                )}
              </div>
              <Stories dialogs={dialogs.value} />
              {folders.value.length > 1 && (
                <div class="folders">
                  {folders.value.map((folder) => (
                    <button
                      key={folder.id}
                      class={folder.id === activeFolder.value ? 'active' : ''}
                      onClick={() => openFolder(folder)}
                      onDblClick={() => folder.editable && openFolderEditor(folder)}
                      title={folder.editable ? 'Double-click to edit' : ''}
                    >
                      {folder.emoticon ? <span class="folder-icon">{folder.emoticon}</span> : null}
                      {folder.title}
                      {folder.unread ? <span class="folder-badge">{folder.unread}</span> : null}
                    </button>
                  ))}
                  <button class="add-folder" onClick={() => openFolderEditor(null)} title="New folder">＋</button>
                </div>
              )}
            </>
          )}

          {searchOpen.value ?
            <GlobalSearch query={query.value} onOpenPeer={openSearchPeer} onOpenMessage={openSearchMessage} /> :
          (
            <div class="list">
              {loadingChats.value ?
                <p class="muted">Loading chats…</p> :
              topicListOpen.value ? (
                <>
                  <button
                    class={['row-button', activeThreadId.value === undefined && topicOpen.value && 'active'].filter(Boolean).join(' ')}
                    onClick={() => openTopic(allMessagesRow)}
                  >
                    <span class="topic-glyph">≡</span>
                    <span class="meta">
                      <span class="row"><span class="title">All messages</span></span>
                      <span class="row"><span class="preview">Everything in this chat</span></span>
                    </span>
                  </button>

                  {topics.value.map((topic) => (
                    <Fragment key={topic.threadId}>
                      <button
                        class={['row-button', topic.threadId === activeThreadId.value && 'active'].filter(Boolean).join(' ')}
                        onClick={() => openTopic(topic)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          topicMenuFor.value = topicMenuFor.value === topic.threadId ? null : topic.threadId;
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
                              {topic.pinned && (
                                <span class="flag" title="Pinned"><Glyph name="pin" size={13} /></span>
                              )}
                              {topic.closed && <span class="flag" title="Closed">🔒</span>}
                              {topic.title}
                            </span>
                            <span class="time">{timeOf(topic.date)}</span>
                          </span>
                          <span class="row">
                            <span class="preview">{topic.preview}</span>
                            {topic.unread ? <span class="badge">{topic.unread}</span> : null}
                          </span>
                        </span>
                      </button>

                      {topicMenuFor.value === topic.threadId && topic.canManage && (
                        <div class="menu">
                          <button onClick={() => (topicEditor.value = {topic})}>Edit</button>
                          <button onClick={() => runTopicAction(() => toggleTopicPin(activePeerId.value!, topic.threadId))}>
                            {topic.pinned ? 'Unpin' : 'Pin'}
                          </button>
                          <button
                            onClick={() =>
                              runTopicAction(() => setTopicClosed(activePeerId.value!, topic.threadId, !topic.closed))}
                          >
                            {topic.closed ? 'Reopen' : 'Close'}
                          </button>
                          {topic.isGeneral ?
                            /* General cannot be deleted, only folded away. */
                            <button onClick={() => runTopicAction(() => setTopicHidden(activePeerId.value!, topic.threadId, true))}>
                              Hide
                            </button> :
                            <button class="danger" onClick={() => removeTopic(topic)}>Delete</button>
                          }
                        </div>
                      )}
                    </Fragment>
                  ))}
                </>
              ) : savedListOpen.value ? (
                !savedDialogs.value.length ?
                  <p class="muted">Nothing saved yet.</p> :
                  savedDialogs.value.map((saved) => (
                    <button
                      key={saved.savedPeerId}
                      class={['row-button', saved.savedPeerId === activeThreadId.value && 'active'].filter(Boolean).join(' ')}
                      onClick={() => openSavedDialog(saved)}
                    >
                      <Avatar peerId={saved.savedPeerId} title={saved.title} />
                      <span class="meta">
                        <span class="row">
                          <span class="title">
                            {saved.pinned && (
                              <span class="flag" title="Pinned"><Glyph name="pin" size={13} /></span>
                            )}
                            {saved.title}
                          </span>
                          <span class="time">{timeOf(saved.date)}</span>
                        </span>
                        <span class="row"><span class="preview">{saved.preview}</span></span>
                      </span>
                    </button>
                  ))
              ) : archiveOpen.value && loadingArchive.value ?
                <p class="muted">Loading archive…</p> :
              !listedDialogs.value.length ? (
                <>
                  {archiveOpen.value && (
                    <button class="row-button archive-row" onClick={closeArchive}>
                      <span class="topic-glyph">←</span>
                      <span class="meta"><span class="title">Back to chats</span></span>
                    </button>
                  )}
                  <p class="muted">{archiveOpen.value ? 'The archive is empty.' : 'No chats yet.'}</p>
                </>
              ) : (
                <>
                  {archiveOpen.value ?
                    <button class="row-button archive-row" onClick={closeArchive}>
                      <span class="topic-glyph">←</span>
                      <span class="meta">
                        <span class="row">
                          <span class="title">Archived chats</span>
                        </span>
                        <span class="row">
                          <span class="preview">Back to chats</span>
                        </span>
                      </span>
                    </button> :
                  archiveSummary.value.total && !query.value && activeFolder.value === 0 ? (
                    <button class="row-button archive-row" onClick={openArchive}>
                      <span class="topic-glyph"><Glyph name="archive" size={18} /></span>
                      <span class="meta">
                        <span class="row">
                          <span class="title">Archived chats</span>
                        </span>
                        <span class="row">
                          <span class="preview">
                            {archiveSummary.value.total} chat{archiveSummary.value.total === 1 ? '' : 's'}
                          </span>
                          {archiveSummary.value.unread ? <span class="badge">{archiveSummary.value.unread}</span> : null}
                        </span>
                      </span>
                    </button>
                  ) : null}

                  {listedDialogs.value.map((dialog) => (
                    <Fragment key={dialog.peerId}>
                      <button
                        class={[
                          'row-button',
                          dialog.peerId === activePeerId.value && 'active',
                          dragOverPeerId.value === dialog.peerId && 'drag-over'
                        ].filter(Boolean).join(' ')}
                        draggable={dialog.pinned}
                        onDragStart={(e) => onRowDragStart(e, dialog)}
                        onDragOver={(e) => onRowDragOver(e, dialog)}
                        onDragEnd={onRowDragEnd}
                        onDrop={(e) => onRowDrop(e, dialog)}
                        onClick={() => openChat(dialog)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          folderMenuFor.value = null;
                          const opening = menuFor.value?.peerId !== dialog.peerId;
                          menuFor.value = opening ? dialog : null;
                          clearInfo.value = null;
                          if(opening) refreshClearInfo(dialog.peerId);
                        }}
                      >
                        <span class="avatar-wrap">
                          <Avatar peerId={dialog.peerId} title={dialog.title} />
                          {dialog.isUser && !dialog.isSelf && onlinePeerIds.value.includes(dialog.peerId) && (
                            <span class="online-dot" title="Online"></span>
                          )}
                        </span>
                        <span class="meta">
                          <span class="row">
                            <span class="title">
                              {dialog.pinned && (
                                <span class="flag" title="Pinned"><Glyph name="pin" size={13} /></span>
                              )}
                              {dialog.muted && (
                                <span class="flag" title="Muted"><Glyph name="muted" size={13} /></span>
                              )}
                              {dialog.title}
                            </span>
                            <span class="time">{timeOf(dialog.date)}</span>
                          </span>
                          <span class="row">
                            {typingTextFor(dialog.peerId) ?
                              <span class="preview typing">{typingTextFor(dialog.peerId)}</span> :
                              <span class="preview">{dialog.preview}</span>
                            }
                            {dialog.unread ? <span class="badge">{dialog.unread}</span> : null}
                          </span>
                        </span>
                      </button>

                      {menuFor.value?.peerId === dialog.peerId && (
                        <div class="menu">
                          <button
                            onClick={() =>
                              runDialogAction(() =>
                                togglePin(dialog.peerId, archiveOpen.value ? FOLDER_ID_ARCHIVE : activeFolder.value)
                              )}
                          >
                            {dialog.pinned ? 'Unpin' : 'Pin'}
                          </button>
                          <button onClick={() => runDialogAction(() => toggleMute(dialog.peerId, !dialog.muted))}>
                            {dialog.muted ? 'Unmute' : 'Mute'}
                          </button>
                          <button
                            onClick={() =>
                              runDialogAction(() =>
                                dialog.unread ? markDialogRead(dialog.peerId) : markDialogUnread(dialog.peerId)
                              )}
                          >
                            {dialog.unread ? 'Mark as read' : 'Mark as unread'}
                          </button>
                          <button onClick={() => runDialogAction(() => setDialogArchived(dialog.peerId, !archiveOpen.value))}>
                            {archiveOpen.value ? 'Unarchive' : 'Archive'}
                          </button>
                          <button class="submenu-trigger" onClick={() => openFolderMenu(dialog)}>
                            Add to folder
                            <span class="chevron">{folderMenuFor.value === dialog.peerId ? '▾' : '▸'}</span>
                          </button>
                          {folderMenuFor.value === dialog.peerId && (
                            !folderMemberships.value.length ?
                              <span class="submenu-empty">No folders yet</span> :
                              folderMemberships.value.map((membership) => (
                                <button
                                  key={membership.folderId}
                                  class="submenu-item"
                                  onClick={() =>
                                    runDialogAction(() =>
                                      toggleFolderMembership(membership.folderId, dialog.peerId, !membership.included)
                                    )}
                                >
                                  <span class="check">{membership.included ? '✓' : ''}</span>
                                  {membership.emoticon}
                                  {membership.title}
                                </button>
                              ))
                          )}
                          {dialog.isSelf && (
                            <button
                              onClick={() => {
                                menuFor.value = null;
                                // Toggling the open chat has to redraw it; toggling a chat
                                // that is not open only needs the stored preference.
                                if(activePeerId.value === dialog.peerId) toggleSavedAsChats();
                                else setSavedViewedAsChats(!isSavedViewedAsChats());
                              }}
                            >
                              {(activePeerId.value === dialog.peerId ? savedAsChats.value : isSavedViewedAsChats())
                                ? 'View as messages'
                                : 'View as chats'}
                            </button>
                          )}
                          {dialog.isForum && (
                            <button
                              onClick={() => {
                                menuFor.value = null;
                                if(activePeerId.value === dialog.peerId) toggleForumAsMessages();
                                else openChat(dialog).then(toggleForumAsMessages);
                              }}
                            >
                              {forumAsMessages.value && activePeerId.value === dialog.peerId
                                ? 'View as topics'
                                : 'View as messages'}
                            </button>
                          )}
                          {clearInfo.value?.peerId === dialog.peerId && clearInfo.value.can ? (
                            <>
                              <button class="danger" onClick={() => askClearHistory(dialog, false)}>
                                Clear history
                              </button>
                              {clearInfo.value.canRevokeForBoth ? (
                                <button class="danger" onClick={() => askClearHistory(dialog, true)}>
                                  Clear history for everyone
                                </button>
                              ) : null}
                            </>
                          ) : null}
                          <button class="danger" onClick={() => runDialogAction(() => leaveOrDelete(dialog.peerId))}>
                            Delete / Leave
                          </button>
                        </div>
                      )}
                    </Fragment>
                  ))}
                </>
              )}
            </div>
          )}
        </aside>

        <section
          class={dragging.value ? 'dragging' : ''}
          onDragEnter={onDragEnter}
          onDragOver={(e) => {
            // Without preventDefault the browser refuses the drop and navigates to
            // the file instead.
            if(activePeerId.value !== null && hasFiles(e)) e.preventDefault();
          }}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          aria-label="Conversation"
        >
          {dragging.value ? (
            <div class="drop-overlay">
              <div class="drop-card">
                <Glyph name="attach" size={28} />
                <strong>Drop to send</strong>
                <span class="muted">Photos and videos go as an album, anything else as a file</span>
              </div>
            </div>
          ) : null}
          {activePeerId.value === null || (sublistOpen.value && !topicOpen.value) ? (
            <div class="empty">
              <div class="empty-logo" aria-hidden="true"><Logo size={72} /></div>
              <p class="muted">
                {topicListOpen.value ? 'Select a topic' : savedListOpen.value ? 'Select a saved chat' : 'Select a chat'}
              </p>
              {/* Same disclosure the sign-in card carries; required for a
                   third-party client by https://core.telegram.org/api/terms. */}
              <p class="disclosure">
                Web S is an unofficial client built on the Telegram API. Not affiliated with Telegram.
              </p>
              {GIT_COMMIT_URL ? (
                <a
                  class="build-commit"
                  href={GIT_COMMIT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Built from ${GIT_COMMIT}`}
                >
                  {GIT_COMMIT_SHORT}
                </a>
              ) : null}
            </div>
          ) : (
            <>
              <header>
                <button class="back-mobile" onClick={() => (showSidebarOnMobile.value = true)} aria-label="Back">←</button>
                {/* The peer block every Telegram client opens a chat with: photo,
                    name, and the line under it. Tapping it opens the profile. */}
                <button class="title-button peer-head" onClick={() => (showInfo.value = !showInfo.value)}>
                  {activePeerId.value !== null && <Avatar peerId={activePeerId.value} title={activeTitle.value} size={42} />}
                  <span class="peer-titles">
                    <span class="peer-name">
                      {activeTitle.value}
                      {activePeerId.value !== null && <EmojiStatus peerId={activePeerId.value} size={16} />}
                    </span>
                    <span class={['presence', 'peer-status', typingNames.value.length && 'typing'].filter(Boolean).join(' ')}>
                      {typingNames.value.length
                        ? `${typingNames.value.join(', ')} ${typingNames.value.length > 1 ? 'are' : 'is'} typing…`
                        : presence.value}
                    </span>
                  </span>
                </button>
                {threadKind.value === 'comments' ? (
                  <button class="thread-tag thread-back" onClick={leaveCommentThread} title="Back to the post">
                    {threadCommentCount.value
                      ? `${threadCommentCount.value} ${threadCommentCount.value === 1 ? 'comment' : 'comments'}`
                      : 'comments'}
                  </button>
                ) : threadKind.value === 'topic' ? (
                  <span class="thread-tag">topic</span>
                ) : threadKind.value === 'saved' ? (
                  <span class="thread-tag">saved</span>
                ) : null}
                {/* Keeps the thread tag beside the name and the actions at the
                    far end, whatever combination of the two is on screen. */}
                <span class="peer-gap"></span>
                {activeIsUser.value && !activeIsSelf.value ? (
                  <button class="icon-button" onClick={placeCall} aria-label="Call"><Glyph name="call" /></button>
                ) : null}
                <button class="icon-button" onClick={() => (chatSearchOpen.value = !chatSearchOpen.value)} aria-label="Search messages"><Glyph name="search" /></button>
              </header>

              {activeIsSelf.value ? (
                <SavedTags
                  savedPeerId={threadKind.value === 'saved' ? activeThreadId.value : undefined}
                  active={savedTag.value}
                  onselect={applySavedTag}
                />
              ) : null}

              {chatSearchOpen.value ? (
                <>
                  <div class="chat-search">
                    <input
                      placeholder="Search in chat"
                      value={chatQuery.value}
                      onInput={(e) => {
                        chatQuery.value = (e.target as HTMLInputElement).value;
                        onChatQueryInput();
                      }}
                    />
                    {chatResults.value?.length ? (
                      <>
                        <span class="result-counter">
                          {chatResultIndex.value + 1} of {Math.max(chatResultCount.value, chatResults.value.length)}
                        </span>
                        <button
                          class="step"
                          onClick={() => stepResult(1)}
                          disabled={chatResultIndex.value + 1 >= chatResults.value.length && chatResultsEnd.value}
                          aria-label="Older result"
                        >↓</button>
                        <button
                          class="step"
                          onClick={() => stepResult(-1)}
                          disabled={chatResultIndex.value <= 0}
                          aria-label="Newer result"
                        >↑</button>
                      </>
                    ) : null}
                    <button
                      class={['filters-toggle', (chatFiltersOpen.value || chatFilter.value !== 'all' || !!chatFrom.value || !!chatDate.value) && 'on'].filter(Boolean).join(' ')}
                      onClick={() => (chatFiltersOpen.value = !chatFiltersOpen.value)}
                    >Filters</button>
                    <button onClick={closeChatSearch} aria-label="Close search">✕</button>
                  </div>

                  {chatFiltersOpen.value ? (
                    <div class="chat-filters">
                      <div class="filter-chips">
                        {MEDIA_FILTERS.map((option) => (
                          <button
                            key={option.value}
                            class={['chip', chatFilter.value === option.value && 'on'].filter(Boolean).join(' ')}
                            onClick={() => applyChatFilter(option.value)}
                          >{option.label}</button>
                        ))}
                      </div>

                      <div class="filter-row">
                        {canFilterBySender.value ? (
                          <>
                            <button class={['chip', !!chatFrom.value && 'on'].filter(Boolean).join(' ')} onClick={openFromPicker}>
                              {chatFrom.value ? `From: ${chatFrom.value.title}` : 'From sender'}
                            </button>
                            {chatFrom.value ? (
                              <button class="chip" onClick={() => pickFrom(null)} aria-label="Clear sender">✕</button>
                            ) : null}
                          </>
                        ) : null}
                        <label class="date-jump">
                          Jump to date
                          <input type="date" value={chatDate.value} onChange={(e) => jumpToDate(e.currentTarget.value)} />
                        </label>
                      </div>

                      {chatFromOpen.value ? (
                        <div class="from-picker">
                          <input
                            placeholder="Search members"
                            value={chatFromQuery.value}
                            onInput={(e) => {
                              chatFromQuery.value = (e.target as HTMLInputElement).value;
                              onFromQueryInput();
                            }}
                          />
                          {!chatMembers.value.length ?
                            <p class="muted">No members found.</p> :
                            chatMembers.value.map((member) => (
                              <button key={member.peerId} class="from-row" onClick={() => pickFrom(member)}>
                                <Avatar peerId={member.peerId} title={member.title} size={28} />
                                <span class="from-name">{member.title}</span>
                              </button>
                            ))
                          }
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {chatResults.value ? (
                    <div class="results">
                      {!chatResults.value.length ?
                        <p class="muted">{chatSearching.value ? 'Searching…' : 'Nothing found.'}</p> :
                        <>
                          {chatResults.value.map((result, index) => (
                            <button
                              key={result.mid}
                              class={['result', index === chatResultIndex.value && 'current'].filter(Boolean).join(' ')}
                              onClick={() => selectResult(index)}
                            >
                              <span class="result-from">{result.fromTitle}</span>
                              <span class="result-text">{result.text || 'Media'}</span>
                            </button>
                          ))}
                          {!chatResultsEnd.value ? (
                            <button class="result more" onClick={loadMoreChatResults} disabled={chatSearching.value}>
                              {chatSearching.value ? 'Loading…' : 'Load more'}
                            </button>
                          ) : null}
                        </>
                      }
                    </div>
                  ) : null}
                </>
              ) : null}

              {selecting.value ? (
                <div class="selection-bar">
                  <span>{selected.value.size} selected</span>
                  <span class="spacer"></span>
                  <button onClick={forwardSelected}>Forward</button>
                  <button class="danger" onClick={deleteSelected}>Delete</button>
                  {canDeleteLocally() ? <button onClick={deleteSelectedLocally}>Delete for me</button> : null}
                  <button onClick={() => { selecting.value = false; selected.value = new Set(); }}>Cancel</button>
                </div>
              ) : null}

              {businessBot.value ? (
                <div class="business-bar">
                  <Avatar peerId={businessBot.value.botId} title={businessBot.value.title} size={28} />
                  <span class="business-text">
                    <span class="business-title">{businessBot.value.title}</span>
                    <span class="business-note">
                      {businessBot.value.paused ? 'Stopped for this chat' : 'Replying to this chat for you'}
                    </span>
                  </span>
                  <button class="business-action" disabled={businessBotBusy.value} onClick={toggleBusinessBot}>
                    {businessBot.value.paused ? 'Start bot' : 'Stop bot'}
                  </button>
                  {businessBot.value.manageUrl ? (
                    <button class="business-action" onClick={() => openLink(businessBot.value!.manageUrl!)}>
                      Manage
                    </button>
                  ) : null}
                  <button class="business-action danger" disabled={businessBotBusy.value} onClick={disconnectBusinessBot}>
                    Remove
                  </button>
                </div>
              ) : null}

              {pinnedMessage.value ? (
                <div class="pinned-bar">
                  <button class="pinned-jump" onClick={() => jumpTo(pinnedMessage.value!.mid)}>
                    <span class="pinned-label">Pinned message</span>
                    <span class="pinned-text">{pinnedMessage.value.text || 'Media'}</span>
                  </button>
                  <button class="pinned-dismiss" onClick={dismissPinned} aria-label="Hide pinned message" title="Hide pinned message">
                    <Glyph name="close" />
                  </button>
                </div>
              ) : null}

              <div
                class="messages"
                ref={scroller}
                onScroll={onScroll}
                onWheel={releasePin}
                onTouchMove={releasePin}
                role="log"
                aria-label="Messages"
              >
                {activeRestriction.value ?
                  <p class="muted centered restricted-peer">{activeRestriction.value}</p> :
                loadingHistory.value ?
                  <p class="muted">Loading…</p> :
                (
                  <>
                    {loadingOlder.value ?
                      <p class="muted centered">Loading older…</p> :
                    reachedStart.value ?
                      <p class="muted centered">Beginning of the chat</p> :
                    null}
                    {rendered.value.map((group, groupIndex) => {
                      const message = group.items[0];
                      /* An album carries one caption for the whole group, and the server
                         is free to hang it off any item — so the bubble shows whichever
                         item actually has the text. */
                      const captioned = group.items.find((item) => item.rich || item.parts.length) ?? message;
                      // The two `use:` actions of a bubble, as cached ref factories
                      // rather than hooks: this runs once per rendered group, and a
                      // component must call the same hooks in the same order on every
                      // render while the row count is not stable. Each ref is attached
                      // only where the original attached it.
                      const refs = rowRefsFor(message.mid);

                      return (
                        <Fragment key={group.key}>
                          {startsNewDay(groupIndex) ? (
                            <p class="day-divider">{dayLabel(message.date)}</p>
                          ) : null}
                          {message.mid === firstUnreadMid.value ? (
                            <p class="unread-divider" data-mid={message.mid}>Unread messages</p>
                          ) : null}
                          {message.service && message.extra?.kind === 'gift' ? (
                            /* A gift arrives as a service message, but it is a card: the
                               sticker, who sent it and what it is worth. */
                            <div class="service-card" data-mid={message.mid}>
                              <GiftBubble gift={message.extra} fromTitle={message.fromTitle} />
                            </div>
                          ) : message.service && activePeerId.value !== null && (
                            message.payment?.kind === 'starGift' ||
                            message.payment?.kind === 'giftCode' ||
                            message.payment?.kind === 'paymentSent'
                          ) ? (
                            /* Three more service messages are cards: a Star gift, a gift
                               code and a receipt. They sit behind this branch because the
                               bubble body — where every other payment card is rendered — is
                               never reached by a service message. */
                            <div class="service-card" data-mid={message.mid}>
                              <MessagePayment
                                peerId={activePeerId.value}
                                mid={message.mid}
                                payment={message.payment}
                              />
                            </div>
                          ) : message.service ? (
                            <p
                              class={['service', highlightedMid.value === message.mid && 'highlighted'].filter(Boolean).join(' ')}
                              data-mid={message.mid}
                            >{message.text}</p>
                          ) : message.restrictionText ? (
                            /* The server restricts this message on this platform. Only its
                               own wording is shown; body, media and buttons stay hidden. */
                            <div class={['line', message.out && 'out'].filter(Boolean).join(' ')}>
                              <div
                                class={['bubble', 'restricted', message.out && 'out'].filter(Boolean).join(' ')}
                                data-mid={message.mid}
                                ref={refs.read}
                              >
                                <span class="restricted-text">{message.restrictionText}</span>
                                <span class="stamp"><span class="time">{timeOf(message.date)}</span></span>
                              </div>
                            </div>
                          ) : message.stickerDocId ? (
                            /* Wrapped in the same .line as a bubble, avatar and all, so a
                                 sticker starts on the same column as the messages around it
                                 instead of hugging the pane edge. */
                            <div class={['line', message.out && 'out'].filter(Boolean).join(' ')}>
                              {!message.out ? (
                                <button
                                  class={['line-avatar', sameSenderAsPrevious(group) && 'hidden'].filter(Boolean).join(' ')}
                                  onClick={() => (profilePeerId.value = message.fromId)}
                                  aria-label={`View ${message.fromTitle}`}
                                >
                                  <Avatar peerId={message.fromId} title={message.fromTitle} size={32} />
                                </button>
                              ) : null}
                              <div
                                class={[
                                  'sticker-bubble',
                                  message.out && 'out',
                                  highlightedMid.value === message.mid && 'highlighted',
                                  selected.value.has(message.mid) && 'selected'
                                ].filter(Boolean).join(' ')}
                                data-mid={message.mid}
                                ref={refs.bubble}
                                onClick={() => selecting.value && toggleSelected(message.mid)}
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
                                  <button class="reply-btn" onClick={() => replyToMessage(message)}>Reply</button>
                                  <button class="reply-btn" onClick={() => openForward(message)}>Forward</button>
                                  <span class="time">{timeOf(message.date)}</span>
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div class={['line', message.out && 'out'].filter(Boolean).join(' ')}>
                              {!message.out ? (
                                /* Sender photo, like the official clients. Hidden on
                                     consecutive messages from the same person. */
                                <button
                                  class={['line-avatar', sameSenderAsPrevious(group) && 'hidden'].filter(Boolean).join(' ')}
                                  onClick={() => (profilePeerId.value = message.fromId)}
                                  aria-label={`View ${message.fromTitle}`}
                                >
                                  <Avatar peerId={message.fromId} title={message.fromTitle} size={32} />
                                </button>
                              ) : null}
                              <div
                                class={[
                                  'bubble',
                                  message.out && 'out',
                                  highlightedMid.value === message.mid && 'highlighted',
                                  selected.value.has(message.mid) && 'selected'
                                ].filter(Boolean).join(' ')}
                                data-mid={message.mid}
                                ref={refs.bubble}
                                onClick={() => (selecting.value ? toggleSelected(message.mid) : openInPlayer(message))}
                                onDblClick={() => quickReact(message)}
                                role="presentation"
                              >
                                {!message.out && message.fromTitle ? (
                                  <button class="author" onClick={() => (profilePeerId.value = message.fromId)}>
                                    {message.fromTitle}<EmojiStatus peerId={message.fromId} size={14} />
                                  </button>
                                ) : null}

                                {message.forward ? (
                                  <ForwardHeader forward={message.forward} onopenpeer={openPeerChat} />
                                ) : null}

                                {message.reply ? (
                                  <ReplyHeader reply={message.reply} onjump={() => jumpToReply(message.reply!)} />
                                ) : null}

                                {group.items.length > 1 ? (
                                  /* Album tiling, the way the official clients lay it out: a
                                       pair side by side, a hero plus a stack at three, a hero
                                       over a strip at four, an even grid beyond that. */
                                  <div class={[
                                    'album',
                                    group.items.length === 2 && 'n2',
                                    group.items.length === 3 && 'n3',
                                    group.items.length === 4 && 'n4',
                                    group.items.length > 4 && 'many'
                                  ].filter(Boolean).join(' ')}>
                                    {group.items.map((item, tileIndex) => (
                                      <button
                                        key={item.mid}
                                        class={['album-item', tileIndex === 0 && 'first'].filter(Boolean).join(' ')}
                                        onClick={() => openLightbox(item)}
                                      >
                                        <Media peerId={activePeerId.value} mid={item.mid} media={item.media!} fill />
                                      </button>
                                    ))}
                                  </div>
                                ) : message.media?.selfDestruct ? (
                                  /* Self-destructing media is never rendered here: this client
                                       cannot enforce the expiry, and showing a copy that outlives
                                       it would interfere with the feature. */
                                  <span class="self-destruct">
                                    🔥 {message.out ? 'Self-destructing media sent' : 'Self-destructing media — open it in an official Telegram app'}
                                  </span>
                                ) : message.media ? (
                                  message.media.kind === 'photo' || message.media.kind === 'video' || message.media.kind === 'gif' ? (
                                    <button class="media-button" onClick={() => openLightbox(message)}>
                                      <Media peerId={activePeerId.value} mid={message.mid} media={message.media} />
                                    </button>
                                  ) : (
                                    <Media peerId={activePeerId.value} mid={message.mid} media={message.media} />
                                  )
                                ) : null}

                                {message.extra && activePeerId.value !== null ? (
                                  message.extra.kind === 'geo' || message.extra.kind === 'geoLive' || message.extra.kind === 'venue' ? (
                                    <LocationBubble
                                      peerId={activePeerId.value}
                                      mid={message.mid}
                                      location={message.extra}
                                      onerror={(text) => (error.value = text)}
                                    />
                                  ) : message.extra.kind === 'contact' ? (
                                    <ContactBubble
                                      contact={message.extra}
                                      onmessage={openPeerChat}
                                      onerror={(text) => (error.value = text)}
                                    />
                                  ) : message.extra.kind === 'game' ? (
                                    <GameBubble
                                      peerId={activePeerId.value}
                                      mid={message.mid}
                                      game={message.extra}
                                      onerror={(text) => (error.value = text)}
                                    />
                                  ) : message.extra.kind === 'invoice' ? (
                                    <InvoiceBubble
                                      peerId={activePeerId.value}
                                      mid={message.mid}
                                      invoice={message.extra}
                                      onerror={(text) => (error.value = text)}
                                    />
                                  ) : message.extra.kind === 'checklist' ? (
                                    <ChecklistBubble
                                      peerId={activePeerId.value}
                                      mid={message.mid}
                                      checklist={message.extra}
                                      onerror={(text) => (error.value = text)}
                                    />
                                  ) : message.extra.kind === 'dice' ? (
                                    /* A dice replays only while it is unanswered or still
                                         unread — a chat you have already read shows the
                                         outcome frame, the way tweb's own renderer does. */
                                    <Dice
                                      extra={message.extra}
                                      play={message.extra.value === 0 || (
                                        !message.out &&
                                        firstUnreadMid.value !== null &&
                                        message.mid >= firstUnreadMid.value
                                      )}
                                    />
                                  ) : message.extra.kind === 'story' ? (
                                    <StoryBubble
                                      extra={message.extra}
                                      chatTitle={dialogs.value.find((d) => d.peerId === activePeerId.value)?.title ?? ''}
                                    />
                                  ) : null
                                ) : null}

                                {message.pending && message.media && uploadOverall.value !== null ? (
                                  /* The optimistic bubble shows the batch's progress; the
                                       cancel here is the same abort the dialog offers. */
                                  <div class="upload-row">
                                    <div
                                      class="upload-bar"
                                      role="progressbar"
                                      aria-valuenow={Math.round(uploadOverall.value * 100)}
                                    >
                                      <div class="upload-fill" style={{width: `${Math.round(uploadOverall.value * 100)}%`}}></div>
                                    </div>
                                    <button class="upload-cancel" onClick={cancelUpload} aria-label="Cancel upload">
                                      <Glyph name="close" size={12} />
                                    </button>
                                  </div>
                                ) : null}

                                {captioned.rich ?
                                  <RichMessage blocks={captioned.rich} onmention={openMention} ontag={openTag} ondate={copyDate} /> :
                                captioned.parts.length ?
                                  <FormattedText parts={captioned.parts} onmention={openMention} onlink={openLink} ontag={openTag} ondate={copyDate} /> :
                                null}

                                {/* Translation and transcript sit under the message they
                                     belong to. Both are asked for from the message menu. */}
                                {translations.value.has(message.mid) ? (
                                  <p class="message-translation">{translations.value.get(message.mid)}</p>
                                ) : transcripts.value.has(message.mid) ? (
                                  <p class="message-translation">{transcripts.value.get(message.mid)}</p>
                                ) : busyMids.value.has(message.mid) ? (
                                  <p class="message-translation pending">…</p>
                                ) : null}

                                {message.webpage ? (
                                  <a
                                    class="webpage"
                                    href={message.webpage.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => {
                                      if(openLink(message.webpage!.url)) e.preventDefault();
                                    }}
                                  >
                                    {message.webpage.siteName ? (
                                      <span class="site">{message.webpage.siteName}</span>
                                    ) : null}
                                    {message.webpage.title ? (
                                      <span class="wp-title">{message.webpage.title}</span>
                                    ) : null}
                                    {message.webpage.description ? (
                                      <span class="wp-desc">{message.webpage.description}</span>
                                    ) : null}
                                  </a>
                                ) : null}

                                {message.poll ? (
                                  <div class="poll">
                                    <span class="poll-q">{message.poll.question}</span>
                                    {message.poll.answers.map((answer, answerIndex) => (
                                      <button
                                        key={answerIndex}
                                        class={['poll-a', answer.chosen && 'chosen'].filter(Boolean).join(' ')}
                                        disabled={message.poll.closed}
                                        onClick={() => vote(message, answerIndex)}
                                      >
                                        <span class="poll-bar" style={{width: `${answer.percent}%`}}></span>
                                        <span class="poll-text">{answer.text}</span>
                                        <span class="poll-pct">{answer.percent}%</span>
                                      </button>
                                    ))}
                                    <span class="poll-total">
                                      {message.poll.totalVoters} voters{message.poll.closed ? ' · closed' : ''}
                                    </span>
                                    {message.poll.totalVoters ? (
                                      <button
                                        class="poll-results-btn"
                                        onClick={() => (pollResults.value = {mid: message.mid, poll: message.poll!})}
                                      >View results</button>
                                    ) : null}
                                  </div>
                                ) : null}

                                {/* Invoices render through InvoiceBubble above, which carries the
                                     cover photo; everything else that costs money lands here. */}
                                {message.payment && message.payment.kind !== 'invoice' && activePeerId.value !== null ? (
                                  <MessagePayment
                                    peerId={activePeerId.value}
                                    mid={message.mid}
                                    payment={message.payment}
                                    onboost={() => (boostPeerId.value = activePeerId.value)}
                                  />
                                ) : null}

                                {message.buttons.length ? (
                                  <InlineKeyboard
                                    buttons={message.buttons}
                                    busyKey={callbackBusyKey.value}
                                    onpress={(button) => pressButton(message, button)}
                                  />
                                ) : null}

                                {!message.service && activePeerId.value !== null ? (
                                  <ReactionBar
                                    peerId={activePeerId.value}
                                    mid={message.mid}
                                    count={message.reactions.length}
                                    revision={reactionRevisions.value[message.mid] ?? 0}
                                    onopenstars={() => (starReactionFor.value = message.mid)}
                                    onerror={(text) => (error.value = text)}
                                  />
                                ) : null}

                                {readByFor.value?.mid === message.mid ? (
                                  <span class="read-by">
                                    {readByFor.value.names.length
                                      ? `Read by ${readByFor.value.names.slice(0, 8).join(', ')}${readByFor.value.names.length > 8 ? ` +${readByFor.value.names.length - 8}` : ''}`
                                      : 'Read receipts are not available for this chat'}
                                  </span>
                                ) : null}

                                {activeIsChannel.value && threadKind.value !== 'comments' ? (
                                  /* Channel posts get the full comments bar with the newest
                                       commenters' faces, the way the official clients show it. */
                                  <CommentsButton
                                    count={message.repliesCount}
                                    commenters={message.commenters}
                                    onopen={() => openComments(message)}
                                  />
                                ) : null}

                                <span class="stamp">
                                  {message.repliesCount && !activeIsChannel.value ? (
                                    <button class="reply-btn" onClick={() => openComments(message)}>
                                      {message.repliesCount} 💬
                                    </button>
                                  ) : null}
                                  <button class="reply-btn" onClick={() => replyToMessage(message)}>Reply</button>
                                  <button class="reply-btn" onClick={() => openForward(message)}>Forward</button>
                                  {message.text ? (
                                    <button class="reply-btn" onClick={() => copyText(message)}>Copy</button>
                                  ) : null}
                                  {message.editable ? (
                                    <button class="reply-btn" onClick={() => startEdit(message)}>Edit</button>
                                  ) : null}
                                  {message.editable ? (
                                    <button class="reply-btn" onClick={() => removeMessage(message)}>Delete</button>
                                  ) : null}
                                  {message.edited ? <span class="edited">edited</span> : null}
                                  <span class="time">{timeOf(message.date)}</span>
                                  {message.out && activeIsChannel.value && message.views ? (
                                    <span class="views" title="Views">👁 {message.views.toLocaleString()}</span>
                                  ) : message.out && !activeIsSelf.value && !activeIsChannel.value ? (
                                    <button
                                      class={['ticks', message.mid <= readOutboxMaxId.value && 'read'].filter(Boolean).join(' ')}
                                      onClick={() => showReadBy(message)}
                                      title={message.pending
                                        ? 'Sending'
                                        : message.mid <= readOutboxMaxId.value
                                          ? 'Read'
                                          : 'Delivered'}
                                    >{message.pending ? '🕗' : message.mid <= readOutboxMaxId.value ? '✓✓' : '✓'}</button>
                                  ) : null}
                                </span>
                              </div>
                            </div>
                          )}
                        </Fragment>
                      );
                    })}

                    {sponsored.value ? (
                      <div class="sponsored" ref={sponsoredEl}>
                        <span class="sponsored-label">
                          {sponsored.value.recommended ? 'Recommended' : 'Sponsored'}
                        </span>
                        {sponsored.value.title ? (
                          <span class="sponsored-title">{sponsored.value.title}</span>
                        ) : null}
                        <span class="sponsored-text">{sponsored.value.text}</span>
                        {sponsored.value.sponsorInfo || sponsored.value.additionalInfo ? (
                          <span class="sponsored-info">
                            {[sponsored.value.sponsorInfo, sponsored.value.additionalInfo].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                        <button class="sponsored-btn" onClick={() => openSponsored(sponsored.value!)}>
                          {sponsored.value.buttonText}
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {!atBottom.value ? (
                <button class="to-bottom" onClick={jumpToLatest} aria-label="Scroll to latest">
                  <Glyph name="down" />
                </button>
              ) : null}

              {inlineSwitch.value?.switchWebView ? (
                <div class="inline-switch">
                  <button onClick={openInlineWebApp}>{inlineSwitch.value.switchWebView.text}</button>
                </div>
              ) : null}

              {inlineResults.value.length ? (
                <div class={['inline-results', inlineIsGallery && 'is-gallery'].filter(Boolean).join(' ')}>
                  {inlineResults.value.map((result) => (
                    <button
                      key={result.queryAndResultId}
                      class={inlineIsGallery ? 'gallery-item' : ''}
                      onClick={() => pickInline(result)}
                      title={result.title || result.description}
                    >
                      <InlinePreview result={result} size={inlineIsGallery ? 80 : 44} isGrid={inlineIsGallery} />
                      {!inlineIsGallery ? (
                        <div class="inline-text">
                          <span class="inline-title">{result.title}</span>
                          {result.description ? (
                            <span class="inline-desc">{result.description}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Exactly one suggestion strip is live at a time: the bot/mention/hashtag
                   strip owns the composer keys while it is open, so the sticker strip
                   stands down rather than fighting it for Enter and Tab. */}
              {!editing.value && !suggestKind.value ? (
                <StickerSuggest
                  draft={draft.value}
                  onpick={(docId) => {
                    draft.value = '';
                    pickDocument(docId);
                  }}
                />
              ) : null}

              {replyTo.value || editing.value ? (
                <div class="reply-bar">
                  <span class="reply-quote">
                    <span class="reply-title">
                      {editing.value ?
                        'Editing message' :
                        <>
                          {activeReplyContext.value?.quote ? 'Quoting' : 'Replying to'}{' '}
                          {replyTo.value?.fromTitle}
                          {activeReplyContext.value?.chatTitle ? (
                            /* The original is in another chat; say which one. */
                            <span class="reply-in">in {activeReplyContext.value.chatTitle}</span>
                          ) : null}
                        </>
                      }
                    </span>
                    <span class="reply-text">
                      {activeReplyContext.value?.quote?.text || (editing.value ?? replyTo.value)?.text || 'Media'}
                    </span>
                  </span>
                  {activeReplyContext.value?.quote ? (
                    <button class="cancel" onClick={dropQuote} title="Reply without the quote">❝✕</button>
                  ) : null}
                  <button
                    class="cancel"
                    onClick={() => (editing.value ? cancelEdit() : cancelReply())}
                    aria-label="Cancel"
                  >✕</button>
                </div>
              ) : null}

              {suggestKind.value && suggestItems.value.length ? (
                <Suggestions
                  items={suggestItems.value}
                  active={suggestIndex.value}
                  label={suggestKind.value === 'command' ? 'Bot commands' : suggestKind.value === 'mention' ? 'Members' : 'Hashtags'}
                  onpick={applySuggestion}
                />
              ) : null}

              {botState.value?.isBot ? (
                <BotBar
                  bot={botState.value}
                  busy={botBusy.value}
                  onstart={startBotChat}
                  onstop={stopBotChat}
                  onrestart={startBotChat}
                  onclear={clearBotChat}
                />
              ) : null}

              {activeLeft.value ? (
                /* A chat we are not a member of: readable, but read-only until we
                     join — so the composer is replaced rather than disabled. */
                <div class="join-bar">
                  <span class="join-note">
                    {dialogs.value.find((d) => d.peerId === activePeerId.value)?.isBroadcast ?
                      'You are not subscribed to this channel' :
                      'You are not a member of this chat'}
                  </span>
                  <button class="join-action" disabled={joining.value} onClick={joinActiveChat}>
                    {joining.value ? 'Joining…' : 'Join'}
                  </button>
                </div>
              ) : replyKeyboardOpen.value && replyKeyboard.value?.kind === 'markup' ? (
                <ReplyKeyboard
                  keyboard={replyKeyboard.value}
                  onpress={pressReplyKeyboardButton}
                  onclose={() => (replyKeyboardOpen.value = false)}
                />
              ) : (
                <form onSubmit={submit}>
                  {showPicker.value ? (
                    <Picker
                      onemoji={(emoji) => (draft.value += emoji)}
                      ondocument={pickDocument}
                      oncustomemoji={(item) => {
                        draft.value += item.emoji;
                        pendingCustomEmoji.value = [...pendingCustomEmoji.value, item];
                      }}
                    />
                  ) : null}
                  {sendAsPickerOpen.value && activePeerId.value !== null ? (
                    <SendAsPicker
                      peerId={activePeerId.value}
                      current={sendAsPeerId.value}
                      onpick={(id) => (sendAsPeerId.value = id)}
                      onclose={() => (sendAsPickerOpen.value = false)}
                    />
                  ) : null}
                  {effectPickerOpen.value ? (
                    <EffectPicker
                      selected={sendEffect.value}
                      onpick={pickEffect}
                      onclose={() => (effectPickerOpen.value = false)}
                    />
                  ) : null}
                  {sendAsPeerId.value !== null ? (
                    <button
                      type="button"
                      class="attach send-as"
                      onClick={() => (sendAsPickerOpen.value = !sendAsPickerOpen.value)}
                      title="Send message as…"
                      aria-label="Send message as…"
                      disabled={!!editing.value}
                    ><Avatar peerId={sendAsPeerId.value} title="" size={22} /></button>
                  ) : null}
                  {replyKeyboard.value?.kind === 'markup' ? (
                    <button
                      type="button"
                      class="attach"
                      onClick={() => (replyKeyboardOpen.value = true)}
                      title="Show the bot keyboard"
                      aria-label="Show the bot keyboard"
                    >⌨</button>
                  ) : null}
                  {botState.value?.hasCommands ? (
                    <button
                      type="button"
                      class="attach bot-commands"
                      onClick={openCommandList}
                      title="Bot commands"
                      aria-label="Bot commands"
                    >/</button>
                  ) : null}
                  {botMenuButton.value ? (
                    <button
                      type="button"
                      class="attach bot-menu"
                      onClick={openBotMenuApp}
                      title={botMenuButton.value.text}
                      aria-label={botMenuButton.value.text}
                    ><Glyph name="app" size={20} /></button>
                  ) : null}
                  <button
                    type="button"
                    class="attach emoji"
                    onClick={() => (showPicker.value = !showPicker.value)}
                    aria-label="Emoji, stickers and GIFs"
                    disabled={!!editing.value}
                  ><Glyph name="emoji" size={20} /></button>
                  <div class="attach-wrap">
                    <button
                      type="button"
                      class="attach"
                      onClick={() => (attachMenu.value = !attachMenu.value)}
                      aria-label="Attach"
                      disabled={!!editing.value}
                    ><Glyph name="attach" size={20} /></button>
                    {attachMenu.value ? (
                      <div class="attach-menu">
                        <button type="button" onClick={() => { attachMenu.value = false; mediaInput.current?.click(); }}>Photo or video</button>
                        <button type="button" onClick={() => { attachMenu.value = false; fileInput.current?.click(); }}>File</button>
                        <button type="button" onClick={() => { attachMenu.value = false; locationSender.value = true; }}>Location</button>
                        <button type="button" onClick={openContactPicker}>Contact</button>
                        <button type="button" onClick={() => { attachMenu.value = false; pollComposer.value = true; }}>Poll</button>
                      </div>
                    ) : null}
                  </div>
                  <input
                    class="file"
                    type="file"
                    multiple
                    ref={fileInput}
                    onChange={(e) => attach((e.currentTarget as HTMLInputElement).files)}
                  />
                  {/* Same queue as the file input; only the picker's filter differs, and
                       each item still gets its own photo/file choice in the dialog. */}
                  <input
                    class="file"
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    ref={mediaInput}
                    onChange={(e) => attach((e.currentTarget as HTMLInputElement).files)}
                  />
                  <textarea
                    placeholder={replyKeyboard.value?.placeholder || 'Message'}
                    rows={1}
                    ref={setComposer}
                    value={draft.value}
                    onInput={(e) => {
                      draft.value = (e.target as HTMLTextAreaElement).value;
                      onDraftInput();
                    }}
                    onKeyDown={onComposerKey}
                    onClick={() => updateSuggestions()}
                  ></textarea>
                  <FormatBar textarea={composer.value} />
                  {!editing.value ? (
                    <button
                      type="button"
                      class={['attach', 'effect-button', !!sendEffect.value && 'armed'].filter(Boolean).join(' ')}
                      onClick={() => (effectPickerOpen.value = !effectPickerOpen.value)}
                      title={sendEffect.value ? 'Message effect armed' : 'Add a message effect'}
                      aria-label="Add a message effect"
                    >{sendEffectEmoticon.value || '✨'}</button>
                  ) : null}
                  {scheduledCount.value > 0 && !editing.value ? (
                    <button
                      type="button"
                      class="attach scheduled-button"
                      onClick={() => (scheduledOpen.value = true)}
                      title="Scheduled messages"
                      aria-label="Scheduled messages"
                    >🕑<span class="scheduled-count">{scheduledCount.value}</span></button>
                  ) : null}
                  {!draft.value.trim() && !editing.value && activePeerId.value !== null ? (
                    /* Empty composer: the send button gives way to the recorder, the
                         same swap the official clients do. */
                    <VoiceRecorder
                      peerId={activePeerId.value}
                      threadId={activeThreadId.value}
                      replyToMsgId={replyTo.value?.mid}
                      onsent={() => {
                        replyTo.value = null;
                        scrollToBottom();
                      }}
                      onerror={(message) => (error.value = message)}
                    />
                  ) : (
                    <button
                      type="submit"
                      class={['send-button', silentDefault.value && !editing.value && 'silent'].filter(Boolean).join(' ')}
                      disabled={(!draft.value.trim() && !editing.value?.media) || (!editing.value && slowModeLeft.value > 0)}
                      aria-label={editing.value ? 'Save' : 'Send'}
                      title={editing.value ?
                        'Save' :
                        slowModeLeft.value > 0 ?
                          `Slow mode — wait ${slowModeLabel(slowModeLeft.value)}` :
                          'Send. Right-click or hold for scheduled and silent send'}
                      onContextMenu={openSendOptions}
                      onPointerDown={onSendPointerDown}
                      onPointerUp={cancelSendHold}
                      onPointerLeave={cancelSendHold}
                    >
                      {!editing.value && slowModeLeft.value > 0 ? (
                        <span class="slowmode">{slowModeLabel(slowModeLeft.value)}</span>
                      ) : (
                        <Glyph name={editing.value ? 'check' : 'send'} />
                      )}
                    </button>
                  )}
                </form>
              )}

              {sendOptionsOpen.value && activePeerId.value !== null ? (
                <SendOptionsSheet
                  peerId={activePeerId.value}
                  isUser={activeIsUser.value}
                  defaultSilent={silentDefault.value}
                  onsend={(options) => {
                    sendOptionsOpen.value = false;
                    silentDefault.value = isSilentByDefault(activePeerId.value!);
                    deliver(options);
                  }}
                  onclose={() => (sendOptionsOpen.value = false)}
                />
              ) : null}

              {scheduledOpen.value && activePeerId.value !== null ? (
                <ScheduledMessages
                  peerId={activePeerId.value}
                  title={activeTitle.value}
                  onclose={() => (scheduledOpen.value = false)}
                />
              ) : null}

              <EffectOverlay peerId={activePeerId.value} />
            </>
          )}
        </section>

        {showSettings.value ? (
          <Settings
            onclose={() => (showSettings.value = false)}
            onminiapp={(botId) => {
              miniApp.value = {botId, peerId: activePeerId.value ?? botId, fromAttachMenu: true};
              showSettings.value = false;
            }}
          />
        ) : null}

        {showAccounts.value ? (
          <AccountSwitcher onclose={() => (showAccounts.value = false)} />
        ) : null}

        {linkSheet.value ? (
          <LinkSheet
            action={linkSheet.value}
            onclose={() => (linkSheet.value = null)}
            onopenpeer={openPeerChat}
          />
        ) : null}

        {profilePeerId.value !== null ? (
          <ChatInfo
            peerId={profilePeerId.value}
            onclose={() => (profilePeerId.value = null)}
            onmessage={openPeerChat}
            onpeer={(id) => (profilePeerId.value = id)}
          />
        ) : showInfo.value && activePeerId.value !== null ? (
          <ChatInfo
            peerId={activePeerId.value}
            onclose={() => (showInfo.value = false)}
            onpeer={(id) => (profilePeerId.value = id)}
            onmigrated={openPeerChat}
            onjump={(mid) => { showInfo.value = false; jumpTo(mid); }}
          />
        ) : null}
      </div>

      {lightboxIndex.value !== null && activePeerId.value !== null ? (
        <Lightbox
          peerId={activePeerId.value}
          items={mediaMessages.value}
          index={lightboxIndex.value}
          threadId={activeThreadId.value}
          onclose={() => (lightboxIndex.value = null)}
          onforward={openForward}
          onjump={jumpTo}
          onIndexChange={(index) => (lightboxIndex.value = index)}
        />
      ) : null}

      <AudioPlayerBar />


      {pendingFiles.value.length ? (
        /* Keyed on the batch: the dialog seeds its per-item choices once, so a new
             batch has to arrive as a new component rather than a stale one. */
        <SendFiles
          key={batchKey(pendingFiles.value)}
          files={pendingFiles.value}
          progress={uploadProgress.value}
          onsend={confirmSend}
          oncancelupload={cancelUpload}
          onclose={() => (pendingFiles.value = [])}
        />
      ) : null}

      {miniApp.value ? (
        <MiniApp
          request={miniApp.value}
          onclose={() => (miniApp.value = null)}
          onlink={openLink}
          onswitchinline={async (query) => {
            draft.value = `@${await botUsername(miniApp.value?.botId ?? 0)} ${query}`.trimEnd();
            onDraftInput();
            composer.value?.focus();
          }}
        />
      ) : null}

      {reactionPickerFor.value && activePeerId.value !== null ? (
        <ReactionPicker
          peerId={activePeerId.value}
          mid={reactionPickerFor.value.mid}
          x={reactionPickerFor.value.x}
          y={reactionPickerFor.value.y}
          onpick={pickReaction}
          onpaid={() => {
            starReactionFor.value = reactionPickerFor.value?.mid ?? null;
            reactionPickerFor.value = null;
          }}
          onclose={() => (reactionPickerFor.value = null)}
        />
      ) : null}

      {starReactionFor.value !== null && activePeerId.value !== null ? (
        <StarReactionSheet
          peerId={activePeerId.value}
          mid={starReactionFor.value}
          onsent={() => bumpReaction(starReactionFor.value!)}
          onclose={() => (starReactionFor.value = null)}
        />
      ) : null}

      {linkPrompt.value ? (
        <div class="reactors-backdrop" onClick={() => (linkPrompt.value = null)} role="presentation">
          <div
            class="reactors-dialog bot-prompt"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Bot request"
          >
            <p class="bot-prompt-text">{linkPrompt.value.text}</p>
            <div class="bot-prompt-actions">
              <button class="bot-prompt-cancel" onClick={() => (linkPrompt.value = null)}>Cancel</button>
              <button
                class="bot-prompt-ok"
                onClick={() => {
                  const prompt = linkPrompt.value;
                  linkPrompt.value = null;
                  prompt?.onconfirm();
                }}
              >{linkPrompt.value.confirm}</button>
            </div>
          </div>
        </div>
      ) : null}

      {messageMenu.value ? (
        <>
          <div class="menu-backdrop" onClick={() => (messageMenu.value = null)} role="presentation"></div>
          <div class="context-menu" style={menuPosition(messageMenu.value)}>
            {menuMessage ? (
              <>
                <button onClick={() => { replyToMessage(menuMessage); messageMenu.value = null; }}>
                  {trackedQuote(menuMessage.mid) ? 'Reply with quote' : 'Reply'}
                </button>
                <button onClick={() => { openReplyElsewhere(menuMessage); messageMenu.value = null; }}>
                  Reply in…
                </button>
                {!menuMessage.service ? (
                  <button
                    onClick={() => openReactionPicker(menuMessage.mid, messageMenu.value!.x, messageMenu.value!.y)}
                  >React…</button>
                ) : null}
                {menuMessage.text ? (
                  <button onClick={() => { copyText(menuMessage); messageMenu.value = null; }}>Copy text</button>
                ) : null}
                {canCopyLink(menuMessage) ? (
                  <button onClick={() => { copyMessageLink(menuMessage); messageMenu.value = null; }}>Copy Message Link</button>
                ) : null}
                {/* Translation and transcription are Premium on Telegram's side; a
                     free account gets the server's refusal, which the error bar
                     shows, rather than a control that always fails silently. */}
                {menuMessage.text && !menuMessage.service ? (
                  <button onClick={() => { translateOne(menuMessage); messageMenu.value = null; }}>Translate</button>
                ) : null}
                {menuMessage.media?.kind === 'voice' || menuMessage.media?.kind === 'round' ? (
                  <button onClick={() => { transcribeOne(menuMessage); messageMenu.value = null; }}>Transcribe</button>
                ) : null}
                <button onClick={() => { openForward(menuMessage); messageMenu.value = null; }}>Forward</button>
                {menuMessage.stickerDocId ? (
                  <button
                    onClick={() => { packSheet.value = {setKey: '', docId: menuMessage.stickerDocId}; messageMenu.value = null; }}
                  >View pack</button>
                ) : null}
                {menuMessage.media?.kind === 'gif' && menuMessage.media.docId ? (
                  <GifSaveAction docId={menuMessage.media.docId} ondone={() => (messageMenu.value = null)} />
                ) : null}
                <button onClick={() => startSelecting(menuMessage.mid)}>Select</button>
                {/* Pin is offered where the right is ours, and never for a service
                     message — the pinned plate tracks messages, not join notices. */}
                {canPinHere.value && !menuMessage.service ? (
                  <button onClick={() => { toggleMessagePin(menuMessage); messageMenu.value = null; }}>
                    {menuMessage.pinned ? 'Unpin' : 'Pin'}
                  </button>
                ) : null}
                {/* Editing a media message means editing its caption, which the
                     composer already carries — so a message with media but no text
                     is editable too. The gate is the server's own rule, not our
                     `editable` flag. */}
                {canEditHere.value ? (
                  <button onClick={() => { startEdit(menuMessage); messageMenu.value = null; }}>Edit</button>
                ) : null}
                {menuMessage.editable ? (
                  <button class="danger" onClick={() => { removeMessage(menuMessage); messageMenu.value = null; }}>Delete</button>
                ) : null}
                {/* The other half of Delete: this side only. A supergroup or a
                     channel cannot express it, so it is not offered there. */}
                {canDeleteLocally() ? (
                  <button onClick={() => { removeMessageLocally(menuMessage); messageMenu.value = null; }}>Delete for me</button>
                ) : null}
                {canReportMessage(menuMessage) ? (
                  <button onClick={() => { startMessageReport(menuMessage); messageMenu.value = null; }}>Report</button>
                ) : null}
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {packSheet.value ? (
        <StickerSetSheet
          setKey={packSheet.value.setKey}
          docId={packSheet.value.docId}
          onsend={pickDocument}
          onclose={() => (packSheet.value = null)}
        />
      ) : null}

      {forwarding.value.length ? (
        <ForwardSheet
          dialogs={allDialogs.value}
          count={forwarding.value.length}
          hasCaptions={forwarding.value.some((m) => m.media && m.text)}
          onforward={doForward}
          onclose={() => (forwarding.value = [])}
        />
      ) : null}

      {replyingElsewhere.value ? (
        <PeerPicker
          title="Reply in…"
          dialogs={allDialogs.value}
          onpick={doReplyElsewhere}
          onclose={() => (replyingElsewhere.value = null)}
        />
      ) : null}

      {contactPicking.value ? (
        <PeerPicker
          title="Share a contact"
          dialogs={allDialogs.value.filter((dialog) => dialog.isUser)}
          onpick={shareContact}
          onclose={() => (contactPicking.value = false)}
        />
      ) : null}

      {locationSender.value && activePeerId.value !== null ? (
        <LocationSender
          peerId={activePeerId.value}
          threadId={activeThreadId.value}
          replyToMsgId={replyTo.value?.mid}
          onclose={() => { locationSender.value = false; replyTo.value = null; }}
          onerror={(text) => (error.value = text)}
        />
      ) : null}

      {pollComposer.value && activePeerId.value !== null ? (
        <PollComposer
          peerId={activePeerId.value}
          threadId={activeThreadId.value}
          replyToMsgId={replyTo.value?.mid}
          onclose={() => { pollComposer.value = false; replyTo.value = null; }}
          onerror={(text) => (error.value = text)}
        />
      ) : null}

      {pollResults.value && activePeerId.value !== null ? (
        <PollResults
          peerId={activePeerId.value}
          mid={pollResults.value.mid}
          poll={pollResults.value.poll}
          onclose={() => (pollResults.value = null)}
          onpeer={(id) => { pollResults.value = null; profilePeerId.value = id; }}
        />
      ) : null}

      {newChatOpen.value ? (
        <NewChat
          dialogs={allDialogs.value}
          onclose={() => (newChatOpen.value = false)}
          oncreated={onChatCreated}
        />
      ) : null}

      {boostPeerId.value !== null ? (
        <BoostPanel
          peerId={boostPeerId.value}
          title={activeTitle.value}
          canCreateGiveaway={activeIsChannel.value}
          onclose={() => (boostPeerId.value = null)}
        />
      ) : null}

      {folderEditorOpen.value ? (
        <FolderEditor
          folder={editingFolder.value}
          dialogs={allDialogs.value}
          onclose={() => (folderEditorOpen.value = false)}
          onsaved={onFolderSaved}
        />
      ) : null}

      {topicEditor.value && activePeerId.value !== null ? (
        <TopicEditor
          peerId={activePeerId.value}
          topic={topicEditor.value.topic}
          onclose={() => (topicEditor.value = null)}
          onsaved={onTopicSaved}
        />
      ) : null}

      {reportState.value ? (
        /* The report flow: the server's own option list, then its comment step. */
        <div class="reactors-backdrop" onClick={cancelReport} role="presentation">
          <div
            class="reactors-dialog bot-prompt"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Report"
          >
            <p class="bot-prompt-text">{reportState.value.step.title}</p>
            {reportState.value.step.kind === 'choose' ? (
              <div class="report-options">
                {reportState.value.step.options.map((option) => (
                  <button key={option.id} disabled={reportBusy.value} onClick={() => chooseReportOption(option.id)}>
                    {option.text}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <input
                  class="report-comment"
                  maxlength={512}
                  placeholder={reportState.value.step.commentOptional ? 'Add Comment (Optional)' : 'Add Comment'}
                  value={reportComment.value}
                  onInput={(e) => (reportComment.value = (e.target as HTMLInputElement).value)}
                />
                <div class="bot-prompt-actions">
                  <button class="bot-prompt-cancel" onClick={cancelReport}>Cancel</button>
                  <button class="bot-prompt-ok" disabled={reportBusy.value} onClick={sendReportComment}>
                    {reportBusy.value ? 'Sending…' : 'Send Report'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {error.value ? (
        <button class="error" onClick={() => (error.value = '')} title="Dismiss">{error.value}</button>
      ) : null}

      {/* A confirmation for what has no visible effect — copying a link, mostly.
           `error` is red and reads as a failure, so this is its own line. */}
      {notice.value ? (
        <button class="chat-notice" onClick={() => (notice.value = '')} title="Dismiss">{notice.value}</button>
      ) : null}
    </>
  );
}
