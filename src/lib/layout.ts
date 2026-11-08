// Layout generator.
//
// Geometry model for one loaded bracket (all inches, X from the left wall edge,
// Y up from the floor):
//
//   - The bracket is mounted by a single plate; `plateX` is the plate centre.
//   - `armTopY` is the top surface of the two arms.
//   - Heels face the bracket centre, toes point outward, so the pair on the
//     left arm runs from (plateX - heelInset - length) to (plateX - heelInset).
//   - Each pair is one shoe standing on the arm, occupying
//     [armTopY, armTopY + height], and its mirror hanging below, occupying
//     [armTopY - pairGap - height, armTopY - pairGap].
//   - A bracket can never be narrower than the iron itself, so each side
//     reserves at least bracketWidth / 2.

import type {
  Bracket, ColorMode, Layout, LayoutRow, Pair, PatternMode, Settings, Wall, WallLayout,
} from '../types';
import { mulberry32, paletteDistance, lightnessOf, hueOf } from './color';

export interface SlotRef {
  wallIndex: number;
  rowIndex: number;
  /** Bracket position within the row, 0-based left to right. */
  colIndex: number;
  arm: 'left' | 'right';
}

export interface GenerateInput {
  pairs: Pair[];
  walls: Wall[];
  settings: Settings;
  pattern: PatternMode;
  colorMode: ColorMode;
  excludedPairIds: string[];
  seed: number;
  /** Iterations of simulated annealing. 0 keeps the greedy result. */
  annealIterations?: number;
}

export interface GenerateResult {
  layout: Layout | null;
  /** Things that stop generation outright. */
  blockers: string[];
}

export const measured = (p: Pair): p is Pair & { measurement: NonNullable<Pair['measurement']> } =>
  p.measurement !== null;

/** Half-width this pair needs on its arm, respecting the iron's own width. */
function armExtent(lengthIn: number, s: Settings): number {
  return Math.max(s.hardware.bracketWidthIn / 2, s.hardware.heelInsetFromCenterIn + lengthIn);
}
/** Half-width an EMPTY arm still needs. */
function emptyArmExtent(s: Settings): number {
  return s.hardware.bracketWidthIn / 2;
}

export function usableXRange(wall: Wall, s: Settings): { x0: number; x1: number } {
  const c = s.spacing.cornerClearanceIn;
  const x0 = wall.left.isCorner && wall.left.keepsClear ? c : 0;
  const x1 = wall.widthIn - (wall.right.isCorner && wall.right.keepsClear ? c : 0);
  return { x0, x1 };
}

interface RowPlan {
  /** Pair ids in the order the generator picked them (left arm, right arm, ...). */
  pairIds: string[];
  maxHeightIn: number;
  heightIn: number;
  widthIn: number;
  bottomYIn: number;
  bracketCount: number;
}

interface WallPlan {
  wall: Wall;
  wallIndex: number;
  usableX: { x0: number; x1: number };
  usableY: { y0: number; y1: number };
  rows: RowPlan[];
  nextBottomY: number;
  full: boolean;
  warnings: string[];
}

function rowWidth(pairIds: string[], byId: Map<string, Pair>, s: Settings): number {
  const n = Math.ceil(pairIds.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let b = 0; b < n; b++) {
    const l = pairIds[b * 2], r = pairIds[b * 2 + 1];
    sum += l ? armExtent(byId.get(l)!.measurement!.lengthIn, s) : emptyArmExtent(s);
    sum += r ? armExtent(byId.get(r)!.measurement!.lengthIn, s) : emptyArmExtent(s);
  }
  return sum + s.spacing.toeGapIn * (n - 1);
}

function rowHeightFor(maxHeightIn: number, s: Settings): number {
  return 2 * maxHeightIn + s.hardware.pairGapIn;
}

/** Vertical shift applied to odd columns in half-drop mode. */
function halfDropOffset(rowHeightIn: number, s: Settings): number {
  return (rowHeightIn + s.spacing.rowGapIn) / 2;
}

export function generateLayout(input: GenerateInput): GenerateResult {
  const { walls, settings: s, pattern, excludedPairIds, seed } = input;
  const blockers: string[] = [];
  const notes: string[] = [];

  const excluded = new Set(excludedPairIds);
  const eligible = input.pairs.filter(
    (p) => measured(p) && !excluded.has(p.id) && p.status !== 'not-on-rack',
  );
  const byId = new Map(input.pairs.map((p) => [p.id, p] as const));

  const unmeasured = input.pairs.filter((p) => !measured(p)).length;
  if (unmeasured > 0) {
    notes.push(
      `${unmeasured} pair${unmeasured === 1 ? '' : 's'} ha${unmeasured === 1 ? 's' : 've'} no measurements yet and ${unmeasured === 1 ? 'was' : 'were'} left out. Measure ${unmeasured === 1 ? 'it' : 'them'} on the Capture tab.`,
    );
  }
  const offRack = input.pairs.filter((p) => measured(p) && p.status === 'not-on-rack').length;
  if (offRack > 0) {
    notes.push(`${offRack} pair${offRack === 1 ? '' : 's'} marked "not on rack" and left out.`);
  }

  if (!walls.length) blockers.push('No walls defined. Add at least one on the Walls tab.');
  walls.forEach((w, i) => {
    const label = w.name || `Wall ${i + 1}`;
    if (w.bandBottomIn === null || w.bandTopIn === null) {
      blockers.push(`${label}: usable band bottom and top heights have not been entered yet.`);
    } else if (w.bandTopIn <= w.bandBottomIn) {
      blockers.push(`${label}: band top (${w.bandTopIn}") must be above band bottom (${w.bandBottomIn}").`);
    }
    if (!(w.widthIn > 0)) blockers.push(`${label}: wall width must be greater than 0.`);
    const ux = usableXRange(w, s);
    if (ux.x1 - ux.x0 <= 0) {
      blockers.push(`${label}: corner clearance leaves no usable width.`);
    }
  });
  if (!eligible.length) {
    blockers.push('No measured pairs available to place.');
  }
  if (blockers.length) return { layout: null, blockers };

  // Tallest first: high-tops land in the bottom rows and group together.
  const queue = [...eligible].sort((a, b) => {
    const d = b.measurement!.heightIn - a.measurement!.heightIn;
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

  const plans: WallPlan[] = walls.map((w, i) => {
    const usableX = usableXRange(w, s);
    const y0 = w.bandBottomIn!;
    const y1 = w.bandTopIn!;
    // Half-drop pushes odd columns below their row band, so the stack starts
    // high enough that nothing drops out of the usable band.
    return {
      wall: w, wallIndex: i, usableX, usableY: { y0, y1 },
      rows: [], nextBottomY: y0, full: false, warnings: [],
    };
  });

  const bracketBudget = s.bracketCount;
  let bracketsUsed = 0;

  // Round-robin a row at a time so the tall pairs spread across the walls
  // rather than filling the first wall.
  let guard = 0;
  while (queue.length && plans.some((p) => !p.full) && guard++ < 10_000) {
    let placedSomething = false;
    for (const plan of plans) {
      if (plan.full || !queue.length) continue;
      if (bracketBudget !== null && bracketsUsed >= bracketBudget) { plan.full = true; continue; }

      const tallest = queue[0].measurement!.heightIn;
      const rowH = rowHeightFor(tallest, s);
      const drop = pattern === 'half-drop' ? halfDropOffset(rowH, s) : 0;

      // Where this row's band would start. The first row must leave room below
      // for the half-drop shift.
      const bottomY = plan.rows.length === 0 ? plan.nextBottomY + drop : plan.nextBottomY;
      if (bottomY + rowH > plan.usableY.y1 + 1e-9) {
        plan.full = true;
        if (plan.rows.length === 0) {
          plan.warnings.push(
            `Nothing fits: a row for the tallest remaining pair needs ${rowH.toFixed(2)}" (2 x ${tallest.toFixed(2)}" plus a ${s.hardware.pairGapIn}" pair gap)${drop ? ` plus ${drop.toFixed(2)}" of half-drop clearance` : ''}, but the usable band is only ${(plan.usableY.y1 - plan.usableY.y0).toFixed(2)}" tall.`,
          );
        }
        continue;
      }

      const usableW = plan.usableX.x1 - plan.usableX.x0;
      const picked: string[] = [];
      while (queue.length) {
        const candidate = queue[0];
        const trial = [...picked, candidate.id];
        if (rowWidth(trial, byId, s) > usableW + 1e-9) break;
        if (bracketBudget !== null) {
          const needed = Math.ceil(trial.length / 2);
          if (bracketsUsed + needed > bracketBudget) break;
        }
        picked.push(candidate.id);
        queue.shift();
      }

      if (!picked.length) {
        plan.full = true;
        if (bracketBudget !== null && bracketsUsed >= bracketBudget) continue;
        plan.warnings.push(
          `The next pair needs ${(2 * armExtent(queue[0]?.measurement?.lengthIn ?? 0, s)).toFixed(2)}" of bracket width but only ${usableW.toFixed(2)}" is usable.`,
        );
        continue;
      }

      const maxHeightIn = Math.max(...picked.map((id) => byId.get(id)!.measurement!.heightIn));
      const heightIn = rowHeightFor(maxHeightIn, s);
      const bc = Math.ceil(picked.length / 2);
      plan.rows.push({
        pairIds: picked,
        maxHeightIn,
        heightIn,
        widthIn: rowWidth(picked, byId, s),
        bottomYIn: bottomY,
        bracketCount: bc,
      });
      bracketsUsed += bc;
      plan.nextBottomY = bottomY + heightIn + s.spacing.rowGapIn;
      placedSomething = true;
    }
    if (!placedSomething) break;
  }

  // ---- assignment (which pair goes in which slot) ----
  const slots: SlotRef[] = [];
  for (const plan of plans) {
    plan.rows.forEach((row, rowIndex) => {
      for (let b = 0; b < row.bracketCount; b++) {
        slots.push({ wallIndex: plan.wallIndex, rowIndex, colIndex: b, arm: 'left' });
        slots.push({ wallIndex: plan.wallIndex, rowIndex, colIndex: b, arm: 'right' });
      }
    });
  }

  const assignment = assignPairs(plans, byId, s, input.colorMode, seed, input.annealIterations ?? 4000);

  // ---- build concrete geometry ----
  const wallLayouts: WallLayout[] = plans.map((plan) => {
    const rows: LayoutRow[] = [];
    const brackets: Bracket[] = [];
    let number = 1;

    plan.rows.forEach((row, rowIndex) => {
      const ids = assignment.get(`${plan.wallIndex}:${rowIndex}`) ?? row.pairIds;
      const width = rowWidth(ids, byId, s);
      const usableW = plan.usableX.x1 - plan.usableX.x0;
      const margin = (usableW - width) / 2;
      let cursor = plan.usableX.x0 + margin;

      const drop = pattern === 'half-drop' ? halfDropOffset(row.heightIn, s) : 0;
      // Keep the odd-column stack from closing up on itself if a lower row ever
      // ends up shorter than the one above it.
      const prevDrop = rows.length ? rows[rows.length - 1].halfDropOffsetIn : drop;
      const clampedDrop = rows.length ? Math.min(drop, prevDrop + s.spacing.rowGapIn) : drop;

      const armTopBase = row.bottomYIn + row.maxHeightIn + s.hardware.pairGapIn;
      const numbers: number[] = [];

      for (let b = 0; b < row.bracketCount; b++) {
        const leftId = ids[b * 2] ?? null;
        const rightId = ids[b * 2 + 1] ?? null;
        const le = leftId ? armExtent(byId.get(leftId)!.measurement!.lengthIn, s) : emptyArmExtent(s);
        const re = rightId ? armExtent(byId.get(rightId)!.measurement!.lengthIn, s) : emptyArmExtent(s);

        const shifted = pattern === 'half-drop' && b % 2 === 1;
        const armTopY = armTopBase - (shifted ? clampedDrop : 0);
        const plateX = cursor + le;

        const pairH = Math.max(
          leftId ? byId.get(leftId)!.measurement!.heightIn : 0,
          rightId ? byId.get(rightId)!.measurement!.heightIn : 0,
        );

        brackets.push({
          number,
          rowIndex,
          colIndex: b,
          plateXIn: plateX,
          armTopYIn: armTopY,
          plateYIn: s.hardware.plateToArmTopIn === null ? null : armTopY - s.hardware.plateToArmTopIn,
          leftPairId: leftId,
          rightPairId: rightId,
          extent: {
            x0: cursor,
            x1: cursor + le + re,
            y0: armTopY - s.hardware.pairGapIn - pairH,
            y1: armTopY + pairH,
          },
        });
        numbers.push(number);
        number++;
        cursor += le + re + s.spacing.toeGapIn;
      }

      rows.push({
        rowIndex,
        maxPairHeightIn: row.maxHeightIn,
        heightIn: row.heightIn,
        bottomYIn: row.bottomYIn,
        bracketNumbers: numbers,
        halfDropOffsetIn: clampedDrop,
      });
    });

    const built: WallLayout = {
      wallId: plan.wall.id,
      wallIndex: plan.wallIndex,
      wallName: plan.wall.name || `Wall ${plan.wallIndex + 1}`,
      widthIn: plan.wall.widthIn,
      usableX: plan.usableX,
      usableY: plan.usableY,
      rows,
      brackets,
      warnings: [],
    };
    centerWallVertically(built);

    const warnings = [...plan.warnings];
    for (const b of brackets) {
      if (b.extent.y0 < plan.usableY.y0 - 0.01) {
        warnings.push(
          `Bracket ${b.number} hangs ${(plan.usableY.y0 - b.extent.y0).toFixed(2)}" below the usable band.`,
        );
      }
      if (b.extent.y1 > plan.usableY.y1 + 0.01) {
        warnings.push(
          `Bracket ${b.number} reaches ${(b.extent.y1 - plan.usableY.y1).toFixed(2)}" above the usable band.`,
        );
      }
      if (b.extent.x0 < plan.usableX.x0 - 0.01 || b.extent.x1 > plan.usableX.x1 + 0.01) {
        warnings.push(`Bracket ${b.number} sits outside the usable width.`);
      }
    }

    built.warnings = [...new Set(warnings)];
    return built;
  });

  const placed = new Set<string>();
  for (const wl of wallLayouts) {
    for (const b of wl.brackets) {
      if (b.leftPairId) placed.add(b.leftPairId);
      if (b.rightPairId) placed.add(b.rightPairId);
    }
  }
  const unplacedPairIds = eligible.filter((p) => !placed.has(p.id)).map((p) => p.id);

  notes.push(
    'Each wall\u2019s rows are centred inside its usable band, so the space above and below the pattern matches.',
  );
  if (s.hardware.plateToArmTopIn === null) {
    notes.push(
      'Plate-to-arm-top offset has not been measured, so the install sheet cannot give mounting-plate heights yet. Enter it in Settings.',
    );
  }
  if (bracketBudget === null) {
    notes.push('Bracket count has not been entered, so nothing was capped. Enter it on the Walls tab.');
  } else if (bracketsUsed < bracketBudget) {
    notes.push(`${bracketBudget - bracketsUsed} of your ${bracketBudget} brackets are not used by this layout.`);
  }
  const emptyArms = slots.length - placed.size;
  if (emptyArms > 0) {
    notes.push(`${emptyArms} arm slot${emptyArms === 1 ? '' : 's'} will be empty.`);
  }
  if (unplacedPairIds.length) {
    notes.push(
      `${unplacedPairIds.length} measured pair${unplacedPairIds.length === 1 ? '' : 's'} did not fit. Pick which to leave out, or add walls/brackets.`,
    );
  }

  return {
    blockers: [],
    layout: {
      pattern,
      colorMode: input.colorMode,
      walls: wallLayouts,
      unplacedPairIds,
      bracketsUsed,
      bracketsOwned: bracketBudget,
      slotCount: slots.length,
      notes,
      generatedAt: Date.now(),
      excludedPairIds: [...excluded],
      seed,
    },
  };
}


/**
 * Slides a wall's whole stack of rows so the empty band above it matches the
 * empty band below. Rows are built from the band bottom upwards; without this
 * a short collection sits in a puddle at the bottom with dead wall above it.
 * The usable band still sets the envelope — nothing is pushed outside it.
 */
export function centerWallVertically(wl: WallLayout): void {
  if (!wl.brackets.length) return;
  const contentBottom = Math.min(...wl.brackets.map((b) => b.extent.y0));
  const contentTop = Math.max(...wl.brackets.map((b) => b.extent.y1));
  const below = contentBottom - wl.usableY.y0;
  const above = wl.usableY.y1 - contentTop;
  const shift = (above - below) / 2;
  if (Math.abs(shift) < 1e-9) return;
  for (const b of wl.brackets) {
    b.armTopYIn += shift;
    if (b.plateYIn !== null) b.plateYIn += shift;
    b.extent.y0 += shift;
    b.extent.y1 += shift;
  }
  for (const r of wl.rows) r.bottomYIn += shift;
}

// ---------------------------------------------------------------------------
// Colour distribution
// ---------------------------------------------------------------------------

type RowKey = string; // `${wallIndex}:${rowIndex}`

interface Node {
  key: RowKey;
  /** Index within the row's slot sequence (left arm b0, right arm b0, left b1, ...). */
  slotIndex: number;
  /** Approximate centre X of the slot, for finding vertical neighbours. */
  xMid: number;
  xSpan: [number, number];
  neighbours: number[];
}

/**
 * Greedy first pass followed by simulated annealing, maximising CIEDE2000
 * distance between neighbouring pairs. Swaps stay within a row, or cross rows
 * only when neither row's height or width changes in a way that breaks the fit.
 */
function assignPairs(
  plans: WallPlan[],
  byId: Map<string, Pair>,
  s: Settings,
  mode: ColorMode,
  seed: number,
  iterations: number,
): Map<RowKey, string[]> {
  const result = new Map<RowKey, string[]>();
  const rng = mulberry32(seed || 1);

  // Flatten to nodes with geometry from the initial (height-sorted) arrangement.
  const nodes: Node[] = [];
  const nodeIndexByRow = new Map<RowKey, number[]>();
  const rowOf = new Map<RowKey, RowPlan>();
  const planOf = new Map<RowKey, WallPlan>();

  for (const plan of plans) {
    plan.rows.forEach((row, rowIndex) => {
      const key: RowKey = `${plan.wallIndex}:${rowIndex}`;
      rowOf.set(key, row);
      planOf.set(key, plan);
      const usableW = plan.usableX.x1 - plan.usableX.x0;
      let cursor = plan.usableX.x0 + (usableW - row.widthIn) / 2;
      const idxs: number[] = [];
      for (let b = 0; b < row.bracketCount; b++) {
        const l = row.pairIds[b * 2], r = row.pairIds[b * 2 + 1];
        const le = l ? armExtent(byId.get(l)!.measurement!.lengthIn, s) : emptyArmExtent(s);
        const re = r ? armExtent(byId.get(r)!.measurement!.lengthIn, s) : emptyArmExtent(s);
        idxs.push(nodes.length);
        nodes.push({ key, slotIndex: b * 2, xMid: cursor + le / 2, xSpan: [cursor, cursor + le], neighbours: [] });
        idxs.push(nodes.length);
        nodes.push({ key, slotIndex: b * 2 + 1, xMid: cursor + le + re / 2, xSpan: [cursor + le, cursor + le + re], neighbours: [] });
        cursor += le + re + s.spacing.toeGapIn;
      }
      nodeIndexByRow.set(key, idxs);
    });
  }

  // Horizontal neighbours: consecutive slots in a row (this covers both the
  // toe-to-toe gap between brackets and the two arms of one bracket).
  for (const idxs of nodeIndexByRow.values()) {
    for (let i = 0; i + 1 < idxs.length; i++) {
      nodes[idxs[i]].neighbours.push(idxs[i + 1]);
      nodes[idxs[i + 1]].neighbours.push(idxs[i]);
    }
  }
  // Vertical neighbours: slots in the row above whose X span overlaps.
  for (const plan of plans) {
    for (let r = 0; r + 1 < plan.rows.length; r++) {
      const a = nodeIndexByRow.get(`${plan.wallIndex}:${r}`) ?? [];
      const b = nodeIndexByRow.get(`${plan.wallIndex}:${r + 1}`) ?? [];
      for (const i of a) {
        for (const j of b) {
          const [a0, a1] = nodes[i].xSpan, [b0, b1] = nodes[j].xSpan;
          const overlap = Math.min(a1, b1) - Math.max(a0, b0);
          if (overlap > 0.25) {
            nodes[i].neighbours.push(j);
            nodes[j].neighbours.push(i);
          }
        }
      }
    }
  }

  // Working assignment: nodeIndex -> pairId | null
  const assign: (string | null)[] = new Array(nodes.length).fill(null);

  if (mode === 'gradient') {
    // Serpentine gradient: sort each row by lightness then hue, alternating
    // direction so the transition carries across row ends.
    let flip = false;
    for (const [key, idxs] of nodeIndexByRow) {
      const row = rowOf.get(key)!;
      const sorted = [...row.pairIds].sort((x, y) => {
        const px = byId.get(x)!, py = byId.get(y)!;
        const lx = px.colors[0] ? lightnessOf(px.colors[0].hex) : 50;
        const ly = py.colors[0] ? lightnessOf(py.colors[0].hex) : 50;
        if (Math.abs(lx - ly) > 1) return lx - ly;
        const hx = px.colors[0] ? hueOf(px.colors[0].hex) : 0;
        const hy = py.colors[0] ? hueOf(py.colors[0].hex) : 0;
        return hx - hy;
      });
      if (flip) sorted.reverse();
      flip = !flip;
      idxs.forEach((n, i) => { assign[n] = sorted[i] ?? null; });
    }
  } else {
    // Greedy: walk the slots and take whichever remaining pair in that row is
    // furthest in colour from the neighbours already filled in.
    const pools = new Map<RowKey, string[]>();
    for (const [key, row] of rowOf) pools.set(key, [...row.pairIds]);
    const order = nodes.map((_, i) => i);
    for (const n of order) {
      const pool = pools.get(nodes[n].key)!;
      if (!pool.length) { assign[n] = null; continue; }
      const filled = nodes[n].neighbours.map((m) => assign[m]).filter((x): x is string => !!x);
      let best = 0, bestScore = -Infinity;
      pool.forEach((cand, i) => {
        const score = filled.length
          ? Math.min(...filled.map((f) => paletteDistance(byId.get(cand)!.colors, byId.get(f)!.colors)))
          : 0;
        if (score > bestScore) { bestScore = score; best = i; }
      });
      assign[n] = pool.splice(best, 1)[0];
    }

    // Simulated annealing.
    const distCache = new Map<string, number>();
    const d = (a: string | null, b: string | null): number => {
      if (!a || !b) return 0;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      let v = distCache.get(k);
      if (v === undefined) {
        v = paletteDistance(byId.get(a)!.colors, byId.get(b)!.colors);
        distCache.set(k, v);
      }
      return v;
    };
    const nodeScore = (n: number): number => {
      const ns = nodes[n].neighbours;
      if (!ns.length) return 0;
      let sum = 0, min = Infinity;
      for (const m of ns) {
        const v = d(assign[n], assign[m]);
        sum += v;
        if (v < min) min = v;
      }
      // Half of each edge belongs to this node; the min term lifts the worst
      // local contrast rather than only the average.
      return sum / 2 + 2 * (min === Infinity ? 0 : min);
    };
    const localScore = (ns: number[]): number => {
      const touched = new Set<number>(ns);
      for (const n of ns) for (const m of nodes[n].neighbours) touched.add(m);
      let t = 0;
      for (const n of touched) t += nodeScore(n);
      return t;
    };

    const rowKeys = [...nodeIndexByRow.keys()];
    const iters = rowKeys.length ? Math.max(0, iterations) : 0;
    for (let it = 0; it < iters; it++) {
      const temp = 6 * (1 - it / iters) + 0.01;
      const crossRow = rng() < 0.25 && rowKeys.length > 1;

      let n1: number, n2: number;
      if (crossRow) {
        const ka = rowKeys[Math.floor(rng() * rowKeys.length)];
        let kb = rowKeys[Math.floor(rng() * rowKeys.length)];
        if (ka === kb) kb = rowKeys[(rowKeys.indexOf(ka) + 1) % rowKeys.length];
        const ia = nodeIndexByRow.get(ka)!, ib = nodeIndexByRow.get(kb)!;
        n1 = ia[Math.floor(rng() * ia.length)];
        n2 = ib[Math.floor(rng() * ib.length)];
        const p1 = assign[n1], p2 = assign[n2];
        if (!p1 || !p2) continue;
        if (!crossRowSwapAllowed(ka, kb, p1, p2, rowOf, planOf, byId, s)) continue;
      } else {
        const k = rowKeys[Math.floor(rng() * rowKeys.length)];
        const idxs = nodeIndexByRow.get(k)!;
        if (idxs.length < 2) continue;
        n1 = idxs[Math.floor(rng() * idxs.length)];
        n2 = idxs[Math.floor(rng() * idxs.length)];
        if (n1 === n2) continue;
      }

      const before = localScore([n1, n2]);
      const t = assign[n1]; assign[n1] = assign[n2]; assign[n2] = t;
      const after = localScore([n1, n2]);
      const delta = after - before;
      if (delta >= 0 || rng() < Math.exp(delta / temp)) {
        if (crossRow) {
          // Keep the row membership bookkeeping in step with the swap.
          const ka = nodes[n1].key, kb = nodes[n2].key;
          const ra = rowOf.get(ka)!, rb = rowOf.get(kb)!;
          const pa = assign[n1]!, pb = assign[n2]!;
          swapInPlace(ra.pairIds, pb, pa);
          swapInPlace(rb.pairIds, pa, pb);
          ra.widthIn = rowWidth(ra.pairIds, byId, s);
          rb.widthIn = rowWidth(rb.pairIds, byId, s);
        }
      } else {
        const back = assign[n1]; assign[n1] = assign[n2]; assign[n2] = back;
      }
    }
  }

  for (const [key, idxs] of nodeIndexByRow) {
    const ids: string[] = [];
    // Slots are listed in slot order already, but be explicit about it.
    const bySlot = [...idxs].sort((a, b) => nodes[a].slotIndex - nodes[b].slotIndex);
    for (const n of bySlot) {
      const v = assign[n];
      if (v) ids[nodes[n].slotIndex] = v;
    }
    result.set(key, ids);
  }
  return result;
}

function swapInPlace(arr: string[], remove: string, add: string) {
  const i = arr.indexOf(remove);
  if (i >= 0) arr[i] = add;
}

/**
 * A cross-row swap is only safe when neither row gets taller (which would
 * change the band stack) and both still fit their usable width.
 */
function crossRowSwapAllowed(
  ka: RowKey, kb: RowKey, p1: string, p2: string,
  rowOf: Map<RowKey, RowPlan>, planOf: Map<RowKey, WallPlan>,
  byId: Map<string, Pair>, s: Settings,
): boolean {
  const ra = rowOf.get(ka)!, rb = rowOf.get(kb)!;
  const h1 = byId.get(p1)!.measurement!.heightIn;
  const h2 = byId.get(p2)!.measurement!.heightIn;
  // p2 moves into row A and p1 into row B, so neither incoming pair may be
  // taller than the row it lands in — that would change the band stack.
  if (h2 > ra.maxHeightIn + 1e-9 || h1 > rb.maxHeightIn + 1e-9) return false;

  const newA = ra.pairIds.map((x) => (x === p1 ? p2 : x));
  const newB = rb.pairIds.map((x) => (x === p2 ? p1 : x));
  const wa = rowWidth(newA, byId, s);
  const wb = rowWidth(newB, byId, s);
  const pa = planOf.get(ka)!, pb = planOf.get(kb)!;
  if (wa > pa.usableX.x1 - pa.usableX.x0 + 1e-9) return false;
  if (wb > pb.usableX.x1 - pb.usableX.x0 + 1e-9) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Manual edits to a generated layout
// ---------------------------------------------------------------------------

/**
 * Swaps two pairs in a saved layout and recomputes X positions and extents.
 * Returns fresh warnings so the UI can say if the hand-swap broke the fit.
 */
export function swapPairsInLayout(
  layout: Layout,
  a: { wallIndex: number; bracketNumber: number; arm: 'left' | 'right' },
  b: { wallIndex: number; bracketNumber: number; arm: 'left' | 'right' },
  pairs: Pair[],
  s: Settings,
): Layout {
  const byId = new Map(pairs.map((p) => [p.id, p] as const));
  const next: Layout = structuredClone(layout);

  const find = (ref: typeof a) => {
    const wl = next.walls.find((w) => w.wallIndex === ref.wallIndex);
    const br = wl?.brackets.find((x) => x.number === ref.bracketNumber);
    return { wl, br };
  };
  const A = find(a), B = find(b);
  if (!A.wl || !A.br || !B.wl || !B.br) return layout;

  const keyA = a.arm === 'left' ? 'leftPairId' : 'rightPairId';
  const keyB = b.arm === 'left' ? 'leftPairId' : 'rightPairId';
  const tmp = A.br[keyA];
  A.br[keyA] = B.br[keyB];
  B.br[keyB] = tmp;

  for (const wl of next.walls) recomputeWall(wl, byId, s, next.pattern);
  return next;
}

/** Recomputes X positions, extents, row heights and warnings from bracket contents. */
export function recomputeWall(
  wl: WallLayout,
  byId: Map<string, Pair>,
  s: Settings,
  pattern: PatternMode,
): void {
  const warnings: string[] = [];
  const lenOf = (id: string | null) =>
    id ? (byId.get(id)?.measurement?.lengthIn ?? null) : null;
  const heightOf = (id: string | null) =>
    id ? (byId.get(id)?.measurement?.heightIn ?? 0) : 0;

  // Rows first: heights can change after a hand-swap.
  let bottom: number | null = null;
  const sortedRows = [...wl.rows].sort((x, y) => x.rowIndex - y.rowIndex);
  for (const row of sortedRows) {
    const brs = wl.brackets.filter((b) => b.rowIndex === row.rowIndex).sort((x, y) => x.colIndex - y.colIndex);
    const maxH = Math.max(
      0,
      ...brs.flatMap((b) => [heightOf(b.leftPairId), heightOf(b.rightPairId)]),
    );
    row.maxPairHeightIn = maxH;
    row.heightIn = 2 * maxH + s.hardware.pairGapIn;
    const drop = pattern === 'half-drop' ? (row.heightIn + s.spacing.rowGapIn) / 2 : 0;
    row.halfDropOffsetIn = drop;
    row.bottomYIn = bottom === null ? wl.usableY.y0 + drop : bottom;
    bottom = row.bottomYIn + row.heightIn + s.spacing.rowGapIn;

    const widths = brs.map((b) => {
      const l = lenOf(b.leftPairId), r = lenOf(b.rightPairId);
      return {
        le: l === null ? emptyArmExtent(s) : armExtent(l, s),
        re: r === null ? emptyArmExtent(s) : armExtent(r, s),
      };
    });
    const total =
      widths.reduce((sum, w) => sum + w.le + w.re, 0) + s.spacing.toeGapIn * Math.max(0, brs.length - 1);
    const usableW = wl.usableX.x1 - wl.usableX.x0;
    if (total > usableW + 0.01) {
      warnings.push(
        `Row ${row.rowIndex + 1} now needs ${total.toFixed(2)}" but only ${usableW.toFixed(2)}" is usable.`,
      );
    }
    let cursor = wl.usableX.x0 + (usableW - total) / 2;
    const armTopBase = row.bottomYIn + maxH + s.hardware.pairGapIn;
    row.bracketNumbers = [];
    brs.forEach((b, i) => {
      const { le, re } = widths[i];
      const shifted = pattern === 'half-drop' && b.colIndex % 2 === 1;
      b.armTopYIn = armTopBase - (shifted ? drop : 0);
      b.plateXIn = cursor + le;
      b.plateYIn = s.hardware.plateToArmTopIn === null ? null : b.armTopYIn - s.hardware.plateToArmTopIn;
      const pairH = Math.max(heightOf(b.leftPairId), heightOf(b.rightPairId));
      b.extent = {
        x0: cursor,
        x1: cursor + le + re,
        y0: b.armTopYIn - s.hardware.pairGapIn - pairH,
        y1: b.armTopYIn + pairH,
      };
      cursor += le + re + s.spacing.toeGapIn;
      row.bracketNumbers.push(b.number);
    });
  }

  centerWallVertically(wl);

  for (const b of wl.brackets) {
    if (b.extent.y0 < wl.usableY.y0 - 0.01) {
      warnings.push(`Bracket ${b.number} hangs ${(wl.usableY.y0 - b.extent.y0).toFixed(2)}" below the usable band.`);
    }
    if (b.extent.y1 > wl.usableY.y1 + 0.01) {
      warnings.push(`Bracket ${b.number} reaches ${(b.extent.y1 - wl.usableY.y1).toFixed(2)}" above the usable band.`);
    }
  }
  wl.warnings = [...new Set(warnings)];
}
