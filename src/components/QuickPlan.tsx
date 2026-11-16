import { useState } from 'react';
import type { Pair, Wall } from '../types';
import { useStore } from '../store';
import { generateLayout } from '../lib/layout';
import { classifyHeight } from '../lib/defaults';
import { Notice, NumField } from './ui';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `qp-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * Builds a whole plan from a handful of typed numbers, with no photos at all.
 *
 * The photo pipeline exists to get each pair's real silhouette for the mockup.
 * None of that is needed to work out where the brackets go — that follows from
 * a typical shoe size, the wall, and how many brackets there are. This gets a
 * drillable install sheet in about a minute, and the catalog can be filled in
 * later without the bracket positions changing.
 */
export function QuickPlan({ onDone }: { onDone: () => void }) {
  const { pairs, settings, saveSettings, saveWalls, savePairs, setLayout } = useStore();

  const [pairCount, setPairCount] = useState<number | null>(null);
  // Starting guesses, clearly labelled as such. Everything scales from the
  // first two, so one pass with a tape measure corrects the whole plan.
  const [lengthIn, setLengthIn] = useState<number | null>(13.5);
  const [heightIn, setHeightIn] = useState<number | null>(5);
  const [highTops, setHighTops] = useState<number | null>(0);
  const [highTopHeightIn, setHighTopHeightIn] = useState<number | null>(7);
  const [wallCount, setWallCount] = useState<number | null>(3);
  const [wallWidthIn, setWallWidthIn] = useState<number | null>(150);
  const [bandBottomIn, setBandBottomIn] = useState<number | null>(null);
  const [bandTopIn, setBandTopIn] = useState<number | null>(null);
  const [brackets, setBrackets] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ready =
    pairCount !== null && pairCount > 0 &&
    lengthIn !== null && lengthIn > 0 &&
    heightIn !== null && heightIn > 0 &&
    wallCount !== null && wallCount > 0 &&
    wallWidthIn !== null && wallWidthIn > 0 &&
    bandBottomIn !== null && bandTopIn !== null && bandTopIn > bandBottomIn &&
    brackets !== null && brackets > 0;

  const build = async () => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const nHigh = Math.min(highTops ?? 0, pairCount);
      const made: Pair[] = [];
      for (let i = 0; i < pairCount; i++) {
        const isHigh = i < nHigh;
        const h = isHigh ? (highTopHeightIn ?? heightIn) : heightIn;
        made.push({
          id: uid(),
          name: `Pair ${String(i + 1).padStart(2, '0')}`,
          tags: ['placeholder'],
          measurement: {
            lengthIn, heightIn: h, ppi: 0,
            source: 'typed',
            adjustedByHand: false,
          },
          heightClass: classifyHeight(h, settings.heightClass),
          heightClassManual: false,
          colors: [],
          cutoutImageId: null, photoImageId: null, extraImageIds: [], tagImageIds: [],
          status: 'in-storage', wallLocation: null, wearLog: [],
          createdAt: Date.now() + i, updatedAt: Date.now() + i,
        });
      }

      const newWalls: Wall[] = Array.from({ length: wallCount }, (_, i) => ({
        id: `qp-wall-${i + 1}`,
        name: `Wall ${i + 1}`,
        widthIn: wallWidthIn,
        bandBottomIn, bandTopIn,
        // Treat the run as a continuous set: each wall meets the next at a
        // corner, and the later wall yields so the shoes do not collide.
        left: { isCorner: i > 0, keepsClear: i > 0 },
        right: { isCorner: i < wallCount - 1, keepsClear: false },
      }));

      const nextSettings = { ...settings, bracketCount: brackets };
      await saveSettings(nextSettings);
      await saveWalls(newWalls);
      await savePairs(made);

      const res = generateLayout({
        pairs: made, walls: newWalls, settings: nextSettings,
        pattern: 'grid', colorMode: 'contrast', excludedPairIds: [], seed: 1,
        // Placeholders carry no colours, so there is nothing for the colour
        // solver to do. Skip it rather than burn time shuffling identical pairs.
        annealIterations: 0,
      });
      if (!res.layout) {
        setProblem(res.blockers.join(' '));
        return;
      }
      await setLayout(res.layout);
      onDone();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Quick plan — no photos</h2>
      <p className="small muted">
        Enough to go and drill. Type the numbers, get an install sheet. Photos and the catalog can come later without
        moving a single bracket.
      </p>

      {pairs.length ? (
        <Notice kind="warn" title={`This replaces your ${pairs.length} existing pair${pairs.length === 1 ? '' : 's'} and walls`}>
          Export a backup from Settings first if you want to keep them.
        </Notice>
      ) : null}

      <h3 className="small muted" style={{ marginTop: '.6rem' }}>Your shoes</h3>
      <div className="grid2">
        <NumField label="How many pairs go on the wall" unit={null} step={1} min={1} required
          value={pairCount} onChange={setPairCount} />
        <NumField label="Typical length, heel to toe" step={0.25} min={1}
          value={lengthIn} onChange={setLengthIn}
          hint="A starting guess. Measure one pair and correct it — the whole plan scales from this." />
        <NumField label="Typical height, sole to collar" step={0.25} min={1}
          value={heightIn} onChange={setHeightIn}
          hint="Also a guess. Low and mid tops." />
        <NumField label="How many are high-tops" unit={null} step={1} min={0}
          value={highTops} onChange={setHighTops}
          hint="They get their own rows, at the bottom. 0 if you are not sure." />
        <NumField label="High-top height" step={0.25} min={1}
          value={highTopHeightIn} onChange={setHighTopHeightIn} />
      </div>

      <h3 className="small muted" style={{ marginTop: '.7rem' }}>Your walls</h3>
      <div className="grid2">
        <NumField label="How many walls" unit={null} step={1} min={1}
          value={wallCount} onChange={setWallCount} />
        <NumField label="Width of each" step={1} min={12}
          value={wallWidthIn} onChange={setWallWidthIn}
          hint={'150" is 12 ft 6 in. The same width is used for all of them.'} />
        <NumField label="Lowest a shoe may hang" step={1} min={0} required
          value={bandBottomIn} onChange={setBandBottomIn}
          hint="Inches from the floor. Clear your furniture." />
        <NumField label="Highest a shoe may reach" step={1} min={0} required
          value={bandTopIn} onChange={setBandTopIn}
          hint="Inches from the floor. The pattern hangs from this line." />
        <NumField label="Brackets you own" unit={null} step={1} min={1} required
          value={brackets} onChange={setBrackets}
          hint="Each holds 2 pairs." />
      </div>

      {problem ? <Notice kind="bad" title="Could not build it">{problem}</Notice> : null}

      <div className="row" style={{ marginTop: '.7rem' }}>
        <button className="primary" disabled={!ready || busy} onClick={build}>
          {busy ? 'Building…' : 'Build the plan'}
        </button>
        <span className="small muted">
          {ready
            ? `${pairCount} pairs · ${Math.ceil((pairCount ?? 0) / 2)} brackets needed · you have ${brackets}`
            : 'Fill in the marked fields'}
        </span>
      </div>

      <p className="small muted" style={{ marginTop: '.5rem' }}>
        Pairs are created as placeholders named Pair 01 upward, tagged <span className="mono">placeholder</span>.
        Rename them, photograph them, and correct sizes whenever you like — regenerate afterwards and the sheet
        updates. Colour spacing does nothing until pairs have colours, so this plan is laid out by size alone.
      </p>
    </div>
  );
}
