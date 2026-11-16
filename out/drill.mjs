// Draws the drill diagram for one wall. Change the constants, rerun.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 150;    // wall width
const BAND = 42;  // usable band, measured down from the ceiling
const L = 13.5;   // shoe length
const H = 5;      // shoe height
const TOE = 1.25; // gap between columns
const ROW = 0.5;  // gap between blocks in a column
const PLATE = 7;  // plate centre below where the shoes rest

const blockW = 2 * L, blockH = 2 * H, pitchX = blockW + TOE, pitchY = blockH + ROW;
const nCols = Math.floor((W + TOE) / pitchX);
const x0 = (W - (nCols * blockW + (nCols - 1) * TOE)) / 2;
const cols = Array.from({ length: nCols }, (_, i) => ({
  x: x0 + i * pitchX + blockW / 2,
  off: i % 2 === 1 ? H : 0,   // every other column drops one shoe height
}));

const marks = [];
for (const [i, c] of cols.entries()) {
  for (let k = 0; ; k++) {
    const top = c.off + k * pitchY;
    if (top + blockH > BAND + 1e-9) break;
    marks.push({ col: i + 1, x: c.x, shoeTop: top, y: top + blockH + PLATE });
  }
}

const S = 11, PAD = 130, TOP = 96;
const px = (v) => PAD + v * S, py = (v) => TOP + v * S;
const maxY = Math.max(...marks.map((m) => m.y)) + 6;
const o = [];
o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PAD * 2 + W * S}" height="${TOP + maxY * S + 40}" font-family="system-ui,sans-serif">`);
o.push(`<rect width="100%" height="100%" fill="#fff"/>`);
o.push(`<text x="${PAD}" y="34" font-size="24" font-weight="700">Wall A — ${marks.length} brackets</text>`);
o.push(`<text x="${PAD}" y="58" font-size="15" fill="#555">Red dot = mounting plate centre. X from left wall edge, Y down from ceiling. Shoes ${L}" x ${H}".</text>`);

o.push(`<line x1="${px(0)}" y1="${py(0)}" x2="${px(W)}" y2="${py(0)}" stroke="#000" stroke-width="3"/>`);
o.push(`<text x="${px(0) - 10}" y="${py(0) + 5}" font-size="14" text-anchor="end" font-weight="700">CEILING</text>`);
o.push(`<line x1="${px(0)}" y1="${py(BAND)}" x2="${px(W)}" y2="${py(BAND)}" stroke="#999" stroke-dasharray="8 6"/>`);
o.push(`<text x="${px(0) - 10}" y="${py(BAND) + 5}" font-size="14" text-anchor="end" fill="#666">${BAND}"</text>`);

for (const m of marks) {
  o.push(`<rect x="${px(m.x - L)}" y="${py(m.shoeTop)}" width="${blockW * S}" height="${blockH * S}" fill="#eef2f7" stroke="#aebecf"/>`);
  o.push(`<line x1="${px(m.x - L)}" y1="${py(m.shoeTop + H)}" x2="${px(m.x + L)}" y2="${py(m.shoeTop + H)}" stroke="#aebecf"/>`);
  o.push(`<line x1="${px(m.x)}" y1="${py(m.shoeTop)}" x2="${px(m.x)}" y2="${py(m.shoeTop + blockH)}" stroke="#aebecf"/>`);
  o.push(`<line x1="${px(m.x)}" y1="${py(m.shoeTop + blockH)}" x2="${px(m.x)}" y2="${py(m.y)}" stroke="#c00" stroke-width="2"/>`);
  o.push(`<circle cx="${px(m.x)}" cy="${py(m.y)}" r="6.5" fill="#c00"/>`);
  o.push(`<text x="${px(m.x) + 11}" y="${py(m.y) + 5}" font-size="14" font-weight="700" fill="#c00">${m.y.toFixed(1)}"</text>`);
}
for (const [i, c] of cols.entries()) {
  o.push(`<line x1="${px(c.x)}" y1="${py(0) - 26}" x2="${px(c.x)}" y2="${py(0)}" stroke="#c00"/>`);
  o.push(`<text x="${px(c.x)}" y="${py(0) - 32}" font-size="15" font-weight="700" fill="#c00" text-anchor="middle">${c.x.toFixed(2)}"</text>`);
}
o.push(`</svg>`);

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });
writeFileSync(`${here}/drill-wall-a.svg`, o.join('\n'));
const rows = ['col,x_from_left_in,y_down_from_ceiling_in'];
for (const m of marks) rows.push(`${m.col},${m.x.toFixed(2)},${m.y.toFixed(2)}`);
writeFileSync(`${here}/drill-wall-a.csv`, rows.join('\n') + '\n');

console.log(`${marks.length} brackets`);
for (const [i, c] of cols.entries()) {
  console.log(`col ${i + 1}  X ${c.x.toFixed(2)}"   Y ${marks.filter((m) => m.col === i + 1).map((m) => m.y.toFixed(1)).join('  ')}`);
}
