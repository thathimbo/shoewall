import { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Pair } from '../types';
import { PairThumb } from '../components/PairThumb';
import { PairEditor } from '../components/PairEditor';
import { Notice, Swatches, fmtIn } from '../components/ui';

type SortKey = 'added' | 'name' | 'length' | 'height';

export function PairsTab({ onShowOnWall, goCapture }: { onShowOnWall: (id: string) => void; goCapture: () => void }) {
  const { pairs, settings } = useStore();
  const [editing, setEditing] = useState<Pair | null>(null);
  const [sort, setSort] = useState<SortKey>('added');

  const sorted = useMemo(() => {
    const list = [...pairs];
    switch (sort) {
      case 'name': return list.sort((a, b) => a.name.localeCompare(b.name));
      case 'length': return list.sort((a, b) => (b.measurement?.lengthIn ?? -1) - (a.measurement?.lengthIn ?? -1));
      case 'height': return list.sort((a, b) => (b.measurement?.heightIn ?? -1) - (a.measurement?.heightIn ?? -1));
      default: return list.sort((a, b) => b.createdAt - a.createdAt);
    }
  }, [pairs, sort]);

  const unmeasured = pairs.filter((p) => !p.measurement).length;
  const noColors = pairs.filter((p) => p.colors.length === 0).length;

  if (!pairs.length) {
    return (
      <div className="card">
        <h2>No pairs yet</h2>
        <p className="muted">Capture your first pair and it will show up here with its measurements and colours.</p>
        <button className="primary" onClick={goCapture}>Go to Capture</button>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Pairs <span className="muted small">({pairs.length})</span></h2>
          <span className="spacer" />
          <label className="field" style={{ width: 160 }}>
            <span className="lbl">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="added">Recently added</option>
              <option value="name">Name</option>
              <option value="length">Length</option>
              <option value="height">Height</option>
            </select>
          </label>
        </div>

        {unmeasured ? (
          <Notice kind="warn" title={`${unmeasured} pair${unmeasured === 1 ? '' : 's'} not measured`}>
            Pairs without measurements are left out of the layout. Capture them, or type the numbers in by editing them.
          </Notice>
        ) : null}
        {noColors ? (
          <Notice kind="warn" title={`${noColors} pair${noColors === 1 ? '' : 's'} with no colours`}>
            Colour spacing can only work on pairs that have at least one swatch.
          </Notice>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pair</th>
                <th className="nowrap">Length</th>
                <th className="nowrap">Height</th>
                <th>Class</th>
                <th>Colours</th>
                <th>Location</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="row tight" style={{ gap: '.5rem' }}>
                      <PairThumb pair={p} />
                      <span>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        {p.nickname ? <div className="small muted">{p.nickname}</div> : null}
                        {p.tags.length ? <div className="small muted">{p.tags.join(' · ')}</div> : null}
                      </span>
                    </div>
                  </td>
                  <td className="mono nowrap">{fmtIn(p.measurement?.lengthIn)}</td>
                  <td className="mono nowrap">{fmtIn(p.measurement?.heightIn)}</td>
                  <td>
                    {p.heightClass
                      ? <span className="pill">{p.heightClass}{p.heightClassManual ? ' (set)' : ''}</span>
                      : <span className="pill warn">—</span>}
                  </td>
                  <td><Swatches colors={p.colors} /></td>
                  <td className="small">
                    {p.wallLocation
                      ? <span className="nowrap">{p.wallLocation.wallName} · {p.wallLocation.bracketNumber}{p.wallLocation.arm === 'left' ? 'L' : 'R'}</span>
                      : <span className="muted">{p.status === 'not-on-rack' ? 'not on rack' : 'not placed'}</span>}
                  </td>
                  <td className="nowrap">
                    <button className="sm" onClick={() => setEditing(p)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {measured(pairs).length ? (
        <div className="card">
          <h3>Scale check</h3>
          <p className="small muted">
            Measured pairs span {fmtIn(Math.min(...measured(pairs).map((p) => p.measurement!.lengthIn)))} to{' '}
            {fmtIn(Math.max(...measured(pairs).map((p) => p.measurement!.lengthIn)))} long and{' '}
            {fmtIn(Math.min(...measured(pairs).map((p) => p.measurement!.heightIn)))} to{' '}
            {fmtIn(Math.max(...measured(pairs).map((p) => p.measurement!.heightIn)))} tall. A bracket holding the two
            longest pairs would be {fmtIn(widestBracket(pairs))} wide, against a {settings.hardware.bracketWidthIn}"
            bracket — so the shoes, not the iron, set the column spacing.
          </p>
        </div>
      ) : null}

      {editing ? (
        <PairEditor
          pair={pairs.find((p) => p.id === editing.id) ?? editing}
          onClose={() => setEditing(null)}
          onShowOnWall={onShowOnWall}
        />
      ) : null}
    </>
  );
}

const measured = (pairs: Pair[]) => pairs.filter((p) => p.measurement);

function widestBracket(pairs: Pair[]): number | null {
  const lens = measured(pairs).map((p) => p.measurement!.lengthIn).sort((a, b) => b - a);
  if (!lens.length) return null;
  return lens.length === 1 ? lens[0] * 2 : lens[0] + lens[1];
}
