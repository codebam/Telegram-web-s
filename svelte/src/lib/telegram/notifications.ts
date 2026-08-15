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
    // The worker phrases a push from these: without them it falls back to a
    // contentless "Telegram Web" notification.
    webPushApiManager.setSettings({
      sound: false,
      push: true,
      desktop: true,
      sentMessageSound: false,
      suggested: false,
      volume: 0.5
    });
  }

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

  try {
    const notification = new Notification(options.title, {
      body: options.body.slice(0, 200),
      icon: options.icon ?? '/icon-192.png',
      tag: `peer-${options.peerId}`,
      silent: false
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
