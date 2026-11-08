import { useCallback, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { ColorMode, Layout, Pair, PatternMode } from '../types';
import { generateLayout, swapPairsInLayout } from '../lib/layout';
import { WallMockup, type SlotAddress } from '../components/WallMockup';
import { PairThumb } from '../components/PairThumb';
import { Notice, NumField, Checkbox, Swatches, fmtIn } from '../components/ui';
import { paletteDistance } from '../lib/color';

export function LayoutTab({
  highlightPairId, clearHighlight, goWalls, goCapture,
}: {
  highlightPairId: string | null;
  clearHighlight: () => void;
  goWalls: () => void;
  goCapture: () => void;
}) {
  const { pairs, walls, settings, saveSettings, layout, setLayout } = useStore();
  const [pattern, setPattern] = useState<PatternMode>(layout?.pattern ?? 'grid');
  const [colorMode, setColorMode] = useState<ColorMode>(layout?.colorMode ?? 'contrast');
  const [excluded, setExcluded] = useState<Set<string>>(new Set(layout?.excludedPairIds ?? []));
  const [showOverlay, setShowOverlay] = useState(false);
  const [zoom, setZoom] = useState(4);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(pairs.map((p) => [p.id, p] as const)), [pairs]);

  const run = useCallback(
    async (seed: number) => {
      setBusy(true);
      // Yield so the button shows its disabled state before the solver runs.
      await new Promise((r) => setTimeout(r, 0));
      const res = generateLayout({
        pairs, walls, settings, pattern, colorMode,
        excludedPairIds: [...excluded], seed,
      });
      setBlockers(res.blockers);
      if (res.layout) await setLayout(res.layout);
      setBusy(false);
    },
    [pairs, walls, settings, pattern, colorMode, excluded, setLayout],
  );

  const onSwap = useCallback(
    async (a: SlotAddress, b: SlotAddress) => {
      if (!layout) return;
      const next = swapPairsInLayout(layout, a, b, pairs, settings);
      await setLayout(next);
    },
    [layout, pairs, settings, setLayout],
  );

  const measuredPairs = pairs.filter((p) => p.measurement);
  // What the generator was actually allowed to place, so "placed X of Y" does
  // not count pairs you deliberately kept off the wall.
  const eligiblePairs = measuredPairs.filter(
    (p) => !excluded.has(p.id) && p.status !== 'not-on-rack',
  );
  const slotsOwned = settings.bracketCount === null ? null : settings.bracketCount * 2;
  const contrast = layout ? contrastReport(layout, byId) : null;

  // A saved layout can go stale if settings or measurements changed since.
  const stale = layout
    ? layout.walls.some((wl) => {
        const w = walls.find((x) => x.id === wl.wallId);
        return !w || w.widthIn !== wl.widthIn || w.bandBottomIn !== wl.usableY.y0 || w.bandTopIn !== wl.usableY.y1;
      })
    : false;

  return (
    <>
      <div className="card">
        <h2>Layout generator</h2>

        {blockers.length ? (
          <Notice kind="bad" title="Cannot generate yet">
            <ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            <button className="sm" style={{ marginTop: '.4rem' }} onClick={goWalls}>Go to Walls</button>
          </Notice>
        ) : null}

        {!measuredPairs.length ? (
          <Notice kind="warn" title="No measured pairs">
            Capture at least one pair first.
            <div><button className="sm" style={{ marginTop: '.4rem' }} onClick={goCapture}>Go to Capture</button></div>
          </Notice>
        ) : null}

        <h3 className="small muted" style={{ marginTop: '.5rem' }}>Spacing</h3>
        <div className="grid2">
          <NumField
            label="Between toes of neighbouring columns" step={0.125} min={0}
            value={settings.spacing.toeGapIn}
            onChange={(v) => v !== null && saveSettings({ ...settings, spacing: { ...settings.spacing, toeGapIn: v } })}
          />
          <NumField
            label="Between rows" step={0.125} min={0}
            value={settings.spacing.rowGapIn}
            onChange={(v) => v !== null && saveSettings({ ...settings, spacing: { ...settings.spacing, rowGapIn: v } })}
          />
        </div>

        <h3 className="small muted" style={{ marginTop: '.6rem' }}>Pattern</h3>
        <div className="row tight">
          <button className="chip" aria-pressed={pattern === 'grid'} onClick={() => setPattern('grid')}>A · Straight grid</button>
          <button className="chip" aria-pressed={pattern === 'half-drop'} onClick={() => setPattern('half-drop')}>B · Half-drop</button>
        </div>
        <p className="small muted" style={{ marginTop: '.3rem' }}>
          {pattern === 'grid'
            ? 'Rows line up straight across. Each row is centred so the left and right margins match.'
            : 'Every other column drops by half a row, like brickwork. The stack starts high enough that the dropped columns stay inside the usable band.'}
        </p>

        <h3 className="small muted" style={{ marginTop: '.6rem' }}>Colour</h3>
        <div className="row tight">
          <button className="chip" aria-pressed={colorMode === 'contrast'} onClick={() => setColorMode('contrast')}>Spread colours apart</button>
          <button className="chip" aria-pressed={colorMode === 'gradient'} onClick={() => setColorMode('gradient')}>Gradient</button>
        </div>
        <p className="small muted" style={{ marginTop: '.3rem' }}>
          {colorMode === 'contrast'
            ? 'Greedy pass then simulated annealing, maximising CIEDE2000 distance between neighbours — left, right, above, below and across each bracket.'
            : 'Serpentine run from dark to light by Lab lightness, then hue, alternating direction each row.'}
        </p>

        <div className="row" style={{ marginTop: '.7rem' }}>
          <button className="primary" disabled={busy || !measuredPairs.length} onClick={() => run(Date.now() & 0xffff)}>
            {busy ? 'Working…' : layout ? 'Regenerate' : 'Generate layout'}
          </button>
          <button disabled={busy || !layout} onClick={() => run((Math.random() * 65535) | 0)}>Shuffle</button>
          {layout ? (
            <button className="danger" onClick={() => { if (window.confirm('Discard the current layout?')) void setLayout(null); }}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {layout ? (
        <>
          <div className="card">
            <div className="card-head">
              <h3>Fit</h3>
              <span className="spacer" />
              <span className="pill">{layout.pattern === 'grid' ? 'straight grid' : 'half-drop'}</span>
              <span className="pill">{layout.colorMode === 'contrast' ? 'colours spread' : 'gradient'}</span>
            </div>

            {stale ? (
              <Notice kind="warn" title="Wall measurements changed">
                This layout was generated against different wall numbers. Regenerate so the install sheet matches the walls.
              </Notice>
            ) : null}

            <dl className="kv">
              <dt>Arm slots in this layout</dt><dd className="mono">{layout.slotCount}</dd>
              <dt>Brackets used</dt>
              <dd className="mono">
                {layout.bracketsUsed}
                {layout.bracketsOwned !== null ? ` of ${layout.bracketsOwned}` : ' (count not entered)'}
              </dd>
              <dt>Pairs placed</dt>
              <dd className="mono">
                {placedCount(layout)} of {eligiblePairs.length} available
                {eligiblePairs.length !== measuredPairs.length
                  ? ` (${measuredPairs.length - eligiblePairs.length} kept off on purpose)`
                  : ''}
              </dd>
              {slotsOwned !== null ? (
                <>
                  <dt>If every bracket were used</dt>
                  <dd className="mono">
                    {slotsOwned >= measuredPairs.length
                      ? `${slotsOwned - measuredPairs.length} more slot${slotsOwned - measuredPairs.length === 1 ? '' : 's'} than pairs`
                      : `${measuredPairs.length - slotsOwned} more pair${measuredPairs.length - slotsOwned === 1 ? '' : 's'} than slots`}
                  </dd>
                </>
              ) : null}
              {contrast ? (
                <>
                  <dt>Neighbour contrast</dt>
                  <dd className="mono">
                    worst ΔE00 {contrast.worst.toFixed(1)} · median {contrast.median.toFixed(1)} ({contrast.edges} neighbour pairs)
                  </dd>
                </>
              ) : null}
            </dl>

            {layout.notes.length ? (
              <Notice kind="info" title="Worth knowing">
                <ul>{layout.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </Notice>
            ) : null}

            {layout.walls.some((w) => w.warnings.length) ? (
              <Notice kind="warn" title="Fit warnings">
                <ul>
                  {layout.walls.flatMap((w) =>
                    w.warnings.map((x) => <li key={`${w.wallId}-${x}`}><strong>{w.wallName}:</strong> {x}</li>),
                  )}
                </ul>
              </Notice>
            ) : null}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Mockup</h3>
              <span className="spacer" />
              <Checkbox label="Measurement overlays" checked={showOverlay} onChange={setShowOverlay} />
            </div>
            <div className="row">
              <label className="field" style={{ maxWidth: 220 }}>
                <span className="lbl">Zoom <span className="unit">px per inch</span></span>
                <input type="range" min={1.5} max={10} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              </label>
              {highlightPairId ? (
                <span className="row tight">
                  <span className="pill warn">highlighting {byId.get(highlightPairId)?.name ?? 'pair'}</span>
                  <button className="sm ghost" onClick={clearHighlight}>Clear</button>
                </span>
              ) : null}
            </div>
            <p className="small muted">
              Tap a pair then tap another to swap them, or drag one onto another. Positions and the install sheet update
              straight away.
            </p>

            {layout.walls.map((wl) => (
              <div key={wl.wallId} style={{ marginBottom: '1rem' }}>
                <h4 className="small" style={{ marginBottom: '.3rem' }}>
                  {wl.wallName}{' '}
                  <span className="muted">
                    · {fmtIn(wl.widthIn, 0)} wide · {plural(wl.brackets.length, 'bracket')} · {plural(wl.rows.length, 'row')}
                  </span>
                </h4>
                <WallMockup
                  wall={wl}
                  pairs={pairs}
                  settings={settings}
                  showOverlay={showOverlay}
                  highlightPairId={highlightPairId}
                  onSwap={onSwap}
                  pxPerInch={zoom}
                />
              </div>
            ))}
            <p className="small muted">The wall colour is set in Settings.</p>
          </div>

          <LeaveOutCard
            layout={layout}
            pairs={pairs}
            excluded={excluded}
            setExcluded={setExcluded}
            onRegenerate={() => run(layout.seed)}
          />
        </>
      ) : (
        <div className="card">
          <p className="muted">No layout yet. Set the pattern and colour mode above, then generate.</p>
        </div>
      )}
    </>
  );
}

function LeaveOutCard({
  layout, pairs, excluded, setExcluded, onRegenerate,
}: {
  layout: Layout;
  pairs: Pair[];
  excluded: Set<string>;
  setExcluded: (s: Set<string>) => void;
  onRegenerate: () => void;
}) {
  const byId = new Map(pairs.map((p) => [p.id, p] as const));
  const unplaced = layout.unplacedPairIds.map((id) => byId.get(id)).filter((p): p is Pair => !!p);
  const measuredIds = pairs.filter((p) => p.measurement).map((p) => p.id);

  return (
    <div className="card">
      <h3>Who stays off the wall</h3>
      {unplaced.length ? (
        <Notice kind="warn" title={`${unplaced.length} measured pair${unplaced.length === 1 ? '' : 's'} did not fit`}>
          The generator ran out of band height, wall width or brackets. Tick pairs below to leave them out on purpose,
          then regenerate — that frees space for the ones you want up.
        </Notice>
      ) : (
        <p className="small muted">Everything measured and on the rack found a slot.</p>
      )}

      {unplaced.length ? (
        <div className="table-wrap" style={{ marginBottom: '.6rem' }}>
          <table>
            <thead><tr><th>Did not fit</th><th>Length</th><th>Height</th><th>Colours</th></tr></thead>
            <tbody>
              {unplaced.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="row tight" style={{ gap: '.5rem' }}>
                      <PairThumb pair={p} /><span>{p.name}</span>
                    </div>
                  </td>
                  <td className="mono">{fmtIn(p.measurement?.lengthIn)}</td>
                  <td className="mono">{fmtIn(p.measurement?.heightIn)}</td>
                  <td><Swatches colors={p.colors} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h4 className="small muted">Exclude from the layout</h4>
      <div className="row tight">
        {measuredIds.map((id) => {
          const p = byId.get(id)!;
          const on = excluded.has(id);
          return (
            <button
              key={id} className="chip" aria-pressed={on}
              onClick={() => {
                const next = new Set(excluded);
                if (on) next.delete(id); else next.add(id);
                setExcluded(next);
              }}
            >
              {on ? '✓ ' : ''}{p.name}
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: '.6rem' }}>
        <button onClick={onRegenerate} disabled={false}>Regenerate with these exclusions</button>
        {excluded.size ? <button className="ghost sm" onClick={() => setExcluded(new Set())}>Clear exclusions</button> : null}
        <span className="small muted">
          {excluded.size} excluded. Marking a pair “not on rack” in the catalog also keeps it off.
        </span>
      </div>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function placedCount(layout: Layout): number {
  const s = new Set<string>();
  for (const wl of layout.walls) {
    for (const b of wl.brackets) {
      if (b.leftPairId) s.add(b.leftPairId);
      if (b.rightPairId) s.add(b.rightPairId);
    }
  }
  return s.size;
}

/** Worst and median CIEDE2000 distance across every neighbour relation drawn. */
function contrastReport(layout: Layout, byId: Map<string, Pair>) {
  const ds: number[] = [];
  for (const wl of layout.walls) {
    const rows = new Map<number, typeof wl.brackets>();
    for (const b of wl.brackets) {
      const a = rows.get(b.rowIndex) ?? [];
      a.push(b);
      rows.set(b.rowIndex, a);
    }
    const seq = new Map<number, { id: string; x0: number; x1: number }[]>();
    for (const [r, bs] of rows) {
      const sorted = [...bs].sort((a, b) => a.colIndex - b.colIndex);
      const list: { id: string; x0: number; x1: number }[] = [];
      for (const b of sorted) {
        const mid = (b.extent.x0 + b.extent.x1) / 2;
        if (b.leftPairId) list.push({ id: b.leftPairId, x0: b.extent.x0, x1: mid });
        if (b.rightPairId) list.push({ id: b.rightPairId, x0: mid, x1: b.extent.x1 });
      }
      seq.set(r, list);
      for (let i = 0; i + 1 < list.length; i++) {
        ds.push(dist(list[i].id, list[i + 1].id, byId));
      }
    }
    const rowIdx = [...seq.keys()].sort((a, b) => a - b);
    for (let i = 0; i + 1 < rowIdx.length; i++) {
      for (const a of seq.get(rowIdx[i])!) {
        for (const b of seq.get(rowIdx[i + 1])!) {
          if (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.25) ds.push(dist(a.id, b.id, byId));
        }
      }
    }
  }
  if (!ds.length) return null;
  const sorted = [...ds].sort((a, b) => a - b);
  return {
    worst: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    edges: ds.length,
  };
}

function dist(a: string, b: string, byId: Map<string, Pair>): number {
  const pa = byId.get(a), pb = byId.get(b);
  if (!pa || !pb) return 0;
  return paletteDistance(pa.colors, pb.colors);
}
