import type { Settings, Wall } from '../types';

export const DEFAULT_SETTINGS: Settings = {
  hardware: {
    bracketWidthIn: 16,
    armDepthIn: 2,
    plateSizeIn: 2,
    /**
     * Read off the manufacturer's spec sheet rather than measured: the bracket
     * is 8" overall in height, and the 2" mounting plate sits at the bottom, so
     * its centre is 1" up and the top of the arms is 7" above that.
     *
     * Worth a tape against a real bracket, because every drill height on the
     * install sheet is this number below where the shoes actually sit.
     */
    plateToArmTopIn: 7,
    /** Overall height of the bracket, from the spec sheet. */
    bracketHeightIn: 8,
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
    left: { isCorner: false, keepsClear: false, interlock: true },
    right: { isCorner: false, keepsClear: false, interlock: true },
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
