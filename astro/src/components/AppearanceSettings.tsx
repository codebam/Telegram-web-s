/*
 * Settings → Appearance: theme (including an auto-night schedule), accent,
 * wallpaper, peer name colour, text size, bubble spacing, power saving and
 * the language pack. Everything it changes is applied through
 * $lib/telegram/appearance, which writes CSS variables on <html>.
 *
 * Ported from svelte/src/lib/components/AppearanceSettings.svelte. The `$effect`
 * that loads a tab's data the first time the tab is opened is a
 * `useSignalEffect` here — it reads the `panel` signal, and that is the hook
 * which tracks signal reads. The `$derived` values become `useComputed` for the
 * same reason, and every read/write of a rune gains a `.value`.
 */
import {Fragment} from 'preact';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {
  ACCENTS,
  getAccent,
  getDensity,
  getNightSchedule,
  getThemeMode,
  minutesToTime,
  setAccent,
  setDensity,
  setNightSchedule,
  setThemeMode,
  timeToMinutes,
  type Density,
  type NightSchedule,
  type ThemeMode
} from '$lib/telegram/theme';
import {
  COLOR_PRESETS,
  DEFAULT_WALLPAPER,
  LITE_MODE_KEYS,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  currentLanguage,
  getBubbleSpacing,
  getTextSize,
  getWallpaper,
  loadBackgroundEmojis,
  loadLanguages,
  loadLiteMode,
  loadOwnColor,
  loadPeerColors,
  loadWallpapers,
  peerNameColor,
  saveOwnColor,
  setBubbleSpacing,
  setLanguage,
  setLiteModeFlag,
  setTextSize,
  setWallpaper,
  uploadWallpaper,
  wallpaperChoiceOf,
  wallpaperPreviewCss,
  type BackgroundEmoji,
  type BubbleSpacing,
  type LanguageItem,
  type LiteModeFlags,
  type OwnColorState,
  type PeerColorOption,
  type WallpaperChoice,
  type WallpaperItem
} from '$lib/telegram/appearance';

import './AppearanceSettings.css';

type Panel = 'theme' | 'wallpaper' | 'colors' | 'motion' | 'language';

// The literal lists the markup iterated over inline. They are typed here so the
// `as Panel` / `as ThemeMode` casts the original carried at each `onclick` drop
// away — the values are already the right union.
const PANEL_TABS: [Panel, string][] = [
  ['theme', 'Theme'],
  ['wallpaper', 'Wallpaper'],
  ['colors', 'Colours'],
  ['motion', 'Animations'],
  ['language', 'Language']
];
const THEME_MODES: ThemeMode[] = ['system', 'light', 'dark', 'schedule'];
const SPACINGS: BubbleSpacing[] = ['roomy', 'compact'];
const DENSITIES: Density[] = ['comfortable', 'console'];

export function AppearanceSettings() {
  const panel = useSignal<Panel>('theme');

  const theme = useSignal<ThemeMode>(getThemeMode());
  const schedule = useSignal<NightSchedule>(getNightSchedule());
  const accent = useSignal(getAccent());
  const density = useSignal<Density>(getDensity());
  const textSize = useSignal(getTextSize());
  const spacing = useSignal<BubbleSpacing>(getBubbleSpacing());

  const wallpapers = useSignal<WallpaperItem[]>([]);
  const wallpaper = useSignal<WallpaperChoice>(getWallpaper());
  const wallpaperBusy = useSignal(false);

  const palette = useSignal<PeerColorOption[]>([]);
  const ownColor = useSignal<OwnColorState | null>(null);
  const backgroundEmojis = useSignal<BackgroundEmoji[]>([]);

  const lite = useSignal<LiteModeFlags>({});
  const languages = useSignal<LanguageItem[]>([]);
  const langCode = useSignal('');
  const languageFilter = useSignal('');

  const error = useSignal('');
  const status = useSignal('');

  function flash(message: string) {
    status.value = message;
    setTimeout(() => (status.value = ''), 2500);
  }

  function fail(err: any, fallback: string) {
    error.value = err?.type || err?.message || fallback;
  }

  // Each tab loads its data on first open and caches it in its own signal. The
  // effect reads `panel`, so it re-runs on every tab switch; the emptiness
  // guards are what keep the caches from reloading.
  useSignalEffect(() => {
    const current = panel.value;
    error.value = '';

    (async() => {
      try {
        if(current === 'wallpaper' && !wallpapers.value.length) {
          wallpapers.value = await loadWallpapers();
        } else if(current === 'colors' && !palette.value.length) {
          const [nextPalette, nextOwnColor] = await Promise.all([loadPeerColors(), loadOwnColor()]);
          palette.value = nextPalette;
          ownColor.value = nextOwnColor;
          backgroundEmojis.value = await loadBackgroundEmojis().catch(() => []);
        } else if(current === 'motion' && !Object.keys(lite.value).length) {
          lite.value = await loadLiteMode();
        } else if(current === 'language' && !languages.value.length) {
          const [nextLanguages, nextCode] = await Promise.all([loadLanguages(), currentLanguage()]);
          languages.value = nextLanguages;
          langCode.value = nextCode;
        }
      } catch(err: any) {
        fail(err, 'Failed to load');
      }
    })();
  });

  const wallpaperColors = useComputed(() => wallpaper.value.colors ?? []);

  const filteredLanguages = useComputed(() =>
    languageFilter.value.trim()
      ? languages.value.filter((language) => {
          const needle = languageFilter.value.trim().toLowerCase();
          return (
            language.name.toLowerCase().includes(needle) ||
            language.nativeName.toLowerCase().includes(needle) ||
            language.code.toLowerCase().includes(needle)
          );
        })
      : languages.value
  );

  const animationsOn = useComputed(() => !(lite.value.all || lite.value.animations));

  async function pickWallpaper(choice: WallpaperChoice) {
    wallpaperBusy.value = true;
    try {
      wallpaper.value = choice;
      await setWallpaper(choice);
    } catch(err: any) {
      fail(err, 'Failed to apply the wallpaper');
    } finally {
      wallpaperBusy.value = false;
    }
  }

  async function toggleBlur() {
    await pickWallpaper({...wallpaper.value, blur: !wallpaper.value.blur});
  }

  async function changeIntensity(value: number) {
    await pickWallpaper({...wallpaper.value, intensity: value});
  }

  async function onUpload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if(!file) return;

    wallpaperBusy.value = true;
    try {
      wallpaper.value = await uploadWallpaper(file, !!wallpaper.value.blur);
      flash('Wallpaper set');
    } catch(err: any) {
      fail(err, 'Failed to read the image');
    } finally {
      wallpaperBusy.value = false;
    }
  }

  async function pickOwnColor(colorId: number | null) {
    if(!ownColor.value) return;
    const previous = ownColor.value;
    ownColor.value = {...ownColor.value, colorId};
    try {
      await saveOwnColor(colorId, ownColor.value.backgroundEmojiId);
      flash('Name colour saved');
    } catch(err: any) {
      ownColor.value = previous;
      fail(err, 'Failed to save the colour');
    }
  }

  async function pickBackgroundEmoji(docId: string | null) {
    if(!ownColor.value) return;
    const previous = ownColor.value;
    ownColor.value = {...ownColor.value, backgroundEmojiId: docId};
    try {
      await saveOwnColor(ownColor.value.colorId, docId);
      flash(docId ? 'Pattern saved' : 'Pattern removed');
    } catch(err: any) {
      ownColor.value = previous;
      fail(err, 'Failed to save the pattern');
    }
  }

  async function toggleLite(key: string, disabled: boolean) {
    lite.value = {...lite.value, [key]: disabled};
    try {
      await setLiteModeFlag(key, disabled);
    } catch(err: any) {
      lite.value = {...lite.value, [key]: !disabled};
      fail(err, 'Failed to save');
    }
  }

  async function pickLanguage(code: string) {
    const previous = langCode.value;
    langCode.value = code;
    try {
      await setLanguage(code);
      flash('Language pack applied');
    } catch(err: any) {
      langCode.value = previous;
      fail(err, 'Failed to switch the language');
    }
  }

  // The `{#if} {:else if} … {:else}` chain that picked the open tab's body,
  // resolved before the single return.
  let body: preact.JSX.Element;

  if(panel.value === 'theme') {
    body = (
      <>
        <p class="label">Theme</p>
        <div class="chips">
          {THEME_MODES.map((mode, i) => (
            <button
              key={i}
              class={theme.value === mode ? 'on' : ''}
              onClick={() => {
                theme.value = mode;
                setThemeMode(theme.value);
              }}>{mode === 'schedule' ? 'auto night' : mode}</button>
          ))}
        </div>

        {theme.value === 'schedule' && (
          <>
            <div class="row">
              <label class="field">
                <span>Dark from</span>
                <input
                  type="time"
                  value={minutesToTime(schedule.value.from)}
                  onChange={(e) => {
                    schedule.value = {...schedule.value, from: timeToMinutes((e.target as HTMLInputElement).value)};
                    setNightSchedule(schedule.value);
                  }}
                />
              </label>
              <label class="field">
                <span>Back to light</span>
                <input
                  type="time"
                  value={minutesToTime(schedule.value.to)}
                  onChange={(e) => {
                    schedule.value = {...schedule.value, to: timeToMinutes((e.target as HTMLInputElement).value)};
                    setNightSchedule(schedule.value);
                  }}
                />
              </label>
            </div>
            <p class="muted small">
              Checked every half minute against the device clock — a range that crosses midnight is fine.
            </p>
          </>
        )}

        <p class="label">Accent</p>
        <div class="swatches">
          {ACCENTS.map((option, i) => (
            <button
              key={i}
              class={['swatch', accent.value === option.value && 'on'].filter(Boolean).join(' ')}
              style={{background: option.value}}
              title={option.name}
              aria-label={option.name}
              onClick={() => {
                accent.value = option.value;
                setAccent(accent.value);
              }}
            ></button>
          ))}
        </div>

        <p class="label">Message text size — {textSize.value}px</p>
        <input
          class="slider"
          type="range"
          min={MIN_TEXT_SIZE}
          max={MAX_TEXT_SIZE}
          value={textSize.value}
          onInput={(e) => {
            textSize.value = +(e.target as HTMLInputElement).value;
            setTextSize(textSize.value);
          }}
        />

        <p class="label">Bubble spacing</p>
        <div class="chips">
          {SPACINGS.map((option, i) => (
            <button
              key={i}
              class={spacing.value === option ? 'on' : ''}
              onClick={() => {
                spacing.value = option;
                setBubbleSpacing(spacing.value);
              }}>{option}</button>
          ))}
        </div>

        <p class="label">Density</p>
        <div class="chips">
          {DENSITIES.map((option, i) => (
            <button
              key={i}
              class={density.value === option ? 'on' : ''}
              onClick={() => {
                density.value = option;
                setDensity(density.value);
              }}>{option}</button>
          ))}
        </div>
        <p class="muted small">
          Console swaps bubbles for an aligned monospace grid and keeps its own spacing — the text size
          still applies, the bubble spacing does not.
        </p>
      </>
    );
  } else if(panel.value === 'wallpaper') {
    body = (
      <>
        <div class="chips">
          <button class={wallpaper.value.kind === 'default' ? 'on' : ''} onClick={() => pickWallpaper(DEFAULT_WALLPAPER)}
            >none</button>
          <button class={!!wallpaper.value.blur ? 'on' : ''} onClick={toggleBlur} disabled={wallpaper.value.kind === 'default'}
            >blur</button>
          <label class="upload">
            upload
            <input type="file" accept="image/*" onChange={onUpload} />
          </label>
        </div>
        {wallpaperBusy.value && <p class="muted small">Applying…</p>}

        {wallpaper.value.pattern && (
          <>
            <p class="label">Pattern intensity — {wallpaper.value.intensity ?? 40}%</p>
            <input
              class="slider"
              type="range"
              min="5"
              max="100"
              value={wallpaper.value.intensity ?? 40}
              onChange={(e) => changeIntensity(+(e.target as HTMLInputElement).value)}
            />
          </>
        )}

        <p class="label">Colours and gradients</p>
        <div class="grid">
          {COLOR_PRESETS.map((preset, i) => (
            <button
              key={i}
              class={['tile', wallpaper.value.kind === 'color' && wallpaper.value.colors?.join() === preset.colors.join() && 'on'].filter(Boolean).join(' ')}
              style={{
                background: wallpaperPreviewCss({
                  id: preset.name,
                  slug: '',
                  colors: preset.colors,
                  rotation: preset.rotation,
                  intensity: 0,
                  pattern: false,
                  dark: false,
                  hasFile: false
                })
              }}
              title={preset.name}
              aria-label={preset.name}
              onClick={() =>
                pickWallpaper({
                  kind: 'color',
                  colors: preset.colors,
                  rotation: preset.rotation
                })}
            ></button>
          ))}
        </div>

        <p class="label">From Telegram</p>
        {!wallpapers.value.length ?
          <p class="muted small">Loading…</p> :
          <div class="grid">
            {wallpapers.value.map((item) => (
              <button
                key={item.id}
                class={['tile', wallpaper.value.slug === item.slug && wallpaper.value.kind === 'wallpaper' && 'on'].filter(Boolean).join(' ')}
                style={{background: wallpaperPreviewCss(item)}}
                title={item.slug}
                aria-label={item.slug || 'Wallpaper'}
                onClick={() => pickWallpaper(wallpaperChoiceOf(item, !!wallpaper.value.blur))}
              ></button>
            ))}
          </div>}

        {wallpaperColors.value.length > 0 && (
          <p class="muted small">
            Gradient: {wallpaperColors.value.join(' · ')}
          </p>
        )}
        <p class="muted small">
          The wallpaper applies to every chat. Per-chat wallpapers need{' '}
          <code>messages.setChatWallPaper</code>, which the shared manager layer does not wrap yet.
          Uploaded images stay on this device — they are not saved to your Telegram account.
        </p>
      </>
    );
  } else if(panel.value === 'colors') {
    body = (
      <>
        <p class="label">Peer name palette</p>
        {!palette.value.length ?
          <p class="muted small">Loading…</p> :
          <>
            <div class="palette">
              {palette.value.map((option) => (
                <span key={option.id} class="peer-name" style={{color: peerNameColor(option.id, option.id)}}>Aa</span>
              ))}
            </div>
            <p class="muted small">
              Every peer without a colour of its own falls on one of these by id. The palette is published
              as <code>--peer-N-color</code> on the document, and reply strips and names read it from
              there.
            </p>
          </>}

        <p class="label">Your name colour</p>
        {!ownColor.value ?
          <p class="muted small">Loading…</p> :
          !ownColor.value.isPremium ?
            <p class="muted small">
              Choosing your own name colour is a Premium feature — the server rejects the change without
              it.
            </p> :
            <>
              <div class="palette">
                <button
                  class={['peer-pick', ownColor.value.colorId === null && 'on'].filter(Boolean).join(' ')}
                  onClick={() => pickOwnColor(null)}>auto</button>
                {palette.value.map((option) => (
                  <button
                    key={option.id}
                    class={['peer-pick', ownColor.value.colorId === option.id && 'on'].filter(Boolean).join(' ')}
                    style={{color: peerNameColor(option.id, option.id)}}
                    onClick={() => pickOwnColor(option.id)}>Aa</button>
                ))}
              </div>

              <p class="label">Pattern behind your name</p>
              <div class="grid emoji">
                <button
                  class={['tile', 'emoji-tile', !ownColor.value.backgroundEmojiId && 'on'].filter(Boolean).join(' ')}
                  onClick={() => pickBackgroundEmoji(null)}>✕</button>
                {backgroundEmojis.value.map((emoji) => (
                  <button
                    key={emoji.docId}
                    class={['tile', 'emoji-tile', ownColor.value.backgroundEmojiId === emoji.docId && 'on'].filter(Boolean).join(' ')}
                    onClick={() => pickBackgroundEmoji(emoji.docId)}
                  >
                    {emoji.url && <img src={emoji.url} alt="" />}
                  </button>
                ))}
              </div>
            </>}
      </>
    );
  } else if(panel.value === 'motion') {
    body = (
      <>
        <label class="toggle">
          <input
            type="checkbox"
            checked={animationsOn.value}
            onChange={() => toggleLite('all', animationsOn.value)}
          />
          <span>Enable animations</span>
        </label>
        <p class="muted small">
          Off is tweb's power-saving switch: every effect below stops, and transitions across the app are
          cut to nothing.
        </p>

        <p class="label">Power saving</p>
        {/* Each flag is a toggle followed by its own description, so the pair is
            one keyed fragment — `{#each}` could emit two siblings per item. */}
        {LITE_MODE_KEYS.map((option) => (
          <Fragment key={option.key}>
            <label class="toggle">
              <input
                type="checkbox"
                checked={!lite.value.all && !lite.value[option.key]}
                disabled={!!lite.value.all}
                onChange={() => toggleLite(option.key, !lite.value[option.key])}
              />
              <span>{option.label}</span>
            </label>
            <p class="muted small indent">{option.description}</p>
          </Fragment>
        ))}
        <p class="muted small">
          These are the shared <code>liteMode</code> flags, so the Solid client and every other tab honour
          them too. Web S itself acts on the animation and blur flags directly.
        </p>
      </>
    );
  } else {
    body = (
      <>
        <label class="field">
          <span>Search</span>
          <input
            value={languageFilter.value}
            onInput={(e) => (languageFilter.value = (e.target as HTMLInputElement).value)}
            placeholder="Language"
          />
        </label>
        {!languages.value.length ?
          <p class="muted small">Loading…</p> :
          filteredLanguages.value.map((language) => (
            <button
              key={language.code}
              class={['language', langCode.value === language.code && 'on'].filter(Boolean).join(' ')}
              onClick={() => pickLanguage(language.code)}>
              <span class="language-name">{language.name}</span>
              <span class="muted small">
                {language.nativeName}{language.total ?
                  ` · ${Math.round((language.translated / language.total) * 100)}% translated` :
                  ''}
              </span>
            </button>
          ))}
        <p class="muted small">
          This switches the shared lang pack: the dates, plurals and strings that come from the tweb
          layer follow it, and an RTL language flips the document direction. Web S's own labels — these
          settings, the composer, the chat header — are hardcoded English and do not translate yet.
        </p>
      </>
    );
  }

  return (
    <div class="appearance">
      {error.value && <p class="error">{error.value}</p>}
      {status.value && <p class="ok">{status.value}</p>}

      <div class="panels">
        {PANEL_TABS.map(([key, label], i) => (
          <button key={i} class={panel.value === key ? 'on' : ''} onClick={() => (panel.value = key)}>{label}</button>
        ))}
      </div>

      {body}
    </div>
  );
}
