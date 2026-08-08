import {bootTelegram} from './client';

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
  isForum: boolean;
  pinned: boolean;
  muted: boolean;
  /** Highest message id the user has read — the "jump here on open" anchor. */
  readMaxId: number;
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
};

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
  /** Original author when the message was forwarded, '' otherwise. */
  forwardedFrom: string;
  webpage: WebPagePreview | null;
  poll: PollPreview | null;
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
      duration: 0
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
      duration: video?.duration ?? audio?.duration ?? 0
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
        case 'messageEntityMention': part.mention = part.text; break;
        case 'messageEntityMentionName': part.mention = String(entity.user_id); break;
        case 'messageEntityHashtag':
        case 'messageEntityCashtag':
        case 'messageEntityBotCommand': part.mention = part.text; break;
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

/** Short one-line description, used in the chat list and reply previews. */
function messagePreview(message: any): string {
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

function serviceText(message: any): string {
  const action = message.action?._ ?? '';
  // "messageActionChatAddUser" → "Chat add user"
  const words = action.replace(/^messageAction/, '').replace(/([A-Z])/g, ' $1').trim();
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
        preview: messagePreview(topMessage),
        date: topMessage?.date ?? 0,
        unread: dialog.unread_count ?? 0,
        isSelf: peerId === selfId,
        isUser: peer?._ === 'user',
        isForum: !!peer?.pFlags?.forum,
        pinned: !!dialog.pFlags?.pinned,
        muted: (dialog.notify_settings?.mute_until ?? 0) > Date.now() / 1000,
        readMaxId: dialog.read_inbox_max_id ?? 0
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
        preview: messagePreview(topMessage),
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

  const text = message._ === 'messageService' ? serviceText(message) : (message.message ?? '');
  // pFlags.out is not set on every outgoing message (Saved Messages, some
  // channel posts), so fall back to comparing the sender with ourselves.
  const out = !!message.pFlags?.out || fromId === selfId;

  return {
    mid: message.mid,
    text,
    parts: message._ === 'messageService' ? [{text}] : textParts(text, message.entities ?? []),
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
    forwardedFrom: await forwardedTitle(message, selfId),
    webpage: webpageOf(message),
    poll: pollOf(message)
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
    text: messagePreview(replied)
  };
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

  const messages = await Promise.all(
    result.history.map((mid: number) => managers.appMessagesManager.getMessageByPeer(peerId, mid))
  );

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
  options: {replyToMsgId?: number; threadId?: number} = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendText({
    peerId,
    text,
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

  const messages = await Promise.all(
    result.history.map((id: number) => managers.appMessagesManager.getMessageByPeer(peerId, id))
  );

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

  const messages = await Promise.all(
    result.history.map((mid: number) => managers.appMessagesManager.getMessageByPeer(peerId, mid))
  );

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

    const message = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
    return message ? toItem(message, peerId, selfId) : null;
  } catch(err) {
    return null;
  }
}

export async function editMessage(peerId: number, mid: number, text: string): Promise<void> {
  const {managers} = await bootTelegram();
  const message = rawMessages.get(messageKey(peerId, mid)) ??
    await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message) throw new Error('Message not found');
  await managers.appMessagesManager.editMessage(message, text);
}

export async function deleteMessage(peerId: number, mid: number, revoke = true): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.deleteMessages(peerId, [mid], revoke);
}

/** Upload and send files as media (photos/videos detected from mime type). */
export async function sendFiles(
  peerId: number,
  files: File[],
  options: {caption?: string; threadId?: number; replyToMsgId?: number} = {}
): Promise<void> {
  const {managers} = await bootTelegram();

  for(const [index, file] of files.entries()) {
    await managers.appMessagesManager.sendFile({
      peerId,
      file,
      isMedia: file.type.startsWith('image/') || file.type.startsWith('video/'),
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
        preview: messagePreview(topMessage),
        date: topMessage?.date ?? 0,
        unread: dialog.unread_count ?? 0,
        isSelf: peerId === selfId,
        isUser: peer?._ === 'user',
        isForum: !!peer?.pFlags?.forum,
        pinned: !!dialog.pFlags?.pinned,
        muted: (dialog.notify_settings?.mute_until ?? 0) > Date.now() / 1000,
        readMaxId: dialog.read_inbox_max_id ?? 0
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

/** Explicit "mark as read" action from the chat list. */
export async function markDialogRead(peerId: number, threadId?: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.readAllHistory(peerId, threadId);
}

export async function markDialogUnread(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.markDialogUnread({peerId, read: false});
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
export async function loadMediaUrl(peerId: number, mid: number, boxWidth = 480): Promise<string | null> {
  const key = messageKey(peerId, mid);
  if(mediaUrls.has(key)) return mediaUrls.get(key)!;

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
      mediaUrls.set(key, url ?? null);
      return url ?? null;
    } catch(err) {
      mediaUrls.set(key, null);
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
    mediaUrls.set(key, null);
    return null;
  }

  try {
    // For a video we want its poster frame, so download a thumb; GIFs and
    // photos-as-documents download in full.
    const thumb = choosePhotoSize(target, boxWidth, boxWidth, true);
    const url = await appDownloadManager.downloadMediaURL({
      media: target,
      thumb: !isGif && (isVideo || media._ === 'messageMediaPhoto') ? thumb : undefined
    });
    mediaUrls.set(key, url ?? null);
    return url ?? null;
  } catch(err) {
    console.error('[media] download failed', key, err);
    mediaUrls.set(key, null);
    return null;
  }
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

/** Subscribe to appended messages; returns an unsubscribe callback. */
export async function onNewMessage(callback: NewMessageHandler): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');

  const handler = (message: any) => {
    // Cache it right away so a following getMessage/loadMediaUrl is a local hit.
    callback(Number(message.peerId), message.mid, message.reply_to?.reply_to_top_id);
  };

  rootScope.addEventListener('history_multiappend', handler);
  return () => rootScope.removeEventListener('history_multiappend', handler);
}
