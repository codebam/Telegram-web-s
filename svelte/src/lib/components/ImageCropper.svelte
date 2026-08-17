<script lang="ts">
  /**
   * Square crop + zoom step, shared by the user avatar upload and (later) group
   * and channel photos. Hands back a plain JPEG `Blob` — no `$state` proxy ever
   * reaches the caller, so the result stays structured-cloneable for the worker.
   */
  let {
    file,
    title = 'Crop photo',
    output = 640,
    onconfirm,
    oncancel
  }: {
    file: File;
    title?: string;
    /** Side length of the produced square, in pixels. */
    output?: number;
    onconfirm: (blob: Blob) => void;
    oncancel: () => void;
  } = $props();

  const VIEW = 260;

  let image = $state<HTMLImageElement | null>(null);
  let error = $state('');
  let zoom = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let dragging = $state(false);
  let busy = $state(false);

  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;

  $effect(() => {
    const current = file;
    const url = URL.createObjectURL(current);
    const element = new Image();

    element.onload = () => {
      if (file !== current) return;
      image = element;
      zoom = 1;
      offsetX = 0;
      offsetY = 0;
    };
    element.onerror = () => {
      if (file === current) error = 'That file is not an image the browser can read.';
    };
    element.src = url;

    return () => URL.revokeObjectURL(url);
  });

  /**
   * Scale at which the image exactly covers the square viewport. Everything else
   * is expressed as a multiple of it, so zoom 1 is always "no empty corners".
   */
  const baseScale = $derived(
    image ? Math.max(VIEW / image.naturalWidth, VIEW / image.naturalHeight) : 1
  );
  const scale = $derived(baseScale * zoom);
  const drawWidth = $derived(image ? image.naturalWidth * scale : 0);
  const drawHeight = $derived(image ? image.naturalHeight * scale : 0);

  /** How far the image may travel before an edge would leave the viewport. */
  const maxOffsetX = $derived(Math.max(0, (drawWidth - VIEW) / 2));
  const maxOffsetY = $derived(Math.max(0, (drawHeight - VIEW) / 2));

  const clampedX = $derived(Math.max(-maxOffsetX, Math.min(maxOffsetX, offsetX)));
  const clampedY = $derived(Math.max(-maxOffsetY, Math.min(maxOffsetY, offsetY)));

  function startDrag(event: PointerEvent) {
    if (!image) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragOriginX = clampedX;
    dragOriginY = clampedY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent) {
    if (!dragging) return;
    offsetX = dragOriginX + (event.clientX - dragStartX);
    offsetY = dragOriginY + (event.clientY - dragStartY);
  }

  function endDrag(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    offsetX = clampedX;
    offsetY = clampedY;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    zoom = Math.max(1, Math.min(4, zoom - event.deltaY / 500));
  }

  async function confirm() {
    if (!image || busy) return;
    busy = true;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = output;
      canvas.height = output;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');

      // Map the on-screen viewport back onto the source image: the visible
      // square is `VIEW / scale` source pixels wide, centred on the drag offset.
      const sourceSide = VIEW / scale;
      const sourceX = (image.naturalWidth - sourceSide) / 2 - clampedX / scale;
      const sourceY = (image.naturalHeight - sourceSide) / 2 - clampedY / scale;

      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSide,
        sourceSide,
        0,
        0,
        output,
        output
      );

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.92)
      );
      if (!blob) throw new Error('Could not encode the cropped image');

      onconfirm(blob);
    } catch (err: any) {
      error = err?.message || 'Could not crop that image';
      busy = false;
    }
  }
</script>

<div class="backdrop" onclick={oncancel} role="presentation">
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>{title}</header>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div
      class="viewport"
      class:grabbing={dragging}
      style="width: {VIEW}px; height: {VIEW}px"
      onpointerdown={startDrag}
      onpointermove={moveDrag}
      onpointerup={endDrag}
      onpointercancel={endDrag}
      onwheel={onWheel}
      role="presentation"
    >
      {#if image}
        <img
          src={image.src}
          alt=""
          draggable="false"
          style="width: {drawWidth}px; height: {drawHeight}px; transform: translate({clampedX}px, {clampedY}px)"
        />
        <span class="mask"></span>
      {:else if !error}
        <span class="muted">Loading…</span>
      {/if}
    </div>

    <label class="zoom">
      <span>Zoom</span>
      <input type="range" min="1" max="4" step="0.01" bind:value={zoom} disabled={!image} />
    </label>

    <p class="muted small">Drag to reposition, scroll or use the slider to zoom.</p>

    <footer>
      <button onclick={oncancel}>Cancel</button>
      <button class="primary" onclick={confirm} disabled={!image || busy}>
        {busy ? 'Working…' : 'Use photo'}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
  }

  .dialog {
    display: grid;
    gap: 12px;
    justify-items: center;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: var(--pane-radius);
    background: var(--bg);
    max-width: calc(100vw - 32px);
  }

  header {
    font-weight: 600;
    justify-self: start;
  }

  .viewport {
    position: relative;
    overflow: hidden;
    border-radius: 12px;
    background: #000;
    cursor: grab;
    touch-action: none;
    display: grid;
    place-items: center;
    user-select: none;
  }

  .viewport.grabbing {
    cursor: grabbing;
  }

  .viewport img {
    position: absolute;
    max-width: none;
    pointer-events: none;
  }

  /* Circular cut-out preview — the server renders avatars round. */
  .mask {
    position: absolute;
    inset: 0;
    pointer-events: none;
    box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.45);
    border-radius: 50%;
  }

  .zoom {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 10px;
    width: 100%;
    font-size: 12px;
    color: var(--text-dim);
  }

  .zoom input {
    width: 100%;
  }

  footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    width: 100%;
  }

  footer button {
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  footer button.primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }

  .muted {
    color: var(--text-dim);
  }

  .small {
    font-size: 12px;
    margin: 0;
    justify-self: start;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
    justify-self: start;
  }
</style>
