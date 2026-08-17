<script lang="ts">
  /**
   * Settings → Appearance: theme (including an auto-night schedule), accent,
   * wallpaper, peer name colour, text size, bubble spacing, power saving and
   * the language pack. Everything it changes is applied through
   * $lib/telegram/appearance, which writes CSS variables on <html>.
   */
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

  type Panel = 'theme' | 'wallpaper' | 'colors' | 'motion' | 'language';
  let panel = $state<Panel>('theme');

  let theme = $state<ThemeMode>(getThemeMode());
  let schedule = $state<NightSchedule>(getNightSchedule());
  let accent = $state(getAccent());
  let density = $state<Density>(getDensity());
  let textSize = $state(getTextSize());
  let spacing = $state<BubbleSpacing>(getBubbleSpacing());

  let wallpapers = $state<WallpaperItem[]>([]);
  let wallpaper = $state<WallpaperChoice>(getWallpaper());
  let wallpaperBusy = $state(false);

  let palette = $state<PeerColorOption[]>([]);
  let ownColor = $state<OwnColorState | null>(null);
  let backgroundEmojis = $state<BackgroundEmoji[]>([]);

  let lite = $state<LiteModeFlags>({});
  let languages = $state<LanguageItem[]>([]);
  let langCode = $state('');
  let languageFilter = $state('');

  let error = $state('');
  let status = $state('');

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
  }

  function fail(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  $effect(() => {
    const current = panel;
    error = '';

    (async () => {
      try {
        if (current === 'wallpaper' && !wallpapers.length) {
          wallpapers = await loadWallpapers();
        } else if (current === 'colors' && !palette.length) {
          [palette, ownColor] = await Promise.all([loadPeerColors(), loadOwnColor()]);
          backgroundEmojis = await loadBackgroundEmojis().catch(() => []);
        } else if (current === 'motion' && !Object.keys(lite).length) {
          lite = await loadLiteMode();
        } else if (current === 'language' && !languages.length) {
          [languages, langCode] = await Promise.all([loadLanguages(), currentLanguage()]);
        }
      } catch (err: any) {
        fail(err, 'Failed to load');
      }
    })();
  });

  const wallpaperColors = $derived(wallpaper.colors ?? []);

  const filteredLanguages = $derived(
    languageFilter.trim()
      ? languages.filter((language) => {
          const needle = languageFilter.trim().toLowerCase();
          return (
            language.name.toLowerCase().includes(needle) ||
            language.nativeName.toLowerCase().includes(needle) ||
            language.code.toLowerCase().includes(needle)
          );
        })
      : languages
  );

  const animationsOn = $derived(!(lite.all || lite.animations));

  async function pickWallpaper(choice: WallpaperChoice) {
    wallpaperBusy = true;
    try {
      wallpaper = choice;
      await setWallpaper(choice);
    } catch (err: any) {
      fail(err, 'Failed to apply the wallpaper');
    } finally {
      wallpaperBusy = false;
    }
  }

  async function toggleBlur() {
    await pickWallpaper({...wallpaper, blur: !wallpaper.blur});
  }

  async function changeIntensity(value: number) {
    await pickWallpaper({...wallpaper, intensity: value});
  }

  async function onUpload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    wallpaperBusy = true;
    try {
      wallpaper = await uploadWallpaper(file, !!wallpaper.blur);
      flash('Wallpaper set');
    } catch (err: any) {
      fail(err, 'Failed to read the image');
    } finally {
      wallpaperBusy = false;
    }
  }

  async function pickOwnColor(colorId: number | null) {
    if (!ownColor) return;
    const previous = ownColor;
    ownColor = {...ownColor, colorId};
    try {
      await saveOwnColor(colorId, ownColor.backgroundEmojiId);
      flash('Name colour saved');
    } catch (err: any) {
      ownColor = previous;
      fail(err, 'Failed to save the colour');
    }
  }

  async function pickBackgroundEmoji(docId: string | null) {
    if (!ownColor) return;
    const previous = ownColor;
    ownColor = {...ownColor, backgroundEmojiId: docId};
    try {
      await saveOwnColor(ownColor.colorId, docId);
      flash(docId ? 'Pattern saved' : 'Pattern removed');
    } catch (err: any) {
      ownColor = previous;
      fail(err, 'Failed to save the pattern');
    }
  }

  async function toggleLite(key: string, disabled: boolean) {
    lite = {...lite, [key]: disabled};
    try {
      await setLiteModeFlag(key, disabled);
    } catch (err: any) {
      lite = {...lite, [key]: !disabled};
      fail(err, 'Failed to save');
    }
  }

  async function pickLanguage(code: string) {
    const previous = langCode;
    langCode = code;
    try {
      await setLanguage(code);
      flash('Language pack applied');
    } catch (err: any) {
      langCode = previous;
      fail(err, 'Failed to switch the language');
    }
  }
</script>

<div class="appearance">
  {#if error}<p class="error">{error}</p>{/if}
  {#if status}<p class="ok">{status}</p>{/if}

  <div class="panels">
    {#each [['theme', 'Theme'], ['wallpaper', 'Wallpaper'], ['colors', 'Colours'], ['motion', 'Animations'], ['language', 'Language']] as [key, label]}
      <button class:on={panel === key} onclick={() => (panel = key as Panel)}>{label}</button>
    {/each}
  </div>

  {#if panel === 'theme'}
    <p class="label">Theme</p>
    <div class="chips">
      {#each ['system', 'light', 'dark', 'schedule'] as mode}
        <button
          class:on={theme === mode}
          onclick={() => {
            theme = mode as ThemeMode;
            setThemeMode(theme);
          }}>{mode === 'schedule' ? 'auto night' : mode}</button
        >
      {/each}
    </div>

    {#if theme === 'schedule'}
      <div class="row">
        <label class="field"
          ><span>Dark from</span>
          <input
            type="time"
            value={minutesToTime(schedule.from)}
            onchange={(e) => {
              schedule = {...schedule, from: timeToMinutes(e.currentTarget.value)};
              setNightSchedule(schedule);
            }}
          /></label
        >
        <label class="field"
          ><span>Back to light</span>
          <input
            type="time"
            value={minutesToTime(schedule.to)}
            onchange={(e) => {
              schedule = {...schedule, to: timeToMinutes(e.currentTarget.value)};
              setNightSchedule(schedule);
            }}
          /></label
        >
      </div>
      <p class="muted small">
        Checked every half minute against the device clock — a range that crosses midnight is fine.
      </p>
    {/if}

    <p class="label">Accent</p>
    <div class="swatches">
      {#each ACCENTS as option}
        <button
          class="swatch"
          class:on={accent === option.value}
          style="background: {option.value}"
          title={option.name}
          aria-label={option.name}
          onclick={() => {
            accent = option.value;
            setAccent(accent);
          }}
        ></button>
      {/each}
    </div>

    <p class="label">Message text size — {textSize}px</p>
    <input
      class="slider"
      type="range"
      min={MIN_TEXT_SIZE}
      max={MAX_TEXT_SIZE}
      value={textSize}
      oninput={(e) => {
        textSize = +e.currentTarget.value;
        setTextSize(textSize);
      }}
    />

    <p class="label">Bubble spacing</p>
    <div class="chips">
      {#each ['roomy', 'compact'] as option}
        <button
          class:on={spacing === option}
          onclick={() => {
            spacing = option as BubbleSpacing;
            setBubbleSpacing(spacing);
          }}>{option}</button
        >
      {/each}
    </div>

    <p class="label">Density</p>
    <div class="chips">
      {#each ['comfortable', 'console'] as option}
        <button
          class:on={density === option}
          onclick={() => {
            density = option as Density;
            setDensity(density);
          }}>{option}</button
        >
      {/each}
    </div>
    <p class="muted small">
      Console swaps bubbles for an aligned monospace grid and keeps its own spacing — the text size
      still applies, the bubble spacing does not.
    </p>
  {:else if panel === 'wallpaper'}
    <div class="chips">
      <button class:on={wallpaper.kind === 'default'} onclick={() => pickWallpaper(DEFAULT_WALLPAPER)}
        >none</button
      >
      <button class:on={!!wallpaper.blur} onclick={toggleBlur} disabled={wallpaper.kind === 'default'}
        >blur</button
      >
      <label class="upload">
        upload
        <input type="file" accept="image/*" onchange={onUpload} />
      </label>
    </div>
    {#if wallpaperBusy}<p class="muted small">Applying…</p>{/if}

    {#if wallpaper.pattern}
      <p class="label">Pattern intensity — {wallpaper.intensity ?? 40}%</p>
      <input
        class="slider"
        type="range"
        min="5"
        max="100"
        value={wallpaper.intensity ?? 40}
        onchange={(e) => changeIntensity(+e.currentTarget.value)}
      />
    {/if}

    <p class="label">Colours and gradients</p>
    <div class="grid">
      {#each COLOR_PRESETS as preset}
        <button
          class="tile"
          class:on={wallpaper.kind === 'color' && wallpaper.colors?.join() === preset.colors.join()}
          style="background: {wallpaperPreviewCss({
            id: preset.name,
            slug: '',
            colors: preset.colors,
            rotation: preset.rotation,
            intensity: 0,
            pattern: false,
            dark: false,
            hasFile: false
          })}"
          title={preset.name}
          aria-label={preset.name}
          onclick={() =>
            pickWallpaper({
              kind: 'color',
              colors: preset.colors,
              rotation: preset.rotation
            })}
        ></button>
      {/each}
    </div>

    <p class="label">From Telegram</p>
    {#if !wallpapers.length}
      <p class="muted small">Loading…</p>
    {:else}
      <div class="grid">
        {#each wallpapers as item (item.id)}
          <button
            class="tile"
            class:on={wallpaper.slug === item.slug && wallpaper.kind === 'wallpaper'}
            style="background: {wallpaperPreviewCss(item)}"
            title={item.slug}
            aria-label={item.slug || 'Wallpaper'}
            onclick={() => pickWallpaper(wallpaperChoiceOf(item, !!wallpaper.blur))}
          ></button>
        {/each}
      </div>
    {/if}

    {#if wallpaperColors.length}
      <p class="muted small">
        Gradient: {wallpaperColors.join(' · ')}
      </p>
    {/if}
    <p class="muted small">
      The wallpaper applies to every chat. Per-chat wallpapers need
      <code>messages.setChatWallPaper</code>, which the shared manager layer does not wrap yet.
      Uploaded images stay on this device — they are not saved to your Telegram account.
    </p>
  {:else if panel === 'colors'}
    <p class="label">Peer name palette</p>
    {#if !palette.length}
      <p class="muted small">Loading…</p>
    {:else}
      <div class="palette">
        {#each palette as option (option.id)}
          <span class="peer-name" style="color: {peerNameColor(option.id, option.id)}">Aa</span>
        {/each}
      </div>
      <p class="muted small">
        Every peer without a colour of its own falls on one of these by id. The palette is published
        as <code>--peer-N-color</code> on the document, and reply strips and names read it from
        there.
      </p>
    {/if}

    <p class="label">Your name colour</p>
    {#if !ownColor}
      <p class="muted small">Loading…</p>
    {:else if !ownColor.isPremium}
      <p class="muted small">
        Choosing your own name colour is a Premium feature — the server rejects the change without
        it.
      </p>
    {:else}
      <div class="palette">
        <button
          class="peer-pick"
          class:on={ownColor.colorId === null}
          onclick={() => pickOwnColor(null)}>auto</button
        >
        {#each palette as option (option.id)}
          <button
            class="peer-pick"
            class:on={ownColor.colorId === option.id}
            style="color: {peerNameColor(option.id, option.id)}"
            onclick={() => pickOwnColor(option.id)}>Aa</button
          >
        {/each}
      </div>

      <p class="label">Pattern behind your name</p>
      <div class="grid emoji">
        <button
          class="tile emoji-tile"
          class:on={!ownColor.backgroundEmojiId}
          onclick={() => pickBackgroundEmoji(null)}>✕</button
        >
        {#each backgroundEmojis as emoji (emoji.docId)}
          <button
            class="tile emoji-tile"
            class:on={ownColor.backgroundEmojiId === emoji.docId}
            onclick={() => pickBackgroundEmoji(emoji.docId)}
          >
            {#if emoji.url}<img src={emoji.url} alt="" />{/if}
          </button>
        {/each}
      </div>
    {/if}
  {:else if panel === 'motion'}
    <label class="toggle">
      <input
        type="checkbox"
        checked={animationsOn}
        onchange={() => toggleLite('all', animationsOn)}
      />
      <span>Enable animations</span>
    </label>
    <p class="muted small">
      Off is tweb's power-saving switch: every effect below stops, and transitions across the app are
      cut to nothing.
    </p>

    <p class="label">Power saving</p>
    {#each LITE_MODE_KEYS as option (option.key)}
      <label class="toggle">
        <input
          type="checkbox"
          checked={!lite.all && !lite[option.key]}
          disabled={!!lite.all}
          onchange={() => toggleLite(option.key, !lite[option.key])}
        />
        <span>{option.label}</span>
      </label>
      <p class="muted small indent">{option.description}</p>
    {/each}
    <p class="muted small">
      These are the shared <code>liteMode</code> flags, so the Solid client and every other tab honour
      them too. Web S itself acts on the animation and blur flags directly.
    </p>
  {:else}
    <label class="field"
      ><span>Search</span><input bind:value={languageFilter} placeholder="Language" /></label
    >
    {#if !languages.length}
      <p class="muted small">Loading…</p>
    {:else}
      {#each filteredLanguages as language (language.code)}
        <button class="language" class:on={langCode === language.code} onclick={() => pickLanguage(language.code)}>
          <span class="language-name">{language.name}</span>
          <span class="muted small">
            {language.nativeName}{language.total
              ? ` · ${Math.round((language.translated / language.total) * 100)}% translated`
              : ''}
          </span>
        </button>
      {/each}
    {/if}
    <p class="muted small">
      This switches the shared lang pack: the dates, plurals and strings that come from the tweb
      layer follow it, and an RTL language flips the document direction. Web S's own labels — these
      settings, the composer, the chat header — are hardcoded English and do not translate yet.
    </p>
  {/if}
</div>

<style>
  .appearance {
    display: grid;
    gap: 10px;
    align-content: start;
  }

  .panels {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .panels button {
    flex: none;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
  }

  .panels button.on {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .label {
    margin: 8px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }

  .chips button,
  .upload {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
    text-transform: capitalize;
  }

  .chips button.on,
  .upload:hover {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .chips button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .upload input {
    display: none;
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .field {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .field input {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .slider {
    width: 100%;
    accent-color: var(--accent);
  }

  .swatches {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
  }

  .swatch.on {
    border-color: var(--text);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
    gap: 6px;
  }

  .tile {
    aspect-ratio: 3 / 4;
    border-radius: 8px;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }

  .tile.on {
    border-color: var(--text);
  }

  .grid.emoji {
    grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  }

  .emoji-tile {
    aspect-ratio: 1;
    background: var(--bg-elevated);
    color: inherit;
    display: grid;
    place-items: center;
  }

  .emoji-tile img {
    width: 26px;
    height: 26px;
    object-fit: contain;
  }

  .palette {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }

  .peer-name,
  .peer-pick {
    font-weight: 700;
    font-size: 15px;
  }

  .peer-pick {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
  }

  .peer-pick.on {
    border-color: var(--text);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }

  .language {
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .language.on {
    border-color: var(--accent);
    background: var(--row-active);
  }

  .language-name {
    font-size: 14px;
    font-weight: 500;
  }

  .muted {
    color: var(--text-dim);
  }

  .small {
    font-size: 12px;
    margin: 0;
  }

  .indent {
    margin-left: 24px;
    margin-top: -4px;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }

  .ok {
    margin: 0;
    color: var(--accent);
    font-size: 13px;
  }
</style>
