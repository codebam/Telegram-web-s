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
  isForum: boolean;
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
  kind: 'photo' | 'video' | 'sticker' | 'voice' | 'audio' | 'file';
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

    const kind: MediaItem['kind'] = sticker ? 'sticker' :
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

export async function loadDialogs(limit = 40): Promise<DialogItem[]> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const {dialogs} = await managers.dialogsStorage.getDialogs({limit, filterId: 0});

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
        isForum: !!peer?.pFlags?.forum,
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
    repliesCount: message.replies?.replies ?? 0
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

/** Tell the peer we are typing; tweb throttles the actual API calls. */
export async function sendTyping(peerId: number, threadId?: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.setTyping(peerId, {_: 'sendMessageTypingAction'}, undefined, threadId);
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
        isForum: !!peer?.pFlags?.forum,
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

export async function markRead(peerId: number, threadId?: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.readAllHistory(peerId, threadId);
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

  const isVideo = target.attributes?.some((a: any) => a._ === 'documentAttributeVideo');
  const isImage = media._ === 'messageMediaPhoto' ||
    target.mime_type?.startsWith('image/') ||
    isVideo;
  if(!isImage) {
    mediaUrls.set(key, null);
    return null;
  }

  try {
    // For a video we want its poster frame, so always download a thumb.
    const thumb = choosePhotoSize(target, boxWidth, boxWidth, true);
    const url = await appDownloadManager.downloadMediaURL({
      media: target,
      thumb: isVideo || media._ === 'messageMediaPhoto' ? thumb : undefined
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
