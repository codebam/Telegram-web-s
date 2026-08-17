/**
 * Appearance: chat wallpaper, peer name colours, message text size, bubble
 * spacing, power saving (tweb's liteMode) and the language pack.
 *
 * Everything here writes CSS custom properties on <html> — the same trick
 * theme.ts uses for the accent — so no component has to know a wallpaper
 * exists. `applyAppearance()` re-applies the whole stored set on boot.
 *
 * Two stores are in play on purpose:
 *  - purely local presentation (wallpaper choice, bubble spacing) lives in
 *    localStorage, next to the theme;
 *  - anything tweb already models (`settings.messagesTextSize`,
 *    `settings.liteMode`) is written through the Solid settings store, which
 *    persists it into the shared account state, so the Solid client and any
 *    other tab agree with us.
 */

import {bootTelegram} from './client';
import {isDarkTheme} from './theme';

const WALLPAPER_KEY = 'tweb-svelte:wallpaper';
const TEXT_SIZE_KEY = 'tweb-svelte:textSize';
const SPACING_KEY = 'tweb-svelte:spacing';

/* ------------------------------------------------------------------ */
/* Message text size and bubble spacing                                */
/* ------------------------------------------------------------------ */

export const MIN_TEXT_SIZE = 12;
export const MAX_TEXT_SIZE = 22;
export const DEFAULT_TEXT_SIZE = 15;

/** `roomy` is the current look; `compact` tightens gaps and bubble padding. */
export type BubbleSpacing = 'compact' | 'roomy';

export function getTextSize(): number {
  if(typeof localStorage === 'undefined') return DEFAULT_TEXT_SIZE;
  const stored = parseInt(localStorage.getItem(TEXT_SIZE_KEY) ?? '', 10);
  if(isNaN(stored)) return DEFAULT_TEXT_SIZE;
  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, stored));
}

export function setTextSize(size: number) {
  const clamped = Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(size)));
  localStorage.setItem(TEXT_SIZE_KEY, '' + clamped);
  applyTextSize(clamped);

  // Mirror into the shared state so tweb's own bubbles match.
  writeSetting('messagesTextSize', clamped);
}

export function applyTextSize(size: number = getTextSize()) {
  document.documentElement.style.setProperty('--message-text-size', `${size}px`);
}

export function getBubbleSpacing(): BubbleSpacing {
  if(typeof localStorage === 'undefined') return 'roomy';
  return localStorage.getItem(SPACING_KEY) === 'compact' ? 'compact' : 'roomy';
}

export function setBubbleSpacing(spacing: BubbleSpacing) {
  localStorage.setItem(SPACING_KEY, spacing);
  applyBubbleSpacing(spacing);
}

export function applyBubbleSpacing(spacing: BubbleSpacing = getBubbleSpacing()) {
  const root = document.documentElement;
  const compact = spacing === 'compact';
  root.style.setProperty('--bubble-gap', compact ? '3px' : '8px');
  root.style.setProperty('--bubble-padding', compact ? '4px 10px' : '8px 12px');
  root.style.setProperty('--bubble-inner-gap', compact ? '3px' : '6px');
  root.style.setProperty('--messages-padding', compact ? '10px 14px' : '18px');
}

/* ------------------------------------------------------------------ */
/* Wallpapers                                                          */
/* ------------------------------------------------------------------ */

export type WallpaperItem = {
  id: string;
  slug: string;
  /** Gradient stops, already hex. Empty for a plain photo wallpaper. */
  colors: string[];
  rotation: number;
  /** 0–100. Non-zero means the document is a pattern drawn over the gradient. */
  intensity: number;
  pattern: boolean;
  dark: boolean;
  hasFile: boolean;
};

export type WallpaperChoice = {
  kind: 'default' | 'wallpaper' | 'color' | 'custom';
  slug?: string;
  colors?: string[];
  rotation?: number;
  intensity?: number;
  pattern?: boolean;
  blur?: boolean;
  /** Custom uploads are kept as a downscaled data URL — see uploadWallpaper. */
  dataUrl?: string;
};

export const DEFAULT_WALLPAPER: WallpaperChoice = {kind: 'default'};

/** A few ready-made gradients so the colour tab is useful without the API. */
export const COLOR_PRESETS: {name: string; colors: string[]; rotation: number}[] = [
  {name: 'Dusk', colors: ['#3a2b6e', '#6e63ff'], rotation: 45},
  {name: 'Ember', colors: ['#8c2f2f', '#ff7a5c'], rotation: 45},
  {name: 'Moss', colors: ['#1f4d3a', '#3aa657'], rotation: 45},
  {name: 'Ink', colors: ['#0e0f1a', '#1d2033'], rotation: 0},
  {name: 'Paper', colors: ['#f3f1ea', '#dcd6c8'], rotation: 0},
  {name: 'Sea', colors: ['#0f5f7a', '#3390ec', '#0f9d8f', '#6e63ff'], rotation: 0}
];

export function getWallpaper(): WallpaperChoice {
  if(typeof localStorage === 'undefined') return DEFAULT_WALLPAPER;
  try {
    const parsed = JSON.parse(localStorage.getItem(WALLPAPER_KEY) ?? 'null');
    if(parsed && typeof parsed.kind === 'string') return parsed as WallpaperChoice;
  } catch(err) {}
  return DEFAULT_WALLPAPER;
}

export function setWallpaper(choice: WallpaperChoice): Promise<void> {
  try {
    localStorage.setItem(WALLPAPER_KEY, JSON.stringify(choice));
  } catch(err) {
    // A custom image can blow the quota; the wallpaper still applies for this
    // session, it just will not survive a reload.
    console.warn('[appearance] could not persist the wallpaper', err);
  }
  return applyWallpaper(choice);
}

/**
 * Builds the `--chat-wallpaper` background stack. Async because a pattern or a
 * photo has to be downloaded first; the gradient part paints immediately so the
 * chat never flashes an empty background while the file arrives.
 */
export async function applyWallpaper(choice: WallpaperChoice = getWallpaper()): Promise<void> {
  const root = document.documentElement;

  if(choice.kind === 'default') {
    root.style.removeProperty('--chat-wallpaper');
    root.removeAttribute('data-wallpaper');
    return;
  }

  root.setAttribute('data-wallpaper', 'on');

  const gradient = gradientCss(choice.colors ?? [], choice.rotation ?? 0);
  if(gradient) root.style.setProperty('--chat-wallpaper', gradient);

  if(choice.kind === 'custom') {
    if(choice.dataUrl) root.style.setProperty('--chat-wallpaper', `url("${choice.dataUrl}")`);
    return;
  }

  if(choice.kind === 'color' || !choice.slug) {
    if(!gradient) root.style.removeProperty('--chat-wallpaper');
    return;
  }

  const url = await wallpaperFileUrl(choice.slug, !choice.pattern && !!choice.blur)
  .catch((): null => null);
  if(!url) return;

  // The choice may have changed while the file downloaded.
  if(JSON.stringify(getWallpaper()) !== JSON.stringify(choice)) return;

  if(choice.pattern) {
    // A pattern is a mostly-transparent doodle sheet laid over the gradient at
    // the wallpaper's intensity. CSS cannot fade one background layer, so bake
    // the alpha into the image instead.
    const faded = await fadeImage(url, (choice.intensity ?? 40) / 100).catch(() => url);
    root.style.setProperty('--chat-wallpaper', [`url("${faded}")`, gradient].filter(Boolean).join(', '));
  } else {
    root.style.setProperty('--chat-wallpaper', `url("${url}")`);
  }
}

/** Colour stops → a CSS background. 3–4 stops approximate Telegram's freeform gradient. */
export function gradientCss(colors: string[], rotation = 0): string {
  if(!colors.length) return '';
  if(colors.length === 1) return `linear-gradient(${colors[0]}, ${colors[0]})`;
  if(colors.length === 2) return `linear-gradient(${rotation + 180}deg, ${colors[0]}, ${colors[1]})`;

  const spots = ['12% 18%', '88% 12%', '18% 88%', '85% 82%'];
  const layers = colors.slice(0, 4).map((color, index) =>
    `radial-gradient(90% 90% at ${spots[index]}, ${color}, transparent 72%)`);
  layers.push(`linear-gradient(${colors[0]}, ${colors[colors.length - 1]})`);
  return layers.join(', ');
}

/** Preview CSS for a picker tile — gradient only, no download. */
export function wallpaperPreviewCss(item: WallpaperItem): string {
  const gradient = gradientCss(item.colors, item.rotation);
  return gradient || 'var(--bg-elevated)';
}

const rawWallpapers = new Map<string, any>();

export async function loadWallpapers(): Promise<WallpaperItem[]> {
  const {managers} = await bootTelegram();
  const [wallPapers, {getHexColorFromTelegramColor}] = await Promise.all([
    managers.appThemesManager.getWallPapers(),
    import('@helpers/color')
  ]);

  return (wallPapers ?? []).map((wallPaper: any) => {
    const settings = wallPaper.settings ?? {};
    const colors = [
      settings.background_color,
      settings.second_background_color,
      settings.third_background_color,
      settings.fourth_background_color
    ]
    .filter((color: number) => typeof color === 'number')
    .map((color: number) => getHexColorFromTelegramColor(color));

    const item: WallpaperItem = {
      id: '' + wallPaper.id,
      slug: wallPaper.slug ?? '',
      colors,
      rotation: settings.rotation ?? 0,
      intensity: Math.abs(settings.intensity ?? 0),
      pattern: !!wallPaper.pFlags?.pattern,
      dark: !!wallPaper.pFlags?.dark,
      hasFile: !!wallPaper.document
    };

    rawWallpapers.set(item.id, wallPaper);
    return item;
  });
}

export function wallpaperChoiceOf(item: WallpaperItem, blur = false): WallpaperChoice {
  return {
    kind: 'wallpaper',
    slug: item.slug,
    colors: item.colors,
    rotation: item.rotation,
    intensity: item.intensity,
    pattern: item.pattern && item.hasFile,
    blur
  };
}

/**
 * Downloads (or reads from tweb's background cache) the wallpaper file. Blur is
 * done by the same helper the Solid client uses, so a blurred wallpaper is
 * cached separately and only computed once.
 */
async function wallpaperFileUrl(slug: string, blur: boolean): Promise<string | null> {
  const {managers} = await bootTelegram();
  const [{default: ChatBackgroundStore}, {default: appDownloadManager}] = await Promise.all([
    import('@lib/chatBackgroundStore'),
    import('@lib/appDownloadManager')
  ]);

  return ChatBackgroundStore.getBackground({
    slug,
    canDownload: true,
    blur,
    managers: managers as any,
    appDownloadManager
  });
}

/** Redraws `url` at `alpha`, returning a data URL. Used to fade a pattern. */
function fadeImage(url: string, alpha: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || 1000;
      canvas.height = image.naturalHeight || 1000;
      const context = canvas.getContext('2d');
      if(!context) {
        reject(new Error('no 2d context'));
        return;
      }

      context.globalAlpha = Math.min(1, Math.max(0.05, alpha));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch(err) {
        reject(err);
      }
    };
    image.onerror = () => reject(new Error('pattern failed to load'));
    image.src = url;
  });
}

/**
 * A custom wallpaper is downscaled and kept locally as a data URL: the account
 * copy would need `account.uploadWallPaper` *and* `account.saveWallPaper`, and
 * only the first is wrapped by a manager — see the note in the UI.
 */
export async function uploadWallpaper(file: File, blur: boolean): Promise<WallpaperChoice> {
  const dataUrl = await downscaleImage(file, 1920, blur ? 14 : 0);
  const choice: WallpaperChoice = {kind: 'custom', blur, dataUrl};
  await setWallpaper(choice);
  return choice;
}

function downscaleImage(file: File, maxSize: number, blurRadius: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if(!context) {
        reject(new Error('no 2d context'));
        return;
      }

      if(blurRadius) context.filter = `blur(${blurRadius}px)`;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('image failed to load'));
    };
    image.src = objectUrl;
  });
}

/* ------------------------------------------------------------------ */
/* Peer name colours                                                   */
/* ------------------------------------------------------------------ */

export type PeerColorOption = {
  /** `color_id` — the index a peer's `color.color` points at. */
  id: number;
  colors: string[];
  darkColors: string[];
  hidden: boolean;
};

let peerColorOptions: PeerColorOption[] | null = null;

export async function loadPeerColors(): Promise<PeerColorOption[]> {
  if(peerColorOptions) return peerColorOptions;

  const {managers} = await bootTelegram();
  const [result, {getHexColorFromTelegramColor}] = await Promise.all([
    managers.apiManager.getPeerColors(),
    import('@helpers/color')
  ]);

  const options = ((result as any)?.colors ?? []).map((option: any): PeerColorOption => ({
    id: option.color_id,
    colors: (option.colors?.colors ?? []).map((color: number) => getHexColorFromTelegramColor(color)),
    darkColors: (option.dark_colors?.colors ?? []).map((color: number) => getHexColorFromTelegramColor(color)),
    hidden: !!option.pFlags?.hidden
  })).filter((option: PeerColorOption) => option.colors.length || option.darkColors.length);

  peerColorOptions = options;
  return options;
}

/**
 * Publishes the palette as `--peer-N-color` / `--peer-N-colors` on <html>, the
 * way tweb's `setPeerColors` does, so a name or a reply strip only needs the
 * peer's colour index to paint itself.
 */
export async function applyPeerColors(): Promise<void> {
  const options = await loadPeerColors().catch((): PeerColorOption[] => []);
  const dark = isDarkTheme();
  const root = document.documentElement;

  for(const option of options) {
    const colors = (dark && option.darkColors.length ? option.darkColors : option.colors);
    if(!colors.length) continue;
    root.style.setProperty(`--peer-${option.id}-color`, colors[0]);
    root.style.setProperty(`--peer-${option.id}-colors`, colors.join(', '));
  }
}

/** Fallback palette, matching tweb's `DialogColorsFg` for ids 0–6. */
const FALLBACK_PEER_COLORS = [
  '#CC5049', '#D67722', '#955CDB', '#40A920', '#309EBA', '#368AD1', '#C7508B'
];

/** The palette index Telegram derives from a peer id when it has no own colour. */
export function peerColorIndex(peerId: number | string): number {
  return Math.abs(+peerId) % 7;
}

/** CSS colour for a peer's name — the var if the palette loaded, else the hash colour. */
export function peerNameColor(peerId: number | string, colorId?: number): string {
  const index = colorId ?? peerColorIndex(peerId);
  return `var(--peer-${index}-color, ${FALLBACK_PEER_COLORS[index % 7]})`;
}

export type OwnColorState = {
  colorId: number | null;
  backgroundEmojiId: string | null;
  isPremium: boolean;
};

export async function loadOwnColor(): Promise<OwnColorState> {
  const {managers} = await bootTelegram();
  const self: any = await managers.appUsersManager.getSelf();
  const color = self?.color;

  return {
    colorId: typeof color?.color === 'number' ? color.color : null,
    backgroundEmojiId: color?.background_emoji_id ? '' + color.background_emoji_id : null,
    isPremium: !!self?.pFlags?.premium
  };
}

/**
 * Sets our own name colour and the emoji drawn behind it. Both travel in one
 * `peerColor`, so passing `null` for either clears that half.
 */
export async function saveOwnColor(colorId: number | null, backgroundEmojiId: string | null): Promise<void> {
  const {managers} = await bootTelegram();

  if(colorId === null && !backgroundEmojiId) {
    await managers.appUsersManager.updateColor(undefined);
    return;
  }

  await managers.appUsersManager.updateColor({
    _: 'peerColor',
    color: colorId ?? undefined,
    background_emoji_id: backgroundEmojiId ?? undefined
  });
}

export type BackgroundEmoji = {
  docId: string;
  url: string | null;
};

/** The custom emoji Telegram offers as a name-colour pattern. */
export async function loadBackgroundEmojis(limit = 24): Promise<BackgroundEmoji[]> {
  const {managers} = await bootTelegram();
  const docIds = await managers.appEmojiManager.getDefaultBackgroundEmojis();
  if(!docIds?.length) return [];

  const docs = await managers.appEmojiManager.getCustomEmojiDocuments(docIds.slice(0, limit) as any);
  const {default: appDownloadManager} = await import('@lib/appDownloadManager');

  return Promise.all((docs ?? []).filter(Boolean).map(async(doc: any) => {
    // The static thumb is enough for a 32px tile — no Lottie pipeline needed.
    const url = await appDownloadManager
    .downloadMediaURL({media: doc, thumb: doc.thumbs?.[0]})
    .catch((): null => null);
    return {docId: '' + doc.id, url: url ?? null};
  }));
}

/* ------------------------------------------------------------------ */
/* Animations and power saving (tweb's liteMode)                       */
/* ------------------------------------------------------------------ */

/** A flag is `true` when the effect is *disabled* — same polarity as tweb. */
export type LiteModeFlags = Record<string, boolean>;

export const LITE_MODE_KEYS: {key: string; label: string; description: string}[] = [
  {key: 'stickers_chat', label: 'Animated stickers in chat', description: 'Play .tgs and WebM stickers in the message list'},
  {key: 'stickers_panel', label: 'Animated stickers in the picker', description: 'Play stickers while browsing the panel'},
  {key: 'emoji_messages', label: 'Animated emoji in messages', description: 'Custom and animated emoji inside bubbles'},
  {key: 'emoji_panel', label: 'Animated emoji in the picker', description: 'Custom emoji while browsing the panel'},
  {key: 'effects_reactions', label: 'Reaction effects', description: 'The burst played when a reaction lands'},
  {key: 'effects_premiumstickers', label: 'Premium sticker effects', description: 'The extra animation on premium stickers'},
  {key: 'gif', label: 'Autoplay GIFs', description: 'Loop GIFs without a tap'},
  {key: 'video', label: 'Autoplay videos', description: 'Start round videos and previews automatically'},
  {key: 'chat_background', label: 'Wallpaper motion', description: 'Animate the wallpaper gradient as messages are sent'},
  {key: 'blur', label: 'Background blur', description: 'The frosted-glass blur behind panes'}
];

async function settingsStore() {
  await bootTelegram();
  return import('@stores/appSettings');
}

async function writeSetting(...args: any[]) {
  try {
    const {setAppSettings} = await settingsStore();
    await (setAppSettings as any)(...args);
  } catch(err) {
    console.warn('[appearance] could not persist a setting', args[0], err);
  }
}

export async function loadLiteMode(): Promise<LiteModeFlags> {
  const {appSettings} = await settingsStore();
  return {...((appSettings as any).liteMode ?? {})};
}

export async function setLiteModeFlag(key: string, disabled: boolean): Promise<void> {
  await writeSetting('liteMode', key, disabled);
  if(key === 'all' || key === 'animations' || key === 'blur') applyMotionPreference();
}

/**
 * The Svelte components do not consult `liteMode` themselves, so the two flags
 * that are purely visual are mirrored onto <html> and switched off in CSS.
 */
export async function applyMotionPreference(): Promise<void> {
  const flags = await loadLiteMode().catch((): LiteModeFlags => ({}));
  const root = document.documentElement;
  const noAnimations = !!(flags.all || flags.animations);
  const noBlur = !!(flags.all || flags.blur);

  if(noAnimations) root.setAttribute('data-lite-animations', 'off');
  else root.removeAttribute('data-lite-animations');

  if(noBlur) root.setAttribute('data-lite-blur', 'off');
  else root.removeAttribute('data-lite-blur');
}

/* ------------------------------------------------------------------ */
/* Language                                                            */
/* ------------------------------------------------------------------ */

export type LanguageItem = {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
  official: boolean;
  translated: number;
  total: number;
};

export async function loadLanguages(): Promise<LanguageItem[]> {
  const {managers} = await bootTelegram();
  const languages = await managers.appLangPackManager.getLanguages('web');

  return (languages ?? []).map((language: any): LanguageItem => ({
    code: language.lang_code,
    name: language.name ?? language.lang_code,
    nativeName: language.native_name ?? '',
    rtl: !!language.pFlags?.rtl,
    official: !!language.pFlags?.official,
    translated: language.translated_count ?? 0,
    total: language.strings_count ?? 0
  }));
}

export async function currentLanguage(): Promise<string> {
  await bootTelegram();
  const {default: I18n} = await import('@lib/langPack');
  const langPack = await I18n.getCacheLangPackAndApply();
  return langPack?.lang_code ?? I18n.getLastRequestedLangCode();
}

/**
 * Switches the lang pack. This drives tweb's `I18n` layer — anything the shared
 * stack renders (dates, plurals, service-message strings it builds itself) and
 * the RTL direction. Web S's own labels are hardcoded English, so the visible
 * effect in this client is limited; see the note in Settings → Appearance.
 */
export async function setLanguage(code: string): Promise<void> {
  await bootTelegram();
  const {default: I18n} = await import('@lib/langPack');
  await I18n.getLangPackAndApply(code, true);
  document.documentElement.lang = code;
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/** Re-applies everything stored. Called once, next to applyTheme(). */
export function applyAppearance(): void {
  // Marks the document as carrying appearance overrides — app.css hangs the
  // rules off it so they outrank the components' own scoped styles.
  document.documentElement.setAttribute('data-appearance', 'on');
  applyTextSize();
  applyBubbleSpacing();
  applyWallpaper().catch(() => {});
  applyPeerColors().catch(() => {});
  applyMotionPreference().catch(() => {});
}
