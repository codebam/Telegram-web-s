import {bootTelegram} from './client';
import {toSticker, type StickerItem} from './chats';

/**
 * The message types the chat could not render or compose: locations (static,
 * live and venues), contacts, games, invoices and paid media, checklists,
 * gift service messages, and poll creation.
 *
 * Same rule as `chats.ts`: everything returned from here is plain and
 * structured-cloneable. The raw MTProto objects the actions need again (the
 * geo point behind a map preview, the poll behind a votes breakdown) stay in
 * the module-level caches below and never enter Svelte state.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type GeoBase = {
  lat: number;
  long: number;
  /** Metres of uncertainty the sender's device reported, 0 when unknown. */
  accuracyRadius: number;
  /** Opens the point in an external map — the only link this client hands out. */
  mapUrl: string;
};

export type LocationExtra = GeoBase & {kind: 'geo'};

export type LiveLocationExtra = GeoBase & {
  kind: 'geoLive';
  /** Seconds the sender agreed to share for, counted from `startDate`. */
  period: number;
  /** Compass heading in degrees, 0 when the sender did not report one. */
  heading: number;
  startDate: number;
  /** Last time the sender moved the pin — the "updated N minutes ago" source. */
  editDate: number;
  /** Unix seconds at which the share stops on its own. */
  expiresAt: number;
  /** Sharing already ended: render the pin, drop the countdown. */
  expired: boolean;
  mine: boolean;
};

export type VenueExtra = GeoBase & {
  kind: 'venue';
  title: string;
  address: string;
  provider: string;
  venueId: string;
  /** Foursquare-style category, e.g. `food/pizza` — drives the icon. */
  venueType: string;
};

export type ContactExtra = {
  kind: 'contact';
  userId: number;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  vcard: string;
};

export type GameExtra = {
  kind: 'game';
  title: string;
  description: string;
  shortName: string;
  hasPhoto: boolean;
};

export type InvoiceExtra = {
  kind: 'invoice';
  title: string;
  description: string;
  currency: string;
  /** Smallest currency unit, as the API sends it. `priceText` is the display. */
  amount: number;
  priceText: string;
  test: boolean;
  hasPhoto: boolean;
  /** Set once the invoice has been paid — the message links to a receipt. */
  receiptMid: number;
  startParam: string;
};

export type PaidMediaExtra = {
  kind: 'paidMedia';
  stars: number;
  count: number;
  /** True once bought: the real media is attached instead of the blurred cover. */
  unlocked: boolean;
};

export type ChecklistItem = {
  id: number;
  text: string;
  done: boolean;
  doneById: number;
  doneDate: number;
};

export type ChecklistExtra = {
  kind: 'checklist';
  title: string;
  items: ChecklistItem[];
  doneCount: number;
  /** Whether anyone but the author may tick items / add new ones. */
  othersCanComplete: boolean;
  othersCanAppend: boolean;
  canComplete: boolean;
  canAppend: boolean;
};

export type GiftExtra = {
  kind: 'gift';
  title: string;
  subtitle: string;
  /** The note the sender attached to the gift, '' when there is none. */
  message: string;
  sticker: StickerItem | null;
  valueText: string;
  /** Unique (upgraded) gifts carry a collectible number and a public slug. */
  unique: boolean;
  num: number;
  slug: string;
  converted: boolean;
  incoming: boolean;
};

export type MessageExtra =
  | LocationExtra
  | LiveLocationExtra
  | VenueExtra
  | ContactExtra
  | GameExtra
  | InvoiceExtra
  | PaidMediaExtra
  | ChecklistExtra
  | GiftExtra;

/* ------------------------------------------------------------------ */
/* Raw caches — deliberately outside Svelte reactivity                 */
/* ------------------------------------------------------------------ */

/** Geo points, keyed by message, for the static map download. */
const rawGeo = new Map<string, any>();
/** Web documents (invoice photos) and photos (game covers), same keying. */
const rawCover = new Map<string, any>();
const coverUrls = new Map<string, string | null>();
const mapUrls = new Map<string, string | null>();

const key = (peerId: number, mid: number) => `${peerId}_${mid}`;

let selfIdCache: number | null = null;

async function selfId(): Promise<number> {
  if(selfIdCache !== null) return selfIdCache;
  const {managers} = await bootTelegram();
  const self = await managers.appUsersManager.getSelf();
  return (selfIdCache = Number(self?.id ?? 0));
}

async function rawMessage(peerId: number, mid: number): Promise<any> {
  const {managers} = await bootTelegram();
  return managers.appMessagesManager.getMessageByPeer(peerId, mid);
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function mapLink(geo: any): string {
  return `https://maps.google.com/maps?q=${geo?.lat ?? 0},${geo?.long ?? 0}`;
}

/**
 * Money as the API sends it: an integer in the currency's smallest unit. The
 * exponent differs per currency (JPY has none, most have two), and Intl already
 * knows every one of them, so ask it rather than assuming cents.
 */
export function formatPrice(amount: number, currency: string): string {
  if(!currency) return '' + amount;
  if(currency === 'XTR') return `${amount} ⭐`;

  try {
    const formatter = new Intl.NumberFormat(undefined, {style: 'currency', currency});
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amount / Math.pow(10, digits));
  } catch(err) {
    return `${amount / 100} ${currency}`;
  }
}

function textOf(value: any): string {
  if(!value) return '';
  return typeof value === 'string' ? value : (value.text ?? '');
}

function peerIdOf(peer: any): number {
  if(!peer) return 0;
  return Number(peer.user_id ?? peer.channel_id ?? peer.chat_id ?? 0);
}

function giftOf(action: any, message: any, self: number): GiftExtra | null {
  const gift = action?.gift;
  if(!gift) return null;

  const unique = gift._ === 'starGiftUnique';
  const model = unique ?
    (gift.attributes ?? []).find((a: any) => a._ === 'starGiftAttributeModel') :
    null;
  const doc = unique ? model?.document : gift.sticker;

  const fromId = peerIdOf(action.from_id) || Number(message?.fromId ?? 0);
  const incoming = fromId !== self;

  let valueText = '';
  if(unique) {
    if(gift.value_amount && gift.value_currency) {
      valueText = formatPrice(Number(gift.value_amount), gift.value_currency);
    }
  } else if(gift.stars) {
    valueText = `${gift.stars} ⭐`;
  }

  const converted = !!action.pFlags?.converted;
  const convertStars = Number(action.convert_stars ?? gift.convert_stars ?? 0);

  return {
    kind: 'gift',
    title: unique ? (gift.title || 'Collectible gift') : (gift.title || 'Gift'),
    subtitle: unique ?
      'Collectible gift' :
      (incoming ?
        (convertStars ? `Convert to ${convertStars} ⭐` : 'Gift received') :
        'Gift sent'),
    message: textOf(action.message),
    sticker: doc ? toSticker(doc) : null,
    valueText,
    unique,
    num: Number(gift.num ?? action.gift_num ?? 0),
    slug: gift.slug ?? '',
    converted,
    incoming
  };
}

function checklistOf(media: any, out: boolean, self: number): ChecklistExtra {
  const todo = media.todo ?? {};
  const completions: any[] = media.completions ?? [];
  const byId = new Map<number, any>(completions.map((c: any) => [Number(c.id), c]));

  const items: ChecklistItem[] = (todo.list ?? []).map((item: any) => {
    const done = byId.get(Number(item.id));
    return {
      id: Number(item.id),
      text: textOf(item.title),
      done: !!done,
      doneById: done ? peerIdOf(done.completed_by) : 0,
      doneDate: done?.date ?? 0
    };
  });

  const othersCanComplete = !!todo.pFlags?.others_can_complete;
  const othersCanAppend = !!todo.pFlags?.others_can_append;

  return {
    kind: 'checklist',
    title: textOf(todo.title),
    items,
    doneCount: items.filter((item) => item.done).length,
    othersCanComplete,
    othersCanAppend,
    canComplete: out || othersCanComplete,
    canAppend: out || othersCanAppend
  };
}

/**
 * The extra body of a message, when it carries one of the types this module
 * covers. `selfIdHint` keeps the call sync — the caller (chats.ts) already
 * knows who we are.
 */
export function extraOf(message: any, peerId: number, selfIdHint: number): MessageExtra | null {
  if(!message) return null;

  const cacheKey = key(peerId, message.mid);
  const out = !!message.pFlags?.out || Number(message.fromId ?? 0) === selfIdHint;

  if(message._ === 'messageService') {
    const action = message.action;
    if(action?._ === 'messageActionStarGift' ||
      action?._ === 'messageActionStarGiftUnique' ||
      action?._ === 'messageActionStarGiftPurchaseOffer') {
      return giftOf(action, message, selfIdHint);
    }
    return null;
  }

  const media = message.media;
  if(!media) return null;

  switch(media._) {
    case 'messageMediaGeo': {
      rawGeo.set(cacheKey, media.geo);
      return {
        kind: 'geo',
        lat: media.geo?.lat ?? 0,
        long: media.geo?.long ?? 0,
        accuracyRadius: media.geo?.accuracy_radius ?? 0,
        mapUrl: mapLink(media.geo)
      };
    }

    case 'messageMediaGeoLive': {
      rawGeo.set(cacheKey, media.geo);
      const startDate = message.date ?? 0;
      const period = media.period ?? 0;
      const expiresAt = startDate + period;
      return {
        kind: 'geoLive',
        lat: media.geo?.lat ?? 0,
        long: media.geo?.long ?? 0,
        accuracyRadius: media.geo?.accuracy_radius ?? 0,
        mapUrl: mapLink(media.geo),
        period,
        heading: media.heading ?? 0,
        startDate,
        editDate: message.edit_date ?? startDate,
        expiresAt,
        expired: Date.now() / 1000 >= expiresAt,
        mine: out
      };
    }

    case 'messageMediaVenue': {
      rawGeo.set(cacheKey, media.geo);
      return {
        kind: 'venue',
        lat: media.geo?.lat ?? 0,
        long: media.geo?.long ?? 0,
        accuracyRadius: media.geo?.accuracy_radius ?? 0,
        mapUrl: mapLink(media.geo),
        title: media.title ?? '',
        address: media.address ?? '',
        provider: media.provider ?? '',
        venueId: media.venue_id ?? '',
        venueType: media.venue_type ?? ''
      };
    }

    case 'messageMediaContact': {
      const firstName = media.first_name ?? '';
      const lastName = media.last_name ?? '';
      return {
        kind: 'contact',
        userId: Number(media.user_id ?? 0),
        firstName,
        lastName,
        name: [firstName, lastName].filter(Boolean).join(' ') || (media.phone_number ?? 'Contact'),
        phone: media.phone_number ?? '',
        vcard: media.vcard ?? ''
      };
    }

    case 'messageMediaGame': {
      const game = media.game ?? {};
      if(game.photo) rawCover.set(cacheKey, game.photo);
      return {
        kind: 'game',
        title: game.title ?? 'Game',
        description: game.description ?? '',
        shortName: game.short_name ?? '',
        hasPhoto: !!game.photo
      };
    }

    case 'messageMediaInvoice': {
      if(media.photo) rawCover.set(cacheKey, media.photo);
      const amount = Number(media.total_amount ?? 0);
      return {
        kind: 'invoice',
        title: media.title ?? '',
        description: media.description ?? '',
        currency: media.currency ?? '',
        amount,
        priceText: formatPrice(amount, media.currency ?? ''),
        test: !!media.pFlags?.test,
        hasPhoto: !!media.photo,
        receiptMid: media.receipt_msg_id ?? 0,
        startParam: media.start_param ?? ''
      };
    }

    case 'messageMediaPaidMedia': {
      const extended: any[] = media.extended_media ?? [];
      return {
        kind: 'paidMedia',
        stars: Number(media.stars_amount ?? 0),
        count: extended.length,
        unlocked: extended.every((item: any) => item?._ !== 'messageExtendedMediaPreview')
      };
    }

    case 'messageMediaToDo':
      return checklistOf(media, out, selfIdHint);
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Map previews                                                        */
/* ------------------------------------------------------------------ */

/**
 * Static map image for a geo point.
 *
 * The image comes from Telegram itself: `inputWebFileGeoPointLocation` is
 * downloaded over MTProto like any other file, the same way tweb renders a
 * location bubble. That keeps the map inside the connection the app already
 * has — no tile server, no third-party host to punch through the CSP, and no
 * new network dependency in the bundle.
 */
export async function loadMapPreview(
  peerId: number,
  mid: number,
  width = 320,
  height = 180
): Promise<string | null> {
  const cacheKey = `${key(peerId, mid)}_${width}x${height}`;
  if(mapUrls.has(cacheKey)) return mapUrls.get(cacheKey)!;

  let geo = rawGeo.get(key(peerId, mid));
  if(!geo) {
    const message = await rawMessage(peerId, mid);
    geo = message?.media?.geo;
    if(geo) rawGeo.set(key(peerId, mid), geo);
  }
  if(!geo) return null;

  await bootTelegram();
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  try {
    const url = await appDownloadManager.downloadMediaURL({
      media: {
        _: 'inputWebFileGeoPointLocation',
        access_hash: geo.access_hash,
        geo_point: {
          _: 'inputGeoPoint',
          lat: geo.lat,
          long: geo.long,
          accuracy_radius: geo.accuracy_radius
        },
        w: width,
        h: height,
        scale: Math.min(2, Math.round(window.devicePixelRatio || 1)) || 1,
        zoom: 16
      }
    } as any);
    mapUrls.set(cacheKey, url ?? null);
    return url ?? null;
  } catch(err) {
    mapUrls.set(cacheKey, null);
    return null;
  }
}

/** Cover image of a game or an invoice. */
export async function loadCoverUrl(peerId: number, mid: number): Promise<string | null> {
  const cacheKey = key(peerId, mid);
  if(coverUrls.has(cacheKey)) return coverUrls.get(cacheKey)!;

  let cover = rawCover.get(cacheKey);
  if(!cover) {
    const message = await rawMessage(peerId, mid);
    cover = message?.media?.photo ?? message?.media?.game?.photo;
    if(cover) rawCover.set(cacheKey, cover);
  }
  if(!cover) return null;

  await bootTelegram();
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  try {
    const url = await appDownloadManager.downloadMediaURL({media: cover});
    coverUrls.set(cacheKey, url ?? null);
    return url ?? null;
  } catch(err) {
    coverUrls.set(cacheKey, null);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Locations — sending, sharing live, stopping                         */
/* ------------------------------------------------------------------ */

export type Coords = {lat: number; long: number; accuracy: number; heading: number};

/** One reading from the browser's geolocation API. */
export function currentPosition(timeout = 15000): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if(!navigator.geolocation) {
      reject(new Error('This browser cannot report a location'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        long: position.coords.longitude,
        accuracy: Math.round(position.coords.accuracy ?? 0),
        heading: Math.round(position.coords.heading ?? 0) || 0
      }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ?
        'Location permission denied' :
        'Could not get your location')),
      {enableHighAccuracy: true, timeout, maximumAge: 30000}
    );
  });
}

type SendOptions = {threadId?: number; replyToMsgId?: number};

function geoPoint(coords: Coords) {
  return {
    _: 'geoPoint',
    lat: coords.lat,
    long: coords.long,
    access_hash: 0,
    accuracy_radius: coords.accuracy || undefined
  };
}

function inputGeoPoint(coords: Coords) {
  return {
    _: 'inputGeoPoint',
    lat: coords.lat,
    long: coords.long,
    accuracy_radius: coords.accuracy || undefined
  };
}

export async function sendLocation(
  peerId: number,
  coords: Coords,
  options: SendOptions = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendOther({
    peerId,
    // sendOther renders the pending bubble from `geoPoint`; the input form goes
    // on the wire. Both are needed or the message shows up blank until reload.
    inputMedia: {_: 'inputMediaGeoPoint', geo_point: inputGeoPoint(coords)} as any,
    geoPoint: geoPoint(coords) as any,
    threadId: options.threadId,
    replyToMsgId: options.replyToMsgId ?? options.threadId,
    clearDraft: true
  } as any);
}

/** Durations Telegram offers for a live location, in seconds. */
export const LIVE_PERIODS = [900, 3600, 8 * 3600] as const;

type LiveShare = {
  peerId: number;
  mid: number;
  period: number;
  expiresAt: number;
  watchId: number;
  timer: ReturnType<typeof setInterval>;
  last: Coords;
};

const liveShares = new Map<number, LiveShare>();
const liveListeners = new Set<() => void>();

function notifyLive() {
  liveListeners.forEach((listener) => listener());
}

/** Subscribe to "am I sharing my location here" changes. */
export function onLiveShareChange(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

export function liveShareState(peerId: number): {active: boolean; expiresAt: number} {
  const share = liveShares.get(peerId);
  if(!share) return {active: false, expiresAt: 0};
  return {active: true, expiresAt: share.expiresAt};
}

/**
 * The live-location message we just posted. `sendOther` resolves without a mid,
 * so the message has to be found again — it is our newest live location in this
 * chat, which is unambiguous the moment after sending.
 */
async function findOwnLiveMessage(peerId: number): Promise<any | null> {
  const {managers} = await bootTelegram();
  const self = await selfId();

  const result = await managers.appMessagesManager.getHistory({peerId, limit: 20});
  for(const mid of result?.history ?? []) {
    const message: any = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
    if(message?.media?._ !== 'messageMediaGeoLive') continue;
    if(!message.pFlags?.out && Number(message.fromId ?? 0) !== self) continue;
    return message;
  }

  return null;
}

async function editLive(
  peerId: number,
  mid: number,
  coords: Coords,
  period: number,
  stopped: boolean
): Promise<void> {
  const {managers} = await bootTelegram();
  const message = await rawMessage(peerId, mid);
  if(!message) return;

  await managers.appMessagesManager.editMessage(message, '', {
    newMedia: {
      _: 'inputMediaGeoLive',
      pFlags: stopped ? {stopped: true} : {},
      geo_point: inputGeoPoint(coords),
      heading: coords.heading || undefined,
      period: stopped ? undefined : period
    } as any
  });
}

/**
 * Starts sharing this device's location with a chat for `period` seconds.
 *
 * The browser reports movement through `watchPosition`, but every reading must
 * not become an edit: the message is updated on a timer, and only when the pin
 * has actually moved, the same throttling the official clients apply.
 */
export async function startLiveLocation(
  peerId: number,
  period: number,
  options: SendOptions = {}
): Promise<void> {
  if(liveShares.has(peerId)) await stopLiveLocation(peerId);

  const coords = await currentPosition();
  const {managers} = await bootTelegram();

  await managers.appMessagesManager.sendOther({
    peerId,
    inputMedia: {
      _: 'inputMediaGeoLive',
      pFlags: {},
      geo_point: inputGeoPoint(coords),
      heading: coords.heading || undefined,
      period
    } as any,
    geoPoint: geoPoint(coords) as any,
    threadId: options.threadId,
    replyToMsgId: options.replyToMsgId ?? options.threadId,
    clearDraft: true
  } as any);

  const message = await findOwnLiveMessage(peerId);
  if(!message) return;

  let last = coords;
  let pending: Coords | null = null;

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      pending = {
        lat: position.coords.latitude,
        long: position.coords.longitude,
        accuracy: Math.round(position.coords.accuracy ?? 0),
        heading: Math.round(position.coords.heading ?? 0) || 0
      };
    },
    () => {},
    {enableHighAccuracy: true, maximumAge: 30000}
  );

  const share: LiveShare = {
    peerId,
    mid: message.mid,
    period,
    expiresAt: (message.date ?? Math.floor(Date.now() / 1000)) + period,
    watchId,
    last,
    timer: setInterval(() => {
      const current = liveShares.get(peerId);
      if(!current) return;

      if(Date.now() / 1000 >= current.expiresAt) {
        // The server drops the share on its own once the period is up; all this
        // side has to do is stop paying for a GPS watch nobody reads.
        stopWatching(peerId);
        return;
      }

      const next = pending;
      if(!next) return;
      pending = null;

      const moved = Math.abs(next.lat - last.lat) > 0.0001 || Math.abs(next.long - last.long) > 0.0001;
      if(!moved) return;

      last = next;
      current.last = next;
      editLive(peerId, current.mid, next, current.period, false).catch(() => {});
    }, 30000)
  };

  liveShares.set(peerId, share);
  notifyLive();
}

function stopWatching(peerId: number): LiveShare | null {
  const share = liveShares.get(peerId);
  if(!share) return null;

  clearInterval(share.timer);
  navigator.geolocation.clearWatch(share.watchId);
  liveShares.delete(peerId);
  notifyLive();
  return share;
}

/** Ends a live share early — ours, or someone else's message we can edit. */
export async function stopLiveLocation(peerId: number, mid?: number): Promise<void> {
  const share = stopWatching(peerId);
  const targetMid = mid ?? share?.mid;
  if(!targetMid) return;

  const coords = share?.last ?? {lat: 0, long: 0, accuracy: 0, heading: 0};
  await editLive(peerId, targetMid, coords, share?.period ?? 0, true);
}

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

/** Shares an existing chat partner as a contact card. */
export async function sendContact(
  peerId: number,
  contactPeerId: number,
  options: SendOptions = {}
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendOther({
    peerId,
    inputMedia: await managers.appUsersManager.getContactMediaInput(contactPeerId),
    threadId: options.threadId,
    replyToMsgId: options.replyToMsgId ?? options.threadId,
    clearDraft: true
  } as any);
}

/** Saves the person behind a shared contact card to the address book. */
export async function addContact(contact: ContactExtra): Promise<void> {
  const {managers} = await bootTelegram();
  if(!contact.userId) throw new Error('This contact is not on Telegram');

  await managers.appUsersManager.addContact(
    contact.userId,
    contact.firstName,
    contact.lastName,
    contact.phone
  );
}

/* ------------------------------------------------------------------ */
/* Games                                                               */
/* ------------------------------------------------------------------ */

/**
 * Play button on a game message. The bot answers with a one-time URL for the
 * game session, which opens in a new tab — this client has no in-app browser.
 */
export async function playGame(peerId: number, mid: number): Promise<string> {
  const {managers} = await bootTelegram();
  const answer: any = await managers.appInlineBotsManager.callbackButtonClick(
    peerId,
    mid,
    undefined,
    true
  );
  return answer?.url ?? '';
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

/**
 * Hands an invoice off to its provider's checkout page.
 *
 * Web S has no checkout of its own: there is no card form, no saved
 * credentials, and no Stars balance UI. What it can do honestly is fetch the
 * payment form and open the provider URL the API returns. Forms that have no
 * URL — Stars invoices, and anything that needs the native flow — cannot be
 * paid here, and say so rather than pretending to start.
 */
export async function invoiceCheckoutUrl(peerId: number, mid: number): Promise<string> {
  const {managers} = await bootTelegram();
  const invoice = await managers.appPaymentsManager.getInputInvoiceByPeerId(peerId, mid);
  const form: any = await managers.appPaymentsManager.getPaymentForm(invoice);
  return form?.url ?? '';
}

/* ------------------------------------------------------------------ */
/* Checklists                                                          */
/* ------------------------------------------------------------------ */

export async function toggleChecklistItem(
  peerId: number,
  mid: number,
  taskId: number,
  done: boolean
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.updateTodo({
    peerId,
    mid,
    taskId,
    action: done ? 'complete' : 'uncomplete'
  });
}

export async function appendChecklistItems(
  peerId: number,
  mid: number,
  texts: string[]
): Promise<void> {
  const items = texts.map((text) => text.trim()).filter(Boolean);
  if(!items.length) return;

  const message = await rawMessage(peerId, mid);
  const list: any[] = message?.media?.todo?.list ?? [];
  const maxId = list.reduce((max: number, item: any) => Math.max(max, Number(item.id)), 0);

  const {managers} = await bootTelegram();
  await managers.appMessagesManager.appendTodo({
    peerId,
    mid,
    tasks: items.map((text, index) => ({
      _: 'todoItem',
      id: maxId + index + 1,
      title: {_: 'textWithEntities', text, entities: []}
    })) as any
  });
}

/** Ticks every remaining item — the "mark done" shortcut on a checklist. */
export async function completeChecklist(
  peerId: number,
  mid: number,
  items: ChecklistItem[]
): Promise<void> {
  for(const item of items) {
    if(item.done) continue;
    await toggleChecklistItem(peerId, mid, item.id, true);
  }
}

/* ------------------------------------------------------------------ */
/* Polls — creating, and the votes breakdown                           */
/* ------------------------------------------------------------------ */

export type NewPoll = {
  question: string;
  options: string[];
  anonymous: boolean;
  multiple: boolean;
  quiz: boolean;
  /** Index into `options`; only meaningful for a quiz. */
  correctIndex: number;
  explanation: string;
};

export async function createPoll(
  peerId: number,
  poll: NewPoll,
  options: SendOptions = {}
): Promise<void> {
  const question = poll.question.trim();
  const answers = poll.options.map((option) => option.trim()).filter(Boolean);

  if(!question) throw new Error('The poll needs a question');
  if(answers.length < 2) throw new Error('The poll needs at least two options');
  if(poll.quiz && (poll.correctIndex < 0 || poll.correctIndex >= answers.length)) {
    throw new Error('Pick the correct answer');
  }

  const {managers} = await bootTelegram();
  await managers.appPollsManager.sendPollMessage(
    {
      peerId,
      threadId: options.threadId,
      replyToMsgId: options.replyToMsgId ?? options.threadId
    } as any,
    {
      question,
      questionEntities: [],
      description: '',
      descriptionEntities: [],
      pollOptions: answers.map((text, index) => ({
        text,
        entities: [],
        checked: poll.quiz && index === poll.correctIndex
      })),
      // A quiz is single-answer and public by definition; the rest follow the
      // switches the composer offers.
      showWhoVoted: !poll.anonymous,
      allowMultipleAnswers: poll.multiple && !poll.quiz,
      allowAddingOptions: false,
      allowRevoting: !poll.quiz,
      shuffleOptions: false,
      hasCorrectAnswer: poll.quiz,
      restrictToSubscribers: false,
      limitByCountry: false,
      countriesIso2: [],
      durationLimited: false,
      explanation: poll.quiz ? poll.explanation.trim() : '',
      explanationEntities: [],
      hideResults: false
    } as any
  );
}

export type PollVoter = {peerId: number; title: string; date: number};

function titleOf(peer: any): string {
  if(!peer) return 'Unknown';
  if(peer._ === 'user') {
    const name = [peer.first_name, peer.last_name].filter(Boolean).join(' ').trim();
    return name || peer.username || (peer.pFlags?.deleted ? 'Deleted Account' : 'User');
  }
  return peer.title || 'Chat';
}

/**
 * Who voted for one option. Only public polls answer this — an anonymous poll
 * returns nothing, which is the point of it being anonymous.
 */
export async function pollVoters(
  peerId: number,
  mid: number,
  optionIndex: number,
  limit = 50
): Promise<PollVoter[]> {
  const {managers} = await bootTelegram();
  const message = await rawMessage(peerId, mid);
  const poll = message?.media?.poll;
  if(!poll || !poll.pFlags?.public_voters) return [];

  const option = poll.answers?.[optionIndex]?.option;
  if(!option) return [];

  try {
    const result: any = await managers.appPollsManager.getVotes(message, option, undefined, limit);
    const self = await selfId();

    return Promise.all((result?.votes ?? []).map(async(vote: any) => {
      const voterId = Number(managers.appPeersManager.getPeerId(vote.peer));
      const cached = (result.users ?? []).find((user: any) => Number(user.id) === Math.abs(voterId)) ??
        (result.chats ?? []).find((chat: any) => Number(chat.id) === Math.abs(voterId));
      const peer = cached ?? await managers.appPeersManager.getPeer(voterId);
      return {
        peerId: voterId,
        title: voterId === self ? 'You' : titleOf(peer),
        date: vote.date ?? 0
      };
    }));
  } catch(err) {
    return [];
  }
}
