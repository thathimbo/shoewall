import { useStore } from '../store';
import { Notice, fmtIn } from '../components/ui';
import { installSheetCsv, TOGGLE_ANCHOR_NOTE } from '../lib/exports';
import { downloadText, slug } from '../lib/csv';

export function InstallTab({ goLayout, goSettings }: { goLayout: () => void; goSettings: () => void }) {
  const { layout, pairs, settings } = useStore();
  const byId = new Map(pairs.map((p) => [p.id, p] as const));

  if (!layout) {
    return (
      <div className="card">
        <h2>No layout yet</h2>
        <p className="muted">Generate a layout and the install sheet will be built from it.</p>
        <button className="primary" onClick={goLayout}>Go to Layout</button>
      </div>
    );
  }

  const plateMissing = settings.hardware.plateToArmTopIn === null;
  const label = (id: string | null) => {
    if (!id) return <span className="muted">(empty)</span>;
    const p = byId.get(id);
    if (!p) return <span className="muted">(missing pair)</span>;
    return (
      <>
        {p.name}
        {p.nickname ? <span className="muted small"> · {p.nickname}</span> : null}
      </>
    );
  };

  return (
    <>
      <div className="card no-print">
        <div className="card-head">
          <h2>Install sheets</h2>
          <span className="spacer" />
          <button className="sm" onClick={() => window.print()}>Print</button>
          <button
            className="sm"
            onClick={() => downloadText(`shoewall-install-${slug(new Date().toISOString().slice(0, 10))}.csv`, installSheetCsv(layout, pairs, settings))}
          >
            Export CSV
          </button>
        </div>
        {plateMissing ? (
          <Notice kind="bad" title="Plate heights are blank">
            The vertical offset from the mounting-plate centre to the top of the arms has not been measured, so the
            plate Y column cannot be filled in. Measure your bracket and enter it in Settings — the X positions and
            arm-top heights below are correct either way.
            <div><button className="sm" style={{ marginTop: '.4rem' }} onClick={goSettings}>Open Settings</button></div>
          </Notice>
        ) : null}
        <p className="small muted">
          Pattern: {layout.pattern === 'grid' ? 'straight grid' : 'half-drop'} · generated{' '}
          {new Date(layout.generatedAt).toLocaleString()} · {layout.bracketsUsed} brackets
        </p>
      </div>

      <div className="card">
        <Notice kind="warn" title="Anchors">{TOGGLE_ANCHOR_NOTE}</Notice>
        <p className="small muted">
          X is measured from the left edge of each wall; Y from the floor. Both refer to the centre of the{' '}
          {settings.hardware.plateSizeIn}" × {settings.hardware.plateSizeIn}" mounting plate. Heels face the bracket
          centre, so the left-arm pair's toe points left and the right-arm pair's toe points right.
        </p>
      </div>

      {layout.walls.map((wl, i) => (
        <div className={`card${i > 0 ? ' print-break' : ''}`} key={wl.wallId}>
          <h3>
            {wl.wallName}
            <span className="muted small">
              {' '}· {fmtIn(wl.widthIn, 0)} wide · band {fmtIn(wl.usableY.y0, 0)}–{fmtIn(wl.usableY.y1, 0)} ·{' '}
              {wl.brackets.length} brackets
            </span>
          </h3>
          {wl.usableX.x0 > 0 || wl.usableX.x1 < wl.widthIn ? (
            <p className="small muted">
              Corner clearance in effect: usable width runs {fmtIn(wl.usableX.x0)} to {fmtIn(wl.usableX.x1)} from the
              left edge.
            </p>
          ) : null}
          {wl.warnings.length ? (
            <Notice kind="warn" title="Check these before drilling">
              <ul>{wl.warnings.map((x) => <li key={x}>{x}</li>)}</ul>
            </Notice>
          ) : null}

          {!wl.brackets.length ? (
            <p className="muted small">No brackets on this wall.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Row</th>
                    <th className="nowrap">Plate X</th>
                    <th className="nowrap">Plate Y</th>
                    <th className="nowrap">Arm top Y</th>
                    <th>Left arm (toe points left)</th>
                    <th>Right arm (toe points right)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...wl.brackets].sort((a, b) => a.number - b.number).map((b) => (
                    <tr key={b.number}>
                      <td className="mono"><strong>{b.number}</strong></td>
                      <td className="mono">{b.rowIndex + 1}</td>
                      <td className="mono nowrap">{b.plateXIn.toFixed(2)}"</td>
                      <td className="mono nowrap">
                        {b.plateYIn === null
                          ? <span className="pill bad">not measured</span>
                          : `${b.plateYIn.toFixed(2)}"`}
                      </td>
                      <td className="mono nowrap">{b.armTopYIn.toFixed(2)}"</td>
                      <td>{label(b.leftPairId)}</td>
                      <td>{label(b.rightPairId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      <div className="card">
        <h3>Hardware used for these numbers</h3>
        <dl className="kv">
          <dt>Bracket width</dt><dd className="mono">{fmtIn(settings.hardware.bracketWidthIn)}</dd>
          <dt>Arm depth</dt><dd className="mono">{fmtIn(settings.hardware.armDepthIn)}</dd>
          <dt>Mounting plate</dt><dd className="mono">{fmtIn(settings.hardware.plateSizeIn)} square</dd>
          <dt>Plate centre → arm top</dt>
          <dd className="mono">
            {settings.hardware.plateToArmTopIn === null
              ? <span className="pill bad">not measured</span>
              : fmtIn(settings.hardware.plateToArmTopIn)}
          </dd>
          <dt>Heel inset from centre</dt><dd className="mono">{fmtIn(settings.hardware.heelInsetFromCenterIn)}</dd>
          <dt>Gap between the two shoes of a pair</dt><dd className="mono">{fmtIn(settings.hardware.pairGapIn)}</dd>
          <dt>Toe gap between columns</dt><dd className="mono">{fmtIn(settings.spacing.toeGapIn)}</dd>
          <dt>Row gap</dt><dd className="mono">{fmtIn(settings.spacing.rowGapIn)}</dd>
          <dt>Corner clearance</dt><dd className="mono">{fmtIn(settings.spacing.cornerClearanceIn)}</dd>
        </dl>
      </div>
    </>
  );
}
