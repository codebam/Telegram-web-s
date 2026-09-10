/*
 * The media editor — crop/rotate, filters, drawing, text and sticker layers, and
 * the trim/cover controls for a video. It renders the ported `Picker` for the
 * sticker tab, and does every canvas operation through `$lib/telegram/mediaEditor`.
 *
 * Ported from svelte/src/lib/components/MediaEditor.svelte. Five things needed a
 * decision:
 *  - `edit` was a `$state` *proxy*, so `edit.crop = …`, `layer.x = …` and
 *    `edit.strokes.push(…)` notified every reader of the field they touched.
 *    `signal()` is shallow, so every edit whose change has to be seen — the crop
 *    rect, the rotation, the flips, the adjustments, the stroke and layer lists,
 *    the trim values, a layer's own x/y/size/rotation — is a reassignment of
 *    `edit`. That is what keeps the sliders, the selection box and the canvas in
 *    step with the pointer.
 *  - the one write left as a mutation is a stroke's `points` array while the
 *    pointer is down: nothing derives from the points themselves (the paint
 *    effect subscribed to `strokes.length`, as it does here) and the original
 *    called `paint()` imperatively right after. Copying a growing array on every
 *    pointer move would be quadratic.
 *  - the three `$effect`s become `useSignalEffect` — they read signals only. The
 *    load effect reads the `file` prop (and `shape`, through `circle`), so it is a
 *    `useEffect` with those in its dependency list: `useSignalEffect` tracks
 *    signal reads only and would never re-run for a new file.
 *  - `onDestroy` — release the decoded source and revoke every frame thumbnail —
 *    is the cleanup of a mount-only effect. `bind:this={canvas}` is a signal
 *    written by a callback ref, because the paint effect reacts to the element
 *    appearing and disappearing with the `{#if source}` branch;
 *    `bind:clientWidth` / `bind:clientHeight` on the stage are one
 *    `ResizeObserver`, and `<svelte:window onkeydown>` is a listener added and
 *    removed by an effect.
 *  - `nextId`, `history`, `drag` and `abort` were plain instance values, and a
 *    Svelte body ran once per instance. A Preact body runs on every render, so
 *    each of them is a ref; `history` is only ever compared by length, and a
 *    `historyIndex` write is what re-renders those comparisons.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useComputed, useSignal, useSignalEffect} from '@preact/signals';

import {Picker} from './Picker';
import {loadDocUrl} from '$lib/telegram/chats';
import {
  ASPECT_PRESETS,
  canExportVideo,
  clampCrop,
  createEditorState,
  cropForRatio,
  exportCover,
  exportImage,
  exportVideo,
  extractFrames,
  FILTER_PRESETS,
  FONTS,
  hitLayer,
  layerBounds,
  loadSource,
  orientedSize,
  PALETTE,
  registerStickerImage,
  releaseSource,
  renderFrame,
  seek,
  type BrushKind,
  type EditorSource,
  type EditorState,
  type FrameThumb,
  type Layer,
  type StickerLayer,
  type TextLayer
} from '$lib/telegram/mediaEditor';

import './MediaEditor.css';

interface Props {
  file: File;
  /** `circle` is the avatar mode: square crop, circular mask, no layer tabs. */
  shape?: 'rect' | 'circle';
  onapply: (edited: File, cover?: File) => void;
  oncancel: () => void;
}

type Tab = 'crop' | 'filters' | 'draw' | 'text' | 'stickers' | 'trim';

// Undo/redo over the annotation layers only — crop and filters have their own
// obvious reset, and mixing them into one stack makes the buttons unreadable.
type Snapshot = {strokes: string; layers: string};

type Drag =
  | {mode: 'crop'; handle: string; startX: number; startY: number; crop: {x: number; y: number; w: number; h: number}}
  | {mode: 'stroke'}
  | {mode: 'move'; id: number; dx: number; dy: number}
  | {mode: 'transform'; id: number; size: number; rotation: number; distance: number; angle: number};

type AdjustmentKey = keyof EditorState['adjustments'];

// The literal lists the markup iterated over inline. They are typed here so the
// `as 'brightness'` / `as BrushKind` / `as TextLayer['style']` casts the original
// carried at each handler drop away — the values are already the right union.
const ADJUSTMENT_SLIDERS: [AdjustmentKey, string, number, number][] = [
  ['brightness', 'Brightness', -100, 100],
  ['contrast', 'Contrast', -100, 100],
  ['saturation', 'Saturation', -100, 100],
  ['warmth', 'Warmth', -100, 100],
  ['vignette', 'Vignette', 0, 100],
  ['sharpen', 'Sharpen', 0, 100]
];
const DRAW_TOOLS: [BrushKind, string][] = [
  ['pen', 'Pen'],
  ['arrow', 'Arrow'],
  ['marker', 'Marker'],
  ['neon', 'Neon'],
  ['eraser', 'Eraser']
];
const ALIGNS: CanvasTextAlign[] = ['left', 'center', 'right'];
const TEXT_STYLES: TextLayer['style'][] = ['plain', 'outline', 'background'];

export function MediaEditor({file, shape = 'rect', onapply, oncancel}: Props) {
  const circle = shape === 'circle';

  const source = useSignal<EditorSource | null>(null);
  const edit = useSignal<EditorState>(createEditorState());
  const error = useSignal('');
  const busy = useSignal(false);
  const progress = useSignal(0);
  const tab = useSignal<Tab>('crop');

  // Draw tools
  const brush = useSignal<BrushKind>('pen');
  const brushColor = useSignal('#ff3b30');
  const brushWidth = useSignal(0.012);

  // Layer editing
  const selectedId = useSignal<number | null>(null);
  const nextId = useRef(1);

  const history = useRef<Snapshot[]>([{strokes: '[]', layers: '[]'}]);
  const historyIndex = useSignal(0);

  const canvas = useSignal<HTMLCanvasElement | null>(null);
  const boxWidth = useSignal(0);
  const boxHeight = useSignal(0);
  const frames = useSignal<FrameThumb[]>([]);
  const playing = useSignal(false);

  const tabs = useComputed((): {id: Tab; label: string}[] =>
    circle ?
      [{id: 'crop', label: 'Crop'}, {id: 'filters', label: 'Filters'}] :
      [
        {id: 'crop', label: 'Crop'},
        {id: 'filters', label: 'Filters'},
        {id: 'draw', label: 'Draw'},
        {id: 'text', label: 'Text'},
        {id: 'stickers', label: 'Stickers'},
        ...(source.value?.kind === 'video' ? [{id: 'trim' as Tab, label: 'Trim'}] : [])
      ]
  );

  const selected = useComputed<Layer | null>(
    () => edit.value.layers.find((layer) => layer.id === selectedId.value) ?? null
  );
  const selectedText = useComputed<TextLayer | null>(() => {
    const layer = selected.value;
    return layer?.type === 'text' ? layer : null;
  });

  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;
    const current = file;
    loadSource(current)
      .then((loaded) => {
        if(cancelled) {
          releaseSource(loaded);
          return;
        }
        source.value = loaded;
        const fresh = createEditorState(loaded.duration);
        if(circle) {
          fresh.aspectId = 'square';
          fresh.crop = cropForRatio(loaded, fresh, 1);
        }
        edit.value = fresh;
        if(loaded.kind === 'video') {
          extractFrames(loaded, 10).then((list) => {
            if(cancelled) list.forEach((frame) => URL.revokeObjectURL(frame.url));
            else frames.value = list;
          });
        }
      })
      .catch(() => {
        if(!cancelled) error.value = 'This file cannot be edited here.';
      });

    return () => {
      cancelled = true;
    };
  }, [file, circle]);

  // `onDestroy`: the decoded source is released and every frame thumbnail revoked
  // by the cleanup of a mount-only effect.
  useEffect(() => () => {
    if(source.value) releaseSource(source.value);
    frames.value.forEach((frame) => URL.revokeObjectURL(frame.url));
  }, []);

  /* ---------------------------------------------------------------- */
  /* Stage sizing and rendering                                        */
  /* ---------------------------------------------------------------- */

  const stage = useRef<HTMLDivElement>(null);

  // `bind:clientWidth` / `bind:clientHeight` on the stage, which Svelte kept
  // current with its own observer. The stage is rendered unconditionally, so the
  // element is attached before this effect runs.
  useEffect(() => {
    const node = stage.current;
    if(!node) return;

    const measure = () => {
      boxWidth.value = node.clientWidth;
      boxHeight.value = node.clientHeight;
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // In the crop tab the whole (oriented) frame is on screen with the crop rect
  // drawn over it; every other tab shows the cropped result.
  const cropping = useComputed(() => tab.value === 'crop');

  const stageAspect = useComputed(() => {
    const current = source.value;
    if(!current) return 1;
    const oriented = orientedSize(current, edit.value);
    if(cropping.value) return oriented.width / oriented.height;
    return (oriented.width * edit.value.crop.w) / (oriented.height * edit.value.crop.h);
  });

  const stageSize = useComputed(() => {
    if(!boxWidth.value || !boxHeight.value) return {width: 0, height: 0};
    let width = boxWidth.value;
    let height = width / stageAspect.value;
    if(height > boxHeight.value) {
      height = boxHeight.value;
      width = height * stageAspect.value;
    }
    return {width: Math.round(width), height: Math.round(height)};
  });

  function renderEditState(): EditorState {
    // The crop tab renders the untouched frame; the rect is an HTML overlay.
    return cropping.value ? {...edit.value, crop: {x: 0, y: 0, w: 1, h: 1}} : edit.value;
  }

  function paint() {
    const element = canvas.value;
    const current = source.value;
    const size = stageSize.value;
    if(!element || !current || !size.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.min(Math.round(size.width * dpr), 1600);
    const height = Math.max(1, Math.round(width / stageAspect.value));
    renderFrame(element, current, renderEditState(), width, height, {
      circle: circle && !cropping.value,
      layers: !cropping.value,
      fast: dragging.value || playing.value
    });
  }

  // Reading these keeps the effect subscribed to every editable value: the state
  // object, the history position, the tab, the measured stage and the canvas
  // element. `signal()` is shallow, so it is the reassignments of `edit` above
  // that make a changed crop edge or layer position repaint.
  useSignalEffect(() => {
    void edit.value;
    void historyIndex.value;
    void tab.value;
    void stageSize.value;
    void canvas.value;
    void source.value;
    paint();
  });

  // Video keeps painting while it plays; a still frame only repaints on change.
  useSignalEffect(() => {
    const current = source.value;
    const video = current?.kind === 'video' ? (current.element as HTMLVideoElement) : null;
    if(!video || !playing.value) return;
    let raf = requestAnimationFrame(function tick() {
      if(video.currentTime >= edit.value.trimEnd) {
        video.pause();
        playing.value = false;
        return;
      }
      paint();
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });

  function togglePlay() {
    const video = source.value?.element as HTMLVideoElement | undefined;
    if(!video) return;
    if(playing.value) {
      video.pause();
      playing.value = false;
      return;
    }
    if(video.currentTime < edit.value.trimStart || video.currentTime >= edit.value.trimEnd) {
      video.currentTime = edit.value.trimStart;
    }
    video.play().then(() => (playing.value = true)).catch(() => {});
  }

  /* ---------------------------------------------------------------- */
  /* History                                                           */
  /* ---------------------------------------------------------------- */

  function pushHistory() {
    const snapshot: Snapshot = {
      strokes: JSON.stringify(edit.value.strokes),
      layers: JSON.stringify(edit.value.layers)
    };
    const next = history.current.slice(0, historyIndex.value + 1);
    next.push(snapshot);
    history.current = next;
    historyIndex.value = next.length - 1;
  }

  function applySnapshot(snapshot: Snapshot) {
    const strokes: EditorState['strokes'] = JSON.parse(snapshot.strokes);
    const layers: EditorState['layers'] = JSON.parse(snapshot.layers);
    edit.value = {...edit.value, strokes, layers};
    if(!layers.some((layer) => layer.id === selectedId.value)) selectedId.value = null;
  }

  function undo() {
    if(historyIndex.value <= 0) return;
    historyIndex.value--;
    applySnapshot(history.current[historyIndex.value]);
  }

  function redo() {
    if(historyIndex.value >= history.current.length - 1) return;
    historyIndex.value++;
    applySnapshot(history.current[historyIndex.value]);
  }

  /* ---------------------------------------------------------------- */
  /* Crop controls                                                     */
  /* ---------------------------------------------------------------- */

  function setAspect(id: string) {
    const current = source.value;
    if(!current) return;
    const state = {...edit.value, aspectId: id};
    const aspect = ASPECT_PRESETS.find((item) => item.id === id);
    if(!aspect || aspect.ratio === null) {
      edit.value = state;
      return;
    }
    edit.value = {...state, crop: cropForRatio(current, state, aspect.ratio)};
  }

  function rotate() {
    const current = source.value;
    if(!current) return;
    const crop = edit.value.crop;
    // The crop rect lives in oriented space, so turn it with the image.
    const next: EditorState = {
      ...edit.value,
      rotation: (edit.value.rotation + 1) % 4,
      crop: clampCrop({x: 1 - crop.y - crop.h, y: crop.x, w: crop.h, h: crop.w})
    };
    edit.value = circle ? {...next, crop: cropForRatio(current, next, 1)} : next;
  }

  function reframe() {
    const current = source.value;
    if(!current) return;
    const aspect = ASPECT_PRESETS.find((item) => item.id === edit.value.aspectId);
    edit.value = {
      ...edit.value,
      crop: aspect && aspect.ratio !== null ?
        cropForRatio(current, edit.value, aspect.ratio) :
        {x: 0, y: 0, w: 1, h: 1}
    };
  }

  function resetCrop() {
    edit.value = {
      ...edit.value,
      rotation: 0,
      straighten: 0,
      flipH: false,
      flipV: false,
      aspectId: circle ? 'square' : 'free'
    };
    reframe();
  }

  /* ---------------------------------------------------------------- */
  /* Pointer handling                                                  */
  /* ---------------------------------------------------------------- */

  const drag = useRef<Drag | null>(null);
  const dragging = useSignal(false);

  function pointerAt(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  }

  function onPointerDown(e: PointerEvent) {
    if(!source.value) return;
    const point = pointerAt(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging.value = true;

    if(cropping.value) {
      drag.current = {mode: 'crop', handle: cropHandleAt(point.x, point.y), startX: point.x, startY: point.y, crop: {...edit.value.crop}};
      return;
    }

    if(tab.value === 'draw') {
      edit.value = {
        ...edit.value,
        strokes: [...edit.value.strokes, {
          kind: brush.value,
          color: brushColor.value,
          width: brush.value === 'eraser' ? brushWidth.value * 2 : brushWidth.value,
          points: [point]
        }]
      };
      drag.current = {mode: 'stroke'};
      return;
    }

    if(tab.value === 'text' || tab.value === 'stickers') {
      const width = stageSize.value.width || 1;
      const height = stageSize.value.height || 1;
      const px = point.x * width;
      const py = point.y * height;
      const layer = selected.value;

      if(layer) {
        const bounds = layerBounds(layer, width, height);
        const cos = Math.cos(layer.rotation);
        const sin = Math.sin(layer.rotation);
        const hx = bounds.cx + (bounds.w / 2) * cos - (bounds.h / 2) * sin;
        const hy = bounds.cy + (bounds.w / 2) * sin + (bounds.h / 2) * cos;
        if(Math.hypot(px - hx, py - hy) < 26) {
          const dx = px - bounds.cx;
          const dy = py - bounds.cy;
          drag.current = {
            mode: 'transform',
            id: layer.id,
            size: layer.type === 'text' ? (layer as TextLayer).size : (layer as StickerLayer).size,
            rotation: layer.rotation,
            distance: Math.max(1, Math.hypot(dx, dy)),
            angle: Math.atan2(dy, dx)
          };
          return;
        }
      }

      const hit = hitLayer(edit.value.layers, px, py, width, height);
      if(hit) {
        selectedId.value = hit.id;
        drag.current = {mode: 'move', id: hit.id, dx: point.x - hit.x, dy: point.y - hit.y};
      } else {
        selectedId.value = null;
        drag.current = null;
        dragging.value = false;
      }
    }
  }

  function onPointerMove(e: PointerEvent) {
    const active = drag.current;
    if(!active || !source.value) return;
    const point = pointerAt(e);

    if(active.mode === 'stroke') {
      const stroke = edit.value.strokes[edit.value.strokes.length - 1];
      // The points are only ever read imperatively, by `paint` right below — no
      // reader derives from them, exactly as in the original, where the paint
      // effect subscribed to `strokes.length` and not to the growing array.
      if(stroke) stroke.points.push(point);
      paint();
      return;
    }

    if(active.mode === 'crop') {
      const dx = point.x - active.startX;
      const dy = point.y - active.startY;
      const base = active.crop;
      let next = {...base};
      const ratio = lockedRatio();

      if(active.handle === 'move') {
        next.x = base.x + dx;
        next.y = base.y + dy;
      } else {
        if(active.handle.includes('w')) {
          next.x = base.x + dx;
          next.w = base.w - dx;
        }
        if(active.handle.includes('e')) next.w = base.w + dx;
        if(active.handle.includes('n')) {
          next.y = base.y + dy;
          next.h = base.h - dy;
        }
        if(active.handle.includes('s')) next.h = base.h + dy;

        if(ratio) {
          const oriented = orientedSize(source.value, edit.value);
          // The rect is normalised on two different axes, so the ratio lock has
          // to go through pixels or a 16:9 crop comes out skewed.
          const heightPx = (next.w * oriented.width) / ratio;
          const h = heightPx / oriented.height;
          if(active.handle.includes('n')) next.y = base.y + base.h - h;
          next.h = h;
        }
      }

      if(next.w > 0.02 && next.h > 0.02) edit.value = {...edit.value, crop: clampCrop(next)};
      return;
    }

    const layer = edit.value.layers.find((item) => item.id === active.id);
    if(!layer) return;

    if(active.mode === 'move') {
      edit.value = {
        ...edit.value,
        layers: edit.value.layers.map((item) => item.id === active.id ? {
          ...item,
          x: Math.max(0, Math.min(1, point.x - active.dx)),
          y: Math.max(0, Math.min(1, point.y - active.dy))
        } : item)
      };
      paint();
      return;
    }

    const width = stageSize.value.width || 1;
    const height = stageSize.value.height || 1;
    const dx = point.x * width - layer.x * width;
    const dy = point.y * height - layer.y * height;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const scale = distance / active.distance;
    const rotation = active.rotation + (Math.atan2(dy, dx) - active.angle);
    const size = layer.type === 'text' ?
      Math.max(0.02, Math.min(0.6, active.size * scale)) :
      Math.max(0.04, Math.min(1.2, active.size * scale));
    edit.value = {
      ...edit.value,
      layers: edit.value.layers.map((item) => item.id === layer.id ? {...item, rotation, size} : item)
    };
    paint();
  }

  function onPointerUp() {
    const had = drag.current;
    drag.current = null;
    dragging.value = false;
    if(had && had.mode !== 'crop') pushHistory();
    paint();
  }

  function lockedRatio(): number | null {
    if(circle) return 1;
    const aspect = ASPECT_PRESETS.find((item) => item.id === edit.value.aspectId);
    if(!aspect || aspect.ratio === null) return null;
    if(aspect.ratio === 0 && source.value) return source.value.width / source.value.height;
    return aspect.ratio || null;
  }

  function cropHandleAt(x: number, y: number) {
    const crop = edit.value.crop;
    const near = 0.06;
    const left = Math.abs(x - crop.x) < near;
    const right = Math.abs(x - (crop.x + crop.w)) < near;
    const top = Math.abs(y - crop.y) < near;
    const bottom = Math.abs(y - (crop.y + crop.h)) < near;
    if(top && left) return 'nw';
    if(top && right) return 'ne';
    if(bottom && left) return 'sw';
    if(bottom && right) return 'se';
    if(left) return 'w';
    if(right) return 'e';
    if(top) return 'n';
    if(bottom) return 's';
    return 'move';
  }

  /* ---------------------------------------------------------------- */
  /* Layers                                                            */
  /* ---------------------------------------------------------------- */

  function addText() {
    const layer: TextLayer = {
      id: nextId.current++,
      type: 'text',
      text: 'Text',
      x: 0.5,
      y: 0.5,
      size: 0.09,
      font: FONTS[0].family,
      color: '#ffffff',
      align: 'center',
      style: 'outline',
      rotation: 0
    };
    edit.value = {...edit.value, layers: [...edit.value.layers, layer]};
    selectedId.value = layer.id;
    tab.value = 'text';
    pushHistory();
  }

  function addEmoji(emoji: string) {
    const layer: StickerLayer = {
      id: nextId.current++,
      type: 'sticker',
      emoji,
      url: '',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      rotation: 0
    };
    edit.value = {...edit.value, layers: [...edit.value.layers, layer]};
    selectedId.value = layer.id;
    pushHistory();
  }

  async function addSticker(docId: string) {
    const url = await loadDocUrl(docId);
    if(!url || !(await registerStickerImage(url))) {
      error.value = 'That sticker could not be added.';
      return;
    }
    const layer: StickerLayer = {
      id: nextId.current++,
      type: 'sticker',
      emoji: '',
      url,
      x: 0.5,
      y: 0.5,
      size: 0.3,
      rotation: 0
    };
    edit.value = {...edit.value, layers: [...edit.value.layers, layer]};
    selectedId.value = layer.id;
    pushHistory();
  }

  function removeSelected() {
    if(selectedId.value === null) return;
    edit.value = {...edit.value, layers: edit.value.layers.filter((layer) => layer.id !== selectedId.value)};
    selectedId.value = null;
    pushHistory();
  }

  /**
   * Writes one field of the selected text layer. The original assigned the field
   * straight onto the object the `$state` proxy held; a shallow signal has to be
   * handed a new state object for the input, the chips and the selection box to
   * see the change.
   */
  function updateText(patch: Partial<TextLayer>) {
    const id = selectedId.value;
    edit.value = {
      ...edit.value,
      layers: edit.value.layers.map((layer) => (layer.id === id && layer.type === 'text' ? {...layer, ...patch} : layer))
    };
  }

  const selectionBox = useComputed(() => {
    const layer = selected.value;
    if(!layer || !stageSize.value.width || (tab.value !== 'text' && tab.value !== 'stickers')) return null;
    const bounds = layerBounds(layer, stageSize.value.width, stageSize.value.height);
    return {
      left: bounds.cx - bounds.w / 2,
      top: bounds.cy - bounds.h / 2,
      width: bounds.w,
      height: bounds.h,
      rotation: (layer.rotation * 180) / Math.PI
    };
  });

  /* ---------------------------------------------------------------- */
  /* Export                                                            */
  /* ---------------------------------------------------------------- */

  const abort = useRef<AbortController | null>(null);

  async function save() {
    const current = source.value;
    if(!current || busy.value) return;
    busy.value = true;
    error.value = '';
    progress.value = 0;
    try {
      if(current.kind === 'video') {
        if(!canExportVideo()) throw new Error('This browser cannot re-encode video');
        const controller = new AbortController();
        abort.current = controller;
        const cover = await exportCover(current, edit.value, edit.value.coverTime || edit.value.trimStart);
        const edited = await exportVideo(current, edit.value, {
          signal: controller.signal,
          onProgress: (value) => (progress.value = value)
        });
        onapply(edited, cover);
      } else {
        onapply(await exportImage(current, edit.value, {circle}));
      }
    } catch(err: any) {
      if(err?.name !== 'AbortError') error.value = err?.message ?? 'Could not save the edit.';
    } finally {
      abort.current = null;
      busy.value = false;
    }
  }

  function cancelExport() {
    abort.current?.abort();
  }

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape' && !busy.value) oncancel();
  }

  // `<svelte:window onkeydown={onKey} />`: the same listener added and removed.
  // `onKey` reaches the `busy` signal (always current) and the `oncancel` prop,
  // which is the one thing it could go stale on, so that is the dependency.
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [oncancel]);

  const duration = useComputed(() => source.value?.duration ?? 0);

  function stamp(seconds: number) {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`;
  }

  function setTrim(which: 'start' | 'end', value: number) {
    if(which === 'start') edit.value = {...edit.value, trimStart: Math.min(value, edit.value.trimEnd - 0.2)};
    else edit.value = {...edit.value, trimEnd: Math.max(value, edit.value.trimStart + 0.2)};
    const video = source.value?.element as HTMLVideoElement | undefined;
    if(video) {
      seek(video, which === 'start' ? edit.value.trimStart : edit.value.trimEnd).then(paint);
    }
  }

  function setCover(value: number) {
    edit.value = {...edit.value, coverTime: value};
    const video = source.value?.element as HTMLVideoElement | undefined;
    if(video) seek(video, value).then(paint);
  }

  // Seed one sticker decode per unique URL after an undo restores layers. The
  // original wrapped the call in `untrack`; this effect already reads `edit`, and
  // the continuation runs outside the effect's tracking anyway.
  useSignalEffect(() => {
    for(const layer of edit.value.layers) {
      if(layer.type === 'sticker' && layer.url) registerStickerImage(layer.url).then(paint);
    }
  });

  // The `{#if} {:else if} … {/if}` chain that picked the panel's body, resolved
  // before the single return.
  let panel: preact.JSX.Element;

  if(tab.value === 'crop') {
    panel = (
      <>
        {!circle && (
          <div class="chips">
            {ASPECT_PRESETS.map((aspect) => (
              <button
                key={aspect.id}
                type="button"
                class={edit.value.aspectId === aspect.id ? 'on' : ''}
                onClick={() => setAspect(aspect.id)}
              >
                {aspect.label}
              </button>
            ))}
          </div>
        )}

        <div class="row">
          <button type="button" onClick={rotate}>Rotate 90°</button>
          <button
            type="button"
            class={edit.value.flipH ? 'on' : ''}
            onClick={() => (edit.value = {...edit.value, flipH: !edit.value.flipH})}
          >Flip H</button>
          <button
            type="button"
            class={edit.value.flipV ? 'on' : ''}
            onClick={() => (edit.value = {...edit.value, flipV: !edit.value.flipV})}
          >Flip V</button>
          <button type="button" onClick={resetCrop}>Reset</button>
        </div>

        <label class="slider">
          <span>Straighten <b>{edit.value.straighten.toFixed(0)}°</b></span>
          <input
            type="range"
            min={-45}
            max={45}
            step={0.5}
            value={edit.value.straighten}
            onInput={(e) => (edit.value = {...edit.value, straighten: +((e.target as HTMLInputElement).value)})}
          />
        </label>
      </>
    );
  } else if(tab.value === 'filters') {
    panel = (
      <>
        <div class="chips">
          {FILTER_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              class={edit.value.presetId === item.id ? 'on' : ''}
              onClick={() => {
                edit.value = {...edit.value, presetId: item.id, adjustments: {...item.adjustments}};
              }}
            >
              {item.name}
            </button>
          ))}
        </div>

        {ADJUSTMENT_SLIDERS.map((slider) => (
          <label key={slider[0]} class="slider">
            <span>{slider[1]} <b>{edit.value.adjustments[slider[0]]}</b></span>
            <input
              type="range"
              min={slider[2]}
              max={slider[3]}
              step={1}
              value={edit.value.adjustments[slider[0]]}
              onInput={(e) => {
                const value = +((e.target as HTMLInputElement).value);
                edit.value = {
                  ...edit.value,
                  adjustments: {...edit.value.adjustments, [slider[0]]: value},
                  presetId: 'custom'
                };
              }}
            />
          </label>
        ))}
      </>
    );
  } else if(tab.value === 'draw') {
    panel = (
      <>
        <div class="chips">
          {DRAW_TOOLS.map((tool) => (
            <button
              key={tool[0]}
              type="button"
              class={brush.value === tool[0] ? 'on' : ''}
              onClick={() => (brush.value = tool[0])}
            >
              {tool[1]}
            </button>
          ))}
        </div>

        <div class="swatches">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              class={['swatch', brushColor.value === color && 'on'].filter(Boolean).join(' ')}
              style={{background: color}}
              aria-label={color}
              onClick={() => (brushColor.value = color)}
            ></button>
          ))}
        </div>

        <label class="slider">
          <span>Width</span>
          <input
            type="range"
            min={0.003}
            max={0.06}
            step={0.001}
            value={brushWidth.value}
            onInput={(e) => (brushWidth.value = +((e.target as HTMLInputElement).value))}
          />
        </label>

        <div class="row">
          <button type="button" onClick={undo} disabled={historyIndex.value <= 0}>Undo</button>
          <button type="button" onClick={redo} disabled={historyIndex.value >= history.current.length - 1}>Redo</button>
          <button
            type="button"
            onClick={() => {
              edit.value = {...edit.value, strokes: []};
              pushHistory();
            }}
          >
            Clear
          </button>
        </div>
      </>
    );
  } else if(tab.value === 'text') {
    const layer = selectedText.value;
    panel = (
      <>
        <div class="row">
          <button type="button" onClick={addText}>Add text</button>
          <button type="button" onClick={removeSelected} disabled={!selected.value}>Remove</button>
          <button type="button" onClick={undo} disabled={historyIndex.value <= 0}>Undo</button>
          <button type="button" onClick={redo} disabled={historyIndex.value >= history.current.length - 1}>Redo</button>
        </div>

        {layer ? (
          <>
            <input
              class="text-input"
              value={layer.text}
              placeholder="Text"
              onInput={(e) => updateText({text: (e.target as HTMLInputElement).value})}
              onChange={pushHistory}
            />

            <div class="chips">
              {FONTS.map((font) => (
                <button
                  key={font.id}
                  type="button"
                  class={layer.font === font.family ? 'on' : ''}
                  onClick={() => updateText({font: font.family})}
                >
                  {font.label}
                </button>
              ))}
            </div>

            <div class="chips">
              {ALIGNS.map((align) => (
                <button
                  key={align}
                  type="button"
                  class={layer.align === align ? 'on' : ''}
                  onClick={() => updateText({align})}
                >
                  {align}
                </button>
              ))}
              {TEXT_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  class={layer.style === style ? 'on' : ''}
                  onClick={() => updateText({style})}
                >
                  {style}
                </button>
              ))}
            </div>

            <div class="swatches">
              {PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  class={['swatch', layer.color === color && 'on'].filter(Boolean).join(' ')}
                  style={{background: color}}
                  aria-label={color}
                  onClick={() => updateText({color})}
                ></button>
              ))}
            </div>

            <label class="slider">
              <span>Size</span>
              <input
                type="range"
                min={0.02}
                max={0.4}
                step={0.005}
                value={layer.size}
                onInput={(e) => updateText({size: +((e.target as HTMLInputElement).value)})}
              />
            </label>
          </>
        ) : (
          <p class="muted">Add a text layer, then drag it on the image. The corner grip scales and rotates it.</p>
        )}
      </>
    );
  } else if(tab.value === 'stickers') {
    panel = (
      <>
        <div class="row">
          <button type="button" onClick={removeSelected} disabled={!selected.value}>Remove</button>
          <button type="button" onClick={undo} disabled={historyIndex.value <= 0}>Undo</button>
          <button type="button" onClick={redo} disabled={historyIndex.value >= history.current.length - 1}>Redo</button>
        </div>
        <div class="picker">
          <Picker onemoji={addEmoji} ondocument={addSticker} />
        </div>
      </>
    );
  } else if(tab.value === 'trim') {
    panel = (
      <>
        <div class="row">
          <button type="button" onClick={togglePlay}>{playing.value ? 'Pause' : 'Play'}</button>
          <span class="muted">{stamp(edit.value.trimStart)} – {stamp(edit.value.trimEnd)} of {stamp(duration.value)}</span>
        </div>

        {frames.value.length > 0 && (
          <div class="strip">
            {frames.value.map((frame) => (
              <img key={frame.url} src={frame.url} alt="" />
            ))}
            <div
              class="mask left"
              style={{width: `${duration.value ? (edit.value.trimStart / duration.value) * 100 : 0}%`}}
            ></div>
            <div
              class="mask right"
              style={{width: `${duration.value ? ((duration.value - edit.value.trimEnd) / duration.value) * 100 : 0}%`}}
            ></div>
          </div>
        )}

        <label class="slider">
          <span>Start <b>{stamp(edit.value.trimStart)}</b></span>
          <input
            type="range"
            min={0}
            max={duration.value}
            step={0.05}
            value={edit.value.trimStart}
            onInput={(e) => setTrim('start', +((e.target as HTMLInputElement).value))}
          />
        </label>

        <label class="slider">
          <span>End <b>{stamp(edit.value.trimEnd)}</b></span>
          <input
            type="range"
            min={0}
            max={duration.value}
            step={0.05}
            value={edit.value.trimEnd}
            onInput={(e) => setTrim('end', +((e.target as HTMLInputElement).value))}
          />
        </label>

        <label class="slider">
          <span>Cover frame <b>{stamp(edit.value.coverTime)}</b></span>
          <input
            type="range"
            min={0}
            max={duration.value}
            step={0.05}
            value={edit.value.coverTime}
            onInput={(e) => setCover(+((e.target as HTMLInputElement).value))}
          />
        </label>

        {!canExportVideo() && (
          <p class="muted">This browser cannot re-encode video, so the trim cannot be applied here.</p>
        )}
      </>
    );
  }

  return (
    <div class="editor">
      <header>
        <button type="button" onClick={oncancel} disabled={busy.value}>Cancel</button>
        <span class="title">{circle ? 'Crop photo' : source.value?.kind === 'video' ? 'Edit video' : 'Edit photo'}</span>
        <button type="button" class="primary" onClick={save} disabled={busy.value || !source.value}>
          {busy.value ? 'Saving…' : 'Done'}
        </button>
      </header>

      {error.value && <p class="error">{error.value}</p>}

      <div class="stage" ref={stage}>
        {source.value ?
          <div
            class={['frame', circle && !cropping.value && 'round'].filter(Boolean).join(' ')}
            style={{width: `${stageSize.value.width}px`, height: `${stageSize.value.height}px`}}
          >
            <canvas ref={(node) => { canvas.value = node; }} style={{width: '100%', height: '100%'}}></canvas>

            {/* The original carried the equivalent a11y_no_static_element_interactions
                svelte-ignore here: the surface is the pointer target for the crop
                rect and the layer drag, and holds no interactive-but-static
                element of its own. */}
            <div
              class={['surface', tab.value === 'draw' && 'drawing'].filter(Boolean).join(' ')}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {cropping.value ?
                <div
                  class={['crop-rect', circle && 'round'].filter(Boolean).join(' ')}
                  style={{
                    left: `${edit.value.crop.x * 100}%`,
                    top: `${edit.value.crop.y * 100}%`,
                    width: `${edit.value.crop.w * 100}%`,
                    height: `${edit.value.crop.h * 100}%`
                  }}
                >
                  <span class="handle nw"></span>
                  <span class="handle ne"></span>
                  <span class="handle sw"></span>
                  <span class="handle se"></span>
                </div> :
                selectionBox.value ?
                  <div
                    class="selection"
                    style={{
                      left: `${selectionBox.value.left}px`,
                      top: `${selectionBox.value.top}px`,
                      width: `${selectionBox.value.width}px`,
                      height: `${selectionBox.value.height}px`,
                      transform: `rotate(${selectionBox.value.rotation}deg)`
                    }}
                  >
                    <span class="grip"></span>
                  </div> :
                  null}
            </div>
          </div> :
          !error.value ?
            <p class="loading">Loading…</p> :
            null}
      </div>

      {busy.value && source.value?.kind === 'video' && (
        <div class="export">
          <div class="bar"><span style={{width: `${Math.round(progress.value * 100)}%`}}></span></div>
          <span class="muted">Re-encoding in real time — {Math.round(progress.value * 100)}%</span>
          <button type="button" onClick={cancelExport}>Stop</button>
        </div>
      )}

      <nav class="tabs">
        {tabs.value.map((item) => (
          <button
            key={item.id}
            type="button"
            class={tab.value === item.id ? 'on' : ''}
            onClick={() => (tab.value = item.id)}
          >{item.label}</button>
        ))}
      </nav>

      <div class="panel">
        {panel}
      </div>
    </div>
  );
}
