import {bootTelegram} from './client';

/**
 * Account settings, notifications, business info and bots.
 *
 * Same rule as chats.ts: only plain, structured-cloneable values leave this
 * module — nothing that reaches a Svelte `$state` may go back to the worker.
 */

export type ProfileInfo = {
  userId: number;
  firstName: string;
  lastName: string;
  username: string;
  phone: string;
  bio: string;
  isPremium: boolean;
};

export async function loadProfile(): Promise<ProfileInfo> {
  const {managers} = await bootTelegram();
  const self: any = await managers.appUsersManager.getSelf();
  const full: any = await managers.appProfileManager.getProfile(self.id).catch(() => null);

  return {
    userId: Number(self.id),
    firstName: self.first_name ?? '',
    lastName: self.last_name ?? '',
    username: self.username ?? '',
    phone: self.phone ? `+${self.phone}` : '',
    bio: full?.about ?? '',
    isPremium: !!self.pFlags?.premium
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

/* ------------------------------------------------------------------ */
/* Telegram Business                                                   */
/* ------------------------------------------------------------------ */

export type BusinessInfo = {
  hasHours: boolean;
  hoursText: string;
  location: string;
  greeting: boolean;
  away: boolean;
  introTitle: string;
  introDescription: string;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export async function loadBusiness(): Promise<BusinessInfo> {
  const {managers} = await bootTelegram();
  const self: any = await managers.appUsersManager.getSelf();
  const full: any = await managers.appProfileManager.getProfile(self.id, true).catch(() => null);

  const hours = full?.business_work_hours;
  const intervals: any[] = hours?.weekly_open ?? [];

  return {
    hasHours: !!hours,
    hoursText: intervals.length ?
      intervals.slice(0, 7).map((interval: any) => {
        const day = Math.floor(interval.start_minute / (24 * 60));
        const from = interval.start_minute % (24 * 60);
        const to = interval.end_minute % (24 * 60);
        const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        return `${WEEKDAYS[day] ?? '?'} ${fmt(from)}–${fmt(to)}`;
      }).join(', ') :
      '',
    location: full?.business_location?.address ?? '',
    greeting: !!full?.business_greeting_message,
    away: !!full?.business_away_message,
    introTitle: full?.business_intro?.title ?? '',
    introDescription: full?.business_intro?.description ?? ''
  };
}

/** Business intro is the one business object tweb exposes a manager call for. */
export async function saveBusinessIntro(title: string, description: string): Promise<void> {
  const {managers} = await bootTelegram();
  const self: any = await managers.appUsersManager.getSelf();

  await managers.appBusinessManager.saveBusinessIntro(self.id, {
    _: 'businessIntro',
    title,
    description,
    pFlags: {}
  } as any);
}

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
};

export type InlineQueryAnswer = {
  botId: number;
  results: InlineResultItem[];
  /** `inlineBotWebView` — the "open app" button shown above the results. */
  switchWebView: {text: string; url: string} | null;
  /** `inlineBotSwitchPM` — the "start bot" button shown above the results. */
  switchPm: {text: string; startParam: string} | null;
};

const emptyInlineAnswer: InlineQueryAnswer = {botId: 0, results: [], switchWebView: null, switchPm: null};

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

    return {
      botId,
      results: (result?.results ?? []).map((item: any) => ({
        queryAndResultId: `${result.query_id}_${item.id}`,
        title: item.title ?? item.send_message?.message?.slice(0, 40) ?? 'Result',
        description: item.description ?? ''
      })),
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
