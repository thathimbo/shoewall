// Draws the synthetic capture photos the browser tests measure against, with
// the ground-truth pixels-per-inch printed so the assertions can be checked by
// hand. Needs playwright: `npm i -D playwright` (see tests/README.md).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });

const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1800, height: 1200 } });
await p.setContent('<canvas id="c" width="1800" height="1200"></canvas>');

const variants = await p.evaluate(() => {
  const c = document.getElementById('c');
  const x = c.getContext('2d');
  const out = {};

  function floor(dark) {
    x.fillStyle = dark ? '#4a4238' : '#cfc9bf';
    x.fillRect(0, 0, 1800, 1200);
    for (let i = 0; i < 6000; i++) {
      x.fillStyle = `rgba(${dark ? '0,0,0' : '255,255,255'},${Math.random() * 0.2})`;
      x.fillRect(Math.random() * 1800, Math.random() * 1200, 4, 4);
    }
  }
  function paper(quad) {
    x.save(); x.beginPath(); x.moveTo(...quad[0]);
    for (const q of quad.slice(1)) x.lineTo(...q);
    x.closePath(); x.fillStyle = '#f4f3f0'; x.fill(); x.restore();
  }
  function shoe(ox, oy, L, H) {
    x.save();
    x.beginPath();
    x.moveTo(ox, oy);
    x.lineTo(ox + L, oy);
    x.quadraticCurveTo(ox + L + 16, oy - H * 0.30, ox + L * 0.74, oy - H * 0.42);
    x.quadraticCurveTo(ox + L * 0.52, oy - H * 0.55, ox + L * 0.33, oy - H * 1.0);
    x.lineTo(ox + L * 0.06, oy - H * 0.95);
    x.quadraticCurveTo(ox - 14, oy - H * 0.5, ox, oy);
    x.closePath();
    x.fillStyle = '#1d2a3a'; x.fill();
    x.fillStyle = '#b8352e'; x.fillRect(ox + 44, oy - 32, L - 100, 24);
    x.fillStyle = '#e9e4d8'; x.fillRect(ox + 10, oy - 14, L - 20, 14);
    x.restore();
  }

  // --- A: shoe lying ACROSS the sheet, overhanging both ends (the real case
  //        for a men's 15 on US Letter). Perspective-skewed sheet.
  floor(true);
  // landscape letter: 11" x 8.5" at ~62 px/in
  const quadA = [[300, 330], [983, 300], [996, 832], [308, 806]];
  paper(quadA);
  shoe(230, 760, 806, 310);
  out.across = c.toDataURL('image/png');
  const wA = (Math.hypot(983-300,300-330) + Math.hypot(996-308,832-806)) / 2;
  const hA = (Math.hypot(308-300,806-330) + Math.hypot(996-983,832-300)) / 2;
  const ppiA = (wA / 11 + hA / 8.5) / 2;
  out.acrossTruth = { ppi: +ppiA.toFixed(2), lengthIn: +(806/ppiA).toFixed(2), heightIn: +(310/ppiA).toFixed(2) };

  // --- B: shoe entirely BESIDE the sheet, light floor, portrait sheet.
  floor(false);
  const quadB = [[170, 180], [700, 196], [688, 876], [158, 860]];  // portrait 8.5 x 11
  paper(quadB);
  shoe(830, 800, 806, 310);
  out.beside = c.toDataURL('image/png');
  const wB = (Math.hypot(700-170,196-180) + Math.hypot(688-158,876-860)) / 2;
  const hB = (Math.hypot(158-170,860-180) + Math.hypot(688-700,876-196)) / 2;
  const ppiB = (wB / 8.5 + hB / 11) / 2;
  out.besideTruth = { ppi: +ppiB.toFixed(2), lengthIn: +(806/ppiB).toFixed(2), heightIn: +(310/ppiB).toFixed(2) };

  // --- C: no paper at all, so detection must fail cleanly.
  floor(true);
  shoe(400, 800, 806, 310);
  out.nopaper = c.toDataURL('image/png');
  return out;
});

for (const [k, v] of Object.entries(variants)) {
  if (typeof v === 'string') {
    writeFileSync(resolve(here, `photo-${k}.png`), Buffer.from(v.split(',')[1], 'base64'));
  }
}
writeFileSync(
  resolve(here, 'truth.json'),
  JSON.stringify({ across: variants.acrossTruth, beside: variants.besideTruth }, null, 2) + '\n',
);
console.log('fixtures written to tests/fixtures/');
console.log(JSON.stringify({ across: variants.acrossTruth, beside: variants.besideTruth }, null, 1));
await b.close();
