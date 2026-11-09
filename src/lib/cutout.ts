// Background removal -> alpha mask -> cutout, and the geometry that turns two
// user-placed handles into a length in inches.

import { imageDataToBlob, fileToImageData, imageDataToCanvas } from './image';
import { kMeansLab, rgbToLab, type Cluster } from './color';
import { mulberry32 } from './color';

export interface Pt { x: number; y: number }

export class BackgroundRemovalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BackgroundRemovalError';
  }
}

/**
 * Runs @imgly/background-removal in the browser. The library fetches its model
 * on first use; if that fails we say so plainly rather than guessing a mask.
 */
export async function removeBackground(
  data: ImageData,
  onProgress?: (msg: string, fraction: number) => void,
): Promise<ImageData> {
  let mod: typeof import('@imgly/background-removal');
  try {
    mod = await import('@imgly/background-removal');
  } catch (err) {
    throw new BackgroundRemovalError('Could not load the background-removal library.', { cause: err });
  }
  const input = await imageDataToBlob(data, 'image/png');
  let out: Blob;
  try {
    out = await mod.removeBackground(input, {
      output: { format: 'image/png', quality: 1 },
      progress: (key: string, current: number, total: number) => {
        onProgress?.(key, total > 0 ? current / total : 0);
      },
    });
  } catch (err) {
    throw new BackgroundRemovalError(
      'Background removal failed. It downloads a model on first use, so this usually means the network was unavailable. You can still measure from the corrected photo using the handles.',
      { cause: err },
    );
  }
  return fileToImageData(out, data.width * data.height + 1);
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface MaskComponent {
  /** Bounding box of this component, in pixels of the supplied image. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Count of opaque pixels. */
  area: number;
  /** area / bounding-box area. A sheet of paper fills its box; a shoe does not. */
  fill: number;
  /** Share of this component's pixels that fall inside the paper rectangle. */
  paperOverlap: number;
  /**
   * Share of the PAPER that this component covers. This is the one that says
   * "this blob contains the sheet": a shoe lying on the sheet covers only part
   * of it, while the sheet itself, or the sheet fused with a shoe, covers all.
   */
  paperCoverage: number;
  /** A mask of just this component, 1 byte per pixel, row-major. */
  mask: Uint8Array;
  width: number;
  height: number;
  extremes: { left: Pt; right: Pt; top: Pt; bottom: Pt };
}

export type MaskStats = MaskComponent;

/**
 * Every connected run of opaque pixels, largest first.
 *
 * Background removal keeps whatever it finds salient, and a sheet of paper on
 * a floor is extremely salient — so the sheet usually comes back as foreground
 * too. Returning all the components lets the caller use the sheet's known
 * position to tell them apart, which colour cannot do: a cream midsole is only
 * about 5 CIEDE2000 units from copy paper, and white leather about 2.
 */
export function alphaComponents(
  data: ImageData,
  opts: { alphaThreshold?: number; paperRect?: Rect | null; minArea?: number } = {},
): MaskComponent[] {
  const alphaThreshold = opts.alphaThreshold ?? 128;
  const { width: w, height: h } = data;
  const px = data.data;
  const visited = new Uint8Array(w * h);
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    if (visited[i] || px[i * 4 + 3] < alphaThreshold) { visited[i] = 1; continue; }
    const id = sizes.length;
    let count = 0;
    let sp = 0;
    stack[sp++] = i;
    visited[i] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      label[p] = id;
      count++;
      const x = p % w, y = (p - x) / w;
      if (x > 0) pushIf(p - 1);
      if (x < w - 1) pushIf(p + 1);
      if (y > 0) pushIf(p - w);
      if (y < h - 1) pushIf(p + w);
    }
    sizes.push(count);

    function pushIf(q: number) {
      if (!visited[q] && px[q * 4 + 3] >= alphaThreshold) { visited[q] = 1; stack[sp++] = q; }
    }
  }
  if (!sizes.length) return [];

  const minArea = opts.minArea ?? Math.max(64, Math.round(w * h * 0.004));
  const keep = sizes.map((n, i) => ({ i, n })).filter((c) => c.n >= minArea).sort((a, b) => b.n - a.n);
  if (!keep.length) return [];

  const pr = opts.paperRect ?? null;
  const out: MaskComponent[] = [];
  for (const { i: id, n } of keep) {
    const mask = new Uint8Array(w * h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1, inPaper = 0;
    let left: Pt = { x: w, y: 0 }, right: Pt = { x: -1, y: 0 };
    let top: Pt = { x: 0, y: h }, bottom: Pt = { x: 0, y: -1 };
    for (let p = 0; p < w * h; p++) {
      if (label[p] !== id) continue;
      mask[p] = 1;
      const x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (x < left.x) left = { x, y };
      if (x > right.x) right = { x, y };
      if (y < top.y) top = { x, y };
      if (y > bottom.y) bottom = { x, y };
      if (pr && x >= pr.x && x < pr.x + pr.w && y >= pr.y && y < pr.y + pr.h) inPaper++;
    }
    const boxArea = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
    const paperArea = pr ? Math.max(1, pr.w * pr.h) : 1;
    out.push({
      bbox: { x0, y0, x1, y1 }, area: n, fill: n / boxArea,
      paperOverlap: pr ? inPaper / n : 0,
      paperCoverage: pr ? Math.min(1, inPaper / paperArea) : 0,
      mask, width: w, height: h, extremes: { left, right, top, bottom },
    });
  }
  return out;
}

export type ShoePick =
  /** A component clear of the sheet: this is the shoe. */
  | { verdict: 'shoe'; component: MaskComponent }
  /**
   * Only one blob came back and it is the sheet's size and shape, with the shoe
   * merged into it. The measurement cannot be trusted and the caller must say so.
   */
  | { verdict: 'merged-with-paper'; component: MaskComponent }
  /** Nothing usable was found. */
  | { verdict: 'none'; component: null };

/**
 * Picks the shoe out of the components, using the sheet's known position
 * rather than its colour.
 *
 * A component that sits almost entirely inside the sheet AND fills its own
 * bounding box is the bare sheet, and is discarded. If the only thing left is
 * sheet-shaped, the shoe was lying on the sheet and the two segmented as one
 * blob — that is reported rather than measured, because any number taken from
 * it would be the sheet's size, not the shoe's.
 */
export function pickShoeComponent(components: MaskComponent[], hasPaperRect: boolean): ShoePick {
  if (!components.length) return { verdict: 'none', component: null };
  if (!hasPaperRect) return { verdict: 'shoe', component: components[0] };

  // The question is not "does this sit on the sheet" — a shoe laid on the sheet
  // does, and is still the shoe. It is "does this blob CONTAIN the sheet".
  // Only something covering nearly all of the sheet does: the bare sheet, or
  // the sheet fused with the shoe.
  const containsSheet = (c: MaskComponent) => c.paperCoverage > 0.85;
  const clear = components.filter((c) => !containsSheet(c));
  if (clear.length) return { verdict: 'shoe', component: clear[0] };

  return { verdict: 'merged-with-paper', component: components[0] };
}

/** Back-compatible helper: the largest component, ignoring the sheet question. */
export function largestAlphaComponent(data: ImageData, alphaThreshold = 128): MaskStats | null {
  return alphaComponents(data, { alphaThreshold, minArea: 1 })[0] ?? null;
}

/** The four measurement handles, in pixels of the corrected image. */
export interface Handles {
  heel: Pt;
  toe: Pt;
  sole: Pt;
  collar: Pt;
}

/**
 * Initial handle positions from a mask.
 *
 * The length axis spans the mask's longer dimension. The height axis is NOT
 * taken from the bounding box — on a shoe in profile the box corners sit at the
 * toe and the heel, which would measure a diagonal. Instead it uses the single
 * column (or row) where the mask is deepest, which on a shoe is the ankle, so
 * the handles start on the real sole-to-collar line.
 */
export function suggestHandles(stats: MaskStats): Handles {
  const { bbox, mask, width, height } = stats;
  const boxW = bbox.x1 - bbox.x0;
  const boxH = bbox.y1 - bbox.y0;

  if (boxW >= boxH) {
    // Lying across the frame: length runs left to right.
    let bestX = bbox.x0, bestSpan = -1, bestTop = bbox.y0, bestBottom = bbox.y1;
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      let top = -1, bottom = -1;
      for (let y = bbox.y0; y <= bbox.y1; y++) {
        if (mask[y * width + x]) {
          if (top < 0) top = y;
          bottom = y;
        }
      }
      if (top >= 0 && bottom - top > bestSpan) {
        bestSpan = bottom - top; bestX = x; bestTop = top; bestBottom = bottom;
      }
    }
    // Mid-height of the mask at each end makes a better heel/toe than a corner.
    const heelY = midAtColumn(mask, width, bbox, bbox.x0) ?? (bbox.y0 + bbox.y1) / 2;
    const toeY = midAtColumn(mask, width, bbox, bbox.x1) ?? (bbox.y0 + bbox.y1) / 2;
    return {
      heel: { x: bbox.x0, y: heelY },
      toe: { x: bbox.x1, y: toeY },
      sole: { x: bestX, y: bestBottom },
      collar: { x: bestX, y: bestTop },
    };
  }

  // Standing up the frame: length runs top to bottom.
  let bestY = bbox.y0, bestSpan = -1, bestLeft = bbox.x0, bestRight = bbox.x1;
  for (let y = bbox.y0; y <= bbox.y1; y++) {
    let left = -1, right = -1;
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      if (mask[y * width + x]) {
        if (left < 0) left = x;
        right = x;
      }
    }
    if (left >= 0 && right - left > bestSpan) {
      bestSpan = right - left; bestY = y; bestLeft = left; bestRight = right;
    }
  }
  void height;
  return {
    heel: { x: midAtRow(mask, width, bbox, bbox.y0) ?? (bbox.x0 + bbox.x1) / 2, y: bbox.y0 },
    toe: { x: midAtRow(mask, width, bbox, bbox.y1) ?? (bbox.x0 + bbox.x1) / 2, y: bbox.y1 },
    sole: { x: bestLeft, y: bestY },
    collar: { x: bestRight, y: bestY },
  };
}

function midAtColumn(
  mask: Uint8Array, width: number, bbox: MaskStats['bbox'], x: number,
): number | null {
  let top = -1, bottom = -1;
  for (let y = bbox.y0; y <= bbox.y1; y++) {
    if (mask[y * width + x]) { if (top < 0) top = y; bottom = y; }
  }
  return top < 0 ? null : (top + bottom) / 2;
}

function midAtRow(
  mask: Uint8Array, width: number, bbox: MaskStats['bbox'], y: number,
): number | null {
  let left = -1, right = -1;
  for (let x = bbox.x0; x <= bbox.x1; x++) {
    if (mask[y * width + x]) { if (left < 0) left = x; right = x; }
  }
  return left < 0 ? null : (left + right) / 2;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export interface HandleMeasurement {
  lengthIn: number;
  heightIn: number;
  /** Angle of the heel -> toe vector, radians, screen coordinates (y down). */
  angleRad: number;
  /** Degrees between the length and height axes. 90 is ideal; far off is worth flagging. */
  axisAngleDeg: number;
}

export function measureFromHandles(hs: Handles, ppi: number): HandleMeasurement {
  const lenPx = dist(hs.heel, hs.toe);
  const hPx = dist(hs.sole, hs.collar);
  const lv = { x: hs.toe.x - hs.heel.x, y: hs.toe.y - hs.heel.y };
  const hv = { x: hs.collar.x - hs.sole.x, y: hs.collar.y - hs.sole.y };
  const cos =
    (lv.x * hv.x + lv.y * hv.y) /
    ((Math.hypot(lv.x, lv.y) || 1) * (Math.hypot(hv.x, hv.y) || 1));
  return {
    lengthIn: lenPx / ppi,
    heightIn: hPx / ppi,
    angleRad: Math.atan2(lv.y, lv.x),
    axisAngleDeg: (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI,
  };
}

/**
 * Produces the cutout used in the wall mockup: the background-removed image
 * rotated so heel->toe runs left-to-right with the TOE ON THE RIGHT and the
 * COLLAR UP, then cropped to exactly the measured length x height.
 * The mockup can therefore place it at a known physical size with no guesswork.
 */
/**
 * Straightens and crops an image to exactly the measured shoe: heel->toe runs
 * left to right with the TOE ON THE RIGHT and the COLLAR UP, at `ppi` pixels
 * per inch. The result is therefore exactly lengthIn x heightIn, which is what
 * lets the wall mockup place it at a known physical size with no guesswork.
 */
export function cropToHandles(rgba: ImageData, hs: Handles, ppi: number): ImageData {
  const m = measureFromHandles(hs, ppi);
  const outW = Math.max(2, Math.round(m.lengthIn * ppi));
  const outH = Math.max(2, Math.round(m.heightIn * ppi));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get a 2D canvas context.');

  const src = imageDataToCanvas(rgba);

  // Midpoint of the length axis, and which side of it the collar sits on.
  const mid = { x: (hs.heel.x + hs.toe.x) / 2, y: (hs.heel.y + hs.toe.y) / 2 };
  const lv = { x: Math.cos(m.angleRad), y: Math.sin(m.angleRad) };
  // Left normal in screen coordinates (y grows downwards) points "up" on screen.
  const normal = { x: lv.y, y: -lv.x };
  const collarSide = (hs.collar.x - mid.x) * normal.x + (hs.collar.y - mid.y) * normal.y;
  const flipY = collarSide < 0 ? -1 : 1;

  // Centre of the crop: on the length axis at `mid`, shifted along the normal to
  // the midpoint of the sole<->collar handles so the full height is included.
  const soleCollarMid = { x: (hs.sole.x + hs.collar.x) / 2, y: (hs.sole.y + hs.collar.y) / 2 };
  const nOffset = (soleCollarMid.x - mid.x) * normal.x + (soleCollarMid.y - mid.y) * normal.y;
  const centre = { x: mid.x + normal.x * nOffset, y: mid.y + normal.y * nOffset };

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.scale(1, flipY);
  ctx.rotate(-m.angleRad);
  ctx.translate(-centre.x, -centre.y);
  ctx.drawImage(src, 0, 0);
  ctx.restore();

  return ctx.getImageData(0, 0, outW, outH);
}

export async function buildCutout(
  rgba: ImageData,
  hs: Handles,
  ppi: number,
): Promise<{ blob: Blob; width: number; height: number; lengthIn: number; heightIn: number }> {
  const m = measureFromHandles(hs, ppi);
  const crop = cropToHandles(rgba, hs, ppi);
  const blob = await new Promise<Blob>((resolve, reject) =>
    imageDataToCanvas(crop).toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Cutout export failed.'))),
      'image/png',
    ),
  );
  return { blob, width: crop.width, height: crop.height, lengthIn: m.lengthIn, heightIn: m.heightIn };
}

/** 2-3 dominant colours from the opaque pixels of a cutout, k-means in Lab. */
export function dominantColors(data: ImageData, k = 3, seed = 1): Cluster[] {
  // Fully opaque input (a plain crop rather than a background-removed cutout)
  // is sampled as-is; callers are told that some surroundings may be included.
  const px = data.data;
  const total = data.width * data.height;
  const step = Math.max(1, Math.floor(total / 12000));
  const samples = [];
  for (let i = 0; i < total; i += step) {
    const a = px[i * 4 + 3];
    if (a < 200) continue;
    samples.push(rgbToLab({ r: px[i * 4], g: px[i * 4 + 1], b: px[i * 4 + 2] }));
  }
  if (!samples.length) return [];
  const clusters = kMeansLab(samples, k, mulberry32(seed));
  // Drop clusters that are a sliver of the shoe — they are usually logo pixels
  // or an anti-aliased edge, not something you would see from across the room.
  return clusters.filter((c) => c.weight >= 0.08).slice(0, 3);
}
