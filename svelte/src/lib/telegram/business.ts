import {bootTelegram} from './client';

/**
 * Telegram Business editors: opening hours, location, greeting and away
 * messages, the intro, quick replies and the connected chatbot.
 *
 * The reads all come off the cached `userFull`; the writes go through
 * `appBusinessManager`, whose `account.updateBusiness*` wrappers were added for
 * this UI (tweb itself only ever displayed these values).
 *
 * As everywhere in this layer, only plain cloneable values cross the seam — the
 * MTProto constructors are built fresh inside the save functions so no Svelte
 * `$state` proxy can reach the worker.
 */

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MINUTES_PER_DAY = 24 * 60;

/* ------------------------------------------------------------------ */
/* Opening hours                                                       */
/* ------------------------------------------------------------------ */

export type DayHours = {
  open: boolean;
  /** Minutes from midnight, local to the configured timezone. */
  from: number;
  to: number;
};

export type WorkHours = {
  enabled: boolean;
  timezoneId: string;
  /** Seven entries, Monday first. */
  days: DayHours[];
};

export type TimezoneOption = {id: string; name: string};

export function defaultDays(): DayHours[] {
  return WEEKDAYS.map(() => ({open: false, from: 9 * 60, to: 17 * 60}));
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, minutes));
  const hours = Math.floor(clamped / 60);
  return `${String(hours).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => parseInt(part, 10) || 0);
  return Math.max(0, Math.min(MINUTES_PER_DAY, hours * 60 + minutes));
}

/**
 * Telegram stores one flat list of intervals measured from Monday 00:00, so a
 * day's 09:00–17:00 becomes `dayIndex * 1440 + 540` … `+ 1020`. Intervals that
 * run past midnight are clamped into their own day here — the editor is a
 * per-day range picker and does not model overnight spans.
 */
function daysFromIntervals(intervals: any[]): DayHours[] {
  const days = defaultDays();

  for(const interval of intervals ?? []) {
    const start = interval.start_minute ?? 0;
    const index = Math.floor(start / MINUTES_PER_DAY);
    if(index < 0 || index > 6) continue;

    const from = start % MINUTES_PER_DAY;
    const to = Math.min(MINUTES_PER_DAY, (interval.end_minute ?? start) - index * MINUTES_PER_DAY);

    days[index] = {open: true, from, to: to > from ? to : MINUTES_PER_DAY};
  }

  return days;
}

function intervalsFromDays(days: DayHours[]): {_: string; start_minute: number; end_minute: number}[] {
  const intervals: {_: string; start_minute: number; end_minute: number}[] = [];

  days.forEach((day, index) => {
    if(!day.open || day.to <= day.from) return;
    intervals.push({
      _: 'businessWeeklyOpen',
      start_minute: index * MINUTES_PER_DAY + day.from,
      end_minute: index * MINUTES_PER_DAY + day.to
    });
  });

  return intervals;
}

export async function loadTimezones(): Promise<TimezoneOption[]> {
  const {managers} = await bootTelegram();

  try {
    const result: any = await managers.apiManager.getTimezonesList();
    return (result?.timezones ?? []).map((timezone: any) => ({
      id: timezone.id,
      name: timezone.name
    }));
  } catch(err) {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* The whole business profile, read in one pass                        */
/* ------------------------------------------------------------------ */

export type RecipientSelection = {
  existingChats: boolean;
  newChats: boolean;
  contacts: boolean;
  nonContacts: boolean;
  /** Inverts the selection: the categories above become exclusions. */
  excludeSelected: boolean;
};

export type AwaySchedule = 'always' | 'outsideWorkHours' | 'custom';

export type GreetingSettings = {
  enabled: boolean;
  shortcutId: number;
  noActivityDays: number;
  recipients: RecipientSelection;
};

export type AwaySettings = {
  enabled: boolean;
  shortcutId: number;
  schedule: AwaySchedule;
  startDate: number;
  endDate: number;
  offlineOnly: boolean;
  recipients: RecipientSelection;
};

export type BusinessProfile = {
  hours: WorkHours;
  locationAddress: string;
  greeting: GreetingSettings;
  away: AwaySettings;
  introTitle: string;
  introDescription: string;
};

function emptyRecipients(): RecipientSelection {
  return {
    existingChats: false,
    newChats: false,
    contacts: false,
    nonContacts: false,
    excludeSelected: false
  };
}

function readRecipients(raw: any): RecipientSelection {
  const flags = raw?.pFlags ?? {};
  return {
    existingChats: !!flags.existing_chats,
    newChats: !!flags.new_chats,
    contacts: !!flags.contacts,
    nonContacts: !!flags.non_contacts,
    excludeSelected: !!flags.exclude_selected
  };
}

function buildRecipients(selection: RecipientSelection): any {
  const pFlags: Record<string, true> = {};
  if(selection.existingChats) pFlags.existing_chats = true;
  if(selection.newChats) pFlags.new_chats = true;
  if(selection.contacts) pFlags.contacts = true;
  if(selection.nonContacts) pFlags.non_contacts = true;
  if(selection.excludeSelected) pFlags.exclude_selected = true;

  return {_: 'inputBusinessRecipients', pFlags};
}

export async function loadBusinessProfile(): Promise<BusinessProfile> {
  const {managers} = await bootTelegram();
  const self: any = await managers.appUsersManager.getSelf();
  const full: any = await managers.appProfileManager.getProfile(self.id, true).catch((): null => null);

  const hours = full?.business_work_hours;
  const greeting = full?.business_greeting_message;
  const away = full?.business_away_message;
  const schedule = away?.schedule;

  return {
    hours: {
      enabled: !!hours,
      timezoneId: hours?.timezone_id ?? '',
      days: hours ? daysFromIntervals(hours.weekly_open) : defaultDays()
    },
    locationAddress: full?.business_location?.address ?? '',
    greeting: {
      enabled: !!greeting,
      shortcutId: greeting?.shortcut_id ?? 0,
      noActivityDays: greeting?.no_activity_days ?? 7,
      recipients: greeting ? readRecipients(greeting.recipients) : emptyRecipients()
    },
    away: {
      enabled: !!away,
      shortcutId: away?.shortcut_id ?? 0,
      schedule:
        schedule?._ === 'businessAwayMessageScheduleOutsideWorkHours' ? 'outsideWorkHours' :
        schedule?._ === 'businessAwayMessageScheduleCustom' ? 'custom' :
        'always',
      startDate: schedule?.start_date ?? 0,
      endDate: schedule?.end_date ?? 0,
      offlineOnly: !!away?.pFlags?.offline_only,
      recipients: away ? readRecipients(away.recipients) : emptyRecipients()
    },
    introTitle: full?.business_intro?.title ?? '',
    introDescription: full?.business_intro?.description ?? ''
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function saveWorkHours(hours: WorkHours): Promise<void> {
  const {managers} = await bootTelegram();

  if(!hours.enabled) {
    await managers.appBusinessManager.updateBusinessWorkHours(undefined);
    return;
  }

  const weeklyOpen = intervalsFromDays(hours.days);
  if(!weeklyOpen.length) {
    throw new Error('Set opening hours for at least one day, or turn the schedule off.');
  }
  if(!hours.timezoneId) {
    throw new Error('Pick a timezone for the opening hours.');
  }

  await managers.appBusinessManager.updateBusinessWorkHours({
    _: 'businessWorkHours',
    pFlags: {},
    timezone_id: hours.timezoneId,
    weekly_open: weeklyOpen
  } as any);
}

export async function saveBusinessLocation(address: string): Promise<void> {
  const {managers} = await bootTelegram();
  const trimmed = address.trim();

  await managers.appBusinessManager.updateBusinessLocation(
    trimmed ? {address: trimmed} : undefined
  );
}

export async function saveGreeting(greeting: GreetingSettings): Promise<void> {
  const {managers} = await bootTelegram();

  if(!greeting.enabled) {
    await managers.appBusinessManager.updateBusinessGreetingMessage(undefined);
    return;
  }

  if(!greeting.shortcutId) {
    throw new Error('Pick a quick reply to send as the greeting.');
  }

  await managers.appBusinessManager.updateBusinessGreetingMessage({
    _: 'inputBusinessGreetingMessage',
    shortcut_id: greeting.shortcutId,
    recipients: buildRecipients(greeting.recipients),
    no_activity_days: greeting.noActivityDays
  } as any);
}

export async function saveAway(away: AwaySettings): Promise<void> {
  const {managers} = await bootTelegram();

  if(!away.enabled) {
    await managers.appBusinessManager.updateBusinessAwayMessage(undefined);
    return;
  }

  if(!away.shortcutId) {
    throw new Error('Pick a quick reply to send while away.');
  }

  const schedule: any =
    away.schedule === 'outsideWorkHours' ? {_: 'businessAwayMessageScheduleOutsideWorkHours'} :
    away.schedule === 'custom' ? {
      _: 'businessAwayMessageScheduleCustom',
      start_date: away.startDate,
      end_date: away.endDate
    } :
    {_: 'businessAwayMessageScheduleAlways'};

  if(away.schedule === 'custom' && !(away.endDate > away.startDate)) {
    throw new Error('The away period must end after it starts.');
  }

  await managers.appBusinessManager.updateBusinessAwayMessage({
    _: 'inputBusinessAwayMessage',
    pFlags: away.offlineOnly ? {offline_only: true} : {},
    shortcut_id: away.shortcutId,
    schedule,
    recipients: buildRecipients(away.recipients)
  } as any);
}

export async function saveIntro(title: string, description: string): Promise<void> {
  const {managers} = await bootTelegram();
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();

  await managers.appBusinessManager.updateBusinessIntro(
    trimmedTitle || trimmedDescription ?
      {_: 'inputBusinessIntro', title: trimmedTitle, description: trimmedDescription} as any :
      undefined
  );
}

/* ------------------------------------------------------------------ */
/* Quick replies                                                       */
/* ------------------------------------------------------------------ */

export type QuickReplyItem = {
  shortcutId: number;
  shortcut: string;
  count: number;
};

export async function loadQuickReplies(): Promise<QuickReplyItem[]> {
  const {managers} = await bootTelegram();

  try {
    const replies: any[] = await managers.appBusinessManager.getQuickReplies();
    return (replies ?? []).map((reply: any) => ({
      shortcutId: reply.shortcut_id,
      shortcut: reply.shortcut,
      count: reply.count ?? 0
    }));
  } catch(err) {
    return [];
  }
}

export async function renameQuickReply(shortcutId: number, shortcut: string): Promise<void> {
  const {managers} = await bootTelegram();
  const trimmed = shortcut.trim();
  if(!trimmed) throw new Error('A quick reply needs a name.');

  await managers.appBusinessManager.editQuickReplyShortcut(shortcutId, trimmed);
}

export async function deleteQuickReply(shortcutId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appBusinessManager.deleteQuickReplyShortcut(shortcutId);
}

/* ------------------------------------------------------------------ */
/* Connected chatbot                                                   */
/* ------------------------------------------------------------------ */

export type BotRight =
  | 'reply'
  | 'read_messages'
  | 'delete_sent_messages'
  | 'delete_received_messages'
  | 'edit_name'
  | 'edit_bio'
  | 'edit_profile_photo'
  | 'edit_username'
  | 'view_gifts'
  | 'sell_gifts'
  | 'change_gift_settings'
  | 'transfer_and_upgrade_gifts'
  | 'transfer_stars'
  | 'manage_stories';

export const BOT_RIGHTS: {key: BotRight; label: string}[] = [
  {key: 'reply', label: 'Reply to messages'},
  {key: 'read_messages', label: 'Read all messages'},
  {key: 'delete_sent_messages', label: 'Delete its own messages'},
  {key: 'delete_received_messages', label: 'Delete received messages'},
  {key: 'edit_name', label: 'Edit your name'},
  {key: 'edit_bio', label: 'Edit your bio'},
  {key: 'edit_profile_photo', label: 'Edit your profile photo'},
  {key: 'edit_username', label: 'Edit your username'},
  {key: 'view_gifts', label: 'View gifts and stars'},
  {key: 'sell_gifts', label: 'Sell gifts'},
  {key: 'change_gift_settings', label: 'Change gift settings'},
  {key: 'transfer_and_upgrade_gifts', label: 'Transfer and upgrade gifts'},
  {key: 'transfer_stars', label: 'Transfer stars'},
  {key: 'manage_stories', label: 'Manage stories'}
];

export const DEFAULT_BOT_RIGHTS: BotRight[] = [
  'reply',
  'read_messages',
  'delete_sent_messages',
  'delete_received_messages'
];

export type ConnectedBotInfo = {
  botId: number;
  rights: BotRight[];
  recipients: RecipientSelection;
  /** Peer ids the bot must never see, from `exclude_users`. */
  excludedPeerIds: number[];
};

export async function loadConnectedBot(): Promise<ConnectedBotInfo | null> {
  const {managers} = await bootTelegram();

  try {
    const bot: any = await managers.appBusinessManager.getConnectedBot();
    if(!bot) return null;

    const flags = bot.rights?.pFlags ?? {};

    return {
      botId: Number(bot.bot_id),
      rights: BOT_RIGHTS.filter(({key}) => flags[key]).map(({key}) => key),
      recipients: readRecipients(bot.recipients),
      excludedPeerIds: (bot.recipients?.exclude_users ?? []).map((id: any) => Number(id))
    };
  } catch(err) {
    return null;
  }
}

/** Resolves a @username to a bot that supports business connections. */
export async function findBusinessBot(username: string): Promise<number> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appBusinessManager.searchBusinessBots(username);

  const botId = Number(result?.userIds?.[0] ?? 0);
  if(!botId) {
    throw new Error(
      result?.unsupportedUserId ?
        'That bot does not support business connections.' :
        'No bot found with that username.'
    );
  }

  return botId;
}

export async function saveConnectedBot(
  info: ConnectedBotInfo,
  previousBotId: number
): Promise<void> {
  const {managers} = await bootTelegram();

  const pFlags: Record<string, true> = {};
  for(const right of info.rights) pFlags[right] = true;

  const recipientFlags: Record<string, true> = {};
  if(info.recipients.existingChats) recipientFlags.existing_chats = true;
  if(info.recipients.newChats) recipientFlags.new_chats = true;
  if(info.recipients.contacts) recipientFlags.contacts = true;
  if(info.recipients.nonContacts) recipientFlags.non_contacts = true;
  if(info.recipients.excludeSelected) recipientFlags.exclude_selected = true;

  await managers.appBusinessManager.updateConnectedBot({
    botId: info.botId as any,
    previousBotId: (previousBotId || undefined) as any,
    rights: {_: 'businessBotRights', pFlags} as any,
    recipients: {
      _: 'businessBotRecipients',
      pFlags: recipientFlags,
      exclude_users: info.excludedPeerIds.map((peerId) => peerId)
    } as any
  });
}

export async function disconnectBot(botId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appBusinessManager.updateConnectedBot({previousBotId: botId as any});
}
