/*
 * The emoji / sticker / GIF picker.
 *
 * Ported from svelte/src/lib/components/Picker.svelte. Three things in here are
 * worth knowing before the next read:
 *
 *  - `body` and the per-section elements were `$state` only because `bind:this`
 *    needed somewhere to write, so they are refs here. The IntersectionObserver
 *    that decides which sections hold buttons cannot be a `useSignalEffect`:
 *    a signal effect runs at the write, before Preact has rendered the new
 *    sections, and the observer has to be handed nodes that exist. It is a
 *    `useEffect` keyed on the things that put those nodes in and out of the DOM.
 *  - `bind:clientWidth` on the emoji grids is `useClientWidth`, a ResizeObserver
 *    attached by callback refs, because the grids mount later than the component
 *    does.
 *  - everything the Svelte file kept in a plain `let` for "once per instance" —
 *    the boot guard, the three search timers, the long-press flag and its timer
 *    — is a ref, because a Preact body runs on every render.
 */
import {Fragment} from 'preact';
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useComputed, useSignal, type Signal} from '@preact/signals';

import {CustomEmoji} from './CustomEmoji';
import {Sticker} from './Sticker';
import {StickerSetSheet} from './StickerSetSheet';
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

import './Picker.css';

interface Props {
  onemoji: (emoji: string) => void;
  ondocument: (docId: string) => void;
  /** A custom emoji picked for the composer — inserted as an entity. */
  oncustomemoji?: (item: {docId: string; emoji: string}) => void;
}

type Tab = 'emoji' | 'custom' | 'stickers' | 'gifs';
type SetsView = 'my' | 'trending' | 'archived';

/**
 * `bind:clientWidth` for the emoji grids — the search-results one and the one
 * inside every section. Each of them wrote the same `gridWidth` in the Svelte
 * original.
 *
 * Attached by a callback ref rather than by an effect, because the grid it
 * measures sits behind the loading / tab / search conditionals and mounts later
 * than the component does; `bind:clientWidth` attached to the element the same
 * way. It returns a factory rather than one callback, for two reasons: the
 * sections each need their own, and Preact keeps a callback ref's cleanup on the
 * function itself, so a shared one would tear the previous grid's observer down
 * every time another grid mounted. The cache is what gives a key the same
 * callback on every render, so no observer is rebuilt for a grid that stayed put.
 */
function useClientWidth(width: Signal<number>) {
  return useMemo(() => {
    const callbacks = new Map<string, (node: HTMLDivElement | null) => void | (() => void)>();

    return (key: string) => {
      let callback = callbacks.get(key);
      if(!callback) {
        callback = (node) => {
          if(!node) return;

          width.value = node.clientWidth;
          const observer = new ResizeObserver(() => (width.value = node.clientWidth));
          observer.observe(node);
          return () => observer.disconnect();
        };
        callbacks.set(key, callback);
      }

      return callback;
    };
  }, []);
}

export function Picker({onemoji, ondocument, oncustomemoji}: Props) {
  const tab = useSignal<Tab>('emoji');
  const loading = useSignal(false);

  /* ---------- stickers ---------- */

  const setsView = useSignal<SetsView>('my');
  const recent = useSignal<StickerItem[]>([]);
  const sets = useSignal<StickerSetInfo[]>([]);
  const featured = useSignal<StickerSetInfo[]>([]);
  const archived = useSignal<StickerSetInfo[]>([]);
  const setStickers = useSignal<Record<string, StickerItem[]>>({});
  const openSet = useSignal<string>('');
  const sheetSet = useSignal<string>('');
  const busySet = useSignal('');

  const setQuery = useSignal('');
  const setResults = useSignal<StickerSetInfo[]>([]);
  const setSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Drag-to-reorder over the installed set rows.
  const dragFrom = useSignal(-1);

  /* ---------- GIFs ---------- */

  const gifs = useSignal<StickerItem[]>([]);
  const gifQuery = useSignal('');
  const gifResults = useSignal<StickerItem[]>([]);
  const gifOffset = useSignal('');
  const gifSearching = useSignal(false);
  const gifSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedGifs = useSignal<Set<string>>(new Set());

  /* ---------- emoji ---------- */

  const EMOJI_CELL = 36;

  const categories = useSignal<EmojiCategory[]>([]);
  const recentEmoji = useSignal<string[]>([]);
  const tones = useSignal<Record<string, number>>({});
  const defaultTone = useSignal(0);
  const query = useSignal('');
  const results = useSignal<EmojiSearchResult[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const body = useRef<HTMLDivElement>(null);
  const gridWidth = useSignal(0);
  const sectionEls = useRef<(HTMLElement | null)[]>([]);
  // Only the sections near the viewport hold buttons; the rest keep their
  // height so the scrollbar and the category jumps stay honest. The full
  // catalogue is ~1900 emoji and mounting it whole makes opening the picker
  // visibly slow.
  const visible = useSignal<Set<string>>(new Set(['recent']));
  const activeCategory = useSignal('recent');

  /** [emoji, variants] while the long-press tone picker is open. */
  const tonePicker = useSignal<{emoji: string; variants: string[]; global: boolean; x: number; y: number} | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressed = useRef(false);

  /* ---------- custom emoji ---------- */

  const customSets = useSignal<CustomEmojiSetItem[]>([]);
  const customSetEmoji = useSignal<Record<string, CustomEmojiItem[]>>({});
  const openCustomSet = useSignal<string>('');
  const recentCustom = useSignal<CustomEmojiItem[]>([]);
  const statusMode = useSignal(false);
  const statusNote = useSignal('');

  const sections = useComputed(() => [
    {id: 'recent', title: 'Recently used', icon: '🕒', emoji: recentEmoji.value},
    ...categories.value
  ]);

  // Whatever grid is on screen writes the same width — the search results and
  // the section grids are mutually exclusive and share `.body`'s padding.
  const gridRef = useClientWidth(gridWidth);

  async function select(next: Tab) {
    tab.value = next;

    if(next === 'emoji' && !categories.value.length) {
      loading.value = true;
      try {
        await initEmojiTones();
        const [catalogue, recents, saved] = await Promise.all([
          loadEmojiCatalogue(),
          loadRecentEmoji(),
          loadEmojiTones()
        ]);
        categories.value = catalogue;
        recentEmoji.value = recents;
        tones.value = saved;
        defaultTone.value = loadDefaultTone();
      } finally {
        loading.value = false;
      }
    } else if(next === 'custom' && !customSets.value.length) {
      loading.value = true;
      try {
        [recentCustom.value, customSets.value] = await Promise.all([
          loadRecentCustomEmoji(),
          loadCustomEmojiSets()
        ]);
      } finally {
        loading.value = false;
      }
    } else if(next === 'stickers' && !recent.value.length && !sets.value.length) {
      loading.value = true;
      try {
        [recent.value, sets.value] = await Promise.all([loadRecentStickers(), loadInstalledSets()]);
      } finally {
        loading.value = false;
      }
    } else if(next === 'gifs' && !gifs.value.length) {
      loading.value = true;
      try {
        [gifs.value, savedGifs.value] = await Promise.all([loadGifs(), savedGifIds()]);
      } finally {
        loading.value = false;
      }
    }
  }

  // The emoji tab is the one that opens first, so it loads itself.
  const booted = useRef(false);
  useEffect(() => {
    if(booted.current) return;
    booted.current = true;
    select('emoji');
  }, []);

  /*
   * Watches the sections to keep `visible` down to what is on screen.
   *
   * The dependencies are the four things that mount or unmount section elements:
   * the tab and the search swap the whole pane out, `loading` is the pass before
   * the categories arrive, and `sections` is the list itself growing from just
   * "recent" to the full catalogue. Svelte re-ran its effect whenever a
   * `bind:this` slot was written; a `useEffect` has to be told the same thing in
   * terms of values.
   */
  useEffect(() => {
    const nodes = sectionEls.current.filter(Boolean) as HTMLElement[];
    const container = body.current;
    if(!nodes.length || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const next = new Set(visible.value);
        for(const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section!;
          if(entry.isIntersecting) next.add(id);
          else next.delete(id);
        }
        visible.value = next;
      },
      {root: container, rootMargin: '250px'}
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [tab.value, query.value, loading.value, sections.value]);

  function onScroll() {
    // The tone popup is anchored to a cell, so scrolling would leave it adrift.
    if(tonePicker.value) tonePicker.value = null;
    const container = body.current;
    if(!container || query.value || tab.value !== 'emoji') return;
    const top = container.scrollTop + 4;
    let current = activeCategory.value;
    for(let i = 0; i < sectionEls.current.length; i++) {
      const node = sectionEls.current[i];
      if(node && node.offsetTop <= top) current = node.dataset.section!;
    }
    activeCategory.value = current;
  }

  function jumpTo(id: string) {
    const index = sections.value.findIndex((section) => section.id === id);
    const node = sectionEls.current[index];
    const container = body.current;
    if(!node || !container) return;
    container.scrollTo({top: node.offsetTop - 4});
    activeCategory.value = id;
  }

  function sectionHeight(count: number) {
    const columns = Math.max(1, Math.floor((gridWidth.value || 340) / EMOJI_CELL));
    return Math.ceil(count / columns) * EMOJI_CELL;
  }

  /** The variant of an emoji this user sees: their own choice, else the default. */
  function toned(emoji: string) {
    const variants = toneVariants(emoji);
    if(!variants) return emoji;
    return applyTone(emoji, tones.value[variants[0]] ?? defaultTone.value);
  }

  function pickEmoji(emoji: string) {
    const value = toned(emoji);
    onemoji(value);
    pushRecentEmoji(value).catch(() => {});
    // Keep the recent row honest without a round-trip through the manager.
    recentEmoji.value = [emoji, ...recentEmoji.value.filter((item) => item !== emoji)].slice(0, 32);
  }

  function pickCustom(item: CustomEmojiItem) {
    if(statusMode.value) {
      statusNote.value = 'Status updated';
      setEmojiStatus(item.docId).catch(() => (statusNote.value = 'Could not set status'));
      return;
    }

    oncustomemoji?.({docId: item.docId, emoji: item.emoji || '🙂'});
    pushRecentEmoji(item.emoji || '', item.docId).catch(() => {});
  }

  function openTonePicker(target: HTMLElement, emoji: string, global: boolean) {
    const variants = toneVariants(emoji);
    if(!variants) return;

    const box = target.getBoundingClientRect();
    const container = body.current?.getBoundingClientRect();
    tonePicker.value = {
      emoji,
      variants,
      global,
      // Positioned inside the scrolling body, which is the offset parent.
      x: Math.max(0, Math.min(box.left - (container?.left ?? 0), (container?.width ?? 0) - 160)),
      y: Math.max(0, box.top - (container?.top ?? 0) + (body.current?.scrollTop ?? 0) - 4)
    };
  }

  /** Click-and-hold on a tone-capable emoji opens its variants. */
  function startPress(event: PointerEvent, emoji: string) {
    if(!toneVariants(emoji)) return;

    pressed.current = false;
    const target = event.currentTarget as HTMLElement;
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      pressed.current = true;
      openTonePicker(target, emoji, false);
    }, 400);
  }

  function endPress() {
    clearTimeout(pressTimer.current);
  }

  function chooseTone(tone: number) {
    const picker = tonePicker.value;
    tonePicker.value = null;
    if(!picker) return;

    if(picker.global) {
      defaultTone.value = tone;
      saveDefaultTone(tone);
      return;
    }

    const base = toneVariants(picker.emoji)?.[0] ?? picker.emoji;
    tones.value = {...tones.value, [base]: tone};
    saveEmojiTone(base, tone).catch(() => {});
  }

  function onQueryInput() {
    clearTimeout(searchTimer.current);
    const q = query.value;
    if(!q.trim()) {
      results.value = [];
      return;
    }

    searchTimer.current = setTimeout(async() => {
      const found = await searchEmoji(q);
      if(q === query.value) results.value = found;
    }, 150);
  }

  async function toggleCustomSet(set: CustomEmojiSetItem) {
    openCustomSet.value = openCustomSet.value === set.id ? '' : set.id;
    if(openCustomSet.value && !customSetEmoji.value[set.id]) {
      customSetEmoji.value = {...customSetEmoji.value, [set.id]: await loadCustomEmojiSet(set.id)};
    }
  }

  async function selectSetsView(next: SetsView) {
    setsView.value = next;
    if(next === 'trending' && !featured.value.length) {
      loading.value = true;
      try {
        featured.value = await loadFeaturedSets();
      } finally {
        loading.value = false;
      }
    } else if(next === 'archived' && !archived.value.length) {
      loading.value = true;
      try {
        archived.value = await loadArchivedSets();
      } finally {
        loading.value = false;
      }
    }
  }

  async function toggleSet(set: StickerSetInfo) {
    openSet.value = openSet.value === set.id ? '' : set.id;
    if(openSet.value && !setStickers.value[set.id]) {
      const preview = await loadSetPreview(set.id);
      setStickers.value = {...setStickers.value, [set.id]: preview?.stickers ?? []};
    }
  }

  /** Install / uninstall, then reconcile whichever lists show this set. */
  async function toggleInstall(set: StickerSetInfo) {
    if(busySet.value) return;
    busySet.value = set.id;
    try {
      const installed = await toggleSetInstalled(set.id);
      const patch = (list: StickerSetInfo[]) =>
        list.map((s) => (s.id === set.id ? {...s, installed, archived: false} : s));

      featured.value = patch(featured.value);
      setResults.value = patch(setResults.value);
      archived.value = installed ? archived.value.filter((s) => s.id !== set.id) : patch(archived.value);

      if(installed) {
        if(!sets.value.some((s) => s.id === set.id)) sets.value = [{...set, installed, archived: false}, ...sets.value];
      } else {
        sets.value = sets.value.filter((s) => s.id !== set.id);
      }
    } finally {
      busySet.value = '';
    }
  }

  function onSetQuery() {
    clearTimeout(setSearchTimer.current);
    const q = setQuery.value.trim();
    if(!q) {
      setResults.value = [];
      return;
    }

    setSearchTimer.current = setTimeout(async() => {
      const found = await searchStickerSets(q);
      if(setQuery.value.trim() === q) setResults.value = found;
    }, 350);
  }

  async function dropSet(to: number) {
    const from = dragFrom.value;
    dragFrom.value = -1;
    if(from < 0 || from === to) return;

    const next = [...sets.value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    sets.value = next;

    try {
      await reorderSets(next.map((s) => s.id));
    } catch (err) {
      // The server keeps the old order; refetching would fight the drag.
    }
  }

  async function forgetRecent(sticker: StickerItem) {
    recent.value = recent.value.filter((s) => s.docId !== sticker.docId);
    try {
      await removeRecentSticker(sticker.docId);
    } catch (err) {}
  }

  async function forgetAllRecent() {
    recent.value = [];
    try {
      await clearRecentStickers();
    } catch (err) {}
  }

  function onGifQuery() {
    clearTimeout(gifSearchTimer.current);
    const q = gifQuery.value.trim();
    if(!q) {
      gifResults.value = [];
      gifOffset.value = '';
      return;
    }

    gifSearchTimer.current = setTimeout(async() => {
      gifSearching.value = true;
      try {
        const found = await searchGifs(q);
        if(gifQuery.value.trim() !== q) return;
        gifResults.value = found.items;
        gifOffset.value = found.nextOffset;
      } finally {
        gifSearching.value = false;
      }
    }, 350);
  }

  async function moreGifs() {
    if(!gifOffset.value || gifSearching.value) return;
    gifSearching.value = true;
    try {
      const found = await searchGifs(gifQuery.value.trim(), gifOffset.value);
      gifResults.value = [...gifResults.value, ...found.items];
      gifOffset.value = found.nextOffset;
    } finally {
      gifSearching.value = false;
    }
  }

  async function toggleGif(sticker: StickerItem) {
    const save = !savedGifs.value.has(sticker.docId);
    const previous = savedGifs.value;
    const next = new Set(savedGifs.value);
    if(save) next.add(sticker.docId);
    else next.delete(sticker.docId);
    savedGifs.value = next;

    try {
      await toggleSavedGif(sticker.docId, save);
      if(save) {
        if(!gifs.value.some((g) => g.docId === sticker.docId)) gifs.value = [sticker, ...gifs.value];
      } else {
        gifs.value = gifs.value.filter((g) => g.docId !== sticker.docId);
      }
    } catch (err) {
      savedGifs.value = previous;
    }
  }

  // The `{#if} {:else if} … {/if}` chain that picked the pane's header, resolved
  // before the single return. The custom-emoji tab has none.
  let header: preact.JSX.Element | undefined;

  if(tab.value === 'emoji') {
    header = (
      <>
        <div class="search-row">
          <input
            class="search"
            placeholder="Search emoji"
            value={query.value}
            onInput={(e) => {
              query.value = (e.target as HTMLInputElement).value;
              onQueryInput();
            }}
          />
          <button
            class="tone-chip"
            title="Default skin tone"
            onClick={(e) => openTonePicker(e.currentTarget as HTMLElement, '✋', true)}
          >{applyTone('✋', defaultTone.value)}</button>
        </div>

        {!query.value && (
          <div class="category-tabs">
            {sections.value.map((section) => (
              <button
                key={section.id}
                class={activeCategory.value === section.id ? 'active' : ''}
                title={section.title}
                onClick={() => jumpTo(section.id)}
              >{section.icon}</button>
            ))}
          </div>
        )}
      </>
    );
  } else if(tab.value === 'stickers') {
    header = (
      <>
        <div class="subtabs">
          <button class={setsView.value === 'my' ? 'active' : ''} onClick={() => selectSetsView('my')}>My</button>
          <button class={setsView.value === 'trending' ? 'active' : ''} onClick={() => selectSetsView('trending')}>Trending</button>
          <button class={setsView.value === 'archived' ? 'active' : ''} onClick={() => selectSetsView('archived')}>Archived</button>
        </div>
        <input
          class="pane-search"
          placeholder="Search sticker sets"
          value={setQuery.value}
          onInput={(e) => {
            setQuery.value = (e.target as HTMLInputElement).value;
            onSetQuery();
          }}
        />
      </>
    );
  } else if(tab.value === 'gifs') {
    header = (
      <input
        class="pane-search"
        placeholder="Search GIFs"
        value={gifQuery.value}
        onInput={(e) => {
          gifQuery.value = (e.target as HTMLInputElement).value;
          onGifQuery();
        }}
      />
    );
  }

  // `{@const list = …}` from the GIF branch, hoisted above the markup.
  const list = gifQuery.value.trim() ? gifResults.value : gifs.value;

  // The `{#if} {:else if} … {:else} {/if}` chain that picked what fills the body,
  // resolved before the single return.
  let pane: preact.JSX.Element;

  if(loading.value) {
    pane = <p class="muted">Loading…</p>;
  } else if(tab.value === 'emoji') {
    if(query.value) {
      pane = results.value.length ?
        <div class="emoji-grid" ref={gridRef('results')}>
          {results.value.map((result) => (
            result.docId ?
              <button
                key={result.docId || result.emoji}
                class="emoji"
                onClick={() => pickCustom({docId: result.docId, emoji: result.emoji, kind: 'static'})}
              >
                <CustomEmoji docId={result.docId} size={26} fallback={result.emoji} />
              </button> :
              <button key={result.docId || result.emoji} class="emoji" onClick={() => pickEmoji(result.emoji)}>{toned(result.emoji)}</button>
          ))}
        </div> :
        <p class="muted">Nothing found.</p>;
    } else {
      pane = (
        <>
          {sections.value.map((section, index) => (
            <section
              key={section.id}
              ref={(node) => {
                sectionEls.current[index] = node;
              }}
              data-section={section.id}
            >
              <p class="group sticky">{section.title}</p>
              {visible.value.has(section.id) ?
                <div class="emoji-grid" ref={gridRef(section.id)}>
                  {section.emoji.map((emoji) => (
                    <button
                      key={emoji}
                      class="emoji"
                      onClick={() => (pressed.current ? (pressed.current = false) : pickEmoji(emoji))}
                      onPointerDown={(e) => startPress(e, emoji)}
                      onPointerUp={endPress}
                      onPointerLeave={endPress}
                      onContextMenu={(e) => e.preventDefault()}
                    >{toned(emoji)}</button>
                  ))}
                </div> :
                <div class="placeholder-grid" style={{height: `${sectionHeight(section.emoji.length)}px`}}></div>}
            </section>
          ))}
        </>
      );
    }
  } else if(tab.value === 'custom') {
    pane = (
      <>
        <div class="status-row">
          <button
            class={['status-toggle', statusMode.value && 'on'].filter(Boolean).join(' ')}
            onClick={() => (statusMode.value = !statusMode.value)}
          >
            {statusMode.value ? 'Picking a status…' : 'Set as status'}
          </button>
          {statusMode.value && (
            <button class="status-clear" onClick={() => {
              statusNote.value = 'Status cleared';
              setEmojiStatus('').catch(() => (statusNote.value = 'Could not clear status'));
            }}>Clear</button>
          )}
          {statusNote.value && <span class="muted inline">{statusNote.value}</span>}
        </div>

        {recentCustom.value.length > 0 && (
          <>
            <p class="group">Recently used</p>
            <div class="emoji-grid">
              {recentCustom.value.map((item) => (
                <button key={item.docId} class="emoji" onClick={() => pickCustom(item)}>
                  <CustomEmoji docId={item.docId} size={28} fallback={item.emoji} />
                </button>
              ))}
            </div>
          </>
        )}

        {customSets.value.map((set) => (
          <Fragment key={set.id}>
            <button class="group set" onClick={() => toggleCustomSet(set)}>
              {openCustomSet.value === set.id ? '▾' : '▸'} {set.title} ({set.count})
            </button>
            {openCustomSet.value === set.id && (
              <div class="emoji-grid">
                {(customSetEmoji.value[set.id] ?? []).map((item) => (
                  <button key={item.docId} class="emoji" onClick={() => pickCustom(item)}>
                    <CustomEmoji docId={item.docId} size={28} fallback={item.emoji} />
                  </button>
                ))}
              </div>
            )}
          </Fragment>
        ))}

        {!customSets.value.length && !recentCustom.value.length && (
          <p class="muted">No custom emoji sets. Custom emoji come with Telegram Premium.</p>
        )}
      </>
    );
  } else if(tab.value === 'stickers') {
    if(setQuery.value.trim()) {
      pane = (
        <>
          {setResults.value.map((set) => (
            <div key={set.id} class="set-row">
              <button class="set-open" onClick={() => (sheetSet.value = set.shortName || set.id)}>
                {set.cover && <Sticker sticker={set.cover} size={28} />}
                <span class="set-title">{set.title}</span>
              </button>
              <button class="pill" disabled={busySet.value === set.id} onClick={() => toggleInstall(set)}>
                {set.installed ? 'Remove' : 'Add'}
              </button>
            </div>
          ))}
          {!setResults.value.length && <p class="muted">No sets found.</p>}
        </>
      );
    } else if(setsView.value === 'trending') {
      pane = (
        <>
          {featured.value.map((set) => (
            <div key={set.id} class="set-row">
              <button class="set-open" onClick={() => (sheetSet.value = set.shortName || set.id)}>
                {set.cover && <Sticker sticker={set.cover} size={28} />}
                <span class="set-title">{set.title}</span>
              </button>
              <button class="pill" disabled={busySet.value === set.id} onClick={() => toggleInstall(set)}>
                {set.installed ? 'Added' : 'Add'}
              </button>
            </div>
          ))}
          {!featured.value.length && <p class="muted">Nothing trending right now.</p>}
        </>
      );
    } else if(setsView.value === 'archived') {
      pane = (
        <>
          {archived.value.map((set) => (
            <div key={set.id} class="set-row">
              <button class="set-open" onClick={() => (sheetSet.value = set.shortName || set.id)}>
                {set.cover && <Sticker sticker={set.cover} size={28} />}
                <span class="set-title">{set.title}</span>
              </button>
              <button class="pill" disabled={busySet.value === set.id} onClick={() => toggleInstall(set)}>
                Restore
              </button>
            </div>
          ))}
          {!archived.value.length && <p class="muted">No archived sets.</p>}
        </>
      );
    } else {
      pane = (
        <>
          {recent.value.length > 0 && (
            <>
              <p class="group">
                {/* Svelte emitted "Recent " with a space; JSX trims it. */}
                Recent{' '}
                <button class="link" onClick={forgetAllRecent}>Clear</button>
              </p>
              <div class="sticker-grid">
                {recent.value.map((sticker) => (
                  <div key={sticker.docId} class="recent-tile">
                    <button onClick={() => ondocument(sticker.docId)}>
                      <Sticker sticker={sticker} size={64} />
                    </button>
                    <button
                      class="forget"
                      title="Remove from recent"
                      aria-label="Remove from recent"
                      onClick={() => forgetRecent(sticker)}
                    >✕</button>
                  </div>
                ))}
              </div>
            </>
          )}
          {sets.value.map((set, i) => (
            <Fragment key={set.id}>
              <div
                class={['set-row', dragFrom.value === i && 'dragging'].filter(Boolean).join(' ')}
                draggable={true}
                role="listitem"
                onDragStart={() => (dragFrom.value = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dropSet(i);
                }}
              >
                <button class="set-open" onClick={() => toggleSet(set)}>
                  <span class="handle">⠿</span>
                  <span class="set-title">{openSet.value === set.id ? '▾' : '▸'} {set.title} ({set.count})</span>
                </button>
                <button class="pill" disabled={busySet.value === set.id} onClick={() => toggleInstall(set)}>
                  Remove
                </button>
              </div>
              {openSet.value === set.id && (
                <div class="sticker-grid">
                  {(setStickers.value[set.id] ?? []).map((sticker) => (
                    <button key={sticker.docId} onClick={() => ondocument(sticker.docId)}>
                      <Sticker sticker={sticker} size={64} />
                    </button>
                  ))}
                </div>
              )}
            </Fragment>
          ))}
          {!recent.value.length && !sets.value.length && (
            <p class="muted">No stickers.</p>
          )}
        </>
      );
    }
  } else {
    pane = (
      <>
        <div class="gif-grid">
          {list.map((gif) => (
            <div key={gif.docId} class="gif-tile">
              <button onClick={() => ondocument(gif.docId)}>
                <Sticker sticker={gif} size={110} />
              </button>
              <button
                class="save"
                title={savedGifs.value.has(gif.docId) ? 'Remove from saved' : 'Save GIF'}
                aria-label={savedGifs.value.has(gif.docId) ? 'Remove from saved' : 'Save GIF'}
                onClick={() => toggleGif(gif)}
              >{savedGifs.value.has(gif.docId) ? '★' : '☆'}</button>
            </div>
          ))}
        </div>
        {gifSearching.value ?
          <p class="muted">Searching…</p> :
          !list.length ?
            <p class="muted">{gifQuery.value.trim() ? 'Nothing found.' : 'No saved GIFs.'}</p> :
            gifQuery.value.trim() && gifOffset.value ?
              <button class="more" onClick={moreGifs}>Load more</button> :
              null}
      </>
    );
  }

  return (
    <>
      <div class="picker">
        <div class="tabs">
          <button class={tab.value === 'emoji' ? 'active' : ''} onClick={() => select('emoji')}>Emoji</button>
          <button class={tab.value === 'custom' ? 'active' : ''} onClick={() => select('custom')}>Custom</button>
          <button class={tab.value === 'stickers' ? 'active' : ''} onClick={() => select('stickers')}>Stickers</button>
          <button class={tab.value === 'gifs' ? 'active' : ''} onClick={() => select('gifs')}>GIFs</button>
        </div>

        {header}

        <div class="body" ref={body} onScroll={onScroll}>
          {pane}

          {tonePicker.value && (
            /* The original carried the equivalent a11y_no_static_element_interactions
               svelte-ignore here: the popup only closes on pointerleave and holds no
               interactive-but-static element of its own. */
            <div
              class="tone-picker"
              style={{left: `${tonePicker.value.x}px`, top: `${tonePicker.value.y}px`}}
              onPointerLeave={() => (tonePicker.value = null)}
            >
              {tonePicker.value.variants.map((variant, tone) => (
                <button key={variant} onClick={() => chooseTone(tone)}>{variant}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {sheetSet.value && (
        <StickerSetSheet
          setKey={sheetSet.value}
          onsend={ondocument}
          onclose={() => (sheetSet.value = '')}
        />
      )}
    </>
  );
}
