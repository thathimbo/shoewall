import { useCallback, useEffect, useRef, useState } from 'react';

export interface StagePoint {
  key: string;
  label: string;
  x: number;
  y: number;
  className?: string;
}

export interface StageLine {
  from: string;
  to: string;
  color: string;
  label?: string;
  dashed?: boolean;
}

/**
 * An image with draggable points on top, in IMAGE PIXEL coordinates.
 * Works with mouse, touch and keyboard (arrow keys nudge the focused point).
 */
export function PointStage({
  src, imageWidth, imageHeight, points, lines, onChange, overlay, maxHeightVh = 55,
}: {
  src: string;
  imageWidth: number;
  imageHeight: number;
  points: StagePoint[];
  lines?: StageLine[];
  onChange: (key: string, x: number, y: number) => void;
  overlay?: React.ReactNode;
  maxHeightVh?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ w: number; h: number }>({ w: 1, h: 1 });
  const dragging = useRef<string | null>(null);

  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ w: r.width || 1, h: r.height || 1 });
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure]);

  const scale = rect.w / imageWidth;

  const toImage = useCallback(
    (clientX: number, clientY: number) => {
      const el = boxRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = ((clientX - r.left) / (r.width || 1)) * imageWidth;
      const y = ((clientY - r.top) / (r.height || 1)) * imageHeight;
      return {
        x: Math.max(0, Math.min(imageWidth, x)),
        y: Math.max(0, Math.min(imageHeight, y)),
      };
    },
    [imageWidth, imageHeight],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      const p = toImage(e.clientX, e.clientY);
      if (p) onChange(dragging.current, p.x, p.y);
    };
    const up = () => { dragging.current = null; };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [onChange, toImage]);

  const byKey = new Map(points.map((p) => [p.key, p] as const));

  return (
    <div
      ref={boxRef}
      className="stage"
      style={{ maxHeight: `${maxHeightVh}vh`, width: '100%', position: 'relative' }}
    >
      <img src={src} alt="" draggable={false} style={{ maxHeight: `${maxHeightVh}vh`, objectFit: 'contain' }} />
      <svg
        viewBox={`0 0 ${imageWidth} ${imageHeight}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {(lines ?? []).map((ln, i) => {
          const a = byKey.get(ln.from), b = byKey.get(ln.to);
          if (!a || !b) return null;
          return (
            <g key={i}>
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={ln.color}
                strokeWidth={Math.max(1.5, 2 / Math.max(scale, 0.0001))}
                strokeDasharray={ln.dashed ? `${8 / Math.max(scale, 0.0001)} ${6 / Math.max(scale, 0.0001)}` : undefined}
              />
            </g>
          );
        })}
        {overlay}
      </svg>
      {points.map((p) => (
        <button
          key={p.key}
          className={`handle ${p.className ?? ''}`}
          style={{ left: `${(p.x / imageWidth) * 100}%`, top: `${(p.y / imageHeight) * 100}%` }}
          aria-label={`${p.label} — drag to move, or use the arrow keys`}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.target as HTMLElement).focus();
            dragging.current = p.key;
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 1;
            const d: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
            };
            const v = d[e.key];
            if (!v) return;
            e.preventDefault();
            onChange(p.key, Math.max(0, Math.min(imageWidth, p.x + v[0])), Math.max(0, Math.min(imageHeight, p.y + v[1])));
          }}
        >
          {p.label.slice(0, 1).toUpperCase()}
        </button>
      ))}
    </div>
  );
}
