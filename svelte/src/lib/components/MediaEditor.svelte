<script lang="ts">
  import {onDestroy, untrack} from 'svelte';
  import Picker from './Picker.svelte';
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

  let {
    file,
    shape = 'rect',
    onapply,
    oncancel
  }: {
    file: File;
    /** `circle` is the avatar mode: square crop, circular mask, no layer tabs. */
    shape?: 'rect' | 'circle';
    onapply: (edited: File, cover?: File) => void;
    oncancel: () => void;
  } = $props();

  type Tab = 'crop' | 'filters' | 'draw' | 'text' | 'stickers' | 'trim';

  const circle = shape === 'circle';

  let source = $state<EditorSource | null>(null);
  let edit = $state<EditorState>(createEditorState());
  let error = $state('');
  let busy = $state(false);
  let progress = $state(0);
  let tab = $state<Tab>('crop');

  // Draw tools
  let brush = $state<BrushKind>('pen');
  let brushColor = $state('#ff3b30');
  let brushWidth = $state(0.012);

  // Layer editing
  let selectedId = $state<number | null>(null);
  let nextId = 1;

  // Undo/redo over the annotation layers only — crop and filters have their own
  // obvious reset, and mixing them into one stack makes the buttons unreadable.
  type Snapshot = {strokes: string; layers: string};
  let history: Snapshot[] = [{strokes: '[]', layers: '[]'}];
  let historyIndex = $state(0);

  let canvas = $state<HTMLCanvasElement | null>(null);
  let boxWidth = $state(0);
  let boxHeight = $state(0);
  let frames = $state<FrameThumb[]>([]);
  let playing = $state(false);

  const tabs = $derived<{id: Tab; label: string}[]>(
    circle ?
      [{id: 'crop', label: 'Crop'}, {id: 'filters', label: 'Filters'}] :
      [
        {id: 'crop', label: 'Crop'},
        {id: 'filters', label: 'Filters'},
        {id: 'draw', label: 'Draw'},
        {id: 'text', label: 'Text'},
        {id: 'stickers', label: 'Stickers'},
        ...(source?.kind === 'video' ? [{id: 'trim' as Tab, label: 'Trim'}] : [])
      ]
  );

  const selected = $derived(edit.layers.find((layer) => layer.id === selectedId) ?? null);
  const selectedText = $derived(selected?.type === 'text' ? (selected as TextLayer) : null);

  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  $effect(() => {
    let cancelled = false;
    const current = file;
    loadSource(current)
      .then((loaded) => {
        if(cancelled) {
          releaseSource(loaded);
          return;
        }
        source = loaded;
        const fresh = createEditorState(loaded.duration);
        if(circle) {
          fresh.aspectId = 'square';
          fresh.crop = cropForRatio(loaded, fresh, 1);
        }
        edit = fresh;
        if(loaded.kind === 'video') {
          extractFrames(loaded, 10).then((list) => {
            if(cancelled) list.forEach((frame) => URL.revokeObjectURL(frame.url));
            else frames = list;
          });
        }
      })
      .catch(() => {
        if(!cancelled) error = 'This file cannot be edited here.';
      });

    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    if(source) releaseSource(source);
    frames.forEach((frame) => URL.revokeObjectURL(frame.url));
  });

  /* ---------------------------------------------------------------- */
  /* Stage sizing and rendering                                        */
  /* ---------------------------------------------------------------- */

  // In the crop tab the whole (oriented) frame is on screen with the crop rect
  // drawn over it; every other tab shows the cropped result.
  const cropping = $derived(tab === 'crop');

  const stageAspect = $derived.by(() => {
    if(!source) return 1;
    const oriented = orientedSize(source, edit);
    if(cropping) return oriented.width / oriented.height;
    return (oriented.width * edit.crop.w) / (oriented.height * edit.crop.h);
  });

  const stageSize = $derived.by(() => {
    if(!boxWidth || !boxHeight) return {width: 0, height: 0};
    let width = boxWidth;
    let height = width / stageAspect;
    if(height > boxHeight) {
      height = boxHeight;
      width = height * stageAspect;
    }
    return {width: Math.round(width), height: Math.round(height)};
  });

  function renderEditState(): EditorState {
    // The crop tab renders the untouched frame; the rect is an HTML overlay.
    return cropping ? {...edit, crop: {x: 0, y: 0, w: 1, h: 1}} : edit;
  }

  function paint() {
    if(!canvas || !source || !stageSize.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.min(Math.round(stageSize.width * dpr), 1600);
    const height = Math.max(1, Math.round(width / stageAspect));
    renderFrame(canvas, source, renderEditState(), width, height, {
      circle: circle && !cropping,
      layers: !cropping,
      fast: dragging || playing
    });
  }

  $effect(() => {
    // Reading these keeps the effect subscribed to every editable value.
    void edit.crop.x, edit.crop.y, edit.crop.w, edit.crop.h;
    void edit.rotation, edit.straighten, edit.flipH, edit.flipV;
    void edit.adjustments.brightness, edit.adjustments.contrast, edit.adjustments.saturation;
    void edit.adjustments.warmth, edit.adjustments.vignette, edit.adjustments.sharpen;
    void edit.strokes.length, edit.layers.length, historyIndex, tab;
    void stageSize.width, stageSize.height, canvas, source;
    for(const layer of edit.layers) void layer.x, layer.y, layer.rotation;
    paint();
  });

  // Video keeps painting while it plays; a still frame only repaints on change.
  $effect(() => {
    const video = source?.kind === 'video' ? (source.element as HTMLVideoElement) : null;
    if(!video || !playing) return;
    let raf = requestAnimationFrame(function tick() {
      if(video.currentTime >= edit.trimEnd) {
        video.pause();
        playing = false;
        return;
      }
      paint();
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });

  function togglePlay() {
    const video = source?.element as HTMLVideoElement | undefined;
    if(!video) return;
    if(playing) {
      video.pause();
      playing = false;
      return;
    }
    if(video.currentTime < edit.trimStart || video.currentTime >= edit.trimEnd) {
      video.currentTime = edit.trimStart;
    }
    video.play().then(() => (playing = true)).catch(() => {});
  }

  /* ---------------------------------------------------------------- */
  /* History                                                           */
  /* ---------------------------------------------------------------- */

  function pushHistory() {
    const snapshot: Snapshot = {
      strokes: JSON.stringify(edit.strokes),
      layers: JSON.stringify(edit.layers)
    };
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    historyIndex = history.length - 1;
  }

  function applySnapshot(snapshot: Snapshot) {
    edit.strokes = JSON.parse(snapshot.strokes);
    edit.layers = JSON.parse(snapshot.layers);
    if(!edit.layers.some((layer) => layer.id === selectedId)) selectedId = null;
  }

  function undo() {
    if(historyIndex <= 0) return;
    historyIndex--;
    applySnapshot(history[historyIndex]);
  }

  function redo() {
    if(historyIndex >= history.length - 1) return;
    historyIndex++;
    applySnapshot(history[historyIndex]);
  }

  /* ---------------------------------------------------------------- */
  /* Crop controls                                                     */
  /* ---------------------------------------------------------------- */

  function setAspect(id: string) {
    if(!source) return;
    edit.aspectId = id;
    const aspect = ASPECT_PRESETS.find((item) => item.id === id);
    if(!aspect || aspect.ratio === null) return;
    edit.crop = cropForRatio(source, edit, aspect.ratio);
  }

  function rotate() {
    if(!source) return;
    edit.rotation = (edit.rotation + 1) % 4;
    // The crop rect lives in oriented space, so turn it with the image.
    const crop = edit.crop;
    edit.crop = clampCrop({x: 1 - crop.y - crop.h, y: crop.x, w: crop.h, h: crop.w});
    if(circle) edit.crop = cropForRatio(source, edit, 1);
  }

  function reframe() {
    if(!source) return;
    const aspect = ASPECT_PRESETS.find((item) => item.id === edit.aspectId);
    edit.crop = aspect && aspect.ratio !== null ?
      cropForRatio(source, edit, aspect.ratio) :
      {x: 0, y: 0, w: 1, h: 1};
  }

  function resetCrop() {
    edit.rotation = 0;
    edit.straighten = 0;
    edit.flipH = false;
    edit.flipV = false;
    edit.aspectId = circle ? 'square' : 'free';
    reframe();
  }

  /* ---------------------------------------------------------------- */
  /* Pointer handling                                                  */
  /* ---------------------------------------------------------------- */

  type Drag =
    | {mode: 'crop'; handle: string; startX: number; startY: number; crop: {x: number; y: number; w: number; h: number}}
    | {mode: 'stroke'}
    | {mode: 'move'; id: number; dx: number; dy: number}
    | {mode: 'transform'; id: number; size: number; rotation: number; distance: number; angle: number};

  let drag: Drag | null = null;
  let dragging = $state(false);

  function pointerAt(e: PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height
    };
  }

  function onPointerDown(e: PointerEvent) {
    if(!source) return;
    const point = pointerAt(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;

    if(cropping) {
      drag = {mode: 'crop', handle: cropHandleAt(point.x, point.y), startX: point.x, startY: point.y, crop: {...edit.crop}};
      return;
    }

    if(tab === 'draw') {
      edit.strokes.push({
        kind: brush,
        color: brushColor,
        width: brush === 'eraser' ? brushWidth * 2 : brushWidth,
        points: [point]
      });
      drag = {mode: 'stroke'};
      return;
    }

    if(tab === 'text' || tab === 'stickers') {
      const width = stageSize.width || 1;
      const height = stageSize.height || 1;
      const px = point.x * width;
      const py = point.y * height;

      if(selected) {
        const bounds = layerBounds(selected, width, height);
        const cos = Math.cos(selected.rotation);
        const sin = Math.sin(selected.rotation);
        const hx = bounds.cx + (bounds.w / 2) * cos - (bounds.h / 2) * sin;
        const hy = bounds.cy + (bounds.w / 2) * sin + (bounds.h / 2) * cos;
        if(Math.hypot(px - hx, py - hy) < 26) {
          const dx = px - bounds.cx;
          const dy = py - bounds.cy;
          drag = {
            mode: 'transform',
            id: selected.id,
            size: selected.type === 'text' ? (selected as TextLayer).size : (selected as StickerLayer).size,
            rotation: selected.rotation,
            distance: Math.max(1, Math.hypot(dx, dy)),
            angle: Math.atan2(dy, dx)
          };
          return;
        }
      }

      const hit = hitLayer(edit.layers, px, py, width, height);
      if(hit) {
        selectedId = hit.id;
        drag = {mode: 'move', id: hit.id, dx: point.x - hit.x, dy: point.y - hit.y};
      } else {
        selectedId = null;
        drag = null;
        dragging = false;
      }
    }
  }

  function onPointerMove(e: PointerEvent) {
    if(!drag || !source) return;
    const point = pointerAt(e);

    if(drag.mode === 'stroke') {
      const stroke = edit.strokes[edit.strokes.length - 1];
      if(stroke) stroke.points.push(point);
      paint();
      return;
    }

    if(drag.mode === 'crop') {
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      const base = drag.crop;
      let next = {...base};
      const ratio = lockedRatio();

      if(drag.handle === 'move') {
        next.x = base.x + dx;
        next.y = base.y + dy;
      } else {
        if(drag.handle.includes('w')) {
          next.x = base.x + dx;
          next.w = base.w - dx;
        }
        if(drag.handle.includes('e')) next.w = base.w + dx;
        if(drag.handle.includes('n')) {
          next.y = base.y + dy;
          next.h = base.h - dy;
        }
        if(drag.handle.includes('s')) next.h = base.h + dy;

        if(ratio) {
          const oriented = orientedSize(source, edit);
          // The rect is normalised on two different axes, so the ratio lock has
          // to go through pixels or a 16:9 crop comes out skewed.
          const heightPx = (next.w * oriented.width) / ratio;
          const h = heightPx / oriented.height;
          if(drag.handle.includes('n')) next.y = base.y + base.h - h;
          next.h = h;
        }
      }

      if(next.w > 0.02 && next.h > 0.02) edit.crop = clampCrop(next);
      return;
    }

    const active = drag;
    const layer = edit.layers.find((item) => item.id === active.id);
    if(!layer) return;

    if(active.mode === 'move') {
      layer.x = Math.max(0, Math.min(1, point.x - active.dx));
      layer.y = Math.max(0, Math.min(1, point.y - active.dy));
      paint();
      return;
    }

    const width = stageSize.width || 1;
    const height = stageSize.height || 1;
    const dx = point.x * width - layer.x * width;
    const dy = point.y * height - layer.y * height;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const scale = distance / active.distance;
    layer.rotation = active.rotation + (Math.atan2(dy, dx) - active.angle);
    if(layer.type === 'text') layer.size = Math.max(0.02, Math.min(0.6, active.size * scale));
    else layer.size = Math.max(0.04, Math.min(1.2, active.size * scale));
    paint();
  }

  function onPointerUp() {
    const had = drag;
    drag = null;
    dragging = false;
    if(had && had.mode !== 'crop') pushHistory();
    paint();
  }

  function lockedRatio(): number | null {
    if(circle) return 1;
    const aspect = ASPECT_PRESETS.find((item) => item.id === edit.aspectId);
    if(!aspect || aspect.ratio === null) return null;
    if(aspect.ratio === 0 && source) return source.width / source.height;
    return aspect.ratio || null;
  }

  function cropHandleAt(x: number, y: number) {
    const crop = edit.crop;
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
      id: nextId++,
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
    edit.layers.push(layer);
    selectedId = layer.id;
    tab = 'text';
    pushHistory();
  }

  function addEmoji(emoji: string) {
    const layer: StickerLayer = {
      id: nextId++,
      type: 'sticker',
      emoji,
      url: '',
      x: 0.5,
      y: 0.5,
      size: 0.25,
      rotation: 0
    };
    edit.layers.push(layer);
    selectedId = layer.id;
    pushHistory();
  }

  async function addSticker(docId: string) {
    const url = await loadDocUrl(docId);
    if(!url || !(await registerStickerImage(url))) {
      error = 'That sticker could not be added.';
      return;
    }
    const layer: StickerLayer = {
      id: nextId++,
      type: 'sticker',
      emoji: '',
      url,
      x: 0.5,
      y: 0.5,
      size: 0.3,
      rotation: 0
    };
    edit.layers.push(layer);
    selectedId = layer.id;
    pushHistory();
  }

  function removeSelected() {
    if(selectedId === null) return;
    edit.layers = edit.layers.filter((layer) => layer.id !== selectedId);
    selectedId = null;
    pushHistory();
  }

  const selectionBox = $derived.by(() => {
    if(!selected || !stageSize.width || (tab !== 'text' && tab !== 'stickers')) return null;
    const bounds = layerBounds(selected as Layer, stageSize.width, stageSize.height);
    return {
      left: bounds.cx - bounds.w / 2,
      top: bounds.cy - bounds.h / 2,
      width: bounds.w,
      height: bounds.h,
      rotation: (selected.rotation * 180) / Math.PI
    };
  });

  /* ---------------------------------------------------------------- */
  /* Export                                                            */
  /* ---------------------------------------------------------------- */

  let abort: AbortController | null = null;

  async function save() {
    if(!source || busy) return;
    busy = true;
    error = '';
    progress = 0;
    try {
      if(source.kind === 'video') {
        if(!canExportVideo()) throw new Error('This browser cannot re-encode video');
        abort = new AbortController();
        const cover = await exportCover(source, edit, edit.coverTime || edit.trimStart);
        const edited = await exportVideo(source, edit, {
          signal: abort.signal,
          onProgress: (value) => (progress = value)
        });
        onapply(edited, cover);
      } else {
        onapply(await exportImage(source, edit, {circle}));
      }
    } catch(err: any) {
      if(err?.name !== 'AbortError') error = err?.message ?? 'Could not save the edit.';
    } finally {
      abort = null;
      busy = false;
    }
  }

  function cancelExport() {
    abort?.abort();
  }

  function onKey(e: KeyboardEvent) {
    if(e.key === 'Escape' && !busy) oncancel();
  }

  const duration = $derived(source?.duration ?? 0);

  function stamp(seconds: number) {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${`${total % 60}`.padStart(2, '0')}`;
  }

  function setTrim(which: 'start' | 'end', value: number) {
    if(which === 'start') edit.trimStart = Math.min(value, edit.trimEnd - 0.2);
    else edit.trimEnd = Math.max(value, edit.trimStart + 0.2);
    const video = source?.element as HTMLVideoElement | undefined;
    if(video) {
      seek(video, which === 'start' ? edit.trimStart : edit.trimEnd).then(paint);
    }
  }

  function setCover(value: number) {
    edit.coverTime = value;
    const video = source?.element as HTMLVideoElement | undefined;
    if(video) seek(video, value).then(paint);
  }

  // Seed one sticker decode per unique URL after an undo restores layers.
  $effect(() => {
    for(const layer of edit.layers) {
      if(layer.type === 'sticker' && layer.url) untrack(() => registerStickerImage(layer.url).then(paint));
    }
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="editor">
  <header>
    <button type="button" onclick={oncancel} disabled={busy}>Cancel</button>
    <span class="title">{circle ? 'Crop photo' : source?.kind === 'video' ? 'Edit video' : 'Edit photo'}</span>
    <button type="button" class="primary" onclick={save} disabled={busy || !source}>
      {busy ? 'Saving…' : 'Done'}
    </button>
  </header>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  <div class="stage" bind:clientWidth={boxWidth} bind:clientHeight={boxHeight}>
    {#if source}
      <div
        class="frame"
        class:round={circle && !cropping}
        style="width: {stageSize.width}px; height: {stageSize.height}px"
      >
        <canvas bind:this={canvas} style="width: 100%; height: 100%"></canvas>

        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="surface"
          class:drawing={tab === 'draw'}
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
        >
          {#if cropping}
            <div
              class="crop-rect"
              class:round={circle}
              style="left: {edit.crop.x * 100}%; top: {edit.crop.y * 100}%; width: {edit.crop.w * 100}%; height: {edit.crop.h * 100}%"
            >
              <span class="handle nw"></span>
              <span class="handle ne"></span>
              <span class="handle sw"></span>
              <span class="handle se"></span>
            </div>
          {:else if selectionBox}
            <div
              class="selection"
              style="left: {selectionBox.left}px; top: {selectionBox.top}px; width: {selectionBox.width}px; height: {selectionBox.height}px; transform: rotate({selectionBox.rotation}deg)"
            >
              <span class="grip"></span>
            </div>
          {/if}
        </div>
      </div>
    {:else if !error}
      <p class="loading">Loading…</p>
    {/if}
  </div>

  {#if busy && source?.kind === 'video'}
    <div class="export">
      <div class="bar"><span style="width: {Math.round(progress * 100)}%"></span></div>
      <span class="muted">Re-encoding in real time — {Math.round(progress * 100)}%</span>
      <button type="button" onclick={cancelExport}>Stop</button>
    </div>
  {/if}

  <nav class="tabs">
    {#each tabs as item (item.id)}
      <button type="button" class:on={tab === item.id} onclick={() => (tab = item.id)}>{item.label}</button>
    {/each}
  </nav>

  <div class="panel">
    {#if tab === 'crop'}
      {#if !circle}
        <div class="chips">
          {#each ASPECT_PRESETS as aspect (aspect.id)}
            <button type="button" class:on={edit.aspectId === aspect.id} onclick={() => setAspect(aspect.id)}>
              {aspect.label}
            </button>
          {/each}
        </div>
      {/if}

      <div class="row">
        <button type="button" onclick={rotate}>Rotate 90°</button>
        <button type="button" class:on={edit.flipH} onclick={() => (edit.flipH = !edit.flipH)}>Flip H</button>
        <button type="button" class:on={edit.flipV} onclick={() => (edit.flipV = !edit.flipV)}>Flip V</button>
        <button type="button" onclick={resetCrop}>Reset</button>
      </div>

      <label class="slider">
        <span>Straighten <b>{edit.straighten.toFixed(0)}°</b></span>
        <input type="range" min="-45" max="45" step="0.5" bind:value={edit.straighten} />
      </label>
    {:else if tab === 'filters'}
      <div class="chips">
        {#each FILTER_PRESETS as item (item.id)}
          <button
            type="button"
            class:on={edit.presetId === item.id}
            onclick={() => {
              edit.presetId = item.id;
              edit.adjustments = {...item.adjustments};
            }}
          >
            {item.name}
          </button>
        {/each}
      </div>

      {#each [['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100], ['saturation', 'Saturation', -100, 100], ['warmth', 'Warmth', -100, 100], ['vignette', 'Vignette', 0, 100], ['sharpen', 'Sharpen', 0, 100]] as slider (slider[0])}
        <label class="slider">
          <span>{slider[1]} <b>{edit.adjustments[slider[0] as 'brightness']}</b></span>
          <input
            type="range"
            min={slider[2]}
            max={slider[3]}
            step="1"
            value={edit.adjustments[slider[0] as 'brightness']}
            oninput={(e) => {
              edit.adjustments[slider[0] as 'brightness'] = +e.currentTarget.value;
              edit.presetId = 'custom';
            }}
          />
        </label>
      {/each}
    {:else if tab === 'draw'}
      <div class="chips">
        {#each [['pen', 'Pen'], ['arrow', 'Arrow'], ['marker', 'Marker'], ['neon', 'Neon'], ['eraser', 'Eraser']] as tool (tool[0])}
          <button type="button" class:on={brush === tool[0]} onclick={() => (brush = tool[0] as BrushKind)}>
            {tool[1]}
          </button>
        {/each}
      </div>

      <div class="swatches">
        {#each PALETTE as color (color)}
          <button
            type="button"
            class="swatch"
            class:on={brushColor === color}
            style="background: {color}"
            aria-label={color}
            onclick={() => (brushColor = color)}
          ></button>
        {/each}
      </div>

      <label class="slider">
        <span>Width</span>
        <input type="range" min="0.003" max="0.06" step="0.001" bind:value={brushWidth} />
      </label>

      <div class="row">
        <button type="button" onclick={undo} disabled={historyIndex <= 0}>Undo</button>
        <button type="button" onclick={redo} disabled={historyIndex >= history.length - 1}>Redo</button>
        <button
          type="button"
          onclick={() => {
            edit.strokes = [];
            pushHistory();
          }}
        >
          Clear
        </button>
      </div>
    {:else if tab === 'text'}
      <div class="row">
        <button type="button" onclick={addText}>Add text</button>
        <button type="button" onclick={removeSelected} disabled={!selected}>Remove</button>
        <button type="button" onclick={undo} disabled={historyIndex <= 0}>Undo</button>
        <button type="button" onclick={redo} disabled={historyIndex >= history.length - 1}>Redo</button>
      </div>

      {#if selectedText}
        <input
          class="text-input"
          value={selectedText.text}
          placeholder="Text"
          oninput={(e) => (selectedText.text = e.currentTarget.value)}
          onchange={pushHistory}
        />

        <div class="chips">
          {#each FONTS as font (font.id)}
            <button
              type="button"
              class:on={selectedText.font === font.family}
              onclick={() => (selectedText.font = font.family)}
            >
              {font.label}
            </button>
          {/each}
        </div>

        <div class="chips">
          {#each ['left', 'center', 'right'] as align (align)}
            <button
              type="button"
              class:on={selectedText.align === align}
              onclick={() => (selectedText.align = align as CanvasTextAlign)}
            >
              {align}
            </button>
          {/each}
          {#each ['plain', 'outline', 'background'] as style (style)}
            <button
              type="button"
              class:on={selectedText.style === style}
              onclick={() => (selectedText.style = style as TextLayer['style'])}
            >
              {style}
            </button>
          {/each}
        </div>

        <div class="swatches">
          {#each PALETTE as color (color)}
            <button
              type="button"
              class="swatch"
              class:on={selectedText.color === color}
              style="background: {color}"
              aria-label={color}
              onclick={() => (selectedText.color = color)}
            ></button>
          {/each}
        </div>

        <label class="slider">
          <span>Size</span>
          <input
            type="range"
            min="0.02"
            max="0.4"
            step="0.005"
            value={selectedText.size}
            oninput={(e) => (selectedText.size = +e.currentTarget.value)}
          />
        </label>
      {:else}
        <p class="muted">Add a text layer, then drag it on the image. The corner grip scales and rotates it.</p>
      {/if}
    {:else if tab === 'stickers'}
      <div class="row">
        <button type="button" onclick={removeSelected} disabled={!selected}>Remove</button>
        <button type="button" onclick={undo} disabled={historyIndex <= 0}>Undo</button>
        <button type="button" onclick={redo} disabled={historyIndex >= history.length - 1}>Redo</button>
      </div>
      <div class="picker">
        <Picker onemoji={addEmoji} ondocument={addSticker} />
      </div>
    {:else if tab === 'trim'}
      <div class="row">
        <button type="button" onclick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
        <span class="muted">{stamp(edit.trimStart)} – {stamp(edit.trimEnd)} of {stamp(duration)}</span>
      </div>

      {#if frames.length}
        <div class="strip">
          {#each frames as frame (frame.url)}
            <img src={frame.url} alt="" />
          {/each}
          <div
            class="mask left"
            style="width: {duration ? (edit.trimStart / duration) * 100 : 0}%"
          ></div>
          <div
            class="mask right"
            style="width: {duration ? ((duration - edit.trimEnd) / duration) * 100 : 0}%"
          ></div>
        </div>
      {/if}

      <label class="slider">
        <span>Start <b>{stamp(edit.trimStart)}</b></span>
        <input
          type="range"
          min="0"
          max={duration}
          step="0.05"
          value={edit.trimStart}
          oninput={(e) => setTrim('start', +e.currentTarget.value)}
        />
      </label>

      <label class="slider">
        <span>End <b>{stamp(edit.trimEnd)}</b></span>
        <input
          type="range"
          min="0"
          max={duration}
          step="0.05"
          value={edit.trimEnd}
          oninput={(e) => setTrim('end', +e.currentTarget.value)}
        />
      </label>

      <label class="slider">
        <span>Cover frame <b>{stamp(edit.coverTime)}</b></span>
        <input
          type="range"
          min="0"
          max={duration}
          step="0.05"
          value={edit.coverTime}
          oninput={(e) => setCover(+e.currentTarget.value)}
        />
      </label>

      {#if !canExportVideo()}
        <p class="muted">This browser cannot re-encode video, so the trim cannot be applied here.</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .editor {
    position: fixed;
    inset: 0;
    z-index: 99;
    display: flex;
    flex-direction: column;
    background: var(--bg-solid, var(--bg-elevated, #111));
    color: inherit;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .title {
    font-weight: 600;
  }

  header button,
  .row button,
  .chips button,
  .export button {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  header .primary {
    background: var(--action, var(--accent));
    border-color: transparent;
    color: var(--action-ink, #fff);
    font-weight: 600;
  }

  .chips button.on,
  .row button.on {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .stage {
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    padding: 12px;
    background: #000;
    overflow: hidden;
  }

  .frame {
    position: relative;
    touch-action: none;
  }

  .frame.round canvas {
    border-radius: 50%;
  }

  canvas {
    display: block;
  }

  .surface {
    position: absolute;
    inset: 0;
    cursor: grab;
  }

  .surface.drawing {
    cursor: crosshair;
  }

  .crop-rect {
    position: absolute;
    border: 2px solid #fff;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  }

  .crop-rect.round {
    border-radius: 50%;
  }

  .handle {
    position: absolute;
    width: 14px;
    height: 14px;
    background: #fff;
    border-radius: 3px;
  }

  .nw {
    left: -7px;
    top: -7px;
  }

  .ne {
    right: -7px;
    top: -7px;
  }

  .sw {
    left: -7px;
    bottom: -7px;
  }

  .se {
    right: -7px;
    bottom: -7px;
  }

  .selection {
    position: absolute;
    border: 1px dashed rgba(255, 255, 255, 0.9);
    pointer-events: none;
  }

  .grip {
    position: absolute;
    right: -8px;
    bottom: -8px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
  }

  .tabs {
    display: flex;
    gap: 4px;
    padding: 8px 12px 0;
    overflow-x: auto;
  }

  .tabs button {
    padding: 8px 14px;
    border: none;
    border-radius: 10px 10px 0 0;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
  }

  .tabs button.on {
    background: var(--bg-elevated, rgba(255, 255, 255, 0.08));
    color: inherit;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px 16px;
    max-height: 42vh;
    overflow-y: auto;
    border-top: 1px solid var(--border);
  }

  .chips,
  .row,
  .swatches {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
    padding: 0;
  }

  .swatch.on {
    border-color: var(--accent);
  }

  .slider {
    display: grid;
    gap: 4px;
    font-size: 12px;
  }

  .slider input {
    width: 100%;
  }

  .text-input {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    outline: none;
  }

  .picker {
    height: 260px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .strip {
    position: relative;
    display: flex;
    gap: 1px;
    height: 56px;
    overflow: hidden;
    border-radius: 8px;
  }

  .strip img {
    flex: 1;
    min-width: 0;
    height: 100%;
    object-fit: cover;
  }

  .mask {
    position: absolute;
    top: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
  }

  .mask.left {
    left: 0;
  }

  .mask.right {
    right: 0;
  }

  .export {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
  }

  .bar {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: var(--border);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .muted {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }

  .error {
    margin: 0;
    padding: 8px 14px;
    font-size: 13px;
    color: #ff6b6b;
  }

  .loading {
    color: #fff;
  }
</style>
