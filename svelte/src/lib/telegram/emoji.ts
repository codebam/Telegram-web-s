/**
 * Emoji: the Unicode catalogue, search, skin tones, recents, and custom emoji.
 *
 * The catalogue is tweb's own generated table (`@config/emoji`) — a map of
 * dash-joined codepoints to a packed number whose first digit is the category
 * and whose remaining digits are the sort order inside it. It is ~80KB, so it
 * is imported dynamically and only when the emoji tab is first opened.
 *
 * Everything server-shaped goes through appEmojiManager / appStickersManager /
 * appUsersManager: they own the caching, the state persistence and the updates.
 */

import {bootTelegram} from '$lib/telegram/client';

export type EmojiCategory = {
  id: string;
  title: string;
  /** Emoji shown on the category tab. */
  icon: string;
  emoji: string[];
};

export type EmojiSearchResult = {emoji: string; docId: string};

export type CustomEmojiItem = {
  docId: string;
  /** The Unicode emoji this custom one stands for — its alt text. */
  emoji: string;
  kind: 'static' | 'video' | 'animated';
};

export type CustomEmojiSetItem = {
  id: string;
  title: string;
  count: number;
};

/** A custom emoji inserted into the composer, waiting to become an entity. */
export type PendingCustomEmoji = {docId: string; emoji: string};

/**
 * Category order is fixed by the packed number in the catalogue: the first
 * digit is a 1-based index into this list (tweb's EMOJI_CATEGORIES). Anything
 * outside it — toned variants (0) and the bare tone modifiers (9) — is skipped.
 */
const CATEGORIES: {id: string; title: string; icon: string}[] = [
  {id: 'people', title: 'Smileys & People', icon: '😀'},
  {id: 'nature', title: 'Animals & Nature', icon: '🐶'},
  {id: 'food', title: 'Food & Drink', icon: '🍎'},
  {id: 'travel', title: 'Travel & Places', icon: '🚗'},
  {id: 'activity', title: 'Activity & Sport', icon: '⚽'},
  {id: 'objects', title: 'Objects', icon: '💡'},
  {id: 'flags', title: 'Flags', icon: '🏁'}
];

let cataloguePromise: Promise<EmojiCategory[]> | null = null;

/** Every Unicode emoji tweb knows, grouped and ordered as the app expects. */
export function loadEmojiCatalogue(): Promise<EmojiCategory[]> {
  return cataloguePromise ??= (async() => {
    const [{default: Emoji}, {emojiFromCodePoints}] = await Promise.all([
      import('@config/emoji'),
      import('@vendor/emoji')
    ]);

    const buckets: string[][] = CATEGORIES.map(() => []);

    for(const key in Emoji) {
      const packed = '' + Emoji[key];
      const bucket = buckets[+packed[0] - 1];
      if(!bucket) continue;
      bucket[+packed.slice(1) || 0] = emojiFromCodePoints(key);
    }

    return CATEGORIES.map((category, i) => ({
      ...category,
      // The order index is sparse — filtering keeps it without the holes.
      emoji: buckets[i].filter(Boolean)
    }));
  })();
}

/* ------------------------------------------------------------------ */
/* Skin tones                                                          */
/* ------------------------------------------------------------------ */

type ToneHelpers = typeof import('@helpers/emojiSkinTone');
let toneHelpers: ToneHelpers | null = null;
let toneHelpersPromise: Promise<ToneHelpers> | null = null;

/**
 * Loads the tone tables. Rendering a grid needs a synchronous "does this one
 * have tones?" for every cell, so the module is pulled in once up front and
 * `toneVariants` stays sync afterwards.
 */
export function initEmojiTones(): Promise<unknown> {
  return toneHelpersPromise ??= import('@helpers/emojiSkinTone').then((helpers) => {
    return toneHelpers = helpers;
  });
}

/** The six variants (neutral first) of a tone-capable emoji, or null. */
export function toneVariants(emoji: string): string[] | null {
  if(!toneHelpers) return null;
  return toneHelpers.getEmojiSkinToneVariants(emoji)?.variants as string[] ?? null;
}

/** Tone 0 is the neutral, yellow form. Unknown emoji are returned untouched. */
export function applyTone(emoji: string, tone: number): string {
  if(!tone) return emoji;
  return toneVariants(emoji)?.[tone] ?? emoji;
}

/** Per-emoji tone overrides the user picked, keyed by the neutral emoji. */
export async function loadEmojiTones(): Promise<Record<string, number>> {
  const {managers} = await bootTelegram();
  return (await managers.appEmojiManager.getEmojiVariants()) ?? {};
}

export async function saveEmojiTone(emoji: string, tone: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appEmojiManager.saveEmojiVariant(emoji, tone as any);
}

const DEFAULT_TONE_KEY = 'webs.emojiTone';

/** The tone applied to every tone-capable emoji without its own override. */
export function loadDefaultTone(): number {
  if(typeof localStorage === 'undefined') return 0;
  const stored = +localStorage.getItem(DEFAULT_TONE_KEY);
  return stored >= 0 && stored <= 5 ? stored : 0;
}

export function saveDefaultTone(tone: number): void {
  if(typeof localStorage === 'undefined') return;
  localStorage.setItem(DEFAULT_TONE_KEY, '' + tone);
}

/* ------------------------------------------------------------------ */
/* Search and recents                                                  */
/* ------------------------------------------------------------------ */

/**
 * Keyword/shortcode search. The keywords come from the server langpack, which
 * the manager fetches and indexes on first use; `addCustom` mixes in the
 * matching custom emoji from the user's installed emoji sets.
 */
export async function searchEmoji(query: string, limit = 60): Promise<EmojiSearchResult[]> {
  const q = query.trim();
  if(!q) return [];

  const {managers} = await bootTelegram();
  const found: any[] = await managers.appEmojiManager.prepareAndSearchEmojis({q, limit, addCustom: true});

  return (found ?? []).map((item) => ({
    emoji: item.emoji ?? '',
    docId: item.docId ? '' + item.docId : ''
  }));
}

/** Recently used Unicode emoji, most recent first, stored tone-less. */
export async function loadRecentEmoji(): Promise<string[]> {
  const {managers} = await bootTelegram();
  return (await managers.appEmojiManager.getRecentEmojis('native')) ?? [];
}

export async function loadRecentCustomEmoji(): Promise<CustomEmojiItem[]> {
  const {managers} = await bootTelegram();
  const docIds = (await managers.appEmojiManager.getRecentEmojis('custom')) ?? [];
  if(!docIds.length) return [];

  const docs = await managers.appEmojiManager.getCustomEmojiDocuments(docIds);
  return (docs ?? []).filter(Boolean).map(toCustomEmoji);
}

/** Records a send so the emoji floats to the top of the recent section. */
export async function pushRecentEmoji(emoji: string, docId = ''): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appEmojiManager.pushRecentEmoji(docId ? {docId, emoji} : {emoji});
}

/* ------------------------------------------------------------------ */
/* Custom emoji                                                        */
/* ------------------------------------------------------------------ */

// downloadMediaURL needs the whole document, and getCustomEmojiDocument only
// hands one over once — keep every doc we have seen.
const customDocs = new Map<string, any>();
const customUrls = new Map<string, string | null>();
const rawEmojiSets = new Map<string, any>();

function customEmojiKind(doc: any): CustomEmojiItem['kind'] {
  if(doc.sticker === 3 || doc.mime_type === 'video/webm') return 'video';
  if(doc.sticker === 2 || doc.mime_type === 'application/x-tgsticker') return 'animated';
  return 'static';
}

function toCustomEmoji(doc: any): CustomEmojiItem {
  const docId = '' + doc.id;
  customDocs.set(docId, doc);
  const attribute = (doc.attributes ?? []).find((a: any) => a._ === 'documentAttributeCustomEmoji' || a._ === 'documentAttributeSticker');

  return {
    docId,
    emoji: attribute?.alt ?? '',
    kind: customEmojiKind(doc)
  };
}

/** The user's installed custom emoji sets. */
export async function loadCustomEmojiSets(): Promise<CustomEmojiSetItem[]> {
  const {managers} = await bootTelegram();
  const all: any = await managers.appStickersManager.getEmojiStickers();

  return (all?.sets ?? []).map((set: any) => {
    rawEmojiSets.set('' + set.id, set);
    return {
      id: '' + set.id,
      title: set.title ?? '',
      count: set.count ?? 0
    };
  });
}

export async function loadCustomEmojiSet(setId: string): Promise<CustomEmojiItem[]> {
  const {managers} = await bootTelegram();
  const raw = rawEmojiSets.get(setId);
  if(!raw) return [];

  const set: any = await managers.appStickersManager.getStickerSet({
    _: 'inputStickerSetID',
    id: raw.id,
    access_hash: raw.access_hash
  } as any);

  return (set?.documents ?? []).map(toCustomEmoji);
}

/** One custom emoji by document id — for rendering it inside message text. */
export async function loadCustomEmoji(docId: string): Promise<CustomEmojiItem | null> {
  const cached = customDocs.get(docId);
  if(cached) return toCustomEmoji(cached);

  const {managers} = await bootTelegram();
  try {
    // The manager batches these, so a bubble full of custom emoji costs one
    // request rather than one per glyph.
    const doc = await managers.appEmojiManager.getCustomEmojiDocument(docId);
    return doc ? toCustomEmoji(doc) : null;
  } catch(err) {
    return null;
  }
}

/** The raw document, fetching it first when only its id is known. */
async function customDoc(docId: string): Promise<any> {
  const cached = customDocs.get(docId);
  if(cached) return cached;
  await loadCustomEmoji(docId);
  return customDocs.get(docId);
}

/**
 * A renderable URL for a custom emoji. Animated (.tgs) ones have no still
 * frame in the file, so they fall back to the server thumbnail — playback goes
 * through the Lottie worker instead, see `loadCustomEmojiBlob`.
 */
export async function loadCustomEmojiUrl(docId: string): Promise<string | null> {
  if(customUrls.has(docId)) return customUrls.get(docId)!;

  const doc = await customDoc(docId);
  if(!doc) return null;

  await bootTelegram();
  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  try {
    const url = await appDownloadManager.downloadMediaURL({
      media: doc,
      thumb: customEmojiKind(doc) === 'animated' ? choosePhotoSize(doc, 100, 100, true) : undefined
    });
    customUrls.set(docId, url ?? null);
    return url ?? null;
  } catch(err) {
    customUrls.set(docId, null);
    return null;
  }
}

/** Raw gzipped Lottie JSON for an animated custom emoji. */
export async function loadCustomEmojiBlob(docId: string): Promise<Blob | null> {
  const doc = await customDoc(docId);
  if(!doc) return null;

  await bootTelegram();
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  try {
    return await appDownloadManager.downloadMedia({media: doc});
  } catch(err) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

/**
 * Turns the custom emoji inserted into the composer into MTProto entities.
 *
 * The draft is a plain string: a custom emoji sits in it as its Unicode alt
 * text, and only the pending list remembers which document it came from. The
 * text may have been edited since, so occurrences are matched left to right —
 * the first 😀 in the text belongs to the first pending 😀, and any pending
 * emoji whose character no longer appears is simply dropped.
 */
export function customEmojiEntities(text: string, pending: PendingCustomEmoji[]): any[] {
  if(!pending.length) return [];

  const queues = new Map<string, string[]>();
  for(const item of pending) {
    if(!item.emoji) continue;
    const queue = queues.get(item.emoji) ?? [];
    queue.push(item.docId);
    queues.set(item.emoji, queue);
  }

  const entities: any[] = [];
  const emojis = [...queues.keys()].sort((a, b) => b.length - a.length);

  for(let offset = 0; offset < text.length;) {
    const emoji = emojis.find((candidate) => text.startsWith(candidate, offset));
    const queue = emoji && queues.get(emoji);

    if(queue?.length) {
      entities.push({
        _: 'messageEntityCustomEmoji',
        offset,
        length: emoji.length,
        document_id: queue.shift()
      });
      offset += emoji.length;
    } else {
      offset += emoji ? emoji.length : 1;
    }
  }

  return entities;
}

/**
 * Sends text carrying entities the composer built itself. Plain messages go
 * through `sendMessage` in chats.ts; this exists because custom emoji are the
 * only formatting the Svelte composer produces.
 */
export async function sendMessageWithEntities(
  peerId: number,
  text: string,
  entities: any[],
  options: {replyToMsgId?: number; threadId?: number} = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendText({
    peerId,
    text,
    entities,
    clearDraft: true,
    replyToMsgId: options.replyToMsgId ?? options.threadId,
    threadId: options.threadId
  });
}

/* ------------------------------------------------------------------ */
/* Emoji status                                                        */
/* ------------------------------------------------------------------ */

/** The custom emoji a peer wears next to their name, '' when they wear none. */
export async function loadEmojiStatus(peerId: number): Promise<string> {
  if(!peerId) return '';

  const {managers} = await bootTelegram();
  try {
    const peer: any = await managers.appPeersManager.getPeer(peerId);
    const status = peer?.emoji_status;
    if(!status || status._ === 'emojiStatusEmpty' || !status.document_id) return '';
    // A collectible status still points at a document; the gift trimmings
    // around it are not rendered here.
    return '' + status.document_id;
  } catch(err) {
    return '';
  }
}

/** Sets — or with an empty docId clears — the signed-in user's status. */
export async function setEmojiStatus(docId: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appUsersManager.updateEmojiStatus(
    docId ? {_: 'emojiStatus', document_id: docId} : {_: 'emojiStatusEmpty'}
  );
}
