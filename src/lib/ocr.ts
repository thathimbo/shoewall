// Tongue-label OCR. It only ever SUGGESTS values; the user confirms or edits
// before anything is written to a pair.
export interface OcrSuggestion {
  /** Raw recognised text, shown so the user can see what it actually read. */
  text: string;
  /** Candidate style codes / SKUs, best guess first. */
  styleCodes: string[];
  /** Candidate sizes, best guess first. */
  sizes: string[];
  confidence: number;
}

export class OcrError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OcrError';
  }
}

export async function readTagImage(
  blob: Blob,
  onProgress?: (status: string, progress: number) => void,
): Promise<OcrSuggestion> {
  let Tesseract: typeof import('tesseract.js');
  try {
    Tesseract = await import('tesseract.js');
  } catch (err) {
    throw new OcrError('Could not load the OCR library.', { cause: err });
  }
  try {
    const res = await Tesseract.recognize(blob, 'eng', {
      logger: (m: { status: string; progress: number }) => onProgress?.(m.status, m.progress),
    });
    const text = res.data.text ?? '';
    return {
      text,
      styleCodes: extractStyleCodes(text),
      sizes: extractSizes(text),
      confidence: (res.data.confidence ?? 0) / 100,
    };
  } catch (err) {
    throw new OcrError(
      'OCR failed. tesseract.js downloads its language data on first use, so this usually means the network was unavailable. You can type the style code and size in by hand.',
      { cause: err },
    );
  }
}

/**
 * Looks for the shapes sneaker style codes actually take, e.g. "CW2288-111",
 * "DZ5485 612", "FY2903", "553558-065". Nothing is inferred about the model.
 */
export function extractStyleCodes(text: string): string[] {
  const out = new Set<string>();
  const normalised = text.toUpperCase();
  const patterns: RegExp[] = [
    /\b([A-Z]{2}\d{4}[-\s]?\d{3})\b/g,   // CW2288-111
    /\b(\d{6}[-\s]?\d{3})\b/g,           // 553558-065
    /\b([A-Z]{2}\d{4})\b/g,              // FY2903
    /\b([A-Z]\d{5}[-\s]?\d{0,3})\b/g,    // M9060 / B75806
    /\b(\d{3}[A-Z]{2}\d{3})\b/g,
  ];
  for (const re of patterns) {
    for (const m of normalised.matchAll(re)) {
      out.add(m[1].replace(/\s+/g, '-').replace(/-$/, ''));
    }
  }
  return [...out];
}

/** Looks for a US men's size on the label. */
export function extractSizes(text: string): string[] {
  const out = new Set<string>();
  const t = text.toUpperCase();
  for (const m of t.matchAll(/\b(?:US|USA|U\.S\.)\s*(?:M|MEN'?S?)?\s*(\d{1,2}(?:\.5|\s?1\/2)?)\b/g)) {
    out.add(normaliseSize(m[1]));
  }
  for (const m of t.matchAll(/\b(?:M|MEN'?S?)\s*(\d{1,2}(?:\.5|\s?1\/2)?)\b/g)) {
    out.add(normaliseSize(m[1]));
  }
  return [...out];
}

function normaliseSize(s: string): string {
  return s.replace(/\s*1\/2/, '.5').trim();
}
