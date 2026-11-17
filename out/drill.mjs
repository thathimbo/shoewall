// Drill diagram. Edit the constants, run: node out/drill.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 150;     // wall width
const BAND = 42;   // usable band, measured down from the ceiling
const L = 13.5;    // one shoe, heel to toe (size 15 Nike, estimate)
const MOD = 8;     // bracket height = the stacked pair = 2 shoes
const PLATE = 7;   // plate centre below the TOP of the bracket (8" tall, plate 2" at the bottom)

const blockW = 2 * L;             // two shoes wide, heels meeting at the centre
const dropB = MOD / 2;            // every other column drops half a module -> 45-degree checkerboard

const nCols = Math.floor(W / blockW);
const x0 = (W - nCols * blockW) / 2;
const cols = Array.from({ length: nCols }, (_, i) => ({
  x: x0 + i * blockW + blockW / 2,
  off: i % 2 === 1 ? dropB : 0,
}));

const marks = [];
for (const [i, c] of cols.entries()) {
  for (let k = 0; ; k++) {
    const top = c.off + k * MOD;
    if (top + MOD > BAND + 1e-9) break;
    marks.push({ col: i + 1, x: c.x, top, y: top + PLATE });
  }
}

const S = 12, PAD = 140, TOP = 100;
const px = (v) => PAD + v * S, py = (v) => TOP + v * S;
const o = [];
o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PAD * 2 + W * S}" height="${TOP + (BAND + 8) * S + 30}" font-family="system-ui,sans-serif">`);
o.push(`<rect width="100%" height="100%" fill="#fff"/>`);
o.push(`<text x="${PAD}" y="36" font-size="25" font-weight="700">Wall A — ${marks.length} brackets</text>`);
o.push(`<text x="${PAD}" y="62" font-size="15" fill="#555">Red dot = plate centre. X from left edge, Y down from ceiling. Shoe ${L}" long, bracket ${MOD}" tall.</text>`);
o.push(`<line x1="${px(0)}" y1="${py(0)}" x2="${px(W)}" y2="${py(0)}" stroke="#000" stroke-width="3"/>`);
o.push(`<text x="${px(0) - 10}" y="${py(0) + 5}" font-size="14" text-anchor="end" font-weight="700">CEILING</text>`);
o.push(`<line x1="${px(0)}" y1="${py(BAND)}" x2="${px(W)}" y2="${py(BAND)}" stroke="#999" stroke-dasharray="8 6"/>`);
o.push(`<text x="${px(0) - 10}" y="${py(BAND) + 5}" font-size="14" text-anchor="end" fill="#666">${BAND}"</text>`);

for (const m of marks) {
  o.push(`<rect x="${px(m.x - L)}" y="${py(m.top)}" width="${blockW * S}" height="${MOD * S}" fill="#eef2f7" stroke="#9fb3c8"/>`);
  o.push(`<line x1="${px(m.x - L)}" y1="${py(m.top + MOD / 2)}" x2="${px(m.x + L)}" y2="${py(m.top + MOD / 2)}" stroke="#9fb3c8"/>`);
  o.push(`<line x1="${px(m.x)}" y1="${py(m.top)}" x2="${px(m.x)}" y2="${py(m.top + MOD)}" stroke="#9fb3c8"/>`);
  o.push(`<circle cx="${px(m.x)}" cy="${py(m.y)}" r="6.5" fill="#c00"/>`);
  o.push(`<text x="${px(m.x) + 11}" y="${py(m.y) + 5}" font-size="14" font-weight="700" fill="#c00">${m.y.toFixed(1)}"</text>`);
}
for (const c of cols) {
  o.push(`<line x1="${px(c.x)}" y1="${py(0) - 26}" x2="${px(c.x)}" y2="${py(0)}" stroke="#c00"/>`);
  o.push(`<text x="${px(c.x)}" y="${py(0) - 32}" font-size="16" font-weight="700" fill="#c00" text-anchor="middle">${c.x.toFixed(2)}"</text>`);
}
o.push(`</svg>`);

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });
writeFileSync(`${here}/drill-wall-a.svg`, o.join('\n'));
const rows = ['col,x_from_left_in,y_down_from_ceiling_in'];
for (const m of marks) rows.push(`${m.col},${m.x.toFixed(2)},${m.y.toFixed(2)}`);
writeFileSync(`${here}/drill-wall-a.csv`, rows.join('\n') + '\n');

console.log(`${marks.length} brackets, deepest plate ${Math.max(...marks.map((m) => m.y)).toFixed(1)}" (band ${BAND}")`);
for (const [i, c] of cols.entries()) {
  console.log(`col ${i + 1}  X ${c.x.toFixed(2)}"   Y ${marks.filter((m) => m.col === i + 1).map((m) => m.y.toFixed(1)).join('  ')}`);
}
