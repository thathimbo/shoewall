// sRGB <-> CIE Lab, k-means clustering in Lab, and CIEDE2000 colour difference.

export interface Lab { L: number; a: number; b: number }
export interface Rgb { r: number; g: number; b: number }

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

// D65 white point
const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;

export function rgbToLab({ r, g, b }: Rgb): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
  const f = (t: number) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 16 / 116);
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb({ L, a, b }: Lab): Rgb {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856451679 ? t ** 3 : (t - 16 / 116) / 7.787037037);
  const X = Xn * inv(fx), Y = Yn * inv(fy), Z = Zn * inv(fz);
  const R = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
  const G = X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560;
  const B = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;
  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) };
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}
export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
export const hexToLab = (hex: string): Lab => rgbToLab(hexToRgb(hex));
export const labToHex = (lab: Lab): string => rgbToHex(labToRgb(lab));

/**
 * CIEDE2000 colour difference. Returns 0 (identical) up to ~100+ for opposites.
 * Reference: Sharma, Wu & Dalal (2005).
 */
export function ciede2000(l1: Lab, l2: Lab): number {
  const kL = 1, kC = 1, kH = 1;
  const C1 = Math.hypot(l1.a, l1.b);
  const C2 = Math.hypot(l2.a, l2.b);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Cbar ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * l1.a;
  const a2p = (1 + G) * l2.a;
  const C1p = Math.hypot(a1p, l1.b);
  const C2p = Math.hypot(a2p, l2.b);

  const hp = (ap: number, bp: number) => {
    if (ap === 0 && bp === 0) return 0;
    const h = (Math.atan2(bp, ap) * 180) / Math.PI;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(a1p, l1.b);
  const h2p = hp(a2p, l2.b);

  const dLp = l2.L - l1.L;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);

  const Lbarp = (l1.L + l2.L) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;

  const rad = (d: number) => (d * Math.PI) / 180;
  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.20 * Math.cos(rad(4 * hbarp - 63));

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;

  return Math.sqrt(
    (dLp / (kL * Sl)) ** 2 +
      (dCp / (kC * Sc)) ** 2 +
      (dHp / (kH * Sh)) ** 2 +
      Rt * (dCp / (kC * Sc)) * (dHp / (kH * Sh)),
  );
}

export interface Cluster { lab: Lab; hex: string; weight: number }

/**
 * k-means over Lab samples. Deterministic: k-means++ seeding driven by a
 * supplied PRNG so the same photo gives the same swatches twice in a row.
 */
export function kMeansLab(samples: Lab[], k: number, rng: () => number, iterations = 24): Cluster[] {
  if (samples.length === 0) return [];
  const kk = Math.min(k, samples.length);

  // k-means++ seeding
  const centroids: Lab[] = [samples[Math.floor(rng() * samples.length)]];
  while (centroids.length < kk) {
    const d2 = samples.map((s) => {
      let best = Infinity;
      for (const c of centroids) best = Math.min(best, sqDist(s, c));
      return best;
    });
    const total = d2.reduce((a, b) => a + b, 0);
    if (total <= 0) break;
    let t = rng() * total;
    let idx = 0;
    for (let i = 0; i < d2.length; i++) {
      t -= d2[i];
      if (t <= 0) { idx = i; break; }
    }
    centroids.push(samples[idx]);
  }

  const assign = new Array<number>(samples.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < samples.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = sqDist(samples[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < samples.length; i++) {
      const s = sums[assign[i]];
      s.L += samples[i].L; s.a += samples[i].a; s.b += samples[i].b; s.n++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c].n > 0) {
        centroids[c] = { L: sums[c].L / sums[c].n, a: sums[c].a / sums[c].n, b: sums[c].b / sums[c].n };
      }
    }
    if (!moved && it > 0) break;
  }

  const counts = centroids.map(() => 0);
  for (const a of assign) counts[a]++;
  return centroids
    .map((lab, i) => ({ lab, hex: labToHex(lab), weight: counts[i] / samples.length }))
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

function sqDist(a: Lab, b: Lab): number {
  return (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2;
}

/** Distance between two multi-swatch palettes: weighted mean over the closest matches. */
export function paletteDistance(a: { hex: string; weight: number }[], b: { hex: string; weight: number }[]): number {
  if (!a.length || !b.length) return 0;
  const al = a.map((s) => ({ lab: hexToLab(s.hex), w: s.weight }));
  const bl = b.map((s) => ({ lab: hexToLab(s.hex), w: s.weight }));
  let total = 0, wsum = 0;
  for (const x of al) {
    let best = Infinity;
    for (const y of bl) best = Math.min(best, ciede2000(x.lab, y.lab));
    total += best * x.w; wsum += x.w;
  }
  for (const y of bl) {
    let best = Infinity;
    for (const x of al) best = Math.min(best, ciede2000(y.lab, x.lab));
    total += best * y.w; wsum += y.w;
  }
  return wsum > 0 ? total / wsum : 0;
}

/** Simple deterministic PRNG (mulberry32) so shuffles are reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hue in degrees and lightness, for gradient ordering. */
export function hueOf(hex: string): number {
  const lab = hexToLab(hex);
  const h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
}
export function chromaOf(hex: string): number {
  const lab = hexToLab(hex);
  return Math.hypot(lab.a, lab.b);
}
export function lightnessOf(hex: string): number {
  return hexToLab(hex).L;
}
