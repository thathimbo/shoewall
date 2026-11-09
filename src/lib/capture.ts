// The per-photo capture pipeline, with no UI in it, so the same code can run
// for one photo or for a queue of them.

import type { Settings, Swatch } from '../types';
import {
  detectPaper, correctPerspective, PAPER_SCORE_FLOOR,
  type PaperDetection, type Pt,
} from './paper';
import {
  removeBackground, alphaComponents, pickShoeComponent, suggestHandles,
  cropToHandles, dominantColors, BackgroundRemovalError,
  type Handles, type MaskStats, type ShoePick,
} from './cutout';

export interface CaptureResult {
  source: ImageData;
  detection: PaperDetection;
  /** Background-removed version of the corrected image, when that worked. */
  cutRgba: ImageData | null;
  mask: MaskStats | null;
  /** How confidently the shoe was told apart from the reference target. */
  pick: ShoePick['verdict'];
  handles: Handles;
  colors: Swatch[];
  /** Set when background removal could not run; capture still completes. */
  bgFailed: string | null;
  /** Set when the target was found but the detector was not sure about it. */
  targetWarning: string | null;
}

export type Progress = (msg: string, fraction: number) => void;

/**
 * Detects the reference target, rectifies the photo against it, cuts the shoe
 * out and proposes the four measurement handles.
 *
 * Throws PaperNotFoundError when no target is found — the caller is expected
 * to offer manual corner placement rather than let a guessed scale through.
 */
export async function processCapture(
  source: ImageData,
  settings: Settings,
  opts: { forcedQuad?: [Pt, Pt, Pt, Pt]; onProgress?: Progress } = {},
): Promise<CaptureResult> {
  const say = opts.onProgress ?? (() => {});
  const target = settings.paper;

  say('Loading OpenCV.js…', 0.05);
  let quad: [Pt, Pt, Pt, Pt];
  let score: number | null = null;
  if (opts.forcedQuad) {
    quad = opts.forcedQuad;
  } else {
    say(`Looking for the ${target.label}…`, 0.15);
    const cand = await detectPaper(source, target);
    quad = cand.quad;
    score = cand.score;
  }

  say('Correcting perspective…', 0.3);
  const detection = await correctPerspective(source, quad, target, { detectionScore: score });

  const marginal = score !== null && score < PAPER_SCORE_FLOOR + 0.15;
  const targetWarning =
    detection.confidence < 0.8 || marginal
      ? [
          marginal ? `The detector was only ${Math.round(score! * 100)}% confident about this shape.` : null,
          detection.confidence < 0.8
            ? `The shape it picked is only ${Math.round(detection.confidence * 100)}% rectangular.`
            : null,
          'Check the dashed outline against the real target before trusting the numbers.',
        ].filter(Boolean).join(' ')
      : null;

  say('Removing the background…', 0.45);
  let cutRgba: ImageData | null = null;
  let bgFailed: string | null = null;
  try {
    cutRgba = await removeBackground(detection.corrected, (key, f) =>
      say(`Removing the background (${key})…`, 0.45 + f * 0.4),
    );
  } catch (err) {
    bgFailed = err instanceof BackgroundRemovalError ? err.message : String(err);
  }

  say('Measuring…', 0.9);
  // The target survives background removal as readily as the shoe does, so the
  // two are told apart by where they are, not by what colour they are.
  const picked: ShoePick = cutRgba
    ? pickShoeComponent(alphaComponents(cutRgba, { paperRect: detection.paperRect }), true)
    : { verdict: 'none', component: null };
  const mask = picked.verdict === 'shoe' ? picked.component : null;
  const handles: Handles = mask ? suggestHandles(mask) : defaultHandles(detection);

  let colors: Swatch[] = [];
  try {
    const sample = cutRgba ?? cropToHandles(detection.corrected, handles, detection.ppi);
    colors = dominantColors(sample, 3).map((c) => ({ hex: c.hex, weight: c.weight }));
  } catch {
    colors = [];
  }

  say('Done', 1);
  return { source, detection, cutRgba, mask, pick: picked.verdict, handles, colors, bgFailed, targetWarning };
}

/** Starting handle positions when no outline was found. Deliberately on the
 *  target, and the UI must not treat them as a measurement. */
export function defaultHandles(d: PaperDetection): Handles {
  const r = d.paperRect;
  return {
    heel: { x: r.x + r.w * 0.2, y: r.y + r.h * 0.6 },
    toe: { x: r.x + r.w * 0.8, y: r.y + r.h * 0.6 },
    sole: { x: r.x + r.w * 0.5, y: r.y + r.h * 0.75 },
    collar: { x: r.x + r.w * 0.5, y: r.y + r.h * 0.4 },
  };
}

/** A sensible first guess at the target's corners, for manual placement. */
export function guessQuad(img: ImageData): [Pt, Pt, Pt, Pt] {
  const mx = img.width * 0.25, my = img.height * 0.25;
  return [
    { x: mx, y: my },
    { x: img.width - mx, y: my },
    { x: img.width - mx, y: img.height - my },
    { x: mx, y: img.height - my },
  ];
}

export type { MaskStats, Handles };
