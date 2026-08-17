import {bootTelegram} from './client';

/**
 * Data layer for the media viewer.
 *
 * The lightbox pages through a chat's whole photo/video history, not just the
 * messages the timeline happens to have loaded, so it cannot lean on the
 * caches in `chats.ts` — those only hold what the bubbles asked for. Everything
 * here goes straight to the managers and returns plain, cloneable objects.
 */

export type ViewerItem = {
  peerId: number;
  mid: number;
  kind: 'photo' | 'video' | 'gif';
  date: number;
  fromId: number;
  fromTitle: string;
  caption: string;
  out: boolean;
  width: number;
  height: number;
  duration: number;
  size: number;
  fileName: string;
};

/** One rendition of a video, when the server ships several. */
export type VideoQuality = {
  docId: string;
  label: string;
  height: number;
  size: number;
};

const urlCache = new Map<string, string | null>();
const titleCache = new Map<number, string>();

const cacheKey = (peerId: number, mid: number, docId?: string) =>
  `${peerId}_${mid}_${docId ?? 'main'}`;

async function getRawMessage(peerId: number, mid: number): Promise<any> {
  const {managers} = await bootTelegram();
  const message = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(message) return message;

  try {
    await managers.appMessagesManager.reloadMessages(peerId, [mid]);
  } catch(err) {
    return null;
  }

  return managers.appMessagesManager.getMessageByPeer(peerId, mid);
}

async function peerTitle(peerId: number): Promise<string> {
  if(titleCache.has(peerId)) return titleCache.get(peerId)!;

  const {managers} = await bootTelegram();
  let title = '';
  try {
    const peer: any = await managers.appPeersManager.getPeer(peerId);
    if(peer?._ === 'user') {
      title = [peer.first_name, peer.last_name].filter(Boolean).join(' ').trim() ||
        peer.username || 'User';
    } else {
      title = peer?.title || 'Chat';
    }
  } catch(err) {
    title = '';
  }

  titleCache.set(peerId, title);
  return title;
}

function documentOf(message: any): any {
  const media = message?.media;
  if(!media) return null;
  return media.document ?? media.photo ?? null;
}

function kindOf(message: any): ViewerItem['kind'] | null {
  const media = message?.media;
  if(!media) return null;
  if(media._ === 'messageMediaPhoto') return 'photo';
  if(media._ !== 'messageMediaDocument' || !media.document) return null;

  const document = media.document;
  const attributes: any[] = document.attributes ?? [];
  if(attributes.some((a) => a._ === 'documentAttributeSticker')) return null;
  if(attributes.some((a) => a._ === 'documentAttributeAnimated') || document.type === 'gif') return 'gif';
  if(attributes.some((a) => a._ === 'documentAttributeVideo')) return 'video';
  if(document.mime_type?.startsWith('image/')) return 'photo';
  return null;
}

async function toViewerItem(peerId: number, message: any): Promise<ViewerItem | null> {
  const kind = kindOf(message);
  if(!kind || message.media?.ttl_seconds) return null;

  const document = message.media?.document;
  const attributes: any[] = document?.attributes ?? [];
  const video = attributes.find((a) => a._ === 'documentAttributeVideo');
  const imageSize = attributes.find((a) => a._ === 'documentAttributeImageSize');
  const filename = attributes.find((a) => a._ === 'documentAttributeFilename');

  let width = imageSize?.w ?? video?.w ?? 0;
  let height = imageSize?.h ?? video?.h ?? 0;
  if(!width && message.media?._ === 'messageMediaPhoto') {
    const sizes: any[] = message.media.photo?.sizes ?? [];
    const biggest = sizes.filter((s) => s.w).sort((a, b) => b.w - a.w)[0];
    width = biggest?.w ?? 0;
    height = biggest?.h ?? 0;
  }

  const fromId = Number(message.fromId ?? message.peerId ?? peerId);

  return {
    peerId,
    mid: message.mid,
    kind,
    date: message.date ?? 0,
    fromId,
    fromTitle: await peerTitle(fromId),
    caption: message.message ?? '',
    out: !!message.pFlags?.out,
    width,
    height,
    duration: video?.duration ?? 0,
    size: document?.size ?? message.media?.photo?.size ?? 0,
    fileName: filename?.file_name ?? ''
  };
}

/** Viewer-shaped description of one message, for items opened from a bubble. */
export async function viewerItem(peerId: number, mid: number): Promise<ViewerItem | null> {
  const message = await getRawMessage(peerId, mid);
  return message ? toViewerItem(peerId, message) : null;
}

/**
 * Full-resolution URL for a viewer item. `docId` picks one of the alternative
 * renditions returned by `videoQualities`; without it the main document (or
 * photo) is downloaded.
 */
export async function loadViewerMedia(
  peerId: number,
  mid: number,
  docId?: string
): Promise<string | null> {
  const key = cacheKey(peerId, mid, docId);
  if(urlCache.has(key)) return urlCache.get(key)!;

  const {managers} = await bootTelegram();
  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  let target: any;
  if(docId) {
    target = await managers.appDocsManager.getDoc(docId);
  } else {
    const message = await getRawMessage(peerId, mid);
    target = documentOf(message);
  }

  if(!target) {
    urlCache.set(key, null);
    return null;
  }

  try {
    // A photo has no downloadable file of its own — every rendition is a
    // photoSize, so one has to be picked. Without it the download has no
    // location and every image in the viewer fails. Documents download whole.
    const isPhoto = target._ === 'photo';
    const thumb = isPhoto ? choosePhotoSize(target, 3840, 3840, true) : undefined;
    const url = await appDownloadManager.downloadMediaURL({media: target, thumb});
    urlCache.set(key, url ?? null);
    return url ?? null;
  } catch(err) {
    console.error('[viewer] download failed', key, err);
    urlCache.set(key, null);
    return null;
  }
}

/** A small poster frame, for the filmstrip. */
export async function loadViewerThumb(peerId: number, mid: number): Promise<string | null> {
  const key = `${cacheKey(peerId, mid)}_thumb`;
  if(urlCache.has(key)) return urlCache.get(key)!;

  await bootTelegram();
  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  const message = await getRawMessage(peerId, mid);
  const target = documentOf(message);
  if(!target) {
    urlCache.set(key, null);
    return null;
  }

  try {
    const thumb = choosePhotoSize(target, 160, 160, true);
    const url = await appDownloadManager.downloadMediaURL({media: target, thumb});
    urlCache.set(key, url ?? null);
    return url ?? null;
  } catch(err) {
    urlCache.set(key, null);
    return null;
  }
}

/**
 * A page of the chat's photo/video history, older or newer than `offsetMid`.
 *
 * `getHistory` walks backwards from the offset, so a newer page is asked for
 * with a negative `addOffset` — the same trick `loadAround` uses in chats.ts.
 */
export async function loadMediaPage(
  peerId: number,
  offsetMid: number,
  direction: 'older' | 'newer',
  options: {threadId?: number; limit?: number} = {}
): Promise<ViewerItem[]> {
  const {managers} = await bootTelegram();
  const limit = options.limit ?? 20;

  const result: any = await managers.appMessagesManager.getHistory({
    peerId,
    threadId: options.threadId,
    offsetId: offsetMid,
    addOffset: direction === 'newer' ? -limit : 0,
    limit,
    inputFilter: {_: 'inputMessagesFilterPhotoVideo'},
    fetchIfWasNotFetched: true
  });

  const mids: number[] = (result?.history ?? []).filter((mid: number) => mid !== offsetMid);
  const messages = await Promise.all(
    mids.map((mid) => managers.appMessagesManager.getMessageByPeer(peerId, mid))
  );

  const items = await Promise.all(
    messages.filter(Boolean).map((message: any) => toViewerItem(peerId, message))
  );

  // getHistory hands back newest-first; the viewer's list runs oldest-first.
  return items.filter(Boolean).reverse() as ViewerItem[];
}

/** How many photos/videos this chat holds, for the position counter. */
export async function mediaCount(peerId: number, threadId?: number): Promise<number> {
  const {managers} = await bootTelegram();
  try {
    const result: any = await managers.appMessagesManager.getHistory({
      peerId,
      threadId,
      limit: 1,
      inputFilter: {_: 'inputMessagesFilterPhotoVideo'},
      fetchIfWasNotFetched: true
    });
    return result?.count ?? 0;
  } catch(err) {
    return 0;
  }
}

/**
 * Alternative renditions of a video. Telegram ships several qualities for a
 * transcoded upload; `alt_documents` are saved next to the main document and
 * the manager keys them by its id.
 */
export async function videoQualities(peerId: number, mid: number): Promise<VideoQuality[]> {
  const {managers} = await bootTelegram();
  const message = await getRawMessage(peerId, mid);
  const document = message?.media?.document;
  if(!document) return [];

  let alts: any[] = [];
  try {
    alts = (await managers.appDocsManager.getAltDocsByDocument(document.id)) ?? [];
  } catch(err) {
    return [];
  }

  const describe = (doc: any, main: boolean): VideoQuality | null => {
    const video = (doc.attributes ?? []).find((a: any) => a._ === 'documentAttributeVideo');
    const height = video?.h ?? 0;
    if(!height) return null;
    return {
      docId: main ? '' : String(doc.id),
      label: `${height}p`,
      height,
      size: doc.size ?? 0
    };
  };

  const qualities = [describe(document, true), ...alts.map((doc) => describe(doc, false))]
    .filter(Boolean) as VideoQuality[];

  if(qualities.length < 2) return [];

  // Highest first, and never two entries claiming the same resolution.
  const seen = new Set<number>();
  return qualities
    .sort((a, b) => b.height - a.height)
    .filter((quality) => (seen.has(quality.height) ? false : (seen.add(quality.height), true)));
}

/**
 * A t.me link to a message, built from what the client already knows: a public
 * peer links by username, a private channel by its short id. Returns '' when
 * the chat has no linkable form (an ordinary private chat).
 */
export async function messageLink(peerId: number, mid: number, threadId?: number): Promise<string> {
  const {managers} = await bootTelegram();

  let username = '';
  try {
    username = (await managers.appPeersManager.getPeerUsername(peerId)) ?? '';
  } catch(err) {
    username = '';
  }

  const suffix = threadId ? `?thread=${threadId}` : '';
  if(username) return `https://t.me/${username}/${mid}${suffix}`;

  // tweb encodes a chat as the negated chat id (`toPeerId(true)`), and t.me/c
  // wants that bare chat id back.
  if(peerId < 0) return `https://t.me/c/${Math.abs(peerId)}/${mid}${suffix}`;

  return '';
}
