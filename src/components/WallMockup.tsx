import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bracket, Pair, Settings, WallLayout } from '../types';
import { resolveImageUrl, useStore } from '../store';

export interface SlotAddress {
  wallIndex: number;
  bracketNumber: number;
  arm: 'left' | 'right';
}

/**
 * To-scale drawing of one wall. The SVG user unit is one inch, so every
 * position comes straight from the layout with no extra fudge factors.
 */
export function WallMockup({
  wall, pairs, settings, showOverlay, highlightPairId, onSwap, pxPerInch = 4,
}: {
  wall: WallLayout;
  pairs: Pair[];
  settings: Settings;
  showOverlay: boolean;
  highlightPairId?: string | null;
  onSwap?: (a: SlotAddress, b: SlotAddress) => void;
  pxPerInch?: number;
}) {
  const byId = useMemo(() => new Map(pairs.map((p) => [p.id, p] as const)), [pairs]);
  const [selected, setSelected] = useState<SlotAddress | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Mirrored in a ref so the pointer handlers always see the current selection.
  const selectedRef = useRef<SlotAddress | null>(null);
  const dragFrom = useRef<{ addr: SlotAddress; x: number; y: number } | null>(null);
  const pick = (a: SlotAddress | null) => { selectedRef.current = a; setSelected(a); };

  // The view runs floor to a little above whatever is highest.
  const contentTop = Math.max(
    wall.usableY.y1,
    ...wall.brackets.map((b) => b.extent.y1),
    1,
  );
  const viewTop = Math.ceil(contentTop + 6);
  const viewW = wall.widthIn;
  const toScreenY = (yIn: number) => viewTop - yIn;

  const sameSlot = (a: SlotAddress | null, b: SlotAddress) =>
    !!a && a.wallIndex === b.wallIndex && a.bracketNumber === b.bracketNumber && a.arm === b.arm;

  const slotFromPoint = (x: number, y: number): SlotAddress | null => {
    const el = document.elementFromPoint(x, y) as Element | null;
    const holder = el?.closest('[data-slot]');
    const raw = holder?.getAttribute('data-slot');
    if (!raw) return null;
    const [w, b, arm] = raw.split('|');
    return { wallIndex: Number(w), bracketNumber: Number(b), arm: arm as 'left' | 'right' };
  };

  return (
    <div className="wall-view">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewW} ${viewTop}`}
        width={viewW * pxPerInch}
        height={viewTop * pxPerInch}
        style={{ display: 'block', maxWidth: 'none', background: settings.wallColorHex }}
        role="img"
        aria-label={`${wall.wallName} to scale: ${wall.widthIn} inches wide, ${wall.brackets.length} brackets`}
      >
        {/* floor line */}
        <line x1={0} y1={viewTop} x2={viewW} y2={viewTop} stroke="rgba(0,0,0,.35)" strokeWidth={0.5} />

        {/* usable band */}
        {showOverlay ? (
          <>
            <rect
              x={wall.usableX.x0} y={toScreenY(wall.usableY.y1)}
              width={wall.usableX.x1 - wall.usableX.x0}
              height={wall.usableY.y1 - wall.usableY.y0}
              fill="rgba(110,168,254,.08)" stroke="rgba(110,168,254,.8)" strokeWidth={0.3} strokeDasharray="2 1.5"
            />
            {wall.usableX.x0 > 0 ? (
              <rect x={0} y={0} width={wall.usableX.x0} height={viewTop} fill="rgba(0,0,0,.14)" />
            ) : null}
            {wall.usableX.x1 < viewW ? (
              <rect x={wall.usableX.x1} y={0} width={viewW - wall.usableX.x1} height={viewTop} fill="rgba(0,0,0,.14)" />
            ) : null}
            {wall.rows.map((r) => (
              <line
                key={r.rowIndex}
                x1={wall.usableX.x0} x2={wall.usableX.x1}
                y1={toScreenY(r.bottomYIn)} y2={toScreenY(r.bottomYIn)}
                stroke="rgba(0,0,0,.3)" strokeWidth={0.2} strokeDasharray="1 1"
              />
            ))}
          </>
        ) : null}

        {wall.brackets.map((b) => (
          <BracketGroup
            key={b.number}
            bracket={b}
            wall={wall}
            byId={byId}
            settings={settings}
            toScreenY={toScreenY}
            showOverlay={showOverlay}
            highlightPairId={highlightPairId ?? null}
            selected={selected}
            interactive={!!onSwap}
            onSlotDown={(addr, x, y) => { if (onSwap) dragFrom.current = { addr, x, y }; }}
            onSlotUp={(x, y) => {
              const from = dragFrom.current;
              dragFrom.current = null;
              if (!from || !onSwap) return;

              const target = slotFromPoint(x, y);
              // Dropped on a different slot: that is a drag-and-drop swap.
              if (target && !sameSlot(from.addr, target)) {
                onSwap(from.addr, target);
                pick(null);
                return;
              }
              // Released where it started: treat it as a tap.
              if (Math.hypot(x - from.x, y - from.y) > 10) return;
              const current = selectedRef.current;
              if (!current) { pick(from.addr); return; }
              if (sameSlot(current, from.addr)) { pick(null); return; }
              onSwap(current, from.addr);
              pick(null);
            }}
          />
        ))}

        {showOverlay
          ? wall.brackets.map((b) => (
              <g key={`lbl-${b.number}`} pointerEvents="none">
                <circle cx={b.plateXIn} cy={toScreenY(b.armTopYIn)} r={1.6} fill="#111" opacity={0.75} />
                <text
                  x={b.plateXIn} y={toScreenY(b.armTopYIn) + 0.7}
                  textAnchor="middle" fontSize={2.2} fill="#fff" fontWeight={700}
                >
                  {b.number}
                </text>
              </g>
            ))
          : null}
      </svg>
    </div>
  );
}

function BracketGroup({
  bracket: b, wall, byId, settings, toScreenY, showOverlay, highlightPairId,
  selected, interactive, onSlotDown, onSlotUp,
}: {
  bracket: Bracket;
  wall: WallLayout;
  byId: Map<string, Pair>;
  settings: Settings;
  toScreenY: (y: number) => number;
  showOverlay: boolean;
  highlightPairId: string | null;
  selected: SlotAddress | null;
  interactive: boolean;
  onSlotDown: (a: SlotAddress, clientX: number, clientY: number) => void;
  onSlotUp: (clientX: number, clientY: number) => void;
}) {
  const heelInset = settings.hardware.heelInsetFromCenterIn;
  const gap = settings.hardware.pairGapIn;
  const arms: Array<{ arm: 'left' | 'right'; pairId: string | null }> = [
    { arm: 'left', pairId: b.leftPairId },
    { arm: 'right', pairId: b.rightPairId },
  ];

  return (
    <g>
      {/* the iron: a 16" U with the plate at the bottom centre */}
      <g pointerEvents="none" opacity={0.55}>
        <line
          x1={b.plateXIn - settings.hardware.bracketWidthIn / 2}
          x2={b.plateXIn + settings.hardware.bracketWidthIn / 2}
          y1={toScreenY(b.armTopYIn)} y2={toScreenY(b.armTopYIn)}
          stroke="#2b2b2b" strokeWidth={Math.max(0.25, gap || 0.35)}
        />
        <rect
          x={b.plateXIn - settings.hardware.plateSizeIn / 2}
          y={toScreenY(b.armTopYIn) - settings.hardware.plateSizeIn / 2}
          width={settings.hardware.plateSizeIn} height={settings.hardware.plateSizeIn}
          fill="#2b2b2b"
        />
      </g>

      {arms.map(({ arm, pairId }) => {
        const addr: SlotAddress = { wallIndex: wall.wallIndex, bracketNumber: b.number, arm };
        const pair = pairId ? byId.get(pairId) : undefined;
        const m = pair?.measurement;
        const dir = arm === 'left' ? -1 : 1;
        const heelX = b.plateXIn + dir * heelInset;
        const L = m?.lengthIn ?? 0;
        const H = m?.heightIn ?? 0;
        const x0 = arm === 'left' ? heelX - L : heelX;
        const isSelected =
          !!selected && selected.wallIndex === addr.wallIndex &&
          selected.bracketNumber === addr.bracketNumber && selected.arm === addr.arm;
        const isHighlight = !!pairId && pairId === highlightPairId;

        if (!pair || !m) {
          return (
            <g key={arm} data-slot={`${addr.wallIndex}|${addr.bracketNumber}|${addr.arm}`}>
              <rect
                x={arm === 'left' ? b.plateXIn - settings.hardware.bracketWidthIn / 2 : b.plateXIn}
                y={toScreenY(b.armTopYIn) - 3}
                width={settings.hardware.bracketWidthIn / 2} height={6}
                fill={isSelected ? 'rgba(110,168,254,.28)' : 'rgba(0,0,0,.08)'}
                stroke={isSelected ? '#6ea8fe' : 'rgba(0,0,0,.25)'}
                strokeWidth={0.3} strokeDasharray="1.5 1.5"
                style={{ cursor: interactive ? 'pointer' : 'default', touchAction: 'none' }}
                onPointerDown={(e) => { if (interactive) { e.preventDefault(); onSlotDown(addr, e.clientX, e.clientY); } }}
                onPointerUp={(e) => onSlotUp(e.clientX, e.clientY)}
              >
                <title>{`Empty ${arm} arm on bracket ${b.number}`}</title>
              </rect>
            </g>
          );
        }

        return (
          <g key={arm} data-slot={`${addr.wallIndex}|${addr.bracketNumber}|${addr.arm}`}>
            {/* shoe standing on the arm */}
            <ShoeImage
              pair={pair} x={x0} y={toScreenY(b.armTopYIn + H)} w={L} h={H}
              flipX={arm === 'left'} flipY={false}
            />
            {/* mirrored shoe hanging below */}
            <ShoeImage
              pair={pair} x={x0} y={toScreenY(b.armTopYIn - gap)} w={L} h={H}
              flipX={arm === 'left'} flipY
            />
            <rect
              x={x0} y={toScreenY(b.armTopYIn + H)} width={L} height={2 * H + gap}
              fill={isSelected ? 'rgba(110,168,254,.28)' : isHighlight ? 'rgba(255,193,77,.25)' : 'transparent'}
              stroke={isSelected ? '#6ea8fe' : isHighlight ? '#ffc14d' : 'transparent'}
              strokeWidth={0.4}
              style={{ cursor: interactive ? 'grab' : 'default', touchAction: 'none' }}
              onPointerDown={(e) => { if (interactive) { e.preventDefault(); onSlotDown(addr, e.clientX, e.clientY); } }}
              onPointerUp={(e) => onSlotUp(e.clientX, e.clientY)}
            >
              <title>{`${pair.name} — bracket ${b.number}, ${arm} arm`}</title>
            </rect>
            {showOverlay ? (
              <g pointerEvents="none">
                <line
                  x1={x0} x2={x0 + L}
                  y1={toScreenY(b.armTopYIn + H) - 1.4} y2={toScreenY(b.armTopYIn + H) - 1.4}
                  stroke="rgba(0,0,0,.6)" strokeWidth={0.18}
                />
                <text
                  x={x0 + L / 2} y={toScreenY(b.armTopYIn + H) - 2.1}
                  textAnchor="middle" fontSize={1.8} fill="rgba(0,0,0,.75)"
                >
                  {L.toFixed(1)}" × {H.toFixed(1)}"
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function ShoeImage({
  pair, x, y, w, h, flipX, flipY,
}: { pair: Pair; x: number; y: number; w: number; h: number; flipX: boolean; flipY: boolean }) {
  const url = useCutoutUrl(pair);
  const transforms: string[] = [];
  // Flip about the centre of the drawn box so the box itself stays put.
  if (flipX) transforms.push(`translate(${2 * x + w} 0) scale(-1 1)`);
  if (flipY) transforms.push(`translate(0 ${2 * y + h}) scale(1 -1)`);

  if (!url) {
    return (
      <rect
        x={x} y={y} width={w} height={h}
        fill="rgba(0,0,0,.18)" stroke="rgba(0,0,0,.35)" strokeWidth={0.2}
        pointerEvents="none"
      />
    );
  }
  return (
    <image
      href={url} x={x} y={y} width={w} height={h}
      preserveAspectRatio="none"
      transform={transforms.join(' ') || undefined}
      pointerEvents="none"
    />
  );
}

function useCutoutUrl(pair: Pair): string | null {
  const { imageEpoch } = useStore();
  const id = pair.cutoutImageId ?? pair.photoImageId;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let live = true;
    resolveImageUrl(id).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [id, imageEpoch]);
  return url;
}
