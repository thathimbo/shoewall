import { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Pair } from '../types';
import { PairThumb } from '../components/PairThumb';
import { PairEditor } from '../components/PairEditor';
import { Notice, Swatches, TextField } from '../components/ui';
import { paletteDistance } from '../lib/color';
import { catalogCsv, lastWorn } from '../lib/exports';
import { downloadText } from '../lib/csv';

type SortKey = 'brand' | 'last-worn' | 'times-worn' | 'purchase-date' | 'color' | 'name';
type View = 'grid' | 'list';

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 183;

export function CatalogTab({ onShowOnWall }: { onShowOnWall: (id: string) => void }) {
  const { pairs } = useStore();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('grid');
  const [sort, setSort] = useState<SortKey>('brand');
  const [brand, setBrand] = useState('');
  const [heightClass, setHeightClass] = useState('');
  const [status, setStatus] = useState('');
  const [condition, setCondition] = useState('');
  const [tag, setTag] = useState('');
  const [colorNeedle, setColorNeedle] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const brands = useMemo(
    () => [...new Set(pairs.map((p) => p.brand).filter((b): b is string => !!b))].sort(),
    [pairs],
  );
  const tags = useMemo(() => [...new Set(pairs.flatMap((p) => p.tags))].sort(), [pairs]);
  const swatchPalette = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of pairs) for (const c of p.colors) seen.set(c.hex, (seen.get(c.hex) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([hex]) => hex);
  }, [pairs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = pairs.filter((p) => {
      if (brand && p.brand !== brand) return false;
      if (heightClass && p.heightClass !== heightClass) return false;
      if (status && p.status !== status) return false;
      if (condition && p.condition !== condition) return false;
      if (tag && !p.tags.includes(tag)) return false;
      if (!q) return true;
      return searchBlob(p).includes(q);
    });
    if (colorNeedle) {
      const needle = [{ hex: colorNeedle, weight: 1 }];
      list = list
        .map((p) => ({ p, d: p.colors.length ? paletteDistance(p.colors, needle) : Infinity }))
        // CIEDE2000 under ~25 is "recognisably the same family" at a glance.
        .filter((x) => x.d <= 25)
        .sort((a, b) => a.d - b.d)
        .map((x) => x.p);
      return list;
    }
    return sortPairs(list, sort);
  }, [pairs, query, brand, heightClass, status, condition, tag, colorNeedle, sort]);

  const stats = useMemo(() => {
    const byBrand = new Map<string, number>();
    const byStatus = new Map<string, number>();
    for (const p of pairs) {
      byBrand.set(p.brand || '(no brand)', (byBrand.get(p.brand || '(no brand)') ?? 0) + 1);
      byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
    }
    const cutoff = Date.now() - SIX_MONTHS_MS;
    const stale = pairs.filter((p) => {
      const lw = lastWorn(p);
      return !lw || new Date(`${lw}T00:00:00`).getTime() < cutoff;
    });
    return {
      total: pairs.length,
      byBrand: [...byBrand.entries()].sort((a, b) => b[1] - a[1]),
      byStatus: [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
      stale,
    };
  }, [pairs]);

  const anyFilter = !!(query || brand || heightClass || status || condition || tag || colorNeedle);
  const open = editing ? pairs.find((p) => p.id === editing) ?? null : null;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2>Catalog <span className="muted small">({pairs.length})</span></h2>
          <span className="spacer" />
          <button className="chip" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button>
          <button className="chip" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
        </div>

        <TextField
          label="Search" value={query} onChange={setQuery}
          placeholder="name, brand, model, colourway, SKU, notes, tags…"
        />

        <div className="grid3" style={{ marginTop: '.5rem' }}>
          <Filter label="Brand" value={brand} onChange={setBrand} options={brands} />
          <Filter label="Height" value={heightClass} onChange={setHeightClass} options={['low', 'mid', 'high']} />
          <Filter label="Status" value={status} onChange={setStatus} options={['on-wall', 'in-storage', 'not-on-rack']} />
          <Filter label="Condition" value={condition} onChange={setCondition} options={['deadstock', 'like-new', 'worn', 'beater']} />
          <Filter label="Tag" value={tag} onChange={setTag} options={tags} />
          <label className="field">
            <span className="lbl">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} disabled={!!colorNeedle}>
              <option value="brand">Brand</option>
              <option value="name">Name</option>
              <option value="last-worn">Last worn</option>
              <option value="times-worn">Times worn</option>
              <option value="purchase-date">Purchase date</option>
              <option value="color">Colour</option>
            </select>
          </label>
        </div>

        {swatchPalette.length ? (
          <div style={{ marginTop: '.6rem' }}>
            <div className="small muted" style={{ marginBottom: '.25rem' }}>
              Find similar colours {colorNeedle ? <>— showing matches for <span className="mono">{colorNeedle}</span>, closest first</> : '(pick a swatch)'}
            </div>
            <div className="row tight">
              {swatchPalette.map((hex) => (
                <button
                  key={hex} className="swatch-btn" aria-label={`Find pairs similar to ${hex}`}
                  aria-pressed={colorNeedle === hex}
                  style={{
                    background: hex, width: 28, height: 28,
                    outline: colorNeedle === hex ? '2px solid var(--accent)' : undefined,
                    outlineOffset: 2,
                  }}
                  onClick={() => setColorNeedle(colorNeedle === hex ? null : hex)}
                />
              ))}
              {colorNeedle ? <button className="sm ghost" onClick={() => setColorNeedle(null)}>Clear</button> : null}
            </div>
          </div>
        ) : null}

        <div className="row" style={{ marginTop: '.6rem' }}>
          <span className="small muted">
            {filtered.length} of {pairs.length} shown
            {colorNeedle ? ' · colour match overrides the sort' : ''}
          </span>
          {anyFilter ? (
            <button className="sm ghost" onClick={() => {
              setQuery(''); setBrand(''); setHeightClass(''); setStatus(''); setCondition(''); setTag(''); setColorNeedle(null);
            }}>Clear filters</button>
          ) : null}
          <span style={{ marginLeft: 'auto' }} />
          <button className="sm" onClick={() => downloadText('shoewall-catalog.csv', catalogCsv(pairs))}>
            Export catalog CSV
          </button>
        </div>
      </div>

      {!pairs.length ? (
        <div className="card"><p className="muted">Nothing in the catalog yet. Capture a pair to start.</p></div>
      ) : !filtered.length ? (
        <div className="card"><p className="muted">Nothing matches those filters.</p></div>
      ) : view === 'grid' ? (
        <div className="card">
          <div className="pair-grid">
            {filtered.map((p) => (
              <button key={p.id} className="pair-card" onClick={() => setEditing(p.id)}>
                <PairThumb pair={p} large />
                <span className="name">{p.name}</span>
                <span className="small muted">
                  {[p.brand, p.size ? `size ${p.size}` : null].filter(Boolean).join(' · ') || '—'}
                </span>
                <Swatches colors={p.colors} />
                <span className="row tight small">
                  <span className="pill">{p.status}</span>
                  {p.heightClass ? <span className="pill">{p.heightClass}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pair</th><th>Brand</th><th>Model</th><th>SKU</th><th>Size</th>
                  <th>Colours</th><th>Status</th><th className="nowrap">Last worn</th><th>Worn</th><th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="row tight" style={{ gap: '.5rem' }}>
                        <PairThumb pair={p} />
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                      </div>
                    </td>
                    <td>{p.brand ?? <span className="muted">—</span>}</td>
                    <td>{p.model ?? <span className="muted">—</span>}</td>
                    <td className="mono small">{p.styleCode ?? <span className="muted">—</span>}</td>
                    <td className="mono">{p.size ?? <span className="muted">—</span>}</td>
                    <td><Swatches colors={p.colors} /></td>
                    <td><span className="pill">{p.status}</span></td>
                    <td className="mono small nowrap">{lastWorn(p) ?? <span className="muted">never</span>}</td>
                    <td className="mono">{p.wearLog.length}</td>
                    <td><button className="sm" onClick={() => setEditing(p.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Stats</h3>
        <div className="grid2">
          <div>
            <h4 className="small muted">Total</h4>
            <p className="mono" style={{ fontSize: '1.4rem' }}>{stats.total}</p>
          </div>
          <div>
            <h4 className="small muted">By status</h4>
            <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {stats.byStatus.map(([k, v]) => <li key={k}>{k}: <span className="mono">{v}</span></li>)}
            </ul>
          </div>
          <div>
            <h4 className="small muted">By brand</h4>
            <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {stats.byBrand.map(([k, v]) => <li key={k}>{k}: <span className="mono">{v}</span></li>)}
            </ul>
          </div>
          <div>
            <h4 className="small muted">Not worn in 6 months</h4>
            <p className="mono" style={{ fontSize: '1.4rem', margin: 0 }}>{stats.stale.length}</p>
            {stats.stale.length ? (
              <p className="small muted" style={{ marginTop: '.3rem' }}>
                {stats.stale.slice(0, 8).map((p) => p.name).join(', ')}
                {stats.stale.length > 8 ? `, +${stats.stale.length - 8} more` : ''}
              </p>
            ) : null}
          </div>
        </div>
        <Notice kind="info">
          Counts come only from what you have entered. Pairs with no brand are grouped as “(no brand)”, and a pair with
          no wear entries counts as never worn rather than being guessed at.
        </Notice>
      </div>

      {open ? (
        <PairEditor pair={open} onClose={() => setEditing(null)} onShowOnWall={onShowOnWall} />
      ) : null}
    </>
  );
}

function Filter({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function searchBlob(p: Pair): string {
  return [
    p.name, p.nickname, p.brand, p.model, p.colorway, p.styleCode, p.size,
    p.purchasedFrom, p.condition, p.status, p.notes, p.heightClass,
    p.wallLocation?.wallName, ...p.tags, ...p.colors.map((c) => c.hex),
  ].filter(Boolean).join(' ').toLowerCase();
}

function sortPairs(list: Pair[], sort: SortKey): Pair[] {
  const l = [...list];
  switch (sort) {
    case 'name': return l.sort((a, b) => a.name.localeCompare(b.name));
    case 'last-worn':
      return l.sort((a, b) => (lastWorn(b) ?? '').localeCompare(lastWorn(a) ?? ''));
    case 'times-worn': return l.sort((a, b) => b.wearLog.length - a.wearLog.length);
    case 'purchase-date':
      return l.sort((a, b) => (b.purchaseDate ?? '').localeCompare(a.purchaseDate ?? ''));
    case 'color':
      return l.sort((a, b) => {
        const ha = a.colors[0]?.hex ?? '';
        const hb = b.colors[0]?.hex ?? '';
        return ha.localeCompare(hb);
      });
    default:
      return l.sort((a, b) =>
        (a.brand ?? 'zzz').localeCompare(b.brand ?? 'zzz') || a.name.localeCompare(b.name),
      );
  }
}
