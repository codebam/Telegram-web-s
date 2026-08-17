<script lang="ts">
  import VideoPlayer from './VideoPlayer.svelte';
  import {deleteMessages, saveMediaToDisk, type MessageItem} from '$lib/telegram/chats';
  import {
    loadMediaPage,
    loadViewerMedia,
    loadViewerThumb,
    mediaCount,
    messageLink,
    videoQualities,
    type VideoQuality,
    type ViewerItem
  } from '$lib/telegram/viewer';

  /**
   * The media viewer.
   *
   * The list it pages through starts as whatever the timeline has loaded, then
   * grows in both directions from the chat's photo/video history — paging past
   * the loaded window is the normal case in a chat with any history at all, so
   * the viewer owns its own list rather than the caller's array.
   */
  let {
    peerId,
    items,
    index = $bindable(),
    threadId,
    onclose,
    onforward,
    onjump
  }: {
    peerId: number;
    items: MessageItem[];
    index: number;
    threadId?: number;
    onclose: () => void;
    /** Hands the message back to the chat's forward flow. */
    onforward?: (message: MessageItem) => void;
    /** Closes the viewer and scrolls the chat to this message. */
    onjump?: (mid: number) => void;
  } = $props();

  function toViewer(message: MessageItem): ViewerItem {
    return {
      peerId,
      mid: message.mid,
      kind: (message.media?.kind ?? 'photo') as ViewerItem['kind'],
      date: message.date,
      fromId: message.fromId,
      fromTitle: message.out ? 'You' : message.fromTitle,
      caption: message.text,
      out: message.out,
      width: message.media?.width ?? 0,
      height: message.media?.height ?? 0,
      duration: message.media?.duration ?? 0,
      size: message.media?.size ?? 0,
      fileName: message.media?.name ?? ''
    };
  }

  // Seeded once: `items` keeps changing as the chat loads, and re-seeding would
  // throw away the pages this viewer fetched itself.
  let list = $state<ViewerItem[]>(items.map(toViewer));
  let pos = $state(index);
  let total = $state(items.length);

  let url = $state<string | null>(null);
  let failed = $state(false);
  let qualities = $state<VideoQuality[]>([]);
  let quality = $state('');
  let notice = $state('');
  let busy = $state(false);
  let loadingOlder = false;
  let loadingNewer = false;
  let thumbs = $state<Record<number, string>>({});
  /** Deliberately outside reactivity: these only stop work being repeated. */
  const thumbRequested = new Set<number>();
  const pagedFrom = new Set<string>();

  const current = $derived(list[pos]);

  $effect(() => {
    mediaCount(peerId, threadId).then((count) => {
      if (count) total = count;
    });
  });

  $effect(() => {
    const item = current;
    if (!item) return;

    url = null;
    failed = false;
    quality = '';
    qualities = [];
    resetZoom();

    loadViewerMedia(item.peerId, item.mid).then((resolved) => {
      if (current?.mid !== item.mid) return;
      url = resolved;
      failed = !resolved;
    });

    if (item.kind === 'video') {
      videoQualities(item.peerId, item.mid).then((found) => {
        if (current?.mid === item.mid) qualities = found;
      });
    }
  });

  // Keeps the caller's index meaningful while the current item is still one of
  // the messages it handed over. Separate from the loader above so a timeline
  // update never restarts the download.
  $effect(() => {
    const item = current;
    if (!item) return;
    const original = items.findIndex((message) => message.mid === item.mid);
    if (original >= 0) index = original;
  });

  /** Paging near either end pulls the next page of the chat's media history. */
  $effect(() => {
    const at = pos;
    if (!list.length) return;

    const oldest = list[0].mid;
    const newest = list[list.length - 1].mid;

    if (at <= 1 && !loadingOlder && !pagedFrom.has(`older_${oldest}`)) {
      loadingOlder = true;
      pagedFrom.add(`older_${oldest}`);
      loadMediaPage(peerId, oldest, 'older', {threadId})
        .then((older) => {
          const known = new Set(list.map((item) => item.mid));
          const fresh = older.filter((item) => !known.has(item.mid));
          if (fresh.length) {
            list = [...fresh, ...list];
            pos += fresh.length;
          }
        })
        .catch(() => {})
        .finally(() => (loadingOlder = false));
    }

    if (at >= list.length - 2 && !loadingNewer && !pagedFrom.has(`newer_${newest}`)) {
      loadingNewer = true;
      pagedFrom.add(`newer_${newest}`);
      loadMediaPage(peerId, newest, 'newer', {threadId})
        .then((newer) => {
          const known = new Set(list.map((item) => item.mid));
          const fresh = newer.filter((item) => !known.has(item.mid));
          if (fresh.length) list = [...list, ...fresh];
        })
        .catch(() => {})
        .finally(() => (loadingNewer = false));
    }
  });

  /** Filmstrip posters for what is near the cursor, a few either side. */
  $effect(() => {
    const from = Math.max(0, pos - 6);
    const to = Math.min(list.length, pos + 7);
    for (let i = from; i < to; i++) {
      const item = list[i];
      if (!item || thumbRequested.has(item.mid)) continue;
      thumbRequested.add(item.mid);
      loadViewerThumb(item.peerId, item.mid).then((resolved) => {
        if (resolved) thumbs = {...thumbs, [item.mid]: resolved};
      });
    }
  });

  function step(delta: number) {
    const next = pos + delta;
    if (next >= 0 && next < list.length) pos = next;
  }

  /* ---------------------------------------------------------------- */
  /* Zoom and pan                                                      */
  /* ---------------------------------------------------------------- */

  let scale = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);

  const MAX_SCALE = 6;

  function resetZoom() {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
  }

  function zoomBy(factor: number) {
    const next = Math.max(1, Math.min(MAX_SCALE, scale * factor));
    if (next === 1) {
      resetZoom();
      return;
    }
    scale = next;
  }

  function onWheel(e: WheelEvent) {
    // Ctrl+wheel is the pinch gesture a trackpad sends; a plain wheel zooms
    // too, since there is nothing to scroll behind the viewer.
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  function onDoubleClick() {
    if (scale > 1) resetZoom();
    else scale = 2.5;
  }

  const pointers = new Map<number, {x: number; y: number}>();
  let pinchStart = 0;
  let pinchScale = 1;
  let dragFrom: {x: number; y: number; offsetX: number; offsetY: number} | null = null;
  let swipeFrom = 0;

  function distance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});

    if (pointers.size === 2) {
      pinchStart = distance();
      pinchScale = scale;
      dragFrom = null;
      return;
    }

    dragFrom = {x: e.clientX, y: e.clientY, offsetX, offsetY};
    swipeFrom = e.clientX;
  }

  function onPointerMove(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});

    if (pointers.size === 2 && pinchStart) {
      zoomTo(pinchScale * (distance() / pinchStart));
      return;
    }

    if (!dragFrom) return;

    if (scale > 1) {
      offsetX = dragFrom.offsetX + (e.clientX - dragFrom.x);
      offsetY = dragFrom.offsetY + (e.clientY - dragFrom.y);
    }
  }

  function zoomTo(value: number) {
    scale = Math.max(1, Math.min(MAX_SCALE, value));
    if (scale === 1) {
      offsetX = 0;
      offsetY = 0;
    }
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;

    // Unzoomed, a horizontal drag pages the viewer — the gesture every gallery
    // has. Zoomed in, the same drag was a pan and must not change item.
    if (scale === 1 && dragFrom) {
      const travel = e.clientX - swipeFrom;
      if (Math.abs(travel) > 60) step(travel < 0 ? 1 : -1);
    }

    dragFrom = null;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  function flash(message: string) {
    notice = message;
    setTimeout(() => {
      if (notice === message) notice = '';
    }, 2200);
  }

  async function download() {
    if (!current || busy) return;
    busy = true;
    try {
      await saveMediaToDisk(current.peerId, current.mid);
    } catch (err: any) {
      flash(err?.type || err?.message || 'Download failed');
    } finally {
      busy = false;
    }
  }

  async function copyLink() {
    if (!current) return;
    const link = await messageLink(current.peerId, current.mid, threadId);
    if (!link) {
      flash('This chat has no public link');
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      flash('Link copied');
    } catch (err) {
      flash(link);
    }
  }

  async function remove() {
    if (!current) return;
    if (!confirm('Delete this media for everyone?')) return;

    const {mid} = current;
    try {
      await deleteMessages(current.peerId, [mid]);
    } catch (err: any) {
      flash(err?.type || err?.message || 'Could not delete');
      return;
    }

    const next = list.filter((item) => item.mid !== mid);
    if (!next.length) {
      onclose();
      return;
    }

    list = next;
    pos = Math.min(pos, next.length - 1);
  }

  function forward() {
    if (!current) return;
    const message = items.find((item) => item.mid === current.mid);
    if (message && onforward) {
      onforward(message);
      onclose();
    } else {
      flash('Open it in the chat to forward');
    }
  }

  function openInChat() {
    if (!current) return;
    onjump?.(current.mid);
    onclose();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === '+' || e.key === '=') zoomBy(1.25);
    else if (e.key === '-') zoomBy(1 / 1.25);
    else if (e.key === '0') resetZoom();
    else if (e.key === 'd') download();
  }

  function stamp(date: number) {
    if (!date) return '';
    return new Date(date * 1000).toLocaleString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" onclick={onclose} role="presentation">
  <header class="top" onclick={(e) => e.stopPropagation()} role="presentation">
    <div class="who">
      <span class="from">{current?.fromTitle || ''}</span>
      <span class="when">{stamp(current?.date ?? 0)}</span>
    </div>

    <span class="counter">{pos + 1} of {Math.max(total, list.length)}</span>

    <div class="actions">
      <button class="action" onclick={forward} aria-label="Forward" title="Forward">
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M11 4l5 4-5 4V9.5C7 9.5 5 11 4 14c0-5 3-7 7-7V4z" />
        </svg>
      </button>

      <button class="action" onclick={download} disabled={busy} aria-label="Save as" title="Save as">
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M10 3.4v8.8M10 12.2L6.4 8.6M10 12.2l3.6-3.6" />
          <path d="M4.4 14.2v1.2a1.4 1.4 0 001.4 1.4h8.4a1.4 1.4 0 001.4-1.4v-1.2" />
        </svg>
      </button>

      <button class="action" onclick={copyLink} aria-label="Copy link" title="Copy link">
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8.5 11.5a3 3 0 004.2 0l2.3-2.3a3 3 0 10-4.2-4.2l-1 1" />
          <path d="M11.5 8.5a3 3 0 00-4.2 0L5 10.8a3 3 0 104.2 4.2l1-1" />
        </svg>
      </button>

      <button class="action" onclick={openInChat} aria-label="Show in chat" title="Show in chat">
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M16.5 10c0 3.3-2.9 5.9-6.5 5.9-.9 0-1.7-.1-2.5-.4L3.5 16.5l1.1-3.6A5.7 5.7 0 013.5 10c0-3.3 2.9-5.9 6.5-5.9s6.5 2.6 6.5 5.9z" />
        </svg>
      </button>

      {#if current?.out}
        <button class="action" onclick={remove} aria-label="Delete" title="Delete">
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4.5 5.5h11M8 5.5V4h4v1.5M6 5.5l.7 10.1a1 1 0 001 .9h4.6a1 1 0 001-.9L14 5.5" />
          </svg>
        </button>
      {/if}

      <button class="action" onclick={onclose} aria-label="Close" title="Close">
        <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2" />
        </svg>
      </button>
    </div>
  </header>

  <div
    class="stage"
    onclick={(e) => e.stopPropagation()}
    ondblclick={onDoubleClick}
    onwheel={onWheel}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    role="presentation"
  >
    <div
      class="viewport"
      class:zoomed={scale > 1}
      style="transform: translate({offsetX}px, {offsetY}px) scale({scale})"
    >
      {#if failed}
        <p class="muted">This media could not be loaded.</p>
      {:else if !url}
        <p class="muted">Loading…</p>
      {:else if current?.kind === 'gif'}
        <!-- A GIF is a silent looping mp4, so it needs a <video> here just as it
             does in the bubble — an <img> pointed at it renders nothing. -->
        <!-- svelte-ignore a11y_media_has_caption -->
        <video src={url} autoplay loop muted playsinline></video>
      {:else if current?.kind === 'video'}
        <VideoPlayer
          src={url}
          {qualities}
          activeQuality={quality}
          onquality={(docId) => {
            quality = docId;
            const item = current;
            url = null;
            loadViewerMedia(item.peerId, item.mid, docId || undefined).then((resolved) => {
              if (current?.mid === item.mid) url = resolved;
            });
          }}
        />
      {:else}
        <img src={url} alt={current?.caption || ''} draggable="false" />
      {/if}
    </div>
  </div>

  {#if current?.caption}
    <p class="caption" onclick={(e) => e.stopPropagation()} role="presentation">{current.caption}</p>
  {/if}

  {#if list.length > 1}
    <div class="filmstrip" onclick={(e) => e.stopPropagation()} role="presentation">
      {#each list as item, i (item.mid)}
        <button
          class="frame"
          class:on={i === pos}
          onclick={() => (pos = i)}
          aria-label="Item {i + 1}"
          aria-current={i === pos}
        >
          {#if thumbs[item.mid]}
            <img src={thumbs[item.mid]} alt="" />
          {/if}
          {#if item.kind !== 'photo'}
            <span class="badge">▶</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if pos > 0}
    <button class="nav prev" onclick={(e) => { e.stopPropagation(); step(-1); }} aria-label="Previous">‹</button>
  {/if}
  {#if pos < list.length - 1}
    <button class="nav next" onclick={(e) => { e.stopPropagation(); step(1); }} aria-label="Next">›</button>
  {/if}

  {#if notice}
    <p class="notice">{notice}</p>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.92);
    display: grid;
    grid-template-rows: auto 1fr auto auto;
    z-index: 100;
    color: #fff;
    overflow: hidden;
    touch-action: none;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
  }

  .who {
    display: grid;
    min-width: 0;
  }

  .from {
    font-size: 14px;
    font-weight: 500;
  }

  .when {
    font-size: 12px;
    opacity: 0.6;
  }

  .counter {
    margin-left: auto;
    font-size: 13px;
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .action {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #fff;
    cursor: pointer;
    padding: 0;
  }

  .action svg {
    width: 20px;
    height: 20px;
  }

  .action:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .action:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .stage {
    display: grid;
    place-items: center;
    overflow: hidden;
    min-height: 0;
  }

  .viewport {
    display: grid;
    place-items: center;
    transform-origin: center center;
    will-change: transform;
  }

  .viewport.zoomed {
    cursor: grab;
  }

  img,
  .viewport video {
    max-width: 92vw;
    max-height: 78vh;
    object-fit: contain;
    display: block;
    user-select: none;
  }

  .caption {
    margin: 0;
    padding: 8px 16px;
    max-height: 20vh;
    overflow-y: auto;
    font-size: 14px;
    line-height: 1.4;
    text-align: center;
    white-space: pre-wrap;
  }

  .filmstrip {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 8px 16px 12px;
    scrollbar-width: thin;
  }

  .frame {
    position: relative;
    flex: none;
    width: 56px;
    height: 44px;
    border-radius: 6px;
    overflow: hidden;
    border: 2px solid transparent;
    background: rgba(255, 255, 255, 0.12);
    padding: 0;
    cursor: pointer;
  }

  .frame.on {
    border-color: var(--accent, #3390ec);
  }

  .frame img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    max-width: none;
    max-height: none;
  }

  .badge {
    position: absolute;
    right: 3px;
    bottom: 1px;
    font-size: 10px;
    text-shadow: 0 1px 2px #000;
  }

  .nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: rgba(255, 255, 255, 0.12);
    border: none;
    color: #fff;
    cursor: pointer;
    border-radius: 50%;
    width: 44px;
    height: 44px;
    font-size: 26px;
    line-height: 1;
  }

  .nav:hover {
    background: rgba(255, 255, 255, 0.22);
  }

  .prev {
    left: 20px;
  }

  .next {
    right: 20px;
  }

  .muted {
    color: rgba(255, 255, 255, 0.7);
  }

  .notice {
    position: absolute;
    left: 50%;
    bottom: 96px;
    transform: translateX(-50%);
    margin: 0;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.75);
    font-size: 13px;
  }
</style>
