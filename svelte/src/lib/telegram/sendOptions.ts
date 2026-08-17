/**
 * Send options: schedule, silent delivery, message effects, slow mode and
 * send-as.
 *
 * Everything here goes through `appMessagesManager` / `appChatsManager` /
 * `appProfileManager` — the UI never touches `invokeApi`. The slow-mode and
 * send-as readers deliberately only look at *cached* full-chat state so that
 * opening a chat never pays for a new round trip; the fresh values arrive
 * later through `chat_full_update`.
 */

import {bootTelegram} from './client';
import {getPeerBrief} from './chats';

/**
 * Magic `schedule_date` the server reads as "deliver when the recipient comes
 * online". Mirrors SEND_WHEN_ONLINE_TIMESTAMP in tweb's appManagers/constants.
 */
export const SEND_WHEN_ONLINE = 0x7FFFFFFE;

/** The server rejects anything scheduled less than ~10s out. */
export const MIN_SCHEDULE_LEAD_SECONDS = 10;

export type SendOptions = {
  /** Unix seconds, or {@link SEND_WHEN_ONLINE}. Unset sends immediately. */
  scheduleDate?: number;
  /** Deliver without a notification sound. */
  silent?: boolean;
  /** Effect document id from {@link loadEffects}. */
  effect?: string;
  /** Post as this peer (channel/anonymous admin) instead of ourselves. */
  sendAsPeerId?: number;
};

export type SendTextArgs = SendOptions & {
  replyToMsgId?: number;
  threadId?: number;
  entities?: any[];
};

/**
 * `sendMessage` from chats.ts with the send options threaded through. Kept
 * separate rather than widening that function so the plain path stays plain.
 */
export async function sendMessageWithOptions(
  peerId: number,
  text: string,
  args: SendTextArgs = {}
): Promise<void> {
  const {managers} = await bootTelegram();

  await managers.appMessagesManager.sendText({
    peerId,
    text,
    clearDraft: true,
    replyToMsgId: args.replyToMsgId ?? args.threadId,
    threadId: args.threadId,
    entities: args.entities,
    scheduleDate: args.scheduleDate,
    silent: args.silent || undefined,
    effect: args.effect || undefined,
    sendAsPeerId: args.sendAsPeerId || undefined
  });
}

/* ------------------------------------------------------------------ */
/* Silent-send preference                                              */
/* ------------------------------------------------------------------ */

const SILENT_KEY = 'webs:silent-peers';

function silentSet(): Set<string> {
  if(typeof localStorage === 'undefined') return new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(SILENT_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch(err) {
    return new Set();
  }
}

/** Whether this chat is set to send without sound. Sync — read on chat open. */
export function isSilentByDefault(peerId: number): boolean {
  return silentSet().has('' + peerId);
}

export function setSilentByDefault(peerId: number, silent: boolean): void {
  if(typeof localStorage === 'undefined') return;
  const set = silentSet();
  if(silent) set.add('' + peerId);
  else set.delete('' + peerId);
  localStorage.setItem(SILENT_KEY, JSON.stringify([...set]));
}

/* ------------------------------------------------------------------ */
/* Scheduled messages                                                  */
/* ------------------------------------------------------------------ */

export type ScheduledItem = {
  mid: number;
  text: string;
  /** The scheduled delivery time, or {@link SEND_WHEN_ONLINE}. */
  date: number;
  /** True when the message is queued for "when the recipient is online". */
  whenOnline: boolean;
  /** Short label for media-only messages ('Photo', 'File', …), '' otherwise. */
  mediaLabel: string;
  silent: boolean;
};

function mediaLabelOf(message: any): string {
  const media = message?.media;
  if(!media) return '';
  switch(media._) {
    case 'messageMediaPhoto': return 'Photo';
    case 'messageMediaDocument': {
      const doc = media.document;
      if(doc?.type === 'voice') return 'Voice message';
      if(doc?.type === 'round') return 'Video message';
      if(doc?.type === 'sticker') return 'Sticker';
      if(doc?.type === 'gif') return 'GIF';
      if(doc?.type === 'video') return 'Video';
      return 'File';
    }
    case 'messageMediaPoll': return 'Poll';
    case 'messageMediaGeo':
    case 'messageMediaGeoLive': return 'Location';
    case 'messageMediaContact': return 'Contact';
    default: return 'Media';
  }
}

function toScheduled(message: any): ScheduledItem {
  return {
    mid: message.mid,
    text: message.message ?? '',
    date: message.date,
    whenOnline: message.date === SEND_WHEN_ONLINE,
    mediaLabel: mediaLabelOf(message),
    silent: !!message.pFlags?.silent
  };
}

/** Every message queued for later in this chat, soonest first. */
export async function loadScheduled(peerId: number): Promise<ScheduledItem[]> {
  const {managers} = await bootTelegram();

  const mids: number[] = (await managers.appMessagesManager.getScheduledMessages(peerId)) ?? [];
  if(!mids.length) return [];

  const messages = await Promise.all(
    mids.map((mid) => managers.appMessagesManager.getScheduledMessageByPeer(peerId, mid))
  );

  return messages
  .filter(Boolean)
  .map(toScheduled)
  // SEND_WHEN_ONLINE is a sentinel far in the future, so it naturally sorts
  // last — which is also where it belongs in the list.
  .sort((a, b) => a.date - b.date || a.mid - b.mid);
}

/** How many messages are queued, without building the full list. */
export async function countScheduled(peerId: number): Promise<number> {
  const {managers} = await bootTelegram();
  const mids: number[] = (await managers.appMessagesManager.getScheduledMessages(peerId)) ?? [];
  return mids.length;
}

/** Deliver queued messages right now. */
export async function sendScheduledNow(peerId: number, mids: number[]): Promise<void> {
  if(!mids.length) return;
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendScheduledMessages(peerId, mids);
}

export async function deleteScheduled(peerId: number, mids: number[]): Promise<void> {
  if(!mids.length) return;
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.deleteScheduledMessages(peerId, mids);
}

/**
 * Rewrite a queued message. Passing `scheduleDate` also moves it in the queue;
 * omitting it keeps the existing time (the manager falls back to the message's
 * own date for scheduled messages).
 */
export async function editScheduled(
  peerId: number,
  mid: number,
  text: string,
  options: {entities?: any[]; scheduleDate?: number} = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  const message = await managers.appMessagesManager.getScheduledMessageByPeer(peerId, mid);
  if(!message) throw new Error('Scheduled message not found');

  await managers.appMessagesManager.editMessage(message as any, text, {
    entities: options.entities,
    scheduleDate: options.scheduleDate
  });
}

/** Fires whenever the scheduled queue of any chat changes. */
export async function onScheduledUpdate(
  callback: (peerId: number) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');

  const onNew = (message: any) => callback(Number(message?.peerId));
  const onDelete = ({peerId}: any) => callback(Number(peerId));

  rootScope.addEventListener('scheduled_new', onNew);
  rootScope.addEventListener('scheduled_delete', onDelete);

  return () => {
    rootScope.removeEventListener('scheduled_new', onNew);
    rootScope.removeEventListener('scheduled_delete', onDelete);
  };
}

/* ------------------------------------------------------------------ */
/* Message effects                                                     */
/* ------------------------------------------------------------------ */

export type EffectItem = {
  id: string;
  emoticon: string;
  premiumRequired: boolean;
};

let effectsCache: EffectItem[] | null = null;
/** Raw AvailableEffect records, keyed by effect id, for the animation lookup. */
const rawEffects = new Map<string, any>();

/**
 * The effects the server offers. Cheap to call repeatedly — the manager caches
 * the API result and this keeps the mapped list.
 */
export async function loadEffects(): Promise<EffectItem[]> {
  if(effectsCache) return effectsCache;

  const {managers} = await bootTelegram();
  const effects: any[] = (await managers.appReactionsManager.getAvailableEffects()) ?? [];

  effectsCache = effects.map((effect) => {
    const id = '' + effect.id;
    rawEffects.set(id, effect);
    return {
      id,
      emoticon: effect.emoticon ?? '',
      premiumRequired: !!effect.pFlags?.premium_required
    };
  });

  return effectsCache;
}

export type EffectAnimation = {
  /** 'animated' is gzipped Lottie and only the tlottie worker can decode it. */
  kind: 'animated' | 'video' | 'static';
  /** Set for 'animated'; handed to lottieLoader as-is. */
  blob: Blob | null;
  /** Object URL for 'video' and 'static'. */
  url: string | null;
};

const animationCache = new Map<string, EffectAnimation | null>();

function kindOfDoc(doc: any): EffectAnimation['kind'] {
  // Check WebM first: video stickers also set `animated`, and routing one into
  // the Lottie decoder just makes it fail.
  if(doc?.mime_type === 'video/webm' || doc?.sticker === 3) return 'video';
  if(doc?.mime_type === 'application/x-tgsticker' || doc?.sticker === 2) return 'animated';
  return 'static';
}

/**
 * The full-screen animation for an effect. Prefers `effect_animation_id` (the
 * around-animation the official clients play) and falls back to the effect's
 * own sticker when the effect has none.
 */
export async function loadEffectAnimation(effectId: string): Promise<EffectAnimation | null> {
  if(animationCache.has(effectId)) return animationCache.get(effectId);

  await loadEffects();
  const effect = rawEffects.get(effectId);
  if(!effect) return null;

  const docId = '' + (effect.effect_animation_id ?? effect.effect_sticker_id ?? '');
  if(!docId) return null;

  const {managers} = await bootTelegram();
  const doc: any = await managers.appDocsManager.getDoc(docId);
  if(!doc) return null;

  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  try {
    const kind = kindOfDoc(doc);
    if(kind === 'animated') {
      const blob = await appDownloadManager.downloadMedia({media: doc});
      const result: EffectAnimation = {kind, blob: blob ?? null, url: null};
      animationCache.set(effectId, result);
      return result;
    }

    const url = await appDownloadManager.downloadMediaURL({media: doc});
    const result: EffectAnimation = {kind, blob: null, url: url ?? null};
    animationCache.set(effectId, result);
    return result;
  } catch(err) {
    animationCache.set(effectId, null);
    return null;
  }
}

/**
 * New messages carrying an `effect`, so the UI can play it once as it lands.
 * Reads the raw message off the history events rather than the mapped
 * MessageItem — `effect` is not part of that shape.
 */
export async function onMessageEffect(
  callback: (peerId: number, mid: number, effectId: string, out: boolean) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');

  const emit = (message: any) => {
    const effect = message?.effect;
    if(!effect) return;
    callback(Number(message.peerId), message.mid, '' + effect, !!message.pFlags?.out);
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

/* ------------------------------------------------------------------ */
/* Slow mode                                                           */
/* ------------------------------------------------------------------ */

export type SlowMode = {
  /** Cooldown length configured for the group, in seconds. */
  seconds: number;
  /** Unix seconds before which we may not post again; 0 when free to post. */
  nextSendDate: number;
};

/**
 * Slow-mode state for a group, read from the **cached** chatFull only.
 *
 * Deliberately never fetches: AGENTS.md forbids adding a round trip to the
 * chat-open path. If the full chat has not been loaded yet this returns null
 * and the caller re-reads on `chat_full_update`.
 */
export async function getSlowMode(peerId: number): Promise<SlowMode | null> {
  if(peerId >= 0) return null;

  const {managers} = await bootTelegram();
  const chatId = -peerId;

  const full: any = await managers.appProfileManager.getCachedFullChat(chatId);
  const seconds = full?.slowmode_seconds ?? 0;
  if(!seconds) return null;

  // Admins are exempt, exactly as appMessagesManager treats them.
  const chat: any = await managers.appChatsManager.getChat(chatId);
  if(chat?.admin_rights || chat?.pFlags?.creator) return null;

  return {seconds, nextSendDate: full.slowmode_next_send_date ?? 0};
}

/** Re-read trigger for {@link getSlowMode} — the full chat arriving or changing. */
export async function onChatFullUpdate(
  callback: (peerId: number) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  const handler = (chatId: any) => callback(-Number(chatId));
  rootScope.addEventListener('chat_full_update', handler);
  return () => rootScope.removeEventListener('chat_full_update', handler);
}

/* ------------------------------------------------------------------ */
/* Send-as                                                             */
/* ------------------------------------------------------------------ */

export type SendAsOption = {
  peerId: number;
  title: string;
  premiumRequired: boolean;
};

function peerIdOf(peer: any): number {
  if(!peer) return 0;
  if(peer.user_id !== undefined) return Number(peer.user_id);
  if(peer.channel_id !== undefined) return -Number(peer.channel_id);
  if(peer.chat_id !== undefined) return -Number(peer.chat_id);
  return 0;
}

/**
 * The peer this chat currently posts as, from cached state only — null when we
 * post as ourselves or the full chat is not loaded. No request, so it is safe
 * on the chat-open path.
 */
export async function getCurrentSendAs(peerId: number): Promise<number | null> {
  if(peerId >= 0) return null;

  const {managers} = await bootTelegram();
  const full: any = await managers.appProfileManager.getCachedFullChat(-peerId);
  const id = peerIdOf(full?.default_send_as);
  return id || null;
}

/**
 * Identities we may post as in this chat. Fetched lazily — only when the user
 * opens the selector — because `channels.getSendAs` is a real round trip.
 */
export async function loadSendAsOptions(peerId: number): Promise<SendAsOption[]> {
  if(peerId >= 0) return [];

  const {managers} = await bootTelegram();

  let peers: any[] = [];
  try {
    peers = (await managers.appChatsManager.getSendAs(-peerId)) ?? [];
  } catch(err) {
    return [];
  }

  const options = await Promise.all(
    peers.map(async(sendAs: any) => {
      const id = peerIdOf(sendAs.peer);
      if(!id) return null;
      const brief = await getPeerBrief(id).catch(() => null);
      return {
        peerId: id,
        title: brief?.title ?? 'Unknown',
        premiumRequired: !!sendAs.pFlags?.premium_required
      };
    })
  );

  return options.filter(Boolean) as SendAsOption[];
}

/** Remember the chosen identity server-side, like the official clients do. */
export async function saveSendAs(peerId: number, sendAsPeerId: number): Promise<void> {
  if(peerId >= 0) return;
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.saveDefaultSendAs(peerId, sendAsPeerId);
}
