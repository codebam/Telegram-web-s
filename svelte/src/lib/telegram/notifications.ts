/**
 * Desktop notifications for incoming messages.
 *
 * Two paths, both switched by the same toggle:
 * - while a tab is open, the chat view feeds `notifyMessage` here, so it can
 *   respect what is currently on screen;
 * - with the app closed, Telegram's push server delivers to the service
 *   worker, which needs this tab to have registered a subscription first.
 *
 * Deliberately not tied to tweb's own uiNotificationsManager: that one drives
 * the legacy UI.
 */

import {bootTelegram} from './client';

const ENABLED_KEY = 'tweb-svelte:notifications';
const PREFS_KEY = 'tweb-svelte:notifications:prefs';

/** Telegram's "muted forever" timestamp. */
const MUTE_FOREVER = 0x7fffffff;

export function notificationsEnabled(): boolean {
  if(typeof localStorage === 'undefined') return false;
  return localStorage.getItem(ENABLED_KEY) === '1' && permission() === 'granted';
}

export function permission(): NotificationPermission | 'unsupported' {
  if(typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function enableNotifications(): Promise<boolean> {
  if(typeof Notification === 'undefined') return false;

  const result = Notification.permission === 'granted' ?
    'granted' :
    await Notification.requestPermission();

  const granted = result === 'granted';
  localStorage.setItem(ENABLED_KEY, granted ? '1' : '0');
  await syncPushSubscription();
  return granted;
}

export function disableNotifications() {
  localStorage.setItem(ENABLED_KEY, '0');
  syncPushSubscription();
}

/* ------------------------------------------------------------------ */
/* Web push                                                            */
/* ------------------------------------------------------------------ */

let pushStarted = false;

/**
 * Bring the push subscription in line with the toggle.
 *
 * Nothing arrives while the app is closed until the tab has subscribed to the
 * browser's push service and handed that token to Telegram with
 * `account.registerDevice` — the service worker is registered by the MTProto
 * stack, but it is only ever woken by a push the server was told to send.
 *
 * Safe to call on every boot: an existing subscription is reused, so this
 * settles to a single registerDevice.
 */
export async function syncPushSubscription(): Promise<boolean> {
  const {default: webPushApiManager} = await import('@lib/webPushApiManager');
  if(!webPushApiManager.isAvailable) return false;

  // The stack registers the service worker; without it there is nothing for
  // the push service to deliver to.
  await bootTelegram();
  const {default: apiManagerProxy} = await import('@lib/apiManagerProxy');
  const existing = await webPushApiManager.getSubscription();

  if(!notificationsEnabled()) {
    if(existing) {
      webPushApiManager.unsubscribe();
      apiManagerProxy.pushSingleManager.unregisterDevice(existing);
    }
    return false;
  }

  if(!pushStarted) {
    pushStarted = true;
    webPushApiManager.start();
  }

  // The worker phrases a push from these: without them it falls back to a
  // contentless "Telegram Web" notification. Re-sent on every sync so a
  // settings change reaches the service worker without a reload.
  await applyPushSettings();

  try {
    const token = existing || await webPushApiManager.subscribe();
    if(!token) return false;
    apiManagerProxy.pushSingleManager.registerDevice(token);
    return true;
  } catch(err) {
    return false;
  }
}

/**
 * Clicking a push wakes the app rather than the tab that sent it, so the peer
 * to open comes from the notification payload — encrypted ones are decrypted
 * through the same manager that registered the device.
 */
export async function onPushClick(callback: (peerId: number) => void): Promise<void> {
  const {default: webPushApiManager} = await import('@lib/webPushApiManager');
  if(!webPushApiManager.isAvailable) return;

  await bootTelegram();
  const {default: apiManagerProxy} = await import('@lib/apiManagerProxy');

  webPushApiManager.addEventListener('push_notification_click', async(data: any) => {
    let notification = data;
    if(notification.p) {
      notification = await apiManagerProxy.pushSingleManager.decryptPush(notification.p, notification.keyIdBase64);
      notification = await apiManagerProxy.serviceMessagePort.invoke('fillPushObject', notification);
    }

    const peerId = Number(notification?.custom?.peerId);
    if(peerId) callback(peerId);
  });
}

/** Whether the peer's own settings — or the per-type default — silence it. */
export async function isPeerMuted(peerId: number, threadId?: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  // The caller is about to decide whether to notify: warm the preview flag for
  // this peer while we are here, so `notifyMessage` can read it synchronously.
  warmPeerPreview(peerId);
  try {
    return await managers.appNotificationsManager.getPeerMessagesMuted(peerId, threadId);
  } catch(err) {
    // Never notify on a settings lookup we could not resolve.
    return true;
  }
}

/**
 * Show a notification for an incoming message. Skipped when the tab is focused
 * on that same chat — matching what the official clients do.
 */
export function notifyMessage(options: {
  title: string;
  body: string;
  peerId: number;
  icon?: string | null;
  onclick?: (peerId: number) => void;
}) {
  if(!notificationsEnabled()) return;
  if(!document.hidden && document.hasFocus() && options.peerId === activePeerId) return;

  const prefs = getLocalPrefs();
  // The in-app ding belongs to the visible tab; when it is hidden the OS
  // notification carries the sound itself.
  const dinged = prefs.inAppSounds && !document.hidden;
  if(dinged) playDing();
  if(prefs.inAppFlash && document.hidden) flashTitle(options.title);

  // "Message preview" is a per-scope (and per-peer) server setting; honour it
  // for the in-tab notification the same way the push server honours it.
  const preview = peerPreview.get(options.peerId) ?? true;

  try {
    const notification = new Notification(options.title, {
      body: preview ? options.body.slice(0, 200) : 'New message',
      icon: options.icon ?? '/icon-192.png',
      tag: `peer-${options.peerId}`,
      silent: dinged
    });

    notification.onclick = () => {
      window.focus();
      options.onclick?.(options.peerId);
      notification.close();
    };
  } catch(err) {
    // Notification construction throws on some mobile browsers; ignore.
  }
}

/** The chat currently on screen, so we do not notify for it while focused. */
let activePeerId: number | null = null;

export function setActiveNotificationPeer(peerId: number | null) {
  activePeerId = peerId;
}

/* ------------------------------------------------------------------ */
/* Local (this device) preferences                                     */
/* ------------------------------------------------------------------ */

export type LocalNotificationPrefs = {
  /** Play a short tone in the tab that renders the notification. */
  inAppSounds: boolean;
  /** Flash the document title while the tab is in the background. */
  inAppFlash: boolean;
  /** Whether muted chats add to the unread badge. */
  countMutedInBadge: boolean;
};

const DEFAULT_PREFS: LocalNotificationPrefs = {
  inAppSounds: true,
  inAppFlash: true,
  countMutedInBadge: false
};

let prefsCache: LocalNotificationPrefs | null = null;

export function getLocalPrefs(): LocalNotificationPrefs {
  if(prefsCache) return prefsCache;
  if(typeof localStorage === 'undefined') return prefsCache = {...DEFAULT_PREFS};

  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return prefsCache = {...DEFAULT_PREFS, ...stored};
  } catch(err) {
    return prefsCache = {...DEFAULT_PREFS};
  }
}

export function setLocalPref<K extends keyof LocalNotificationPrefs>(
  key: K,
  value: LocalNotificationPrefs[K]
): LocalNotificationPrefs {
  const next = {...getLocalPrefs(), [key]: value};
  prefsCache = next;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch(err) {
    // Private mode with no storage: the in-memory copy still applies.
  }

  // The service worker keeps its own copy of these.
  applyPushSettings();
  return next;
}

/** Counting muted chats in the badge is a read of the same local preference. */
export function countsMutedInBadge(): boolean {
  return getLocalPrefs().countMutedInBadge;
}

let audioContext: AudioContext | null = null;

/** Short synthesized tone — the app ships no audio assets. */
function playDing(frequency = 880) {
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if(!Ctor) return;
    audioContext ||= new Ctor();
    const ctx = audioContext;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.32);
  } catch(err) {
    // Autoplay policy or an unsupported context: the tone is optional.
  }
}

let flashTimer: number | null = null;
let flashOriginalTitle: string | null = null;

function flashTitle(text: string) {
  if(typeof document === 'undefined') return;
  flashOriginalTitle ??= document.title;

  let on = false;
  let left = 10;
  if(flashTimer !== null) clearInterval(flashTimer);
  flashTimer = window.setInterval(() => {
    document.title = (on = !on) ? text : flashOriginalTitle!;
    if(--left <= 0) stopFlash();
  }, 900);

  document.addEventListener('visibilitychange', stopFlash, {once: true});
}

function stopFlash() {
  if(flashTimer !== null) {
    clearInterval(flashTimer);
    flashTimer = null;
  }

  if(flashOriginalTitle !== null) {
    document.title = flashOriginalTitle;
    flashOriginalTitle = null;
  }
}

/* ------------------------------------------------------------------ */
/* Notification sounds                                                 */
/* ------------------------------------------------------------------ */

export type SoundOption = {
  /** 'default', 'none', or a saved ringtone's document id. */
  id: string;
  title: string;
};

const BUILT_IN_SOUNDS: SoundOption[] = [
  {id: 'default', title: 'Default'},
  {id: 'none', title: 'None'}
];

const ringtoneDocs = new Map<string, any>();
let soundsPromise: Promise<SoundOption[]> | null = null;

/** Default and None, plus every ringtone saved on the account. */
export function loadSounds(): Promise<SoundOption[]> {
  return soundsPromise ??= (async() => {
    try {
      const {managers} = await bootTelegram();
      const docs: any[] = await (managers.appNotificationsManager as any).getSavedRingtones();
      const ringtones = (docs ?? []).map((doc, index) => {
        const id = String(doc.id);
        ringtoneDocs.set(id, doc);
        return {id, title: doc.file_name || `Ringtone ${index + 1}`};
      });
      return [...BUILT_IN_SOUNDS, ...ringtones];
    } catch(err) {
      return [...BUILT_IN_SOUNDS];
    }
  })();
}

let previewAudio: HTMLAudioElement | null = null;

/** Play a sound so the choice can be heard before it is saved. */
export async function previewSound(id: string): Promise<void> {
  previewAudio?.pause();
  previewAudio = null;
  if(id === 'none') return;
  if(id === 'default') {
    playDing();
    return;
  }

  const doc = ringtoneDocs.get(id);
  if(!doc) return;

  try {
    await bootTelegram();
    const {default: appDownloadManager} = await import('@lib/appDownloadManager');
    const url = await appDownloadManager.downloadMediaURL({media: doc});
    if(!url) return;
    previewAudio = new Audio(url);
    await previewAudio.play();
  } catch(err) {
    // A ringtone we cannot fetch or play is not worth an error banner.
  }
}

function soundToId(sound: any): string {
  if(!sound || sound._ === 'notificationSoundDefault') return 'default';
  if(sound._ === 'notificationSoundNone') return 'none';
  if(sound._ === 'notificationSoundRingtone') return String(sound.id);
  return 'default';
}

function idToSound(id: string): any {
  if(id === 'none') return {_: 'notificationSoundNone'};
  if(id === 'default') return {_: 'notificationSoundDefault'};
  return {_: 'notificationSoundRingtone', id};
}

/* ------------------------------------------------------------------ */
/* Per-scope settings                                                  */
/* ------------------------------------------------------------------ */

export type NotifyScope = 'users' | 'groups' | 'channels';

const SCOPE_INPUT: Record<NotifyScope, string> = {
  users: 'inputNotifyUsers',
  groups: 'inputNotifyChats',
  channels: 'inputNotifyBroadcasts'
};

export type ScopeNotifications = {
  enabled: boolean;
  preview: boolean;
  sound: string;
};

async function rawScopeSettings(scope: NotifyScope): Promise<any> {
  const {managers} = await bootTelegram();
  return await managers.appNotificationsManager.getNotifySettings({_: SCOPE_INPUT[scope]} as any);
}

function isMuted(settings: any): boolean {
  return !!settings?.silent || (settings?.mute_until ?? 0) > Date.now() / 1000;
}

/**
 * A `peerNotifySettings` is written back as an `inputPeerNotifySettings` with
 * the same fields — copying it keeps the flags this UI does not expose (the
 * story ones, the platform sounds) instead of clearing them.
 */
function toInput(settings: any): any {
  return {...(settings ?? {}), _: 'inputPeerNotifySettings'};
}

export async function loadScopeNotifications(scope: NotifyScope): Promise<ScopeNotifications> {
  try {
    const settings = await rawScopeSettings(scope);
    return {
      enabled: !isMuted(settings),
      preview: settings?.show_previews !== false,
      sound: soundToId(settings?.other_sound)
    };
  } catch(err) {
    return {enabled: true, preview: true, sound: 'default'};
  }
}

export async function setScopeNotifications(
  scope: NotifyScope,
  patch: Partial<ScopeNotifications>
): Promise<void> {
  const {managers} = await bootTelegram();
  const current = await rawScopeSettings(scope);
  const input = toInput(current);

  if(patch.enabled !== undefined) {
    // `mute_until` alone decides this; `silent` would outlive it and is only
    // ever cleared here, never set.
    input.mute_until = patch.enabled ? 0 : MUTE_FOREVER;
    if(patch.enabled) input.silent = false;
  }

  if(patch.preview !== undefined) input.show_previews = patch.preview;
  if(patch.sound !== undefined) {
    input.other_sound = idToSound(patch.sound);
    input.ios_sound = input.other_sound;
    input.android_sound = input.other_sound;
  }

  await managers.appNotificationsManager.updateNotifySettings({_: SCOPE_INPUT[scope]} as any, input);
  peerPreview.clear();
  applyPushSettings();
}

/* ------------------------------------------------------------------ */
/* Stories                                                             */
/* ------------------------------------------------------------------ */

// * Story notifications ride on the "users" scope, mirroring the official
// * clients: `stories_muted` off/on, `stories_hide_sender` for the preview.
export type StoryNotifications = {
  enabled: boolean;
  preview: boolean;
  sound: string;
};

export async function loadStoryNotifications(): Promise<StoryNotifications> {
  try {
    const settings = await rawScopeSettings('users');
    return {
      enabled: settings?.stories_muted !== true,
      preview: !settings?.stories_hide_sender,
      sound: soundToId(settings?.stories_other_sound)
    };
  } catch(err) {
    return {enabled: true, preview: true, sound: 'default'};
  }
}

export async function setStoryNotifications(patch: Partial<StoryNotifications>): Promise<void> {
  const {managers} = await bootTelegram();
  const current = await rawScopeSettings('users');
  const input = toInput(current);

  if(patch.enabled !== undefined) {
    if(patch.enabled) input.stories_muted = false;
    else input.stories_muted = true;
  }

  if(patch.preview !== undefined) {
    if(patch.preview) delete input.stories_hide_sender;
    else input.stories_hide_sender = true;
  }

  if(patch.sound !== undefined) {
    input.stories_other_sound = idToSound(patch.sound);
    input.stories_ios_sound = input.stories_other_sound;
    input.stories_android_sound = input.stories_other_sound;
  }

  await managers.appNotificationsManager.updateNotifySettings({_: 'inputNotifyUsers'} as any, input);
}

/* ------------------------------------------------------------------ */
/* Reactions                                                           */
/* ------------------------------------------------------------------ */

export type ReactionsFrom = 'off' | 'contacts' | 'all';

export type ReactionNotifications = {
  messages: ReactionsFrom;
  stories: ReactionsFrom;
  preview: boolean;
};

function fromToStr(from: any): ReactionsFrom {
  if(!from) return 'off';
  return from._ === 'reactionNotificationsFromAll' ? 'all' : 'contacts';
}

function strToFrom(value: ReactionsFrom): any {
  if(value === 'off') return undefined;
  return value === 'all' ?
    {_: 'reactionNotificationsFromAll'} :
    {_: 'reactionNotificationsFromContacts'};
}

export async function loadReactionNotifications(): Promise<ReactionNotifications> {
  try {
    const {managers} = await bootTelegram();
    const settings: any = await managers.appNotificationsManager.getReactionsNotifySettings();
    return {
      messages: fromToStr(settings?.messages_notify_from),
      stories: fromToStr(settings?.stories_notify_from),
      preview: !!settings?.show_previews
    };
  } catch(err) {
    return {messages: 'off', stories: 'off', preview: true};
  }
}

export async function setReactionNotifications(patch: Partial<ReactionNotifications>): Promise<void> {
  const {managers} = await bootTelegram();
  const current: any = await managers.appNotificationsManager.getReactionsNotifySettings();
  const next = {...await loadReactionNotifications(), ...patch};

  await managers.appNotificationsManager.setReactionsNotifySettings({
    _: 'reactionsNotifySettings',
    sound: current?.sound,
    show_previews: next.preview,
    messages_notify_from: strToFrom(next.messages),
    stories_notify_from: strToFrom(next.stories),
    poll_votes_notify_from: current?.poll_votes_notify_from
  } as any);
}

/* ------------------------------------------------------------------ */
/* Per-peer exceptions                                                 */
/* ------------------------------------------------------------------ */

export type NotifyException = {
  peerId: number;
  title: string;
  enabled: boolean;
  /** Unix seconds the mute runs until; `MUTE_FOREVER` for an endless one. */
  mutedUntil: number;
  preview: boolean;
  sound: string;
};

async function peerNotifySettings(peerId: number): Promise<any> {
  const {managers} = await bootTelegram();
  const peer = await managers.appPeersManager.getInputPeerById(peerId);
  return await managers.appNotificationsManager.getNotifySettings({_: 'inputNotifyPeer', peer} as any);
}

async function peerTitleOf(peerId: number): Promise<string> {
  try {
    const {managers} = await bootTelegram();
    const peer: any = await managers.appPeersManager.getPeer(peerId);
    if(!peer) return String(peerId);
    if(peer.title) return peer.title;
    return [peer.first_name, peer.last_name].filter(Boolean).join(' ') ||
      peer.username ||
      String(peerId);
  } catch(err) {
    return String(peerId);
  }
}

function toException(peerId: number, title: string, settings: any): NotifyException {
  return {
    peerId,
    title,
    enabled: !isMuted(settings),
    mutedUntil: settings?.mute_until ?? 0,
    preview: settings?.show_previews !== false,
    sound: soundToId(settings?.other_sound)
  };
}

/** Every chat with notification settings of its own. */
export async function loadNotifyExceptions(): Promise<NotifyException[]> {
  const {managers} = await bootTelegram();
  const peerIds: number[] = await (managers.appNotificationsManager as any).getNotifyExceptions({
    compareSound: true
  });

  const exceptions = await Promise.all(
    (peerIds ?? []).map(async(peerId) => toException(
      peerId,
      await peerTitleOf(peerId),
      await peerNotifySettings(peerId)
    ))
  );

  return exceptions.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Per-peer notification override — the entry point for the settings list, the
 * profile pane and the dialog menu alike.
 *
 * `muteFor` is a duration in seconds; `'forever'` mutes without end and `0`
 * unmutes. Omitting every field is a no-op, so pass at least one.
 */
export async function setPeerNotifications(peerId: number, options: {
  muteFor?: number | 'forever';
  preview?: boolean;
  sound?: string;
}): Promise<void> {
  const {managers} = await bootTelegram();
  const peer = await managers.appPeersManager.getInputPeerById(peerId);
  const input = toInput(await peerNotifySettings(peerId));

  if(options.muteFor !== undefined) {
    if(options.muteFor === 'forever') {
      input.mute_until = MUTE_FOREVER;
    } else if(options.muteFor > 0) {
      // A timed mute must expire on its own, so `silent` — which does not —
      // stays out of it.
      input.mute_until = Math.floor(Date.now() / 1000) + options.muteFor;
    } else {
      input.mute_until = 0;
      input.silent = false;
    }
  }

  if(options.preview !== undefined) input.show_previews = options.preview;
  if(options.sound !== undefined) {
    input.other_sound = idToSound(options.sound);
    input.ios_sound = input.other_sound;
    input.android_sound = input.other_sound;
  }

  await managers.appNotificationsManager.updateNotifySettings({_: 'inputNotifyPeer', peer} as any, input);
  peerPreview.delete(peerId);
}

/** Drop the override so the peer follows its scope's defaults again. */
export async function removePeerNotifications(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  const peer = await managers.appPeersManager.getInputPeerById(peerId);
  // An empty inputPeerNotifySettings carries no flags — that is how the API
  // spells "no exception for this peer".
  await managers.appNotificationsManager.updateNotifySettings(
    {_: 'inputNotifyPeer', peer} as any,
    {_: 'inputPeerNotifySettings'} as any
  );
  peerPreview.delete(peerId);
}

/** Mute durations offered next to an exception. */
export const MUTE_DURATIONS: {label: string; seconds: number | 'forever'}[] = [
  {label: '1 hour', seconds: 3600},
  {label: '8 hours', seconds: 8 * 3600},
  {label: '2 days', seconds: 2 * 86400},
  {label: 'Forever', seconds: 'forever'}
];

/* ------------------------------------------------------------------ */
/* Reset                                                               */
/* ------------------------------------------------------------------ */

/** Wipes exceptions and per-scope settings, server-side and locally. */
export async function resetNotificationSettings(): Promise<void> {
  const {managers} = await bootTelegram();
  await (managers.appNotificationsManager as any).resetNotifySettings();
  peerPreview.clear();
  prefsCache = {...DEFAULT_PREFS};
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch(err) {
    // Nothing to clear without storage.
  }

  await applyPushSettings();
}

/* ------------------------------------------------------------------ */
/* Wiring the settings into what actually gets shown                   */
/* ------------------------------------------------------------------ */

/** Effective `show_previews` per peer, for the synchronous notify path. */
const peerPreview = new Map<number, boolean>();

async function warmPeerPreview(peerId: number): Promise<void> {
  if(peerPreview.has(peerId)) return;
  try {
    const own = await peerNotifySettings(peerId);
    if(own?.show_previews !== undefined) {
      peerPreview.set(peerId, !!own.show_previews);
      return;
    }

    const {managers} = await bootTelegram();
    const isUser = peerId > 0;
    const scope: NotifyScope = isUser ?
      'users' :
      (await managers.appPeersManager.isBroadcast(peerId) ? 'channels' : 'groups');
    const settings = await rawScopeSettings(scope);
    peerPreview.set(peerId, settings?.show_previews !== false);
  } catch(err) {
    peerPreview.set(peerId, true);
  }
}

/**
 * Hand the current settings to the service worker. Without this the worker
 * phrases every push with the message text, whatever the account's "message
 * preview" settings say, and plays a sound the user turned off.
 */
export async function applyPushSettings(): Promise<void> {
  const {default: webPushApiManager} = await import('@lib/webPushApiManager');
  if(!webPushApiManager.isAvailable) return;

  const prefs = getLocalPrefs();
  let nopreview = false;
  try {
    const scopes = await Promise.all(
      (Object.keys(SCOPE_INPUT) as NotifyScope[]).map((scope) => loadScopeNotifications(scope))
    );
    // The worker has one flag for the whole account: only drop previews when
    // every scope the user can receive a push for asked for it.
    nopreview = scopes.every((scope) => !scope.preview);
  } catch(err) {
    // Settings we could not read must not silently strip previews.
  }

  webPushApiManager.setSettings({
    sound: prefs.inAppSounds,
    push: notificationsEnabled(),
    desktop: notificationsEnabled(),
    sentMessageSound: false,
    suggested: false,
    volume: prefs.inAppSounds ? 0.5 : 0,
    nopreview
  });
}
