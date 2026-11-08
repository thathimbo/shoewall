import type { Settings, Wall } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  hardware: {
    bracketWidthIn: 16,
    armDepthIn: 2,
    plateSizeIn: 2,
    // Not measured yet. Everything that needs it says so instead of guessing.
    plateToArmTopIn: null,
    heelInsetFromCenterIn: 0,
    pairGapIn: 0,
  },
  spacing: {
    toeGapIn: 1.25,
    rowGapIn: 0.5,
    cornerClearanceIn: 8,
  },
  // Classification cut-offs only — these describe the buckets, not any shoe.
  heightClass: { lowMaxIn: 4.5, midMaxIn: 6.5 },
  paper: { widthIn: 8.5, heightIn: 11, label: 'US Letter' },
  wallColorHex: '#d8d4cc',
  bracketCount: null,
};

export function makeDefaultWalls(): Wall[] {
  const mk = (i: number): Wall => ({
    id: `wall-${i + 1}`,
    name: `Wall ${i + 1}`,
    widthIn: 150,
    bandBottomIn: null,
    bandTopIn: null,
    left: { isCorner: false, keepsClear: false },
    right: { isCorner: false, keepsClear: false },
  });
  return [mk(0), mk(1), mk(2)];
}

export function classifyHeight(
  heightIn: number,
  t: Settings['heightClass'],
): 'low' | 'mid' | 'high' {
  if (heightIn <= t.lowMaxIn) return 'low';
  if (heightIn <= t.midMaxIn) return 'mid';
  return 'high';
}
