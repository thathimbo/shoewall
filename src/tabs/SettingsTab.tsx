import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Notice, NumField, TextField, SelectField, fmtIn } from '../components/ui';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import { buildProjectFile, parseProjectFile } from '../lib/exports';
import { downloadBlob } from '../lib/csv';
import { getAllImages, estimateUsage } from '../lib/db';
import { OPENCV_URL } from '../lib/opencv';

const PAPERS = [
  { value: 'letter', label: 'US Letter — 8.5" × 11"', w: 8.5, h: 11 },
  { value: 'legal', label: 'US Legal — 8.5" × 14"', w: 8.5, h: 14 },
  { value: 'a4', label: 'A4 — 8.27" × 11.69"', w: 8.27, h: 11.69 },
  { value: 'custom', label: 'Custom', w: 0, h: 0 },
];

export function SettingsTab() {
  const { settings, saveSettings, walls, pairs, layout, replaceAll, wipe } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => { void estimateUsage().then(setUsage); }, [pairs.length]);

  const hw = settings.hardware;
  const setHw = (patch: Partial<typeof hw>) => saveSettings({ ...settings, hardware: { ...hw, ...patch } });

  const paperKey =
    PAPERS.find((p) => p.w === settings.paper.widthIn && p.h === settings.paper.heightIn)?.value ?? 'custom';

  const doExport = async () => {
    setBusy('Building the backup…'); setError(null); setDone(null);
    try {
      const images = await getAllImages();
      const file = await buildProjectFile(settings, walls, pairs, layout, images);
      const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
      downloadBlob(`shoewall-project-${new Date().toISOString().slice(0, 10)}.json`, blob);
      setDone(`Exported ${count(pairs.length, 'pair')} and ${count(images.length, 'image')} (${fmtBytes(blob.size)}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  };

  const doImport = async (file: File) => {
    if (!window.confirm('Importing replaces everything currently stored in this browser. Continue?')) return;
    setBusy('Reading the project file…'); setError(null); setDone(null);
    try {
      const parsed = await parseProjectFile(await file.text());
      await replaceAll(parsed);
      setDone(
        `Imported ${count(parsed.pairs.length, 'pair')}, ${count(parsed.walls.length, 'wall')} and ${count(parsed.images.length, 'image')}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(null); }
  };

  return (
    <>
      {error ? <Notice kind="bad" title="That did not work">{error}</Notice> : null}
      {done ? <Notice kind="good">{done}</Notice> : null}
      {busy ? <Notice kind="info">{busy}</Notice> : null}

      <div className="card">
        <h2>Bracket hardware</h2>
        <p className="small muted">
          Every number here is editable because it comes off your actual brackets. Measure rather than trust a
          product listing.
        </p>
        {hw.plateToArmTopIn === null ? (
          <Notice kind="warn" title="One measurement still missing">
            The vertical offset from the mounting-plate centre to the top of the arms. Without it the install sheet
            cannot give plate heights. Hold a tape against one bracket: plate centre up to the top face of the arms.
          </Notice>
        ) : null}
        <div className="grid2">
          <NumField label="Bracket width" value={hw.bracketWidthIn} step={0.25} min={1}
            onChange={(v) => v !== null && setHw({ bracketWidthIn: v })}
            hint="Overall width of the U." />
          <NumField label="Arm depth (off the wall)" value={hw.armDepthIn} step={0.25} min={0}
            onChange={(v) => v !== null && setHw({ armDepthIn: v })}
            hint="Recorded for reference; the mockup is a flat elevation." />
          <NumField label="Mounting plate (square)" value={hw.plateSizeIn} step={0.25} min={0.25}
            onChange={(v) => v !== null && setHw({ plateSizeIn: v })} />
          <NumField label="Plate centre → top of arms" value={hw.plateToArmTopIn} step={0.125} required
            onChange={(v) => setHw({ plateToArmTopIn: v })}
            hint="Measure this one. Install-sheet Y heights depend on it." />
          <NumField label="Heel inset from bracket centre" value={hw.heelInsetFromCenterIn} step={0.125} min={0}
            onChange={(v) => v !== null && setHw({ heelInsetFromCenterIn: v })}
            hint="0 means the two heels meet at the centre." />
          <NumField label="Gap between the two shoes of a pair" value={hw.pairGapIn} step={0.125} min={0}
            onChange={(v) => v !== null && setHw({ pairGapIn: v })}
            hint="Usually the thickness of the arm bar. 0 mirrors them tight against it." />
        </div>
        <p className="small muted" style={{ marginTop: '.5rem' }}>
          Loaded bracket size is worked out from these plus each pair's measurements — nothing is hard-coded.
        </p>
      </div>

      <div className="card">
        <h2>Spacing</h2>
        <div className="grid2">
          <NumField label="Between toes of neighbouring columns" value={settings.spacing.toeGapIn} step={0.125} min={0}
            onChange={(v) => v !== null && saveSettings({ ...settings, spacing: { ...settings.spacing, toeGapIn: v } })} />
          <NumField label="Between rows" value={settings.spacing.rowGapIn} step={0.125} min={0}
            onChange={(v) => v !== null && saveSettings({ ...settings, spacing: { ...settings.spacing, rowGapIn: v } })} />
          <NumField label="Corner clearance" value={settings.spacing.cornerClearanceIn} step={0.5} min={0}
            onChange={(v) => v !== null && saveSettings({ ...settings, spacing: { ...settings.spacing, cornerClearanceIn: v } })} />
          <NumField label="Brackets you own" unit={null} value={settings.bracketCount} step={1} min={0} required
            onChange={(v) => saveSettings({ ...settings, bracketCount: v })} />
        </div>
      </div>

      <div className="card">
        <h2>Capture</h2>
        <SelectField
          label="Reference target used for scale"
          value={paperKey}
          options={PAPERS.map((p) => ({ value: p.value, label: p.label }))}
          onChange={(v) => {
            const p = PAPERS.find((x) => x.value === v)!;
            if (p.value === 'custom') return;
            saveSettings({ ...settings, paper: { widthIn: p.w, heightIn: p.h, label: p.label.split(' —')[0] } });
          }}
        />
        <GridfinityHelper
          onApply={(widthIn, heightIn, label) =>
            saveSettings({ ...settings, paper: { widthIn, heightIn, label } })
          }
        />

        <div className="grid2" style={{ marginTop: '.5rem' }}>
          <NumField label="Target width" value={settings.paper.widthIn} step={0.01} min={1}
            onChange={(v) => v !== null && saveSettings({ ...settings, paper: { ...settings.paper, widthIn: v } })} />
          <NumField label="Target height" value={settings.paper.heightIn} step={0.01} min={1}
            onChange={(v) => v !== null && saveSettings({ ...settings, paper: { ...settings.paper, heightIn: v } })} />
          <TextField label="Target name" value={settings.paper.label}
            onChange={(v) => saveSettings({ ...settings, paper: { ...settings.paper, label: v } })} />
        </div>

        <h3 className="small muted" style={{ marginTop: '.7rem' }}>Height-class cut-offs</h3>
        <p className="small muted">
          These describe the buckets, not any shoe. Anything above the mid cut-off is treated as a high-top and the
          generator keeps high-tops together, low down.
        </p>
        <div className="grid2">
          <NumField label="Low is up to" value={settings.heightClass.lowMaxIn} step={0.25} min={0}
            onChange={(v) => v !== null && saveSettings({ ...settings, heightClass: { ...settings.heightClass, lowMaxIn: v } })} />
          <NumField label="Mid is up to" value={settings.heightClass.midMaxIn} step={0.25} min={0}
            onChange={(v) => v !== null && saveSettings({ ...settings, heightClass: { ...settings.heightClass, midMaxIn: v } })} />
        </div>
      </div>

      <div className="card">
        <h2>Mockup</h2>
        <label className="field" style={{ maxWidth: 220 }}>
          <span className="lbl">Wall colour</span>
          <input type="color" value={settings.wallColorHex}
            onChange={(e) => saveSettings({ ...settings, wallColorHex: e.target.value })} />
        </label>
      </div>

      <div className="card">
        <h2>Backup</h2>
        <p className="small muted">
          Everything lives in this browser's IndexedDB. Clearing site data wipes it, so export a backup before you
          reset anything or switch devices. The JSON holds every catalog field and every photo.
        </p>
        <div className="row">
          <button className="primary" onClick={doExport} disabled={!!busy}>Export project JSON</button>
          <label className="btn">
            Import project JSON
            <input className="visually-hidden" type="file" accept="application/json,.json"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doImport(f); }} />
          </label>
        </div>
        {usage ? (
          <p className="small muted" style={{ marginTop: '.5rem' }}>
            Browser storage: {fmtBytes(usage.usage)} used
            {usage.quota ? ` of about ${fmtBytes(usage.quota)} available` : ''}.
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2>Reset</h2>
        <div className="row">
          <button onClick={() => {
            if (window.confirm('Reset hardware, spacing, capture and mockup settings to their starting values? Pairs and walls are untouched.')) {
              saveSettings({ ...DEFAULT_SETTINGS, bracketCount: settings.bracketCount });
            }
          }}>
            Reset settings only
          </button>
          <button className="danger" onClick={async () => {
            if (window.confirm('Delete every pair, photo, wall and layout in this browser? Export a backup first — this cannot be undone.')) {
              if (window.confirm('Really delete everything?')) { await wipe(); setDone('Everything cleared.'); }
            }
          }}>
            Delete everything
          </button>
        </div>
      </div>

      <div className="card">
        <h2>About</h2>
        <dl className="kv">
          <dt>Pairs</dt><dd className="mono">{pairs.length}</dd>
          <dt>Walls</dt><dd className="mono">{walls.length}</dd>
          <dt>Saved layout</dt>
          <dd className="mono">{layout ? `${layout.bracketsUsed} brackets` : 'none'}</dd>
          <dt>Widest loaded bracket</dt>
          <dd className="mono">{fmtIn(widestLoaded(pairs, hw.heelInsetFromCenterIn))}</dd>
          <dt>OpenCV.js</dt><dd className="mono small">{OPENCV_URL}</dd>
        </dl>
        <p className="small muted">
          Runs entirely in the browser: no server, no account, nothing uploaded. OpenCV.js, the background-removal
          model and the OCR language data are fetched on first use and then cached by the browser.
        </p>
      </div>
    </>
  );
}

/**
 * Gridfinity baseplates make a far better reference target than a blank sheet:
 * the size is exact, it is rigid, and it does not curl. The grid pitch is 42 mm
 * by the Gridfinity standard, but it is editable in case a plate was printed to
 * something else. Butt two plates together and count the cells across the pair.
 */
function GridfinityHelper({
  onApply,
}: { onApply: (widthIn: number, heightIn: number, label: string) => void }) {
  const [across, setAcross] = useState<number | null>(null);
  const [down, setDown] = useState<number | null>(null);
  const [pitchMm, setPitchMm] = useState<number | null>(42);

  const ok = across !== null && down !== null && pitchMm !== null && across > 0 && down > 0 && pitchMm > 0;
  const widthIn = ok ? (across * pitchMm) / 25.4 : null;
  const heightIn = ok ? (down * pitchMm) / 25.4 : null;

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '.6rem', marginTop: '.6rem' }}>
      <h4 className="small" style={{ margin: '0 0 .3rem' }}>Using Gridfinity baseplates?</h4>
      <p className="small muted" style={{ margin: '0 0 .5rem' }}>
        Count the cells across the whole arrangement, including both plates if you have butted two together.
      </p>
      <div className="grid3">
        <NumField label="Cells across" unit={null} step={1} min={1} value={across} onChange={setAcross} />
        <NumField label="Cells down" unit={null} step={1} min={1} value={down} onChange={setDown} />
        <NumField label="Grid pitch" unit="mm" step={0.5} min={1} value={pitchMm} onChange={setPitchMm} />
      </div>
      <div className="row" style={{ marginTop: '.5rem' }}>
        <button
          className="sm"
          disabled={!ok}
          onClick={() => onApply(widthIn!, heightIn!, `Gridfinity ${across}×${down}`)}
        >
          Use as the target
        </button>
        <span className="small mono muted">
          {ok ? `${widthIn!.toFixed(2)}" × ${heightIn!.toFixed(2)}"` : 'fill all three'}
        </span>
      </div>
    </div>
  );
}

function widestLoaded(pairs: { measurement: { lengthIn: number } | null }[], heelInset: number): number | null {
  const lens = pairs.map((p) => p.measurement?.lengthIn).filter((x): x is number => typeof x === 'number').sort((a, b) => b - a);
  if (!lens.length) return null;
  return (lens[0] + (lens[1] ?? lens[0])) + 2 * heelInset;
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} kB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
