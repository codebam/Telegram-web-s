import {bootTelegram} from './client';
import {getMessage, getPeerBrief, loadFolders, updateFolder, type MessageItem} from './chats';

/**
 * Everything the profile pane needs, on the same terms as `chats.ts`: raw
 * MTProto objects stay in this module's caches and only plain, structured-
 * cloneable values cross into Svelte state. A `$state` proxy cannot be posted
 * back to the worker, so a raw peer that leaked into a rune would silently
 * break every later request that used it.
 */

const rawPeers = new Map<number, any>();

async function getPeer(peerId: number): Promise<any> {
  const cached = rawPeers.get(peerId);
  if(cached) return cached;

  const {managers} = await bootTelegram();
  const peer = await managers.appPeersManager.getPeer(peerId);
  rawPeers.set(peerId, peer);
  return peer;
}

/** Drops the cached peer so the next read reflects a just-changed profile. */
export function forgetPeer(peerId: number) {
  rawPeers.delete(peerId);
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export type ProfileInfo = {
  peerId: number;
  title: string;
  firstName: string;
  lastName: string;
  /** Primary public @username, '' when the peer is private. */
  username: string;
  /** Every active username, primary first — collectible usernames add more. */
  usernames: string[];
  /** Public t.me link, '' when there is no username to build one from. */
  link: string;
  about: string;
  phone: string;
  isUser: boolean;
  isBot: boolean;
  isChannel: boolean;
  isGroup: boolean;
  isSelf: boolean;
  isContact: boolean;
  isForum: boolean;
  membersCount: number;
  /** Members currently online, 0 when unknown or not a group. */
  onlineCount: number;
  canSetUsername: boolean;
  verified: boolean;
  scam: boolean;
  fake: boolean;
  premium: boolean;
  /**
   * The peer's own name colour as a hex string — Telegram lets a peer pick one
   * and falls back to a hash of the id, which is what titles are tinted with.
   */
  nameColor: string;
  blocked: boolean;
  muted: boolean;
  /** Groups shared with this user, from userFull — drives the tab's presence. */
  commonChatsCount: number;
};

function activeUsernames(peer: any): string[] {
  const list: string[] = (peer?.usernames ?? [])
  .filter((username: any) => username?.pFlags?.active && username.username)
  .map((username: any) => username.username);

  if(peer?.username && !list.includes(peer.username)) list.unshift(peer.username);
  return list;
}

export async function loadProfile(peerId: number): Promise<ProfileInfo> {
  const {managers} = await bootTelegram();
  const peer = await getPeer(peerId);
  const brief = await getPeerBrief(peerId);

  const isUser = peer?._ === 'user';
  const isChannel = peer?._ === 'channel' && !!peer.pFlags?.broadcast;
  const isGroup = !isUser && !isChannel;
  const usernames = activeUsernames(peer);

  const {getPeerColorsByPeer} = await import('@appManagers/utils/peers/getPeerColorById');

  const info: ProfileInfo = {
    peerId,
    title: brief.title,
    firstName: peer?.first_name ?? '',
    lastName: peer?.last_name ?? '',
    username: usernames[0] ?? '',
    usernames,
    link: usernames[0] ? `https://t.me/${usernames[0]}` : '',
    about: '',
    phone: peer?.phone ? `+${peer.phone}` : '',
    isUser,
    isBot: isUser && !!peer.pFlags?.bot,
    isChannel,
    isGroup,
    isSelf: brief.isSelf,
    isContact: isUser && !!peer.pFlags?.contact,
    isForum: brief.isForum,
    membersCount: peer?.participants_count ?? 0,
    onlineCount: 0,
    canSetUsername: !isUser && (
      !!peer?.pFlags?.creator || !!peer?.admin_rights?.pFlags?.change_info
    ),
    verified: !!peer?.pFlags?.verified,
    scam: !!peer?.pFlags?.scam,
    fake: !!peer?.pFlags?.fake,
    premium: !!peer?.pFlags?.premium,
    nameColor: getPeerColorsByPeer(peer)?.[0] ?? '',
    blocked: false,
    muted: false,
    commonChatsCount: 0
  };

  try {
    if(isUser) {
      const full: any = await managers.appProfileManager.getProfile(peer.id);
      info.about = full?.about ?? '';
      info.blocked = !!full?.pFlags?.blocked;
      info.commonChatsCount = full?.common_chats_count ?? 0;
    } else {
      const full: any = await managers.appProfileManager.getChatFull(peer.id);
      info.about = full?.about ?? '';
      info.membersCount = full?.participants_count ??
        full?.participants?.participants?.length ??
        info.membersCount;

      if(isGroup) {
        try {
          info.onlineCount = Number(await managers.appProfileManager.getOnlines(peer.id)) || 0;
        } catch(err) {
          // Online counts are permission-gated on some groups.
        }
      }
    }
  } catch(err) {
    // A full-peer fetch can fail on a restricted peer; the header still renders.
  }

  try {
    info.muted = await managers.appNotificationsManager.getPeerMessagesMuted(peerId);
  } catch(err) {
    // Never let the notification state block the profile.
  }

  return info;
}

/* ------------------------------------------------------------------ */
/* Shared media                                                        */
/* ------------------------------------------------------------------ */

export type SharedTab = 'media' | 'files' | 'links' | 'music' | 'voice' | 'gifs';

const SHARED_FILTERS: Record<SharedTab, string> = {
  media: 'inputMessagesFilterPhotoVideo',
  files: 'inputMessagesFilterDocument',
  links: 'inputMessagesFilterUrl',
  music: 'inputMessagesFilterMusic',
  voice: 'inputMessagesFilterRoundVoice',
  gifs: 'inputMessagesFilterGif'
};

export type SharedPage = {
  items: MessageItem[];
  /** Pass back as `offsetId` for the next page; 0 when there is nothing left. */
  nextOffsetId: number;
  isEnd: boolean;
  /** Server-side total for the filter, 0 when it does not report one. */
  total: number;
};

/**
 * One page of a shared-media tab.
 *
 * The search itself is a filtered `getHistory` — the same manager path the
 * chat history uses, so results land in the message storage and `loadMediaUrl`
 * can resolve a thumbnail for them afterwards. Resolving each mid through
 * `getMessage` is what puts them there.
 */
export async function loadSharedMedia(
  peerId: number,
  tab: SharedTab,
  options: {offsetId?: number; limit?: number} = {}
): Promise<SharedPage> {
  const {managers} = await bootTelegram();
  const limit = options.limit ?? 40;

  const result: any = await managers.appMessagesManager.getHistory({
    peerId,
    inputFilter: {_: SHARED_FILTERS[tab] as any},
    offsetId: options.offsetId,
    limit
  });

  const mids: number[] = result?.history ?? [];
  const items = (await Promise.all(mids.map((mid) => getMessage(peerId, mid))))
  .filter(Boolean) as MessageItem[];

  return {
    items,
    nextOffsetId: mids.length ? mids[mids.length - 1] : 0,
    isEnd: mids.length < limit,
    total: result?.count ?? 0
  };
}

/** Every link a message carries — its entities plus any webpage preview. */
export function linksOf(item: MessageItem): string[] {
  const links = new Set<string>();
  if(item.webpage?.url) links.add(item.webpage.url);

  for(const part of item.parts) {
    if(part.url) links.add(part.url);
  }

  return [...links];
}

/* ------------------------------------------------------------------ */
/* Members, common groups, similar channels                            */
/* ------------------------------------------------------------------ */

export type MemberRole = '' | 'owner' | 'admin';

export type ProfileMember = {
  peerId: number;
  title: string;
  role: MemberRole;
};

function participantPeerId(participant: any): number {
  const userId = participant?.user_id;
  if(userId !== undefined) return Number(userId);

  const peer = participant?.peer;
  if(peer?.user_id !== undefined) return Number(peer.user_id);
  if(peer?.channel_id !== undefined) return -Number(peer.channel_id);
  if(peer?.chat_id !== undefined) return -Number(peer.chat_id);
  return 0;
}

function participantRole(participant: any): MemberRole {
  switch(participant?._) {
    case 'channelParticipantCreator':
    case 'chatParticipantCreator':
      return 'owner';
    case 'channelParticipantAdmin':
    case 'chatParticipantAdmin':
      return 'admin';
    default:
      return '';
  }
}

export async function loadMembers(
  peerId: number,
  options: {offset?: number; limit?: number} = {}
): Promise<ProfileMember[]> {
  const {managers} = await bootTelegram();
  const peer = await getPeer(peerId);
  if(peer?._ === 'user') return [];

  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;

  let participants: any[] = [];
  try {
    if(peer?._ === 'channel') {
      const result: any = await managers.appProfileManager.getParticipants({
        id: peer.id,
        filter: {_: 'channelParticipantsRecent'},
        limit,
        offset
      });
      participants = result?.participants ?? [];
    } else {
      // A basic group carries its whole member list inside the full chat, so it
      // is paged locally rather than by another request.
      const full: any = await managers.appProfileManager.getChatFull(peer.id);
      participants = (full?.participants?.participants ?? []).slice(offset, offset + limit);
    }
  } catch(err) {
    // Member lists are permission-gated; an empty tab is the honest answer.
    return [];
  }

  const members = await Promise.all(
    participants.map(async(participant: any): Promise<ProfileMember> => {
      const memberPeerId = participantPeerId(participant);
      return {
        peerId: memberPeerId,
        title: memberPeerId ? (await getPeerBrief(memberPeerId)).title : 'Unknown',
        role: participantRole(participant)
      };
    })
  );

  return members.filter((member) => member.peerId);
}

export type PeerChip = {
  peerId: number;
  title: string;
  /** Subscriber/member count as text, '' when the server does not send one. */
  subtitle: string;
};

async function chipsFromChats(chats: any[]): Promise<PeerChip[]> {
  return Promise.all(
    (chats ?? [])
    .filter((chat: any) => chat?.id)
    .map(async(chat: any): Promise<PeerChip> => {
      const chatPeerId = -Number(chat.id);
      const count = chat.participants_count ?? 0;
      return {
        peerId: chatPeerId,
        title: chat.title || (await getPeerBrief(chatPeerId)).title,
        subtitle: count ?
          `${count.toLocaleString()} ${chat.pFlags?.broadcast ? 'subscribers' : 'members'}` :
          ''
      };
    })
  );
}

/** Groups this user and the current account are both in. */
export async function loadCommonGroups(peerId: number, limit = 40): Promise<PeerChip[]> {
  const {managers} = await bootTelegram();
  const peer = await getPeer(peerId);
  if(peer?._ !== 'user') return [];

  try {
    const result: any = await managers.appUsersManager.getCommonChats(peer.id, limit);
    return chipsFromChats(result?.chats ?? []);
  } catch(err) {
    return [];
  }
}

/** Channels Telegram recommends alongside this one. */
export async function loadSimilarChannels(peerId: number): Promise<PeerChip[]> {
  const {managers} = await bootTelegram();
  const peer = await getPeer(peerId);
  if(peer?._ !== 'channel' || !peer.pFlags?.broadcast) return [];

  try {
    const result: any = await managers.appChatsManager.getChannelRecommendations(peer.id);
    return chipsFromChats(result?.chats ?? []);
  } catch(err) {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Peer actions                                                        */
/* ------------------------------------------------------------------ */

export async function setBlocked(peerId: number, blocked: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appUsersManager.toggleBlock(peerId, blocked);
  rawPeers.delete(peerId);
}

export async function addContact(
  peerId: number,
  firstName: string,
  lastName: string,
  phone = ''
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appUsersManager.addContact(peerId, firstName.trim(), lastName.trim(), phone);
  rawPeers.delete(peerId);
}

export async function deleteContact(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appUsersManager.deleteContacts([peerId]);
  rawPeers.delete(peerId);
}

/** Sends this peer as a contact card into another chat. */
export async function shareContact(peerId: number, toPeerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.sendContact({peerId: toPeerId, contactPeerId: peerId});
}

export async function setMuted(peerId: number, muted: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.togglePeerMute({peerId, mute: muted});
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

/**
 * `messages.report` is a small state machine: an empty option asks the server
 * what the choices are, each chosen option either narrows them further or asks
 * for a comment, and the last step reports. The option payloads are opaque
 * byte strings, so they are kept here by index and the UI only ever sees text.
 */
export type ReportStep = {
  kind: 'choose' | 'comment' | 'done';
  title: string;
  options: {id: number; text: string}[];
  /** Whether a comment step will accept an empty comment. */
  commentOptional: boolean;
};

const reportOptions = new Map<number, Uint8Array>();
let reportOptionId = 0;

function toStep(result: any): ReportStep {
  if(result?._ === 'reportResultChooseOption') {
    return {
      kind: 'choose',
      title: result.title ?? 'Report',
      options: (result.options ?? []).map((option: any) => {
        const id = ++reportOptionId;
        reportOptions.set(id, option.option);
        return {id, text: option.text ?? ''};
      }),
      commentOptional: false
    };
  }

  if(result?._ === 'reportResultAddComment') {
    const id = ++reportOptionId;
    reportOptions.set(id, result.option);
    return {
      kind: 'comment',
      title: 'Add a comment',
      options: [{id, text: ''}],
      commentOptional: !!result.pFlags?.optional
    };
  }

  return {kind: 'done', title: 'Report sent', options: [], commentOptional: false};
}

/** Opens the report flow for the peer itself (no messages selected). */
export async function startReport(peerId: number): Promise<ReportStep> {
  const {managers} = await bootTelegram();
  const result = await managers.appMessagesManager.reportMessages(peerId, [], new Uint8Array());
  return toStep(result);
}

export async function submitReport(
  peerId: number,
  optionId: number,
  comment = ''
): Promise<ReportStep> {
  const {managers} = await bootTelegram();
  const option = reportOptions.get(optionId);
  if(!option) throw new Error('That report option expired');

  const result = await managers.appMessagesManager.reportMessages(peerId, [], option, comment || undefined);
  return toStep(result);
}

/* ------------------------------------------------------------------ */
/* Folders                                                             */
/* ------------------------------------------------------------------ */

export type ProfileFolder = {id: number; title: string; contains: boolean};

/** Editable folders, flagged with whether this peer is already in them. */
export async function loadFoldersForPeer(peerId: number): Promise<ProfileFolder[]> {
  const folders = await loadFolders();
  return folders
  .filter((folder) => folder.editable)
  .map((folder) => ({
    id: folder.id,
    title: folder.title,
    contains: folder.includePeerIds.includes(peerId)
  }));
}

export async function addPeerToFolder(peerId: number, folderId: number): Promise<void> {
  const folders = await loadFolders();
  const folder = folders.find((candidate) => candidate.id === folderId);
  if(!folder) throw new Error('Folder not found');
  if(folder.includePeerIds.includes(peerId)) return;

  await updateFolder(folderId, folder.title, [...folder.includePeerIds, peerId]);
}

export async function removePeerFromFolder(peerId: number, folderId: number): Promise<void> {
  const folders = await loadFolders();
  const folder = folders.find((candidate) => candidate.id === folderId);
  if(!folder) throw new Error('Folder not found');

  await updateFolder(
    folderId,
    folder.title,
    folder.includePeerIds.filter((id) => id !== peerId)
  );
}

/* ------------------------------------------------------------------ */
/* QR code                                                             */
/* ------------------------------------------------------------------ */

/**
 * Paints a QR for a t.me link into `host`.
 *
 * tweb's own `paintQrCode` bakes in the Telegram logo by fetching it from
 * `assets/img/`, which this app does not ship, so the styling library is
 * driven directly here. Returns a teardown that empties the host.
 */
export async function paintPeerQr(
  host: HTMLElement,
  link: string,
  options: {size?: number; foreground?: string; background?: string} = {}
): Promise<() => void> {
  const {default: QRCodeStyling} = await import('qr-code-styling' as any) as any;
  const size = options.size ?? 200;

  host.replaceChildren();

  const qr = new QRCodeStyling({
    width: size,
    height: size,
    type: 'canvas',
    data: link,
    margin: 8,
    qrOptions: {errorCorrectionLevel: 'M'},
    dotsOptions: {type: 'rounded', color: options.foreground ?? '#000000'},
    cornersSquareOptions: {type: 'extra-rounded', color: options.foreground ?? '#000000'},
    backgroundOptions: {color: options.background ?? '#ffffff'}
  });

  qr.append(host);
  return () => host.replaceChildren();
}

/** Copies text, reporting whether the clipboard actually accepted it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    const {copyTextToClipboard} = await import('@helpers/clipboard');
    copyTextToClipboard(text);
    return true;
  } catch(err) {
    return false;
  }
}
