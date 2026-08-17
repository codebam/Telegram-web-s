import {bootTelegram} from './client';
import {getPeerBrief} from './chats';

/**
 * Privacy & Security: per-key privacy rules, blocked peers, two-step
 * verification, active sessions / connected websites and the account-wide
 * default message TTL.
 *
 * Same rule as chats.ts: only plain, structured-cloneable values leave this
 * module — nothing that reaches a Svelte `$state` may go back to the worker.
 */

/* ------------------------------------------------------------------ */
/* Privacy rules                                                       */
/* ------------------------------------------------------------------ */

export type PrivacyValue = 'everybody' | 'contacts' | 'nobody';

export type PrivacyKeyId =
  | 'lastSeen'
  | 'profilePhoto'
  | 'bio'
  | 'birthday'
  | 'phoneNumber'
  | 'calls'
  | 'forwards'
  | 'chatInvite'
  | 'voiceMessages'
  | 'gifts';

/** Maps our ids onto the MTProto `inputPrivacyKey*` constructors. */
const INPUT_KEY: Record<PrivacyKeyId, string> = {
  lastSeen: 'inputPrivacyKeyStatusTimestamp',
  profilePhoto: 'inputPrivacyKeyProfilePhoto',
  bio: 'inputPrivacyKeyAbout',
  birthday: 'inputPrivacyKeyBirthday',
  phoneNumber: 'inputPrivacyKeyPhoneNumber',
  calls: 'inputPrivacyKeyPhoneCall',
  forwards: 'inputPrivacyKeyForwards',
  chatInvite: 'inputPrivacyKeyChatInvite',
  voiceMessages: 'inputPrivacyKeyVoiceMessages',
  gifts: 'inputPrivacyKeyStarGiftsAutoSave'
};

export type PrivacyKeyMeta = {
  key: PrivacyKeyId;
  title: string;
  /** Shown under the radio group — mirrors tweb's section captions. */
  hint: string;
  /** Premium-only on the server; saving without Premium fails. */
  premiumOnly?: boolean;
};

export const PRIVACY_KEYS: PrivacyKeyMeta[] = [
  {key: 'lastSeen', title: 'Last seen & online', hint: 'People you share your last seen with will see yours.'},
  {key: 'profilePhoto', title: 'Profile photo', hint: 'Who can see your profile photo.'},
  {key: 'bio', title: 'Bio', hint: 'Who can see the About text on your profile.'},
  {key: 'birthday', title: 'Date of birth', hint: 'Who can see your birthday.'},
  {key: 'phoneNumber', title: 'Phone number', hint: 'Who can see your phone number.'},
  {key: 'calls', title: 'Calls', hint: 'Who can call you.'},
  {key: 'forwards', title: 'Forwarded messages', hint: 'Who can link to your account when forwarding your messages.'},
  {key: 'chatInvite', title: 'Groups & channels', hint: 'Who can add you to groups and channels.'},
  {key: 'voiceMessages', title: 'Voice messages', hint: 'Who can send you voice and video messages.', premiumOnly: true},
  {key: 'gifts', title: 'Gifts', hint: 'Who can send you gifts.'}
];

export type PrivacySetting = {
  key: PrivacyKeyId;
  value: PrivacyValue;
  /** Peer ids always allowed, whatever the main rule says. */
  allow: number[];
  /** Peer ids always denied. */
  disallow: number[];
};

function chatIdOf(peerId: number): number {
  return Math.abs(peerId);
}

function readRules(key: PrivacyKeyId, rules: any[]): PrivacySetting {
  let value: PrivacyValue;
  const allow: number[] = [];
  const disallow: number[] = [];

  for(const rule of rules ?? []) {
    switch(rule._) {
      case 'privacyValueAllowAll':
        value = 'everybody';
        break;
      case 'privacyValueAllowContacts':
        value = 'contacts';
        break;
      case 'privacyValueDisallowAll':
        value = 'nobody';
        break;
      case 'privacyValueAllowUsers':
        allow.push(...(rule.users ?? []).map(Number));
        break;
      case 'privacyValueAllowChatParticipants':
        allow.push(...(rule.chats ?? []).map((id: any) => -Number(id)));
        break;
      case 'privacyValueDisallowUsers':
        disallow.push(...(rule.users ?? []).map(Number));
        break;
      case 'privacyValueDisallowChatParticipants':
        disallow.push(...(rule.chats ?? []).map((id: any) => -Number(id)));
        break;
    }
  }

  return {key, value: value ?? 'contacts', allow, disallow};
}

export async function loadPrivacy(key: PrivacyKeyId): Promise<PrivacySetting> {
  const {managers} = await bootTelegram();
  const rules: any = await managers.appPrivacyManager.getPrivacy(INPUT_KEY[key] as any);
  return readRules(key, rules);
}

export async function loadAllPrivacy(): Promise<PrivacySetting[]> {
  return Promise.all(PRIVACY_KEYS.map(({key}) => loadPrivacy(key)));
}

/**
 * Turns a setting back into `inputPrivacyRule`s. The main rule comes first,
 * then the exception lists — the order tweb's own privacy section uses.
 */
export async function savePrivacy(setting: PrivacySetting): Promise<void> {
  const {managers} = await bootTelegram();
  const rules: any[] = [];

  if(setting.value === 'everybody') rules.push({_: 'inputPrivacyValueAllowAll'});
  else if(setting.value === 'contacts') rules.push({_: 'inputPrivacyValueAllowContacts'});
  else rules.push({_: 'inputPrivacyValueDisallowAll'});

  const lists: Array<[number[], string, string]> = [
    [setting.allow ?? [], 'inputPrivacyValueAllowChatParticipants', 'inputPrivacyValueAllowUsers'],
    [setting.disallow ?? [], 'inputPrivacyValueDisallowChatParticipants', 'inputPrivacyValueDisallowUsers']
  ];

  for(const [peerIds, chatKey, usersKey] of lists) {
    const chats = peerIds.filter((peerId) => peerId < 0).map(chatIdOf);
    const users = peerIds.filter((peerId) => peerId > 0).map(Number);

    if(chats.length) rules.push({_: chatKey, chats});
    if(users.length) {
      rules.push({
        _: usersKey,
        users: await Promise.all(users.map((userId) => managers.appUsersManager.getUserInput(userId)))
      });
    }
  }

  await managers.appPrivacyManager.setPrivacy(INPUT_KEY[setting.key] as any, rules);
}

/* ------------------------------------------------------------------ */
/* Global privacy — messages from non-contacts, read receipts          */
/* ------------------------------------------------------------------ */

export type GlobalPrivacy = {
  /** Only contacts and Premium users may start a chat with you. */
  restrictNonContacts: boolean;
  /** Hide read time in private chats (also hides theirs from you). */
  hideReadMarks: boolean;
  /** New chats from non-contacts land in the archive, muted. */
  archiveNonContacts: boolean;
};

export async function loadGlobalPrivacy(): Promise<GlobalPrivacy> {
  const {managers} = await bootTelegram();
  const settings: any = await managers.appPrivacyManager.getGlobalPrivacySettings();
  const flags = settings?.pFlags ?? {};

  return {
    restrictNonContacts: !!flags.new_noncontact_peers_require_premium,
    hideReadMarks: !!flags.hide_read_marks,
    archiveNonContacts: !!flags.archive_and_mute_new_noncontact_peers
  };
}

export async function saveGlobalPrivacy(next: GlobalPrivacy): Promise<void> {
  const {managers} = await bootTelegram();
  const current: any = await managers.appPrivacyManager.getGlobalPrivacySettings();
  // structuredClone keeps the fields we do not touch (paid-message stars, gift
  // settings) while dropping any proxy identity the caller may have introduced.
  const settings: any = structuredClone(current) ?? {_: 'globalPrivacySettings', pFlags: {}};
  settings.pFlags ??= {};

  const setFlag = (flag: string, value: boolean) => {
    if(value) settings.pFlags[flag] = true;
    else delete settings.pFlags[flag];
  };

  setFlag('new_noncontact_peers_require_premium', next.restrictNonContacts);
  setFlag('hide_read_marks', next.hideReadMarks);
  setFlag('archive_and_mute_new_noncontact_peers', next.archiveNonContacts);

  await managers.appPrivacyManager.setGlobalPrivacySettings(settings);
}

/* ------------------------------------------------------------------ */
/* Blocked peers                                                       */
/* ------------------------------------------------------------------ */

export type BlockedPeer = {
  peerId: number;
  title: string;
  username: string;
};

export type BlockedPage = {
  /** Total number of blocked peers on the server, not just this page. */
  count: number;
  peers: BlockedPeer[];
};

export async function loadBlocked(offset = 0, limit = 30): Promise<BlockedPage> {
  const {managers} = await bootTelegram();
  const {count, peerIds} = await managers.appUsersManager.getBlocked(offset, limit);

  const peers = await Promise.all(
    (peerIds ?? []).map(async(peerId: any) => {
      const brief = await getPeerBrief(Number(peerId));
      return {peerId: Number(peerId), title: brief.title, username: brief.username};
    })
  );

  return {count, peers};
}

/** Reusable from anywhere in the app — profile headers, chat menus, pickers. */
export async function blockPeer(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appUsersManager.toggleBlock(peerId, true);
}

export async function unblockPeer(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appUsersManager.toggleBlock(peerId, false);
}

export async function isPeerBlocked(peerId: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  const full: any = await managers.appProfileManager.getProfileByPeerId(peerId).catch((): null => null);
  return !!full?.pFlags?.blocked;
}

/* ------------------------------------------------------------------ */
/* Two-step verification                                               */
/* ------------------------------------------------------------------ */

export type PasswordState = {
  hasPassword: boolean;
  hint: string;
  /** Set while a recovery email is waiting for its confirmation code. */
  unconfirmedEmailPattern: string;
  hasRecovery: boolean;
};

export async function loadPasswordState(): Promise<PasswordState> {
  const {managers} = await bootTelegram();
  const state: any = await managers.passwordManager.getState();

  return {
    hasPassword: !!state?.pFlags?.has_password,
    hint: state?.hint ?? '',
    unconfirmedEmailPattern: state?.email_unconfirmed_pattern ?? '',
    hasRecovery: !!state?.pFlags?.has_recovery
  };
}

export type PasswordUpdate = {
  /** Required whenever a password is already set. */
  currentPassword?: string;
  /** Empty/omitted turns the cloud password off. */
  newPassword?: string;
  hint?: string;
  /** '' skips the recovery email; a value triggers the code confirmation. */
  email?: string;
};

/**
 * Sets, changes or (with no `newPassword`) removes the cloud password.
 *
 * Returns the length of the emailed confirmation code when the server answers
 * `EMAIL_UNCONFIRMED_N` — the password is stored at that point, but the
 * recovery email still needs `confirmPasswordEmail()`. Returns 0 otherwise.
 */
export async function updateCloudPassword(update: PasswordUpdate): Promise<number> {
  const {managers} = await bootTelegram();

  try {
    await managers.passwordManager.updateSettings({
      currentPassword: update.currentPassword || undefined,
      newPassword: update.newPassword || undefined,
      hint: update.hint ?? '',
      email: update.email
    });
    return 0;
  } catch(err: any) {
    const match = /^EMAIL_UNCONFIRMED_(\d+)/.exec(err?.type ?? '');
    if(match) return Number(match[1]);
    throw err;
  }
}

export async function disableCloudPassword(currentPassword: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.passwordManager.updateSettings({currentPassword});
}

export async function confirmPasswordEmail(code: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.passwordManager.confirmPasswordEmail(code);
}

export async function resendPasswordEmail(): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.passwordManager.resendPasswordEmail();
}

export async function cancelPasswordEmail(): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.passwordManager.cancelPasswordEmail();
}

/* ------------------------------------------------------------------ */
/* Active sessions (detailed) and connected websites                   */
/* ------------------------------------------------------------------ */

export type SessionDetail = {
  hash: string;
  current: boolean;
  official: boolean;
  /** Waiting for confirmation from another device — tweb shows these first. */
  unconfirmed: boolean;
  appName: string;
  appVersion: string;
  deviceModel: string;
  platform: string;
  systemVersion: string;
  ip: string;
  location: string;
  dateCreated: number;
  dateActive: number;
  callsDisabled: boolean;
};

export async function loadSessionDetails(): Promise<SessionDetail[]> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appAccountManager.getAuthorizations();

  const sessions: SessionDetail[] = (result?.authorizations ?? []).map((auth: any) => ({
    hash: String(auth.hash),
    current: !!auth.pFlags?.current,
    official: !!auth.pFlags?.official_app,
    unconfirmed: !!auth.pFlags?.unconfirmed,
    appName: auth.app_name ?? '',
    appVersion: auth.app_version ?? '',
    deviceModel: auth.device_model ?? '',
    platform: auth.platform ?? '',
    systemVersion: auth.system_version ?? '',
    ip: auth.ip ?? '',
    location: [auth.country, auth.region].filter(Boolean).join(', '),
    dateCreated: auth.date_created ?? 0,
    dateActive: auth.date_active ?? 0,
    callsDisabled: !!auth.pFlags?.call_requests_disabled
  }));

  // Current session first, then most recently active.
  return sessions.sort((a, b) => (Number(b.current) - Number(a.current)) || (b.dateActive - a.dateActive));
}

export async function setSessionCallsAccepted(hash: string, accepted: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appAccountManager.changeAuthorizationSettings(hash, {callRequestsDisabled: !accepted});
}

export type WebSession = {
  hash: string;
  botId: number;
  botTitle: string;
  domain: string;
  browser: string;
  platform: string;
  ip: string;
  location: string;
  dateCreated: number;
  dateActive: number;
};

/** `account.getWebAuthorizations` — websites you signed into with Telegram. */
export async function loadWebSessions(): Promise<WebSession[]> {
  const {managers} = await bootTelegram();
  const authorizations: any = await managers.appSeamlessLoginManager.getWebAuthorizations();

  return Promise.all(
    (authorizations ?? []).map(async(auth: any) => {
      const botId = Number(auth.bot_id ?? 0);
      const brief = botId ? await getPeerBrief(botId).catch((): null => null) : null;

      return {
        hash: String(auth.hash),
        botId,
        botTitle: brief?.title ?? '',
        domain: auth.domain ?? '',
        browser: auth.browser ?? '',
        platform: auth.platform ?? '',
        ip: auth.ip ?? '',
        location: auth.region ?? '',
        dateCreated: auth.date_created ?? 0,
        dateActive: auth.date_active ?? 0
      };
    })
  );
}

export async function revokeWebSession(hash: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appSeamlessLoginManager.resetWebAuthorization(hash);
}

export async function revokeAllWebSessions(): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appSeamlessLoginManager.resetWebAuthorizations();
}

/* ------------------------------------------------------------------ */
/* Account-wide auto-delete (default message TTL)                      */
/* ------------------------------------------------------------------ */

const DAY = 86400;

export const AUTO_DELETE_OPTIONS: Array<{value: number; label: string}> = [
  {value: 0, label: 'Off'},
  {value: DAY, label: '1 day'},
  {value: DAY * 7, label: '1 week'},
  {value: DAY * 31, label: '1 month'}
];

export async function loadAutoDeletePeriod(): Promise<number> {
  const {managers} = await bootTelegram();
  return (await managers.appPrivacyManager.getDefaultAutoDeletePeriod()) ?? 0;
}

export async function saveAutoDeletePeriod(period: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appPrivacyManager.setDefaultAutoDeletePeriod(period);
}
