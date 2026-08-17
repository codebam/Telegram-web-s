/**
 * Media editor — crop/rotate, adjustments, drawing, text and sticker layers for
 * an image (or a video, where the same pipeline is used for the preview, the
 * cover frame and a re-encoded trim).
 *
 * Everything here is plain DOM/canvas and self-contained: the CSP forbids any
 * external asset, so there is no third-party image library involved. The module
 * holds no Svelte state — `MediaEditor.svelte` owns an `EditorState` and hands
 * it back for every render and for the final export.
 *
 * Coordinate systems, because three of them meet in `renderFrame`:
 *  - *source* pixels: the decoded image/video, untouched.
 *  - *oriented* space: the source after the 90° rotation and the flips, which is
 *    what the user sees and what the crop rect is expressed in (normalised 0..1).
 *  - *output* space: the cropped result. Draw strokes, text and stickers live
 *    here, normalised 0..1, so a preview at 800px and an export at 2560px agree.
 */

export type Adjustments = {
  brightness: number;  // -100..100
  contrast: number;    // -100..100
  saturation: number;  // -100..100
  warmth: number;      // -100..100
  vignette: number;    // 0..100
  sharpen: number;     // 0..100
};

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  vignette: 0,
  sharpen: 0
};

export type FilterPreset = {
  id: string;
  name: string;
  adjustments: Adjustments;
};

function preset(id: string, name: string, over: Partial<Adjustments>): FilterPreset {
  return {id, name, adjustments: {...DEFAULT_ADJUSTMENTS, ...over}};
}

export const FILTER_PRESETS: FilterPreset[] = [
  preset('none', 'Original', {}),
  preset('vivid', 'Vivid', {saturation: 35, contrast: 18, sharpen: 20}),
  preset('warm', 'Warm', {warmth: 45, brightness: 6, saturation: 12}),
  preset('cool', 'Cool', {warmth: -45, contrast: 10}),
  preset('mono', 'Mono', {saturation: -100, contrast: 20}),
  preset('film', 'Film', {contrast: -12, saturation: -18, warmth: 18, vignette: 35}),
  preset('punch', 'Punch', {contrast: 30, saturation: 25, vignette: 25, sharpen: 30})
];

export type AspectPreset = {
  id: string;
  label: string;
  /** width / height, `null` for free, `0` for "original". */
  ratio: number | null;
};

export const ASPECT_PRESETS: AspectPreset[] = [
  {id: 'free', label: 'Free', ratio: null},
  {id: 'original', label: 'Original', ratio: 0},
  {id: 'square', label: '1:1', ratio: 1},
  {id: '3:2', label: '3:2', ratio: 3 / 2},
  {id: '2:3', label: '2:3', ratio: 2 / 3},
  {id: '4:3', label: '4:3', ratio: 4 / 3},
  {id: '3:4', label: '3:4', ratio: 3 / 4},
  {id: '16:9', label: '16:9', ratio: 16 / 9},
  {id: '9:16', label: '9:16', ratio: 9 / 16}
];

export type CropRect = {x: number; y: number; w: number; h: number};

export type Point = {x: number; y: number};

export type BrushKind = 'pen' | 'arrow' | 'marker' | 'neon' | 'eraser';

export type Stroke = {
  kind: BrushKind;
  color: string;
  /** Fraction of the output's smaller side, so it survives a resolution change. */
  width: number;
  points: Point[];
};

export type TextStyle = 'plain' | 'outline' | 'background';

export type TextLayer = {
  id: number;
  type: 'text';
  text: string;
  x: number;
  y: number;
  /** Fraction of the output height. */
  size: number;
  font: string;
  color: string;
  align: CanvasTextAlign;
  style: TextStyle;
  rotation: number;
};

export type StickerLayer = {
  id: number;
  type: 'sticker';
  /** Emoji glyph, or `''` when this is an image sticker. */
  emoji: string;
  /** Object URL of a rasterised sticker, resolved through `registerStickerImage`. */
  url: string;
  x: number;
  y: number;
  /** Fraction of the output's smaller side. */
  size: number;
  rotation: number;
};

export type Layer = TextLayer | StickerLayer;

export type EditorState = {
  crop: CropRect;
  aspectId: string;
  /** Quarter turns, 0..3. */
  rotation: number;
  /** Straightening angle in degrees, -45..45. */
  straighten: number;
  flipH: boolean;
  flipV: boolean;
  adjustments: Adjustments;
  presetId: string;
  strokes: Stroke[];
  layers: Layer[];
  /** Video only, seconds. */
  trimStart: number;
  trimEnd: number;
  coverTime: number;
};

export const FONTS = [
  {id: 'system', label: 'Default', family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'},
  {id: 'serif', label: 'Serif', family: 'Georgia, "Times New Roman", serif'},
  {id: 'mono', label: 'Mono', family: '"SF Mono", Menlo, Consolas, monospace'},
  {id: 'cursive', label: 'Script', family: '"Comic Sans MS", "Brush Script MT", cursive'}
];

export const PALETTE = [
  '#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffcc00',
  '#34c759', '#00c7be', '#007aff', '#af52de', '#ff2d55'
];

export function createEditorState(duration = 0): EditorState {
  return {
    crop: {x: 0, y: 0, w: 1, h: 1},
    aspectId: 'free',
    rotation: 0,
    straighten: 0,
    flipH: false,
    flipV: false,
    adjustments: {...DEFAULT_ADJUSTMENTS},
    presetId: 'none',
    strokes: [],
    layers: [],
    trimStart: 0,
    trimEnd: duration,
    coverTime: 0
  };
}

export function isDefaultState(state: EditorState, duration = 0): boolean {
  const c = state.crop;
  return c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1 &&
    state.rotation === 0 && state.straighten === 0 &&
    !state.flipH && !state.flipV &&
    !state.strokes.length && !state.layers.length &&
    state.trimStart === 0 && Math.abs(state.trimEnd - duration) < 0.05 &&
    (Object.keys(DEFAULT_ADJUSTMENTS) as (keyof Adjustments)[])
      .every((key) => state.adjustments[key] === DEFAULT_ADJUSTMENTS[key]);
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

export type EditorSource = {
  kind: 'image' | 'video';
  element: HTMLImageElement | HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
  url: string;
  name: string;
  mime: string;
};

export function isEditableFile(file: File): boolean {
  if(file.type.startsWith('video/')) return true;
  // Animated GIFs would lose every frame but the first.
  return file.type.startsWith('image/') && file.type !== 'image/gif';
}

export async function loadSource(file: File): Promise<EditorSource> {
  const url = URL.createObjectURL(file);
  try {
    if(file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Cannot decode video'));
      });
      // Seek off zero once: some encoders hand back a blank first frame.
      await seek(video, Math.min(0.05, video.duration || 0));
      return {
        kind: 'video',
        element: video,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration || 0,
        url,
        name: file.name || 'video.mp4',
        mime: file.type
      };
    }

    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      kind: 'image',
      element: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      duration: 0,
      url,
      name: file.name || 'image.jpg',
      mime: file.type
    };
  } catch(err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export function releaseSource(source: EditorSource) {
  if(source.kind === 'video') (source.element as HTMLVideoElement).pause();
  URL.revokeObjectURL(source.url);
}

export function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = Math.max(0, Math.min(time, (video.duration || 0) - 0.01));
  });
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** Source size after the quarter turns — the space the crop rect lives in. */
export function orientedSize(source: EditorSource, state: EditorState) {
  const swapped = state.rotation % 2 === 1;
  return {
    width: swapped ? source.height : source.width,
    height: swapped ? source.width : source.height
  };
}

/** Pixel size of the export, capped so a 48MP phone photo does not blow the heap. */
export function outputSize(source: EditorSource, state: EditorState, maxSide: number) {
  const oriented = orientedSize(source, state);
  let width = Math.max(1, Math.round(oriented.width * state.crop.w));
  let height = Math.max(1, Math.round(oriented.height * state.crop.h));
  const longest = Math.max(width, height);
  if(longest > maxSide) {
    const k = maxSide / longest;
    width = Math.max(1, Math.round(width * k));
    height = Math.max(1, Math.round(height * k));
  }
  // Even dimensions keep video encoders happy.
  if(source.kind === 'video') {
    width -= width % 2;
    height -= height % 2;
  }
  return {width: Math.max(2, width), height: Math.max(2, height)};
}

export function clampCrop(crop: CropRect): CropRect {
  const w = Math.min(1, Math.max(0.02, crop.w));
  const h = Math.min(1, Math.max(0.02, crop.h));
  return {
    x: Math.min(1 - w, Math.max(0, crop.x)),
    y: Math.min(1 - h, Math.max(0, crop.y)),
    w,
    h
  };
}

/**
 * Largest centred rect of `ratio` (width/height in *pixels*) that fits the
 * oriented image, expressed normalised.
 */
export function cropForRatio(source: EditorSource, state: EditorState, ratio: number): CropRect {
  const oriented = orientedSize(source, state);
  const target = ratio > 0 ? ratio : oriented.width / oriented.height;
  const current = oriented.width / oriented.height;
  let w = 1;
  let h = 1;
  if(current > target) w = target / current;
  else h = current / target;
  return {x: (1 - w) / 2, y: (1 - h) / 2, w, h};
}

/** Scale needed so a straightened rect still covers the crop with no empty corner. */
function straightenZoom(state: EditorState, cw: number, ch: number) {
  const a = Math.abs((state.straighten * Math.PI) / 180);
  if(!a) return 1;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return Math.max((cw * cos + ch * sin) / cw, (cw * sin + ch * cos) / ch);
}

/* ------------------------------------------------------------------ */
/* Sticker image registry                                              */
/* ------------------------------------------------------------------ */

const stickerImages = new Map<string, HTMLImageElement>();

/** Decode a sticker/emoji image once so `renderFrame` can stay synchronous. */
export async function registerStickerImage(url: string): Promise<boolean> {
  if(stickerImages.has(url)) return true;
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = url;
    await image.decode();
    stickerImages.set(url, image);
    return true;
  } catch(err) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export type RenderOptions = {
  /** Mask the result to a circle — avatar mode. */
  circle?: boolean;
  /** Skip the expensive pixel passes while dragging a slider. */
  fast?: boolean;
  /** Draw the layers (off for the crop grid preview of the raw frame). */
  layers?: boolean;
};

function cssFilter(adj: Adjustments) {
  const parts: string[] = [];
  if(adj.brightness) parts.push(`brightness(${1 + adj.brightness / 150})`);
  if(adj.contrast) parts.push(`contrast(${1 + adj.contrast / 120})`);
  if(adj.saturation) parts.push(`saturate(${Math.max(0, 1 + adj.saturation / 100)})`);
  return parts.length ? parts.join(' ') : 'none';
}

/** Warmth, vignette and sharpen have no CSS equivalent, so they run on pixels. */
function pixelPass(ctx: CanvasRenderingContext2D, width: number, height: number, adj: Adjustments) {
  const warmth = adj.warmth / 100;
  const vignette = adj.vignette / 100;
  const sharpen = adj.sharpen / 100;
  if(!warmth && !vignette && !sharpen) return;

  const frame = ctx.getImageData(0, 0, width, height);
  let data = frame.data;

  if(sharpen) {
    const src = new Uint8ClampedArray(data);
    const k = sharpen * 1.2;
    const centre = 1 + 4 * k;
    for(let y = 1; y < height - 1; y++) {
      for(let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        for(let c = 0; c < 3; c++) {
          const p = i + c;
          const value = src[p] * centre -
            k * (src[p - 4] + src[p + 4] + src[p - width * 4] + src[p + width * 4]);
          data[p] = value < 0 ? 0 : value > 255 ? 255 : value;
        }
      }
    }
  }

  if(warmth || vignette) {
    const cx = width / 2;
    const cy = height / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    const rShift = warmth * 34;
    const bShift = -warmth * 34;
    for(let y = 0; y < height; y++) {
      for(let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if(warmth) {
          data[i] = Math.max(0, Math.min(255, data[i] + rShift));
          data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + rShift * 0.25));
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + bShift));
        }
        if(vignette) {
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy) / maxDist;
          const f = 1 - vignette * Math.max(0, d - 0.45) / 0.55;
          data[i] *= f;
          data[i + 1] *= f;
          data[i + 2] *= f;
        }
      }
    }
  }

  data = null as any;
  ctx.putImageData(frame, 0, 0);
}

function strokePath(ctx: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  const min = Math.min(width, height);
  const lineWidth = Math.max(1, stroke.width * min);
  const points = stroke.points;
  if(!points.length) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = stroke.color;

  if(stroke.kind === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
  } else if(stroke.kind === 'marker') {
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = lineWidth * 2;
    ctx.lineCap = 'square';
  } else if(stroke.kind === 'neon') {
    ctx.shadowColor = stroke.color;
    ctx.shadowBlur = lineWidth * 2.5;
  }

  if(stroke.kind === 'arrow' && points.length > 1) {
    const from = points[0];
    const to = points[points.length - 1];
    ctx.beginPath();
    ctx.moveTo(from.x * width, from.y * height);
    ctx.lineTo(to.x * width, to.y * height);
    ctx.stroke();

    const angle = Math.atan2((to.y - from.y) * height, (to.x - from.x) * width);
    const head = lineWidth * 4;
    ctx.beginPath();
    ctx.moveTo(to.x * width, to.y * height);
    ctx.lineTo(to.x * width - head * Math.cos(angle - 0.45), to.y * height - head * Math.sin(angle - 0.45));
    ctx.moveTo(to.x * width, to.y * height);
    ctx.lineTo(to.x * width - head * Math.cos(angle + 0.45), to.y * height - head * Math.sin(angle + 0.45));
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0].x * width, points[0].y * height);
    for(let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const point = points[i];
      // Quadratic through midpoints: cheap smoothing, no spline bookkeeping.
      ctx.quadraticCurveTo(
        prev.x * width,
        prev.y * height,
        ((prev.x + point.x) / 2) * width,
        ((prev.y + point.y) / 2) * height
      );
    }
    if(points.length === 1) ctx.lineTo(points[0].x * width + 0.01, points[0].y * height);
    ctx.stroke();
  }

  ctx.restore();
}

export function measureTextLayer(layer: TextLayer, width: number, height: number) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontSize = layer.size * height;
  ctx.font = `600 ${fontSize}px ${layer.font}`;
  const lines = layer.text.split('\n');
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line || ' ').width));
  return {width: textWidth, height: fontSize * 1.25 * lines.length, fontSize, lines};
}

function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer, width: number, height: number) {
  const {fontSize, lines, width: textWidth, height: textHeight} = measureTextLayer(layer, width, height);
  ctx.save();
  ctx.translate(layer.x * width, layer.y * height);
  ctx.rotate(layer.rotation);
  ctx.font = `600 ${fontSize}px ${layer.font}`;
  ctx.textAlign = layer.align;
  ctx.textBaseline = 'middle';

  const lineHeight = fontSize * 1.25;
  const startY = -textHeight / 2 + lineHeight / 2;
  const anchorX = layer.align === 'left' ? -textWidth / 2 : layer.align === 'right' ? textWidth / 2 : 0;

  if(layer.style === 'background') {
    const pad = fontSize * 0.28;
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    const bx = -textWidth / 2 - pad;
    const by = -textHeight / 2 - pad * 0.6;
    const bw = textWidth + pad * 2;
    const bh = textHeight + pad * 1.2;
    const r = Math.min(pad * 1.6, bh / 2);
    ctx.roundRect?.(bx, by, bw, bh, r);
    if(!ctx.roundRect) ctx.rect(bx, by, bw, bh);
    ctx.fill();
  }

  lines.forEach((line, i) => {
    const y = startY + i * lineHeight;
    if(layer.style === 'outline') {
      ctx.lineWidth = fontSize * 0.14;
      ctx.strokeStyle = '#000';
      ctx.lineJoin = 'round';
      ctx.strokeText(line, anchorX, y);
      ctx.fillStyle = layer.color;
    } else if(layer.style === 'background') {
      ctx.fillStyle = pickInk(layer.color);
    } else {
      ctx.fillStyle = layer.color;
    }
    ctx.fillText(line, anchorX, y);
  });

  ctx.restore();
}

/** Black or white ink, whichever survives on the given background. */
export function pickInk(background: string) {
  const hex = background.replace('#', '');
  if(hex.length < 6) return '#000';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#000000' : '#ffffff';
}

function drawSticker(ctx: CanvasRenderingContext2D, layer: StickerLayer, width: number, height: number) {
  const min = Math.min(width, height);
  const size = layer.size * min;
  ctx.save();
  ctx.translate(layer.x * width, layer.y * height);
  ctx.rotate(layer.rotation);

  const image = layer.url ? stickerImages.get(layer.url) : undefined;
  if(image) {
    const ratio = image.naturalWidth / (image.naturalHeight || 1);
    const w = ratio >= 1 ? size : size * ratio;
    const h = ratio >= 1 ? size / ratio : size;
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
  } else if(layer.emoji) {
    ctx.font = `${size}px -apple-system, "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(layer.emoji, 0, 0);
  }
  ctx.restore();
}

/** Bounding box of a layer in output pixels — used for hit testing and handles. */
export function layerBounds(layer: Layer, width: number, height: number) {
  if(layer.type === 'text') {
    const m = measureTextLayer(layer, width, height);
    return {
      cx: layer.x * width,
      cy: layer.y * height,
      w: Math.max(m.width, width * 0.05) + m.fontSize * 0.6,
      h: m.height + m.fontSize * 0.4
    };
  }
  const size = layer.size * Math.min(width, height);
  return {cx: layer.x * width, cy: layer.y * height, w: size, h: size};
}

export function hitLayer(layers: Layer[], px: number, py: number, width: number, height: number): Layer | null {
  for(let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const b = layerBounds(layer, width, height);
    const dx = px - b.cx;
    const dy = py - b.cy;
    const cos = Math.cos(-layer.rotation);
    const sin = Math.sin(-layer.rotation);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if(Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return layer;
  }
  return null;
}

/**
 * Render one frame of `source` through `state` into `canvas`, which is resized
 * to `width`×`height`. Synchronous by design: the video export loop calls it per
 * frame and the preview calls it on every pointer move.
 */
export function renderFrame(
  canvas: HTMLCanvasElement,
  source: EditorSource,
  state: EditorState,
  width: number,
  height: number,
  options: RenderOptions = {}
) {
  if(canvas.width !== width) canvas.width = width;
  if(canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const oriented = orientedSize(source, state);
  const cw = state.crop.w * oriented.width;
  const ch = state.crop.h * oriented.height;
  const scale = width / cw;
  const zoom = straightenZoom(state, cw, ch);

  ctx.save();
  ctx.filter = cssFilter(state.adjustments);
  ctx.translate(width / 2, height / 2);
  ctx.rotate((-state.straighten * Math.PI) / 180);
  ctx.scale(scale * zoom, scale * zoom);
  ctx.translate(-(state.crop.x * oriented.width + cw / 2), -(state.crop.y * oriented.height + ch / 2));

  // Into oriented space: flips read in the frame the user is looking at, so
  // they are applied before the quarter turn.
  ctx.translate(oriented.width / 2, oriented.height / 2);
  ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  ctx.rotate((state.rotation * Math.PI) / 2);
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.drawImage(source.element as CanvasImageSource, -source.width / 2, -source.height / 2, source.width, source.height);
  } catch(err) {
    // A video frame that is not ready yet throws; the next tick will paint it.
  }
  ctx.restore();

  if(!options.fast) pixelPass(ctx, width, height, state.adjustments);

  if(options.layers !== false) {
    if(state.strokes.length) {
      // Strokes go on their own canvas so the eraser cuts them, not the photo.
      const layerCanvas = document.createElement('canvas');
      layerCanvas.width = width;
      layerCanvas.height = height;
      const layerCtx = layerCanvas.getContext('2d')!;
      for(const stroke of state.strokes) strokePath(layerCtx, stroke, width, height);
      ctx.drawImage(layerCanvas, 0, 0);
    }

    for(const layer of state.layers) {
      if(layer.type === 'text') drawText(ctx, layer, width, height);
      else drawSticker(ctx, layer, width, height);
    }
  }

  if(options.circle) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      type,
      quality
    );
  });
}

function renamed(name: string, ext: string) {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.${ext}`;
}

export type ExportImageOptions = {
  circle?: boolean;
  maxSide?: number;
  /** Force PNG (transparency) instead of the default JPEG. */
  lossless?: boolean;
  quality?: number;
};

/** Render at full resolution and hand back a `File` the send dialog can use. */
export async function exportImage(
  source: EditorSource,
  state: EditorState,
  options: ExportImageOptions = {}
): Promise<File> {
  const maxSide = options.maxSide ?? 2560;
  const {width, height} = outputSize(source, state, maxSide);
  const canvas = document.createElement('canvas');
  renderFrame(canvas, source, state, width, height, {circle: options.circle});

  const png = options.lossless || options.circle;
  const type = png ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(canvas, type, png ? undefined : options.quality ?? 0.9);
  return new File([blob], renamed(source.name, png ? 'png' : 'jpg'), {type, lastModified: Date.now()});
}

/** Still frame at `time`, run through the same pipeline — the video's cover. */
export async function exportCover(
  source: EditorSource,
  state: EditorState,
  time: number,
  maxSide = 1280
): Promise<File> {
  const video = source.element as HTMLVideoElement;
  await seek(video, time);
  const {width, height} = outputSize(source, state, maxSide);
  const canvas = document.createElement('canvas');
  renderFrame(canvas, source, state, width, height);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  return new File([blob], renamed(source.name, 'jpg'), {type: 'image/jpeg', lastModified: Date.now()});
}

export type FrameThumb = {time: number; url: string};

/** Thumbnail strip for the trim bar. The caller revokes the URLs. */
export async function extractFrames(
  source: EditorSource,
  count: number,
  height = 56
): Promise<FrameThumb[]> {
  if(source.kind !== 'video' || !source.duration) return [];
  const video = document.createElement('video');
  video.src = source.url;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Cannot decode video'));
  });

  const ratio = (video.videoWidth || 16) / (video.videoHeight || 9);
  const canvas = document.createElement('canvas');
  canvas.height = height;
  canvas.width = Math.max(2, Math.round(height * ratio));
  const ctx = canvas.getContext('2d')!;

  const frames: FrameThumb[] = [];
  for(let i = 0; i < count; i++) {
    const time = (source.duration * (i + 0.5)) / count;
    await seek(video, time);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.6).catch(() => null);
    if(blob) frames.push({time, url: URL.createObjectURL(blob)});
  }
  video.src = '';
  return frames;
}

function pickVideoMime(): string | null {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4'
  ];
  if(typeof MediaRecorder === 'undefined') return null;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function canExportVideo(): boolean {
  return !!pickVideoMime() &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export type ExportVideoOptions = {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  maxSide?: number;
  fps?: number;
};

/**
 * Re-encode the trimmed range through the render pipeline.
 *
 * There is no frame-accurate remux in the browser, so this plays the source in
 * real time and captures the canvas: a 30s trim takes 30s. It is the only way to
 * get crop/filters/layers burnt into a video without shipping a WASM encoder,
 * and it means the result is always WebM (or MP4 where the browser offers it),
 * never the original container.
 */
export async function exportVideo(
  source: EditorSource,
  state: EditorState,
  options: ExportVideoOptions = {}
): Promise<File> {
  const mime = pickVideoMime();
  if(!mime) throw new Error('This browser cannot re-encode video');

  const {width, height} = outputSize(source, state, options.maxSide ?? 1280);
  const fps = options.fps ?? 30;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const video = document.createElement('video');
  video.src = source.url;
  video.playsInline = true;
  video.muted = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Cannot decode video'));
  });

  const start = Math.max(0, state.trimStart);
  const end = state.trimEnd > start ? state.trimEnd : source.duration;
  await seek(video, start);

  const stream = canvas.captureStream(fps);

  // Audio goes through WebAudio into a stream destination rather than the
  // element's own captureStream: that keeps the export silent for the user
  // while still carrying the track.
  let audioContext: AudioContext | null = null;
  try {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if(Ctor) {
      audioContext = new Ctor();
      const destination = audioContext.createMediaStreamDestination();
      audioContext.createMediaElementSource(video).connect(destination);
      // Routing through WebAudio takes the element off the speakers, so the
      // element can be unmuted (a muted element records silence) without the
      // export being audible.
      video.muted = false;
      for(const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    }
  } catch(err) {
    audioContext = null;
  }

  const recorder = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 3_000_000});
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if(e.data.size) chunks.push(e.data);
  };

  const frameState: EditorState = {...state};
  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(250);
  await video.play();

  let raf = 0;
  const total = Math.max(0.05, end - start);
  await new Promise<void>((resolve) => {
    const tick = () => {
      if(options.signal?.aborted || video.currentTime >= end || video.ended) {
        resolve();
        return;
      }
      renderFrame(canvas, {...source, element: video}, frameState, width, height, {fast: true});
      options.onProgress?.(Math.min(1, (video.currentTime - start) / total));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });

  cancelAnimationFrame(raf);
  video.pause();
  if(recorder.state !== 'inactive') recorder.stop();
  await done;
  for(const track of stream.getTracks()) track.stop();
  audioContext?.close().catch(() => {});
  video.src = '';

  if(options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const type = mime.split(';')[0];
  const blob = new Blob(chunks, {type});
  return new File([blob], renamed(source.name, type === 'video/mp4' ? 'mp4' : 'webm'), {
    type,
    lastModified: Date.now()
  });
}
