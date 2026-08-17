<script lang="ts">
  import CustomEmoji from './CustomEmoji.svelte';
  import Sticker from './Sticker.svelte';
  import StickerSetSheet from './StickerSetSheet.svelte';
  import {loadGifs, loadRecentStickers, type StickerItem} from '$lib/telegram/chats';
  import {
    applyTone,
    initEmojiTones,
    loadCustomEmojiSet,
    loadCustomEmojiSets,
    loadDefaultTone,
    loadEmojiCatalogue,
    loadEmojiTones,
    loadRecentCustomEmoji,
    loadRecentEmoji,
    pushRecentEmoji,
    saveDefaultTone,
    saveEmojiTone,
    searchEmoji,
    setEmojiStatus,
    toneVariants,
    type CustomEmojiItem,
    type CustomEmojiSetItem,
    type EmojiCategory,
    type EmojiSearchResult
  } from '$lib/telegram/emoji';
  import {
    clearRecentStickers,
    loadArchivedSets,
    loadFeaturedSets,
    loadInstalledSets,
    loadSetPreview,
    removeRecentSticker,
    reorderSets,
    savedGifIds,
    searchGifs,
    searchStickerSets,
    toggleSavedGif,
    toggleSetInstalled,
    type StickerSetInfo
  } from '$lib/telegram/stickers';

  let {
    onemoji,
    ondocument,
    oncustomemoji
  }: {
    onemoji: (emoji: string) => void;
    ondocument: (docId: string) => void;
    /** A custom emoji picked for the composer — inserted as an entity. */
    oncustomemoji?: (item: {docId: string; emoji: string}) => void;
  } = $props();

  type Tab = 'emoji' | 'custom' | 'stickers' | 'gifs';
  type SetsView = 'my' | 'trending' | 'archived';

  let tab = $state<Tab>('emoji');
  let loading = $state(false);

  /* ---------- stickers ---------- */

  let setsView = $state<SetsView>('my');
  let recent = $state<StickerItem[]>([]);
  let sets = $state<StickerSetInfo[]>([]);
  let featured = $state<StickerSetInfo[]>([]);
  let archived = $state<StickerSetInfo[]>([]);
  let setStickers = $state<Record<string, StickerItem[]>>({});
  let openSet = $state<string>('');
  let sheetSet = $state<string>('');
  let busySet = $state('');

  let setQuery = $state('');
  let setResults = $state<StickerSetInfo[]>([]);
  let setSearchTimer: ReturnType<typeof setTimeout> | undefined;

  // Drag-to-reorder over the installed set rows.
  let dragFrom = $state(-1);

  /* ---------- GIFs ---------- */

  let gifs = $state<StickerItem[]>([]);
  let gifQuery = $state('');
  let gifResults = $state<StickerItem[]>([]);
  let gifOffset = $state('');
  let gifSearching = $state(false);
  let gifSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let savedGifs = $state<Set<string>>(new Set());

  /* ---------- emoji ---------- */

  const EMOJI_CELL = 36;

  let categories = $state<EmojiCategory[]>([]);
  let recentEmoji = $state<string[]>([]);
  let tones = $state<Record<string, number>>({});
  let defaultTone = $state(0);
  let query = $state('');
  let results = $state<EmojiSearchResult[]>([]);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  let body = $state<HTMLDivElement | null>(null);
  let gridWidth = $state(0);
  let sectionEls = $state<(HTMLElement | null)[]>([]);
  // Only the sections near the viewport hold buttons; the rest keep their
  // height so the scrollbar and the category jumps stay honest. The full
  // catalogue is ~1900 emoji and mounting it whole makes opening the picker
  // visibly slow.
  let visible = $state<Set<string>>(new Set(['recent']));
  let activeCategory = $state('recent');

  /** [emoji, variants] while the long-press tone picker is open. */
  let tonePicker = $state<{emoji: string; variants: string[]; global: boolean; x: number; y: number} | null>(null);
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressed = false;

  /* ---------- custom emoji ---------- */

  let customSets = $state<CustomEmojiSetItem[]>([]);
  let customSetEmoji = $state<Record<string, CustomEmojiItem[]>>({});
  let openCustomSet = $state<string>('');
  let recentCustom = $state<CustomEmojiItem[]>([]);
  let statusMode = $state(false);
  let statusNote = $state('');

  const sections = $derived([
    {id: 'recent', title: 'Recently used', icon: '🕒', emoji: recentEmoji},
    ...categories
  ]);

  async function select(next: Tab) {
    tab = next;

    if (next === 'emoji' && !categories.length) {
      loading = true;
      try {
        await initEmojiTones();
        const [catalogue, recents, saved] = await Promise.all([
          loadEmojiCatalogue(),
          loadRecentEmoji(),
          loadEmojiTones()
        ]);
        categories = catalogue;
        recentEmoji = recents;
        tones = saved;
        defaultTone = loadDefaultTone();
      } finally {
        loading = false;
      }
    } else if (next === 'custom' && !customSets.length) {
      loading = true;
      try {
        [recentCustom, customSets] = await Promise.all([
          loadRecentCustomEmoji(),
          loadCustomEmojiSets()
        ]);
      } finally {
        loading = false;
      }
    } else if (next === 'stickers' && !recent.length && !sets.length) {
      loading = true;
      try {
        [recent, sets] = await Promise.all([loadRecentStickers(), loadInstalledSets()]);
      } finally {
        loading = false;
      }
    } else if (next === 'gifs' && !gifs.length) {
      loading = true;
      try {
        [gifs, savedGifs] = await Promise.all([loadGifs(), savedGifIds()]);
      } finally {
        loading = false;
      }
    }
  }

  // The emoji tab is the one that opens first, so it loads itself.
  let booted = false;
  $effect(() => {
    if (booted) return;
    booted = true;
    select('emoji');
  });

  $effect(() => {
    const nodes = sectionEls.filter(Boolean) as HTMLElement[];
    if (!nodes.length || !body) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const next = new Set(visible);
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section!;
          if (entry.isIntersecting) next.add(id);
          else next.delete(id);
        }
        visible = next;
      },
      {root: body, rootMargin: '250px'}
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  });

  function onScroll() {
    // The tone popup is anchored to a cell, so scrolling would leave it adrift.
    if (tonePicker) tonePicker = null;
    if (!body || query || tab !== 'emoji') return;
    const top = body.scrollTop + 4;
    let current = activeCategory;
    for (let i = 0; i < sectionEls.length; i++) {
      const node = sectionEls[i];
      if (node && node.offsetTop <= top) current = node.dataset.section!;
    }
    activeCategory = current;
  }

  function jumpTo(id: string) {
    const index = sections.findIndex((section) => section.id === id);
    const node = sectionEls[index];
    if (!node || !body) return;
    body.scrollTo({top: node.offsetTop - 4});
    activeCategory = id;
  }

  function sectionHeight(count: number) {
    const columns = Math.max(1, Math.floor((gridWidth || 340) / EMOJI_CELL));
    return Math.ceil(count / columns) * EMOJI_CELL;
  }

  /** The variant of an emoji this user sees: their own choice, else the default. */
  function toned(emoji: string) {
    const variants = toneVariants(emoji);
    if (!variants) return emoji;
    return applyTone(emoji, tones[variants[0]] ?? defaultTone);
  }

  function pickEmoji(emoji: string) {
    const value = toned(emoji);
    onemoji(value);
    pushRecentEmoji(value).catch(() => {});
    // Keep the recent row honest without a round-trip through the manager.
    recentEmoji = [emoji, ...recentEmoji.filter((item) => item !== emoji)].slice(0, 32);
  }

  function pickCustom(item: CustomEmojiItem) {
    if (statusMode) {
      statusNote = 'Status updated';
      setEmojiStatus(item.docId).catch(() => (statusNote = 'Could not set status'));
      return;
    }

    oncustomemoji?.({docId: item.docId, emoji: item.emoji || '🙂'});
    pushRecentEmoji(item.emoji || '', item.docId).catch(() => {});
  }

  function openTonePicker(target: HTMLElement, emoji: string, global: boolean) {
    const variants = toneVariants(emoji);
    if (!variants) return;

    const box = target.getBoundingClientRect();
    const container = body?.getBoundingClientRect();
    tonePicker = {
      emoji,
      variants,
      global,
      // Positioned inside the scrolling body, which is the offset parent.
      x: Math.max(0, Math.min(box.left - (container?.left ?? 0), (container?.width ?? 0) - 160)),
      y: Math.max(0, box.top - (container?.top ?? 0) + (body?.scrollTop ?? 0) - 4)
    };
  }

  /** Click-and-hold on a tone-capable emoji opens its variants. */
  function startPress(event: PointerEvent, emoji: string) {
    if (!toneVariants(emoji)) return;

    pressed = false;
    const target = event.currentTarget as HTMLElement;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressed = true;
      openTonePicker(target, emoji, false);
    }, 400);
  }

  function endPress() {
    clearTimeout(pressTimer);
  }

  function chooseTone(tone: number) {
    const picker = tonePicker;
    tonePicker = null;
    if (!picker) return;

    if (picker.global) {
      defaultTone = tone;
      saveDefaultTone(tone);
      return;
    }

    const base = toneVariants(picker.emoji)?.[0] ?? picker.emoji;
    tones = {...tones, [base]: tone};
    saveEmojiTone(base, tone).catch(() => {});
  }

  function onQueryInput() {
    clearTimeout(searchTimer);
    const q = query;
    if (!q.trim()) {
      results = [];
      return;
    }

    searchTimer = setTimeout(async () => {
      const found = await searchEmoji(q);
      if (q === query) results = found;
    }, 150);
  }

  async function toggleCustomSet(set: CustomEmojiSetItem) {
    openCustomSet = openCustomSet === set.id ? '' : set.id;
    if (openCustomSet && !customSetEmoji[set.id]) {
      customSetEmoji = {...customSetEmoji, [set.id]: await loadCustomEmojiSet(set.id)};
    }
  }

  async function selectSetsView(next: SetsView) {
    setsView = next;
    if (next === 'trending' && !featured.length) {
      loading = true;
      try {
        featured = await loadFeaturedSets();
      } finally {
        loading = false;
      }
    } else if (next === 'archived' && !archived.length) {
      loading = true;
      try {
        archived = await loadArchivedSets();
      } finally {
        loading = false;
      }
    }
  }

  async function toggleSet(set: StickerSetInfo) {
    openSet = openSet === set.id ? '' : set.id;
    if (openSet && !setStickers[set.id]) {
      const preview = await loadSetPreview(set.id);
      setStickers = {...setStickers, [set.id]: preview?.stickers ?? []};
    }
  }

  /** Install / uninstall, then reconcile whichever lists show this set. */
  async function toggleInstall(set: StickerSetInfo) {
    if (busySet) return;
    busySet = set.id;
    try {
      const installed = await toggleSetInstalled(set.id);
      const patch = (list: StickerSetInfo[]) =>
        list.map((s) => (s.id === set.id ? {...s, installed, archived: false} : s));

      featured = patch(featured);
      setResults = patch(setResults);
      archived = installed ? archived.filter((s) => s.id !== set.id) : patch(archived);

      if (installed) {
        if (!sets.some((s) => s.id === set.id)) sets = [{...set, installed, archived: false}, ...sets];
      } else {
        sets = sets.filter((s) => s.id !== set.id);
      }
    } finally {
      busySet = '';
    }
  }

  function onSetQuery() {
    clearTimeout(setSearchTimer);
    const q = setQuery.trim();
    if (!q) {
      setResults = [];
      return;
    }

    setSearchTimer = setTimeout(async () => {
      const found = await searchStickerSets(q);
      if (setQuery.trim() === q) setResults = found;
    }, 350);
  }

  async function dropSet(to: number) {
    const from = dragFrom;
    dragFrom = -1;
    if (from < 0 || from === to) return;

    const next = [...sets];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    sets = next;

    try {
      await reorderSets(next.map((s) => s.id));
    } catch (err) {
      // The server keeps the old order; refetching would fight the drag.
    }
  }

  async function forgetRecent(sticker: StickerItem) {
    recent = recent.filter((s) => s.docId !== sticker.docId);
    try {
      await removeRecentSticker(sticker.docId);
    } catch (err) {}
  }

  async function forgetAllRecent() {
    recent = [];
    try {
      await clearRecentStickers();
    } catch (err) {}
  }

  function onGifQuery() {
    clearTimeout(gifSearchTimer);
    const q = gifQuery.trim();
    if (!q) {
      gifResults = [];
      gifOffset = '';
      return;
    }

    gifSearchTimer = setTimeout(async () => {
      gifSearching = true;
      try {
        const found = await searchGifs(q);
        if (gifQuery.trim() !== q) return;
        gifResults = found.items;
        gifOffset = found.nextOffset;
      } finally {
        gifSearching = false;
      }
    }, 350);
  }

  async function moreGifs() {
    if (!gifOffset || gifSearching) return;
    gifSearching = true;
    try {
      const found = await searchGifs(gifQuery.trim(), gifOffset);
      gifResults = [...gifResults, ...found.items];
      gifOffset = found.nextOffset;
    } finally {
      gifSearching = false;
    }
  }

  async function toggleGif(sticker: StickerItem) {
    const save = !savedGifs.has(sticker.docId);
    const previous = savedGifs;
    const next = new Set(savedGifs);
    if (save) next.add(sticker.docId);
    else next.delete(sticker.docId);
    savedGifs = next;

    try {
      await toggleSavedGif(sticker.docId, save);
      if (save) {
        if (!gifs.some((g) => g.docId === sticker.docId)) gifs = [sticker, ...gifs];
      } else {
        gifs = gifs.filter((g) => g.docId !== sticker.docId);
      }
    } catch (err) {
      savedGifs = previous;
    }
  }
</script>

<div class="picker">
  <div class="tabs">
    <button class:active={tab === 'emoji'} onclick={() => select('emoji')}>Emoji</button>
    <button class:active={tab === 'custom'} onclick={() => select('custom')}>Custom</button>
    <button class:active={tab === 'stickers'} onclick={() => select('stickers')}>Stickers</button>
    <button class:active={tab === 'gifs'} onclick={() => select('gifs')}>GIFs</button>
  </div>

  {#if tab === 'emoji'}
    <div class="search-row">
      <input
        class="search"
        placeholder="Search emoji"
        bind:value={query}
        oninput={onQueryInput}
      />
      <button
        class="tone-chip"
        title="Default skin tone"
        onclick={(e) => openTonePicker(e.currentTarget as HTMLElement, '✋', true)}
      >{applyTone('✋', defaultTone)}</button>
    </div>

    {#if !query}
      <div class="category-tabs">
        {#each sections as section (section.id)}
          <button
            class:active={activeCategory === section.id}
            title={section.title}
            onclick={() => jumpTo(section.id)}
          >{section.icon}</button>
        {/each}
      </div>
    {/if}
  {:else if tab === 'stickers'}
    <div class="subtabs">
      <button class:active={setsView === 'my'} onclick={() => selectSetsView('my')}>My</button>
      <button class:active={setsView === 'trending'} onclick={() => selectSetsView('trending')}>Trending</button>
      <button class:active={setsView === 'archived'} onclick={() => selectSetsView('archived')}>Archived</button>
    </div>
    <input
      class="pane-search"
      placeholder="Search sticker sets"
      bind:value={setQuery}
      oninput={onSetQuery}
    />
  {:else if tab === 'gifs'}
    <input class="pane-search" placeholder="Search GIFs" bind:value={gifQuery} oninput={onGifQuery} />
  {/if}

  <div class="body" bind:this={body} onscroll={onScroll}>
    {#if loading}
      <p class="muted">Loading…</p>
    {:else if tab === 'emoji'}
      {#if query}
        {#if results.length}
          <div class="emoji-grid" bind:clientWidth={gridWidth}>
            {#each results as result (result.docId || result.emoji)}
              {#if result.docId}
                <button
                  class="emoji"
                  onclick={() => pickCustom({docId: result.docId, emoji: result.emoji, kind: 'static'})}
                >
                  <CustomEmoji docId={result.docId} size={26} fallback={result.emoji} />
                </button>
              {:else}
                <button class="emoji" onclick={() => pickEmoji(result.emoji)}>{toned(result.emoji)}</button>
              {/if}
            {/each}
          </div>
        {:else}
          <p class="muted">Nothing found.</p>
        {/if}
      {:else}
        {#each sections as section, index (section.id)}
          <section
            bind:this={sectionEls[index]}
            data-section={section.id}
          >
            <p class="group sticky">{section.title}</p>
            {#if visible.has(section.id)}
              <div class="emoji-grid" bind:clientWidth={gridWidth}>
                {#each section.emoji as emoji (emoji)}
                  <button
                    class="emoji"
                    onclick={() => (pressed ? (pressed = false) : pickEmoji(emoji))}
                    onpointerdown={(e) => startPress(e, emoji)}
                    onpointerup={endPress}
                    onpointerleave={endPress}
                    oncontextmenu={(e) => e.preventDefault()}
                  >{toned(emoji)}</button>
                {/each}
              </div>
            {:else}
              <div class="placeholder-grid" style="height: {sectionHeight(section.emoji.length)}px"></div>
            {/if}
          </section>
        {/each}
      {/if}
    {:else if tab === 'custom'}
      <div class="status-row">
        <button class="status-toggle" class:on={statusMode} onclick={() => (statusMode = !statusMode)}>
          {statusMode ? 'Picking a status…' : 'Set as status'}
        </button>
        {#if statusMode}
          <button class="status-clear" onclick={() => {
            statusNote = 'Status cleared';
            setEmojiStatus('').catch(() => (statusNote = 'Could not clear status'));
          }}>Clear</button>
        {/if}
        {#if statusNote}<span class="muted inline">{statusNote}</span>{/if}
      </div>

      {#if recentCustom.length}
        <p class="group">Recently used</p>
        <div class="emoji-grid">
          {#each recentCustom as item (item.docId)}
            <button class="emoji" onclick={() => pickCustom(item)}>
              <CustomEmoji docId={item.docId} size={28} fallback={item.emoji} />
            </button>
          {/each}
        </div>
      {/if}

      {#each customSets as set (set.id)}
        <button class="group set" onclick={() => toggleCustomSet(set)}>
          {openCustomSet === set.id ? '▾' : '▸'} {set.title} ({set.count})
        </button>
        {#if openCustomSet === set.id}
          <div class="emoji-grid">
            {#each customSetEmoji[set.id] ?? [] as item (item.docId)}
              <button class="emoji" onclick={() => pickCustom(item)}>
                <CustomEmoji docId={item.docId} size={28} fallback={item.emoji} />
              </button>
            {/each}
          </div>
        {/if}
      {/each}

      {#if !customSets.length && !recentCustom.length}
        <p class="muted">No custom emoji sets. Custom emoji come with Telegram Premium.</p>
      {/if}
    {:else if tab === 'stickers'}
      {#if setQuery.trim()}
        {#each setResults as set (set.id)}
          <div class="set-row">
            <button class="set-open" onclick={() => (sheetSet = set.shortName || set.id)}>
              {#if set.cover}<Sticker sticker={set.cover} size={28} />{/if}
              <span class="set-title">{set.title}</span>
            </button>
            <button class="pill" disabled={busySet === set.id} onclick={() => toggleInstall(set)}>
              {set.installed ? 'Remove' : 'Add'}
            </button>
          </div>
        {/each}
        {#if !setResults.length}<p class="muted">No sets found.</p>{/if}
      {:else if setsView === 'trending'}
        {#each featured as set (set.id)}
          <div class="set-row">
            <button class="set-open" onclick={() => (sheetSet = set.shortName || set.id)}>
              {#if set.cover}<Sticker sticker={set.cover} size={28} />{/if}
              <span class="set-title">{set.title}</span>
            </button>
            <button class="pill" disabled={busySet === set.id} onclick={() => toggleInstall(set)}>
              {set.installed ? 'Added' : 'Add'}
            </button>
          </div>
        {/each}
        {#if !featured.length}<p class="muted">Nothing trending right now.</p>{/if}
      {:else if setsView === 'archived'}
        {#each archived as set (set.id)}
          <div class="set-row">
            <button class="set-open" onclick={() => (sheetSet = set.shortName || set.id)}>
              {#if set.cover}<Sticker sticker={set.cover} size={28} />{/if}
              <span class="set-title">{set.title}</span>
            </button>
            <button class="pill" disabled={busySet === set.id} onclick={() => toggleInstall(set)}>
              Restore
            </button>
          </div>
        {/each}
        {#if !archived.length}<p class="muted">No archived sets.</p>{/if}
      {:else}
        {#if recent.length}
          <p class="group">
            Recent
            <button class="link" onclick={forgetAllRecent}>Clear</button>
          </p>
          <div class="sticker-grid">
            {#each recent as sticker (sticker.docId)}
              <div class="recent-tile">
                <button onclick={() => ondocument(sticker.docId)}>
                  <Sticker {sticker} size={64} />
                </button>
                <button
                  class="forget"
                  title="Remove from recent"
                  aria-label="Remove from recent"
                  onclick={() => forgetRecent(sticker)}
                >✕</button>
              </div>
            {/each}
          </div>
        {/if}
        {#each sets as set, i (set.id)}
          <div
            class="set-row"
            class:dragging={dragFrom === i}
            draggable="true"
            role="listitem"
            ondragstart={() => (dragFrom = i)}
            ondragover={(e) => e.preventDefault()}
            ondrop={(e) => {
              e.preventDefault();
              dropSet(i);
            }}
          >
            <button class="set-open" onclick={() => toggleSet(set)}>
              <span class="handle">⠿</span>
              <span class="set-title">{openSet === set.id ? '▾' : '▸'} {set.title} ({set.count})</span>
            </button>
            <button class="pill" disabled={busySet === set.id} onclick={() => toggleInstall(set)}>
              Remove
            </button>
          </div>
          {#if openSet === set.id}
            <div class="sticker-grid">
              {#each setStickers[set.id] ?? [] as sticker (sticker.docId)}
                <button onclick={() => ondocument(sticker.docId)}>
                  <Sticker {sticker} size={64} />
                </button>
              {/each}
            </div>
          {/if}
        {/each}
        {#if !recent.length && !sets.length}
          <p class="muted">No stickers.</p>
        {/if}
      {/if}
    {:else}
      {@const list = gifQuery.trim() ? gifResults : gifs}
      <div class="gif-grid">
        {#each list as gif (gif.docId)}
          <div class="gif-tile">
            <button onclick={() => ondocument(gif.docId)}>
              <Sticker sticker={gif} size={110} />
            </button>
            <button
              class="save"
              title={savedGifs.has(gif.docId) ? 'Remove from saved' : 'Save GIF'}
              aria-label={savedGifs.has(gif.docId) ? 'Remove from saved' : 'Save GIF'}
              onclick={() => toggleGif(gif)}
            >{savedGifs.has(gif.docId) ? '★' : '☆'}</button>
          </div>
        {/each}
      </div>
      {#if gifSearching}
        <p class="muted">Searching…</p>
      {:else if !list.length}
        <p class="muted">{gifQuery.trim() ? 'Nothing found.' : 'No saved GIFs.'}</p>
      {:else if gifQuery.trim() && gifOffset}
        <button class="more" onclick={moreGifs}>Load more</button>
      {/if}
    {/if}

    {#if tonePicker}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tone-picker"
        style="left: {tonePicker.x}px; top: {tonePicker.y}px"
        onpointerleave={() => (tonePicker = null)}
      >
        {#each tonePicker.variants as variant, tone (variant)}
          <button onclick={() => chooseTone(tone)}>{variant}</button>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if sheetSet}
  <StickerSetSheet
    setKey={sheetSet}
    onsend={ondocument}
    onclose={() => (sheetSet = '')}
  />
{/if}

<style>
  .picker {
    position: absolute;
    bottom: 100%;
    right: 18px;
    width: min(380px, calc(100% - 36px));
    height: 340px;
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
    overflow: hidden;
    z-index: 20;
  }

  .tabs,
  .subtabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    flex: none;
  }

  .tabs button,
  .subtabs button {
    flex: 1;
    padding: 10px;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
  }

  .subtabs button {
    padding: 6px;
    font-size: 12px;
  }

  .tabs button.active,
  .subtabs button.active {
    color: var(--accent);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .search-row {
    display: flex;
    gap: 6px;
    padding: 8px 10px 0;
    flex: none;
  }

  .search {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: inherit;
    font-size: 13px;
  }

  .pane-search {
    flex: none;
    margin: 8px 10px 0;
    padding: 6px 9px;
    font-size: 13px;
    color: var(--text);
    background: color-mix(in srgb, var(--text) 6%, transparent);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .tone-chip {
    flex: none;
    width: 32px;
    font-size: 18px;
    line-height: 1;
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
  }

  .category-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 10px 0;
    overflow-x: auto;
    flex: none;
  }

  .category-tabs button {
    flex: none;
    font-size: 17px;
    line-height: 1;
    padding: 4px 6px;
    background: none;
    border: none;
    border-radius: 6px;
    opacity: 0.6;
    cursor: pointer;
  }

  .category-tabs button.active {
    opacity: 1;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 10px 12px;
  }

  .group {
    margin: 10px 2px 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .group.sticky {
    position: sticky;
    top: -8px;
    margin: 0 0 6px;
    padding: 6px 2px;
    background: var(--bg-elevated);
    z-index: 1;
  }

  button.set {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
  }

  .set-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }

  .set-row.dragging {
    opacity: 0.5;
  }

  .set-open {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    font-size: 13px;
  }

  .set-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .handle {
    color: var(--text-dim);
    cursor: grab;
  }

  .pill {
    flex: none;
    padding: 3px 9px;
    font-size: 12px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .pill:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .link {
    margin-left: 6px;
    padding: 0;
    font-size: 11px;
    text-transform: uppercase;
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(34px, 1fr));
    gap: 2px;
  }

  .emoji {
    font-size: 22px;
    line-height: 1;
    padding: 4px;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    touch-action: manipulation;
  }

  .emoji:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .tone-picker {
    position: absolute;
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
    z-index: 5;
  }

  .tone-picker button {
    font-size: 20px;
    line-height: 1;
    padding: 3px;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .tone-picker button:hover {
    background: color-mix(in srgb, var(--text) 10%, transparent);
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0 6px;
  }

  .status-toggle,
  .status-clear {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: inherit;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .status-toggle.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .sticker-grid,
  .gif-grid {
    display: grid;
    gap: 4px;
  }

  .sticker-grid {
    grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
  }

  .gif-grid {
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  }

  .sticker-grid button,
  .gif-grid button {
    background: none;
    border: none;
    padding: 2px;
    border-radius: 8px;
    cursor: pointer;
  }

  .sticker-grid button:hover,
  .gif-grid button:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }

  .recent-tile,
  .gif-tile {
    position: relative;
  }

  .forget,
  .save {
    position: absolute;
    top: 2px;
    right: 2px;
    padding: 0 4px;
    font-size: 12px;
    line-height: 16px;
    color: #fff;
    background: rgba(0, 0, 0, 0.45);
    border: none;
    border-radius: 999px;
    cursor: pointer;
    opacity: 0;
  }

  .recent-tile:hover .forget,
  .gif-tile:hover .save,
  .forget:focus,
  .save:focus {
    opacity: 1;
  }

  .more {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 7px;
    font-size: 13px;
    color: var(--accent);
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
  }

  .muted {
    color: var(--text-dim);
    padding: 12px;
    font-size: 13px;
  }

  .muted.inline {
    padding: 0;
    font-size: 12px;
  }
</style>
