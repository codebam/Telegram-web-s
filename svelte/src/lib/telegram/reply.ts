/**
 * Replies and forwarding.
 *
 * A reply in Telegram is more than a message id. It can quote a fragment of the
 * original (`quote_text` + `quote_offset`), and it can point at a message that
 * lives in a *different* chat (`reply_to_peer_id`) — the "reply in another
 * chat" flow. Forwarding likewise carries options: drop the author, drop the
 * captions, send a comment along with the forwarded batch.
 *
 * Everything here goes through `appMessagesManager`; nothing talks to MTProto
 * directly. The values handed back to the worker are plain objects on purpose —
 * a `$state` proxy is not structured-cloneable and the request would silently
 * never leave the tab.
 */

import getPeerId from '@appManagers/utils/peers/getPeerId';
import getServerMessageId from '@appManagers/utils/messageId/getServerMessageId';

import {bootTelegram} from './client';

/** The excerpt attached to a reply. `offset` is into the original's text. */
export type ReplyQuote = {
  text: string;
  offset: number;
};

/**
 * What the composer is replying to. `peerId` is the chat the original lives in,
 * which is not necessarily the chat being typed in — see `replySendOptions`.
 */
export type ReplyTarget = {
  mid: number;
  peerId: number;
  /** Who wrote the original. */
  title: string;
  /** Original's text, for the reply bar. */
  text: string;
  /** Set only when the original is in another chat; '' otherwise. */
  chatTitle: string;
  quote: ReplyQuote | null;
};

/** The reply header rendered inside a bubble. */
export type ReplyInfo = {
  mid: number;
  /** Chat the replied-to message lives in. */
  peerId: number;
  /** Author of the replied-to message. */
  title: string;
  /** Author's peer colour, for the header line. */
  color: string;
  /** One-line preview of the original. */
  text: string;
  /** The quoted excerpt, '' when the reply quotes nothing. */
  quote: string;
  /** True when the original carries media worth a thumbnail. */
  hasMedia: boolean;
  /** Set when the reply points into another chat. */
  chatTitle: string;
  /** The original is gone — nothing to jump to. */
  deleted: boolean;
};

/** The "Forwarded from" header rendered above a forwarded bubble. */
export type ForwardInfo = {
  /** Channel/author name, or the name a hidden sender chose to show. */
  title: string;
  /** Author's peer colour. */
  color: string;
  /** 0 when the sender is hidden or unknown — no profile to open. */
  peerId: number;
  /** Message id in the source chat, 0 when there is nothing to link to. */
  mid: number;
  /** The original poster's byline inside a channel, '' when absent. */
  postAuthor: string;
  /** Sender chose to hide their account: no link, no profile. */
  hidden: boolean;
  /** When the original was posted. */
  date: number;
  /** t.me link to the source message, '' when it is not linkable. */
  link: string;
};

export type ForwardOptions = {
  /** Strip "Forwarded from" — Telegram's "hide sender name". */
  dropAuthor: boolean;
  /** Forward media without its captions. */
  dropCaptions: boolean;
  /** Sent as an ordinary message before the batch, '' to send nothing. */
  comment: string;
};

/**
 * The server caps a quote. `quote_length_max` comes from the app config, but
 * reading it is a round-trip the reply bar should not wait on, and the value
 * has been 1024 for as long as the field has existed.
 */
const QUOTE_LENGTH_MAX = 1024;

/**
 * Author colours, matching tweb's `DialogColorsFg` defaults. The palette the
 * server can override lives behind `help.getPeerColors`, which this client does
 * not fetch — the defaults are what every peer falls back to anyway.
 */
const PEER_COLORS = ['#cc5049', '#d67722', '#955cdb', '#40a920', '#309eba', '#368ad1', '#c7508b'];

export function peerColor(peerId: number, peer?: any): string {
  const index = peer?.color?.color ?? Math.abs(peerId) % PEER_COLORS.length;
  return PEER_COLORS[index % PEER_COLORS.length] ?? PEER_COLORS[0];
}

async function getPeer(peerId: number): Promise<any> {
  if(!peerId) return null;
  const {managers} = await bootTelegram();
  try {
    return await managers.appPeersManager.getPeer(peerId);
  } catch(err) {
    return null;
  }
}

function titleOf(peer: any): string {
  if(!peer) return '';
  if(peer.title) return peer.title;
  const name = [peer.first_name, peer.last_name].filter(Boolean).join(' ');
  return name || (peer.username ? '@' + peer.username : '');
}

/** Short description of a message, for a reply bar or a reply header. */
function previewOf(message: any): string {
  if(!message) return '';
  const text = message.message ?? '';
  if(text) return text.length > 140 ? text.slice(0, 140) + '…' : text;
  return mediaLabel(message.media);
}

function mediaLabel(media: any): string {
  switch(media?._) {
    case 'messageMediaPhoto': return 'Photo';
    case 'messageMediaGeo':
    case 'messageMediaGeoLive': return 'Location';
    case 'messageMediaContact': return 'Contact';
    case 'messageMediaPoll': return 'Poll';
    case 'messageMediaDocument': return documentLabel(media.document);
    case 'messageMediaStory': return 'Story';
    default: return media ? 'Media' : '';
  }
}

function documentLabel(doc: any): string {
  const attributes: any[] = doc?.attributes ?? [];
  const has = (type: string) => attributes.some((a) => a._ === type);
  if(has('documentAttributeSticker')) return 'Sticker';
  if(has('documentAttributeAnimated')) return 'GIF';
  if(has('documentAttributeAudio')) {
    const audio = attributes.find((a) => a._ === 'documentAttributeAudio');
    return audio?.pFlags?.voice ? 'Voice message' : 'Audio';
  }
  if(has('documentAttributeVideo')) return 'Video';
  return doc?.file_name || 'File';
}

function hasThumbnail(media: any): boolean {
  if(media?._ === 'messageMediaPhoto') return true;
  if(media?._ !== 'messageMediaDocument') return false;
  const doc = media.document;
  const attributes: any[] = doc?.attributes ?? [];
  return attributes.some((a) => a._ === 'documentAttributeVideo' || a._ === 'documentAttributeAnimated') ||
    !!doc?.mime_type?.startsWith('image/');
}

/**
 * Builds the reply header for a bubble.
 *
 * The header alone is enough to render a quote and a cross-chat reply: the
 * server sends `quote_text` and, for a message this client has never loaded,
 * `reply_from` / `reply_media` describing the original. The replied-to message
 * is fetched on top of that when it is reachable, for a fuller preview.
 */
export async function buildReplyInfo(
  message: any,
  peerId: number,
  selfId: number
): Promise<ReplyInfo | null> {
  const header = message?.reply_to;
  const replyToMid = message?.reply_to_mid;
  if(!header || header._ === 'messageReplyStoryHeader' || !replyToMid) return null;

  const {managers} = await bootTelegram();

  const replyPeerId = header.reply_to_peer_id ? Number(getPeerId(header.reply_to_peer_id)) : peerId;
  const crossChat = replyPeerId !== peerId;
  // `pFlags.quote` marks a manual quote, but the excerpt is what matters here
  // and older layers send it without the flag.
  const quote = header.quote_text ?? '';

  const replied = header.reply_to_msg_deleted ?
    null :
    await managers.appMessagesManager.getMessageByPeer(replyPeerId, replyToMid).catch(() => null);

  // Fall back to what the header itself describes when the original is not
  // reachable — a cross-chat reply into a channel this account cannot read
  // still names its author.
  const fromId = replied ?
    Number(replied.fromId ?? replyPeerId) :
    Number(header.reply_from?.from_id ? getPeerId(header.reply_from.from_id) : replyPeerId);

  const fromPeer = fromId === selfId ? null : await getPeer(fromId);
  const chatPeer = crossChat ? await getPeer(replyPeerId) : null;

  const text = replied ?
    previewOf(replied) :
    (mediaLabel(header.reply_media) || quote || 'Message');

  return {
    mid: replyToMid,
    peerId: replyPeerId,
    title: fromId === selfId ?
      'You' :
      (titleOf(fromPeer) || header.reply_from?.from_name || 'Unknown'),
    color: peerColor(fromId, fromPeer),
    text,
    quote,
    hasMedia: hasThumbnail(replied?.media ?? header.reply_media),
    chatTitle: crossChat ? titleOf(chatPeer) : '',
    deleted: !replied && !!header.reply_to_msg_deleted
  };
}

/** Builds the "Forwarded from" header for a bubble, null when not forwarded. */
export async function buildForwardInfo(message: any, selfId: number): Promise<ForwardInfo | null> {
  const header = message?.fwd_from;
  if(!header) return null;

  // A sender who forbids being linked comes through as a bare name.
  const hidden = !header.from_id && !!header.from_name;
  const fromId = header.from_id ? Number(getPeerId(header.from_id)) : 0;
  const peer = fromId && fromId !== selfId ? await getPeer(fromId) : null;

  const sourceMid = header.channel_post ?? 0;
  const link = fromId && sourceMid ? await messageLink(fromId, sourceMid) : '';

  return {
    title: hidden ?
      header.from_name :
      (fromId === selfId ? 'You' : (titleOf(peer) || header.from_name || 'Unknown')),
    color: peerColor(fromId, peer),
    peerId: hidden ? 0 : fromId,
    mid: sourceMid,
    postAuthor: header.post_author ?? '',
    hidden,
    date: header.date ?? 0,
    link
  };
}

/**
 * Public link to a message. Peers with a username get the pretty form; a
 * private channel gets the `/c/` form, which only members can open. Anything
 * else — a user chat, a basic group — has no addressable message.
 */
export async function messageLink(peerId: number, mid: number): Promise<string> {
  if(!peerId || peerId > 0 || !mid) return '';

  const {managers} = await bootTelegram();
  const serverId = getServerMessageId(mid);

  try {
    const username = await managers.appPeersManager.getPeerUsername(peerId);
    if(username) return `https://t.me/${username}/${serverId}`;

    const chat: any = await managers.appPeersManager.getPeer(peerId);
    if(chat?._ !== 'channel') return '';
    return `https://t.me/c/${chat.id}/${serverId}`;
  } catch(err) {
    return '';
  }
}

/**
 * A thumbnail for the message a reply points at. Resolved separately from the
 * bubble's own media: the original can live in a chat whose history was never
 * loaded, so it is not in any cache the media loader knows about.
 */
export async function loadReplyThumbUrl(peerId: number, mid: number): Promise<string | null> {
  const {managers} = await bootTelegram();

  const message: any = await managers.appMessagesManager.getMessageByPeer(peerId, mid).catch(() => null);
  const media = message?.media;
  const target = media?.photo ?? media?.document;
  if(!target || !hasThumbnail(media)) return null;

  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  try {
    const thumb = choosePhotoSize(target, 64, 64, true);
    return await appDownloadManager.downloadMediaURL({media: target, thumb: thumb as any}) ?? null;
  } catch(err) {
    return null;
  }
}

/**
 * Turns the selection inside a rendered message into a quote.
 *
 * The offset has to be an offset into the message's own text, not into what the
 * DOM happens to render, so it is measured by walking the range from the start
 * of the text container and then checked against `text`. When the selection
 * spans something the bubble renders but the message does not contain (a time
 * stamp, a button label) the check fails and the quote is refused rather than
 * sent at a wrong offset — the server rejects a mismatched quote outright.
 */
export function quoteFromSelection(container: HTMLElement, text: string): ReplyQuote | null {
  const selection = window.getSelection?.();
  if(!selection || selection.isCollapsed || !selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  if(!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;

  const selected = range.toString().trim();
  if(!selected) return null;

  const before = range.cloneRange();
  before.selectNodeContents(container);
  before.setEnd(range.startContainer, range.startOffset);

  let offset = before.toString().length;
  // The rendered prefix and the raw text can drift (a spoiler button, an
  // emoji rendered as an image), so trust the position only when it matches.
  if(text.substr(offset, selected.length) !== selected) {
    offset = text.indexOf(selected);
    if(offset === -1) return null;
  }

  const clamped = selected.slice(0, QUOTE_LENGTH_MAX);
  return {text: clamped, offset};
}

/**
 * The last quote the user selected, remembered across the click that acts on
 * it.
 *
 * Pressing a button collapses the selection on mousedown, so by the time
 * "Reply" runs there is nothing left to read. The selection is therefore
 * captured as it happens and kept for a moment after it disappears — long
 * enough for the click it belongs to, short enough that an unrelated Reply
 * later does not silently quote something the user has moved on from.
 */
const QUOTE_GRACE_MS = 1500;

let tracked: {mid: number; quote: ReplyQuote; collapsedAt: number} | null = null;

/**
 * Watches the document selection and keeps whatever falls inside a rendered
 * message. `textOf` resolves a message id to that message's text, which is what
 * the quote offset is measured against. Returns the unsubscribe.
 */
export function trackQuoteSelection(textOf: (mid: number) => string): () => void {
  const onSelectionChange = () => {
    const selection = window.getSelection?.();

    if(!selection || selection.isCollapsed || !selection.rangeCount) {
      if(tracked && !tracked.collapsedAt) tracked.collapsedAt = Date.now();
      return;
    }

    const start = selection.getRangeAt(0).startContainer;
    const element = start.nodeType === Node.ELEMENT_NODE ?
      (start as Element) :
      start.parentElement;
    const bubble = element?.closest?.('[data-mid]') as HTMLElement | null;
    if(!bubble) {
      tracked = null;
      return;
    }

    const mid = Number(bubble.dataset.mid);
    const quote = quoteFromSelection(bubble, textOf(mid));
    tracked = quote ? {mid, quote, collapsedAt: 0} : null;
  };

  document.addEventListener('selectionchange', onSelectionChange);
  return () => document.removeEventListener('selectionchange', onSelectionChange);
}

/** The tracked quote for `mid`, if it is still fresh. */
export function trackedQuote(mid: number): ReplyQuote | null {
  if(!tracked || tracked.mid !== mid) return null;
  if(tracked.collapsedAt && Date.now() - tracked.collapsedAt > QUOTE_GRACE_MS) return null;
  return tracked.quote;
}

export function clearTrackedQuote(): void {
  tracked = null;
}

/**
 * Send options for a reply. Deliberately returns a fresh plain object: the
 * reply target is held in `$state` in the UI and a proxy cannot cross into the
 * worker.
 *
 * `replyToPeerId` is set only for a cross-chat reply — passing the chat being
 * sent to would make the server reject an ordinary reply in a thread.
 */
export function replySendOptions(
  target: ReplyTarget | null,
  sendingToPeerId: number
): {replyToMsgId?: number; replyToPeerId?: number; replyToQuote?: {text: string; offset: number}} {
  if(!target) return {};

  return {
    replyToMsgId: target.mid,
    replyToPeerId: target.peerId !== sendingToPeerId ? target.peerId : undefined,
    replyToQuote: target.quote ? {text: target.quote.text, offset: target.quote.offset} : undefined
  };
}

/**
 * Forwards `mids` from one chat into several, in one call per target so the
 * batch keeps its order, with the optional comment sent first — the same order
 * the official clients use, so the comment reads as an introduction.
 */
export async function forwardTo(
  fromPeerId: number,
  mids: number[],
  toPeerIds: number[],
  options: Partial<ForwardOptions> = {}
): Promise<void> {
  if(!mids.length || !toPeerIds.length) return;

  const {managers} = await bootTelegram();
  const ordered = [...mids].sort((a, b) => a - b);
  const comment = (options.comment ?? '').trim();

  for(const peerId of toPeerIds) {
    if(comment) {
      await managers.appMessagesManager.sendText({peerId, text: comment});
    }

    await managers.appMessagesManager.forwardMessages({
      peerId,
      fromPeerId,
      mids: ordered,
      dropAuthor: !!options.dropAuthor,
      dropCaptions: !!options.dropCaptions
    } as any);
  }
}
