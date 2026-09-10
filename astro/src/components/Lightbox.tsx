/*
 * The media viewer.
 *
 * The list it pages through starts as whatever the timeline has loaded, then
 * grows in both directions from the chat's photo/video history — paging past
 * the loaded window is the normal case in a chat with any history at all, so
 * the viewer owns its own list rather than the caller's array.
 *
 * Ported from svelte/src/lib/components/Lightbox.svelte. `index` was a
 * `$bindable()` prop; it stays a prop with the same name and every write of it
 * now goes out through `onIndexChange`, which the call site passes alongside it.
 *
 * The `$effect`s are split by what they read, because that is what decides which
 * hook each becomes (CONVERSION.md §4). Three of them read a *prop* — `peerId`
 * and `threadId` for the counter and the paging, `items` for the caller's index —
 * and a prop read is invisible to `useSignalEffect`, so those are `useEffect`s
 * with the props, and the signal values they also follow, in the dependency list.
 * The loader and the filmstrip posters read signals and nothing else and stay
 * `useSignalEffect`.
 *
 * Everything Svelte kept in a plain `let` — `loadingOlder`, `loadingNewer`,
 * `pinchStart`, `pinchScale`, `dragFrom`, `swipeFrom` — is a ref here: nothing
 * renders from them, and a plain local in a Preact body would be reset on every
 * render.
 */
import {useEffect, useMemo, useRef} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {VideoPlayer} from './VideoPlayer';
import {deleteMessages, saveMediaToDisk, type MessageItem} from '$lib/telegram/chats';
import {
  invalidateViewerMedia,
  loadMediaPage,
  loadViewerMedia,
  loadViewerThumb,
  mediaCount,
  messageLink,
  videoQualities,
  type VideoQuality,
  type ViewerItem
} from '$lib/telegram/viewer';
import {staleUrlRetry} from '$lib/telegram/staleUrl';

import './Lightbox.css';

interface Props {
  peerId: number;
  items: MessageItem[];
  index: number;
  threadId?: number;
  onclose: () => void;
  /** Hands the message back to the chat's forward flow. */
  onforward?: (message: MessageItem) => void;
  /** Closes the viewer and scrolls the chat to this message. */
  onjump?: (mid: number) => void;
  /** What `bind:index` used to write: the caller's index of the current item. */
  onIndexChange?: (index: number) => void;
}

export function Lightbox({
  peerId,
  items,
  index,
  threadId,
  onclose,
  onforward,
  onjump,
  onIndexChange
}: Props) {
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
  // throw away the pages this viewer fetched itself. The `useMemo` with an empty
  // dependency list is what keeps the seed to the first render — a signal only
  // takes its initial value once, but the expression would be re-evaluated on
  // every render otherwise.
  const list = useSignal<ViewerItem[]>(useMemo(() => items.map(toViewer), []));
  const pos = useSignal(index);
  const total = useSignal(items.length);

  const url = useSignal<string | null>(null);
  const failed = useSignal(false);
  const qualities = useSignal<VideoQuality[]>([]);
  const quality = useSignal('');
  const notice = useSignal('');
  const busy = useSignal(false);
  const loadingOlder = useRef(false);
  const loadingNewer = useRef(false);
  const thumbs = useSignal<Record<number, string>>({});
  const retry = useMemo(() => staleUrlRetry(), []);
  /** Deliberately outside reactivity: these only stop work being repeated. */
  const thumbRequested = useMemo(() => new Set<number>(), []);
  const thumbRetried = useMemo(() => new Set<number>(), []);
  const pagedFrom = useMemo(() => new Set<string>(), []);

  const current = useComputed(() => list.value[pos.value]);

  // Reads the `peerId`/`threadId` props, not a signal, so this takes them in its
  // dependency list rather than being a `useSignalEffect`.
  useEffect(() => {
    mediaCount(peerId, threadId).then((count) => {
      if(count) total.value = count;
    });
  }, [peerId, threadId]);

  useSignalEffect(() => {
    const item = current.value;
    if(!item) return;

    url.value = null;
    failed.value = false;
    quality.value = '';
    qualities.value = [];
    retry.reset();
    resetZoom();

    loadViewerMedia(item.peerId, item.mid).then((resolved) => {
      if(current.value?.mid !== item.mid) return;
      url.value = resolved;
      failed.value = !resolved;
    });

    if(item.kind === 'video') {
      videoQualities(item.peerId, item.mid).then((found) => {
        if(current.value?.mid === item.mid) qualities.value = found;
      });
    }
  });

  // Keeps the caller's index meaningful while the current item is still one of
  // the messages it handed over. Separate from the loader above so a timeline
  // update never restarts the download. It reads both a signal (`current`) and
  // the `items` prop, so both are in the dependency list; `onIndexChange` is the
  // port of the write the binding used to do, and the effect only writes through
  // it, so it is not a dependency.
  useEffect(() => {
    const item = current.value;
    if(!item) return;
    const original = items.findIndex((message) => message.mid === item.mid);
    if(original >= 0) onIndexChange?.(original);
  }, [items, current.value]);

  /**
   * Paging near either end pulls the next page of the chat's media history.
   *
   * It pages the `pos`/`list` signals but asks the *props* `peerId`/`threadId`
   * for the page, so it is a `useEffect` carrying both: a `useSignalEffect` would
   * never notice a new peer.
   */
  useEffect(() => {
    const at = pos.value;
    if(!list.value.length) return;

    const oldest = list.value[0].mid;
    const newest = list.value[list.value.length - 1].mid;

    if(at <= 1 && !loadingOlder.current && !pagedFrom.has(`older_${oldest}`)) {
      loadingOlder.current = true;
      pagedFrom.add(`older_${oldest}`);
      loadMediaPage(peerId, oldest, 'older', {threadId})
        .then((older) => {
          const known = new Set(list.value.map((item) => item.mid));
          const fresh = older.filter((item) => !known.has(item.mid));
          if(fresh.length) {
            list.value = [...fresh, ...list.value];
            pos.value += fresh.length;
          }
        })
        .catch(() => {})
        .finally(() => (loadingOlder.current = false));
    }

    if(at >= list.value.length - 2 && !loadingNewer.current && !pagedFrom.has(`newer_${newest}`)) {
      loadingNewer.current = true;
      pagedFrom.add(`newer_${newest}`);
      loadMediaPage(peerId, newest, 'newer', {threadId})
        .then((newer) => {
          const known = new Set(list.value.map((item) => item.mid));
          const fresh = newer.filter((item) => !known.has(item.mid));
          if(fresh.length) list.value = [...list.value, ...fresh];
        })
        .catch(() => {})
        .finally(() => (loadingNewer.current = false));
    }
  }, [peerId, threadId, pos.value, list.value]);

  /** Filmstrip posters for what is near the cursor, a few either side. */
  useSignalEffect(() => {
    const from = Math.max(0, pos.value - 6);
    const to = Math.min(list.value.length, pos.value + 7);
    for(let i = from; i < to; i++) {
      const item = list.value[i];
      if(!item || thumbRequested.has(item.mid)) continue;
      thumbRequested.add(item.mid);
      loadViewerThumb(item.peerId, item.mid).then((resolved) => {
        if(resolved) thumbs.value = {...thumbs.value, [item.mid]: resolved};
      });
    }
  });

  /**
   * The worker revoked the URL under the element — its LRU evicted the entry
   * while the viewer was open. Forget it and download again.
   */
  function reloadCurrent() {
    const item = current.value;
    if(!item || !retry.shouldRetry()) return;

    invalidateViewerMedia(item.peerId, item.mid);
    url.value = null;
    loadViewerMedia(item.peerId, item.mid, quality.value || undefined).then((resolved) => {
      if(current.value?.mid !== item.mid) return;
      url.value = resolved;
      failed.value = !resolved;
    });
  }

  function reloadThumb(item: ViewerItem) {
    // One retry per poster, so a thumb that fails for any other reason cannot
    // spin the filmstrip.
    if(thumbRetried.has(item.mid)) return;
    thumbRetried.add(item.mid);

    invalidateViewerMedia(item.peerId, item.mid);
    thumbRequested.delete(item.mid);
    const next = {...thumbs.value};
    delete next[item.mid];
    thumbs.value = next;

    loadViewerThumb(item.peerId, item.mid).then((resolved) => {
      if(resolved) thumbs.value = {...thumbs.value, [item.mid]: resolved};
    });
  }

  function step(delta: number) {
    const next = pos.value + delta;
    if(next >= 0 && next < list.value.length) pos.value = next;
  }

  /* ---------------------------------------------------------------- */
  /* Zoom and pan                                                      */
  /* ---------------------------------------------------------------- */

  const scale = useSignal(1);
  const offsetX = useSignal(0);
  const offsetY = useSignal(0);

  const MAX_SCALE = 6;

  function resetZoom() {
    scale.value = 1;
    offsetX.value = 0;
    offsetY.value = 0;
  }

  function zoomBy(factor: number) {
    const next = Math.max(1, Math.min(MAX_SCALE, scale.value * factor));
    if(next === 1) {
      resetZoom();
      return;
    }
    scale.value = next;
  }

  function onWheel(e: WheelEvent) {
    // Ctrl+wheel is the pinch gesture a trackpad sends; a plain wheel zooms
    // too, since there is nothing to scroll behind the viewer.
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }

  function onDoubleClick() {
    if(scale.value > 1) resetZoom();
    else scale.value = 2.5;
  }

  const pointers = useMemo(() => new Map<number, {x: number; y: number}>(), []);
  const pinchStart = useRef(0);
  const pinchScale = useRef(1);
  const dragFrom = useRef<{x: number; y: number; offsetX: number; offsetY: number} | null>(null);
  const swipeFrom = useRef(0);

  function distance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function onPointerDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});

    if(pointers.size === 2) {
      pinchStart.current = distance();
      pinchScale.current = scale.value;
      dragFrom.current = null;
      return;
    }

    dragFrom.current = {x: e.clientX, y: e.clientY, offsetX: offsetX.value, offsetY: offsetY.value};
    swipeFrom.current = e.clientX;
  }

  function onPointerMove(e: PointerEvent) {
    if(!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, {x: e.clientX, y: e.clientY});

    if(pointers.size === 2 && pinchStart.current) {
      zoomTo(pinchScale.current * (distance() / pinchStart.current));
      return;
    }

    if(!dragFrom.current) return;

    if(scale.value > 1) {
      offsetX.value = dragFrom.current.offsetX + (e.clientX - dragFrom.current.x);
      offsetY.value = dragFrom.current.offsetY + (e.clientY - dragFrom.current.y);
    }
  }

  function zoomTo(value: number) {
    scale.value = Math.max(1, Math.min(MAX_SCALE, value));
    if(scale.value === 1) {
      offsetX.value = 0;
      offsetY.value = 0;
    }
  }

  function onPointerUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if(pointers.size < 2) pinchStart.current = 0;

    // Unzoomed, a horizontal drag pages the viewer — the gesture every gallery
    // has. Zoomed in, the same drag was a pan and must not change item.
    if(scale.value === 1 && dragFrom.current) {
      const travel = e.clientX - swipeFrom.current;
      if(Math.abs(travel) > 60) step(travel < 0 ? 1 : -1);
    }

    dragFrom.current = null;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  function flash(message: string) {
    notice.value = message;
    setTimeout(() => {
      if(notice.value === message) notice.value = '';
    }, 2200);
  }

  async function download() {
    if(!current.value || busy.value) return;
    busy.value = true;
    try {
      await saveMediaToDisk(current.value.peerId, current.value.mid);
    } catch (err: any) {
      flash(err?.type || err?.message || 'Download failed');
    } finally {
      busy.value = false;
    }
  }

  async function copyLink() {
    if(!current.value) return;
    const link = await messageLink(current.value.peerId, current.value.mid, threadId);
    if(!link) {
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
    if(!current.value) return;
    if(!confirm('Delete this media for everyone?')) return;

    const {mid} = current.value;
    try {
      await deleteMessages(current.value.peerId, [mid]);
    } catch (err: any) {
      flash(err?.type || err?.message || 'Could not delete');
      return;
    }

    const next = list.value.filter((item) => item.mid !== mid);
    if(!next.length) {
      onclose();
      return;
    }

    list.value = next;
    pos.value = Math.min(pos.value, next.length - 1);
  }

  function forward() {
    if(!current.value) return;
    const message = items.find((item) => item.mid === current.value.mid);
    if(message && onforward) {
      onforward(message);
      onclose();
    } else {
      flash('Open it in the chat to forward');
    }
  }

  function openInChat() {
    if(!current.value) return;
    onjump?.(current.value.mid);
    onclose();
  }

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape') onclose();
    else if(e.key === 'ArrowLeft') step(-1);
    else if(e.key === 'ArrowRight') step(1);
    else if(e.key === '+' || e.key === '=') zoomBy(1.25);
    else if(e.key === '-') zoomBy(1 / 1.25);
    else if(e.key === '0') resetZoom();
    else if(e.key === 'd') download();
  }

  // `<svelte:window onkeydown={onKey} />`: the same listener added and removed.
  // `onKey` reaches signals (always current) and the `onclose` prop, which is the
  // one thing it could go stale on, so that is the dependency.
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onclose]);

  function stamp(date: number) {
    if(!date) return '';
    return new Date(date * 1000).toLocaleString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // The `{#if} {:else if} … {:else}` chain that picked what fills the viewport,
  // resolved before the single return.
  let content: preact.JSX.Element;

  if(failed.value) {
    content = <p class="muted">This media could not be loaded.</p>;
  } else if(!url.value) {
    content = <p class="muted">Loading…</p>;
  } else if(current.value?.kind === 'gif') {
    /*
     * A GIF is a silent looping mp4, so it needs a <video> here just as it does
     * in the bubble — an <img> pointed at it renders nothing.
     *
     * No caption track either; the original carried the equivalent
     * svelte-ignore a11y_media_has_caption for the same reason.
     */
    content = <video src={url.value} autoplay loop muted playsinline onError={reloadCurrent}></video>;
  } else if(current.value?.kind === 'video') {
    content = (
      <VideoPlayer
        src={url.value}
        qualities={qualities.value}
        activeQuality={quality.value}
        onquality={(docId) => {
          quality.value = docId;
          const item = current.value;
          url.value = null;
          loadViewerMedia(item.peerId, item.mid, docId || undefined).then((resolved) => {
            if(current.value?.mid === item.mid) url.value = resolved;
          });
        }}
      />
    );
  } else {
    content = <img src={url.value} alt={current.value?.caption || ''} draggable={false} onError={reloadCurrent} />;
  }

  return (
    <div class="backdrop" onClick={onclose} role="presentation">
      <header class="top" onClick={(e) => e.stopPropagation()} role="presentation">
        <div class="who">
          <span class="from">{current.value?.fromTitle || ''}</span>
          <span class="when">{stamp(current.value?.date ?? 0)}</span>
        </div>

        <span class="counter">{pos.value + 1} of {Math.max(total.value, list.value.length)}</span>

        <div class="actions">
          <button class="action" onClick={forward} aria-label="Forward" title="Forward">
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M11 4l5 4-5 4V9.5C7 9.5 5 11 4 14c0-5 3-7 7-7V4z" />
            </svg>
          </button>

          <button class="action" onClick={download} disabled={busy.value} aria-label="Save as" title="Save as">
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M10 3.4v8.8M10 12.2L6.4 8.6M10 12.2l3.6-3.6" />
              <path d="M4.4 14.2v1.2a1.4 1.4 0 001.4 1.4h8.4a1.4 1.4 0 001.4-1.4v-1.2" />
            </svg>
          </button>

          <button class="action" onClick={copyLink} aria-label="Copy link" title="Copy link">
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M8.5 11.5a3 3 0 004.2 0l2.3-2.3a3 3 0 10-4.2-4.2l-1 1" />
              <path d="M11.5 8.5a3 3 0 00-4.2 0L5 10.8a3 3 0 104.2 4.2l1-1" />
            </svg>
          </button>

          <button class="action" onClick={openInChat} aria-label="Show in chat" title="Show in chat">
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M16.5 10c0 3.3-2.9 5.9-6.5 5.9-.9 0-1.7-.1-2.5-.4L3.5 16.5l1.1-3.6A5.7 5.7 0 013.5 10c0-3.3 2.9-5.9 6.5-5.9s6.5 2.6 6.5 5.9z" />
            </svg>
          </button>

          {current.value?.out && (
            <button class="action" onClick={remove} aria-label="Delete" title="Delete">
              <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M4.5 5.5h11M8 5.5V4h4v1.5M6 5.5l.7 10.1a1 1 0 001 .9h4.6a1 1 0 001-.9L14 5.5" />
              </svg>
            </button>
          )}

          <button class="action" onClick={onclose} aria-label="Close" title="Close">
            <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M5.4 5.4l9.2 9.2M14.6 5.4l-9.2 9.2" />
            </svg>
          </button>
        </div>
      </header>

      <div
        class="stage"
        onClick={(e) => e.stopPropagation()}
        onDblClick={onDoubleClick}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="presentation"
      >
        <div
          class={['viewport', scale.value > 1 && 'zoomed'].filter(Boolean).join(' ')}
          style={{transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`}}
        >
          {content}
        </div>
      </div>

      {current.value?.caption && (
        <p class="caption" onClick={(e) => e.stopPropagation()} role="presentation">{current.value.caption}</p>
      )}

      {list.value.length > 1 && (
        <div class="filmstrip" onClick={(e) => e.stopPropagation()} role="presentation">
          {list.value.map((item, i) => (
            <button
              key={item.mid}
              class={['frame', i === pos.value && 'on'].filter(Boolean).join(' ')}
              onClick={() => (pos.value = i)}
              aria-label={`Item ${i + 1}`}
              aria-current={i === pos.value}
            >
              {thumbs.value[item.mid] && (
                <img src={thumbs.value[item.mid]} alt="" onError={() => reloadThumb(item)} />
              )}
              {item.kind !== 'photo' && (
                <span class="badge">▶</span>
              )}
            </button>
          ))}
        </div>
      )}

      {pos.value > 0 && (
        <button class="nav prev" onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label="Previous">‹</button>
      )}
      {pos.value < list.value.length - 1 && (
        <button class="nav next" onClick={(e) => { e.stopPropagation(); step(1); }} aria-label="Next">›</button>
      )}

      {notice.value && (
        <p class="notice">{notice.value}</p>
      )}
    </div>
  );
}
