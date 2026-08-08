/**
 * Desktop notifications for incoming messages.
 *
 * Deliberately not tied to tweb's own notification manager: that one drives the
 * legacy UI. This is a thin layer over the browser Notification API that the
 * chat view feeds, so it can respect what is currently on screen.
 */

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
  return granted;
}

export function disableNotifications() {
  localStorage.setItem(ENABLED_KEY, '0');
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
