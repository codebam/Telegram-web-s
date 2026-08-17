import {bootTelegram} from './client';

/**
 * Account settings, notifications, business info and bots.
 *
 * Same rule as chats.ts: only plain, structured-cloneable values leave this
 * module — nothing that reaches a Svelte `$state` may go back to the worker.
 */

export type BirthdayValue = {day: number; month: number; year: number | null};

export type ProfileInfo = {
  userId: number;
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
  bio: string;
  isPremium: boolean;
  birthday: BirthdayValue | null;
  personalChannelId: number;
  /** Id of the current profile photo, needed to remove it. */
  photoId: string;
};

export async function loadProfile(): Promise<ProfileInfo> {
  const {managers} = await bootTelegram();
  const self: any = await managers.appUsersManager.getSelf();
  const full: any = await managers.appProfileManager.getProfile(self.id).catch((): null => null);

  const birthday = full?.birthday;

  return {
    userId: Number(self.id),
    firstName: self.first_name ?? '',
    lastName: self.last_name ?? '',
    username: self.username ?? '',
    phone: self.phone ? `+${self.phone}` : '',
    bio: full?.about ?? '',
    isPremium: !!self.pFlags?.premium,
    birthday: birthday ?
      {day: birthday.day, month: birthday.month, year: birthday.year ?? null} :
      null,
    personalChannelId: full?.personal_channel_id ? Number(full.personal_channel_id) : 0,
    photoId: self.photo?.photo_id ? String(self.photo.photo_id) : ''
  };
}

export async function saveProfile(firstName: string, lastName: string, bio: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appProfileManager.updateProfile(firstName, lastName, bio);
}

export async function saveUsername(username: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appUsersManager.updateUsername(username);
}

/* ------------------------------------------------------------------ */
/* Birthday                                                            */
/* ------------------------------------------------------------------ */

/** Pass `null` to clear the birthday. Year is optional — Telegram allows hiding it. */
export async function saveBirthday(value: BirthdayValue | null): Promise<void> {
  const {managers} = await bootTelegram();

  if(!value) {
    await managers.appProfileManager.setMyBirthday(null);
    return;
  }

  // Built fresh here so no `$state` proxy from the form reaches the worker.
  const birthday: any = {_: 'birthday', day: value.day, month: value.month};
  if(value.year) birthday.year = value.year;

  await managers.appProfileManager.setMyBirthday(birthday);
}

export type BirthdayPrivacy = 'everybody' | 'contacts' | 'nobody';

/**
 * Who can see the birthday. Read straight off the privacy rules rather than
 * `getPrivacyRulesDetails`, so nothing but a plain string crosses the seam.
 */
export async function loadBirthdayPrivacy(): Promise<BirthdayPrivacy> {
  const {managers} = await bootTelegram();

  try {
    const rules: any[] = await managers.appPrivacyManager.getPrivacy('inputPrivacyKeyBirthday' as any);
    const has = (type: string) => rules.some((rule) => rule._ === type);

    if(has('privacyValueAllowAll')) return 'everybody';
    if(has('privacyValueAllowContacts')) return 'contacts';
    return 'nobody';
  } catch(err) {
    return 'nobody';
  }
}

export async function saveBirthdayPrivacy(value: BirthdayPrivacy): Promise<void> {
  const {managers} = await bootTelegram();

  const rules: any[] =
    value === 'everybody' ? [{_: 'inputPrivacyValueAllowAll'}] :
    value === 'contacts' ? [{_: 'inputPrivacyValueAllowContacts'}, {_: 'inputPrivacyValueDisallowAll'}] :
    [{_: 'inputPrivacyValueDisallowAll'}];

  await managers.appPrivacyManager.setPrivacy('inputPrivacyKeyBirthday' as any, rules as any);
}

/* ------------------------------------------------------------------ */
/* Personal channel                                                    */
/* ------------------------------------------------------------------ */

export type PersonalChannelOption = {
  /** Negative peer id, the form the avatar and title helpers expect. */
  peerId: number;
  title: string;
};

export async function loadPersonalChannels(): Promise<PersonalChannelOption[]> {
  const {managers} = await bootTelegram();

  try {
    const chatIds: any[] = await managers.appProfileManager.getAdminedPersonalChannels();
    const options = await Promise.all(
      (chatIds ?? []).map(async(chatId) => {
        const chat: any = await managers.appChatsManager.getChat(chatId).catch((): null => null);
        return {peerId: -Number(chatId), title: chat?.title ?? 'Channel'};
      })
    );
    return options;
  } catch(err) {
    return [];
  }
}

/** `peerId` is the negative channel peer id; 0 detaches the personal channel. */
export async function savePersonalChannel(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appProfileManager.updatePersonalChannel(peerId ? -peerId : undefined);
}

/* ------------------------------------------------------------------ */
/* Profile photo                                                       */
/* ------------------------------------------------------------------ */

/**
 * Uploads a cropped square as the account's profile photo.
 *
 * The blob is produced by `ImageCropper.svelte`; `appDownloadManager.upload`
 * turns it into the `InputFile` the manager wants.
 */
export async function uploadProfilePhoto(blob: Blob): Promise<void> {
  const {managers} = await bootTelegram();
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  const file = await appDownloadManager.upload(blob, 'avatar.jpg');
  await managers.appProfileManager.uploadProfilePhoto({file} as any);
}

/** Same crop payload, but for a group or channel the user administers. */
export async function uploadChatPhoto(peerId: number, blob: Blob): Promise<void> {
  const {managers} = await bootTelegram();
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  const file = await appDownloadManager.upload(blob, 'avatar.jpg');
  await managers.appChatsManager.editPhoto(-peerId, {file} as any);
}

export async function removeProfilePhoto(photoId: string): Promise<void> {
  if(!photoId) return;
  const {managers} = await bootTelegram();
  await managers.appProfileManager.deletePhotos([photoId]);
}

/* ------------------------------------------------------------------ */
/* Account deletion                                                    */
/* ------------------------------------------------------------------ */

/** Days of inactivity after which Telegram deletes the account. */
export async function loadAccountTTL(): Promise<number> {
  const {managers} = await bootTelegram();

  try {
    return Number(await managers.appAccountManager.getAccountTTL()) || 0;
  } catch(err) {
    return 0;
  }
}

export async function saveAccountTTL(days: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appAccountManager.setAccountTTL(days);
}

export async function deleteAccount(reason: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appAccountManager.deleteAccount(reason);
}

/* ------------------------------------------------------------------ */
/* Active sessions                                                     */
/* ------------------------------------------------------------------ */

export type SessionInfo = {
  hash: string;
  current: boolean;
  appName: string;
  deviceModel: string;
  platform: string;
  ip: string;
  country: string;
  dateActive: number;
};

export async function loadSessions(): Promise<SessionInfo[]> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appAccountManager.getAuthorizations();

  return (result?.authorizations ?? []).map((auth: any) => ({
    hash: String(auth.hash),
    current: !!auth.pFlags?.current,
    appName: auth.app_name ?? '',
    deviceModel: auth.device_model ?? '',
    platform: [auth.platform, auth.system_version].filter(Boolean).join(' '),
    ip: auth.ip ?? '',
    country: auth.country ?? '',
    dateActive: auth.date_active ?? 0
  }));
}

export async function terminateSession(hash: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appAccountManager.resetAuthorization(hash);
}

export async function terminateOtherSessions(): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appAccountManager.resetAuthorizations();
}

export async function logOut(): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.apiManager.logOut();
}

/* ------------------------------------------------------------------ */
/* Notification settings (server-side, per peer type)                  */
/* ------------------------------------------------------------------ */

export type NotifyScope = 'users' | 'groups' | 'channels';

const SCOPE_INPUT: Record<NotifyScope, string> = {
  users: 'inputNotifyUsers',
  groups: 'inputNotifyChats',
  channels: 'inputNotifyBroadcasts'
};

export async function loadNotifyScopes(): Promise<Record<NotifyScope, boolean>> {
  const {managers} = await bootTelegram();
  const entries = await Promise.all(
    (Object.keys(SCOPE_INPUT) as NotifyScope[]).map(async(scope) => {
      try {
        const settings: any = await managers.appNotificationsManager.getNotifySettings({_: SCOPE_INPUT[scope]} as any);
        // mute_until in the future means muted.
        const muted = (settings?.mute_until ?? 0) > Date.now() / 1000;
        return [scope, !muted] as const;
      } catch(err) {
        return [scope, true] as const;
      }
    })
  );

  return Object.fromEntries(entries) as Record<NotifyScope, boolean>;
}

export async function setNotifyScope(scope: NotifyScope, enabled: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appNotificationsManager.updateNotifySettings(
    {_: SCOPE_INPUT[scope]} as any,
    {
      _: 'inputPeerNotifySettings',
      // 0 unmutes; a far-future timestamp is Telegram's "muted forever".
      mute_until: enabled ? 0 : 0x7fffffff
    } as any
  );
}

/* Telegram Business now lives in `./business.ts`, which edits every field
   rather than only reading it. The old read-only `loadBusiness` and the
   `saveBusinessIntro` that called the manager's cache helper (and so never
   reached the server) are gone with it. */

/* ------------------------------------------------------------------ */
/* Bots and mini apps                                                  */
/* ------------------------------------------------------------------ */

export type AttachBot = {
  botId: number;
  name: string;
  requestWriteAccess: boolean;
};

export async function loadAttachBots(): Promise<AttachBot[]> {
  const {managers} = await bootTelegram();
  try {
    const result: any = await managers.appAttachMenuBotsManager.getAttachMenuBots();
    return (result ?? []).map((bot: any) => ({
      botId: Number(bot.bot_id),
      name: bot.short_name ?? '',
      requestWriteAccess: !!bot.pFlags?.request_write_access
    }));
  } catch(err) {
    return [];
  }
}

export type InlineResultItem = {
  queryAndResultId: string;
  title: string;
  description: string;
  type: string;
  isGif?: boolean;
  thumbDocId?: string;
  thumbPhotoId?: string;
  thumbUrl?: string;
};

export type InlineQueryAnswer = {
  botId: number;
  gallery: boolean;
  results: InlineResultItem[];
  /** `inlineBotWebView` — the "open app" button shown above the results. */
  switchWebView: {text: string; url: string} | null;
  /** `inlineBotSwitchPM` — the "start bot" button shown above the results. */
  switchPm: {text: string; startParam: string} | null;
};

const emptyInlineAnswer: InlineQueryAnswer = {botId: 0, gallery: false, results: [], switchWebView: null, switchPm: null};

// Keep raw media outside Svelte state. `$state` turns nested objects into proxies,
// which the worker cannot structured-clone when the thumbnail loader downloads it.
const inlineResultMedia = new Map<string, any>();
const inlineThumbnailUrls = new Map<string, string | null>();

export async function loadInlineResultThumbnail(queryAndResultId: string): Promise<string | null> {
  if(inlineThumbnailUrls.has(queryAndResultId)) return inlineThumbnailUrls.get(queryAndResultId)!;

  const item = inlineResultMedia.get(queryAndResultId);
  const media = item?._ === 'botInlineMediaResult' ? (item.document ?? item.photo) : item?.thumb;
  if(!media) return null;

  await bootTelegram();
  const [{default: appDownloadManager}, {default: choosePhotoSize}] = await Promise.all([
    import('@lib/appDownloadManager'),
    import('@appManagers/utils/photos/choosePhotoSize')
  ]);

  try {
    const isPhoto = media._ === 'photo';
    const isDocument = media._ === 'document';
    const attributes = media.attributes ?? [];
    const isGif = isDocument && (attributes.some((a: any) => a._ === 'documentAttributeAnimated') || media.type === 'gif' || media.mime_type === 'video/mp4');

    // GIFs download the full video file so they can animate; other media gets a thumbnail.
    const thumbnail = isGif ? undefined : (isPhoto || isDocument ? choosePhotoSize(media, 96, 96, true) : undefined);
    const url = await appDownloadManager.downloadMediaURL({media, thumb: thumbnail});
    inlineThumbnailUrls.set(queryAndResultId, url ?? null);
    return url ?? null;
  } catch(err) {
    inlineThumbnailUrls.set(queryAndResultId, null);
    return null;
  }
}

/** Inline bot query: "@bot some text" typed into the composer. */
export async function queryInlineBot(
  peerId: number,
  botUsername: string,
  query: string
): Promise<InlineQueryAnswer> {
  const {managers} = await bootTelegram();

  try {
    const peer: any = await managers.appUsersManager.resolveUsername(botUsername);
    const botId = Number(peer?.id ?? 0);
    if(!botId) return emptyInlineAnswer;

    const result: any = await managers.appInlineBotsManager.getInlineResults(peerId, botId, query);
    const switchWebView = result?.switch_webview;
    const switchPm = result?.switch_pm;
    for(const item of result?.results ?? []) {
      inlineResultMedia.set(`${result.query_id}_${item.id}`, item);
    }

    const isGallery = !!(result?.pFlags?.gallery || result?.gallery);

    return {
      botId,
      gallery: isGallery,
      results: (result?.results ?? []).map((item: any) => {
        const doc = item.document;
        const attributes = doc?.attributes ?? [];
        const isGif = Boolean(item.type === 'gif' || (doc && (attributes.some((a: any) => a._ === 'documentAttributeAnimated') || doc.type === 'gif' || doc.mime_type === 'video/mp4')));

        return {
          queryAndResultId: `${result.query_id}_${item.id}`,
          title: item.title ?? item.send_message?.message?.slice(0, 40) ?? 'Result',
          description: item.description ?? '',
          type: item.type ?? '',
          isGif,
          thumbDocId: doc?.id ? String(doc.id) : undefined,
          thumbPhotoId: item.photo?.id ? String(item.photo.id) : undefined,
          thumbUrl: item.thumb?.mime_type?.startsWith('image/') ? item.thumb.url : undefined
        };
      }),
      switchWebView: switchWebView ? {text: switchWebView.text ?? 'Open app', url: switchWebView.url ?? ''} : null,
      switchPm: switchPm ? {text: switchPm.text ?? 'Start', startParam: switchPm.start_param ?? ''} : null
    };
  } catch(err) {
    return emptyInlineAnswer;
  }
}

export async function sendInlineResult(
  peerId: number,
  botUsername: string,
  queryAndResultId: string
): Promise<void> {
  const {managers} = await bootTelegram();
  const peer: any = await managers.appUsersManager.resolveUsername(botUsername);
  await managers.appInlineBotsManager.sendInlineResult(peerId, Number(peer.id), queryAndResultId, {});
}
