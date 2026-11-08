import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function Notice({
  kind = 'info', title, children,
}: { kind?: 'info' | 'warn' | 'bad' | 'good'; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'bad' ? 'alert' : undefined}>
      {title && <strong>{title}</strong>}
      {title && children ? <div style={{ marginTop: '.2rem' }}>{children}</div> : children}
    </div>
  );
}

/**
 * Numeric input that keeps "not entered" distinct from zero. An empty box
 * reports null, and shows a warning border so a blank measurement is visible.
 */
export function NumField({
  label, value, onChange, unit = 'in', min, max, step = 0.25, required, hint, placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  unit?: string | null;
  min?: number; max?: number; step?: number;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  const lastProp = useRef(value);
  useEffect(() => {
    if (lastProp.current !== value) {
      lastProp.current = value;
      setText(value === null ? '' : String(value));
    }
  }, [value]);

  const blank = text.trim() === '';
  return (
    <label className="field" htmlFor={id}>
      <span className="lbl">
        {label}
        {unit ? <span className="unit">({unit})</span> : null}
        {required && blank ? <span className="pill warn">not entered</span> : null}
      </span>
      <input
        id={id}
        className={required && blank ? 'blank' : undefined}
        type="number"
        inputMode="decimal"
        value={text}
        min={min} max={max} step={step}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim();
          if (t === '') { lastProp.current = null; onChange(null); return; }
          const n = Number(t);
          if (Number.isFinite(n)) { lastProp.current = n; onChange(n); }
        }}
      />
      {hint ? <span className="small muted">{hint}</span> : null}
    </label>
  );
}

export function TextField({
  label, value, onChange, placeholder, hint, type = 'text',
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; type?: string;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="lbl">{label}</span>
      <input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="small muted">{hint}</span> : null}
    </label>
  );
}

export function SelectField<T extends string>({
  label, value, options, onChange, hint,
}: {
  label: string; value: T; options: { value: T; label: string }[];
  onChange: (v: T) => void; hint?: string;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="lbl">{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint ? <span className="small muted">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({
  label, checked, onChange, disabled,
}: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="row tight" style={{ fontSize: '.85rem', opacity: disabled ? 0.5 : 1, minHeight: 'var(--tap)' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Swatches({ colors, large }: { colors: { hex: string }[]; large?: boolean }) {
  if (!colors.length) return <span className="small muted">no colours</span>;
  return (
    <span className="swatches">
      {colors.map((c, i) => (
        <span key={`${c.hex}-${i}`} className={`swatch${large ? ' lg' : ''}`} style={{ background: c.hex }} title={c.hex} />
      ))}
    </span>
  );
}

export function Sheet({
  title, onClose, children, footer,
}: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet-inner">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="sm" onClick={onClose}>Close</button>
        </div>
        {children}
        {footer ? <div className="row" style={{ marginTop: '.75rem' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ marginBottom: '.5rem' }}>
      <div className="small muted" style={{ marginBottom: '.2rem' }}>{label}</div>
      <div className="progress"><div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} /></div>
    </div>
  );
}

export function useConfirm() {
  return (message: string) => window.confirm(message);
}

export const fmtIn = (v: number | null | undefined, places = 2) =>
  v === null || v === undefined ? '—' : `${v.toFixed(places)}"`;
