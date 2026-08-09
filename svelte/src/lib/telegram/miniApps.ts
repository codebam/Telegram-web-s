import {bootTelegram} from './client';

/**
 * Bot mini apps (Telegram Web Apps).
 *
 * Two halves live here: opening a session against the API (`requestWebView`
 * and friends) and the small pieces of state the host component needs to keep
 * the iframe alive. The postMessage bridge itself is in MiniApp.svelte, since
 * it is tied to the iframe element's lifetime.
 */

export type MiniAppRequest = {
  botId: number;
  peerId: number;
  /** Set for keyboardButtonWebView / switch_webview, which carry their own URL. */
  url?: string;
  startParam?: string;
  buttonText?: string;
  title?: string;
  /** messages.requestSimpleWebView — no chat context, cannot send data back. */
  isSimpleWebView?: boolean;
  fromSwitchWebView?: boolean;
  fromBotMenu?: boolean;
  fromAttachMenu?: boolean;
  /** messages.requestMainWebView — the bot's "main" app. */
  main?: boolean;
};

export type MiniAppSession = {
  url: string;
  queryId: string;
};

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export type ThemeParams = Record<string, string>;

/** `rgb()`, `rgba()` and `#rgb` all become `#rrggbb` — mini apps only parse hex. */
function toHex(value: string): string {
  const color = value.trim();
  if(!color) return '';

  if(color[0] === '#') {
    if(color.length === 4) {
      return '#' + color.slice(1).split('').map((c) => c + c).join('');
    }

    return color.length >= 7 ? color.slice(0, 7) : '';
  }

  const match = color.match(/rgba?\(([^)]+)\)/);
  if(!match) return '';

  const parts = match[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  if(parts.length < 3) return '';

  return '#' + parts
  .map((part) => Math.max(0, Math.min(255, Math.round(parseFloat(part)))).toString(16).padStart(2, '0'))
  .join('');
}

/** Maps the app's CSS variables onto the theme keys mini apps expect. */
export function themeParams(): ThemeParams {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => toHex(styles.getPropertyValue(name)) || fallback;

  const bg = read('--bg-solid', '#14161f');
  const secondary = read('--bg', '#0e0f1a');
  const text = read('--text', '#f0f1f8');
  const hint = read('--text-dim', '#9ba0bb');
  const accent = read('--accent', '#6e63ff');
  const danger = read('--danger', '#e5484d');

  return {
    bg_color: bg,
    text_color: text,
    hint_color: hint,
    link_color: accent,
    button_color: accent,
    button_text_color: '#ffffff',
    secondary_bg_color: secondary,
    header_bg_color: bg,
    bottom_bar_bg_color: bg,
    accent_text_color: accent,
    section_bg_color: bg,
    section_header_text_color: accent,
    section_separator_color: hint,
    subtitle_text_color: hint,
    destructive_text_color: danger
  };
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/**
 * Opens a mini app session. The URL that comes back already carries the
 * `#tgWebAppData=…` fragment the bot's page reads, so it goes into the iframe
 * as-is apart from the version bump below.
 */
export async function requestWebView(request: MiniAppRequest): Promise<MiniAppSession> {
  const {managers} = await bootTelegram();

  const result: any = await managers.appAttachMenuBotsManager.requestWebView({
    botId: request.botId,
    peerId: request.peerId,
    url: request.url,
    startParam: request.startParam,
    isSimpleWebView: request.isSimpleWebView,
    fromSwitchWebView: request.fromSwitchWebView,
    fromBotMenu: request.fromBotMenu,
    fromAttachMenu: request.fromAttachMenu,
    main: request.main,
    themeParams: {_: 'dataJSON', data: JSON.stringify(themeParams())}
  } as any);

  const url: string = result?.url ?? '';
  if(!url) throw new Error('The bot did not return a mini app URL');

  return {
    // The bridge below implements 9.0 events; the server still advertises 8.0.
    url: url.replace('tgWebAppVersion=8.0', 'tgWebAppVersion=9.0'),
    queryId: result?.query_id ? '' + result.query_id : ''
  };
}

/** Keeps a `query_id` valid so the bot can still answer the session. */
export async function prolongWebView(peerId: number, botId: number, queryId: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appAttachMenuBotsManager.prolongWebView({peerId, botId, queryId} as any);
}

/** `web_app_data_send` — the bot receives the payload as a service message. */
export async function sendWebViewData(botId: number, buttonText: string, data: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appAttachMenuBotsManager.sendWebViewData(botId, buttonText, data);
}

export async function allowBotSendMessage(botId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appBotsManager.allowSendMessage(botId);
}

export async function invokeWebViewCustomMethod(
  botId: number,
  method: string,
  params: any
): Promise<{result?: any; error?: string}> {
  const {managers} = await bootTelegram();
  try {
    const result: any = await managers.appAttachMenuBotsManager.invokeWebViewCustomMethod(
      botId,
      method,
      params
    );
    return {result: result?.data ? JSON.parse(result.data) : undefined};
  } catch(err: any) {
    return {error: err?.type || err?.message || 'UNKNOWN_ERROR'};
  }
}

/* ------------------------------------------------------------------ */
/* DeviceStorage                                                       */
/* ------------------------------------------------------------------ */

export async function readDeviceStorage(botId: number, key: string): Promise<string | null> {
  const {managers} = await bootTelegram();
  return managers.appBotsManager.readBotDeviceStorage(botId, key);
}

export async function writeDeviceStorage(
  botId: number,
  key: string,
  value: string | null
): Promise<string | null> {
  const {managers} = await bootTelegram();
  return managers.appBotsManager.writeBotDeviceStorage(botId, key, value);
}

export async function clearDeviceStorage(botId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appBotsManager.clearBotDeviceStorage(botId);
}

/* ------------------------------------------------------------------ */
/* Bot menu button                                                     */
/* ------------------------------------------------------------------ */

export type BotMenuButton = {text: string; url: string};

/**
 * The web-app button a bot pins next to the composer (`botMenuButton`).
 * Fetched lazily after the chat renders — never on the chat-open path.
 */
export async function getBotMenuButton(peerId: number): Promise<BotMenuButton | null> {
  if(peerId <= 0) return null;

  const {managers} = await bootTelegram();
  try {
    const isBot = await managers.appPeersManager.isBot(peerId);
    if(!isBot) return null;

    const full: any = await managers.appProfileManager.getProfile(peerId);
    const button = full?.bot_info?.menu_button;
    if(button?._ !== 'botMenuButton') return null;

    return {text: button.text || 'Open app', url: button.url || ''};
  } catch(err) {
    return null;
  }
}
