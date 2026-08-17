/**
 * Telegram deep links — `t.me/…` and `tg://…`.
 *
 * tweb has `src/lib/internalLinkProcessor.ts`, which is both the parser *and*
 * the dispatcher: its ~40 anchor listeners call straight into `appImManager`,
 * `PopupElement` and a dozen Solid components. Importing it here would drag the
 * whole Solid client into the Svelte bundle, so this module keeps tweb's link
 * *grammar* (the rules below are transcribed from `wrapUrl.ts` and the `im` /
 * `resolve` anchor listeners) and routes the parsed result through managers
 * instead — the same managers tweb's processors use.
 *
 * Parsing is pure and synchronous; anything that touches the network lives in
 * `resolveLink` and the `join*` helpers.
 */
import {PHONE_NUMBER_REG_EXP} from '@lib/richTextProcessor';
import matchUrlProtocol from '@lib/richTextProcessor/matchUrlProtocol';
import {T_ME_PREFIXES} from '@appManagers/constants';

import {bootTelegram} from './client';

/** A recognised Telegram link, before anything is resolved against the API. */
export type TelegramLink =
  | {type: 'peer', domain: string, post?: number, thread?: number, comment?: number, start?: string}
  | {type: 'privatePost', channel: string, post?: number, thread?: number, comment?: number}
  | {type: 'userId', userId: number}
  | {type: 'joinChat', invite: string}
  | {type: 'addList', slug: string}
  | {type: 'stickerSet', set: string, isEmoji: boolean}
  | {type: 'phone', phone: string}
  | {type: 'share', url: string, text?: string}
  | {type: 'webApp', domain: string, appname: string, startapp?: string};

/** What the UI should actually do once the link has been resolved. */
export type LinkAction =
  | {type: 'openPeer', peerId: number, mid?: number, threadId?: number, startParam?: string}
  | {type: 'openChat', peerId: number}
  | {type: 'joinChat', invite: string, title: string, about: string, participantsCount: number, requestNeeded: boolean}
  | {type: 'addList', slug: string, title: string, peers: LinkPeer[], alreadyPeerIds: number[], filterId?: number}
  | {type: 'stickerSet', set: string, isEmoji: boolean}
  | {type: 'share', url: string, text?: string}
  | {type: 'webApp', domain: string, appname: string, startapp?: string}
  | {type: 'error', message: string};

export type LinkPeer = {peerId: number, title: string};

const T_ME_REG_EXP = /^(?:https?:\/\/)?(?:(.+?)\.)?(?:(?:web|k|z|a)\.)?t(?:elegram)?\.me(?:\/(.+))?/;

/**
 * Web app names are `t.me/<domain>/<appname>`; a numeric second segment is a
 * message id, never an app. Mirrors tweb's `isWebAppNameValid`.
 */
function isWebAppName(name: string): boolean {
  return /^[a-zA-Z0-9_]{3,32}$/.test(name) && !/^\d+$/.test(name);
}

function num(value: string | number | undefined | null): number | undefined {
  if(value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Classify a URL. Returns `null` for anything that is not a Telegram link, so
 * callers can fall through to opening it as an ordinary web page.
 */
export function parseTelegramLink(rawUrl: string): TelegramLink | null {
  if(!rawUrl) return null;

  const trimmed = rawUrl.trim();

  // tg:// first — `matchUrlProtocol` would leave it alone, but a `tg:` URL has
  // no host so the t.me branch cannot match it anyway.
  const tgMatch = trimmed.match(/^tg:(?:\/\/)?([^?#]+)(?:\?([^#]*))?/i);
  if(tgMatch) {
    return parseTgProtocol(tgMatch[1].split('/')[0].toLowerCase(), new URLSearchParams(tgMatch[2] || ''));
  }

  const url = matchUrlProtocol(trimmed) ? trimmed : 'https://' + trimmed;
  if(!T_ME_REG_EXP.test(url)) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch(err) {
    return null;
  }

  // `someone.t.me` is a username in the host; the `web|k|z|a` client prefixes
  // are not. tweb folds the former back into the path.
  const hostPrefix = url.match(T_ME_REG_EXP)?.[1];
  let pathname = parsed.pathname;
  if(hostPrefix && !T_ME_PREFIXES.has(hostPrefix)) {
    pathname = '/' + hostPrefix + (pathname === '/' ? '' : pathname);
  }

  const fullPath = decodeURIComponent(pathname.slice(1));
  const path = fullPath.split('/').filter(Boolean);
  const params = parsed.searchParams;
  if(!path.length) return null;

  // `t.me/+abc` is an invite; `t.me/+79991234567` is a phone number.
  if(fullPath.startsWith('+')) {
    if(PHONE_NUMBER_REG_EXP.test(fullPath)) return {type: 'phone', phone: fullPath};
    return {type: 'joinChat', invite: fullPath.slice(1)};
  }

  switch(path[0]) {
    case 'joinchat':
      return path[1] ? {type: 'joinChat', invite: path[1]} : null;
    case 'addlist':
      return path[1] ? {type: 'addList', slug: path[1]} : null;
    case 'addstickers':
      return path[1] ? {type: 'stickerSet', set: path[1], isEmoji: false} : null;
    case 'addemoji':
      return path[1] ? {type: 'stickerSet', set: path[1], isEmoji: true} : null;
    case 'share':
      return {type: 'share', url: params.get('url') || '', text: params.get('text') || undefined};
    case 'c': {
      // /c/<channel>/<post> or /c/<channel>/<thread>/<post>
      if(!path[1]) return null;
      return {
        type: 'privatePost',
        channel: path[1],
        post: num(path[3] || path[2]),
        thread: num(params.get('thread') ?? (path[3] ? path[2] : undefined)),
        comment: num(params.get('comment'))
      };
    }
  }

  const domain = path[0];

  if(path[1] && isWebAppName(path[1])) {
    return {type: 'webApp', domain, appname: path[1], startapp: params.get('startapp') || undefined};
  }

  if(!path[1] && params.get('startapp') !== null) {
    return {type: 'webApp', domain, appname: '', startapp: params.get('startapp') || undefined};
  }

  return {
    type: 'peer',
    domain,
    post: num(path[2] || path[1]),
    thread: num(params.get('thread') ?? (path[2] ? path[1] : undefined)),
    comment: num(params.get('comment')),
    start: params.get('start') || undefined
  };
}

function parseTgProtocol(method: string, params: URLSearchParams): TelegramLink | null {
  switch(method) {
    case 'resolve': {
      const domain = params.get('domain');
      if(!domain) {
        const phone = params.get('phone');
        return phone ? {type: 'phone', phone: '+' + phone.replace(/^\+/, '')} : null;
      }

      const appname = params.get('appname');
      if(appname) {
        return {type: 'webApp', domain, appname, startapp: params.get('startapp') || undefined};
      }

      return {
        type: 'peer',
        domain,
        post: num(params.get('post')),
        thread: num(params.get('thread')),
        comment: num(params.get('comment')),
        start: params.get('start') || undefined
      };
    }
    case 'join': {
      const invite = params.get('invite');
      return invite ? {type: 'joinChat', invite} : null;
    }
    case 'addlist': {
      const slug = params.get('slug');
      return slug ? {type: 'addList', slug} : null;
    }
    case 'addstickers': {
      const set = params.get('set');
      return set ? {type: 'stickerSet', set, isEmoji: false} : null;
    }
    case 'addemoji': {
      const set = params.get('set');
      return set ? {type: 'stickerSet', set, isEmoji: true} : null;
    }
    case 'privatepost': {
      const channel = params.get('channel');
      return channel ? {
        type: 'privatePost',
        channel,
        post: num(params.get('post')),
        thread: num(params.get('thread'))
      } : null;
    }
    case 'msg_url':
      return {type: 'share', url: params.get('url') || '', text: params.get('text') || undefined};
    case 'user': {
      const userId = num(params.get('id'));
      return userId ? {type: 'userId', userId} : null;
    }
    default:
      return null;
  }
}

/**
 * The Svelte app's peer id convention (see `chats.ts`): users are positive,
 * chats and channels are the negated raw id.
 */
function peerIdOf(peer: any): number {
  const id = Number(peer?.id ?? 0);
  if(!id) return 0;
  return peer._ === 'user' ? id : -id;
}

function titleOf(peer: any): string {
  if(!peer) return 'Unknown';
  if(peer._ === 'user') {
    const name = [peer.first_name, peer.last_name].filter(Boolean).join(' ').trim();
    return name || peer.username || 'User';
  }
  return peer.title || 'Chat';
}

/**
 * Turn a parsed link into something the UI can act on. Network errors are
 * returned as an `error` action rather than thrown — a bad link is a normal
 * outcome, not an exception.
 */
export async function resolveLink(link: TelegramLink): Promise<LinkAction> {
  const {managers} = await bootTelegram();

  switch(link.type) {
    case 'peer': {
      try {
        const peer: any = await managers.appUsersManager.resolveUsername(link.domain.replace(/^@/, ''));
        const peerId = peerIdOf(peer);
        if(!peerId) return {type: 'error', message: `No chat found for @${link.domain}`};
        return {type: 'openPeer', peerId, mid: link.post, threadId: link.thread, startParam: link.start};
      } catch(err: any) {
        return {type: 'error', message: linkError(err, `No chat found for @${link.domain}`)};
      }
    }

    case 'userId':
      return {type: 'openPeer', peerId: link.userId};

    case 'privatePost': {
      // A `/c/` link carries the bare channel id; the app negates it.
      const channelId = Number(link.channel);
      if(!channelId) return {type: 'error', message: 'Malformed message link'};
      return {type: 'openPeer', peerId: -channelId, mid: link.post, threadId: link.thread};
    }

    case 'phone': {
      try {
        const peer: any = await managers.appUsersManager.resolvePhone(link.phone.replace(/^\+/, ''));
        const peerId = peerIdOf(peer);
        if(!peerId) return {type: 'error', message: 'No Telegram account for that number'};
        return {type: 'openPeer', peerId};
      } catch(err: any) {
        return {type: 'error', message: linkError(err, 'No Telegram account for that number')};
      }
    }

    case 'joinChat': {
      try {
        const invite: any = await managers.appChatInvitesManager.checkChatInvite(link.invite);

        // Already a member (or peeking) — just open it.
        if(invite?._ === 'chatInviteAlready' || invite?._ === 'chatInvitePeek') {
          return {type: 'openChat', peerId: -Number(invite.chat?.id ?? 0)};
        }

        return {
          type: 'joinChat',
          invite: link.invite,
          title: invite?.title || 'Chat',
          about: invite?.about || '',
          participantsCount: Number(invite?.participants_count ?? 0),
          requestNeeded: !!invite?.pFlags?.request_needed
        };
      } catch(err: any) {
        return {type: 'error', message: linkError(err, 'This invite link is no longer valid')};
      }
    }

    case 'addList': {
      try {
        const invite: any = await managers.filtersStorage.checkChatlistInvite(link.slug);
        const known = new Map<number, any>();
        for(const chat of invite?.chats || []) known.set(-Number(chat.id), chat);
        for(const user of invite?.users || []) known.set(Number(user.id), user);

        const toPeers = (list: any[]): LinkPeer[] =>
          (list || []).map((peer: any) => {
            const peerId = rawPeerId(peer);
            return {peerId, title: titleOf(known.get(peerId))};
          }).filter((peer) => !!peer.peerId);

        // `chatlistInviteAlready` means the folder is joined; the sheet then
        // only offers the chats still missing from it.
        const isAlready = invite?._ === 'chatlistInviteAlready';
        const peers = toPeers(isAlready ? invite.missing_peers : invite?.peers);

        return {
          type: 'addList',
          slug: link.slug,
          title: invite?.title?.text ?? invite?.title ?? 'Folder',
          peers,
          alreadyPeerIds: isAlready ? toPeers(invite.already_peers).map((peer) => peer.peerId) : [],
          filterId: isAlready ? Number(invite.filter_id) : undefined
        };
      } catch(err: any) {
        return {type: 'error', message: linkError(err, 'This folder link is no longer valid')};
      }
    }

    case 'stickerSet':
      return {type: 'stickerSet', set: link.set, isEmoji: link.isEmoji};

    case 'share':
      return {type: 'share', url: link.url, text: link.text};

    case 'webApp':
      return {type: 'webApp', domain: link.domain, appname: link.appname, startapp: link.startapp};
  }
}

/**
 * `chatlists.chatlistInvite` hands back `Peer` constructors, which carry the raw
 * id under a per-type field name. Negate chats and channels to match the app's
 * peer id convention.
 */
function rawPeerId(peer: any): number {
  if(!peer) return 0;
  if(peer._ === 'peerUser') return Number(peer.user_id);
  if(peer._ === 'peerChat') return -Number(peer.chat_id);
  if(peer._ === 'peerChannel') return -Number(peer.channel_id);
  return 0;
}

function linkError(err: any, fallback: string): string {
  const type: string = err?.type || err?.message || '';
  switch(type) {
    case 'INVITE_HASH_EXPIRED':
    case 'INVITE_HASH_INVALID':
      return 'This invite link has expired';
    case 'INVITE_SLUG_EXPIRED':
      return 'This folder link has expired';
    case 'USERNAME_NOT_OCCUPIED':
    case 'USERNAME_INVALID':
      return 'No such username';
    case 'PHONE_NOT_OCCUPIED':
      return 'No Telegram account for that number';
    case 'CHANNELS_TOO_MUCH':
      return 'You have joined too many channels';
    case 'FILTERS_TOO_MUCH':
      return 'You have too many folders';
    default:
      return type || fallback;
  }
}

/** Accept a chat invite. Returns the peer id of the chat that was joined. */
export async function joinChatByInvite(invite: string): Promise<number> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appChatInvitesManager.importChatInvite(invite);

  // importChatInvite resolves either to a ChatId or, for paid subscriptions, to
  // a `chatInviteJoinWebView` we cannot complete here.
  if(result?._ === 'chatInviteJoinWebView') {
    throw new Error('This chat requires a paid subscription');
  }

  return -Number(result ?? 0);
}

/** Join a shared folder, importing the selected chats. */
export async function joinChatlistByInvite(slug: string, peerIds: number[]): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.filtersStorage.joinChatlistInvite(slug, peerIds);
}

/**
 * The link the app was opened with.
 *
 * `static/_redirects` serves `index.html` for every path, so a shared
 * `https://telegram.codebam.ca/durov` arrives here as a normal load with the
 * deep link sitting in `location`. tweb's own `#?tgaddr=` form is accepted too.
 * The URL is rewritten back to `/` so a refresh does not re-trigger the link.
 */
export function takeLaunchLink(): TelegramLink | null {
  if(typeof location === 'undefined') return null;

  let candidate = '';

  const hashMatch = location.hash.match(/[?&]tgaddr=([^&]+)/);
  if(hashMatch) {
    candidate = decodeURIComponent(hashMatch[1]);
  } else if(location.pathname && location.pathname !== '/') {
    candidate = 'https://t.me' + location.pathname + location.search;
  }

  if(!candidate) return null;

  const link = parseTelegramLink(candidate);

  // Clear it either way: a path we could not parse is not worth replaying, and
  // leaving it would make every reload retry the same dead link.
  history.replaceState(null, '', '/' + accountQuery());

  return link;
}

/** Account switching lives in the `?account=` param — keep it across the rewrite. */
function accountQuery(): string {
  const account = new URLSearchParams(location.search).get('account');
  return account ? `?account=${encodeURIComponent(account)}` : '';
}
