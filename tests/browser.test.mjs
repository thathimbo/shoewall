// Browser tests for the parts that only run in a browser: OpenCV paper
// detection, perspective correction, the measurement handles and the cutout.
//
//   npm i -D playwright && npx playwright install chromium
//   npm run dev          # in another terminal
//   npm run test:browser
//
// Set SHOEWALL_URL to point at a different dev server.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SHOEWALL_URL ?? 'http://127.0.0.1:5173/';
const truth = JSON.parse(readFileSync(resolve(here, 'fixtures/truth.json'), 'utf8'));

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`); if (!cond) failures++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} ±${tol})`);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
page.on('pageerror', (e) => { console.log('  PAGEERROR', e.message.slice(0, 200)); failures++; });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
} catch {
  console.error(`Could not reach ${BASE}. Start the dev server with \`npm run dev\` first.`);
  await browser.close();
  process.exit(1);
}

const b64 = (f) => readFileSync(resolve(here, 'fixtures', f)).toString('base64');
const fixtures = {
  across: b64('photo-across.png'),
  beside: b64('photo-beside.png'),
  nopaper: b64('photo-nopaper.png'),
};

console.log('--- paper detection ---');
const detection = await page.evaluate(async (fixtures) => {
  const paper = await import('/src/lib/paper.ts');
  const img = await import('/src/lib/image.ts');
  const US_LETTER = { widthIn: 8.5, heightIn: 11 };
  const out = {};
  for (const [name, data] of Object.entries(fixtures)) {
    const blob = await (await fetch('data:image/png;base64,' + data)).blob();
    const idata = await img.fileToImageData(blob);
    try {
      const cand = await paper.detectPaper(idata, US_LETTER);
      const det = await paper.correctPerspective(idata, cand.quad, US_LETTER, { detectionScore: cand.score });
      out[name] = { ppi: det.ppi, orientation: det.orientation, score: cand.score, confidence: det.confidence };
    } catch (e) {
      out[name] = { error: e.name };
    }
  }
  return out;
}, fixtures);

near(detection.across.ppi, truth.across.ppi, truth.across.ppi * 0.02, 'shoe lying across the sheet: scale');
ok(detection.across.orientation === 'landscape', 'shoe across: landscape sheet');
ok(detection.across.score > 0.7, `shoe across: confident detection (${detection.across.score?.toFixed(2)})`);
near(detection.beside.ppi, truth.beside.ppi, truth.beside.ppi * 0.02, 'shoe beside the sheet, light floor: scale');
ok(detection.beside.orientation === 'portrait', 'shoe beside: portrait sheet');
ok(detection.nopaper.error === 'PaperNotFoundError', 'no sheet in frame: refuses to guess a scale');

console.log('--- measurement and cutout ---');
const chain = await page.evaluate(async (data) => {
  const paper = await import('/src/lib/paper.ts');
  const img = await import('/src/lib/image.ts');
  const cut = await import('/src/lib/cutout.ts');
  const US_LETTER = { widthIn: 8.5, heightIn: 11 };
  const blob = await (await fetch('data:image/png;base64,' + data)).blob();
  const idata = await img.fileToImageData(blob);
  const cand = await paper.detectPaper(idata, US_LETTER);
  const det = await paper.correctPerspective(idata, cand.quad, US_LETTER);
  const R = det.paperRect;

  // The rectified sheet must measure its real size.
  const acrossPaper = cut.measureFromHandles({
    heel: { x: R.x, y: R.y + R.h / 2 }, toe: { x: R.x + R.w, y: R.y + R.h / 2 },
    sole: { x: R.x + R.w / 2, y: R.y + R.h }, collar: { x: R.x + R.w / 2, y: R.y },
  }, det.ppi);

  // A span at 30 degrees must measure the same as one laid flat.
  const ang = Math.PI / 6, L = 500, H = 180;
  const cx = R.x + R.w / 2, cy = R.y + R.h / 2;
  const u = { x: Math.cos(ang), y: Math.sin(ang) };
  const n = { x: u.y, y: -u.x };
  const rotated = {
    heel: { x: cx - u.x * L / 2, y: cy - u.y * L / 2 }, toe: { x: cx + u.x * L / 2, y: cy + u.y * L / 2 },
    sole: { x: cx - n.x * H / 2, y: cy - n.y * H / 2 }, collar: { x: cx + n.x * H / 2, y: cy + n.y * H / 2 },
  };
  const rm = cut.measureFromHandles(rotated, det.ppi);
  const rc = await cut.buildCutout(det.corrected, rotated, det.ppi);

  // A shoe-shaped alpha mask: handles must land on the deepest column, not a
  // bounding-box corner, or the height would be measured along a diagonal.
  const W = 440, Hh = 200, px = new Uint8ClampedArray(W * Hh * 4);
  const profile = (x) => {
    if (x < 20 || x > 420) return 0;
    if (x < 110) return 40 + (x - 20) * 1.4;
    if (x < 150) return 166;
    if (x < 300) return 166 - (x - 150) * 0.73;
    return Math.max(18, 57 - (x - 300) * 0.3);
  };
  for (let x = 0; x < W; x++) {
    const h = profile(x);
    for (let y = 0; y < Hh; y++) {
      if (y >= 180 - h && y < 180) { const i = (y * W + x) * 4; px[i + 3] = 255; px[i] = px[i + 1] = px[i + 2] = 90; }
    }
  }
  const stats = cut.largestAlphaComponent(new ImageData(px, W, Hh));
  const hs = cut.suggestHandles(stats);
  const sm = cut.measureFromHandles(hs, 20);

  // Two blobs: only the larger must survive.
  const W2 = 120, H2 = 80, px2 = new Uint8ClampedArray(W2 * H2 * 4);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = (y * W2 + x) * 4;
    if (x >= 20 && x < 100 && y >= 20 && y < 60) {
      px2[i] = x < 60 ? 200 : 20; px2[i + 1] = x < 60 ? 30 : 40; px2[i + 2] = x < 60 ? 30 : 180; px2[i + 3] = 255;
    } else if (x >= 2 && x < 8 && y >= 2 && y < 8) px2[i + 3] = 255;
  }
  const two = cut.largestAlphaComponent(new ImageData(px2, W2, H2));
  const colors = cut.dominantColors(new ImageData(px2, W2, H2), 3, 1);

  return {
    paperLength: acrossPaper.lengthIn, paperHeight: acrossPaper.heightIn, paperAxisDeg: acrossPaper.axisAngleDeg,
    rotatedLen: rm.lengthIn, rotatedHeight: rm.heightIn, rotatedExpectLen: L / det.ppi, rotatedExpectHeight: H / det.ppi,
    cutoutPx: { w: rc.width, h: rc.height }, cutoutExpect: { w: Math.round(rm.lengthIn * det.ppi), h: Math.round(rm.heightIn * det.ppi) },
    handleLen: sm.lengthIn, handleHeight: sm.heightIn, handleAxisDeg: sm.axisAngleDeg,
    soleX: hs.sole.x, collarX: hs.collar.x,
    twoBlobArea: two.area, twoBlobBbox: two.bbox,
    colors: colors.map((c) => c.hex),
  };
}, fixtures.across);

near(chain.paperLength, 11, 0.001, 'rectified sheet measures 11" across');
near(chain.paperHeight, 8.5, 0.001, 'rectified sheet measures 8.5" down');
near(chain.paperAxisDeg, 90, 0.001, 'the two measurement axes are perpendicular');
near(chain.rotatedLen, chain.rotatedExpectLen, 0.001, 'a 30-degree span measures its true length');
near(chain.rotatedHeight, chain.rotatedExpectHeight, 0.001, 'a 30-degree span measures its true height');
ok(chain.cutoutPx.w === chain.cutoutExpect.w && chain.cutoutPx.h === chain.cutoutExpect.h,
   `cutout is exactly length x height in pixels (${chain.cutoutPx.w}x${chain.cutoutPx.h})`);
near(chain.handleLen, 20, 0.02, 'shoe-shaped mask: suggested length');
near(chain.handleHeight, 8.25, 0.02, 'shoe-shaped mask: suggested height');
near(chain.handleAxisDeg, 90, 2, 'shoe-shaped mask: height axis is upright');
ok(chain.soleX === chain.collarX && chain.soleX >= 110 && chain.soleX <= 150,
   `height measured at the deepest column, the ankle (x=${chain.soleX})`);
ok(chain.twoBlobArea === 3200, `largest alpha component ignores the stray speck (area ${chain.twoBlobArea})`);
ok(chain.twoBlobBbox.x0 === 20 && chain.twoBlobBbox.y0 === 20, 'largest alpha component bbox');
ok(chain.colors.length === 2, `two dominant colours found (${chain.colors.join(', ')})`);

await browser.close();
console.log(failures === 0 ? '\nALL BROWSER TESTS PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
