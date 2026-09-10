import getPeerId from '@appManagers/utils/peers/getPeerId';

import {bootTelegram} from './client';
import {extraOf, type MessageExtra} from './messageTypes';
import {formatAmount, paymentPreviewOf, type PaymentPreview} from './payments';
import {buildForwardInfo, buildReplyInfo, type ForwardInfo, type ReplyInfo} from './reply';
import {peerRestrictionText, restrictionTextOf} from './restrictions';
import type {MessageEntity, SendMessageAction} from '@layer';

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
  /** Supergroup — a channel peer that is not a broadcast channel. */
  isMegagroup: boolean;
  /** Broadcast channel — posts carry view counts, not delivery ticks. */
  isBroadcast: boolean;
  /**
   * A channel or supergroup we are not a member of (left, or found by username
   * and never joined): readable, but it cannot be posted to until we join.
   */
  left: boolean;
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

export type MediaItem = {
  kind: 'photo' | 'video' | 'gif' | 'sticker' | 'voice' | 'audio' | 'round' | 'file';
  /** Renderable thumbnail/full URL, resolved lazily via `loadMediaUrl`. */
  width: number;
  height: number;
  name: string;
  size: number;
  duration: number;
  /**
   * Packed waveform bytes of a voice note (100 five-bit samples). Decoded for
   * drawing by `decodeWaveform` in `$lib/telegram/voice`.
   */
  waveform?: Uint8Array;
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
  /**
   * The sender hid this media behind a spoiler. It has to render covered until
   * the viewer asks to see it — that is the whole point of the flag.
   */
  spoiler: boolean;
  /** Document id for document-backed media ('' for photos) — used by saved GIFs. */
  docId: string;
};

/**
 * Reply headers carry more than an id — a quote, a cross-chat target, a media
 * thumbnail — so their shape lives with the rest of the reply logic.
 */
export type ReplyPreview = ReplyInfo;

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
  /**
   * Which kind of searchable tag this run is, when `mentionKind` is 'tag'. A
   * hashtag and a cashtag open a search for the text in this chat, a bot command
   * is sent; the tag itself stays in `mention`.
   */
  tagKind?: 'hashtag' | 'cashtag' | 'botCommand';
  /**
   * `messageEntityBlockquote` with Telegram's collapsed flag: the quote starts
   * clipped to three lines and opens when it is clicked.
   */
  blockquoteCollapsed?: boolean;
  /** Language of a `pre` block, '' when the sender gave none. */
  preLanguage?: string;
  /** A `messageEntityFormattedDate` run: unix seconds plus the flags the server
   *  sent, which say how to render it (relative, short/long date, time, day). */
  dateUnix?: number;
  dateFlags?: {relative?: true; short_time?: true; long_time?: true; short_date?: true; long_date?: true; day_of_week?: true};
  /** Document id of the custom emoji this run renders as, when it is one. */
  customEmojiDocId?: string;
};

export type RichBlock =
  | {type: 'paragraph'; parts: TextPart[]}
  | {type: 'heading'; level: number; parts: TextPart[]}
  | {type: 'code'; text: string; lang?: string}
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
  /** The chat's pinned message right now, for the Pin/Unpin menu entry. */
  pinned: boolean;
  date: number;
  fromTitle: string;
  fromId: number;
  service: boolean;
  media: MediaItem | null;
  reply: ReplyPreview | null;
  /** Comment thread (discussion) attached to this message, if any. */
  repliesCount: number;
  /** Peer ids of the newest commenters, for the avatars on the comments button. */
  commenters: number[];
  reactions: ReactionItem[];
  /** Album id — consecutive messages sharing one render as a single bubble. */
  groupedId: string;
  /**
   * Telegram's "caption above media": the sender asked for the text to lead and
   * the attachment to follow, which is what the bubble has to draw.
   */
  captionAboveMedia: boolean;
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
  /** Full forward header — source peer, post link, hidden-sender handling. */
  forward: ForwardInfo | null;
  webpage: WebPagePreview | null;
  poll: PollPreview | null;
  /**
   * Location, venue, contact, game, invoice, checklist or gift body — the
   * message types `media` cannot describe. Null for everything else.
   */
  extra: MessageExtra | null;
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
  /**
   * Invoice, paid media, giveaway or gift attached to this message — null for
   * the overwhelming majority. Shaped and rendered by `$lib/telegram/payments`.
   */
  payment: PaymentPreview | null;
};

/** A single button from a message's `reply_markup`. */
export type MessageButton = {
  row: number;
  column: number;
  kind:
    | 'url'
    | 'loginUrl'
    | 'callback'
    | 'webview'
    | 'simpleWebView'
    | 'switchInline'
    | 'text'
    | 'copy'
    | 'buy'
    | 'game'
    | 'userProfile'
    | 'requestPhone'
    | 'requestGeo'
    | 'requestPoll'
    | 'unsupported';
  text: string;
  /** Web-app and link buttons carry their own URL. */
  url: string;
  /** `switchInline` query, `copy` payload. */
  payload: string;
  samePeer: boolean;
  /** `userProfile` target, 0 for every other kind. */
  userId: number;
  /** `loginUrl` button id the server needs to authorise the link. */
  buttonId: number;
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
      unread: !!message.pFlags?.media_unread,
      spoiler: !!media.pFlags?.spoiler,
      docId: ''
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
      video?.pFlags?.round_message ? 'round' :
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
      waveform: audio?.waveform,
      // A one-time voice message or video note carries the same flag as a
      // self-destructing photo, plus `round_message` / `voice` once-flags.
      selfDestruct: !!media.ttl_seconds,
      unread: !!message.pFlags?.media_unread,
      spoiler: !!media.pFlags?.spoiler,
      docId: '' + document.id
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
        case 'messageEntityPre': part.pre = true; part.preLanguage = entity.language || undefined; break;
        case 'messageEntitySpoiler': part.spoiler = true; break;
        case 'messageEntityBlockquote':
          part.blockquote = true;
          part.blockquoteCollapsed = !!entity.pFlags?.collapsed;
          break;
        case 'messageEntityFormattedDate':
          part.dateUnix = entity.date;
          part.dateFlags = entity.pFlags;
          break;
        case 'messageEntityCustomEmoji': part.customEmojiDocId = '' + entity.document_id; break;
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
          part.mention = part.text;
          part.mentionKind = 'tag';
          part.tagKind = 'hashtag';
          break;
        case 'messageEntityCashtag':
          part.mention = part.text;
          part.mentionKind = 'tag';
          part.tagKind = 'cashtag';
          break;
        case 'messageEntityBotCommand':
          part.mention = part.text;
          part.mentionKind = 'tag';
          part.tagKind = 'botCommand';
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
    case 'textDate':
      return richTextToParts(rich.text, {
        ...inherited,
        dateUnix: rich.date,
        dateFlags: rich.pFlags
      });
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
        out.push({type: 'code', text: partsToText(richTextToParts(block.text)), lang: block.language || undefined});
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
    case 'round': return '📹 Video message';
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

/**
 * The sentence Telegram shows for a service message — the wording upstream
 * keeps in its language pack, with the entities (`**bold**`, `[text](url)`)
 * dropped because this client renders the result as one plain string.
 *
 * Two rules run through every branch: an outgoing message speaks as "You" and
 * drops the actor argument, and a branch that needs to know whether the chat is
 * a broadcast channel or a group resolves the chat lazily, so the messages that
 * do not care pay nothing for it.
 */
async function serviceText(message: any): Promise<string> {
  const action = message?.action;
  if(!action) return 'Service message';

  const selfId = await getSelfId();
  const actorId = Number(message.fromId ?? message.from_id?.user_id ?? 0);
  const actor = await actorName(actorId, selfId);
  const peerId = Number(message?.peerId ?? 0);

  // Outgoing-ness is what picks the `…You` half of the language pack.
  const out = !!message.pFlags?.out || (!!actorId && actorId === selfId);
  const speaker = out ? 'You' : actor;

  let chatPromise: Promise<any> = null;
  const chat = () => chatPromise ?? (chatPromise = servicePeer(peerId));
  const isBroadcast = async() => {
    const peer = await chat();
    return !!(peer?._ === 'channel' && peer?.pFlags?.broadcast);
  };

  switch(action._) {
    /* --- people coming and going ---------------------------------- */

    case 'messageActionChatAddUser':
    case 'messageActionChatAddUsers': {
      const ids = (action.users ?? []).map(Number);
      // Joining a group by tapping its link arrives as an add of oneself.
      if(ids.length === 1 && ids[0] === actorId) return `${actor} joined the group`;
      const names = await Promise.all(ids.map((id: number) => actorName(id, selfId)));
      return `${actor} added ${names.length ? joinNames(names) : 'a user'}`;
    }

    case 'messageActionChatDeleteUser': {
      const id = Number(action.user_id);
      if(id === actorId) return `${actor} left the group`;
      return `${actor} removed ${await actorName(id, selfId)}`;
    }

    case 'messageActionChatLeave':
      return `${actor} left the group`;

    case 'messageActionChatLeaveYou':
      return 'You left this group';

    case 'messageActionChatJoined':
      return `${actor} joined the group`;

    case 'messageActionChatJoinedYou':
      return 'You joined this group';

    case 'messageActionChatReturn':
      return `${actor} returned to the group`;

    case 'messageActionChatReturnYou':
      return 'You returned to the group';

    case 'messageActionChatJoinedByLink':
      return `${actor} joined the group via invite link`;

    case 'messageActionChatJoinedByRequest': {
      if(out) {
        return await isBroadcast() ?
          'Your request to join the channel was approved' :
          'Your request to join the group was approved';
      }

      return await isBroadcast() ?
        `${actor} joined the channel by request` :
        `${actor} was accepted to the group`;
    }

    case 'messageActionContactSignUp':
      return `${actor} joined Telegram`;

    /* --- the chat itself ------------------------------------------ */

    case 'messageActionChatCreate':
      // Upstream hides an outgoing one: the sender did it, so naming them again
      // and repeating the title only makes the line longer.
      return out ? 'You created the group' : `${actor} created the group`;

    case 'messageActionChannelCreate': {
      const peer = await chat();
      return peer?._ === 'channel' && peer?.pFlags?.monoforum ?
        'Direct Messages Opened' :
        'Channel created';
    }

    case 'messageActionChatEditTitle': {
      const title = action.title ?? '';
      return title ? `${actor} changed the group name to ${title}` : `${actor} changed the group name`;
    }

    case 'messageActionChannelEditTitle': {
      const title = action.title ?? '';
      return title ? `Channel renamed to "${title}"` : 'Channel renamed';
    }

    case 'messageActionChatEditPhoto':
    case 'messageActionChatEditVideo':
      return `${actor} changed the group photo`;

    case 'messageActionChannelEditPhoto':
    case 'messageActionChannelEditVideo':
      return 'Channel photo updated';

    case 'messageActionChatDeletePhoto':
      return `${actor} removed the group photo`;

    case 'messageActionChannelDeletePhoto':
      return 'Channel photo removed';

    case 'messageActionChatMigrateTo':
    case 'messageActionChannelMigrateFrom':
      // Upstream drops both from the chat view; this is the wording its own
      // language pack carries for the migration, so the preview still reads.
      return 'This group was upgraded to a supergroup';

    case 'messageActionHistoryClear':
      return 'History was cleared';

    case 'messageActionDiscussionStarted':
      return 'Discussion started';

    case 'messageActionChannelJoined':
      return 'You joined this channel';

    case 'messageActionPinMessage': {
      const pinned = await serviceReplied(message);
      const preview = pinned ? truncateText(await messagePreview(pinned), 60) : '';
      return preview ? `${actor} pinned "${preview}"` : `${actor} pinned a message`;
    }

    /* --- calls and group calls ------------------------------------ */

    case 'messageActionPhoneCall': {
      const call = phoneCallState(action);
      if(call.state === 'ok') {
        const name = `${out ? 'Outgoing' : 'Incoming'}${call.video ? ' Video' : ''} Call`;
        return action.duration === undefined ? name : `${name} (${durationText(action.duration)})`;
      }

      return `${call.video ? 'Video ' : ''}${call.state === 'missed' ? 'Missed' : 'Canceled'} Call`;
    }

    case 'messageActionConferenceCall': {
      const ended = action.duration !== undefined;
      if(!ended) {
        if(action.pFlags?.missed) return out ? 'Declined group call' : 'Missed group call';
        return action.pFlags?.active ? 'Ongoing group call' : 'Group call invitation';
      }

      return out ? 'Outgoing group call' : 'Incoming group call';
    }

    case 'messageActionGroupCall': {
      // The manager stamps `type` when it rewrites the action; recompute it for
      // messages cached before that rewrite.
      let type = action.type;
      if(!type) {
        type = (action.duration === undefined ? 'started' : 'ended') +
          (await isBroadcast() ? '' : (out ? '_byYou' : '_by'));
      }

      const duration = action.duration === undefined ? '' : ` (${durationText(action.duration)})`;
      switch(type) {
        case 'started': return 'Live Stream started';
        case 'started_byYou': return 'You started a video chat';
        case 'ended': return `Live Stream ended${duration}`;
        case 'ended_byYou': return `You ended the video chat${duration}`;
        case 'ended_by': return `${actor} ended the video chat${duration}`;
        default: return `${actor} started a video chat`;
      }
    }

    case 'messageActionInviteToGroupCall': {
      const inviteeId = Number((action.users ?? [])[0] ?? 0);
      if(out) return `You invited ${await actorName(inviteeId, selfId)} to the video chat`;
      if(inviteeId === selfId) return `${actor} invited you to the video chat`;
      return `${actor} invited ${await actorName(inviteeId, selfId)} to the video chat`;
    }

    case 'messageActionGroupCallScheduled': {
      const when = dateAtTimeText(Number(action.schedule_date ?? 0));
      if(await isBroadcast()) return `Video chat scheduled for ${when}`;
      return out ? `You scheduled a video chat for ${when}` : `${actor} scheduled a video chat for ${when}`;
    }

    /* --- chat settings -------------------------------------------- */

    case 'messageActionSetMessagesTTL': {
      const period = Number(action.period ?? 0);
      if(!period) {
        if(await isBroadcast()) return 'Messages in this channel will no longer be automatically deleted';
        return `${actor} disabled the auto-delete timer`;
      }

      const duration = ttlDurationText(period);
      if(await isBroadcast()) return `Messages in this channel will be automatically deleted after ${duration}`;
      return `${actor} set messages to auto-delete in ${duration}`;
    }

    case 'messageActionSetChatTheme': {
      const emoticon = action.theme?.emoticon;
      if(emoticon) return `${speaker} changed the chat theme to ${emoticon}`;
      if(action.theme?._ === 'chatThemeUniqueGift') return `${speaker} changed the chat theme`;
      return `${speaker} disabled the chat theme`;
    }

    case 'messageActionSetChatWallPaper': {
      const peer = await chat();
      const both = !!action.pFlags?.for_both;
      const same = !!action.pFlags?.same;
      if(peer?._ === 'user') {
        if(out) {
          if(both) return `You set a new wallpaper for ${await peerNameById(peerId, selfId)} and you`;
          return same ? 'You set the same wallpaper as your chat partner' : 'You set a new wallpaper for this chat';
        }

        return same ?
          `${actor} set your wallpaper as their own for this chat` :
          `${actor} set a new wallpaper for this chat`;
      }

      if(peer?._ === 'channel' && peer?.pFlags?.broadcast) return 'Channel set a new wallpaper';
      return actorId === peerId ? 'Group set a new wallpaper' : `${actor} set a new wallpaper`;
    }

    case 'messageActionChangeCommunity': {
      const peer = await chat();
      const communityPeer = action.community_id ? await servicePeer(servicePeerId(action.community_id)) : null;
      const community = communityPeer ?
        `${peerTitle(communityPeer, selfId)} community` :
        'a community';
      const added = !!action.community_id && Number(action.community_id) !== 0;

      if(peer?._ === 'user') {
        return added ? `The bot was added to ${community}` : 'The bot was removed from a community';
      }

      if(peer?._ === 'channel' && !peer?.pFlags?.megagroup) {
        return added ? `The channel was added to ${community}` : 'The channel was removed from a community';
      }

      if(added) return `${speaker} added this group to ${community}`;
      return `${speaker} removed this group from a community`;
    }

    case 'messageActionNoForwardsToggle': {
      const enabled = !!action.new_value;
      if(enabled === !!action.prev_value) {
        return enabled ? 'Sharing in this chat is still enabled' : 'Sharing in this chat is still disabled';
      }

      return `${speaker} ${enabled ? 'enabled' : 'disabled'} sharing in this chat`;
    }

    case 'messageActionNoForwardsRequest': {
      if(action.pFlags?.expired) return 'Sharing enable request has expired';
      return `${speaker} suggested to ${action.new_value ? 'disable' : 'enable'} sharing`;
    }

    case 'messageActionManagedBotCreated':
      return `The bot ${await peerNameById(Number(action.bot_id ?? 0), selfId)} was created`;

    case 'messageActionNewCreatorPending':
      return `${await peerNameById(Number(action.new_creator_id ?? 0), selfId)} will become the new owner in 7 days if ${actor} does not return.`;

    case 'messageActionChangeCreator':
      return `${actor} made ${await peerNameById(Number(action.new_creator_id ?? 0), selfId)} the new owner of the group.`;

    /* --- topics --------------------------------------------------- */

    case 'messageActionTopicCreate': {
      const title = action.title ?? '';
      return title ? `${title} was created` : 'Topic created';
    }

    case 'messageActionTopicEdit': {
      const iconChanged = action.icon_emoji_id !== undefined;
      const iconRemoved = iconChanged && !Number(action.icon_emoji_id);
      const titleChanged = action.title !== undefined;
      const title = action.title ?? '';

      if(action.closed) return `${speaker} closed the topic`;
      if(action.closed === false) return `${speaker} reopened the topic`;
      if(iconRemoved && titleChanged) return `${speaker} changed the topic name to "${title}" and removed icon`;
      if(iconChanged && titleChanged) return `${speaker} changed the topic name and icon to "${title}"`;
      if(iconRemoved) return `${speaker} removed the icon`;
      if(titleChanged) return `${speaker} changed topic name to "${title}"`;
      if(iconChanged) return `${speaker} changed topic icon`;
      if(action.hidden !== undefined) return `${speaker} ${action.hidden ? 'hid' : 'unhid'} the general topic`;

      // No flag this client knows about — upstream would print the raw type.
      return `${speaker} updated the topic`;
    }

    /* --- chats, polls and checklists ------------------------------ */

    case 'messageActionPollAppendAnswer':
    case 'messageActionPollDeleteAnswer': {
      const answer = truncateText(action.answer?.text?.text ?? '', 20);
      const added = action._ === 'messageActionPollAppendAnswer';
      return `${speaker} ${added ? 'added' : 'deleted'} ${answer} ${added ? 'to' : 'from'} the poll`;
    }

    case 'messageActionTodoAppendTasks': {
      const list = await serviceTodoList(message);
      if(!list) return `${speaker} added a task to the checklist`;

      const tasks = (action.list ?? []).map((item: any) => item.title?.text ?? '');
      const listTitle = list.title?.text ?? '';
      return tasks.length === 1 ?
        `${speaker} added a new task "${truncateText(tasks[0], 60)}" to "${listTitle}".` :
        `${speaker} added ${quoteNames(tasks)} to "${listTitle}".`;
    }

    case 'messageActionTodoCompletions': {
      const list = await serviceTodoList(message);
      const titles = new Map<number, string>();
      for(const item of list?.list ?? []) titles.set(Number(item.id), item.title?.text ?? '');

      const names = (ids: any[]) => quoteNames(
        (ids ?? []).map((id) => titles.get(Number(id))).filter(Boolean).map((title: string) => truncateText(title, 60))
      );

      const done = names(action.completed);
      const undone = names(action.incompleted);
      if(!list || (!done && !undone)) return `${speaker} updated the checklist`;
      if(!undone) return `${speaker} marked ${done} as done.`;
      if(!done) return `${speaker} marked ${undone} as not done.`;
      return `${speaker} marked ${done} as done and ${undone} as not done.`;
    }

    /* --- games, gifts and money ----------------------------------- */

    case 'messageActionGameScore': {
      const game = (await serviceReplied(message))?.media;
      const title = game?._ === 'messageMediaGame' ? game.game?.title : '';
      const scored = out ? `You scored ${action.score}` : `${actor} scored ${action.score}`;
      return title ? `${scored} in ${title}` : scored;
    }

    case 'messageActionGiftPremium':
    case 'messageActionGiftStars':
    case 'messageActionGiftTon': {
      const amount = await moneyText(action.amount, action.currency);
      return out ? `You have sent a gift for ${amount}` : `${actor} sent you a gift for ${amount}`;
    }

    case 'messageActionGiftCode': {
      // Without an amount this is the recipient's side of a gift link: the
      // wording is the "you've received a gift" one, not the purchase one.
      if(action.amount === undefined && action.crypto_amount === undefined) {
        if(!action.boost_peer) return 'You\'ve received a gift.';
        return `You\'ve received a gift from ${await peerNameById(servicePeerId(action.boost_peer), selfId)}.`;
      }

      const amount = await moneyText(action.amount, action.currency);
      return out ? `You have sent a gift for ${amount}` : `${actor} sent you a gift for ${amount}`;
    }

    case 'messageActionPrizeStars':
      return 'You\'ve received a gift.';

    case 'messageActionStarGift':
    case 'messageActionStarGiftUnique':
      return await starGiftText(message, action, selfId, out);

    case 'messageActionStarGiftPurchaseOffer': {
      const offered = `${starsText(starsAmountOf(action.price))} for ${collectibleName(action.gift)}`;
      return out ?
        `You offered ${await peerNameById(peerId, selfId)} ${offered}` :
        `${await peerNameById(peerId, selfId)} offered you ${offered}`;
    }

    case 'messageActionStarGiftPurchaseOfferDeclined': {
      const peer = await peerNameById(peerId, selfId);
      const price = starsText(starsAmountOf(action.price));
      const name = collectibleName(action.gift);
      if(action.pFlags?.expired) return `Your offer to ${peer} has expired. ${price} for ${name}`;
      return out ?
        `You rejected ${peer}'s offer to buy your ${name} for ${price}` :
        `${peer} rejected your offer of ${name} for ${price}`;
    }

    case 'messageActionSuggestProfilePhoto':
      return out ?
        `You suggested ${await peerNameById(peerId, selfId)} to use this profile photo` :
        `${actor} suggests this photo for your Telegram profile`;

    case 'messageActionSuggestBirthday':
      return out ?
        `You suggested ${await peerNameById(peerId, selfId)} to add a birthday` :
        `${actor} suggested you add your birthday`;

    case 'messageActionGiveawayLaunch': {
      const stars = Number(action.stars ?? 0);
      return stars ?
        `${actor} just started a giveaway of ${starsText(stars)} to its followers.` :
        `${actor} just started a giveaway of Telegram Premium subscriptions to its followers.`;
    }

    case 'messageActionGiveawayResults':
      return giveawayResultsText(action);

    case 'messageActionBoostApply':
      return `${actor} boosted the group ${Number(action.boosts ?? 0)} times`;

    case 'messageActionPaymentSent': {
      const price = await moneyText(action.total_amount, action.currency);
      const payee = await peerNameById(peerId, selfId);
      const invoice = (await serviceReplied(message))?.media;
      const forWhat = invoice?._ === 'messageMediaInvoice' && invoice.title ? ` for ${invoice.title}` : '';

      if(action.pFlags?.recurring_used) {
        return `You have just successfully transferred ${price} to ${payee}${forWhat} via recurrent payments`;
      }

      if(action.pFlags?.recurring_init) {
        return `You successfully transferred ${price} to ${payee}${forWhat} and allowed future recurring payments`;
      }

      return `You have successfully transferred ${price} to ${payee}${forWhat}`;
    }

    case 'messageActionPaymentSentMe': {
      // The payee's copy of the same receipt. Upstream has no wording for it at
      // all (no case, no fallback entry), so this is the sentence its pair uses,
      // read from the other side.
      const price = await moneyText(action.total_amount, action.currency);
      return `${actor} transferred ${price} to you`;
    }

    case 'messageActionPaymentRefunded':
      return `${actor} refunded ${await moneyText(action.total_amount, action.currency)}`;

    case 'messageActionPaidMessagesRefunded': {
      const stars = starsText(Number(action.stars ?? 0));
      const paidPeerId = servicePeerId(message.saved_peer_id) || peerId;
      const payer = await peerNameById(paidPeerId, selfId);
      return out ? `You refunded ${stars} to ${payer}` : `${payer} refunded ${stars} to you`;
    }

    case 'messageActionPaidMessagesPrice': {
      const stars = Number(action.stars ?? 0);
      if(await isBroadcast()) {
        if(!action.pFlags?.broadcast_messages_allowed) return `${actor} disabled direct messages`;
        return stars ?
          `${actor} now accepts direct messages for ${starsText(stars)}` :
          `${actor} now accepts direct messages for free`;
      }

      return stars ? `Messages now cost ${starsText(stars)} in this group` : 'Messages in this group are now free';
    }

    case 'messageActionSuggestedPostApproval': {
      if(action.pFlags?.balance_too_low) return '❌ Balance too low to publish the suggested post';
      if(action.pFlags?.rejected) return '❌ The post was rejected';
      return '🤝 Agreement Reached!';
    }

    case 'messageActionSuggestedPostSuccess':
      return `✅ The channel was awarded ${starsText(starsAmountOf(action.price))} for publishing the post`;

    case 'messageActionSuggestedPostRefund':
      return 'The stars were returned because the message was deleted';

    /* --- everything else ------------------------------------------ */

    case 'messageActionRequestedPeer': {
      const peers = await Promise.all((action.peers ?? []).map((peer: any) => peerNameById(servicePeerId(peer), selfId)));
      return `${speaker} shared ${joinNames(peers)} with ${await peerNameById(peerId, selfId)}.`;
    }

    case 'messageActionBotAllowed': {
      if(action.pFlags?.attach_menu) return 'You allowed this bot to message you when you added it to your attachment menu.';
      if(action.pFlags?.from_request) return 'You allowed this bot to message you when you accepted its request.';
      if(action.domain) return `You allowed this bot to message you when you logged in on ${action.domain}`;
      // No wording upstream either — the splitter's own text is the last resort.
      break;
    }

    case 'messageActionWebViewDataSent':
    case 'messageActionWebViewDataSentMe':
      return `Data from the "${action.text ?? ''}" button was transferred to the bot.`;

    case 'messageActionScreenshotTaken':
      return out ? 'You took a screenshot' : 'Screenshot taken';

    case 'messageActionGeoProximityReached': {
      const fromId = servicePeerId(action.from_id);
      const toId = servicePeerId(action.to_id);
      const distance = `${Number(action.distance ?? 0)} m`;
      if(fromId === selfId) return `You are now within ${distance} of ${await peerNameById(toId, selfId)}`;
      if(toId === selfId) return `${await peerNameById(fromId, selfId)} is now within ${distance} of you`;
      return `${await peerNameById(fromId, selfId)} is now within ${distance} of ${await peerNameById(toId, selfId)}`;
    }

    case 'messageActionCustomAction':
      return action.message ?? 'Service message';
  }

  // "messageActionChatAddUser" → "Chat add user"
  const words = (action._ ?? '').replace(/^messageAction/, '').replace(/([A-Z])/g, ' $1').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : 'Service message';
}

/* ------------------------------------------------------------------ */
/* Service-message wording helpers                                     */
/* ------------------------------------------------------------------ */

/**
 * "A, B and C" — upstream joins names with the language pack's own delimiters
 * (`", "`, `" and "` for the last one) instead of `Array.join`.
 */
function joinNames(names: string[]): string {
  if(names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The same join with every name quoted — the checklist wording quotes its items. */
function quoteNames(names: string[]): string {
  return joinNames(names.map((name) => `"${name}"`));
}

/** "1 Star" / "5 Stars" — the `Stars` plural in the language pack. */
function starsText(stars: number): string {
  return countText(stars, 'Star');
}

function countText(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * A duration worded the way the language pack words it: the two largest units
 * that are not zero, largest first — `formatDuration(…, 2)` in tweb.
 */
function durationText(seconds: number): string {
  const units = [
    {step: 1, unit: 'second'},
    {step: 60, unit: 'minute'},
    {step: 60, unit: 'hour'},
    {step: 24, unit: 'day'},
    {step: 7, unit: 'week'},
    {step: 365 / 12 / 7, unit: 'month'},
    {step: 12, unit: 'year'}
  ];

  const value = seconds || 1;
  const parts: string[] = [];
  let scale = 1;
  units.forEach((entry, index) => {
    scale = Math.round(scale * entry.step);
    if(value < scale) return;

    let count = value / scale;
    // Every unit but the largest one is reported modulo the next unit up.
    if(index !== units.length - 1) count %= units[index + 1].step;
    parts.push(countText(count | 0, entry.unit));
  });

  return parts.slice(-2).reverse().filter((part) => !part.startsWith('0 ')).join(', ') || countText(1, 'second');
}

/**
 * TTL periods get their own wording: anything above three weeks is rounded to
 * whole months, and a year or more to whole years.
 */
function ttlDurationText(period: number): string {
  if(period >= 31536000) return countText(period / 31536000 | 0, 'year');
  if(period > 1814400) return countText(period / 2592000 | 0, 'month');
  return durationText(period);
}

/** "today at 12:34" / "tomorrow at 12:34" / "31/12/24 at 12:34". */
function dateAtTimeText(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const time = new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit'}).format(date);

  const today = new Date();
  if(date.toDateString() === today.toDateString()) return `today at ${time}`;

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if(date.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;

  const day = new Intl.DateTimeFormat(undefined, {day: '2-digit', month: '2-digit', year: '2-digit'}).format(date);
  return `${day} at ${time}`;
}

/** Shortens a quoted fragment (a pinned message, a poll answer) to `max` characters. */
function truncateText(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

/** The chat a service message belongs to, or null when it cannot be resolved. */
async function servicePeer(peerId: number): Promise<any> {
  if(!peerId) return null;
  try {
    return await getPeer(peerId);
  } catch(err) {
    return null;
  }
}

/** Title of any peer, including our own account — unlike `actorName`, no "You". */
async function peerNameById(peerId: number, selfId: number): Promise<string> {
  const peer = await servicePeer(peerId);
  return peer ? peerTitle(peer, selfId) : 'Unknown';
}

/** The message a service message answers — a pin, a game score, an invoice, a checklist. */
async function serviceReplied(message: any): Promise<any> {
  const peerId = Number(message?.peerId ?? 0);
  const mid = Number(message?.reply_to_mid ?? 0);
  if(!peerId || !mid) return null;

  const {managers} = await bootTelegram();
  return managers.appMessagesManager.getMessageByPeer(peerId, mid).catch(() => null);
}

/** The `messageMediaToDo.todo` list a checklist action refers to, when cached. */
async function serviceTodoList(message: any): Promise<any> {
  const replied = await serviceReplied(message);
  return replied?.media?._ === 'messageMediaToDo' ? replied.media.todo : null;
}

/** A `Peer`/`PeerId` field as a peer id: users positive, chats negative. */
function servicePeerId(peer: any): number {
  if(!peer) return 0;
  if(typeof peer !== 'object') return Number(peer);

  if(peer.user_id !== undefined) return Number(peer.user_id);
  const chatId = peer.channel_id ?? peer.chat_id;
  return chatId === undefined ? 0 : -Math.abs(Number(chatId));
}

/** `StarsAmount` (or a plain Long) as a number of stars, or of nanoton for TON. */
function starsAmountOf(amount: any): number {
  if(!amount) return 0;
  if(typeof amount !== 'object') return Number(amount);
  return amount.nanos !== undefined ?
    Number(amount.amount) + Number(amount.nanos) / 1e9 :
    Number(amount.amount) / 1e9;
}

/** "Plush Fox #42" — a collectible's name, as `getCollectibleName` builds it. */
function collectibleName(gift: any): string {
  return `${gift?.title ?? ''} #${Number(gift?.num ?? 0).toLocaleString()}`;
}

/** A price in the currency's own wording. `payments.ts` owns that mapping for
 * every currency this client can meet — Stars, TON and fiat — so it is reused
 * here rather than re-derived. */
function moneyText(amount: any, currency: string): string {
  return formatAmount(Number(amount ?? 0), currency ?? '');
}

/** The call state the manager stamps on a call action, recomputed when absent. */
function phoneCallState(action: any): {video: boolean, state: 'ok' | 'missed' | 'cancelled'} {
  const type: string = action.type ?? '';
  const video = action.pFlags?.video !== undefined ? !!action.pFlags.video : type.startsWith('video_');

  if(type.endsWith('ok')) return {video, state: 'ok'};
  if(type.endsWith('missed')) return {video, state: 'missed'};
  if(type.endsWith('cancelled')) return {video, state: 'cancelled'};

  if(action.duration !== undefined) return {video, state: 'ok'};
  return {video, state: action.reason?._ === 'phoneCallDiscardReasonMissed' ? 'missed' : action.reason ? 'cancelled' : 'ok'};
}

/** The text of `Giveaway.Results` and the three sentences it combines with. */
function giveawayResultsText(action: any): string {
  const winners = Number(action.winners_count ?? 0);
  const unclaimed = Number(action.unclaimed_count ?? 0);

  if(!winners) {
    if(action.pFlags?.stars) {
      return 'Due to the giveaway terms, no winners could be selected by Telegram, all stars were credited to channel administrators.';
    }

    if(unclaimed === 1) {
      return 'Due to the giveaway terms, no winner could be selected by Telegram, 1 gift link was forwarded to channel administrators.';
    }

    return `Due to the giveaway terms, no winners could be selected by Telegram, all ${unclaimed} gift links were forwarded to channel administrators.`;
  }

  const selected = `${countText(winners, 'winner')} of the giveaway ${winners === 1 ? 'was' : 'were'}` +
    ` randomly selected by Telegram and received private ${winners === 1 ? 'message with giftcode.' : 'messages with giftcodes.'}`;

  if(!unclaimed) return selected;
  const codes = countText(unclaimed, 'undistributed link code');
  return `${selected} ${codes} ${unclaimed === 1 ? 'was' : 'were'} forwarded to channel administrators.`;
}

/** The wording of a star gift, which depends on who paid, who received and where. */
async function starGiftText(message: any, action: any, selfId: number, out: boolean): Promise<string> {
  const fromId = !action.pFlags?.prepaid_upgrade && action.from_id ?
    servicePeerId(action.from_id) :
    Number(message.fromId ?? 0);
  const unique = action._ === 'messageActionStarGiftUnique' ? action : null;
  const resale = unique?.resale_amount;
  const peerId = Number(message.peerId ?? 0);

  // A gift bought through our own offer is paid by us, even though it comes from
  // its previous owner — and a resale in our own dialog is always the one we
  // bought for ourselves.
  const boughtThroughOffer = !!resale && !!unique?.pFlags?.from_offer && !message.pFlags?.out;
  const direction = (boughtThroughOffer || (peerId === selfId && (resale || !fromId || fromId === selfId))) ?
    'self' :
    (out ? 'outgoing' : 'incoming');
  const isMine = direction !== 'incoming';

  const giftPeerId = servicePeerId(action.peer);
  const channelId = giftPeerId < 0 ? giftPeerId : 0;
  const channel = channelId ? `${await peerNameById(channelId, selfId)}` : '';
  const from = fromId ? `${await peerNameById(fromId, selfId)}` : '';

  const sentToChannel = (amount: string) => isMine ?
    `You sent a gift to ${channel} for ${amount}` :
    `${from} sent a gift to ${channel} for ${amount}`;

  if(action._ === 'messageActionStarGift') {
    const stars = starsText(Number(action.gift?.stars ?? 0));
    if(channelId) return sentToChannel(stars);
    if(direction === 'self') return `You bought a gift for ${stars}`;
    if(direction === 'outgoing') return `You sent a gift for ${stars}`;
    return `${from} sent you a gift for ${stars}`;
  }

  if(action.pFlags?.prepaid_upgrade) {
    // Somebody else paid for this upgrade, so the sentence is about who unpacked it.
    const helper = await peerNameById(peerId, selfId);
    return out ?
      `You unpacked the gift that ${helper} helped to upgrade.` :
      `${helper} unpacked the gift that you helped to upgrade.`;
  }

  const sold = !!(action.pFlags?.from_offer && message.pFlags?.out);
  if(resale && !sold) {
    const isTon = resale._ === 'starsTonAmount';
    const amount = isTon ? `${starsAmountOf(resale)} Grams` : starsText(starsAmountOf(resale));
    if(channelId) return sentToChannel(amount);
    if(direction === 'self') return `You bought a gift for ${amount}`;
    if(direction === 'outgoing') return `You sent a gift for ${amount}`;
    return `${from} sent you a gift for ${amount}`;
  }

  const upgraded = !!action.pFlags?.upgrade;
  if(channelId) {
    return isMine ?
      (upgraded ? `You turned this gift to ${channel} into a unique collectible` : `You transferred a gift to ${channel}`) :
      (upgraded ?
        `${from} turned this gift to ${channel} into a unique collectible` :
        `${from} transferred a gift to ${channel}`);
  }

  if(peerId === selfId) {
    return upgraded ? 'You turned this gift into a unique collectible' : 'You transferred a unique collectible';
  }

  const chat = await peerNameById(peerId, selfId);
  if(upgraded) {
    return out ?
      `You turned the gift from ${chat} into a unique collectible` :
      `${chat} turned the gift from you into a unique collectible`;
  }

  if(sold) return `You sold a gift to ${chat}`;
  return out ? `You transferred a gift to ${chat}` : `${chat} transferred a gift to you`;
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
        isMegagroup: peer?._ === 'channel' && !!peer?.pFlags?.megagroup,
        isBroadcast: peer?._ === 'channel' && !!peer?.pFlags?.broadcast,
        left: peer?._ === 'channel' && !!peer?.pFlags?.left,
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

  const forward = await buildForwardInfo(message, selfId);

  return {
    mid: message.mid,
    text,
    parts: message._ === 'messageService' ? [{text}] : textParts(text, entities),
    editable: out && message._ !== 'messageService',
    edited: !!message.edit_date,
    out,
    pinned: !!message.pFlags?.pinned,
    date: message.date,
    fromTitle: fromId === selfId ? 'You' : peerTitle(fromPeer, selfId),
    fromId,
    service: message._ === 'messageService',
    media: mediaOf(message),
    reply: await buildReplyInfo(message, peerId, selfId),
    repliesCount: message.replies?.replies ?? 0,
    commenters: (message.replies?.recent_repliers ?? [])
      .map((peer: any) => Number(getPeerId(peer)))
      .filter(Boolean),
    reactions: reactionsOf(message),
    groupedId: message.grouped_id ? '' + message.grouped_id : '',
    captionAboveMedia: !!message.pFlags?.invert_media,
    stickerDocId: isStickerMessage(message) ? '' + message.media.document.id : '',
    stickerKind: isStickerMessage(message) ? stickerKind(message.media.document) : '',
    pending: !!message.pFlags?.is_outgoing,
    views: message.views ?? 0,
    forwardedFrom: forward?.title ?? '',
    forward,
    webpage: webpageOf(message),
    poll: pollOf(message),
    extra: extraOf(message, peerId, selfId),
    rich: richBlocksOf(message),
    buttons: buttonsOf(message),
    restrictionText: await restrictionTextOf(message.restriction_reason),
    payment: paymentPreviewOf(message)
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
  const base = {
    row,
    column,
    text: button.text ?? '',
    url: '',
    payload: '',
    samePeer: false,
    userId: 0,
    buttonId: 0
  };

  switch(button._) {
    case 'keyboardButtonUrl':
      return {...base, kind: 'url', url: button.url ?? ''};
    case 'keyboardButtonUrlAuth':
      return {...base, kind: 'loginUrl', url: button.url ?? '', buttonId: button.button_id ?? 0};
    case 'keyboardButtonBuy':
      return {...base, kind: 'buy'};
    case 'keyboardButtonGame':
      return {...base, kind: 'game'};
    case 'keyboardButtonUserProfile':
      return {...base, kind: 'userProfile', userId: Number(button.user_id ?? 0)};
    case 'keyboardButtonRequestPhone':
      return {...base, kind: 'requestPhone'};
    case 'keyboardButtonRequestGeoLocation':
      return {...base, kind: 'requestGeo'};
    case 'keyboardButtonRequestPoll':
      return {...base, kind: 'requestPoll'};
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
  column: number,
  game = false
): Promise<{message: string; alert: boolean; url: string}> {
  const {managers} = await bootTelegram();

  const message = rawMessages.get(messageKey(peerId, mid)) ??
    await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  const button = message?.reply_markup?.rows?.[row]?.buttons?.[column];

  const answer: any = await managers.appInlineBotsManager.callbackButtonClick(peerId, mid, button, game);
  return {
    message: answer?.message ?? '',
    alert: !!answer?.pFlags?.alert,
    url: answer?.url ?? ''
  };
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
  options: {threadId?: number; limit?: number; offsetId?: number; savedReaction?: string} = {}
): Promise<MessageItem[]> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const {threadId, limit = 40, offsetId, savedReaction} = options;

  const result = await managers.appMessagesManager.getHistory({
    peerId,
    limit,
    threadId,
    offsetId,
    // Saved Messages filtered by tag. The manager turns this into a search
    // rather than a plain history request.
    savedReaction: savedReaction ? [{_: 'reactionEmoji', emoticon: savedReaction}] : undefined,
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
  options: {
    replyToMsgId?: number;
    threadId?: number;
    entities?: MessageEntity[];
    /** Set only when replying to a message in a different chat. */
    replyToPeerId?: number;
    /** Excerpt of the original the reply quotes, with its offset into it. */
    replyToQuote?: {text: string; offset: number};
  } = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendText({
    peerId,
    text,
    entities: options.entities,
    clearDraft: true,
    replyToMsgId: options.replyToMsgId ?? options.threadId,
    threadId: options.threadId,
    replyToPeerId: options.replyToPeerId,
    replyToQuote: options.replyToQuote
  } as any);
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

/**
 * Whether this chat's pin is ours to set: a private chat always, a group or
 * channel only with the `pin_messages` right — the same rule tweb's own menu
 * uses before it offers Pin.
 */
export async function canPin(peerId: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  return !!(await managers.appPeersManager.canPinMessage(peerId));
}

/**
 * Pin a message, or unpin it. The server defaults are what tweb's popup sends
 * with its checkboxes untouched: the pin counts for both sides and notifies the
 * chat. A silently-notified pin is a separate gesture we do not offer.
 */
export async function pinMessage(peerId: number, mid: number, unpin = false): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.updatePinnedMessage(peerId, mid, unpin);
}

/**
 * Whether this message can be edited at all — Telegram's own rules, which no
 * client-side flag can express: the 48-hour window for chats and groups, a
 * forwarded message, a bot-authored one, a sticker or a round video. Asked when
 * the message menu opens, because the answer needs the live config.
 */
export async function canEditMessage(peerId: number, mid: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  const message = rawMessages.get(messageKey(peerId, mid)) ??
    await managers.appMessagesManager.getMessageByPeer(peerId, mid);

  if(!message) return false;
  return !!(await managers.appMessagesManager.canEditMessage(message, 'text'));
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
 * What we can be doing in a chat, and what a peer can be doing in one.
 *
 * Telegram gives each one its own action, and the client is expected to send the
 * right one: a contact who is recording a voice message should read "recording
 * voice", not "typing". `cancel` is not an activity — it is the action that
 * clears ours.
 */
export type TypingKind =
  | 'typing'
  | 'cancel'
  | 'sticker'
  | 'game'
  | 'voice'
  | 'round'
  | 'video'
  | 'photo'
  | 'audio'
  | 'document';

/**
 * Telegram's action name for each kind — the one table, so a kind cannot exist
 * without an action and the literals stay literal for the API's own union type.
 */
const TYPING_ACTION_NAMES = {
  typing: 'sendMessageTypingAction',
  cancel: 'sendMessageCancelAction',
  sticker: 'sendMessageChooseStickerAction',
  game: 'sendMessageGamePlayAction',
  voice: 'sendMessageRecordAudioAction',
  round: 'sendMessageRecordRoundAction',
  video: 'sendMessageRecordVideoAction',
  photo: 'sendMessageUploadPhotoAction',
  audio: 'sendMessageUploadAudioAction',
  document: 'sendMessageUploadDocumentAction'
} as const satisfies Record<TypingKind, string>;

/** The same table backwards, for the activity a peer is showing us. */
const TYPING_KIND_BY_ACTION_NAME = Object.fromEntries(
  Object.entries(TYPING_ACTION_NAMES).map(([kind, name]) => [name, kind as TypingKind])
) as Record<string, TypingKind | undefined>;

/**
 * The phrase under a peer's name while something is going on — Telegram's own
 * wording for each action (the `Peer.Activity.User.*` strings). The caller puts
 * the names and the verb in front of it: "Alice is sending a photo".
 */
export function typingActionText(kind: TypingKind | undefined): string {
  switch(kind) {
    case 'photo': return 'sending a photo';
    case 'video': return 'sending a video';
    case 'round': return 'recording video';
    case 'voice': return 'recording voice';
    case 'audio':
    case 'document': return 'sending file';
    case 'sticker': return 'choosing a sticker';
    case 'game': return 'playing a game';
    default: return 'typing…';
  }
}

/**
 * Tell the peer what we are doing.
 *
 * The server expires a status after ~6s, so a long message needs the action
 * re-sent periodically — the caller throttles to ~4s. Sending the cancel action
 * clears it immediately once the message goes out, and the recorder and the
 * sticker picker send their own kind while they are open.
 */
export async function sendTyping(
  peerId: number,
  threadId?: number,
  kind: TypingKind = 'typing'
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.setTyping(
    peerId,
    // The API types each action as its own object, so the table's literal has to
    // be narrowed back into that union rather than the union of literals.
    {_: TYPING_ACTION_NAMES[kind]} as SendMessageAction,
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
        isMegagroup: peer?._ === 'channel' && !!peer?.pFlags?.megagroup,
        isBroadcast: peer?._ === 'channel' && !!peer?.pFlags?.broadcast,
        left: peer?._ === 'channel' && !!peer?.pFlags?.left,
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
 * Peers currently active in a chat, and what they are doing; returns an
 * unsubscribe callback.
 *
 * Telegram reports an action per user, so a chat where everyone happens to be
 * doing the same thing reads as that one thing ("Alice and Bob are sending a
 * photo"); a mix collapses to plain typing, which is what upstream does too.
 */
export async function onTyping(
  callback: (peerId: number, threadId: number | undefined, names: string[], kind?: TypingKind) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  const selfId = await getSelfId();

  const handler = async({peerId, threadId, typings}: any) => {
    const list = typings ?? [];
    const names = await Promise.all(
      list.map(async(typing: any) => peerTitle(await getPeer(Number(typing.userId)), selfId))
    );

    const kinds = list.map((typing: any) => TYPING_KIND_BY_ACTION_NAME[typing.action?._]);
    const shared = kinds.length && kinds.every((kind: TypingKind | undefined) => kind === kinds[0]) ? kinds[0] : undefined;

    callback(Number(peerId), threadId, names, shared);
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

/**
 * Drops the memoised avatar so the next read re-resolves it — used after an
 * upload, and after a load fails because the worker revoked the URL (see
 * `staleUrl.ts`).
 */
export function invalidateAvatarUrl(peerId: number): void {
  avatarUrls.delete(peerId);
}

/** Same, for one message's media: every size this tab asked for is forgotten. */
export function invalidateMediaUrl(peerId: number, mid: number): void {
  const prefix = `${messageKey(peerId, mid)}_`;
  for(const key of [...mediaUrls.keys()]) {
    if(key.startsWith(prefix)) mediaUrls.delete(key);
  }
}

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

/**
 * Make a document reachable by `loadDocUrl` / `sendDocument`. Anything a sibling
 * module pulls straight off a manager (GIF search results, set previews) has to
 * pass through here first, or sending it later fails with "Document not found".
 */
export function registerDoc(doc: any): void {
  if(doc?.id !== undefined) rawDocs.set('' + doc.id, doc);
}

export function toSticker(doc: any): StickerItem {
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

/**
 * Registers a sticker document that came from somewhere other than the sticker
 * APIs — star gifts, for one — so `loadDocUrl` can resolve it like any other.
 */
export function adoptSticker(doc: any): StickerItem {
  return toSticker(doc);
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

/**
 * Join a chat we are not a member of — a public channel or supergroup found by
 * username, or one we left. The manager picks the call the peer type needs, the
 * same way tweb's own join button does.
 */
export async function joinChat(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.joinPeer(peerId);
}

/** What a Clear History means for this chat — the description and the choice. */
export type ClearHistoryInfo = {
  can: boolean;
  kind: 'saved' | 'user' | 'bot' | 'group' | 'megagroup' | 'broadcast';
  /** Whether clearing can also apply to the other side, i.e. whether to offer it. */
  canRevokeForBoth: boolean;
};

/**
 * Whether this chat's history can be cleared, and what that would mean. The
 * permission rules are tweb's own (`canClearHistory`), so they are asked rather
 * than re-derived from the dialog flags — a member of a megagroup with no
 * username may still clear it, an admin of one with a username may not.
 */
export async function clearHistoryInfo(peerId: number): Promise<ClearHistoryInfo> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const peer = await getPeer(peerId);

  if(!peer) return {can: false, kind: 'user', canRevokeForBoth: false};

  const {default: canClear} = await import('@appManagers/utils/chats/canClearHistory');
  const can = !!canClear(peer);

  if(peer._ === 'user') {
    // Saved Messages is its own kind: Telegram words it differently and offers no
    // "also for them" — there is no other side.
    const kind = peerId === selfId ? 'saved' : (peer.pFlags?.bot && !peer.pFlags?.support ? 'bot' : 'user');
    return {
      can,
      kind,
      canRevokeForBoth: (!peer.pFlags?.bot || !!peer.pFlags?.support) && !peer.pFlags?.deleted
    };
  }

  if(peer._ === 'channel') {
    const kind = peer.pFlags?.megagroup ? 'megagroup' : 'broadcast';
    // Clearing a broadcast channel is always for everyone; a supergroup's members
    // can only be included by its creator.
    return {can, kind, canRevokeForBoth: kind === 'broadcast' ? true : !!peer.pFlags?.creator};
  }

  return {can, kind: 'group', canRevokeForBoth: !!peer.pFlags?.creator};
}

/**
 * Empty a chat's history but keep the chat itself — `justClear` is what makes the
 * difference: without it the manager drops the dialog entirely, which is
 * `leaveOrDelete`, not this.
 */
export async function clearHistory(peerId: number, revoke = false): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.flushHistory({peerId, justClear: true, revoke});
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

/* ------------------------------------------------------------------ */
/* Shared internals                                                    */
/* ------------------------------------------------------------------ */

/**
 * Re-exported for `./search.ts`, which builds the same plain items out of
 * search results and must format peers and messages identically. Not part of
 * the surface the components use.
 */
export {getSelfId, getPeer, peerTitle, previewOf, toItem};
