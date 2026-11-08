import { useStore } from '../store';
import type { Wall } from '../types';
import { Notice, NumField, TextField, Checkbox, fmtIn } from '../components/ui';
import { usableXRange } from '../lib/layout';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `wall-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function WallsTab() {
  const { walls, saveWalls, settings, saveSettings } = useStore();

  const update = (i: number, patch: Partial<Wall>) =>
    saveWalls(walls.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  const blank = walls.filter((w) => w.bandBottomIn === null || w.bandTopIn === null);
  const cornerPairs = countCorners(walls);

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Walls <span className="muted small">({walls.length})</span></h2>
          <span className="spacer" />
          <button
            className="sm"
            onClick={() =>
              saveWalls([
                ...walls,
                {
                  id: uid(), name: `Wall ${walls.length + 1}`, widthIn: 150,
                  bandBottomIn: null, bandTopIn: null,
                  left: { isCorner: false, keepsClear: false },
                  right: { isCorner: false, keepsClear: false },
                },
              ])
            }
          >
            Add wall
          </button>
        </div>

        {blank.length ? (
          <Notice kind="warn" title="Band heights not entered">
            {blank.map((w) => w.name).join(', ')} {blank.length === 1 ? 'has' : 'have'} no usable band yet. The layout
            generator will not run until you measure and enter the bottom and top of the band you want shoes in —
            nothing is assumed.
          </Notice>
        ) : null}

        <div className="grid2">
          <NumField
            label="Brackets you own" unit={null} step={1} min={0} required
            value={settings.bracketCount}
            onChange={(v) => saveSettings({ ...settings, bracketCount: v })}
            hint="Each bracket holds 2 pairs. Leave blank and nothing is capped."
          />
          <NumField
            label="Corner clearance" step={0.5} min={0}
            value={settings.spacing.cornerClearanceIn}
            onChange={(v) => v !== null && saveSettings({ ...settings, spacing: { ...settings.spacing, cornerClearanceIn: v } })}
            hint="Kept clear by whichever wall yields at a shared corner."
          />
        </div>
        {settings.bracketCount !== null ? (
          <p className="small muted" style={{ marginTop: '.4rem' }}>
            {settings.bracketCount} brackets = {settings.bracketCount * 2} arm slots.
          </p>
        ) : null}
      </div>

      {walls.map((w, i) => {
        const ux = usableXRange(w, settings);
        const bandH = w.bandBottomIn !== null && w.bandTopIn !== null ? w.bandTopIn - w.bandBottomIn : null;
        return (
          <div className="card" key={w.id}>
            <div className="card-head">
              <h3>{w.name || `Wall ${i + 1}`}</h3>
              <span className="spacer" />
              {walls.length > 1 ? (
                <button
                  className="sm danger"
                  onClick={() => {
                    if (window.confirm(`Remove ${w.name}?`)) saveWalls(walls.filter((_, j) => j !== i));
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>

            <div className="grid2">
              <TextField label="Name" value={w.name} onChange={(v) => update(i, { name: v })} />
              <NumField
                label="Wall width" value={w.widthIn} step={1} min={1}
                onChange={(v) => v !== null && update(i, { widthIn: v })}
              />
              <NumField
                label="Usable band — bottom" value={w.bandBottomIn} step={1} min={0} required
                onChange={(v) => update(i, { bandBottomIn: v })}
                hint="Inches from the floor to the lowest point a shoe may reach."
              />
              <NumField
                label="Usable band — top" value={w.bandTopIn} step={1} min={0} required
                onChange={(v) => update(i, { bandTopIn: v })}
                hint="Inches from the floor to the highest point a shoe may reach."
              />
            </div>

            {bandH !== null && bandH <= 0 ? (
              <Notice kind="bad">The top of the band must be above the bottom.</Notice>
            ) : null}

            <div className="grid2" style={{ marginTop: '.5rem' }}>
              <EndEditor
                title="Left end" end={w.left}
                onChange={(e) => update(i, { left: e })}
                otherWalls={walls.filter((_, j) => j !== i).map((x) => x.name)}
              />
              <EndEditor
                title="Right end" end={w.right}
                onChange={(e) => update(i, { right: e })}
                otherWalls={walls.filter((_, j) => j !== i).map((x) => x.name)}
              />
            </div>

            <dl className="kv" style={{ marginTop: '.6rem' }}>
              <dt>Usable width</dt>
              <dd className="mono">
                {fmtIn(ux.x1 - ux.x0)} ({fmtIn(ux.x0)} → {fmtIn(ux.x1)} from the left edge)
              </dd>
              <dt>Usable height</dt>
              <dd className="mono">{bandH === null ? <span className="pill warn">not entered</span> : fmtIn(bandH)}</dd>
            </dl>
          </div>
        );
      })}

      <div className="card">
        <h3>Corners</h3>
        {cornerPairs.marked === 0 ? (
          <p className="small muted">No ends marked as corners. Mark an end a corner where two of these walls meet.</p>
        ) : (
          <>
            <p className="small muted">
              {cornerPairs.marked} end{cornerPairs.marked === 1 ? '' : 's'} marked as a corner;{' '}
              {cornerPairs.yielding} of those keep{cornerPairs.yielding === 1 ? 's' : ''} {settings.spacing.cornerClearanceIn}" clear.
            </p>
            {cornerPairs.marked > 0 && cornerPairs.yielding === 0 ? (
              <Notice kind="warn">
                No wall is yielding at any corner, so shoes from both walls will run right into the corner. Tick
                “this wall keeps the clearance” on one side of each shared corner.
              </Notice>
            ) : null}
            {cornerPairs.marked % 2 === 1 ? (
              <Notice kind="warn">
                An odd number of corner ends is marked. A shared corner normally shows up on two walls — check you have
                marked both sides.
              </Notice>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function EndEditor({
  title, end, onChange, otherWalls,
}: {
  title: string;
  end: Wall['left'];
  onChange: (e: Wall['left']) => void;
  otherWalls: string[];
}) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '.5rem' }}>
      <div className="small muted" style={{ marginBottom: '.2rem' }}>{title}</div>
      <Checkbox
        label="Corner shared with another wall"
        checked={end.isCorner}
        onChange={(v) => onChange({ isCorner: v, keepsClear: v ? end.keepsClear : false })}
      />
      <Checkbox
        label="This wall keeps the clearance clear"
        checked={end.keepsClear}
        disabled={!end.isCorner}
        onChange={(v) => onChange({ ...end, keepsClear: v })}
      />
      {end.isCorner && !end.keepsClear && otherWalls.length ? (
        <p className="small muted" style={{ margin: '.2rem 0 0' }}>
          The other wall at this corner yields instead — tick it there.
        </p>
      ) : null}
    </div>
  );
}

function countCorners(walls: Wall[]) {
  let marked = 0, yielding = 0;
  for (const w of walls) {
    for (const e of [w.left, w.right]) {
      if (e.isCorner) { marked++; if (e.keepsClear) yielding++; }
    }
  }
  return { marked, yielding };
}
