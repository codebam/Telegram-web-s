import {bootTelegram} from './client';
import {getPeerBrief} from './chats';

/**
 * Bot-facing pieces of the composer: reply keyboards, inline-keyboard button
 * behaviour that needs the network, the bot command list, `@`/`#` autocomplete
 * sources and the start/stop affordances of a bot chat.
 *
 * Same hard rule as `chats.ts`: everything returned from here is plain and
 * structured-cloneable, never a raw MTProto object.
 */

/** One row of the composer's `/`, `@` or `#` autocomplete strip. */
export type SuggestionItem = {key: string; title: string; subtitle: string};

/* ------------------------------------------------------------------ */
/* Reply keyboards                                                     */
/* ------------------------------------------------------------------ */

export type ReplyKeyboardButton = {
  row: number;
  column: number;
  kind: 'text' | 'requestPhone' | 'requestGeo' | 'requestPoll' | 'webview' | 'simpleWebView' | 'unsupported';
  text: string;
  /** Web-app buttons carry their own URL. */
  url: string;
};

export type ReplyKeyboardState = {
  /**
   * `markup` — a keyboard to show, `hide` — the bot took it away, `forceReply`
   * — the bot wants the next message to be a reply, `none` — nothing was ever
   * attached in this chat.
   */
  kind: 'none' | 'markup' | 'hide' | 'forceReply';
  rows: ReplyKeyboardButton[][];
  /** Shrink the buttons to their content instead of filling the pane. */
  resize: boolean;
  /** Collapse the keyboard again as soon as one button is pressed. */
  singleUse: boolean;
  /** The bot asks the keyboard to stay open rather than auto-hide. */
  persistent: boolean;
  /** Composer placeholder the bot suggests, '' when it suggests none. */
  placeholder: string;
  /** Message the markup came with — the reply target for `forceReply`. */
  mid: number;
};

const EMPTY_KEYBOARD: ReplyKeyboardState = {
  kind: 'none',
  rows: [],
  resize: false,
  singleUse: false,
  persistent: false,
  placeholder: '',
  mid: 0
};

/** The keyboard tweb has merged for this chat, flattened for the UI. */
export async function getReplyKeyboard(peerId: number): Promise<ReplyKeyboardState> {
  const {managers} = await bootTelegram();
  const markup: any = await managers.appMessagesManager.getReplyKeyboard(peerId);
  if(!markup) return EMPTY_KEYBOARD;

  const flags = markup.pFlags ?? {};
  const base = {
    rows: [] as ReplyKeyboardButton[][],
    resize: !!flags.resize,
    singleUse: !!flags.single_use,
    persistent: !!flags.persistent,
    placeholder: markup.placeholder ?? '',
    mid: markup.mid ?? 0
  };

  if(markup._ === 'replyKeyboardForceReply') {
    // A force-reply the user already dismissed must not keep re-arming itself.
    return {...base, kind: flags.hidden ? 'hide' : 'forceReply'};
  }

  if(markup._ !== 'replyKeyboardMarkup') return {...base, kind: 'hide'};

  base.rows = (markup.rows ?? [])
  .map((row: any, rowIndex: number) =>
    (row.buttons ?? []).map((button: any, column: number) => toReplyButton(button, rowIndex, column))
  )
  .filter((row: ReplyKeyboardButton[]) => row.length);

  return {...base, kind: base.rows.length ? 'markup' : 'hide'};
}

function toReplyButton(button: any, row: number, column: number): ReplyKeyboardButton {
  const base = {row, column, text: button.text ?? '', url: ''};

  switch(button._) {
    case 'keyboardButton':
      return {...base, kind: 'text'};
    case 'keyboardButtonRequestPhone':
      return {...base, kind: 'requestPhone'};
    case 'keyboardButtonRequestGeoLocation':
      return {...base, kind: 'requestGeo'};
    case 'keyboardButtonRequestPoll':
      return {...base, kind: 'requestPoll'};
    case 'keyboardButtonWebView':
      return {...base, kind: 'webview', url: button.url ?? ''};
    case 'keyboardButtonSimpleWebView':
      return {...base, kind: 'simpleWebView', url: button.url ?? ''};
    default:
      return {...base, kind: 'unsupported'};
  }
}

/** Fires when a bot attaches, replaces or removes a chat's reply keyboard. */
export async function onReplyKeyboardChange(
  callback: (peerId: number) => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  const handler = ({peerId}: {peerId: number}) => callback(Number(peerId));
  rootScope.addEventListener('history_reply_markup', handler as any);
  return () => rootScope.removeEventListener('history_reply_markup', handler as any);
}

/* ------------------------------------------------------------------ */
/* Inline keyboard buttons that need the network                       */
/* ------------------------------------------------------------------ */

/** Domains Telegram opens without asking — its own and the ones it signs into. */
const TRUSTED_HOSTS = ['t.me', 'telegram.org', 'telegram.me', 'telegra.ph', 'fragment.com'];

/**
 * Whether pressing a bot's link button should ask first. Bots can label a
 * button anything, so anywhere outside Telegram gets a confirmation carrying
 * the real destination.
 */
export function needsUrlConfirmation(url: string): boolean {
  const host = hostOf(url);
  if(!host) return true;
  return !TRUSTED_HOSTS.some((trusted) => host === trusted || host.endsWith('.' + trusted));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch(err) {
    return '';
  }
}

export type UrlAuthPrompt = {
  /** Nothing to confirm — just open `url`. */
  kind: 'open' | 'auth';
  url: string;
  /** Bot asking for the login, '' when there is none. */
  botTitle: string;
  /** The bot additionally wants permission to message the user. */
  requestWriteAccess: boolean;
};

/**
 * First half of a `keyboardButtonUrlAuth` press: asks the server what the
 * button actually does. Anything but a login request degrades to a plain open.
 */
export async function requestUrlAuth(
  peerId: number,
  mid: number,
  buttonId: number,
  url: string
): Promise<UrlAuthPrompt> {
  const {managers} = await bootTelegram();
  const fallback: UrlAuthPrompt = {kind: 'open', url, botTitle: '', requestWriteAccess: false};

  try {
    const result: any = await managers.appSeamlessLoginManager.requestUrlAuth(url, peerId, mid, buttonId);
    if(result?._ === 'urlAuthResultAccepted') return {...fallback, url: result.url ?? url};
    if(result?._ !== 'urlAuthResultRequest') return fallback;

    const botId = Number(result.bot?.id ?? 0);
    return {
      kind: 'auth',
      url,
      botTitle: botId ? (await getPeerBrief(botId)).title : '',
      requestWriteAccess: !!result.pFlags?.request_write_access
    };
  } catch(err) {
    return fallback;
  }
}

/** Second half: the user said yes, so hand the login to the bot and open it. */
export async function acceptUrlAuth(
  peerId: number,
  mid: number,
  buttonId: number,
  url: string,
  writeAllowed: boolean
): Promise<string> {
  const {managers} = await bootTelegram();
  try {
    const result: any = await managers.appSeamlessLoginManager.acceptUrlAuth(
      url,
      peerId,
      mid,
      buttonId,
      writeAllowed
    );
    return result?.url ?? url;
  } catch(err) {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/* Bot commands                                                        */
/* ------------------------------------------------------------------ */

export type BotCommandItem = {
  /** The bot that owns the command. */
  botId: number;
  /** Command without the leading slash. */
  command: string;
  description: string;
  /** '@username' suffix a group needs to address the right bot, '' in a 1:1. */
  suffix: string;
};

/**
 * Every command the peer exposes: one bot in a private chat, potentially
 * several in a group. Cached by the profile manager, so re-asking is cheap.
 */
export async function loadBotCommands(peerId: number): Promise<BotCommandItem[]> {
  const {managers} = await bootTelegram();

  const isGroup = peerId < 0;
  if(!isGroup && !(await managers.appUsersManager.isBot(peerId))) return [];

  let full: any;
  try {
    full = await managers.appProfileManager.getProfileByPeerId(peerId);
  } catch(err) {
    return [];
  }

  const botInfo = full?.bot_info;
  const infos: any[] = botInfo ? (Array.isArray(botInfo) ? botInfo : [botInfo]) : [];

  const out: BotCommandItem[] = [];
  for(const info of infos) {
    if(!info?.commands?.length) continue;

    const botId = Number(info.user_id ?? (peerId > 0 ? peerId : 0));
    // In a group the same command can belong to several bots, so it has to be
    // addressed — exactly what tweb's commands helper appends.
    const suffix = isGroup && botId ? '@' + ((await getPeerBrief(botId)).username || '') : '';

    for(const command of info.commands) {
      out.push({
        botId,
        command: command.command ?? '',
        description: command.description ?? '',
        suffix: suffix === '@' ? '' : suffix
      });
    }
  }

  return out;
}

/** Prefix match on the command name, the way the other clients filter. */
export function filterBotCommands(commands: BotCommandItem[], query: string): BotCommandItem[] {
  const needle = query.replace(/^\//, '').toLowerCase();
  if(!needle) return commands;
  return commands.filter((item) => item.command.toLowerCase().startsWith(needle));
}

/* ------------------------------------------------------------------ */
/* Mention and hashtag autocomplete                                    */
/* ------------------------------------------------------------------ */

export type MentionItem = {peerId: number; title: string; username: string};

/**
 * Members (and, in a private chat, top peers) matching an `@` query. The
 * manager already ranks them, so the order arrives usable.
 */
export async function searchMentions(
  peerId: number,
  query: string,
  threadId?: number,
  limit = 12
): Promise<MentionItem[]> {
  const {managers} = await bootTelegram();

  let peerIds: any[];
  try {
    peerIds = await managers.appProfileManager.getMentions(
      peerId < 0 ? Math.abs(peerId) : 0,
      query,
      threadId
    );
  } catch(err) {
    return [];
  }

  const out: MentionItem[] = [];
  for(const id of (peerIds ?? []).slice(0, limit)) {
    const brief = await getPeerBrief(Number(id));
    if(brief.isSelf) continue;
    out.push({peerId: Number(id), title: brief.title, username: brief.username});
  }

  return out;
}

const RECENT_HASHTAGS_KEY = 'webs_recent_hashtags';
const HASHTAG_RE = /#([\wЀ-ӿ]{1,64})/g;

function readRecentHashtags(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_HASHTAGS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : [];
  } catch(err) {
    return [];
  }
}

/**
 * Remember the hashtags of a message the user sent. There is no server-side
 * recent-hashtag list in this stack, so the composer keeps its own.
 */
export function rememberHashtags(text: string): void {
  const found = hashtagsIn(text);
  if(!found.length) return;

  const merged = [...found, ...readRecentHashtags()];
  const unique = Array.from(new Set(merged)).slice(0, 40);
  try {
    localStorage.setItem(RECENT_HASHTAGS_KEY, JSON.stringify(unique));
  } catch(err) {
    // Storage can be full or blocked; the suggestions are not worth failing on.
  }
}

export function hashtagsIn(text: string): string[] {
  const out: string[] = [];
  for(const match of text.matchAll(HASHTAG_RE)) out.push(match[1]);
  return out;
}

/**
 * Hashtags for a `#` query: what the user typed before, plus whatever the
 * visible history mentions, so a fresh chat still suggests something.
 */
export function searchHashtags(query: string, fromTexts: string[] = [], limit = 12): string[] {
  const needle = query.replace(/^#/, '').toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];

  const consider = (tag: string) => {
    const key = tag.toLowerCase();
    if(seen.has(key) || !key.startsWith(needle)) return;
    seen.add(key);
    if(out.length < limit) out.push(tag);
  };

  readRecentHashtags().forEach(consider);
  for(const text of fromTexts) hashtagsIn(text).forEach(consider);

  return out;
}

/* ------------------------------------------------------------------ */
/* Start / stop a bot                                                  */
/* ------------------------------------------------------------------ */

export type BotChatState = {
  isBot: boolean;
  /** The bot is blocked — the composer shows Restart instead of a text box. */
  blocked: boolean;
  /** Nothing has been said yet, so the chat opens on a START button. */
  fresh: boolean;
  /** The bot publishes a command list, so the composer earns its menu button. */
  hasCommands: boolean;
};

export async function getBotChatState(peerId: number, hasMessages: boolean): Promise<BotChatState> {
  const idle: BotChatState = {isBot: false, blocked: false, fresh: false, hasCommands: false};
  if(peerId <= 0) return idle;

  const {managers} = await bootTelegram();
  if(!(await managers.appUsersManager.isBot(peerId))) return idle;

  const [blocked, commands] = await Promise.all([
    managers.appProfileManager.isUserBlocked(peerId).catch(() => false),
    loadBotCommands(peerId)
  ]);

  return {
    isBot: true,
    blocked: !!blocked,
    fresh: !hasMessages,
    hasCommands: commands.length > 0
  };
}

/** START / Restart: unblock the bot and send it `/start`. */
export async function startBot(botId: number, startParam?: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.startBot(botId, undefined, startParam);
}

/** Block the bot so it stops writing; unblocking is how Restart begins. */
export async function setBotBlocked(botId: number, blocked: boolean): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appUsersManager.toggleBlock(botId, blocked);
}

/** Empty the conversation but keep the chat, like Web K's "Clear history". */
export async function clearBotHistory(peerId: number): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appMessagesManager.flushHistory({peerId, justClear: true, revoke: false});
}
