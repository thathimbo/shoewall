import { useEffect, useMemo, useState } from 'react';
import type { Condition, Pair, PairStatus, Swatch } from '../types';
import { useStore, useImageUrl } from '../store';
import { Notice, NumField, TextField, SelectField, Sheet, fmtIn, Progress } from './ui';
import { classifyHeight } from '../lib/defaults';
import { fileToImageData, imageDataToBlob, downscale } from '../lib/image';
import { readTagImage, OcrError, type OcrSuggestion } from '../lib/ocr';
import { lastWorn } from '../lib/exports';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'deadstock', label: 'Deadstock' },
  { value: 'like-new', label: 'Like new' },
  { value: 'worn', label: 'Worn' },
  { value: 'beater', label: 'Beater' },
];
const STATUSES: { value: PairStatus; label: string }[] = [
  { value: 'on-wall', label: 'On wall' },
  { value: 'in-storage', label: 'In storage' },
  { value: 'not-on-rack', label: 'Not on rack' },
];

export function PairEditor({
  pair, onClose, onShowOnWall,
}: { pair: Pair; onClose: () => void; onShowOnWall?: (pairId: string) => void }) {
  const { savePair, removePair, addImage, removeImage, settings } = useStore();
  const [draft, setDraft] = useState<Pair>(pair);
  const [error, setError] = useState<string | null>(null);
  const [ocr, setOcr] = useState<{ status: string; frac: number } | null>(null);
  const [suggestion, setSuggestion] = useState<OcrSuggestion | null>(null);

  useEffect(() => { setDraft(pair); }, [pair]);

  const set = <K extends keyof Pair>(k: K, v: Pair[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const autoClass = draft.measurement
    ? classifyHeight(draft.measurement.heightIn, settings.heightClass)
    : null;

  const save = async () => {
    if (!draft.name.trim()) { setError('A pair needs a name.'); return; }
    const next: Pair = {
      ...draft,
      name: draft.name.trim(),
      heightClass: draft.heightClassManual ? draft.heightClass : autoClass,
    };
    await savePair(next);
    onClose();
  };

  const addPhoto = async (file: File, kind: 'extra' | 'tag') => {
    setError(null);
    try {
      const data = downscale(await fileToImageData(file), 1800);
      const id = uid();
      await addImage({
        id, pairId: draft.id, kind,
        blob: await imageDataToBlob(data, 'image/png'),
        width: data.width, height: data.height,
        label: kind === 'tag' ? 'Tongue label' : 'Extra angle',
        createdAt: Date.now(),
      });
      const next: Pair = kind === 'tag'
        ? { ...draft, tagImageIds: [...draft.tagImageIds, id] }
        : { ...draft, extraImageIds: [...draft.extraImageIds, id] };
      setDraft(next);
      await savePair(next);
      if (kind === 'tag') await runOcr(await imageDataToBlob(data, 'image/png'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runOcr = async (blob: Blob) => {
    setSuggestion(null);
    setOcr({ status: 'starting', frac: 0 });
    try {
      const s = await readTagImage(blob, (status, frac) => setOcr({ status, frac }));
      setSuggestion(s);
    } catch (err) {
      setError(err instanceof OcrError ? err.message : String(err));
    } finally {
      setOcr(null);
    }
  };

  const dropImage = async (id: string, kind: 'extra' | 'tag') => {
    await removeImage(id);
    const next: Pair = kind === 'tag'
      ? { ...draft, tagImageIds: draft.tagImageIds.filter((x) => x !== id) }
      : { ...draft, extraImageIds: draft.extraImageIds.filter((x) => x !== id) };
    setDraft(next);
    await savePair(next);
  };

  const wearDates = useMemo(() => [...draft.wearLog].map((w) => w.date).sort().reverse(), [draft.wearLog]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Sheet
      title={pair.name || 'Pair'}
      onClose={onClose}
      footer={
        <>
          <button className="primary" onClick={save}>Save</button>
          <button onClick={onClose}>Cancel</button>
          <span className="spacer" style={{ marginLeft: 'auto' }} />
          <button
            className="danger"
            onClick={async () => {
              if (window.confirm(`Delete "${pair.name}" and its photos? This cannot be undone.`)) {
                await removePair(pair.id);
                onClose();
              }
            }}
          >
            Delete pair
          </button>
        </>
      }
    >
      {error ? <Notice kind="bad">{error}</Notice> : null}

      <section className="card">
        <h3>Measurements</h3>
        {draft.measurement ? (
          <>
            <div className="grid2">
              <NumField
                label="Length (heel→toe)" value={draft.measurement.lengthIn} step={0.05}
                onChange={(v) => v !== null && set('measurement', { ...draft.measurement!, lengthIn: v, source: 'typed' })}
              />
              <NumField
                label="Height (sole→collar)" value={draft.measurement.heightIn} step={0.05}
                onChange={(v) => v !== null && set('measurement', { ...draft.measurement!, heightIn: v, source: 'typed' })}
              />
            </div>
            <p className="small muted" style={{ marginTop: '.4rem' }}>
              Scale: {draft.measurement.ppi.toFixed(1)} px/in · source: {draft.measurement.source}
              {draft.measurement.adjustedByHand ? ' · handles adjusted by hand' : ''}
            </p>
          </>
        ) : (
          <Notice kind="warn" title="Not measured">
            This pair has no measurements, so the layout generator will leave it out. Capture it from the Capture tab,
            or type the numbers below.
            <div className="grid2" style={{ marginTop: '.5rem' }}>
              <NumField
                label="Length (heel→toe)" value={null} step={0.05} required
                onChange={(v) => v !== null && set('measurement', { lengthIn: v, heightIn: 0, ppi: 0, source: 'typed', adjustedByHand: true })}
              />
            </div>
          </Notice>
        )}
        <div className="row" style={{ marginTop: '.5rem' }}>
          <SelectField
            label="Height class"
            value={draft.heightClassManual ? (draft.heightClass ?? 'mid') : 'auto'}
            options={[
              { value: 'auto', label: `Automatic${autoClass ? ` — ${autoClass}` : ''}` },
              { value: 'low', label: 'Low' }, { value: 'mid', label: 'Mid' }, { value: 'high', label: 'High-top' },
            ]}
            onChange={(v) => {
              if (v === 'auto') setDraft((d) => ({ ...d, heightClassManual: false, heightClass: autoClass }));
              else setDraft((d) => ({ ...d, heightClassManual: true, heightClass: v as Pair['heightClass'] }));
            }}
          />
        </div>
      </section>

      <section className="card">
        <h3>Colours</h3>
        <div className="row">
          {draft.colors.map((c, i) => (
            <span key={i} className="row tight" style={{ gap: '.25rem' }}>
              <input
                type="color" value={c.hex} aria-label={`Colour ${i + 1}`} style={{ width: 52 }}
                onChange={(e) =>
                  set('colors', draft.colors.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) as Swatch[])
                }
              />
              <button className="sm ghost" aria-label={`Remove colour ${i + 1}`}
                onClick={() => set('colors', draft.colors.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {draft.colors.length < 3 ? (
            <button className="sm" onClick={() => set('colors', [...draft.colors, { hex: '#808080', weight: 0 }])}>Add colour</button>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h3>Catalog</h3>
        <div className="grid2">
          <TextField label="Name (required)" value={draft.name} onChange={(v) => set('name', v)} />
          <TextField label="Nickname" value={draft.nickname ?? ''} onChange={(v) => set('nickname', v || undefined)} />
          <TextField label="Brand" value={draft.brand ?? ''} onChange={(v) => set('brand', v || undefined)} />
          <TextField label="Model" value={draft.model ?? ''} onChange={(v) => set('model', v || undefined)} />
          <TextField label="Colourway" value={draft.colorway ?? ''} onChange={(v) => set('colorway', v || undefined)} />
          <TextField label="Style code / SKU" value={draft.styleCode ?? ''} onChange={(v) => set('styleCode', v || undefined)} />
          <TextField label="Size" value={draft.size ?? ''} onChange={(v) => set('size', v || undefined)} />
          <TextField label="Purchase date" type="date" value={draft.purchaseDate ?? ''} onChange={(v) => set('purchaseDate', v || undefined)} />
          <NumField label="Purchase price" unit="$" step={1} value={draft.purchasePrice ?? null} onChange={(v) => set('purchasePrice', v)} />
          <TextField label="Bought from" value={draft.purchasedFrom ?? ''} onChange={(v) => set('purchasedFrom', v || undefined)} />
          <SelectField
            label="Condition"
            value={draft.condition ?? ''}
            options={[{ value: '' as Condition, label: '— not set —' }, ...CONDITIONS]}
            onChange={(v) => set('condition', (v || undefined) as Condition | undefined)}
          />
          <SelectField
            label="Status"
            value={draft.status}
            options={STATUSES}
            onChange={(v) => set('status', v)}
            hint="Set automatically when a layout is generated; 'not on rack' keeps a pair out of the layout."
          />
        </div>
        <TextField
          label="Tags" value={draft.tags.join(', ')}
          onChange={(v) => set('tags', v.split(',').map((t) => t.trim()).filter(Boolean))}
          hint="comma separated"
        />
        <label className="field" style={{ marginTop: '.5rem' }}>
          <span className="lbl">Notes</span>
          <textarea value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} />
        </label>
      </section>

      <section className="card">
        <h3>Wall location</h3>
        {draft.wallLocation ? (
          <div className="row">
            <span className="pill good">
              {draft.wallLocation.wallName} · bracket {draft.wallLocation.bracketNumber} · {draft.wallLocation.arm} arm
            </span>
            {onShowOnWall ? (
              <button className="sm" onClick={() => { onShowOnWall(draft.id); onClose(); }}>Show on wall</button>
            ) : null}
          </div>
        ) : (
          <p className="small muted">Not on a wall in the current layout. This field is filled in from the layout, never typed.</p>
        )}
      </section>

      <section className="card">
        <h3>Wear log</h3>
        <div className="row">
          <button
            onClick={async () => {
              if (draft.wearLog.some((w) => w.date === today)) return;
              const next = { ...draft, wearLog: [...draft.wearLog, { date: today }] };
              setDraft(next);
              await savePair(next);
            }}
            disabled={draft.wearLog.some((w) => w.date === today)}
          >
            {draft.wearLog.some((w) => w.date === today) ? 'Logged today' : 'Wore today'}
          </button>
          <span className="small muted">
            {draft.wearLog.length} wear{draft.wearLog.length === 1 ? '' : 's'}
            {lastWorn(draft) ? ` · last ${lastWorn(draft)}` : ' · never worn'}
          </span>
        </div>
        {wearDates.length ? (
          <div className="row tight" style={{ marginTop: '.5rem' }}>
            {wearDates.slice(0, 24).map((d) => (
              <button
                key={d} className="chip" title="Remove this entry"
                onClick={async () => {
                  const next = { ...draft, wearLog: draft.wearLog.filter((w) => w.date !== d) };
                  setDraft(next);
                  await savePair(next);
                }}
              >
                {d} ×
              </button>
            ))}
            {wearDates.length > 24 ? <span className="small muted">+{wearDates.length - 24} more</span> : null}
          </div>
        ) : null}
      </section>

      <section className="card">
        <h3>Photos</h3>
        <ImageStrip ids={[draft.photoImageId, draft.cutoutImageId].filter((x): x is string => !!x)} />
        <div className="row" style={{ marginTop: '.5rem' }}>
          <label className="btn sm">
            Add another angle
            <input className="visually-hidden" type="file" accept="image/*" capture="environment"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPhoto(f, 'extra'); }} />
          </label>
          <label className="btn sm">
            Photograph the tongue label
            <input className="visually-hidden" type="file" accept="image/*" capture="environment"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPhoto(f, 'tag'); }} />
          </label>
        </div>
        {draft.extraImageIds.length ? (
          <>
            <h4 className="small muted" style={{ marginTop: '.6rem' }}>Extra angles</h4>
            <ImageStrip ids={draft.extraImageIds} onDelete={(id) => dropImage(id, 'extra')} />
          </>
        ) : null}
        {draft.tagImageIds.length ? (
          <>
            <h4 className="small muted" style={{ marginTop: '.6rem' }}>Tongue labels</h4>
            <ImageStrip ids={draft.tagImageIds} onDelete={(id) => dropImage(id, 'tag')} />
          </>
        ) : null}

        {ocr ? <Progress label={`Reading the label (${ocr.status})…`} value={ocr.frac} /> : null}
        {suggestion ? (
          <Notice kind="info" title={`OCR read this label (${Math.round(suggestion.confidence * 100)}% confidence)`}>
            <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: '.3rem 0', maxHeight: 110, overflow: 'auto' }}>
              {suggestion.text.trim() || '(nothing legible)'}
            </pre>
            <p className="small">Nothing is saved until you pick a value.</p>
            {suggestion.styleCodes.length ? (
              <div className="row tight">
                <span className="small muted">Style code:</span>
                {suggestion.styleCodes.map((c) => (
                  <button key={c} className="chip" onClick={() => set('styleCode', c)}>{c}</button>
                ))}
              </div>
            ) : <p className="small muted">No style code recognised — type it in above.</p>}
            {suggestion.sizes.length ? (
              <div className="row tight" style={{ marginTop: '.3rem' }}>
                <span className="small muted">Size:</span>
                {suggestion.sizes.map((c) => (
                  <button key={c} className="chip" onClick={() => set('size', c)}>{c}</button>
                ))}
              </div>
            ) : <p className="small muted">No size recognised — type it in above.</p>}
            <button className="sm" style={{ marginTop: '.4rem' }} onClick={() => setSuggestion(null)}>Dismiss</button>
          </Notice>
        ) : null}
      </section>

      <p className="small muted">
        Measured: {fmtIn(draft.measurement?.lengthIn)} × {fmtIn(draft.measurement?.heightIn)} ·
        added {new Date(draft.createdAt).toLocaleDateString()}
      </p>
    </Sheet>
  );
}

function ImageStrip({ ids, onDelete }: { ids: string[]; onDelete?: (id: string) => void }) {
  if (!ids.length) return <p className="small muted">No photos.</p>;
  return (
    <div className="row tight">
      {ids.map((id) => <StripItem key={id} id={id} onDelete={onDelete} />)}
    </div>
  );
}

function StripItem({ id, onDelete }: { id: string; onDelete?: (id: string) => void }) {
  const url = useImageUrl(id);
  return (
    <span style={{ position: 'relative' }}>
      {url
        ? <img className="thumb" src={url} alt="" style={{ width: 86, height: 64 }} />
        : <span className="thumb empty" style={{ width: 86, height: 64 }}>…</span>}
      {onDelete ? (
        <button
          className="sm" aria-label="Remove photo"
          style={{ position: 'absolute', top: -6, right: -6, minHeight: 24, padding: '0 .3rem' }}
          onClick={() => onDelete(id)}
        >×</button>
      ) : null}
    </span>
  );
}
