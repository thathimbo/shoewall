import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Pair, Swatch } from '../types';
import { useStore } from '../store';
import { classifyHeight } from '../lib/defaults';
import { fileToImageData, imageDataToBlob, downscale } from '../lib/image';
import { detectPaper, correctPerspective, PaperNotFoundError, PAPER_SCORE_FLOOR, type PaperDetection, type Pt } from '../lib/paper';
import {
  removeBackground, largestAlphaComponent, suggestHandles, measureFromHandles,
  buildCutout, cropToHandles, dominantColors, BackgroundRemovalError,
  type Handles, type MaskStats,
} from '../lib/cutout';
import { PointStage, type StagePoint } from '../components/PointStage';
import { Notice, NumField, TextField, Checkbox, Progress, SelectField, fmtIn } from '../components/ui';

type Stage = 'pick' | 'working' | 'quad' | 'confirm';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

interface WorkingState {
  source: ImageData;
  detection: PaperDetection | null;
  correctedUrl: string | null;
  /** Background-removed version of the corrected image, if it worked. */
  cutRgba: ImageData | null;
  cutUrl: string | null;
  mask: MaskStats | null;
  handles: Handles;
  handlesTouched: boolean;
  ppiOverride: number | null;
  bgFailed: string | null;
}

export function CaptureTab({ onSaved }: { onSaved: (pairId: string) => void }) {
  const { settings, addImage, savePair } = useStore();
  const [stage, setStage] = useState<Stage>('pick');
  const [status, setStatus] = useState<{ msg: string; frac: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paperWarning, setPaperWarning] = useState<string | null>(null);
  const [w, setW] = useState<WorkingState | null>(null);
  const [src, setSrc] = useState<{ data: ImageData; url: string } | null>(null);
  const [quad, setQuad] = useState<[Pt, Pt, Pt, Pt] | null>(null);
  const [showCutout, setShowCutout] = useState(true);

  // Draft pair fields
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [colors, setColors] = useState<Swatch[]>([]);
  const [classOverride, setClassOverride] = useState<'auto' | 'low' | 'mid' | 'high'>('auto');

  const urls = useRef<string[]>([]);
  const track = (u: string) => { urls.current.push(u); return u; };
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL); }, []);

  const reset = useCallback(() => {
    urls.current.forEach(URL.revokeObjectURL);
    urls.current = [];
    setW(null); setSrc(null); setQuad(null); setStage('pick'); setStatus(null); setError(null);
    setPaperWarning(null); setName(''); setNickname(''); setTagsText('');
    setColors([]); setClassOverride('auto'); setShowCutout(true);
  }, []);

  const runPipeline = useCallback(
    async (source: ImageData, forcedQuad?: [Pt, Pt, Pt, Pt]) => {
      setStage('working');
      setError(null);
      setPaperWarning(null);
      try {
        setStatus({ msg: 'Loading OpenCV.js…', frac: 0.05 });
        let detected: [Pt, Pt, Pt, Pt];
        let score: number | null = null;
        if (forcedQuad) {
          detected = forcedQuad;
        } else {
          setStatus({ msg: 'Looking for the sheet of paper…', frac: 0.15 });
          const cand = await detectPaper(source, settings.paper);
          detected = cand.quad;
          score = cand.score;
        }

        setStatus({ msg: 'Correcting perspective…', frac: 0.3 });
        const detection = await correctPerspective(source, detected, settings.paper, { detectionScore: score });
        const correctedUrl = track(URL.createObjectURL(await imageDataToBlob(detection.corrected)));

        const marginal = score !== null && score < PAPER_SCORE_FLOOR + 0.15;
        if (detection.confidence < 0.8 || marginal) {
          setPaperWarning(
            [
              marginal
                ? `The detector was only ${Math.round(score! * 100)}% confident this shape is the sheet.`
                : null,
              detection.confidence < 0.8
                ? `The shape it picked is only ${Math.round(detection.confidence * 100)}% rectangular.`
                : null,
              'Check the dashed outline below against the real sheet. If it is wrong, start over and place the corners by hand.',
            ].filter(Boolean).join(' '),
          );
        }

        setStatus({ msg: 'Removing the background…', frac: 0.45 });
        let cutRgba: ImageData | null = null;
        let bgFailed: string | null = null;
        try {
          cutRgba = await removeBackground(detection.corrected, (key, f) =>
            setStatus({ msg: `Removing the background (${key})…`, frac: 0.45 + f * 0.4 }),
          );
        } catch (err) {
          bgFailed = err instanceof BackgroundRemovalError ? err.message : String(err);
        }

        setStatus({ msg: 'Measuring…', frac: 0.9 });
        const mask = cutRgba ? largestAlphaComponent(cutRgba) : null;
        const handles: Handles = mask ? suggestHandles(mask) : defaultHandles(detection);

        const cutUrl = cutRgba ? track(URL.createObjectURL(await imageDataToBlob(cutRgba))) : null;

        setW({
          source, detection, correctedUrl, cutRgba, cutUrl, mask,
          handles, handlesTouched: false, ppiOverride: null, bgFailed,
        });
        const seedSource = cutRgba ?? detection.corrected;
        try {
          const sample = cutRgba ? cutRgba : cropToHandles(seedSource, handles, detection.ppi);
          setColors(dominantColors(sample, 3).map((c) => ({ hex: c.hex, weight: c.weight })));
        } catch {
          setColors([]);
        }
        setStatus(null);
        setStage('confirm');
      } catch (err) {
        setStatus(null);
        if (err instanceof PaperNotFoundError) {
          setError(err.message);
          setQuad(guessQuad(source));
          setStage('quad');
        } else {
          setError(err instanceof Error ? err.message : String(err));
          setStage('pick');
        }
      }
    },
    [settings.paper],
  );

  const onFile = useCallback(
    async (file: File) => {
      reset();
      try {
        setStage('working');
        setStatus({ msg: 'Reading the photo…', frac: 0.02 });
        const data = await fileToImageData(file);
        const url = track(URL.createObjectURL(file));
        setSrc({ data, url });
        await runPipeline(data);
      } catch (err) {
        setStatus(null);
        setError(err instanceof Error ? err.message : String(err));
        setStage('pick');
      }
    },
    [reset, runPipeline],
  );

  const ppi = w ? (w.ppiOverride ?? w.detection?.ppi ?? 0) : 0;
  const measurement = useMemo(
    () => (w && ppi > 0 ? measureFromHandles(w.handles, ppi) : null),
    [w, ppi],
  );

  const autoClass = measurement ? classifyHeight(measurement.heightIn, settings.heightClass) : null;
  const finalClass = classOverride === 'auto' ? autoClass : classOverride;

  const setHandle = useCallback((key: string, x: number, y: number) => {
    setW((prev) =>
      prev ? { ...prev, handles: { ...prev.handles, [key]: { x, y } }, handlesTouched: true } : prev,
    );
  }, []);

  const resampleColors = useCallback(() => {
    if (!w || !w.detection || ppi <= 0) return;
    try {
      const source = w.cutRgba ?? w.detection.corrected;
      const sample = cropToHandles(source, w.handles, ppi);
      setColors(dominantColors(sample, 3).map((c) => ({ hex: c.hex, weight: c.weight })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [w, ppi]);

  const save = useCallback(async () => {
    if (!w || !w.detection || !measurement || ppi <= 0) return;
    if (!name.trim()) { setError('Give the pair a name before saving.'); return; }
    setStage('working');
    setStatus({ msg: 'Saving…', frac: 0.3 });
    try {
      const pairId = uid();
      const rgbaForCutout = w.cutRgba ?? w.detection.corrected;
      const cut = await buildCutout(rgbaForCutout, w.handles, ppi);

      const photoId = uid(), cutoutId = uid();
      const photoSmall = downscale(w.source, 1600);
      await addImage({
        id: photoId, pairId, kind: 'layout-photo',
        blob: await imageDataToBlob(photoSmall, 'image/png'),
        width: photoSmall.width, height: photoSmall.height,
        label: 'Layout photo', createdAt: Date.now(),
      });
      await addImage({
        id: cutoutId, pairId, kind: 'cutout', blob: cut.blob,
        width: cut.width, height: cut.height,
        label: 'Cutout', createdAt: Date.now(),
      });
      const pair: Pair = {
        id: pairId,
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
        measurement: {
          lengthIn: measurement.lengthIn,
          heightIn: measurement.heightIn,
          ppi,
          source: w.ppiOverride !== null ? 'manual-ppi' : 'paper-detected',
          adjustedByHand: w.handlesTouched,
        },
        heightClass: finalClass,
        heightClassManual: classOverride !== 'auto',
        colors,
        cutoutImageId: cutoutId,
        photoImageId: photoId,
        extraImageIds: [],
        tagImageIds: [],
        status: 'in-storage',
        wallLocation: null,
        wearLog: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await savePair(pair);
      reset();
      onSaved(pairId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('confirm');
      setStatus(null);
    }
  }, [w, measurement, ppi, name, nickname, tagsText, colors, finalClass, classOverride, addImage, savePair, reset, onSaved]);

  // ---------------- render ----------------

  if (stage === 'working') {
    return (
      <div className="card">
        <h2>Working…</h2>
        {status ? <Progress label={status.msg} value={status.frac} /> : <p className="muted">Please wait.</p>}
        <p className="small muted">
          The first capture downloads the OpenCV and background-removal assets. Later ones are much quicker.
        </p>
        <button onClick={reset}>Cancel</button>
      </div>
    );
  }

  if (stage === 'quad' && quad && src) {
    return (
      <QuadFixer
        source={src.data}
        sourceUrl={src.url}
        quad={quad}
        error={error}
        paper={settings.paper}
        onCancel={reset}
        onConfirm={(q) => { setQuad(q); void runPipeline(src.data, q); }}
      />
    );
  }

  if (stage === 'confirm' && w && w.detection) {
    const d = w.detection;
    const stageSrc = showCutout && w.cutUrl ? w.cutUrl : w.correctedUrl!;
    const points: StagePoint[] = [
      { key: 'heel', label: 'Heel', x: w.handles.heel.x, y: w.handles.heel.y, className: 'heel' },
      { key: 'toe', label: 'Toe', x: w.handles.toe.x, y: w.handles.toe.y, className: 'toe' },
      { key: 'sole', label: 'Sole', x: w.handles.sole.x, y: w.handles.sole.y, className: 'sole' },
      { key: 'collar', label: 'Collar', x: w.handles.collar.x, y: w.handles.collar.y, className: 'collar' },
    ];
    const skew = measurement && Math.abs(measurement.axisAngleDeg - 90) > 20;

    return (
      <>
        <div className="card">
          <div className="card-head">
            <h2>Confirm the measurements</h2>
            <span className="spacer" />
            <button className="sm" onClick={reset}>Start over</button>
          </div>

          {error ? <Notice kind="bad">{error}</Notice> : null}
          {paperWarning ? <Notice kind="warn" title="Check the scale">{paperWarning}</Notice> : null}
          {w.bgFailed ? (
            <Notice kind="warn" title="Background removal did not run">
              {w.bgFailed} The handles below still measure correctly against the paper, and the mockup will use the
              corrected photo instead of a clean cutout.
            </Notice>
          ) : null}
          {!w.mask && !w.bgFailed ? (
            <Notice kind="warn" title="No shoe outline found">
              Background removal returned nothing solid enough to outline, so the handles start at the paper edges.
              Drag all four onto the shoe.
            </Notice>
          ) : null}
          {skew ? (
            <Notice kind="warn" title="Handles look skewed">
              The sole→collar line is {measurement!.axisAngleDeg.toFixed(0)}° from the heel→toe line rather than about
              90°. That usually means a handle is in the wrong place.
            </Notice>
          ) : null}

          <p className="small muted">
            Drag <strong>Heel</strong> and <strong>Toe</strong> to the ends of the shoe, and <strong>Sole</strong> and{' '}
            <strong>Collar</strong> to the bottom and top. Arrow keys nudge a selected handle; hold Shift for bigger steps.
          </p>

          <PointStage
            src={stageSrc}
            imageWidth={d.corrected.width}
            imageHeight={d.corrected.height}
            points={points}
            lines={[
              { from: 'heel', to: 'toe', color: '#6ddf9c' },
              { from: 'sole', to: 'collar', color: '#ff7a6b' },
            ]}
            onChange={setHandle}
            overlay={
              <rect
                x={d.paperRect.x} y={d.paperRect.y} width={d.paperRect.w} height={d.paperRect.h}
                fill="none" stroke="#6ea8fe" strokeWidth={Math.max(2, d.corrected.width / 400)} strokeDasharray="12 10"
              />
            }
          />

          <div className="row" style={{ marginTop: '.5rem' }}>
            <Checkbox
              label={w.cutUrl ? 'Show the cutout' : 'Show the cutout (unavailable)'}
              checked={showCutout && !!w.cutUrl}
              onChange={setShowCutout}
              disabled={!w.cutUrl}
            />
            <span className="pill">
              {d.orientation === 'landscape' ? 'Paper landscape' : 'Paper portrait'} · {settings.paper.label}
            </span>
            <span className="pill">{ppi.toFixed(1)} px/in</span>
            {w.handlesTouched ? <span className="pill good">adjusted by hand</span> : <span className="pill">automatic</span>}
          </div>
        </div>

        <div className="card">
          <h3>Measurements</h3>
          <dl className="kv">
            <dt>Length (heel→toe)</dt><dd className="mono">{fmtIn(measurement?.lengthIn)}</dd>
            <dt>Height (sole→collar)</dt><dd className="mono">{fmtIn(measurement?.heightIn)}</dd>
            <dt>Loaded bracket</dt>
            <dd className="mono">
              {measurement
                ? `${(measurement.lengthIn * 2).toFixed(2)}" wide × ${(measurement.heightIn * 2 + settings.hardware.pairGapIn).toFixed(2)}" tall (two of these pairs)`
                : '—'}
            </dd>
          </dl>
          <div className="grid2" style={{ marginTop: '.5rem' }}>
            <NumField
              label="Pixels per inch (override)"
              unit="px/in"
              step={0.1}
              value={w.ppiOverride}
              placeholder={d.ppi.toFixed(2)}
              onChange={(v) => setW((prev) => (prev ? { ...prev, ppiOverride: v } : prev))}
              hint="Leave blank to use the scale from the detected paper."
            />
            <SelectField
              label="Height class"
              value={classOverride}
              options={[
                { value: 'auto', label: `Automatic${autoClass ? ` — ${autoClass}` : ''}` },
                { value: 'low', label: 'Low' },
                { value: 'mid', label: 'Mid' },
                { value: 'high', label: 'High-top' },
              ]}
              onChange={setClassOverride}
              hint={`Cut-offs: low ≤ ${settings.heightClass.lowMaxIn}", mid ≤ ${settings.heightClass.midMaxIn}". Editable in Settings.`}
            />
          </div>
        </div>

        <div className="card">
          <h3>Colours</h3>
          <p className="small muted">
            {w.cutRgba
              ? 'k-means in Lab over the cutout. Edit any swatch, or drop one that is picking up a shadow.'
              : 'Background removal did not run, so these come from the box between the handles and may include some floor or paper. Check them, and re-read after moving the handles.'}
          </p>
          <div className="row">
            {colors.map((c, i) => (
              <span key={i} className="row tight" style={{ gap: '.25rem' }}>
                <input
                  type="color" value={c.hex} aria-label={`Colour ${i + 1}`}
                  style={{ width: 52 }}
                  onChange={(e) => setColors((prev) => prev.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))}
                />
                <span className="small muted mono">{Math.round(c.weight * 100)}%</span>
                <button className="sm ghost" onClick={() => setColors((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove colour ${i + 1}`}>×</button>
              </span>
            ))}
            {colors.length < 3 ? (
              <button className="sm" onClick={() => setColors((prev) => [...prev, { hex: '#808080', weight: 0 }])}>Add colour</button>
            ) : null}
            <button className="sm" onClick={resampleColors}>Re-read from the handles</button>
          </div>
        </div>

        <div className="card">
          <h3>Details</h3>
          <div className="grid2">
            <TextField label="Name (required)" value={name} onChange={setName} placeholder="e.g. Air Max 90 Infrared" />
            <TextField label="Nickname" value={nickname} onChange={setNickname} placeholder="optional" />
          </div>
          <TextField label="Tags" value={tagsText} onChange={setTagsText} placeholder="comma separated" hint="e.g. runner, red, gym" />
          <p className="small muted" style={{ marginTop: '.5rem' }}>
            Brand, model, style code and the rest live on the Catalog tab — nothing is filled in from the photo.
          </p>
          <div className="row" style={{ marginTop: '.5rem' }}>
            <button className="primary" onClick={save} disabled={!name.trim() || !measurement}>Save pair</button>
            <button onClick={reset}>Discard</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="card">
        <h2>Capture a pair</h2>
        <ol className="small muted" style={{ paddingLeft: '1.1rem', margin: '0 0 .7rem' }}>
          <li>Lay one shoe on its side on a sheet of {settings.paper.label} ({settings.paper.widthIn}" × {settings.paper.heightIn}"), or right beside it.</li>
          <li>Shoot from directly above, with the whole sheet in frame.</li>
          <li>Check the outline and measurements on the next screen before saving.</li>
        </ol>
        {error ? <Notice kind="bad" title="That did not work">{error}</Notice> : null}
        <label className="btn primary" style={{ width: '100%' }}>
          Take or choose a photo
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onFile(f);
            }}
          />
        </label>
        <p className="small muted" style={{ marginTop: '.5rem' }}>
          Everything runs on this device. Nothing is uploaded.
        </p>
      </div>
      <div className="card">
        <h3>Why it asks for paper</h3>
        <p className="small muted">
          The sheet is the only thing in the photo whose size is known, so it is what turns pixels into inches. If no
          sheet is found the app says so and lets you place the four corners by hand — it never guesses a scale.
        </p>
      </div>
    </>
  );
}

function guessQuad(img: ImageData): [Pt, Pt, Pt, Pt] {
  const mx = img.width * 0.25, my = img.height * 0.25;
  return [
    { x: mx, y: my },
    { x: img.width - mx, y: my },
    { x: img.width - mx, y: img.height - my },
    { x: mx, y: img.height - my },
  ];
}

function defaultHandles(d: PaperDetection): Handles {
  const r = d.paperRect;
  return {
    heel: { x: r.x + r.w * 0.2, y: r.y + r.h * 0.6 },
    toe: { x: r.x + r.w * 0.8, y: r.y + r.h * 0.6 },
    sole: { x: r.x + r.w * 0.5, y: r.y + r.h * 0.75 },
    collar: { x: r.x + r.w * 0.5, y: r.y + r.h * 0.4 },
  };
}

function QuadFixer({
  source, sourceUrl, quad, error, paper, onCancel, onConfirm,
}: {
  source: ImageData; sourceUrl: string; quad: [Pt, Pt, Pt, Pt];
  error: string | null; paper: { widthIn: number; heightIn: number; label: string };
  onCancel: () => void; onConfirm: (q: [Pt, Pt, Pt, Pt]) => void;
}) {
  const [q, setQ] = useState(quad);
  const labels = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];
  return (
    <div className="card">
      <div className="card-head">
        <h2>Place the paper corners</h2>
        <span className="spacer" />
        <button className="sm" onClick={onCancel}>Start over</button>
      </div>
      {error ? <Notice kind="warn" title="Paper not detected">{error}</Notice> : null}
      <p className="small muted">
        Drag the four handles onto the corners of the {paper.label} sheet, going clockwise from the top-left as it
        appears in the photo. The app will use those corners for the scale.
      </p>
      <PointStage
        src={sourceUrl}
        imageWidth={source.width}
        imageHeight={source.height}
        points={q.map((p, i) => ({ key: String(i), label: labels[i], x: p.x, y: p.y }))}
        lines={[
          { from: '0', to: '1', color: '#6ea8fe' },
          { from: '1', to: '2', color: '#6ea8fe' },
          { from: '2', to: '3', color: '#6ea8fe' },
          { from: '3', to: '0', color: '#6ea8fe' },
        ]}
        onChange={(key, x, y) =>
          setQ((prev) => prev.map((p, i) => (String(i) === key ? { x, y } : p)) as [Pt, Pt, Pt, Pt])
        }
      />
      <div className="row" style={{ marginTop: '.6rem' }}>
        <button className="primary" onClick={() => onConfirm(q)}>Use these corners</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
