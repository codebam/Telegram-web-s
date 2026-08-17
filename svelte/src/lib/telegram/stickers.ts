/**
 * Sticker-set and GIF *management* — installing, archiving, searching and
 * saving. Plain browsing (recent stickers, installed sets, saved GIFs) lives in
 * `chats.ts`; this module is everything that changes what the account has.
 *
 * Every call goes through a manager on the shared worker. The raw `stickerSet`
 * objects the managers hand back are kept here because `toggleStickerSet` and
 * `reorderStickerSets` want the whole set, not just its id.
 */

import {bootTelegram} from '$lib/telegram/client';
import {registerDoc, toSticker, type StickerItem} from '$lib/telegram/chats';

export type StickerSetInfo = {
  id: string;
  title: string;
  shortName: string;
  count: number;
  installed: boolean;
  archived: boolean;
  /** First sticker of the set, when the server sent a cover with the listing. */
  cover: StickerItem | null;
};

/** Raw `stickerSet` objects, keyed by id — the managers need them back whole. */
const rawSets = new Map<string, any>();

function toSetInfo(set: any, cover?: any): StickerSetInfo {
  const id = '' + set.id;
  rawSets.set(id, set);
  if(set.short_name) rawSets.set(set.short_name, set);

  return {
    id,
    title: set.title ?? '',
    shortName: set.short_name ?? '',
    count: set.count ?? 0,
    installed: !!set.installed_date,
    archived: !!set.pFlags?.archived,
    cover: cover ? toSticker(cover) : null
  };
}

function coverOf(covered: any): any {
  return covered.cover ?? covered.covers?.[0] ?? covered.documents?.[0] ?? null;
}

function fromCovered(covered: any): StickerSetInfo {
  return toSetInfo(covered.set, coverOf(covered));
}

/** Sets the account has installed, in their current order. */
export async function loadInstalledSets(): Promise<StickerSetInfo[]> {
  const {managers} = await bootTelegram();
  const all: any = await managers.appStickersManager.getAllStickers();
  return (all?.sets ?? []).map((set: any) => toSetInfo(set));
}

/** Trending sets the server suggests, installed or not. */
export async function loadFeaturedSets(): Promise<StickerSetInfo[]> {
  const {managers} = await bootTelegram();
  const sets: any = await managers.appStickersManager.getFeaturedStickers();
  return (sets ?? []).map(fromCovered);
}

/** Sets the user archived; restoring one is an ordinary install. */
export async function loadArchivedSets(): Promise<StickerSetInfo[]> {
  const {managers} = await bootTelegram();
  const sets: any = await managers.appStickersManager.getArchivedStickers();
  return (sets ?? []).map((covered: any) => ({...fromCovered(covered), archived: true}));
}

export async function searchStickerSets(query: string): Promise<StickerSetInfo[]> {
  const trimmed = query.trim();
  if(!trimmed) return [];

  const {managers} = await bootTelegram();
  // excludeFeatured=false so a trending set is still findable by name.
  const sets: any = await managers.appStickersManager.searchStickerSets(trimmed, false);
  return (sets ?? []).map(fromCovered);
}

/**
 * Installs the set when it is not installed, uninstalls it when it is.
 * Resolves to the resulting installed state.
 */
export async function toggleSetInstalled(setKey: string): Promise<boolean> {
  const {managers} = await bootTelegram();
  const set = rawSets.get(setKey);
  if(!set) throw new Error('Sticker set not found');

  const wasInstalled = !!set.installed_date;
  // toggleStickerSet reads the set out of the worker's own cache, and a set
  // listed by getAllStickers has not necessarily been fetched yet.
  await managers.appStickersManager.getStickerSet(
    {_: 'inputStickerSetID', id: set.id, access_hash: set.access_hash} as any,
    {useCache: true}
  );

  const changed = await managers.appStickersManager.toggleStickerSet(set);
  if(!changed) return wasInstalled;

  // Keep the cached copy honest so a second click toggles the other way.
  const installed = !wasInstalled;
  if(installed) {
    set.installed_date = Math.floor(Date.now() / 1000);
    if(set.pFlags) delete set.pFlags.archived;
  } else {
    delete set.installed_date;
  }

  return installed;
}

/** `orderIds` is the full list of installed set ids, in the new order. */
export async function reorderSets(orderIds: string[]): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStickersManager.reorderStickerSets(orderIds);
}

export type StickerSetPreview = {
  info: StickerSetInfo;
  stickers: StickerItem[];
};

/**
 * Opens a set by id, by short name, or by a `t.me/addstickers/…` link. Public
 * sets are addressable by short name alone, which is what a shared link carries.
 */
export async function loadSetPreview(setKey: string): Promise<StickerSetPreview | null> {
  const {managers} = await bootTelegram();
  const known = rawSets.get(setKey);

  const input: any = known ?
    {_: 'inputStickerSetID', id: known.id, access_hash: known.access_hash} :
    setKey;

  const set: any = await managers.appStickersManager.getStickerSet(input);
  if(!set?.set) return null;

  const documents: any[] = set.documents ?? [];
  return {
    info: toSetInfo(set.set, documents[0]),
    stickers: documents.map(toSticker)
  };
}

/** The short name in a `t.me/addstickers/name` (or `tg://addstickers?set=name`) link. */
export function parseStickerSetLink(text: string): string | null {
  const match = /(?:t\.me\/addstickers\/|addstickers[?&]set=)([\w_]+)/i.exec(text ?? '');
  return match ? match[1] : null;
}

/** The set a sticker belongs to, so a message's "View pack" can open it. */
export async function stickerSetOfDoc(docId: string): Promise<StickerSetPreview | null> {
  const {managers} = await bootTelegram();
  const doc: any = await managers.appDocsManager.getDoc(docId);
  const input = doc?.stickerSetInput;
  if(!input) return null;

  const set: any = await managers.appStickersManager.getStickerSet(input);
  if(!set?.set) return null;

  const documents: any[] = set.documents ?? [];
  return {
    info: toSetInfo(set.set, documents[0]),
    stickers: documents.map(toSticker)
  };
}

/* ------------------------------------------------------------------ */
/* Recent stickers                                                     */
/* ------------------------------------------------------------------ */

export async function removeRecentSticker(docId: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStickersManager.saveRecentSticker(docId, true);
}

export async function clearRecentStickers(): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appStickersManager.clearRecentStickers();
}

/* ------------------------------------------------------------------ */
/* Composer autocomplete                                               */
/* ------------------------------------------------------------------ */

/**
 * Stickers matching a single emoji typed in the composer. Both the installed
 * sets and the server's suggestions are searched, the same as the official
 * clients do for a lone emoji.
 */
export async function stickersForEmoji(emoticon: string, limit = 20): Promise<StickerItem[]> {
  const {managers} = await bootTelegram();
  const docs: any = await managers.appStickersManager.getStickersByEmoticon({
    emoticon,
    includeOurStickers: true,
    includeServerStickers: true
  });
  return (docs ?? []).slice(0, limit).map(toSticker);
}

/** Stickers for a `:shortcode:`-style query, resolved through emoji search. */
export async function stickersForQuery(query: string, limit = 20): Promise<StickerItem[]> {
  const {managers} = await bootTelegram();
  const docs: any = await managers.appStickersManager.searchStickers(query);
  return (docs ?? []).slice(0, limit).map(toSticker);
}

/**
 * Reads the sticker autocomplete trigger out of a composer draft: a message
 * that is nothing but one emoji, or a `:word` shortcode of at least two
 * characters. Anything else suppresses the suggestions.
 */
export function stickerTrigger(draft: string): {kind: 'emoji' | 'query'; value: string} | null {
  const text = draft.trim();
  if(!text || text.length > 32) return null;

  const shortcode = /^:([a-z0-9_+-]{2,})$/i.exec(text);
  if(shortcode) return {kind: 'query', value: shortcode[1]};

  // A bare emoji: no letters, digits or spaces, and short enough to be one
  // grapheme cluster with its modifiers.
  if(!/\s/.test(text) && !/[\w]/.test(text) && /\p{Extended_Pictographic}/u.test(text)) {
    return {kind: 'emoji', value: text};
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* GIFs                                                                */
/* ------------------------------------------------------------------ */

function toGif(doc: any): StickerItem {
  registerDoc(doc);
  const video = (doc.attributes ?? []).find((a: any) => a._ === 'documentAttributeVideo');
  return {
    docId: '' + doc.id,
    kind: 'video',
    emoji: '',
    width: video?.w ?? 200,
    height: video?.h ?? 200
  };
}

export type GifSearchResult = {
  items: StickerItem[];
  /** Opaque cursor for the next page; '' when the bot has nothing more. */
  nextOffset: string;
};

/**
 * Searches the GIF bot configured for the account (`@gif` by default) through
 * its inline results. Pass the previous result's `nextOffset` to page.
 */
export async function searchGifs(query: string, offset = ''): Promise<GifSearchResult> {
  const {managers} = await bootTelegram();
  const res: any = await managers.appGifsManager.searchGifs(query, offset || undefined);
  return {
    items: (res?.documents ?? []).map(toGif),
    nextOffset: res?.nextOffset ?? ''
  };
}

/** Ids of the account's saved GIFs, for rendering the save/unsave state. */
export async function savedGifIds(): Promise<Set<string>> {
  const {managers} = await bootTelegram();
  const docs: any = await managers.appGifsManager.getGifs();
  return new Set((docs ?? []).map((doc: any) => '' + doc.id));
}

export async function toggleSavedGif(docId: string, save: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appGifsManager.saveGif(docId, !save);
}
