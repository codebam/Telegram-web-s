/*
 * Ported from svelte/src/lib/components/ImageCropper.svelte.
 *
 * Two details of the port:
 *  - `file` is read inside the image's `onload`/`onerror` callbacks, where a
 *    closure would see the value from the render that started the load while
 *    Svelte always saw the current prop. The latest one is therefore kept in a
 *    ref, as in `Avatar.tsx`.
 *  - the four `drag*` scratch values were plain `let` in Svelte, which is once
 *    per instance; a Preact body runs on every render, so they live in refs and
 *    survive from `pointerdown` to `pointermove`.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useComputed, useSignal} from '@preact/signals';

import './ImageCropper.css';

interface Props {
  file: File;
  title?: string;
  /** Side length of the produced square, in pixels. */
  output?: number;
  onconfirm: (blob: Blob) => void;
  oncancel: () => void;
}

/**
 * Square crop + zoom step, shared by the user avatar upload and (later) group
 * and channel photos. Hands back a plain JPEG `Blob` — no signal proxy ever
 * reaches the caller, so the result stays structured-cloneable for the worker.
 */
export function ImageCropper({
  file,
  title = 'Crop photo',
  output = 640,
  onconfirm,
  oncancel
}: Props) {
  const VIEW = 260;

  const image = useSignal<HTMLImageElement | null>(null);
  const error = useSignal('');
  const zoom = useSignal(1);
  const offsetX = useSignal(0);
  const offsetY = useSignal(0);
  const dragging = useSignal(false);
  const busy = useSignal(false);

  const dragStartX = useRef(0);
  const dragStartY = useRef(0);
  const dragOriginX = useRef(0);
  const dragOriginY = useRef(0);

  // The callbacks below compare against the *current* file, so the latest prop
  // is kept in a ref rather than captured by the closure.
  const currentFile = useRef(file);
  currentFile.current = file;

  useEffect(() => {
    const current = file;
    const url = URL.createObjectURL(current);
    const element = new Image();

    element.onload = () => {
      if(currentFile.current !== current) return;
      image.value = element;
      zoom.value = 1;
      offsetX.value = 0;
      offsetY.value = 0;
    };
    element.onerror = () => {
      if(currentFile.current === current) error.value = 'That file is not an image the browser can read.';
    };
    element.src = url;

    return () => URL.revokeObjectURL(url);
  }, [file]);

  /**
   * Scale at which the image exactly covers the square viewport. Everything else
   * is expressed as a multiple of it, so zoom 1 is always "no empty corners".
   */
  const baseScale = useComputed(() =>
    image.value ? Math.max(VIEW / image.value.naturalWidth, VIEW / image.value.naturalHeight) : 1
  );
  const scale = useComputed(() => baseScale.value * zoom.value);
  const drawWidth = useComputed(() => image.value ? image.value.naturalWidth * scale.value : 0);
  const drawHeight = useComputed(() => image.value ? image.value.naturalHeight * scale.value : 0);

  /** How far the image may travel before an edge would leave the viewport. */
  const maxOffsetX = useComputed(() => Math.max(0, (drawWidth.value - VIEW) / 2));
  const maxOffsetY = useComputed(() => Math.max(0, (drawHeight.value - VIEW) / 2));

  const clampedX = useComputed(() => Math.max(-maxOffsetX.value, Math.min(maxOffsetX.value, offsetX.value)));
  const clampedY = useComputed(() => Math.max(-maxOffsetY.value, Math.min(maxOffsetY.value, offsetY.value)));

  function startDrag(event: PointerEvent) {
    if(!image.value) return;
    dragging.value = true;
    dragStartX.current = event.clientX;
    dragStartY.current = event.clientY;
    dragOriginX.current = clampedX.value;
    dragOriginY.current = clampedY.value;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent) {
    if(!dragging.value) return;
    offsetX.value = dragOriginX.current + (event.clientX - dragStartX.current);
    offsetY.value = dragOriginY.current + (event.clientY - dragStartY.current);
  }

  function endDrag(event: PointerEvent) {
    if(!dragging.value) return;
    dragging.value = false;
    offsetX.value = clampedX.value;
    offsetY.value = clampedY.value;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    zoom.value = Math.max(1, Math.min(4, zoom.value - event.deltaY / 500));
  }

  async function confirm() {
    if(!image.value || busy.value) return;
    busy.value = true;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = output;
      canvas.height = output;
      const context = canvas.getContext('2d');
      if(!context) throw new Error('Canvas is unavailable');

      // Map the on-screen viewport back onto the source image: the visible
      // square is `VIEW / scale` source pixels wide, centred on the drag offset.
      const sourceSide = VIEW / scale.value;
      const sourceX = (image.value.naturalWidth - sourceSide) / 2 - clampedX.value / scale.value;
      const sourceY = (image.value.naturalHeight - sourceSide) / 2 - clampedY.value / scale.value;

      context.drawImage(
        image.value,
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
      if(!blob) throw new Error('Could not encode the cropped image');

      onconfirm(blob);
    } catch(err: any) {
      error.value = err?.message || 'Could not crop that image';
      busy.value = false;
    }
  }

  return (
    <div class="backdrop" onClick={oncancel} role="presentation">
      <div class="dialog" onClick={(e) => e.stopPropagation()} role="presentation">
        <header>{title}</header>

        {error.value && <p class="error">{error.value}</p>}

        <div
          class={['viewport', dragging.value && 'grabbing'].filter(Boolean).join(' ')}
          style={{width: `${VIEW}px`, height: `${VIEW}px`}}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
          role="presentation"
        >
          {image.value ?
            <>
              <img
                src={image.value.src}
                alt=""
                draggable={false}
                style={{
                  width: `${drawWidth.value}px`,
                  height: `${drawHeight.value}px`,
                  transform: `translate(${clampedX.value}px, ${clampedY.value}px)`
                }}
              />
              <span class="mask"></span>
            </> :
            !error.value ? <span class="muted">Loading…</span> : null}
        </div>

        <label class="zoom">
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max="4"
            step="0.01"
            value={zoom.value}
            onInput={(e) => (zoom.value = Number((e.target as HTMLInputElement).value))}
            disabled={!image.value}
          />
        </label>

        <p class="muted small">Drag to reposition, scroll or use the slider to zoom.</p>

        <footer>
          <button onClick={oncancel}>Cancel</button>
          <button class="primary" onClick={confirm} disabled={!image.value || busy.value}>
            {busy.value ? 'Working…' : 'Use photo'}
          </button>
        </footer>
      </div>
    </div>
  );
}
