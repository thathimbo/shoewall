// Paper detection + perspective correction.
//
// The shoe may be laid NEXT TO the paper rather than on it, so we do not warp
// to the paper rectangle. We build the homography that maps the paper quad onto
// an axis-aligned rectangle at a known pixels-per-inch, then warp the WHOLE
// image through it, growing the canvas so nothing is cropped away.

import type * as CV from '@techstark/opencv-js';
import { loadOpenCv } from './opencv';

export interface Pt { x: number; y: number }

export interface PaperDetection {
  /** Perspective-corrected image. Everything in it is at `ppi` pixels per inch. */
  corrected: ImageData;
  /** Pixels per inch in the corrected image. */
  ppi: number;
  /** The paper's four corners in the ORIGINAL image, ordered TL, TR, BR, BL. */
  quadInSource: [Pt, Pt, Pt, Pt];
  /** The paper rectangle within the corrected image. */
  paperRect: { x: number; y: number; w: number; h: number };
  /** Which way round the paper was lying. */
  orientation: 'portrait' | 'landscape';
  /** 0..1 — how rectangular the detected quad was. Low values are worth showing. */
  confidence: number;
  /**
   * 0..1 — how strongly the detector believed this was paper, or null when the
   * corners were placed by hand. Shown so a marginal detection is visible.
   */
  detectionScore: number | null;
}

export class PaperNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaperNotFoundError';
  }
}

function orderQuad(pts: Pt[]): [Pt, Pt, Pt, Pt] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const withAngle = pts.map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }));
  withAngle.sort((m, n) => m.a - n.a);
  const ring = withAngle.map((w) => w.p);
  // Rotate so the first point is the one closest to the top-left.
  let best = 0, bestD = Infinity;
  ring.forEach((p, i) => {
    const d = p.x + p.y;
    if (d < bestD) { bestD = d; best = i; }
  });
  const ordered = [ring[best], ring[(best + 1) % 4], ring[(best + 2) % 4], ring[(best + 3) % 4]];
  return ordered as [Pt, Pt, Pt, Pt];
}

/** Mean of the two opposite-side lengths. */
function sideLengths(q: [Pt, Pt, Pt, Pt]) {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = d(q[0], q[1]), right = d(q[1], q[2]), bottom = d(q[2], q[3]), left = d(q[3], q[0]);
  return { w: (top + bottom) / 2, h: (left + right) / 2, top, right, bottom, left };
}

/**
 * How close the quad is to a parallelogram with equal opposite sides and
 * right-ish angles. Used only to warn the user, never to silently reject.
 */
function quadConfidence(q: [Pt, Pt, Pt, Pt]): number {
  const s = sideLengths(q);
  const wSym = 1 - Math.abs(s.top - s.bottom) / Math.max(s.top, s.bottom, 1);
  const hSym = 1 - Math.abs(s.left - s.right) / Math.max(s.left, s.right, 1);
  const angles = [0, 1, 2, 3].map((i) => {
    const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    return Math.abs(Math.acos(Math.max(-1, Math.min(1, cos))) - Math.PI / 2);
  });
  const angleScore = 1 - Math.min(1, (angles.reduce((a, b) => a + b, 0) / 4) / (Math.PI / 6));
  return Math.max(0, Math.min(1, 0.4 * wSym + 0.3 * hSym + 0.3 * angleScore));
}

export interface PaperCandidate {
  quad: [Pt, Pt, Pt, Pt];
  area: number;
  /**
   * How strongly the quad stands out from the band of surface just outside it,
   * 0..1, in EITHER direction. Paper on a dark floor is lighter; a Gridfinity
   * baseplate on a pale floor is darker. Both are targets, so what counts is
   * the size of the step, not its sign.
   */
  brightnessEdge: number;
  /** 1 when the quad's aspect matches the expected paper aspect. */
  aspectScore: number;
  rectangularity: number;
  score: number;
  /** Which pass and grouping produced it — useful when a detection looks wrong. */
  origin: string;
}

/** Minimum score for a candidate to be treated as paper at all. */
export const PAPER_SCORE_FLOOR = 0.6;

/**
 * Finds the sheet of paper and returns its four corners.
 *
 * Three things make this harder than "largest 4-sided contour":
 *
 *  1. The photo's own border is usually the biggest quad in an edge map, so a
 *     candidate covering almost the whole frame is rejected — otherwise the
 *     scale would come from the frame rather than the paper.
 *  2. A men's 15 is longer than a sheet of US Letter, so a shoe laid on the
 *     sheet overhangs and bites into its outline. Every contour is reduced to
 *     its CONVEX HULL before being fitted to a quadrilateral, which restores
 *     the occluded edge.
 *  3. A shoe laid right across the sheet splits it into two separate bright
 *     bands. Nearby regions are therefore also GROUPED and hulled together,
 *     which puts the sheet back as one rectangle.
 *
 * Candidates are scored on size, brightness, aspect and squareness, and the
 * best one wins. If nothing scores as paper-like this throws rather than
 * returning a guess.
 */
export async function detectPaper(
  image: ImageData,
  paper: { widthIn: number; heightIn: number },
): Promise<PaperCandidate> {
  const all = await findPaperCandidates(image, paper);
  const best = all.find((c) => c.score >= PAPER_SCORE_FLOOR);
  if (!best) {
    const nearMiss = all[0];
    throw new PaperNotFoundError(
      'Reference target not found. OpenCV could not find a four-sided shape that is large, clearly different in tone from the surface around it, and about the right proportions for the target.' +
        (nearMiss
          ? ` The closest thing it found scored ${(nearMiss.score * 100).toFixed(0)} out of 100 (needs ${(PAPER_SCORE_FLOOR * 100).toFixed(0)}).`
          : '') +
        ' Shoot from directly above with the whole target in frame against a contrasting surface — or place the four corners by hand below.',
    );
  }
  return best;
}

/** Just the corners, for callers that do not need the score. */
export async function detectPaperQuad(
  image: ImageData,
  paper: { widthIn: number; heightIn: number },
): Promise<[Pt, Pt, Pt, Pt]> {
  return (await detectPaper(image, paper)).quad;
}

/** Every candidate found, best first and unfiltered, so the UI can explain a miss. */
export async function findPaperCandidates(
  image: ImageData,
  paper: { widthIn: number; heightIn: number },
): Promise<PaperCandidate[]> {
  const cv = await loadOpenCv();
  const src = cv.matFromImageData(image);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const bright = new cv.Mat();
  const edges = new cv.Mat();
  const hierarchy = new cv.Mat();
  const scratch: CV.Mat[] = [src, gray, blur, bright, edges, hierarchy];

  const expectedAspect =
    Math.max(paper.widthIn, paper.heightIn) / Math.min(paper.widthIn, paper.heightIn);

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    // Otsu's split gives one of the passes below a "paper-ish vs surface-ish"
    // mask to trace, which is the pass that copes with a shoe lying on the sheet.
    cv.threshold(blur, bright, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

    const imageArea = image.width * image.height;
    const minArea = imageArea * 0.02;
    const maxArea = imageArea * 0.9;
    const raw: { quad: [Pt, Pt, Pt, Pt]; area: number; origin: string }[] = [];

    const passes: Array<{ name: string; run: () => void }> = [
      // The sheet as a bright blob — best when a shoe lies across it.
      { name: 'bright', run: () => bright.copyTo(edges) },
      // The sheet as an edge outline. Two sensitivities: the strong pass is
      // clean on a dark floor, the weak one catches a sheet on a light floor
      // where the paper-to-floor step is only a few levels.
      { name: 'canny', run: () => cv.Canny(blur, edges, 60, 160, 3, false) },
      { name: 'canny-weak', run: () => cv.Canny(blur, edges, 18, 60, 3, false) },
      // Locally thresholded — best when the surface is nearly as light as the paper.
      {
        name: 'adaptive',
        run: () => {
          cv.adaptiveThreshold(blur, edges, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 25, 10);
          const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
          cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, k);
          k.delete();
        },
      },
    ];

    for (const pass of passes) {
      pass.run();
      const cnts = new cv.MatVector();
      try {
        cv.findContours(edges, cnts, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        // Keep the point sets of every region big enough to be part of a sheet.
        // The threshold is deliberately low: one band of a split sheet can be thin.
        const regions: { pts: Pt[]; box: Box; area: number }[] = [];
        for (let i = 0; i < cnts.size(); i++) {
          const c = cnts.get(i);
          try {
            const a = Math.abs(cv.contourArea(c, false));
            if (a < imageArea * 0.004) continue;
            const pts = contourPoints(c);
            if (pts.length < 4) continue;
            regions.push({ pts, box: boundingBox(pts), area: a });

            const own = quadFromPoints(cv, pts);
            if (own) {
              const area = polygonArea(own);
              if (area >= minArea && area <= maxArea) {
                raw.push({ quad: own, area, origin: `${pass.name}/single` });
              }
            }
          } finally {
            c.delete();
          }
        }

        // Group regions that sit close together and hull each group, so a sheet
        // cut in two by a shoe comes back as one rectangle.
        for (const group of clusterRegions(regions)) {
          if (group.length < 2) continue;
          const merged = quadFromPoints(cv, group.flatMap((g) => g.pts));
          if (!merged) continue;
          const area = polygonArea(merged);
          if (area >= minArea && area <= maxArea) {
            raw.push({ quad: merged, area, origin: `${pass.name}/grouped×${group.length}` });
          }
        }
      } finally {
        cnts.delete();
      }
    }

    const unique = dedupeQuads(raw);
    const scored: PaperCandidate[] = unique.map(({ quad, area, origin }) => {
      const brightnessEdge = brightnessEdgeOf(cv, gray, quad, image.width, image.height);
      const s = sideLengths(quad);
      const aspect = Math.max(s.w, s.h) / Math.max(1e-6, Math.min(s.w, s.h));
      const aspectScore = Math.max(0, 1 - Math.abs(aspect - expectedAspect) / expectedAspect);
      const rectangularity = quadConfidence(quad);
      const areaScore = Math.min(1, area / (imageArea * 0.25));
      const score =
        0.22 * areaScore + 0.28 * brightnessEdge + 0.28 * aspectScore + 0.22 * rectangularity;
      return { quad, area, brightnessEdge, aspectScore, rectangularity, score, origin };
    });

    return scored.sort((a, b) => b.score - a.score);
  } finally {
    for (const m of scratch) m.delete();
  }
}

interface Box { x0: number; y0: number; x1: number; y1: number }

function contourPoints(c: CV.Mat): Pt[] {
  const pts: Pt[] = [];
  const n = c.rows;
  // Long contours are decimated: a hull does not need every pixel.
  const step = Math.max(1, Math.floor(n / 600));
  for (let i = 0; i < n; i += step) pts.push({ x: c.intAt(i, 0), y: c.intAt(i, 1) });
  return pts;
}

function boundingBox(pts: Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

function boxGap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1));
  return Math.hypot(dx, dy);
}

/**
 * Greedy agglomeration: two regions join when the gap between their bounding
 * boxes is small relative to the larger box, which is what a shoe laid across
 * a sheet leaves behind. At most a handful of groups are produced.
 */
function clusterRegions<T extends { box: Box; area: number }>(regions: T[]): T[][] {
  const sorted = [...regions].sort((a, b) => b.area - a.area).slice(0, 24);
  const groups: { items: T[]; box: Box }[] = [];
  for (const r of sorted) {
    const diag = Math.hypot(r.box.x1 - r.box.x0, r.box.y1 - r.box.y0);
    let joined = false;
    for (const g of groups) {
      const gDiag = Math.hypot(g.box.x1 - g.box.x0, g.box.y1 - g.box.y0);
      if (boxGap(g.box, r.box) <= 0.45 * Math.max(diag, gDiag)) {
        g.items.push(r);
        g.box = {
          x0: Math.min(g.box.x0, r.box.x0), y0: Math.min(g.box.y0, r.box.y0),
          x1: Math.max(g.box.x1, r.box.x1), y1: Math.max(g.box.y1, r.box.y1),
        };
        joined = true;
        break;
      }
    }
    if (!joined) groups.push({ items: [r], box: { ...r.box } });
  }
  return groups.map((g) => g.items);
}

/**
 * Convex hull of the supplied points, fitted to a quadrilateral at
 * progressively coarser tolerances.
 */
function quadFromPoints(
  cv: Awaited<ReturnType<typeof loadOpenCv>>,
  pts: Pt[],
): [Pt, Pt, Pt, Pt] | null {
  if (pts.length < 4) return null;
  const mat = cv.matFromArray(pts.length, 1, cv.CV_32SC2, pts.flatMap((p) => [Math.round(p.x), Math.round(p.y)]));
  const hull = new cv.Mat();
  const approx = new cv.Mat();
  try {
    cv.convexHull(mat, hull, false, true);
    const peri = cv.arcLength(hull, true);
    if (peri <= 0) return null;
    for (const eps of [0.01, 0.02, 0.03, 0.05, 0.08, 0.12]) {
      cv.approxPolyDP(hull, approx, eps * peri, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const out: Pt[] = [];
        for (let j = 0; j < 4; j++) out.push({ x: approx.intAt(j, 0), y: approx.intAt(j, 1) });
        return orderQuad(out);
      }
      if (approx.rows < 4) return null; // coarser will only lose more corners
    }
    return null;
  } finally {
    approx.delete();
    hull.delete();
    mat.delete();
  }
}

function polygonArea(q: [Pt, Pt, Pt, Pt]): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

function dedupeQuads<T extends { quad: [Pt, Pt, Pt, Pt]; area: number }>(list: T[]): T[] {
  const out: T[] = [];
  for (const cand of [...list].sort((a, b) => b.area - a.area)) {
    const dup = out.some((kept) => {
      const tol = Math.sqrt(kept.area) * 0.06;
      return kept.quad.every((p, i) => Math.hypot(p.x - cand.quad[i].x, p.y - cand.quad[i].y) < tol);
    });
    if (!dup) out.push(cand);
  }
  return out;
}

/**
 * How far the inside of the quad sits from a band of surface just outside it,
 * normalised over 40 grey levels and taken as an absolute difference.
 *
 * The sign is deliberately ignored: a sheet of paper is lighter than the floor,
 * a dark 3D-printed baseplate is darker than it, and either makes an equally
 * good reference target. A quad drawn on plain floor matches its surroundings
 * and scores ~0 whichever way round the floor is.
 */
function brightnessEdgeOf(
  cv: Awaited<ReturnType<typeof loadOpenCv>>,
  gray: CV.Mat,
  quad: [Pt, Pt, Pt, Pt],
  width: number,
  height: number,
): number {
  const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  const grown = new cv.Mat();
  const ring = new cv.Mat();
  const poly = cv.matFromArray(4, 1, cv.CV_32SC2, quad.flatMap((p) => [Math.round(p.x), Math.round(p.y)]));
  const polys = new cv.MatVector();
  polys.push_back(poly);
  let kernel: CV.Mat | null = null;
  try {
    cv.fillPoly(mask, polys, new cv.Scalar(255));
    if (cv.countNonZero(mask) === 0) return 0;

    const box = boundingBox(quad);
    const diag = Math.hypot(box.x1 - box.x0, box.y1 - box.y0);
    const k = Math.max(5, Math.round(diag * 0.05) | 1);
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
    cv.dilate(mask, grown, kernel);
    cv.subtract(grown, mask, ring);
    if (cv.countNonZero(ring) === 0) return 0;

    const inside = cv.mean(gray, mask)[0];
    const outside = cv.mean(gray, ring)[0];
    return Math.max(0, Math.min(1, Math.abs(inside - outside) / 40));
  } finally {
    kernel?.delete();
    polys.delete();
    poly.delete();
    ring.delete();
    grown.delete();
    mask.delete();
  }
}

/**
 * Warps the whole image so the paper becomes an axis-aligned rectangle of a
 * known physical size, at `targetPpi` pixels per inch.
 */
export async function correctPerspective(
  image: ImageData,
  quad: [Pt, Pt, Pt, Pt],
  paper: { widthIn: number; heightIn: number },
  opts: { maxOutputPixels?: number; detectionScore?: number | null } = {},
): Promise<PaperDetection> {
  const cv = await loadOpenCv();
  const s = sideLengths(quad);
  const orientation: 'portrait' | 'landscape' = s.w >= s.h ? 'landscape' : 'portrait';
  const paperWIn = orientation === 'landscape' ? Math.max(paper.widthIn, paper.heightIn) : Math.min(paper.widthIn, paper.heightIn);
  const paperHIn = orientation === 'landscape' ? Math.min(paper.widthIn, paper.heightIn) : Math.max(paper.widthIn, paper.heightIn);

  // Keep roughly the detected resolution so we neither invent nor throw away detail.
  let ppi = Math.max(12, (s.w / paperWIn + s.h / paperHIn) / 2);

  const paperWpx = paperWIn * ppi;
  const paperHpx = paperHIn * ppi;

  // Destination corners for the paper, placed at the origin for now.
  const dstQuad: Pt[] = [
    { x: 0, y: 0 },
    { x: paperWpx, y: 0 },
    { x: paperWpx, y: paperHpx },
    { x: 0, y: paperHpx },
  ];

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y]));
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, dstQuad.flatMap((p) => [p.x, p.y]));
  let H = cv.getPerspectiveTransform(srcTri, dstTri);

  // Where do the image's own corners land? Grow the canvas to hold all of them
  // so a shoe sitting beside the paper survives the warp.
  const corners: Pt[] = [
    { x: 0, y: 0 },
    { x: image.width, y: 0 },
    { x: image.width, y: image.height },
    { x: 0, y: image.height },
  ];
  const mapped = corners.map((p) => applyH(H, p));
  let minX = Math.min(...mapped.map((p) => p.x), 0);
  let minY = Math.min(...mapped.map((p) => p.y), 0);
  let maxX = Math.max(...mapped.map((p) => p.x), paperWpx);
  let maxY = Math.max(...mapped.map((p) => p.y), paperHpx);

  // A grazing-angle photo can map a corner to infinity. Clamp the canvas to a
  // generous multiple of the paper so we never try to allocate something silly.
  const limit = Math.max(paperWpx, paperHpx) * 6;
  minX = Math.max(minX, -limit); minY = Math.max(minY, -limit);
  maxX = Math.min(maxX, limit); maxY = Math.min(maxY, limit);

  let outW = Math.ceil(maxX - minX);
  let outH = Math.ceil(maxY - minY);

  // Respect a pixel budget: scale the whole homography down rather than crop.
  const budget = opts.maxOutputPixels ?? 10_000_000;
  const scale = outW * outH > budget ? Math.sqrt(budget / (outW * outH)) : 1;
  if (scale < 1) {
    ppi *= scale;
    minX *= scale; minY *= scale; maxX *= scale; maxY *= scale;
    outW = Math.ceil(maxX - minX); outH = Math.ceil(maxY - minY);
    const dst2 = cv.matFromArray(4, 1, cv.CV_32FC2,
      [[0, 0], [paperWIn * ppi, 0], [paperWIn * ppi, paperHIn * ppi], [0, paperHIn * ppi]].flat());
    H.delete();
    H = cv.getPerspectiveTransform(srcTri, dst2);
    dst2.delete();
  }

  // Shift so the whole mapped image is inside the canvas.
  const T = cv.matFromArray(3, 3, cv.CV_64F, [1, 0, -minX, 0, 1, -minY, 0, 0, 1]);
  const Hfull = new cv.Mat();
  const noAddend = new cv.Mat();
  cv.gemm(T, H, 1, noAddend, 0, Hfull, 0);
  noAddend.delete();

  const src = cv.matFromImageData(image);
  const out = new cv.Mat();
  cv.warpPerspective(
    src, out, Hfull, new cv.Size(outW, outH),
    cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0),
  );

  const corrected = new ImageData(new Uint8ClampedArray(out.data), out.cols, out.rows);

  const result: PaperDetection = {
    corrected,
    ppi,
    quadInSource: quad,
    paperRect: { x: -minX, y: -minY, w: paperWIn * ppi, h: paperHIn * ppi },
    orientation,
    confidence: quadConfidence(quad),
    detectionScore: opts.detectionScore ?? null,
  };

  srcTri.delete(); dstTri.delete(); H.delete(); T.delete(); Hfull.delete(); src.delete(); out.delete();
  return result;
}

function applyH(H: CV.Mat, p: Pt): Pt {
  const d = H.data64F;
  const w = d[6] * p.x + d[7] * p.y + d[8];
  const safe = Math.abs(w) < 1e-9 ? (w < 0 ? -1e-9 : 1e-9) : w;
  return {
    x: (d[0] * p.x + d[1] * p.y + d[2]) / safe,
    y: (d[3] * p.x + d[4] * p.y + d[5]) / safe,
  };
}
