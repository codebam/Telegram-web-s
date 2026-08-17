/**
 * Group and channel administration.
 *
 * Everything an owner or admin can change about a chat: its title, description
 * and photo, whether it is public or private, the default member permissions,
 * who the admins are, who is banned, the invite links, the pending join
 * requests, the admin log, and the discussion group of a channel.
 *
 * The panel is a mirror of tweb's `sidebarRight/tabs/editChat.tsx` and friends,
 * but it only ever speaks to `appChatsManager`, `appProfileManager`,
 * `appChatInvitesManager` and `apiFileManager` — never to `invokeApi`.
 *
 * Two shapes recur and are worth naming once:
 *
 * - A *chat id* is the positive id MTProto uses; the app deals in *peer ids*,
 *   which are negative for chats and channels. `chatIdOf` is the only place
 *   that conversion happens.
 * - Member permissions travel as **banned** rights: a flag that is set is a
 *   thing the member may *not* do. The UI shows them as allow-switches, so
 *   every read and write inverts. `permissionsFrom` / `bannedRightsFrom` are
 *   the two sides of that inversion, and nothing else should flip a flag.
 */

import {bootTelegram} from './client';

/* ------------------------------------------------------------------ */
/* Chat identity and rights                                            */
/* ------------------------------------------------------------------ */

const chatIdOf = (peerId: number) => -peerId;

/** What the current user is allowed to change about a chat. */
export type AdminAccess = {
  /** Any of the below — worth showing the "Manage" entry point at all. */
  canManage: boolean;
  isCreator: boolean;
  changeInfo: boolean;
  changeType: boolean;
  changePermissions: boolean;
  banUsers: boolean;
  addAdmins: boolean;
  inviteLinks: boolean;
  deleteChat: boolean;
  viewAdminLog: boolean;
};

const NO_ACCESS: AdminAccess = {
  canManage: false,
  isCreator: false,
  changeInfo: false,
  changeType: false,
  changePermissions: false,
  banUsers: false,
  addAdmins: false,
  inviteLinks: false,
  deleteChat: false,
  viewAdminLog: false
};

function accessOf(chat: any): AdminAccess {
  if(!chat || (chat._ !== 'chat' && chat._ !== 'channel')) return NO_ACCESS;
  if(chat.pFlags?.left || chat.pFlags?.kicked) return NO_ACCESS;

  const creator = !!chat.pFlags?.creator;
  const rights = chat.admin_rights?.pFlags ?? {};
  const isChannel = chat._ === 'channel';
  const allow = (flag: string) => creator || !!rights[flag];

  const access: AdminAccess = {
    canManage: false,
    isCreator: creator,
    changeInfo: allow('change_info'),
    // Only the creator may make a chat public or hand out its @link.
    changeType: creator,
    changePermissions: allow('ban_users'),
    banUsers: allow('ban_users'),
    addAdmins: allow('add_admins'),
    inviteLinks: allow('invite_users'),
    // A basic group can always be deleted by its creator; a channel too, but
    // "leave" is the option everyone else gets and that lives elsewhere.
    deleteChat: creator,
    // The admin log is a channel/supergroup feature and needs some admin right.
    viewAdminLog: isChannel && (creator || Object.keys(rights).length > 0)
  };

  access.canManage = access.changeInfo || access.changeType || access.changePermissions ||
    access.banUsers || access.addAdmins || access.inviteLinks || access.deleteChat;

  return access;
}

/** Cheap enough to call on every profile open — the chat is already cached. */
export async function loadAdminAccess(peerId: number): Promise<AdminAccess> {
  if(peerId >= 0) return NO_ACCESS;
  const {managers} = await bootTelegram();
  const chat: any = await managers.appPeersManager.getPeer(peerId);
  return accessOf(chat);
}

/* ------------------------------------------------------------------ */
/* The chat as the admin panel sees it                                 */
/* ------------------------------------------------------------------ */

export type AdminChat = {
  peerId: number;
  chatId: number;
  title: string;
  about: string;
  username: string;
  /** A basic group — no @link, no permissions, no admin log until migrated. */
  isBasicGroup: boolean;
  isChannel: boolean;
  isMegagroup: boolean;
  isForum: boolean;
  signaturesEnabled: boolean;
  slowModeSeconds: number;
  membersCount: number;
  /** Discussion group linked to this channel, or the channel linked to this group. */
  linkedChatId: number;
  permissions: Permissions;
  access: AdminAccess;
};

export async function loadAdminChat(peerId: number): Promise<AdminChat> {
  const {managers} = await bootTelegram();
  const chatId = chatIdOf(peerId);
  const chat: any = await managers.appPeersManager.getPeer(peerId);

  const isChannelType = chat?._ === 'channel';
  const isMegagroup = isChannelType && !!chat.pFlags?.megagroup;

  const info: AdminChat = {
    peerId,
    chatId,
    title: chat?.title ?? '',
    about: '',
    username: chat?.username ?? chat?.usernames?.find((u: any) => u?.pFlags?.active)?.username ?? '',
    isBasicGroup: chat?._ === 'chat',
    isChannel: isChannelType && !!chat.pFlags?.broadcast,
    isMegagroup,
    isForum: !!chat?.pFlags?.forum,
    signaturesEnabled: !!chat?.pFlags?.signatures,
    slowModeSeconds: 0,
    membersCount: chat?.participants_count ?? 0,
    linkedChatId: 0,
    permissions: permissionsFrom(chat?.default_banned_rights),
    access: accessOf(chat)
  };

  // The full chat is where the description, the slow mode and the linked chat
  // live; it is permission-gated for some chats, and the rest still renders.
  try {
    const full: any = await managers.appProfileManager.getChatFull(chatId);
    info.about = full?.about ?? '';
    info.slowModeSeconds = Number(full?.slowmode_seconds ?? 0);
    info.linkedChatId = Number(full?.linked_chat_id ?? 0);
    info.membersCount = full?.participants_count ?? info.membersCount;
  } catch(err) {
  }

  return info;
}

/* ------------------------------------------------------------------ */
/* Title, description, photo                                           */
/* ------------------------------------------------------------------ */

export async function saveChatTitle(peerId: number, title: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.editTitle(chatIdOf(peerId), title.trim());
}

export async function saveChatAbout(peerId: number, about: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.editAbout(chatIdOf(peerId), about.trim());
}

/**
 * Upload a new chat photo. The file goes up through `apiFileManager` first —
 * `editPhoto` wants an already-uploaded `InputFile`, not a Blob.
 */
export async function saveChatPhoto(peerId: number, file: File): Promise<void> {
  const {managers} = await bootTelegram();
  const inputFile = await managers.apiFileManager.upload({file, fileName: file.name});
  await managers.appChatsManager.editPhoto(chatIdOf(peerId), inputFile);
}

/** No upload at all is how the API says "clear the photo". */
export async function removeChatPhoto(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.editPhoto(chatIdOf(peerId));
}

/* ------------------------------------------------------------------ */
/* Chat type — public @link vs private                                 */
/* ------------------------------------------------------------------ */

export async function checkAdminUsername(peerId: number, username: string): Promise<boolean> {
  const {managers} = await bootTelegram();
  return managers.appChatsManager.checkUsername(chatIdOf(peerId), normalize(username));
}

/**
 * Make the chat public under `username`. A basic group has no @link of its own
 * and is migrated to a supergroup first, which changes its peer id — hence the
 * return value.
 */
export async function makeChatPublic(peerId: number, username: string): Promise<number> {
  const {managers} = await bootTelegram();
  let chatId = chatIdOf(peerId);
  let newPeerId = peerId;

  const chat: any = await managers.appPeersManager.getPeer(peerId);
  if(chat?._ !== 'channel') {
    chatId = await managers.appChatsManager.migrateChat(chatId);
    newPeerId = -Number(chatId);
  }

  await managers.appChatsManager.updateUsername(chatId, normalize(username));
  return newPeerId;
}

/**
 * Drop the public @link. `makeChannelPrivate` also deactivates the spare
 * usernames a chat may have collected, which is what the official clients do —
 * leaving one active would keep the chat findable in search.
 */
export async function makeChatPrivate(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  const chat: any = await managers.appPeersManager.getPeer(peerId);
  // A basic group never had a link to drop, and `makeChannelPrivate` would ask
  // for a channel input it cannot build.
  if(chat?._ !== 'channel') return;
  await managers.appChatsManager.makeChannelPrivate(chatIdOf(peerId));
}

function normalize(username: string) {
  return username.trim().replace(/^@/, '');
}

/* ------------------------------------------------------------------ */
/* Toggles                                                             */
/* ------------------------------------------------------------------ */

/** Topics. Migrates a basic group on the way, so the peer id may change. */
export async function setForumEnabled(peerId: number, enabled: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.toggleForum(chatIdOf(peerId), enabled);
}

/**
 * Author signatures under channel posts. `profiles` links the signature to the
 * author's profile; Telegram only allows it while signatures are on at all.
 */
export async function setSignaturesEnabled(peerId: number, enabled: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.toggleSignatures(chatIdOf(peerId), enabled, false);
}

/** Delete the chat for everyone. Only the creator can. */
export async function deleteChat(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.delete(chatIdOf(peerId));
}

/** Leave, keeping the chat alive for everyone else. */
export async function leaveChat(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.leave(chatIdOf(peerId));
}

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

/**
 * The nine switches the official clients show, each one an *allow*. Several map
 * to a group of banned-rights flags: "media" alone covers seven of them, and
 * Telegram expects all of them set together — flipping only `send_media` leaves
 * members able to post photos.
 */
export type PermissionKey =
  'messages' | 'media' | 'stickers' | 'polls' | 'links' |
  'changeInfo' | 'pin' | 'invite' | 'topics';

export type Permissions = Record<PermissionKey, boolean>;

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  messages: 'Send messages',
  media: 'Send media',
  stickers: 'Send stickers & GIFs',
  polls: 'Send polls',
  links: 'Embed links',
  changeInfo: 'Change chat info',
  pin: 'Pin messages',
  invite: 'Add users',
  topics: 'Manage topics'
};

export const PERMISSION_ORDER: PermissionKey[] = [
  'messages', 'media', 'stickers', 'polls', 'links',
  'changeInfo', 'pin', 'invite', 'topics'
];

const PERMISSION_FLAGS: Record<PermissionKey, string[]> = {
  messages: ['send_plain'],
  media: [
    'send_media', 'send_photos', 'send_videos', 'send_audios',
    'send_docs', 'send_voices', 'send_roundvideos'
  ],
  stickers: ['send_stickers', 'send_gifs', 'send_games', 'send_inline'],
  polls: ['send_polls'],
  links: ['embed_links'],
  changeInfo: ['change_info'],
  pin: ['pin_messages'],
  invite: ['invite_users'],
  topics: ['manage_topics']
};

/** Banned rights -> allow-switches. A flag that is absent is a thing allowed. */
export function permissionsFrom(bannedRights: any): Permissions {
  const banned = bannedRights?.pFlags ?? {};
  const permissions = {} as Permissions;
  for(const key of PERMISSION_ORDER) {
    // A group is denied only when *every* flag behind the switch is denied;
    // a partial denial still reads as "off" to the user, which matches the
    // official clients and is what the next save will normalise.
    permissions[key] = !PERMISSION_FLAGS[key].every((flag) => banned[flag]);
  }
  return permissions;
}

/** Allow-switches -> banned rights, ready to hand back to the worker. */
export function bannedRightsFrom(permissions: Permissions, untilDate = 0): any {
  const pFlags: Record<string, true> = {};
  for(const key of PERMISSION_ORDER) {
    if(permissions[key]) continue;
    for(const flag of PERMISSION_FLAGS[key]) pFlags[flag] = true;
  }
  return {_: 'chatBannedRights', until_date: untilDate, pFlags};
}

export const ALL_ALLOWED: Permissions = PERMISSION_ORDER.reduce((acc, key) => {
  acc[key] = true;
  return acc;
}, {} as Permissions);

export async function saveDefaultPermissions(peerId: number, permissions: Permissions): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.editChatDefaultBannedRights(
    chatIdOf(peerId),
    bannedRightsFrom(permissions)
  );
}

/** Slow mode is expressed in seconds; 0 turns it off. */
export const SLOW_MODE_OPTIONS: {seconds: number; label: string}[] = [
  {seconds: 0, label: 'Off'},
  {seconds: 10, label: '10s'},
  {seconds: 30, label: '30s'},
  {seconds: 60, label: '1m'},
  {seconds: 300, label: '5m'},
  {seconds: 900, label: '15m'},
  {seconds: 3600, label: '1h'}
];

export async function setSlowMode(peerId: number, seconds: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.toggleSlowMode(chatIdOf(peerId), seconds);
}

/* ------------------------------------------------------------------ */
/* Admin rights                                                        */
/* ------------------------------------------------------------------ */

export type AdminRightKey =
  'change_info' | 'post_messages' | 'edit_messages' | 'delete_messages' |
  'ban_users' | 'invite_users' | 'pin_messages' | 'manage_topics' |
  'manage_call' | 'post_stories' | 'edit_stories' | 'delete_stories' |
  'anonymous' | 'add_admins';

export type AdminRights = Partial<Record<AdminRightKey, boolean>>;

const ADMIN_RIGHT_LABELS: Record<AdminRightKey, string> = {
  change_info: 'Change info',
  post_messages: 'Post messages',
  edit_messages: 'Edit messages of others',
  delete_messages: 'Delete messages',
  ban_users: 'Ban users',
  invite_users: 'Add users',
  pin_messages: 'Pin messages',
  manage_topics: 'Manage topics',
  manage_call: 'Manage video chats',
  post_stories: 'Post stories',
  edit_stories: 'Edit stories',
  delete_stories: 'Delete stories',
  anonymous: 'Remain anonymous',
  add_admins: 'Add new admins'
};

/**
 * Which rights a chat of this shape actually has. A broadcast channel can post
 * and edit posts but has nothing to ban or pin for members; a group is the
 * mirror image, and topics only exist in a forum.
 */
export function adminRightKeysFor(chat: Pick<AdminChat, 'isChannel' | 'isForum'>): AdminRightKey[] {
  if(chat.isChannel) {
    return [
      'change_info', 'post_messages', 'edit_messages', 'delete_messages',
      'invite_users', 'manage_call', 'post_stories', 'edit_stories',
      'delete_stories', 'add_admins'
    ];
  }

  const keys: AdminRightKey[] = [
    'change_info', 'delete_messages', 'ban_users', 'invite_users',
    'pin_messages', 'manage_call', 'anonymous', 'add_admins'
  ];
  if(chat.isForum) keys.splice(5, 0, 'manage_topics');
  return keys;
}

export const adminRightLabel = (key: AdminRightKey) => ADMIN_RIGHT_LABELS[key];

function adminRightsFrom(pFlags: any): AdminRights {
  const rights: AdminRights = {};
  for(const key of Object.keys(ADMIN_RIGHT_LABELS) as AdminRightKey[]) {
    if(pFlags?.[key]) rights[key] = true;
  }
  return rights;
}

/* ------------------------------------------------------------------ */
/* Participants                                                        */
/* ------------------------------------------------------------------ */

export type ParticipantKind = 'creator' | 'admin' | 'member' | 'banned' | 'restricted';

export type Participant = {
  peerId: number;
  title: string;
  username: string;
  kind: ParticipantKind;
  /** Custom title of an admin, e.g. "moderator". */
  rank: string;
  rights: AdminRights;
  /** Restrictions on a banned or restricted member, as allow-switches. */
  permissions: Permissions;
  /** 0 means forever. */
  bannedUntil: number;
  /** The admin who promoted or banned them, when the server says. */
  byPeerId: number;
  /** Whether the current user may edit this participant's rights. */
  canEdit: boolean;
};

type ParticipantFilter =
  {_: 'channelParticipantsRecent'} |
  {_: 'channelParticipantsAdmins'} |
  {_: 'channelParticipantsKicked'; q: string} |
  {_: 'channelParticipantsBanned'; q: string};

async function listParticipants(
  peerId: number,
  filter: ParticipantFilter,
  limit = 100
): Promise<Participant[]> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appProfileManager.getParticipants({
    id: chatIdOf(peerId),
    filter: filter as any,
    limit,
    offset: 0
  });

  const raw: any[] = result?.participants ?? [];
  return Promise.all(raw.map((participant) => toParticipant(participant, managers)));
}

async function toParticipant(participant: any, managers: any): Promise<Participant> {
  const peerId = participantPeerId(participant);
  const user: any = peerId ? await managers.appPeersManager.getPeer(peerId) : null;

  const name = user?._ === 'user' ?
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() :
    user?.title;

  const item: Participant = {
    peerId,
    title: name || user?.username || 'User',
    username: user?.username ?? '',
    kind: 'member',
    rank: participant?.rank ?? '',
    rights: {},
    permissions: ALL_ALLOWED,
    bannedUntil: 0,
    byPeerId: 0,
    canEdit: false
  };

  switch(participant?._) {
    case 'channelParticipantCreator':
      item.kind = 'creator';
      item.rights = adminRightsFrom(participant.admin_rights?.pFlags);
      break;

    case 'channelParticipantAdmin':
      item.kind = 'admin';
      item.rights = adminRightsFrom(participant.admin_rights?.pFlags);
      item.byPeerId = Number(participant.promoted_by ?? 0);
      // `can_edit` is the server telling us whether we outrank them.
      item.canEdit = !!participant.pFlags?.can_edit;
      break;

    case 'channelParticipantBanned': {
      // A ban and a restriction are the same object; `view_messages` is what
      // separates "thrown out" from "still here, but muted".
      const banned = participant.banned_rights;
      item.kind = banned?.pFlags?.view_messages ? 'banned' : 'restricted';
      item.permissions = permissionsFrom(banned);
      item.bannedUntil = Number(banned?.until_date ?? 0);
      item.byPeerId = Number(participant.kicked_by ?? 0);
      item.canEdit = true;
      break;
    }

    case 'chatParticipantCreator':
      item.kind = 'creator';
      break;

    case 'chatParticipantAdmin':
      item.kind = 'admin';
      item.canEdit = true;
      break;
  }

  return item;
}

function participantPeerId(participant: any): number {
  if(participant?.peer) {
    const peer = participant.peer;
    if(peer.user_id !== undefined) return Number(peer.user_id);
    if(peer.channel_id !== undefined) return -Number(peer.channel_id);
    if(peer.chat_id !== undefined) return -Number(peer.chat_id);
    return 0;
  }
  return Number(participant?.user_id ?? 0);
}

export const loadAdmins = (peerId: number) =>
  listParticipants(peerId, {_: 'channelParticipantsAdmins'});

export const loadMembers = (peerId: number, limit = 200) =>
  listParticipants(peerId, {_: 'channelParticipantsRecent'}, limit);

/** Users thrown out of the chat entirely. */
export const loadRemovedUsers = (peerId: number) =>
  listParticipants(peerId, {_: 'channelParticipantsKicked', q: ''});

/** Users still in the chat but with rights taken away. */
export const loadRestrictedUsers = (peerId: number) =>
  listParticipants(peerId, {_: 'channelParticipantsBanned', q: ''});

/* ------------------------------------------------------------------ */
/* Promoting, demoting, banning                                        */
/* ------------------------------------------------------------------ */

export async function promoteMember(
  peerId: number,
  userPeerId: number,
  rights: AdminRights,
  rank = ''
): Promise<void> {
  const {managers} = await bootTelegram();
  const pFlags: Record<string, true> = {};
  for(const [key, value] of Object.entries(rights)) {
    if(value) pFlags[key] = true;
  }

  await managers.appChatsManager.editAdmin(
    chatIdOf(peerId),
    userPeerId,
    {_: 'chatAdminRights', pFlags} as any,
    rank.trim().slice(0, 16)
  );
}

/** An admin with no rights at all is no longer an admin. */
export async function demoteAdmin(peerId: number, userPeerId: number): Promise<void> {
  await promoteMember(peerId, userPeerId, {}, '');
}

/**
 * Throw a member out. In a channel or supergroup that is a ban and they stay
 * out; a basic group has no ban list, so `kickFromChat` deletes the member
 * instead of migrating the whole chat just to record it.
 */
export async function banMember(peerId: number, userPeerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.kickFromChat(chatIdOf(peerId), userPeerId);
}

/** Let a banned user back in — clearing the rights is what unbans them. */
export async function unbanMember(peerId: number, userPeerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.clearChannelParticipantBannedRights(chatIdOf(peerId), userPeerId);
}

/**
 * Keep the member but take rights away until `untilDate` (a unix timestamp;
 * 0 is forever). `view_messages` is never set here — that would be a ban.
 */
export async function restrictMember(
  peerId: number,
  userPeerId: number,
  permissions: Permissions,
  untilDate = 0
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.editBanned(
    chatIdOf(peerId),
    userPeerId,
    bannedRightsFrom(permissions, untilDate)
  );
}

/** Restriction durations offered in the UI, as seconds from now (0 = forever). */
export const RESTRICTION_DURATIONS: {seconds: number; label: string}[] = [
  {seconds: 0, label: 'Forever'},
  {seconds: 86400, label: '1 day'},
  {seconds: 604800, label: '1 week'},
  {seconds: 2592000, label: '1 month'}
];

export const untilDateFrom = (seconds: number) =>
  seconds ? Math.floor(Date.now() / 1000) + seconds : 0;

/* ------------------------------------------------------------------ */
/* Invite links                                                        */
/* ------------------------------------------------------------------ */

export type InviteLink = {
  link: string;
  title: string;
  /** Unix seconds. */
  date: number;
  expireDate: number;
  usageLimit: number;
  usage: number;
  /** Pending join requests attached to this link. */
  requested: number;
  requestNeeded: boolean;
  revoked: boolean;
  /** The chat's main link — it cannot be edited or deleted, only revoked. */
  permanent: boolean;
  adminPeerId: number;
};

function toInviteLink(invite: any): InviteLink {
  return {
    link: invite?.link ?? '',
    title: invite?.title ?? '',
    date: Number(invite?.date ?? 0),
    expireDate: Number(invite?.expire_date ?? 0),
    usageLimit: Number(invite?.usage_limit ?? 0),
    usage: Number(invite?.usage ?? 0),
    requested: Number(invite?.requested ?? 0),
    requestNeeded: !!invite?.pFlags?.request_needed,
    revoked: !!invite?.pFlags?.revoked,
    permanent: !!invite?.pFlags?.permanent,
    adminPeerId: Number(invite?.admin_id ?? 0)
  };
}

export async function loadInviteLinks(peerId: number, revoked = false): Promise<InviteLink[]> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appChatInvitesManager.getExportedChatInvites({
    chatId: chatIdOf(peerId),
    revoked
  });
  return (result?.invites ?? []).map(toInviteLink);
}

export type InviteLinkOptions = {
  title?: string;
  /** Unix seconds; 0 for no expiry. */
  expireDate?: number;
  /** 0 for unlimited. */
  usageLimit?: number;
  requestNeeded?: boolean;
};

export async function createInviteLink(
  peerId: number,
  options: InviteLinkOptions = {}
): Promise<InviteLink> {
  const {managers} = await bootTelegram();
  const invite: any = await managers.appChatInvitesManager.exportChatInvite({
    chatId: chatIdOf(peerId),
    title: options.title || undefined,
    expireDate: options.expireDate || undefined,
    // A link that needs approval cannot also have a usage limit.
    usageLimit: options.requestNeeded ? undefined : (options.usageLimit || undefined),
    requestNeeded: options.requestNeeded || undefined
  });
  return toInviteLink(invite);
}

export async function editInviteLink(
  peerId: number,
  link: string,
  options: InviteLinkOptions = {}
): Promise<InviteLink> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appChatInvitesManager.editExportedChatInvite({
    chatId: chatIdOf(peerId),
    link,
    title: options.title ?? '',
    expireDate: options.expireDate ?? 0,
    usageLimit: options.requestNeeded ? undefined : (options.usageLimit ?? 0),
    requestNeeded: options.requestNeeded
  });
  return toInviteLink(result?.invite ?? result?.new_invite);
}

/** Revoking is an edit; the link stops working but stays on the revoked list. */
export async function revokeInviteLink(peerId: number, link: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatInvitesManager.editExportedChatInvite({
    chatId: chatIdOf(peerId),
    link,
    revoked: true
  });
}

export async function deleteInviteLink(peerId: number, link: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatInvitesManager.deleteExportedChatInvite(chatIdOf(peerId), link);
}

export async function deleteRevokedInviteLinks(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatInvitesManager.deleteRevokedExportedChatInvites(chatIdOf(peerId));
}

/* ------------------------------------------------------------------ */
/* Join requests                                                       */
/* ------------------------------------------------------------------ */

export type JoinRequest = {
  peerId: number;
  title: string;
  username: string;
  date: number;
  /** What the user wrote when asking to join, if anything. */
  about: string;
};

export async function loadJoinRequests(peerId: number): Promise<JoinRequest[]> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appChatInvitesManager.getChatInviteImporters({
    chatId: chatIdOf(peerId),
    requested: true,
    limit: 100
  });

  const importers: any[] = result?.importers ?? [];
  return Promise.all(importers.map(async(importer: any) => {
    const id = Number(importer?.user_id ?? 0);
    const user: any = await managers.appPeersManager.getPeer(id);
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
    return {
      peerId: id,
      title: name || user?.username || 'User',
      username: user?.username ?? '',
      date: Number(importer?.date ?? 0),
      about: importer?.about ?? ''
    };
  }));
}

export async function resolveJoinRequest(
  peerId: number,
  userPeerId: number,
  approved: boolean
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.hideChatJoinRequest(chatIdOf(peerId), userPeerId, approved);
}

/* ------------------------------------------------------------------ */
/* Recent actions (the admin log)                                      */
/* ------------------------------------------------------------------ */

export type RecentAction = {
  id: string;
  date: number;
  /** Who did it. */
  peerId: number;
  title: string;
  /** One line describing the action, already readable. */
  text: string;
  /** The message body or other payload the action carried, when there is one. */
  detail: string;
};

export async function loadRecentActions(peerId: number, limit = 50): Promise<RecentAction[]> {
  const {managers} = await bootTelegram();
  const events: any[] = await managers.appChatsManager.fetchAdminLogs({
    channelId: chatIdOf(peerId),
    limit
  }) as any;

  return Promise.all((events ?? []).map(async(event: any) => {
    const actorId = Number(event?.user_id ?? 0);
    const actor: any = actorId ? await managers.appPeersManager.getPeer(actorId) : null;
    const name = [actor?.first_name, actor?.last_name].filter(Boolean).join(' ').trim();
    const described = await describeAction(event?.action, managers);

    return {
      id: String(event?.id ?? ''),
      date: Number(event?.date ?? 0),
      peerId: actorId,
      title: name || actor?.title || actor?.username || 'Someone',
      text: described.text,
      detail: described.detail
    };
  }));
}

const ADMIN_LOG_TEXT: Record<string, string> = {
  channelAdminLogEventActionChangeTitle: 'changed the title',
  channelAdminLogEventActionChangeAbout: 'changed the description',
  channelAdminLogEventActionChangeUsername: 'changed the link',
  channelAdminLogEventActionChangeUsernames: 'changed the links',
  channelAdminLogEventActionChangePhoto: 'changed the photo',
  channelAdminLogEventActionToggleInvites: 'changed the invite setting',
  channelAdminLogEventActionToggleSignatures: 'changed post signatures',
  channelAdminLogEventActionUpdatePinned: 'pinned a message',
  channelAdminLogEventActionEditMessage: 'edited a message',
  channelAdminLogEventActionDeleteMessage: 'deleted a message',
  channelAdminLogEventActionParticipantJoin: 'joined',
  channelAdminLogEventActionParticipantLeave: 'left',
  channelAdminLogEventActionParticipantInvite: 'invited a user',
  channelAdminLogEventActionParticipantToggleBan: 'changed restrictions',
  channelAdminLogEventActionParticipantToggleAdmin: 'changed admin rights',
  channelAdminLogEventActionChangeStickerSet: 'changed the sticker set',
  channelAdminLogEventActionTogglePreHistoryHidden: 'changed history visibility',
  channelAdminLogEventActionDefaultBannedRights: 'changed default permissions',
  channelAdminLogEventActionStopPoll: 'stopped a poll',
  channelAdminLogEventActionChangeLinkedChat: 'changed the linked chat',
  channelAdminLogEventActionChangeLocation: 'changed the location',
  channelAdminLogEventActionToggleSlowMode: 'changed slow mode',
  channelAdminLogEventActionStartGroupCall: 'started a video chat',
  channelAdminLogEventActionDiscardGroupCall: 'ended the video chat',
  channelAdminLogEventActionParticipantMute: 'muted a participant',
  channelAdminLogEventActionParticipantUnmute: 'unmuted a participant',
  channelAdminLogEventActionToggleGroupCallSetting: 'changed video chat settings',
  channelAdminLogEventActionParticipantJoinByInvite: 'joined via an invite link',
  channelAdminLogEventActionExportedInviteDelete: 'deleted an invite link',
  channelAdminLogEventActionExportedInviteRevoke: 'revoked an invite link',
  channelAdminLogEventActionExportedInviteEdit: 'edited an invite link',
  channelAdminLogEventActionParticipantVolume: 'changed a participant volume',
  channelAdminLogEventActionChangeHistoryTTL: 'changed the auto-delete timer',
  channelAdminLogEventActionParticipantJoinByRequest: 'approved a join request',
  channelAdminLogEventActionToggleNoForwards: 'changed content protection',
  channelAdminLogEventActionSendMessage: 'posted a message',
  channelAdminLogEventActionChangeAvailableReactions: 'changed the reactions',
  channelAdminLogEventActionChangeUsernames2: 'changed the links',
  channelAdminLogEventActionToggleForum: 'changed topics',
  channelAdminLogEventActionCreateTopic: 'created a topic',
  channelAdminLogEventActionEditTopic: 'edited a topic',
  channelAdminLogEventActionDeleteTopic: 'deleted a topic',
  channelAdminLogEventActionPinTopic: 'pinned a topic',
  channelAdminLogEventActionToggleAntiSpam: 'changed the anti-spam setting',
  channelAdminLogEventActionChangePeerColor: 'changed the channel colour',
  channelAdminLogEventActionChangeProfilePeerColor: 'changed the profile colour',
  channelAdminLogEventActionChangeWallpaper: 'changed the wallpaper',
  channelAdminLogEventActionChangeEmojiStatus: 'changed the status',
  channelAdminLogEventActionChangeEmojiStickerSet: 'changed the emoji pack',
  channelAdminLogEventActionToggleSignatureProfiles: 'changed signature profiles',
  channelAdminLogEventActionParticipantSubExtend: 'extended a subscription',
  channelAdminLogEventActionToggleAutotranslation: 'changed auto-translation',
  channelAdminLogEventActionChangeParticipantRank: 'changed a custom title'
};

/**
 * A one-line description plus, where the event carried one, the text that
 * changed. Anything unmapped still renders — the raw constructor name minus its
 * prefix reads well enough and is better than an empty row.
 */
async function describeAction(action: any, managers: any): Promise<{text: string; detail: string}> {
  const kind: string = action?._ ?? '';
  const text = ADMIN_LOG_TEXT[kind] || humanizeAction(kind);

  switch(kind) {
    case 'channelAdminLogEventActionChangeTitle':
    case 'channelAdminLogEventActionChangeAbout':
      return {text, detail: action.new_value ? `“${action.new_value}”` : ''};

    case 'channelAdminLogEventActionChangeUsername':
      return {text, detail: action.new_value ? `@${action.new_value}` : 'removed'};

    case 'channelAdminLogEventActionToggleSlowMode':
      return {text, detail: action.new_value ? `${action.new_value}s` : 'off'};

    case 'channelAdminLogEventActionDeleteMessage':
    case 'channelAdminLogEventActionSendMessage':
      return {text, detail: messageText(action.message)};

    case 'channelAdminLogEventActionEditMessage':
      return {text, detail: messageText(action.new_message)};

    case 'channelAdminLogEventActionUpdatePinned':
      return {text, detail: messageText(action.message)};

    case 'channelAdminLogEventActionParticipantToggleBan':
    case 'channelAdminLogEventActionParticipantToggleAdmin': {
      const target = participantPeerId(action.new_participant);
      const peer: any = target ? await managers.appPeersManager.getPeer(target) : null;
      const name = [peer?.first_name, peer?.last_name].filter(Boolean).join(' ').trim();
      return {text, detail: name || peer?.title || ''};
    }

    case 'channelAdminLogEventActionExportedInviteDelete':
    case 'channelAdminLogEventActionExportedInviteRevoke':
      return {text, detail: action.invite?.link ?? ''};

    case 'channelAdminLogEventActionExportedInviteEdit':
      return {text, detail: action.new_invite?.link ?? ''};

    case 'channelAdminLogEventActionToggleForum':
    case 'channelAdminLogEventActionToggleSignatures':
    case 'channelAdminLogEventActionToggleAntiSpam':
    case 'channelAdminLogEventActionToggleNoForwards':
    case 'channelAdminLogEventActionTogglePreHistoryHidden':
      return {text, detail: action.new_value ? 'on' : 'off'};

    default:
      return {text, detail: ''};
  }
}

function messageText(message: any): string {
  const text: string = message?.message ?? '';
  if(text) return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  return message?.media ? 'media' : '';
}

/** `channelAdminLogEventActionChangeFoo` -> `change foo`. */
function humanizeAction(kind: string): string {
  const name = kind.replace('channelAdminLogEventAction', '');
  if(!name) return 'did something';
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Discussion group                                                    */
/* ------------------------------------------------------------------ */

export type DiscussionCandidate = {peerId: number; title: string; username: string};

/**
 * The groups this channel could be linked to. The server only returns groups
 * where the user can actually make the link, so the list needs no filtering.
 */
export async function loadDiscussionCandidates(): Promise<DiscussionCandidate[]> {
  const {managers} = await bootTelegram();
  const chats: any[] = await managers.appChatsManager.getGroupsForDiscussion() as any;
  return (chats ?? [])
  .filter((chat: any) => chat?._ === 'chat' || chat?._ === 'channel')
  .map((chat: any) => ({
    peerId: -Number(chat.id),
    title: chat.title ?? '',
    username: chat.username ?? ''
  }));
}

/**
 * The already-linked group, which `getGroupsForDiscussion` deliberately leaves
 * out of its list — it only offers groups that are still free.
 */
export async function loadLinkedChat(peerId: number): Promise<DiscussionCandidate | null> {
  if(!peerId) return null;
  const {managers} = await bootTelegram();
  const chat: any = await managers.appPeersManager.getPeer(peerId);
  if(!chat) return null;
  return {peerId, title: chat.title ?? '', username: chat.username ?? ''};
}

/**
 * Link a discussion group to a channel. Linking a basic group migrates it, and
 * `setDiscussionGroup` also unhides the group's history — a linked group must
 * be readable by everyone who can read the channel.
 */
export async function setDiscussionGroup(
  channelPeerId: number,
  groupPeerId: number
): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.setDiscussionGroup(
    chatIdOf(channelPeerId),
    chatIdOf(groupPeerId)
  );
}

/** Unlinking is the same call with no group. */
export async function unlinkDiscussionGroup(channelPeerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appChatsManager.setDiscussionGroup(chatIdOf(channelPeerId), 0 as any);
}

/* ------------------------------------------------------------------ */
/* Formatting shared by the admin components                           */
/* ------------------------------------------------------------------ */

export function formatDate(unixSeconds: number): string {
  if(!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** "expires in 3 days" / "expired" — invite links and restrictions both use it. */
export function formatExpiry(unixSeconds: number): string {
  if(!unixSeconds) return '';
  const seconds = unixSeconds - Math.floor(Date.now() / 1000);
  if(seconds <= 0) return 'expired';

  const days = Math.floor(seconds / 86400);
  if(days >= 1) return `expires in ${days}d`;
  const hours = Math.floor(seconds / 3600);
  if(hours >= 1) return `expires in ${hours}h`;
  return `expires in ${Math.max(1, Math.floor(seconds / 60))}m`;
}
