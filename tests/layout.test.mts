import { generateLayout, usableXRange } from '../src/lib/layout.ts';
import { DEFAULT_SETTINGS, makeDefaultWalls } from '../src/lib/defaults.ts';
import type { Pair, Settings, Wall } from '../src/types.ts';

let fails = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fails++; console.log('  FAIL: ' + msg); } };
const near = (a: number, b: number, msg: string, eps = 1e-6) => ok(Math.abs(a - b) < eps, `${msg} (got ${a}, want ${b})`);

function mkPair(i: number, len: number, h: number, hex: string): Pair {
  return {
    id: `p${i}`, name: `Pair ${i}`, tags: [],
    measurement: { lengthIn: len, heightIn: h, ppi: 50, source: 'paper-detected', adjustedByHand: false },
    heightClass: null, heightClassManual: false,
    colors: [{ hex, weight: 1 }],
    cutoutImageId: null, photoImageId: null, extraImageIds: [], tagImageIds: [],
    status: 'on-wall', wallLocation: null, wearLog: [],
    createdAt: 0, updatedAt: 0,
  };
}

const S: Settings = structuredClone(DEFAULT_SETTINGS);
S.hardware.plateToArmTopIn = 3.5;
S.bracketCount = 40;

// 24 pairs, size-15-ish: 13" long, heights 4 / 5.5 / 7
const palette = ['#e8e8e8','#111111','#c0392b','#2980b9','#27ae60','#f1c40f'];
const pairs: Pair[] = [];
let n = 0;
for (const h of [7, 5.5, 4]) for (let i = 0; i < 8; i++) pairs.push(mkPair(n++, 13 + (i % 3) * 0.25, h, palette[i % palette.length]));

const walls: Wall[] = makeDefaultWalls().map(w => ({ ...w, bandBottomIn: 24, bandTopIn: 96 }));
walls[1].left = { isCorner: true, keepsClear: true };
walls[0].right = { isCorner: true, keepsClear: false };

console.log('--- grid ---');
let r = generateLayout({ pairs, walls, settings: S, pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 7, annealIterations: 800 });
ok(r.blockers.length === 0, 'no blockers: ' + r.blockers.join('; '));
const L = r.layout!;
console.log('  brackets used:', L.bracketsUsed, 'slots:', L.slotCount, 'unplaced:', L.unplacedPairIds.length);

// every placed pair appears exactly once
const seen = new Map<string, number>();
for (const wl of L.walls) for (const b of wl.brackets) for (const id of [b.leftPairId, b.rightPairId]) if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
ok([...seen.values()].every(v => v === 1), 'no pair placed twice');
ok(seen.size + L.unplacedPairIds.length === pairs.length, `all pairs accounted for (${seen.size}+${L.unplacedPairIds.length} vs ${pairs.length})`);

for (const wl of L.walls) {
  const ux = usableXRange(walls[wl.wallIndex], S);
  near(wl.usableX.x0, ux.x0, `wall ${wl.wallIndex} usable x0`);
  near(wl.usableX.x1, ux.x1, `wall ${wl.wallIndex} usable x1`);
  ok(wl.warnings.length === 0, `wall ${wl.wallIndex} warnings: ${wl.warnings.join(' | ')}`);

  for (const row of wl.rows) {
    const brs = wl.brackets.filter(b => b.rowIndex === row.rowIndex).sort((a, b) => a.colIndex - b.colIndex);
    // centred: equal margins
    const left = brs[0].extent.x0 - wl.usableX.x0;
    const right = wl.usableX.x1 - brs[brs.length - 1].extent.x1;
    near(left, right, `wall ${wl.wallIndex} row ${row.rowIndex} margins equal`, 1e-6);
    // toe gap between neighbouring columns
    for (let i = 0; i + 1 < brs.length; i++) {
      near(brs[i + 1].extent.x0 - brs[i].extent.x1, S.spacing.toeGapIn, `toe gap r${row.rowIndex} c${i}`);
    }
    // row height from tallest pair
    near(row.heightIn, 2 * row.maxPairHeightIn + S.hardware.pairGapIn, `row ${row.rowIndex} height`);
    // arm line and plate
    for (const b of brs) {
      near(b.armTopYIn, row.bottomYIn + row.maxPairHeightIn + S.hardware.pairGapIn, `arm top r${row.rowIndex} b${b.number}`);
      near(b.plateYIn!, b.armTopYIn - S.hardware.plateToArmTopIn!, `plate Y b${b.number}`);
      // heels face centre: left pair ends at plateX - heelInset
      if (b.leftPairId) {
        const len = pairs.find(p => p.id === b.leftPairId)!.measurement!.lengthIn;
        const expect = Math.max(S.hardware.bracketWidthIn / 2, S.hardware.heelInsetFromCenterIn + len);
        near(b.plateXIn - b.extent.x0, expect, `left arm extent b${b.number}`);
      }
      // pair fits inside the row band
      ok(b.extent.y0 >= row.bottomYIn - 1e-6, `b${b.number} bottom inside band`);
      ok(b.extent.y1 <= row.bottomYIn + row.heightIn + 1e-6, `b${b.number} top inside band`);
      ok(b.extent.y0 >= wl.usableY.y0 - 1e-6 && b.extent.y1 <= wl.usableY.y1 + 1e-6, `b${b.number} inside usable band`);
    }
    // rows stack with rowGap
    if (row.rowIndex > 0) {
      const prev = wl.rows.find(x => x.rowIndex === row.rowIndex - 1)!;
      near(row.bottomYIn - (prev.bottomYIn + prev.heightIn), S.spacing.rowGapIn, `row gap r${row.rowIndex}`);
    }
    // no horizontal overlap between brackets
    for (let i = 0; i + 1 < brs.length; i++) ok(brs[i].extent.x1 <= brs[i + 1].extent.x0 + 1e-9, `no overlap r${row.rowIndex} c${i}`);
  }
  // the stack hangs from the top of the band, slack left at the bottom
  {
    const bottom = Math.min(...wl.brackets.map(b => b.extent.y0));
    const top = Math.max(...wl.brackets.map(b => b.extent.y1));
    near(top, wl.usableY.y1, `wall ${wl.wallIndex} stack flush with the band top`, 1e-6);
    ok(bottom >= wl.usableY.y0 - 1e-6, `wall ${wl.wallIndex} stack still inside the band bottom`);
  }
  // tallest row at the bottom
  const hs = [...wl.rows].sort((a,b)=>a.rowIndex-b.rowIndex).map(r => r.maxPairHeightIn);
  ok(hs.every((h, i) => i === 0 || h <= hs[i-1] + 1e-9), `wall ${wl.wallIndex} rows get shorter going up: ${hs.join(',')}`);
  // bracket numbers 1..n per wall
  const nums = wl.brackets.map(b => b.number).sort((a,b)=>a-b);
  ok(nums.every((v, i) => v === i + 1), `wall ${wl.wallIndex} bracket numbers contiguous from 1`);
}

console.log('--- half-drop ---');
const r2 = generateLayout({ pairs, walls, settings: S, pattern: 'half-drop', colorMode: 'contrast', excludedPairIds: [], seed: 7, annealIterations: 400 });
ok(r2.blockers.length === 0, 'half-drop no blockers');
const L2 = r2.layout!;
for (const wl of L2.walls) {
  ok(wl.warnings.length === 0, `hd wall ${wl.wallIndex} warnings: ${wl.warnings.join(' | ')}`);
  for (const b of wl.brackets) {
    ok(b.extent.y0 >= wl.usableY.y0 - 1e-6, `hd b${b.number} not below band (y0=${b.extent.y0.toFixed(2)} band=${wl.usableY.y0})`);
    ok(b.extent.y1 <= wl.usableY.y1 + 1e-6, `hd b${b.number} not above band`);
  }
  for (const row of wl.rows) {
    const brs = wl.brackets.filter(b => b.rowIndex === row.rowIndex).sort((a,b)=>a.colIndex-b.colIndex);
    for (const b of brs) {
      const want = row.bottomYIn + row.maxPairHeightIn + S.hardware.pairGapIn - (b.colIndex % 2 === 1 ? row.halfDropOffsetIn : 0);
      near(b.armTopYIn, want, `hd arm top r${row.rowIndex} c${b.colIndex}`);
    }
    if (brs.length > 1) ok(row.halfDropOffsetIn > 0, `row ${row.rowIndex} has a half-drop offset`);
  }
  // odd columns must not collide vertically with each other
  const cols = new Map<number, typeof wl.brackets>();
  for (const b of wl.brackets) { const a = cols.get(b.colIndex) ?? []; a.push(b); cols.set(b.colIndex, a); }
  for (const [c, bs] of cols) {
    bs.sort((a,b)=>a.rowIndex-b.rowIndex);
    for (let i=0;i+1<bs.length;i++) ok(bs[i].extent.y1 <= bs[i+1].extent.y0 + 1e-6, `hd col ${c} rows ${i}/${i+1} do not overlap`);
  }
  // half-drop neighbours in adjacent columns must not overlap horizontally
  for (const row of wl.rows) {
    const brs = wl.brackets.filter(b=>b.rowIndex===row.rowIndex).sort((a,b)=>a.colIndex-b.colIndex);
    for (let i=0;i+1<brs.length;i++) ok(brs[i].extent.x1 <= brs[i+1].extent.x0 + 1e-9, `hd no x overlap r${row.rowIndex}`);
  }
}

console.log('--- manual swap ---');
{
  const { swapPairsInLayout } = await import('../src/lib/layout.ts');
  const w0 = L.walls[0];
  const b1 = w0.brackets[0], b2 = w0.brackets[1];
  const before = [b1.leftPairId, b2.rightPairId];
  const swapped = swapPairsInLayout(
    L,
    { wallIndex: w0.wallIndex, bracketNumber: b1.number, arm: 'left' },
    { wallIndex: w0.wallIndex, bracketNumber: b2.number, arm: 'right' },
    pairs, S,
  );
  const n0 = swapped.walls[0];
  const n1 = n0.brackets.find(b => b.number === b1.number)!;
  const n2 = n0.brackets.find(b => b.number === b2.number)!;
  ok(n1.leftPairId === before[1] && n2.rightPairId === before[0], 'swap exchanged the two pairs');
  ok(L.walls[0].brackets[0].leftPairId === before[0], 'original layout not mutated');
  // geometry is rebuilt, so spacing still holds
  const brs = n0.brackets.filter(b => b.rowIndex === n1.rowIndex).sort((a, b) => a.colIndex - b.colIndex);
  for (let i = 0; i + 1 < brs.length; i++) {
    near(brs[i + 1].extent.x0 - brs[i].extent.x1, S.spacing.toeGapIn, `post-swap toe gap ${i}`);
  }
  const left = brs[0].extent.x0 - n0.usableX.x0;
  const right = n0.usableX.x1 - brs[brs.length - 1].extent.x1;
  near(left, right, 'post-swap row still centred horizontally');
  const top = Math.max(...n0.brackets.map(b => b.extent.y1));
  near(top, n0.usableY.y1, 'post-swap stack still flush with the band top');
}

console.log('--- blockers ---');
const noBand = generateLayout({ pairs, walls: makeDefaultWalls(), settings: S, pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 1 });
ok(noBand.layout === null && noBand.blockers.length === 3, `blank band heights blocked (${noBand.blockers.length} blockers)`);
const tiny = generateLayout({ pairs, walls: [{ ...walls[0], bandBottomIn: 40, bandTopIn: 46 }], settings: S, pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 1 });
ok(tiny.layout !== null, 'tiny band still returns a layout object');
console.log('  tiny band: unplaced =', tiny.layout!.unplacedPairIds.length, '| warnings:', tiny.layout!.walls[0].warnings[0]?.slice(0, 80));
ok(tiny.layout!.unplacedPairIds.length > 0, 'tiny band leaves pairs unplaced');

console.log('--- bracket budget ---');
const cap = generateLayout({ pairs, walls, settings: { ...S, bracketCount: 4 }, pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 1 });
ok(cap.layout!.bracketsUsed <= 4, `bracket cap respected (${cap.layout!.bracketsUsed})`);
ok(cap.layout!.unplacedPairIds.length === pairs.length - 8, `cap leaves ${pairs.length - 8} unplaced, got ${cap.layout!.unplacedPairIds.length}`);

console.log('--- odd pair count ---');
const odd = generateLayout({ pairs: pairs.slice(0, 7), walls: [walls[0]], settings: S, pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 3 });
const placedOdd = odd.layout!.walls.flatMap(w=>w.brackets).flatMap(b=>[b.leftPairId,b.rightPairId]).filter(Boolean);
ok(placedOdd.length === 7, `7 pairs placed, got ${placedOdd.length}`);
ok(odd.layout!.walls[0].brackets.some(b => b.rightPairId === null || b.leftPairId === null), 'one arm left empty');

console.log('--- gradient mode ---');
const grad = generateLayout({ pairs, walls, settings: S, pattern: 'grid', colorMode: 'gradient', excludedPairIds: [], seed: 1 });
ok(grad.layout !== null && grad.blockers.length === 0, 'gradient generates');

console.log('--- determinism / shuffle ---');
const a1 = JSON.stringify(generateLayout({ pairs, walls, settings: S, pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 42, annealIterations: 500 }).layout!.walls);
const a2 = JSON.stringify(generateLayout({ pairs, walls, settings: S, pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 42, annealIterations: 500 }).layout!.walls);
ok(a1 === a2, 'same seed gives the same layout');
const a3 = JSON.stringify(generateLayout({ pairs, walls, settings: S, pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 99, annealIterations: 500 }).layout!.walls);
ok(a1 !== a3, 'different seed gives a different layout');

console.log('--- plate offset unmeasured ---');
const noPlate = generateLayout({ pairs, walls, settings: { ...S, hardware: { ...S.hardware, plateToArmTopIn: null } }, pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 1 });
ok(noPlate.layout!.walls.every(w => w.brackets.every(b => b.plateYIn === null)), 'plate Y is null when the offset is unmeasured');
ok(noPlate.layout!.notes.some(x => x.includes('Plate-to-arm-top')), 'note explains the missing offset');

console.log(fails === 0 ? '\nALL LAYOUT TESTS PASS' : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
