import {bootTelegram} from './client';
import {peerRestrictionText, restrictionTextOf} from './restrictions';
import type {MessageEntity} from '@layer';

/**
 * Data layer between tweb's worker-side managers and the Svelte UI.
 *
 * Hard rule: every value returned from here is plain and structured-cloneable
 * (primitives, arrays and object literals of primitives). Raw MTProto objects
 * stay in the module-level caches below and never enter Svelte state, because a
 * `$state` proxy cannot be posted back to the worker — postMessage throws
 * DataCloneError and the request is silently dropped.
 */

export type DialogItem = {
  peerId: number;
  title: string;
  preview: string;
  date: number;
  unread: number;
  isSelf: boolean;
  isUser: boolean;
  /** Broadcast channel — posts carry view counts, not delivery ticks. */
  isBroadcast: boolean;
  isForum: boolean;
  pinned: boolean;
  muted: boolean;
  /** Highest message id the user has read — the "jump here on open" anchor. */
  readMaxId: number;
  /** Highest outgoing message the *other* side has read — drives read ticks. */
  readOutboxMaxId: number;
  /**
   * The server's wording for why this peer is restricted on this platform, ''
   * when it is not. Its content must not be rendered while this is set.
   */
  restrictionText: string;
};

export type TopicItem = {
  threadId: number;
  title: string;
  preview: string;
  date: number;
  unread: number;
};

export type MediaItem = {
  kind: 'photo' | 'video' | 'gif' | 'sticker' | 'voice' | 'audio' | 'file';
  /** Renderable thumbnail/full URL, resolved lazily via `loadMediaUrl`. */
  width: number;
  height: number;
  name: string;
  size: number;
  duration: number;
  /**
   * Self-destructing media (`ttl_seconds`) or a one-time voice/video note. The
   * UI must never render it as ordinary media: keeping a copy on screen after
   * it expires would interfere with a basic Telegram feature, which the API
   * terms forbid.
   */
  selfDestruct: boolean;
  /**
   * The server still counts this media as unheard/unwatched. Playing it has to
   * report `readMessageContents` back, the same as the official clients — the
   * sender is entitled to that receipt.
   */
  unread: boolean;
};

export type ReplyPreview = {
  mid: number;
  title: string;
  text: string;
};

export type TextPart = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  pre?: boolean;
  spoiler?: boolean;
  blockquote?: boolean;
  url?: string;
  mention?: string;
  /**
   * What the mention points at: a public @username, a specific user id (used
   * when someone without a username is tagged), or a hashtag / bot command,
   * which are searchable rather than clickable to a profile.
   */
  mentionKind?: 'username' | 'userId' | 'tag';
};

export type RichBlock =
  | {type: 'paragraph'; parts: TextPart[]}
  | {type: 'heading'; level: number; parts: TextPart[]}
  | {type: 'code'; text: string}
  | {type: 'quote'; parts: TextPart[]}
  | {type: 'divider'}
  | {type: 'list'; ordered: boolean; items: TextPart[][]}
  | {type: 'table'; title: TextPart[]; rows: {header: boolean; cells: TextPart[][]}[]};

export type MessageItem = {
  mid: number;
  text: string;
  /** Text split into formatted runs from the message's MTProto entities. */
  parts: TextPart[];
  editable: boolean;
  edited: boolean;
  out: boolean;
  date: number;
  fromTitle: string;
  fromId: number;
  service: boolean;
  media: MediaItem | null;
  reply: ReplyPreview | null;
  /** Comment thread (discussion) attached to this message, if any. */
  repliesCount: number;
  reactions: ReactionItem[];
  /** Album id — consecutive messages sharing one render as a single bubble. */
  groupedId: string;
  /** Sticker document id, when the media is a sticker. */
  stickerDocId: string;
  /** '' when not a sticker; 'animated' means .tgs and needs the Lottie worker. */
  stickerKind: '' | 'static' | 'video' | 'animated';
  /** True until the server has acknowledged the message. */
  pending: boolean;
  /** Channel posts carry a view count instead of delivery ticks. */
  views: number;
  /** Original author when the message was forwarded, '' otherwise. */
  forwardedFrom: string;
  webpage: WebPagePreview | null;
  poll: PollPreview | null;
  /**
   * Structured body for messages that carry one. Newer messages can arrive as
   * `rich_message` blocks — headings, tables, lists — with `message` empty.
   * Flattening those to text loses the structure, so they are kept as blocks.
   */
  rich: RichBlock[] | null;
  /** Bot keyboard attached to the message — rows of buttons, empty when none. */
  buttons: MessageButton[][];
  /**
   * Why the server restricts this message on this platform, '' when it does
   * not. Set means the body and media must stay hidden behind the reason.
   */
  restrictionText: string;
};

/** A single button from a message's `reply_markup`. */
export type MessageButton = {
  row: number;
  column: number;
  kind: 'url' | 'callback' | 'webview' | 'simpleWebView' | 'switchInline' | 'text' | 'copy' | 'unsupported';
  text: string;
  /** Web-app and link buttons carry their own URL. */
  url: string;
  /** `switchInline` query, `copy` payload. */
  payload: string;
  samePeer: boolean;
};

export type WebPagePreview = {
  url: string;
  siteName: string;
  title: string;
  description: string;
};

export type PollPreview = {
  question: string;
  closed: boolean;
  quiz: boolean;
  totalVoters: number;
  answers: {text: string; voters: number; chosen: boolean; percent: number}[];
};

/* ------------------------------------------------------------------ */
/* Raw caches — deliberately outside Svelte reactivity                 */
/* ------------------------------------------------------------------ */

const rawMessages = new Map<string, any>();
const rawPeers = new Map<number, any>();
const avatarUrls = new Map<number, string | null>();
const mediaUrls = new Map<string, string | null>();

const messageKey = (peerId: number, mid: number) => `${peerId}_${mid}`;

let selfIdCache: number | null = null;

async function getSelfId(): Promise<number> {
  if(selfIdCache !== null) return selfIdCache;
  const {managers} = await bootTelegram();
  const self = await managers.appUsersManager.getSelf();
  return (selfIdCache = Number(self?.id ?? 0));
}

async function getPeer(peerId: number): Promise<any> {
  const cached = rawPeers.get(peerId);
  if(cached) return cached;

  const {managers} = await bootTelegram();
  const peer = await managers.appPeersManager.getPeer(peerId);
  rawPeers.set(peerId, peer);
  return peer;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * Chats whose history is split into topics. Besides forum supergroups, a bot
 * DM can be organised the same way (pFlags.bot_forum_view) — tweb's topic APIs
 * treat both identically, and without this the bot's topics are invisible and
 * its messages unreachable.
 */
function isTopicChat(peer: any): boolean {
  return !!peer?.pFlags?.forum || !!peer?.pFlags?.bot_forum_view;
}

function peerTitle(peer: any, selfId: number): string {
  if(!peer) return 'Unknown';
  if(peer._ === 'user' && Number(peer.id) === selfId) return 'Saved Messages';
  if(peer._ === 'user') {
    const name = [peer.first_name, peer.last_name].filter(Boolean).join(' ').trim();
    return name || peer.username || (peer.pFlags?.deleted ? 'Deleted Account' : 'User');
  }
  return peer.title || 'Chat';
}

function mediaOf(message: any): MediaItem | null {
  const media = message?.media;
  if(!media) return null;

  if(media._ === 'messageMediaPhoto' && media.photo) {
    const biggest = largestPhotoSize(media.photo);
    return {
      kind: 'photo',
      width: biggest?.w ?? 0,
      height: biggest?.h ?? 0,
      name: '',
      size: media.photo.size ?? 0,
      duration: 0,
      selfDestruct: !!media.ttl_seconds,
      unread: !!message.pFlags?.media_unread
    };
  }

  if(media._ === 'messageMediaDocument' && media.document) {
    const document = media.document;
    const attributes: any[] = document.attributes ?? [];
    const video = attributes.find((a) => a._ === 'documentAttributeVideo');
    const audio = attributes.find((a) => a._ === 'documentAttributeAudio');
    const sticker = attributes.find((a) => a._ === 'documentAttributeSticker');
    const filename = attributes.find((a) => a._ === 'documentAttributeFilename');
    const size = attributes.find((a) => a._ === 'documentAttributeImageSize') ?? video;

    // GIFs arrive as silent looping mp4s tagged with documentAttributeAnimated;
    // they autoplay rather than showing a poster with a play badge.
    const animated = attributes.find((a) => a._ === 'documentAttributeAnimated');

    const kind: MediaItem['kind'] = sticker ? 'sticker' :
      animated || document.type === 'gif' ? 'gif' :
      video ? 'video' :
      audio ? (audio.pFlags?.voice ? 'voice' : 'audio') :
      document.mime_type?.startsWith('image/') ? 'photo' :
      'file';

    return {
      kind,
      width: size?.w ?? 0,
      height: size?.h ?? 0,
      name: filename?.file_name ?? '',
      size: document.size ?? 0,
      duration: video?.duration ?? audio?.duration ?? 0,
      // A one-time voice message or video note carries the same flag as a
      // self-destructing photo, plus `round_message` / `voice` once-flags.
      selfDestruct: !!media.ttl_seconds,
      unread: !!message.pFlags?.media_unread
    };
  }

  return null;
}

/**
 * Flattens MTProto message entities into non-overlapping runs.
 *
 * Entities are given as (offset, length) over UTF-16 code units and may nest
 * (bold inside a link, spoiler over italic). Collecting the formatting active
 * at each boundary avoids building a DOM tree and keeps the result plain data.
 */
function textParts(text: string, entities: any[] = []): TextPart[] {
  if(!text) return [];
  if(!entities.length) return [{text}];

  const boundaries = new Set<number>([0, text.length]);
  for(const entity of entities) {
    boundaries.add(entity.offset);
    boundaries.add(entity.offset + entity.length);
  }

  const points = [...boundaries].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
  const parts: TextPart[] = [];

  for(let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if(start === end) continue;

    const part: TextPart = {text: text.slice(start, end)};

    for(const entity of entities) {
      if(entity.offset > start || entity.offset + entity.length < end) continue;

      switch(entity._) {
        case 'messageEntityBold': part.bold = true; break;
        case 'messageEntityItalic': part.italic = true; break;
        case 'messageEntityUnderline': part.underline = true; break;
        case 'messageEntityStrike': part.strike = true; break;
        case 'messageEntityCode': part.code = true; break;
        case 'messageEntityPre': part.pre = true; break;
        case 'messageEntitySpoiler': part.spoiler = true; break;
        case 'messageEntityBlockquote': part.blockquote = true; break;
        case 'messageEntityTextUrl': part.url = entity.url; break;
        case 'messageEntityUrl': part.url = part.text; break;
        case 'messageEntityEmail': part.url = `mailto:${part.text}`; break;
        case 'messageEntityMention':
          part.mention = part.text.replace(/^@/, '');
          part.mentionKind = 'username';
          break;
        case 'messageEntityMentionName':
          part.mention = String(entity.user_id);
          part.mentionKind = 'userId';
          break;
        case 'messageEntityHashtag':
        case 'messageEntityCashtag':
        case 'messageEntityBotCommand':
          part.mention = part.text;
          part.mentionKind = 'tag';
          break;
      }
    }

    parts.push(part);
  }

  return parts;
}

function largestPhotoSize(photo: any): any {
  const sizes: any[] = (photo?.sizes ?? []).filter((s: any) => s.w && s.h);
  return sizes[sizes.length - 1];
}


/* ------------------------------------------------------------------ */
/* Rich messages (structured page blocks)                              */
/* ------------------------------------------------------------------ */

/** RichText is a nested tree; flatten it into our formatted runs. */
function richTextToParts(rich: any, inherited: TextPart = {text: ''}): TextPart[] {
  if(!rich) return [];

  const withFlag = (flag: keyof TextPart, value: any = true): TextPart =>
    ({...inherited, [flag]: value} as TextPart);

  switch(rich._) {
    case 'textEmpty': return [];
    case 'textPlain': return rich.text ? [{...inherited, text: rich.text}] : [];
    case 'textConcat':
      return (rich.texts ?? []).flatMap((child: any) => richTextToParts(child, inherited));
    case 'textBold': return richTextToParts(rich.text, withFlag('bold'));
    case 'textItalic': return richTextToParts(rich.text, withFlag('italic'));
    case 'textUnderline': return richTextToParts(rich.text, withFlag('underline'));
    case 'textStrike': return richTextToParts(rich.text, withFlag('strike'));
    case 'textFixed': return richTextToParts(rich.text, withFlag('code'));
    case 'textUrl': return richTextToParts(rich.text, withFlag('url', rich.url));
    case 'textEmail': return richTextToParts(rich.text, withFlag('url', `mailto:${rich.email}`));
    case 'textAnchor': return richTextToParts(rich.text, inherited);
    case 'textSubscript':
    case 'textSuperscript':
    case 'textMarked':
    case 'textPhone':
    case 'textImage':
      return richTextToParts(rich.text, inherited);
    default:
      return rich.text ? richTextToParts(rich.text, inherited) : [];
  }
}

const HEADING_BLOCKS: Record<string, number> = {
  pageBlockTitle: 1,
  pageBlockHeader: 1,
  pageBlockSubtitle: 2,
  pageBlockSubheader: 2,
  pageBlockHeading3: 3,
  pageBlockHeading4: 4
};

function richBlocksOf(message: any): RichBlock[] | null {
  const blocks: any[] = message?.rich_message?.blocks;
  if(!blocks?.length) return null;

  const out: RichBlock[] = [];

  for(const block of blocks) {
    const level = HEADING_BLOCKS[block._];
    if(level) {
      out.push({type: 'heading', level, parts: richTextToParts(block.text)});
      continue;
    }

    switch(block._) {
      case 'pageBlockParagraph':
        out.push({type: 'paragraph', parts: richTextToParts(block.text)});
        break;

      case 'pageBlockPreformatted':
        out.push({type: 'code', text: partsToText(richTextToParts(block.text))});
        break;

      case 'pageBlockBlockquote':
      case 'pageBlockPullquote':
        out.push({type: 'quote', parts: richTextToParts(block.text)});
        break;

      case 'pageBlockDivider':
        out.push({type: 'divider'});
        break;

      case 'pageBlockList':
      case 'pageBlockOrderedList': {
        const items = (block.items ?? []).map((item: any) =>
          richTextToParts(item.text ?? item.blocks?.[0]?.text ?? item)
        );
        out.push({type: 'list', ordered: block._ === 'pageBlockOrderedList', items});
        break;
      }

      case 'pageBlockTable': {
        const rows = (block.rows ?? []).map((row: any) => ({
          header: (row.cells ?? []).some((cell: any) => !!cell.pFlags?.header),
          cells: (row.cells ?? []).map((cell: any) => richTextToParts(cell.text))
        }));
        out.push({type: 'table', title: richTextToParts(block.title), rows});
        break;
      }

      default:
        if(block.text) out.push({type: 'paragraph', parts: richTextToParts(block.text)});
        break;
    }
  }

  return out.length ? out : null;
}

function partsToText(parts: TextPart[]): string {
  return parts.map((part) => part.text).join('');
}

/**
 * Newer messages can carry their body as a structured `rich_message` (blocks)
 * with `message` left empty — which is why some bot replies looked blank here
 * while every other client showed them. tweb can flatten those blocks back
 * into text plus entities.
 */
async function richBody(message: any): Promise<{text: string; entities: any[]} | null> {
  if(!message?.rich_message) return null;

  try {
    const {flattenRichMessageSummary} = await import('@lib/richMessage');
    // maxLength 0 disables truncation — we want the whole message, not a summary.
    const summary: any = flattenRichMessageSummary(message.rich_message, 0);
    return {text: summary?.text ?? '', entities: summary?.entities ?? []};
  } catch(err) {
    return null;
  }
}

/** Preview text for the chat list, including rich messages. */
async function previewOf(message: any): Promise<string> {
  // A restricted message must not leak through the chat list either.
  const restricted = await restrictionTextOf(message?.restriction_reason);
  if(restricted) return restricted;

  const plain = await messagePreview(message);
  if(plain) return plain;

  const rich = await richBody(message);
  return rich?.text.slice(0, 120) ?? plain;
}

/** Short one-line description, used in the chat list and reply previews. */
async function messagePreview(message: any): Promise<string> {
  if(!message) return '';
  if(message._ === 'messageService') return serviceText(message);
  if(message.message) return message.message;

  const media = mediaOf(message);
  if(!media) return message.media ? 'Media' : '';

  switch(media.kind) {
    case 'photo': return '📷 Photo';
    case 'video': return '🎬 Video';
    case 'gif': return '🎞 GIF';
    case 'sticker': return '🖼 Sticker';
    case 'voice': return '🎤 Voice message';
    case 'audio': return '🎵 Audio';
    default: return `📎 ${media.name || 'File'}`;
  }
}

/** Name of a peer as it should read inside a service message. */
async function actorName(peerId: number, selfId: number): Promise<string> {
  if(!peerId) return 'Someone';
  if(peerId === selfId) return 'You';
  return peerTitle(await getPeer(peerId), selfId);
}

async function serviceText(message: any): Promise<string> {
  const action = message?.action;
  if(!action) return 'Service message';

  const selfId = await getSelfId();
  const actorId = Number(message.fromId ?? message.from_id?.user_id ?? 0);
  const actor = await actorName(actorId, selfId);

  switch(action._) {
    case 'messageActionChatAddUser': {
      const ids = (action.users ?? []).map(Number);
      // Joining a group by tapping its link arrives as an add of oneself.
      if(ids.length === 1 && ids[0] === actorId) return `${actor} joined the group`;
      const names = await Promise.all(ids.map((id: number) => actorName(id, selfId)));
      return `${actor} added ${names.join(', ') || 'a user'}`;
    }

    case 'messageActionChatDeleteUser': {
      const id = Number(action.user_id);
      if(id === actorId) return `${actor} left the group`;
      return `${actor} removed ${await actorName(id, selfId)}`;
    }

    case 'messageActionChatJoinedByLink':
      return `${actor} joined the group via invite link`;

    case 'messageActionChatJoinedByRequest':
      return `${actor} was accepted into the group`;

    case 'messageActionChatCreate':
      return `${actor} created the group ${action.title ?? ''}`.trim();

    case 'messageActionChannelCreate':
      return `${actor} created the channel ${action.title ?? ''}`.trim();

    case 'messageActionChatEditTitle':
      return `${actor} changed the title to ${action.title ?? ''}`.trim();

    case 'messageActionChatEditPhoto':
      return `${actor} changed the chat photo`;

    case 'messageActionChatDeletePhoto':
      return `${actor} removed the chat photo`;

    case 'messageActionPinMessage':
      return `${actor} pinned a message`;

    case 'messageActionCustomAction':
      return action.message ?? 'Service message';
  }

  // "messageActionChatAddUser" → "Chat add user"
  const words = (action._ ?? '').replace(/^messageAction/, '').replace(/([A-Z])/g, ' $1').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : 'Service message';
}

/* ------------------------------------------------------------------ */
/* Dialogs & topics                                                    */
/* ------------------------------------------------------------------ */

export async function loadDialogs(limit = 40, filterId = 0): Promise<DialogItem[]> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const {dialogs} = await managers.dialogsStorage.getDialogs({limit, filterId});

  return Promise.all(
    dialogs.map(async(dialog: any) => {
      const peerId = Number(dialog.peerId);
      const [peer, topMessage] = await Promise.all([
        getPeer(peerId),
        managers.appMessagesManager.getMessageByPeer(peerId, dialog.top_message)
      ]);

      return {
        peerId,
        title: peerTitle(peer, selfId),
        preview: await previewOf(topMessage),
        date: topMessage?.date ?? 0,
        unread: dialog.unread_count ?? 0,
        isSelf: peerId === selfId,
        isUser: peer?._ === 'user',
        isBroadcast: peer?._ === 'channel' && !!peer?.pFlags?.broadcast,
        isForum: isTopicChat(peer),
        pinned: !!dialog.pFlags?.pinned,
        muted: (dialog.notify_settings?.mute_until ?? 0) > Date.now() / 1000,
        readMaxId: dialog.read_inbox_max_id ?? 0,
        readOutboxMaxId: dialog.read_outbox_max_id ?? 0,
        restrictionText: await peerRestrictionText(peer)
      };
    })
  );
}

/**
 * Forum topics are modelled as dialogs filtered by the forum's own peerId —
 * same call tweb's own topic list uses.
 */
export async function loadTopics(peerId: number, limit = 30): Promise<TopicItem[]> {
  const {managers} = await bootTelegram();
  const {dialogs} = await managers.dialogsStorage.getDialogs({limit, filterId: peerId});

  return Promise.all(
    dialogs.map(async(topic: any) => {
      const topMessage = await managers.appMessagesManager.getMessageByPeer(peerId, topic.top_message);
      return {
        threadId: Number(topic.id),
        title: topic.title || 'Topic',
        preview: await previewOf(topMessage),
        date: topMessage?.date ?? 0,
        unread: topic.unread_count ?? 0
      };
    })
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function isStickerMessage(message: any): boolean {
  const doc = message?.media?.document;
  if(!doc) return false;
  const isSticker = (doc.attributes ?? []).some((a: any) => a._ === 'documentAttributeSticker');
  if(isSticker) rawDocs.set('' + doc.id, doc);
  return isSticker;
}

async function toItem(message: any, peerId: number, selfId: number): Promise<MessageItem> {
  rawMessages.set(messageKey(peerId, message.mid), message);

  const fromId = Number(message.fromId ?? message.from_id?.user_id ?? peerId);
  const fromPeer = fromId === selfId ? null : await getPeer(fromId);

  let text = message._ === 'messageService' ? await serviceText(message) : (message.message ?? '');
  let entities = message.entities ?? [];

  if(!text && message._ !== 'messageService') {
    const rich = await richBody(message);
    if(rich?.text) {
      text = rich.text;
      entities = rich.entities;
    }
  }
  // pFlags.out is not set on every outgoing message (Saved Messages, some
  // channel posts), so fall back to comparing the sender with ourselves.
  const out = !!message.pFlags?.out || fromId === selfId;

  return {
    mid: message.mid,
    text,
    parts: message._ === 'messageService' ? [{text}] : textParts(text, entities),
    editable: out && message._ !== 'messageService',
    edited: !!message.edit_date,
    out,
    date: message.date,
    fromTitle: fromId === selfId ? 'You' : peerTitle(fromPeer, selfId),
    fromId,
    service: message._ === 'messageService',
    media: mediaOf(message),
    reply: await replyOf(message, peerId, selfId),
    repliesCount: message.replies?.replies ?? 0,
    reactions: reactionsOf(message),
    groupedId: message.grouped_id ? '' + message.grouped_id : '',
    stickerDocId: isStickerMessage(message) ? '' + message.media.document.id : '',
    stickerKind: isStickerMessage(message) ? stickerKind(message.media.document) : '',
    pending: !!message.pFlags?.is_outgoing,
    views: message.views ?? 0,
    forwardedFrom: await forwardedTitle(message, selfId),
    webpage: webpageOf(message),
    poll: pollOf(message),
    rich: richBlocksOf(message),
    buttons: buttonsOf(message),
    restrictionText: await restrictionTextOf(message.restriction_reason)
  };
}

function buttonsOf(message: any): MessageButton[][] {
  const markup = message?.reply_markup;
  if(markup?._ !== 'replyInlineMarkup' && markup?._ !== 'replyKeyboardMarkup') return [];

  return (markup.rows ?? [])
  .map((row: any, rowIndex: number) =>
    (row.buttons ?? []).map((button: any, column: number) => toButton(button, rowIndex, column))
  )
  .filter((row: MessageButton[]) => row.length);
}

function toButton(button: any, row: number, column: number): MessageButton {
  const base = {row, column, text: button.text ?? '', url: '', payload: '', samePeer: false};

  switch(button._) {
    case 'keyboardButtonUrl':
    case 'keyboardButtonUrlAuth':
      return {...base, kind: 'url', url: button.url ?? ''};
    case 'keyboardButtonWebView':
      return {...base, kind: 'webview', url: button.url ?? ''};
    case 'keyboardButtonSimpleWebView':
      return {...base, kind: 'simpleWebView', url: button.url ?? ''};
    case 'keyboardButtonCallback':
      return {...base, kind: 'callback'};
    case 'keyboardButtonSwitchInline':
      return {
        ...base,
        kind: 'switchInline',
        payload: button.query ?? '',
        samePeer: !!button.pFlags?.same_peer
      };
    case 'keyboardButtonCopy':
      return {...base, kind: 'copy', payload: button.copy_text ?? button.text ?? ''};
    case 'keyboardButton':
      return {...base, kind: 'text'};
    default:
      return {...base, kind: 'unsupported'};
  }
}

/**
 * Presses a `keyboardButtonCallback`. Returns whatever the bot answers with:
 * a toast/alert message, or a URL to open.
 */
export async function pressCallbackButton(
  peerId: number,
  mid: number,
  row: number,
  column: number
): Promise<{message: string; alert: boolean; url: string}> {
  const {managers} = await bootTelegram();

  const message = rawMessages.get(messageKey(peerId, mid)) ??
    await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  const button = message?.reply_markup?.rows?.[row]?.buttons?.[column];

  const answer: any = await managers.appInlineBotsManager.callbackButtonClick(peerId, mid, button);
  return {
    message: answer?.message ?? '',
    alert: !!answer?.pFlags?.alert,
    url: answer?.url ?? ''
  };
}

async function forwardedTitle(message: any, selfId: number): Promise<string> {
  const header = message?.fwd_from;
  if(!header) return '';

  if(header.from_name) return header.from_name;
  const fromId = Number(message.fwdFromId ?? header.from_id?.user_id ?? header.from_id?.channel_id ?? 0);
  if(!fromId) return 'Unknown';
  return peerTitle(await getPeer(fromId), selfId);
}

function webpageOf(message: any): WebPagePreview | null {
  const webpage = message?.media?.webpage;
  if(!webpage || webpage._ !== 'webPage') return null;

  return {
    url: webpage.url ?? '',
    siteName: webpage.site_name ?? '',
    title: webpage.title ?? '',
    description: webpage.description ?? ''
  };
}

function pollOf(message: any): PollPreview | null {
  const media = message?.media;
  if(media?._ !== 'messageMediaPoll' || !media.poll) return null;

  const results: any[] = media.results?.results ?? [];
  const totalVoters = media.results?.total_voters ?? 0;

  return {
    question: media.poll.question?.text ?? media.poll.question ?? '',
    closed: !!media.poll.pFlags?.closed,
    quiz: !!media.poll.pFlags?.quiz,
    totalVoters,
    answers: (media.poll.answers ?? []).map((answer: any, index: number) => {
      const result = results[index];
      const voters = result?.voters ?? 0;
      return {
        text: answer.text?.text ?? answer.text ?? '',
        voters,
        chosen: !!result?.pFlags?.chosen,
        percent: totalVoters ? Math.round((voters / totalVoters) * 100) : 0
      };
    })
  };
}

async function replyOf(message: any, peerId: number, selfId: number): Promise<ReplyPreview | null> {
  const replyToMid = message.reply_to_mid;
  if(!replyToMid) return null;

  const {managers} = await bootTelegram();
  const replyPeerId = Number(message.reply_to?.reply_to_peer_id?.user_id ?? peerId) || peerId;
  const replied = await managers.appMessagesManager.getMessageByPeer(replyPeerId, replyToMid);
  if(!replied) return {mid: replyToMid, title: '', text: 'Message'};

  const fromId = Number(replied.fromId ?? replyPeerId);
  const fromPeer = fromId === selfId ? null : await getPeer(fromId);

  return {
    mid: replyToMid,
    title: fromId === selfId ? 'You' : peerTitle(fromPeer, selfId),
    text: await messagePreview(replied)
  };
}

/**
 * Fetch messages by id, falling back to the server for any the local store does
 * not have. getHistory can return ids whose message objects were never saved —
 * common in threads that have not been opened before — and reading them
 * straight from storage yields null, which silently drops them from the view.
 */
async function fetchMessages(peerId: number, mids: number[]): Promise<any[]> {
  const {managers} = await bootTelegram();

  const messages = await Promise.all(
    mids.map((mid) => managers.appMessagesManager.getMessageByPeer(peerId, mid))
  );

  const missing = mids.filter((mid, index) => !messages[index]);
  if(!missing.length) return messages;

  try {
    await managers.appMessagesManager.reloadMessages(peerId, missing);
  } catch(err) {
    // Fall through: whatever is still missing is skipped below.
  }

  return Promise.all(
    mids.map((mid, index) => messages[index] ?? managers.appMessagesManager.getMessageByPeer(peerId, mid))
  );
}

export async function loadHistory(
  peerId: number,
  options: {threadId?: number; limit?: number; offsetId?: number} = {}
): Promise<MessageItem[]> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const {threadId, limit = 40, offsetId} = options;

  const result = await managers.appMessagesManager.getHistory({
    peerId,
    limit,
    threadId,
    offsetId,
    fetchIfWasNotFetched: true
  });

  const messages = await fetchMessages(peerId, result.history);

  const items = await Promise.all(
    messages.filter(Boolean).map((message: any) => toItem(message, peerId, selfId))
  );

  // getHistory returns newest-first; render oldest-first.
  return items.reverse();
}

/** Single message, for appending on a live update instead of reloading. */
export async function getMessage(peerId: number, mid: number): Promise<MessageItem | null> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const message = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  return message ? toItem(message, peerId, selfId) : null;
}

export async function sendMessage(
  peerId: number,
  text: string,
  options: {replyToMsgId?: number; threadId?: number; entities?: MessageEntity[]} = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendText({
    peerId,
    text,
    entities: options.entities,
    clearDraft: true,
    replyToMsgId: options.replyToMsgId ?? options.threadId,
    threadId: options.threadId
  });
}

/** Older page of history, for scrollback. `offsetId` is the oldest loaded mid. */
export async function loadOlder(
  peerId: number,
  offsetId: number,
  options: {threadId?: number; limit?: number} = {}
): Promise<MessageItem[]> {
  return loadHistory(peerId, {...options, offsetId});
}

/**
 * History centred on `mid`, for jumping to a replied-to message that may be
 * far above what is loaded. `addOffset` pulls messages newer than the offset
 * too, so the target lands in the middle rather than at the edge.
 */
export async function loadAround(
  peerId: number,
  mid: number,
  options: {threadId?: number; limit?: number} = {}
): Promise<MessageItem[]> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const limit = options.limit ?? 40;

  const result = await managers.appMessagesManager.getHistory({
    peerId,
    threadId: options.threadId,
    offsetId: mid,
    addOffset: -Math.floor(limit / 2),
    limit,
    fetchIfWasNotFetched: true
  });

  const messages = await fetchMessages(peerId, result.history);

  const items = await Promise.all(
    messages.filter(Boolean).map((message: any) => toItem(message, peerId, selfId))
  );

  return items.reverse();
}

/** Full-text search inside one chat (or one thread). */
export async function searchMessages(
  peerId: number,
  query: string,
  options: {threadId?: number; limit?: number} = {}
): Promise<MessageItem[]> {
  if(!query.trim()) return [];

  const {managers} = await bootTelegram();
  const selfId = await getSelfId();

  const result = await managers.appMessagesManager.getHistory({
    peerId,
    threadId: options.threadId,
    query: query.trim(),
    inputFilter: {_: 'inputMessagesFilterEmpty'},
    limit: options.limit ?? 40
  });

  const messages = await fetchMessages(peerId, result.history);

  return Promise.all(
    messages.filter(Boolean).map((message: any) => toItem(message, peerId, selfId))
  );
}

export async function votePoll(peerId: number, mid: number, optionIndexes: number[]): Promise<void> {
  const {managers} = await bootTelegram();
  const message = rawMessages.get(messageKey(peerId, mid)) ??
    await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message) throw new Error('Message not found');
  await managers.appPollsManager.sendVote(message, optionIndexes);
}

/**
 * Opens the comment thread attached to a channel post. The discussion lives in
 * the linked group, so this returns a different peer plus the thread id.
 */
export async function openDiscussion(
  peerId: number,
  mid: number
): Promise<{peerId: number; threadId: number} | null> {
  const {managers} = await bootTelegram();

  try {
    const result: any = await managers.appMessagesManager.getDiscussionMessage(peerId, mid);
    const message = result?.message ?? result;
    if(!message?.mid) return null;
    return {peerId: Number(message.peerId), threadId: message.mid};
  } catch(err) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

export async function getDraftText(peerId: number, threadId?: number): Promise<string> {
  const {managers} = await bootTelegram();
  try {
    const draft: any = await managers.appDraftsManager.getDraft(peerId, threadId);
    return draft?.message ?? '';
  } catch(err) {
    return '';
  }
}

export async function saveDraftText(peerId: number, threadId: number | undefined, text: string): Promise<void> {
  const {managers} = await bootTelegram();
  try {
    await managers.appDraftsManager.setDraft(peerId, threadId ?? 0, text);
  } catch(err) {
    // Drafts are a convenience; never surface a failure to the composer.
  }
}

export async function deleteMessages(peerId: number, mids: number[], revoke = true): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.deleteMessages(peerId, mids, revoke);
}

export async function forwardMessage(
  fromPeerId: number,
  mids: number[],
  toPeerId: number
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.forwardMessages({
    peerId: toPeerId,
    fromPeerId,
    mids
  } as any);
}

/** The chat's currently pinned message, for the header bar. */
export async function loadPinned(peerId: number, threadId?: number): Promise<MessageItem | null> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();

  try {
    const pinned: any = await managers.appMessagesManager.getPinnedMessage(peerId, threadId);
    const mid = pinned?.maxId ?? pinned?.mid;
    if(!mid) return null;

    // Dismissing the bar records the pinned id it was showing; anything newer
    // pinned afterwards brings it back on its own.
    const state: any = await managers.appStateManager.getState();
    if((state?.hiddenPinnedMessages?.[peerId] ?? 0) >= mid) return null;

    const message = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
    return message ? toItem(message, peerId, selfId) : null;
  } catch(err) {
    return null;
  }
}

/** Hide the pinned bar for this chat until something new is pinned. */
export async function hidePinnedMessage(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.hidePinnedMessages(peerId);
}

export async function editMessage(
  peerId: number,
  mid: number,
  text: string,
  entities?: MessageEntity[]
): Promise<void> {
  const {managers} = await bootTelegram();
  const message = rawMessages.get(messageKey(peerId, mid)) ??
    await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message) throw new Error('Message not found');
  await managers.appMessagesManager.editMessage(message, text, {entities});
}

export async function deleteMessage(peerId: number, mid: number, revoke = true): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.deleteMessages(peerId, [mid], revoke);
}

/** Upload and send files as media (photos/videos detected from mime type). */
export async function sendFiles(
  peerId: number,
  files: File[],
  options: {
    caption?: string;
    threadId?: number;
    replyToMsgId?: number;
    /**
     * Send images as compressed photos (inline) rather than documents. The
     * caller decides — pasting a screenshot usually means photo, but sending a
     * PNG you care about means file.
     */
    asPhoto?: boolean;
  } = {}
): Promise<void> {
  const {managers} = await bootTelegram();

  for(const [index, file] of files.entries()) {
    const isVisual = file.type.startsWith('image/') || file.type.startsWith('video/');

    await managers.appMessagesManager.sendFile({
      peerId,
      file,
      isMedia: isVisual && options.asPhoto !== false,
      // Only the first file carries the caption, like the official clients.
      caption: index === 0 ? options.caption : undefined,
      threadId: options.threadId,
      replyToMsgId: options.replyToMsgId ?? options.threadId,
      clearDraft: index === 0
    });
  }
}

/**
 * Tell the peer we are typing.
 *
 * The server expires a typing status after ~6s, so a long message needs the
 * action re-sent periodically — the caller throttles to ~4s. Sending the cancel
 * action clears it immediately once the message goes out.
 */
export async function sendTyping(
  peerId: number,
  threadId?: number,
  action: 'typing' | 'cancel' = 'typing'
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.setTyping(
    peerId,
    {_: action === 'cancel' ? 'sendMessageCancelAction' : 'sendMessageTypingAction'},
    undefined,
    threadId
  );
}

/**
 * Publish our own online status. The server expires it after a few minutes, so
 * the caller refreshes it on a timer and sends `offline: true` when the tab is
 * hidden or closed — otherwise contacts keep seeing us as online.
 */
export async function setOwnOnline(online: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  try {
    await managers.appUsersManager.updateMyOnlineStatus(!online);
  } catch(err) {
    // Presence is best-effort.
  }
}

/** Fires when a peer's own status changes, so headers can re-render. */
export async function onUserUpdate(callback: (userId: number) => void): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  const handler = (userId: any) => {
    rawPeers.delete(Number(userId));
    callback(Number(userId));
  };
  rootScope.addEventListener('user_update', handler);
  return () => rootScope.removeEventListener('user_update', handler);
}

export type PresenceInfo = {online: boolean; text: string};

/** Header subtitle: online / last seen / member count. */
export async function getPresence(peerId: number): Promise<PresenceInfo> {
  const peer = await getPeer(peerId);
  if(!peer) return {online: false, text: ''};

  if(peer._ !== 'user') {
    const count = peer.participants_count;
    const noun = peer.pFlags?.broadcast ? 'subscribers' : 'members';
    return {online: false, text: count ? `${count.toLocaleString()} ${noun}` : ''};
  }

  if(peer.pFlags?.bot) return {online: false, text: 'bot'};

  const status = peer.status;
  switch(status?._) {
    case 'userStatusOnline': return {online: true, text: 'online'};
    case 'userStatusRecently': return {online: false, text: 'last seen recently'};
    case 'userStatusLastWeek': return {online: false, text: 'last seen within a week'};
    case 'userStatusLastMonth': return {online: false, text: 'last seen within a month'};
    case 'userStatusOffline': {
      const when = new Date((status.was_online ?? 0) * 1000);
      return {online: false, text: `last seen ${when.toLocaleString()}`};
    }
    default: return {online: false, text: ''};
  }
}

/** Server-side dialog search; empty query returns the plain dialog list. */
export async function searchDialogs(query: string, limit = 40): Promise<DialogItem[]> {
  if(!query.trim()) return loadDialogs(limit);

  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const {dialogs} = await managers.dialogsStorage.getDialogs({query: query.trim(), limit, filterId: 0});

  return Promise.all(
    dialogs.map(async(dialog: any) => {
      const peerId = Number(dialog.peerId);
      const [peer, topMessage] = await Promise.all([
        getPeer(peerId),
        managers.appMessagesManager.getMessageByPeer(peerId, dialog.top_message)
      ]);

      return {
        peerId,
        title: peerTitle(peer, selfId),
        preview: await previewOf(topMessage),
        date: topMessage?.date ?? 0,
        unread: dialog.unread_count ?? 0,
        isSelf: peerId === selfId,
        isUser: peer?._ === 'user',
        isBroadcast: peer?._ === 'channel' && !!peer?.pFlags?.broadcast,
        isForum: isTopicChat(peer),
        pinned: !!dialog.pFlags?.pinned,
        muted: (dialog.notify_settings?.mute_until ?? 0) > Date.now() / 1000,
        readMaxId: dialog.read_inbox_max_id ?? 0,
        readOutboxMaxId: dialog.read_outbox_max_id ?? 0,
        restrictionText: await peerRestrictionText(peer)
      };
    })
  );
}

/** Peers currently typing in a chat; returns an unsubscribe callback. */
export async function onTyping(
  callback: (peerId: number, threadId: number | undefined, names: string[]) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  const selfId = await getSelfId();

  const handler = async({peerId, threadId, typings}: any) => {
    const names = await Promise.all(
      (typings ?? []).map(async(typing: any) => peerTitle(await getPeer(Number(typing.userId)), selfId))
    );
    callback(Number(peerId), threadId, names);
  };

  rootScope.addEventListener('peer_typings', handler);
  return () => rootScope.removeEventListener('peer_typings', handler);
}

/**
 * Mark history read up to `maxId`.
 *
 * Deliberately not `readAllHistory`: that marks the whole chat read the moment
 * it is opened, even for messages the user never scrolled to. The UI feeds the
 * highest *actually visible* incoming message id in here instead, matching what
 * the official clients do.
 */
export async function readUpTo(peerId: number, maxId: number, threadId?: number): Promise<void> {
  if(!maxId) return;
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.readHistory({peerId, maxId, threadId});
}

/**
 * Report that unread media (a voice message, a video note, a mention) has
 * actually been consumed.
 *
 * `readHistory` alone never clears `media_unread`, so without this the sender
 * keeps seeing an unplayed voice message forever — a read status this client
 * would be silently withholding. The manager wraps
 * `messages.readMessageContents` and the mention/reaction counters with it.
 */
export async function readMediaContents(peerId: number, mids: number[]): Promise<void> {
  if(!mids.length) return;
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.readMessages(peerId, mids);
}

/** Explicit "mark as read" action from the chat list. */
export async function markDialogRead(peerId: number, threadId?: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.readAllHistory(peerId, threadId);
}

export async function markDialogUnread(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.markDialogUnread({peerId, read: false});
}

/** Highest outgoing message the peer has read, for the tick state. */
export async function getReadOutboxMaxId(peerId: number): Promise<number> {
  const {managers} = await bootTelegram();
  try {
    const dialog: any = await managers.dialogsStorage.getDialogOnly(peerId);
    return dialog?.read_outbox_max_id ?? 0;
  } catch(err) {
    return 0;
  }
}

/**
 * Who has read a given message, for small groups. The server only answers for
 * groups under a size limit and within a retention window, so an empty list
 * means "unknown", not "nobody".
 */
export async function readParticipants(peerId: number, mid: number): Promise<string[]> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();

  try {
    const participants: any[] = await managers.appMessagesManager.getMessageReadParticipants(peerId, mid);
    return Promise.all(
      (participants ?? []).map(async(participant: any) => {
        const id = Number(participant.user_id ?? participant);
        return peerTitle(await getPeer(id), selfId);
      })
    );
  } catch(err) {
    return [];
  }
}

/** Fires when the peer reads our messages (or we read theirs). */
export async function onReadStateChange(callback: () => void): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  rootScope.addEventListener('messages_read', callback);
  return () => rootScope.removeEventListener('messages_read', callback);
}

/** Fires whenever the server confirms a read or unread-count change. */
export async function onDialogsUpdate(callback: () => void): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  rootScope.addEventListener('dialogs_multiupdate', callback);
  return () => rootScope.removeEventListener('dialogs_multiupdate', callback);
}

/* ------------------------------------------------------------------ */
/* Files: avatars and message media                                    */
/* ------------------------------------------------------------------ */

/** Blob/stream URL for a peer's small avatar, or null when it has none. */
export async function loadAvatarUrl(peerId: number): Promise<string | null> {
  if(avatarUrls.has(peerId)) return avatarUrls.get(peerId)!;

  await bootTelegram();
  const [{default: apiManagerProxy}, {default: getPeerPhoto}] = await Promise.all([
    import('@lib/apiManagerProxy'),
    import('@appManagers/utils/peers/getPeerPhoto')
  ]);

  const peer = await getPeer(peerId);
  const photo = getPeerPhoto(peer);
  if(!photo) {
    avatarUrls.set(peerId, null);
    return null;
  }

  try {
    const url = await apiManagerProxy.loadAvatar(peerId, photo, 'photo_small');
    avatarUrls.set(peerId, url ?? null);
    return url ?? null;
  } catch(err) {
    avatarUrls.set(peerId, null);
    return null;
  }
}

/**
 * Renderable URL for a message's media. Photos/videos resolve to a thumbnail
 * sized for the bubble; stickers and other documents resolve to the file
 * itself when it is an image. Returns null for anything not displayable.
 */
export async function loadMediaUrl(
  peerId: number,
  mid: number,
  boxWidth = 480,
  full = false
): Promise<string | null> {
  const key = messageKey(peerId, mid);
  // Keyed by what was actually asked for: the bubble wants a 480px thumb and the
  // lightbox the full file, and a single key handed the lightbox back the
  // bubble's thumb — the "larger view" was the small one, scaled up.
  const cacheKey = `${key}_${full ? 'full' : boxWidth}`;
  if(mediaUrls.has(cacheKey)) return mediaUrls.get(cacheKey)!;

  const message = rawMessages.get(key);
  const media = message?.media;
  if(!media) return null;

  await bootTelegram();
  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  const target = media._ === 'messageMediaPhoto' ? media.photo : media.document;
  if(!target) return null;

  const attributes: any[] = target.attributes ?? [];
  const isAudio = attributes.some((a: any) => a._ === 'documentAttributeAudio');
  if(isAudio) {
    // Voice notes and music play from the full file.
    try {
      const url = await appDownloadManager.downloadMediaURL({media: target});
      mediaUrls.set(cacheKey, url ?? null);
      return url ?? null;
    } catch(err) {
      mediaUrls.set(cacheKey, null);
      return null;
    }
  }

  const isVideo = attributes.some((a: any) => a._ === 'documentAttributeVideo');
  // A GIF needs the actual mp4, not a poster frame — it plays inline.
  const isGif = attributes.some((a: any) => a._ === 'documentAttributeAnimated') || target.type === 'gif';
  const isImage = media._ === 'messageMediaPhoto' ||
    target.mime_type?.startsWith('image/') ||
    isVideo ||
    isGif;
  if(!isImage) {
    mediaUrls.set(cacheKey, null);
    return null;
  }

  try {
    // In a bubble a video is a poster frame, so download a thumb; GIFs and
    // photos-as-documents download in full. `full` (the lightbox) wants the
    // real file for anything playable, otherwise a <video> gets a still image.
    const thumb = choosePhotoSize(target, boxWidth, boxWidth, true);
    const wantsThumb = !isGif && (media._ === 'messageMediaPhoto' || (isVideo && !full));
    const url = await appDownloadManager.downloadMediaURL({
      media: target,
      thumb: wantsThumb ? thumb : undefined
    });
    mediaUrls.set(cacheKey, url ?? null);
    return url ?? null;
  } catch(err) {
    console.error('[media] download failed', key, err);
    mediaUrls.set(cacheKey, null);
    return null;
  }
}

/**
 * Saves an attachment to disk.
 *
 * `loadMediaUrl` deliberately refuses to resolve a plain document — a chat
 * full of attachments would download every one of them just to render the
 * bubbles — so a file has no URL to hang off an `<a download>` and had no way
 * to be saved at all. Fetching it is an explicit act, on click.
 *
 * tweb's `downloadToDisc` (its spelling) streams through the service worker,
 * so a large file never has to be held in memory, and it falls back to a blob
 * when the worker is unavailable.
 */
export async function saveMediaToDisk(peerId: number, mid: number): Promise<void> {
  const key = messageKey(peerId, mid);
  const message = rawMessages.get(key) ??
    await (async () => {
      const {managers} = await bootTelegram();
      return managers.appMessagesManager.getMessageByPeer(peerId, mid);
    })();

  const media = message?.media;
  const target = media?.document ?? media?.photo;
  if(!target) throw new Error('Nothing to download');

  await bootTelegram();
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  await appDownloadManager.downloadToDisc({
    media: target,
    fileName: target.file_name || undefined
  });
}

/* ------------------------------------------------------------------ */
/* Stickers, GIFs and emoji                                            */
/* ------------------------------------------------------------------ */

export type StickerItem = {
  docId: string;
  kind: 'static' | 'video' | 'animated';
  emoji: string;
  width: number;
  height: number;
};

export type StickerSetItem = {
  id: string;
  title: string;
  count: number;
  thumbDocId: string;
};

const rawDocs = new Map<string, any>();
const docUrls = new Map<string, string | null>();

function stickerKind(doc: any): StickerItem['kind'] {
  // appDocsManager tags every sticker doc with StickerType
  // (1 = static WebP, 2 = Lottie/.tgs, 3 = WebM). Check WebM before Lottie:
  // doc.animated is set for video stickers too, so testing it first would send
  // WebM into the Lottie decoder ("tlottie rejected the animation").
  if(doc.sticker === 3 || doc.mime_type === 'video/webm') return 'video';
  if(doc.sticker === 2 || doc.mime_type === 'application/x-tgsticker') return 'animated';
  return 'static';
}

function toSticker(doc: any): StickerItem {
  rawDocs.set('' + doc.id, doc);
  const size = (doc.attributes ?? []).find((a: any) => a._ === 'documentAttributeImageSize' || a._ === 'documentAttributeVideo');
  const sticker = (doc.attributes ?? []).find((a: any) => a._ === 'documentAttributeSticker');

  return {
    docId: '' + doc.id,
    kind: stickerKind(doc),
    emoji: sticker?.alt ?? '',
    width: size?.w ?? 128,
    height: size?.h ?? 128
  };
}

export async function loadRecentStickers(): Promise<StickerItem[]> {
  const {managers} = await bootTelegram();
  const docs = await managers.appStickersManager.getRecentStickersStickers();
  return (docs ?? []).map(toSticker);
}

// getStickerSet needs the full {id, access_hash} input, so keep the raw sets.
const rawStickerSets = new Map<string, any>();

export async function loadStickerSets(): Promise<StickerSetItem[]> {
  const {managers} = await bootTelegram();
  const all: any = await managers.appStickersManager.getAllStickers();

  return (all?.sets ?? []).map((set: any) => {
    rawStickerSets.set('' + set.id, set);
    return {
      id: '' + set.id,
      title: set.title ?? '',
      count: set.count ?? 0,
      thumbDocId: ''
    };
  });
}

/** `setId` is either an installed set's id or a public set short name. */
export async function loadSetStickers(setId: string): Promise<StickerItem[]> {
  const {managers} = await bootTelegram();
  const raw = rawStickerSets.get(setId);

  const input: any = raw ?
    {_: 'inputStickerSetID', id: raw.id, access_hash: raw.access_hash} :
    setId;

  const set: any = await managers.appStickersManager.getStickerSet(input);
  return (set?.documents ?? []).map(toSticker);
}

export async function loadGifs(): Promise<StickerItem[]> {
  const {managers} = await bootTelegram();
  const docs = await managers.appGifsManager.getGifs();
  return (docs ?? []).map((doc: any) => {
    rawDocs.set('' + doc.id, doc);
    const video = (doc.attributes ?? []).find((a: any) => a._ === 'documentAttributeVideo');
    return {
      docId: '' + doc.id,
      kind: 'video' as const,
      emoji: '',
      width: video?.w ?? 200,
      height: video?.h ?? 200
    };
  });
}

/**
 * Renderable URL for a sticker/GIF document. Animated (.tgs/Lottie) stickers
 * have no still frame in the file itself, so they fall back to the server
 * thumbnail — playback would need tweb's rlottie worker pipeline.
 */
export async function loadDocUrl(docId: string, thumbOnly = false): Promise<string | null> {
  const cacheKey = `${docId}_${thumbOnly ? 'thumb' : 'full'}`;
  if(docUrls.has(cacheKey)) return docUrls.get(cacheKey)!;

  const doc = rawDocs.get(docId);
  if(!doc) return null;

  await bootTelegram();
  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  try {
    const useThumb = thumbOnly || stickerKind(doc) === 'animated';
    const url = await appDownloadManager.downloadMediaURL({
      media: doc,
      thumb: useThumb ? choosePhotoSize(doc, 160, 160, true) : undefined
    });
    docUrls.set(cacheKey, url ?? null);
    return url ?? null;
  } catch(err) {
    docUrls.set(cacheKey, null);
    return null;
  }
}

/**
 * Raw .tgs blob for an animated sticker. The file is gzipped Lottie JSON that
 * only tweb's rlottie/tlottie worker can decode, so it is handed to
 * lottieLoader as-is rather than turned into an object URL.
 */
export async function loadStickerBlob(docId: string): Promise<Blob | null> {
  const doc = rawDocs.get(docId);
  if(!doc) return null;

  await bootTelegram();
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  try {
    return await appDownloadManager.downloadMedia({media: doc});
  } catch(err) {
    return null;
  }
}

export async function sendDocument(
  peerId: number,
  docId: string,
  options: {threadId?: number; replyToMsgId?: number} = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  const doc = rawDocs.get(docId);
  if(!doc) throw new Error('Document not found');

  const {default: getDocumentMediaInput} = await import('@appManagers/utils/docs/getDocumentMediaInput');
  await managers.appMessagesManager.sendOther({
    peerId,
    inputMedia: getDocumentMediaInput(doc),
    threadId: options.threadId,
    replyToMsgId: options.replyToMsgId ?? options.threadId,
    clearDraft: true
  });
}

/* ------------------------------------------------------------------ */
/* Reactions                                                           */
/* ------------------------------------------------------------------ */

export type ReactionItem = {emoticon: string; count: number; chosen: boolean};
export type ReactionParticipant = {peerId: number; title: string};

function reactionsOf(message: any): ReactionItem[] {
  const results = message?.reactions?.results ?? [];
  return results
    .filter((result: any) => result.reaction?._ === 'reactionEmoji')
    .map((result: any) => ({
      emoticon: result.reaction.emoticon,
      count: result.count ?? 0,
      chosen: !!result.chosen_order || !!result.pFlags?.chosen
    }));
}

export async function availableReactions(limit = 12): Promise<string[]> {
  const {managers} = await bootTelegram();
  try {
    const list: any = await managers.appReactionsManager.getAvailableReactions();
    return (list ?? [])
      .filter((r: any) => !r.pFlags?.inactive && r.reaction)
      .slice(0, limit)
      .map((r: any) => r.reaction);
  } catch(err) {
    return ['👍', '👎', '❤', '🔥', '🎉', '😁'];
  }
}

export function reactionPeerFromResult(result: any, reaction: any): any {
  const peer = reaction.peer_id;
  if(peer._ === 'peerUser') {
    return result.users?.find((user: any) => Number(user.id) === Number(peer.user_id));
  }
  if(peer._ === 'peerChannel') {
    return result.chats?.find((chat: any) => Number(chat.id) === Number(peer.channel_id));
  }
  if(peer._ === 'peerChat') {
    return result.chats?.find((chat: any) => Number(chat.id) === Number(peer.chat_id));
  }
  return undefined;
}

export async function reactionParticipants(
  peerId: number,
  mid: number,
  emoticon: string
): Promise<ReactionParticipant[]> {
  const {managers} = await bootTelegram();
  const message = rawMessages.get(messageKey(peerId, mid)) ??
    await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message?.reactions?.pFlags?.can_see_list && !peerId.isUser()) return [];

  try {
    const result: any = await managers.appReactionsManager.getMessageReactionsList(
      peerId,
      mid,
      100,
      {_: 'reactionEmoji', emoticon}
    );
    const selfId = await getSelfId();
    return Promise.all((result?.reactions ?? []).map(async(reaction: any) => {
      const peerId = Number(managers.appPeersManager.getPeerId(reaction.peer_id));
      const peer = reactionPeerFromResult(result, reaction);
      return {
        peerId,
        title: peerId === selfId ? 'You' : peerTitle(peer ?? await getPeer(peerId), selfId)
      };
    }));
  } catch(err) {
    return [];
  }
}

export async function toggleReaction(peerId: number, mid: number, emoticon: string): Promise<void> {
  const {managers} = await bootTelegram();
  const message = rawMessages.get(messageKey(peerId, mid)) ??
    await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message) throw new Error('Message not found');

  await managers.appReactionsManager.sendReaction({
    message,
    reaction: {_: 'reactionEmoji', emoticon}
  } as any);
}

/* ------------------------------------------------------------------ */
/* Folders, and chat-level actions                                     */
/* ------------------------------------------------------------------ */

export type FolderItem = {
  id: number;
  title: string;
  /** Folder icon emoji chosen by the user, '' for the built-in folders. */
  emoticon: string;
  unread: number;
  /** Built-in All/Archive cannot be edited or deleted. */
  editable: boolean;
  includePeerIds: number[];
};

function filterTitle(filter: any): string {
  // Newer layers wrap the title in a TextWithEntities.
  return typeof filter?.title === 'string' ? filter.title : (filter?.title?.text ?? 'Folder');
}

/**
 * Chat folders (a.k.a. dialog filters).
 *
 * `getFilters()` only returns what is already cached, which on a cold start is
 * just the two built-ins — `getDialogFilters()` is what actually fetches them
 * from the server.
 */
export async function loadFolders(): Promise<FolderItem[]> {
  const {managers} = await bootTelegram();

  const base: FolderItem[] = [
    {id: 0, title: 'All', emoticon: '', unread: 0, editable: false, includePeerIds: []},
    {id: 1, title: 'Archive', emoticon: '📁', unread: 0, editable: false, includePeerIds: []}
  ];

  let folders = base;
  try {
    const filters: any[] = await managers.filtersStorage.getDialogFilters();
    const custom = (filters ?? [])
      .filter((filter) => filter?.id > 1)
      .map((filter) => ({
        id: filter.id,
        title: filterTitle(filter),
        emoticon: filter.emoticon ?? '',
        unread: 0,
        editable: true,
        includePeerIds: (filter.includePeerIds ?? []).map(Number)
      }));
    folders = [...base, ...custom];
  } catch(err) {
    // Keep the built-ins; a failed fetch must not empty the tab bar.
  }

  return Promise.all(
    folders.map(async(folder) => ({
      ...folder,
      unread: await folderUnread(folder.id)
    }))
  );
}

async function folderUnread(filterId: number): Promise<number> {
  const {managers} = await bootTelegram();

  try {
    // getFolderUnreadCount only reports what the folder has already cached, so
    // it reads 0 until the folder's dialogs are pulled at least once.
    // The badge counts unmuted *chats* with something unread — not messages,
    // which would show five-digit numbers for busy channels.
    const {dialogs} = await managers.dialogsStorage.getDialogs({limit: 100, filterId});
    const now = Date.now() / 1000;
    return (dialogs ?? []).filter((dialog: any) => {
      const muted = (dialog.notify_settings?.mute_until ?? 0) > now;
      return !muted && ((dialog.unread_count ?? 0) > 0 || dialog.pFlags?.unread_mark);
    }).length;
  } catch(err) {
    return 0;
  }
}

/**
 * getOutputDialogFilter sends the filter as-is, so the request payload uses
 * `include_peers` (InputPeer objects) — the `includePeerIds` mirror is only for
 * local matching. Sending it without the InputPeers is rejected server-side
 * with FILTER_INCLUDE_EMPTY.
 */
async function toInputPeers(peerIds: number[]) {
  const {managers} = await bootTelegram();
  return Promise.all(peerIds.map((peerId) => managers.appPeersManager.getInputPeerById(peerId)));
}

export async function createFolder(title: string, peerIds: number[]): Promise<void> {
  const {managers} = await bootTelegram();
  const includePeers = await toInputPeers(peerIds);

  await managers.filtersStorage.createDialogFilter({
    _: 'dialogFilter',
    id: 0, // assigned by createDialogFilter
    title: {_: 'textWithEntities', text: title, entities: []},
    pFlags: {},
    pinned_peers: [],
    include_peers: includePeers,
    exclude_peers: [],
    includePeerIds: peerIds,
    excludePeerIds: [],
    pinnedPeerIds: []
  } as any, true);
}

export async function updateFolder(
  folderId: number,
  title: string,
  peerIds: number[]
): Promise<void> {
  const {managers} = await bootTelegram();
  const existing: any = await managers.filtersStorage.getFilter(folderId);
  if(!existing) throw new Error('Folder not found');

  await managers.filtersStorage.updateDialogFilter({
    ...existing,
    title: {_: 'textWithEntities', text: title, entities: []},
    include_peers: await toInputPeers(peerIds),
    includePeerIds: peerIds
  } as any);
}

export async function deleteFolder(folderId: number): Promise<void> {
  const {managers} = await bootTelegram();
  const existing: any = await managers.filtersStorage.getFilter(folderId);
  if(!existing) return;
  await managers.filtersStorage.updateDialogFilter(existing, true);
}

/** Fires when folders are created, edited, reordered or removed elsewhere. */
export async function onFoldersUpdate(callback: () => void): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  rootScope.addEventListener('filter_update', callback);
  rootScope.addEventListener('filter_delete', callback);
  rootScope.addEventListener('filter_new', callback);
  return () => {
    rootScope.removeEventListener('filter_update', callback);
    rootScope.removeEventListener('filter_delete', callback);
    rootScope.removeEventListener('filter_new', callback);
  };
}

/* ---------- creating groups and channels ---------- */

/**
 * A plain group — `messages.createChat`, the same basic chat the official
 * clients create. Telegram upgrades it to a megagroup on its own once a
 * supergroup-only feature is used, so there is nothing to choose here.
 * Returns the new peer id.
 */
export async function createGroup(title: string, memberPeerIds: number[]): Promise<number> {
  const {managers} = await bootTelegram();
  // Only users can seed a group; peer ids of chats are negative.
  const userIds = memberPeerIds.filter((peerId) => peerId > 0);
  const {chatId} = await managers.appChatsManager.createChat(title, userIds);
  return -Number(chatId);
}

/**
 * A broadcast channel, optionally seeded with members. Returns the new peer id.
 */
export async function createChannel(
  title: string,
  about: string,
  memberPeerIds: number[]
): Promise<number> {
  const {managers} = await bootTelegram();
  const chatId = await managers.appChatsManager.createChannel({
    title,
    about,
    broadcast: true
  });

  const userIds = memberPeerIds.filter((peerId) => peerId > 0);
  if(userIds.length) {
    // Non-fatal: the channel exists either way, and a member can be blocked by
    // their privacy settings from being added by anyone.
    await managers.appChatsManager.inviteToChannel(chatId, userIds).catch(() => {});
  }

  return -Number(chatId);
}

/* ---------- public @links ---------- */

/**
 * Is this @link free for that chat? Only channels and supergroups can be
 * asked — a basic group has no channel to check against and is upgraded on
 * save, so it reports free and lets the save surface USERNAME_OCCUPIED.
 */
export async function checkChatUsername(peerId: number, username: string): Promise<boolean> {
  const {managers} = await bootTelegram();
  const peer = await getPeer(peerId);
  if(peer?._ !== 'channel') return true;
  return managers.appChatsManager.checkUsername(peer.id, normalizeUsername(username));
}

/**
 * Give a chat a public @link. A basic group has no link of its own, so it is
 * migrated to a supergroup first — exactly what the official clients do, and
 * the reason this returns the peer id to use afterwards: migration changes it.
 */
export async function setChatUsername(peerId: number, username: string): Promise<number> {
  const {managers} = await bootTelegram();
  const peer = await getPeer(peerId);
  if(!peer) throw new Error('Chat not found');

  let chatId = peer.id;
  let newPeerId = peerId;

  if(peer._ !== 'channel') {
    chatId = await managers.appChatsManager.migrateChat(peer.id);
    newPeerId = -Number(chatId);
  }

  await managers.appChatsManager.updateUsername(chatId, normalizeUsername(username));

  // The cached peers still carry the old username (and, after a migration, the
  // old chat entirely); drop them so the next read is the updated chat.
  rawPeers.delete(peerId);
  rawPeers.delete(newPeerId);
  return newPeerId;
}

function normalizeUsername(username: string) {
  return username.trim().replace(/^@/, '');
}

export async function togglePin(peerId: number, filterId = 0): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.toggleDialogPin({peerId, filterId});
}

export async function toggleMute(peerId: number, mute: boolean, threadId?: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.togglePeerMute({peerId, mute, threadId});
}

export async function leaveOrDelete(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  const peer = await getPeer(peerId);

  if(peer?._ === 'channel') {
    await managers.appChatsManager.leaveChannel(peer.id);
  } else {
    await managers.appMessagesManager.flushHistory({peerId, revoke: false});
  }
  rawPeers.delete(peerId);
}

/**
 * Enough about a peer to open it as a chat, for peers that may not have a
 * dialog yet — a group member you have never messaged, for instance.
 */
export async function getPeerBrief(peerId: number): Promise<{
  peerId: number;
  title: string;
  isUser: boolean;
  isSelf: boolean;
  isBroadcast: boolean;
  isForum: boolean;
  username: string;
}> {
  const selfId = await getSelfId();
  const peer = await getPeer(peerId);

  return {
    peerId,
    title: peerTitle(peer, selfId),
    username: peer?.username ?? peer?.usernames?.[0]?.username ?? '',
    isUser: peer?._ === 'user',
    isSelf: peerId === selfId,
    isBroadcast: peer?._ === 'channel' && !!peer?.pFlags?.broadcast,
    isForum: isTopicChat(peer)
  };
}

/** Resolve a public @username to a peer id. */
export async function resolveUsername(username: string): Promise<number | null> {
  const {managers} = await bootTelegram();
  try {
    const peer: any = await managers.appUsersManager.resolveUsername(username.replace(/^@/, ''));
    const id = Number(peer?.id ?? 0);
    if(!id) return null;
    // Channels and chats come back with their own id space; getPeer normalises.
    return peer._ === 'user' ? id : -id;
  } catch(err) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Chat / group / channel info                                         */
/* ------------------------------------------------------------------ */

export type MemberItem = {peerId: number; title: string};

export type ChatInfo = {
  peerId: number;
  title: string;
  about: string;
  username: string;
  membersCount: number;
  isChannel: boolean;
  isGroup: boolean;
  /** Creator or an admin with change_info — may set the public @link. */
  canSetUsername: boolean;
  members: MemberItem[];
};

export async function loadChatInfo(peerId: number): Promise<ChatInfo> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const peer = await getPeer(peerId);

  const isUser = peer?._ === 'user';
  const isChannel = peer?._ === 'channel' && !!peer.pFlags?.broadcast;
  const isGroup = !isUser && !isChannel;

  const info: ChatInfo = {
    peerId,
    title: peerTitle(peer, selfId),
    about: '',
    username: peer?.username ?? '',
    membersCount: peer?.participants_count ?? 0,
    isChannel,
    isGroup,
    canSetUsername: !isUser && (
      !!peer?.pFlags?.creator || !!(peer as any)?.admin_rights?.pFlags?.change_info
    ),
    members: []
  };

  try {
    if(isUser) {
      const full: any = await managers.appProfileManager.getProfile(peer.id);
      info.about = full?.about ?? '';
      return info;
    }

    const full: any = await managers.appProfileManager.getChatFull(peer.id);
    info.about = full?.about ?? '';
    info.membersCount = full?.participants_count ?? full?.participants?.participants?.length ?? info.membersCount;

    const participants: any[] = full?.participants?.participants ?? [];
    if(participants.length) {
      info.members = await membersFrom(participants.slice(0, 50), selfId);
      return info;
    }

    // Channels/supergroups keep their member list behind a separate call.
    const result: any = await managers.appProfileManager.getParticipants({
      id: peer.id,
      filter: {_: 'channelParticipantsRecent'},
      limit: 50,
      offset: 0
    });
    info.members = await membersFrom(result?.participants ?? [], selfId);
  } catch(err) {
    // Member lists are permission-gated; the rest of the info still renders.
  }

  return info;
}

async function membersFrom(participants: any[], selfId: number): Promise<MemberItem[]> {
  return Promise.all(
    participants.map(async(participant: any) => {
      const id = Number(participant.user_id ?? participant.peer?.user_id ?? participant.peer?.channel_id ?? 0);
      return {peerId: id, title: peerTitle(await getPeer(id), selfId)};
    })
  );
}

/* ------------------------------------------------------------------ */
/* Live updates                                                        */
/* ------------------------------------------------------------------ */

export type NewMessageHandler = (peerId: number, mid: number, threadId?: number) => void;

/**
 * Subscribe to messages appearing in a chat.
 *
 * Three events matter and only listening to one of them loses messages:
 * `history_append` is the main path when a message is saved into a history
 * storage, `history_multiappend` covers the batched update path, and a message
 * we send ourselves lands first under a temporary id. Callers dedupe by mid.
 */
export async function onNewMessage(callback: NewMessageHandler): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');

  const emit = (message: any) => {
    if(!message) return;
    callback(Number(message.peerId), message.mid, message.reply_to?.reply_to_top_id);
  };

  const onMultiAppend = (message: any) => emit(message);
  const onAppend = ({message}: any) => emit(message);

  rootScope.addEventListener('history_multiappend', onMultiAppend);
  rootScope.addEventListener('history_append', onAppend);

  return () => {
    rootScope.removeEventListener('history_multiappend', onMultiAppend);
    rootScope.removeEventListener('history_append', onAppend);
  };
}

/**
 * Message edits. Bots that stream a reply send an empty message and then edit
 * it repeatedly, so without this their answers stay blank.
 */
export async function onMessageEdited(
  callback: (peerId: number, mid: number) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  const handler = ({peerId, mid}: any) => callback(Number(peerId), mid);
  rootScope.addEventListener('message_edit', handler);
  return () => rootScope.removeEventListener('message_edit', handler);
}

/** Messages removed by anyone; the payload is a set of ids for one peer. */
export async function onMessagesDeleted(
  callback: (peerId: number, mids: number[]) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');

  const handler = ({peerId, msgs}: any) => {
    // `msgs` is a Set on the wire; normalise before it reaches the UI.
    callback(Number(peerId), Array.from(msgs ?? [], Number));
  };

  rootScope.addEventListener('history_delete', handler);
  return () => rootScope.removeEventListener('history_delete', handler);
}

/**
 * A message we sent has been acknowledged: its temporary id is replaced by the
 * real one. Without this the optimistic copy lingers and the confirmed message
 * arrives as a duplicate.
 */
export async function onMessageSent(
  callback: (peerId: number, tempId: number, mid: number) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');

  const handler = ({tempId, mid, message}: any) => {
    callback(Number(message?.peerId ?? 0), tempId, mid);
  };

  rootScope.addEventListener('message_sent', handler);
  return () => rootScope.removeEventListener('message_sent', handler);
}

/* ------------------------------------------------------------------ */
/* Sponsored messages                                                  */
/* ------------------------------------------------------------------ */

/**
 * Telegram's API terms require a third-party client that shows channels to
 * display the official sponsored messages and to report their views and clicks
 * back — see https://core.telegram.org/api/terms. Nothing here may filter,
 * reorder or hide what the server returns.
 */
export type SponsoredItem = {
  /** Opaque handle for view/click reporting; the raw random_id stays below. */
  key: string;
  title: string;
  text: string;
  url: string;
  buttonText: string;
  /** "About this ad" details the server attaches to the promotion. */
  sponsorInfo: string;
  additionalInfo: string;
  recommended: boolean;
};

/** random_id is a Uint8Array — never let it reach Svelte state as a proxy. */
const sponsoredRandomIds = new Map<string, Uint8Array>();

const sponsoredKey = (randomId: Uint8Array) =>
  Array.from(randomId, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * The next sponsored message for a channel, or null when the server has none.
 *
 * The manager caches the response for five minutes and rotates through the
 * returned list, so calling this once per chat open is what the official
 * clients do.
 */
export async function loadSponsored(peerId: number): Promise<SponsoredItem | null> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appMessagesManager.getSponsoredMessage(peerId);
  const sponsored = result?.messages?.[0];
  if(!sponsored) return null;

  const key = sponsoredKey(sponsored.random_id);
  sponsoredRandomIds.set(key, sponsored.random_id);

  return {
    key,
    title: sponsored.title ?? '',
    text: sponsored.message ?? '',
    url: sponsored.url ?? '',
    buttonText: sponsored.button_text || 'Open',
    sponsorInfo: sponsored.sponsor_info ?? '',
    additionalInfo: sponsored.additional_info ?? '',
    recommended: !!sponsored.pFlags?.recommended
  };
}

/** Report that the sponsored message was actually shown to the user. */
export async function viewSponsored(key: string): Promise<void> {
  const randomId = sponsoredRandomIds.get(key);
  if(!randomId) return;
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.viewSponsoredMessage(randomId);
}

/** Report that the user opened the sponsored message's link. */
export async function clickSponsored(key: string): Promise<void> {
  const randomId = sponsoredRandomIds.get(key);
  if(!randomId) return;
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.clickSponsoredMessage(randomId);
}
