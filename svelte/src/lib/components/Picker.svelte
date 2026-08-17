<script lang="ts">
  import Sticker from './Sticker.svelte';
  import StickerSetSheet from './StickerSetSheet.svelte';
  import {loadGifs, loadRecentStickers, type StickerItem} from '$lib/telegram/chats';
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
    ondocument
  }: {onemoji: (emoji: string) => void; ondocument: (docId: string) => void} = $props();

  type Tab = 'emoji' | 'stickers' | 'gifs';
  type SetsView = 'my' | 'trending' | 'archived';

  let tab = $state<Tab>('emoji');
  let setsView = $state<SetsView>('my');

  let recent = $state<StickerItem[]>([]);
  let sets = $state<StickerSetInfo[]>([]);
  let featured = $state<StickerSetInfo[]>([]);
  let archived = $state<StickerSetInfo[]>([]);
  let setStickers = $state<Record<string, StickerItem[]>>({});
  let openSet = $state<string>('');
  let sheetSet = $state<string>('');

  let setQuery = $state('');
  let setResults = $state<StickerSetInfo[]>([]);
  let setSearchTimer: ReturnType<typeof setTimeout> | undefined;

  let gifs = $state<StickerItem[]>([]);
  let gifQuery = $state('');
  let gifResults = $state<StickerItem[]>([]);
  let gifOffset = $state('');
  let gifSearching = $state(false);
  let gifSearchTimer: ReturnType<typeof setTimeout> | undefined;
  let savedGifs = $state<Set<string>>(new Set());

  let loading = $state(false);
  let busySet = $state('');

  // Drag-to-reorder over the installed set rows.
  let dragFrom = $state(-1);

  // A compact built-in set; the full Unicode catalogue lives in tweb's emoji
  // data and is not needed to send any emoji (typing works too).
  const EMOJI_GROUPS: {name: string; emoji: string[]}[] = [
    {
      name: 'Smileys',
      emoji: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 😤 😡 😠 🤬 😈 👿 💀 💩 🤡'.split(' ')
    },
    {
      name: 'Gestures',
      emoji: '👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤝 🙏 ✍️ 💪 🦾 👏 🙌 👐 🤲 🤜 🤛 ✊ 👊'.split(' ')
    },
    {
      name: 'Hearts & symbols',
      emoji: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 🔥 ⭐ 🌟 ✨ ⚡ 💥 💫 🎉 🎊 🎈 🎁 ✅ ❌ ❓ ❗ 💯 👀'.split(' ')
    },
    {
      name: 'Animals & nature',
      emoji: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🦄 🐝 🐛 🦋 🐌 🐞 🐢 🐍 🐙 🦑 🦀 🐠 🐬 🐳 🌵 🌲 🌳 🌴 🌱 🌿 🍀 🌸 🌼 🌻 🌞 🌝 🌙 ⛅ ☔ ❄️'.split(' ')
    },
    {
      name: 'Food & objects',
      emoji: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍆 🥔 🥕 🌽 🌶 🥒 🍞 🧀 🍗 🍔 🍟 🍕 🌭 🌮 🍿 🍩 🍪 🎂 🍰 🍫 🍬 ☕ 🍵 🍺 🍷 🥂 💻 📱 ⌨️ 🖥 🎧 📷 🎮 💡 🔑 🔒'.split(' ')
    }
  ];

  async function select(next: Tab) {
    tab = next;
    if (next === 'stickers' && !recent.length && !sets.length) {
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
    const query = setQuery.trim();
    if (!query) {
      setResults = [];
      return;
    }

    setSearchTimer = setTimeout(async () => {
      const found = await searchStickerSets(query);
      if (setQuery.trim() === query) setResults = found;
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
    const query = gifQuery.trim();
    if (!query) {
      gifResults = [];
      gifOffset = '';
      return;
    }

    gifSearchTimer = setTimeout(async () => {
      gifSearching = true;
      try {
        const found = await searchGifs(query);
        if (gifQuery.trim() !== query) return;
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
    <button class:active={tab === 'stickers'} onclick={() => select('stickers')}>Stickers</button>
    <button class:active={tab === 'gifs'} onclick={() => select('gifs')}>GIFs</button>
  </div>

  {#if tab === 'stickers'}
    <div class="subtabs">
      <button class:active={setsView === 'my'} onclick={() => selectSetsView('my')}>My</button>
      <button class:active={setsView === 'trending'} onclick={() => selectSetsView('trending')}>Trending</button>
      <button class:active={setsView === 'archived'} onclick={() => selectSetsView('archived')}>Archived</button>
    </div>
    <input
      class="search"
      placeholder="Search sticker sets"
      bind:value={setQuery}
      oninput={onSetQuery}
    />
  {:else if tab === 'gifs'}
    <input class="search" placeholder="Search GIFs" bind:value={gifQuery} oninput={onGifQuery} />
  {/if}

  <div class="body">
    {#if loading}
      <p class="muted">Loading…</p>
    {:else if tab === 'emoji'}
      {#each EMOJI_GROUPS as group}
        <p class="group">{group.name}</p>
        <div class="emoji-grid">
          {#each group.emoji as emoji}
            <button class="emoji" onclick={() => onemoji(emoji)}>{emoji}</button>
          {/each}
        </div>
      {/each}
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

  .search {
    flex: none;
    margin: 8px 10px 0;
    padding: 6px 9px;
    font-size: 13px;
    color: var(--text);
    background: color-mix(in srgb, var(--text) 6%, transparent);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .body {
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

  .pill:disabled {
    opacity: 0.6;
    cursor: default;
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
  }

  .emoji:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
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
</style>
