import {bootTelegram} from './client';
import {peerRestrictionText} from './restrictions';
import {getPeer, getSelfId, peerTitle, toItem} from './chats';
import type {DialogItem, MessageItem} from './chats';

/**
 * Search layer: global (cross-chat) search and the filtered in-chat search.
 *
 * Same hard rule as `chats.ts` — everything returned from here is plain and
 * structured-cloneable. Raw MTProto objects never leave this module.
 */

/** Media-type filter shared by the in-chat and global message searches. */
export type MediaFilter = 'all' | 'photo' | 'video' | 'link' | 'file' | 'music' | 'voice' | 'gif';

export const MEDIA_FILTERS: {value: MediaFilter; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'photo', label: 'Photos'},
  {value: 'video', label: 'Videos'},
  {value: 'link', label: 'Links'},
  {value: 'file', label: 'Files'},
  {value: 'music', label: 'Music'},
  {value: 'voice', label: 'Voice'},
  {value: 'gif', label: 'GIFs'}
];

const INPUT_FILTERS = {
  all: 'inputMessagesFilterEmpty',
  photo: 'inputMessagesFilterPhotos',
  video: 'inputMessagesFilterVideo',
  link: 'inputMessagesFilterUrl',
  file: 'inputMessagesFilterDocument',
  music: 'inputMessagesFilterMusic',
  voice: 'inputMessagesFilterRoundVoice',
  gif: 'inputMessagesFilterGif'
} as const satisfies Record<MediaFilter, string>;

function inputFilterOf(filter: MediaFilter) {
  return {_: INPUT_FILTERS[filter] ?? INPUT_FILTERS.all};
}

/** A peer as it appears in a search result list. */
export type SearchPeerItem = {
  peerId: number;
  title: string;
  /** `@username`, or the peer kind when it has none. */
  subtitle: string;
  isUser: boolean;
  isBroadcast: boolean;
  isForum: boolean;
  isSelf: boolean;
};

/** One message result, carrying the chat it belongs to. */
export type MessageResultItem = {
  /** `peerId_mid` — messages from different chats can share a mid. */
  key: string;
  peerId: number;
  chatTitle: string;
  isUser: boolean;
  message: MessageItem;
};

/** A page of message results plus everything needed to ask for the next one. */
export type MessagePage = {
  items: MessageResultItem[];
  /** Server-side total for the query, used for the "N of M" counter. */
  count: number;
  isEnd: boolean;
  nextRate: number | undefined;
  offsetId: number;
  offsetPeerId: number;
};

const EMPTY_PAGE: MessagePage = {
  items: [],
  count: 0,
  isEnd: true,
  nextRate: undefined,
  offsetId: 0,
  offsetPeerId: 0
};

function usernameOf(peer: any): string {
  const username = peer?.username || peer?.usernames?.find((u: any) => u?.pFlags?.active)?.username;
  return username ? `@${username}` : '';
}

async function toSearchPeer(peerId: number, selfId: number): Promise<SearchPeerItem> {
  const peer = await getPeer(peerId);
  const isUser = peer?._ === 'user';
  const isBroadcast = peer?._ === 'channel' && !!peer?.pFlags?.broadcast;

  let subtitle = usernameOf(peer);
  if(!subtitle) {
    if(peerId === selfId) subtitle = 'Saved Messages';
    else if(peer?.pFlags?.bot) subtitle = 'bot';
    else if(isUser) subtitle = 'user';
    else if(isBroadcast) subtitle = 'channel';
    else subtitle = 'group';
  }

  return {
    peerId,
    title: peerTitle(peer, selfId),
    subtitle,
    isUser,
    isBroadcast,
    isForum: !!peer?.pFlags?.forum || !!peer?.pFlags?.bot_forum_view,
    isSelf: peerId === selfId
  };
}

async function toSearchPeers(peerIds: number[], selfId: number): Promise<SearchPeerItem[]> {
  return Promise.all(peerIds.map((peerId) => toSearchPeer(peerId, selfId)));
}

/* ------------------------------------------------------------------ */
/* Peers                                                               */
/* ------------------------------------------------------------------ */

/**
 * Chats the user already has, plus their contacts — the "Chats" section.
 * Dialogs come first because they are what the user usually means.
 */
export async function searchLocalPeers(query: string, limit = 20): Promise<SearchPeerItem[]> {
  const trimmed = query.trim();
  if(!trimmed) return [];

  const {managers} = await bootTelegram();
  const selfId = await getSelfId();

  const [dialogsResult, contactsResult] = await Promise.all([
    managers.dialogsStorage.getDialogs({query: trimmed, limit, filterId: 0}).catch(() => ({dialogs: []})),
    managers.appUsersManager.searchContacts(trimmed, limit).catch(() => null)
  ]);

  const peerIds: number[] = [];
  const seen = new Set<number>();
  const push = (id: number) => {
    if(!id || seen.has(id)) return;
    seen.add(id);
    peerIds.push(id);
  };

  for(const dialog of (dialogsResult as any)?.dialogs ?? []) push(Number(dialog.peerId));
  for(const id of (contactsResult as any)?.my_results ?? []) push(Number(id));

  return toSearchPeers(peerIds.slice(0, limit), selfId);
}

/**
 * Public usernames and channels resolved by the server — the "Global" section.
 * These are peers the user has no dialog with.
 */
export async function searchGlobalPeers(query: string, limit = 20): Promise<SearchPeerItem[]> {
  const trimmed = query.trim();
  if(!trimmed) return [];

  const {managers} = await bootTelegram();
  const selfId = await getSelfId();

  const result: any = await managers.appUsersManager.searchContacts(trimmed, limit).catch(() => null);
  const peerIds = ((result?.results ?? []) as any[]).map(Number).filter(Boolean);

  return toSearchPeers(peerIds.slice(0, limit), selfId);
}

/** People and chats the user talks to most, shown on an empty search box. */
export async function loadTopPeers(limit = 12): Promise<SearchPeerItem[]> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();

  try {
    const topPeers: any[] = await managers.appUsersManager.getTopPeers('correspondents');
    const peerIds = topPeers.slice(0, limit).map((topPeer) => Number(topPeer.id)).filter(Boolean);
    return toSearchPeers(peerIds, selfId);
  } catch(err) {
    return [];
  }
}

/**
 * Members of a group or channel, for the in-chat "from sender" filter. Large
 * chats keep their member list behind `getParticipants`; small ones carry it
 * in the chat's full info, which the search filters locally.
 */
export async function searchChatMembers(peerId: number, query: string, limit = 20): Promise<SearchPeerItem[]> {
  if(peerId >= 0) return [];

  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const chatId = -peerId;
  const trimmed = query.trim();

  try {
    const result: any = await managers.appProfileManager.getParticipants({
      id: chatId,
      filter: trimmed ? {_: 'channelParticipantsSearch', q: trimmed} : {_: 'channelParticipantsRecent'},
      limit,
      offset: 0
    });

    const peerIds = ((result?.participants ?? []) as any[])
      .map((participant) => Number(
        participant.user_id ?? participant.peer?.user_id ?? participant.peer?.channel_id ?? 0
      ))
      .filter(Boolean);

    return toSearchPeers(peerIds.slice(0, limit), selfId);
  } catch(err) {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Recent searches — local only, like the official clients             */
/* ------------------------------------------------------------------ */

const RECENT_KEY = 'webs.recent-searches';
const RECENT_LIMIT = 20;

function readRecent(): number[] {
  if(typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : [];
  } catch(err) {
    return [];
  }
}

function writeRecent(peerIds: number[]): void {
  if(typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(peerIds.slice(0, RECENT_LIMIT)));
  } catch(err) {}
}

export function addRecentSearch(peerId: number): void {
  if(!peerId) return;
  writeRecent([peerId, ...readRecent().filter((id) => id !== peerId)]);
}

export function removeRecentSearch(peerId: number): void {
  writeRecent(readRecent().filter((id) => id !== peerId));
}

export function clearRecentSearches(): void {
  writeRecent([]);
}

/** The stored recent peers, resolved to renderable rows. */
export async function loadRecentSearches(): Promise<SearchPeerItem[]> {
  const peerIds = readRecent();
  if(!peerIds.length) return [];
  const selfId = await getSelfId();
  return toSearchPeers(peerIds, selfId);
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

async function toResults(messages: any[]): Promise<MessageResultItem[]> {
  const selfId = await getSelfId();

  return Promise.all(
    messages.filter(Boolean).map(async(message: any) => {
      const peerId = Number(message.peerId);
      const peer = await getPeer(peerId);
      return {
        key: `${peerId}_${message.mid}`,
        peerId,
        chatTitle: peerTitle(peer, selfId),
        isUser: peer?._ === 'user',
        message: await toItem(message, peerId, selfId)
      };
    })
  );
}

function pageFrom(result: any, items: MessageResultItem[]): MessagePage {
  const last = items[items.length - 1];
  return {
    items,
    count: result?.count ?? items.length,
    isEnd: !!result?.isEnd?.top || !items.length,
    nextRate: result?.nextRate,
    offsetId: last?.message.mid ?? 0,
    offsetPeerId: last?.peerId ?? 0
  };
}

export type MessageSearchOptions = {
  filter?: MediaFilter;
  limit?: number;
  /** Paging cursor from the previous page. */
  offsetId?: number;
  offsetPeerId?: number;
  nextRate?: number;
  minDate?: number;
  maxDate?: number;
};

/** Cross-chat message search (`messages.searchGlobal`). */
export async function searchGlobalMessages(
  query: string,
  options: MessageSearchOptions = {}
): Promise<MessagePage> {
  const trimmed = query.trim();
  if(!trimmed) return {...EMPTY_PAGE};

  const {managers} = await bootTelegram();

  const result: any = await managers.appMessagesManager.getHistory({
    peerId: 0,
    folderId: 0,
    query: trimmed,
    inputFilter: inputFilterOf(options.filter ?? 'all'),
    limit: options.limit ?? 30,
    offsetId: options.offsetId ?? 0,
    offsetPeerId: options.offsetPeerId ?? 0,
    nextRate: options.nextRate,
    minDate: options.minDate,
    maxDate: options.maxDate,
    isCacheableSearch: true
  });

  return pageFrom(result, await toResults(result?.messages ?? []));
}

export type ChatSearchOptions = MessageSearchOptions & {
  threadId?: number;
  /** Restrict to one sender — groups and channels only. */
  fromPeerId?: number;
};

/**
 * In-chat search with the sender, media-type and date filters applied. An
 * empty query is allowed as long as a filter narrows it (browsing a chat's
 * photos, or everything one member said).
 */
export async function searchChatMessages(
  peerId: number,
  query: string,
  options: ChatSearchOptions = {}
): Promise<MessagePage> {
  const trimmed = query.trim();
  const filter = options.filter ?? 'all';
  const narrowed = !!trimmed || filter !== 'all' || !!options.fromPeerId ||
    !!options.minDate || !!options.maxDate;
  if(!narrowed) return {...EMPTY_PAGE};

  const {managers} = await bootTelegram();

  const result: any = await managers.appMessagesManager.getHistory({
    peerId,
    threadId: options.threadId,
    query: trimmed,
    inputFilter: inputFilterOf(filter),
    fromPeerId: options.fromPeerId || undefined,
    limit: options.limit ?? 30,
    offsetId: options.offsetId ?? 0,
    minDate: options.minDate,
    maxDate: options.maxDate
  });

  // The cached in-chat path answers with mids only; the searched peer is known,
  // so they resolve against it.
  let messages: any[] = result?.messages ?? [];
  if(!messages.length && result?.history?.length) {
    messages = await Promise.all(
      (result.history as number[]).map((mid) => managers.appMessagesManager.getMessageByPeer(peerId, mid))
    );
  }

  return pageFrom(result, await toResults(messages));
}

/**
 * First message at or before `timestamp` (seconds), for the date jump. Uses
 * `requestHistory` rather than `getHistory` because a date offset has to reach
 * the server — the cached history slices are indexed by message id.
 */
export async function findMessageIdByDate(
  peerId: number,
  timestamp: number,
  threadId?: number
): Promise<number | null> {
  const {managers} = await bootTelegram();

  try {
    const result: any = await managers.appMessagesManager.requestHistory({
      peerId,
      threadId,
      offsetId: 0,
      offsetDate: timestamp,
      addOffset: -1,
      limit: 2
    });

    const message = (result?.messages ?? [])[0];
    return message?.mid ?? null;
  } catch(err) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Opening a result                                                    */
/* ------------------------------------------------------------------ */

/**
 * A `DialogItem` for any peer, dialog or not, so a search result can be handed
 * straight to the chat list's own open path. Peers with no dialog (a public
 * channel found by username) get zeroed counters.
 */
export async function dialogTargetFor(peerId: number): Promise<DialogItem> {
  const {managers} = await bootTelegram();
  const selfId = await getSelfId();
  const peer = await getPeer(peerId);
  const dialog: any = await managers.dialogsStorage.getDialogOnly(peerId).catch(() => null);

  return {
    peerId,
    title: peerTitle(peer, selfId),
    preview: '',
    date: 0,
    unread: dialog?.unread_count ?? 0,
    isSelf: peerId === selfId,
    isUser: peer?._ === 'user',
    isBroadcast: peer?._ === 'channel' && !!peer?.pFlags?.broadcast,
    isForum: !!peer?.pFlags?.forum || !!peer?.pFlags?.bot_forum_view,
    pinned: !!dialog?.pFlags?.pinned,
    muted: (dialog?.notify_settings?.mute_until ?? 0) > Date.now() / 1000,
    readMaxId: dialog?.read_inbox_max_id ?? 0,
    readOutboxMaxId: dialog?.read_outbox_max_id ?? 0,
    restrictionText: await peerRestrictionText(peer)
  };
}
