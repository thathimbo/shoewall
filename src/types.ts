// ---------------------------------------------------------------------------
// Domain types. All linear measurements are INCHES unless a name says otherwise.
// `null` means "not measured / not entered yet" and must be surfaced in the UI,
// never silently replaced with a default.
// ---------------------------------------------------------------------------

export type HeightClass = 'low' | 'mid' | 'high';
export type Condition = 'deadstock' | 'like-new' | 'worn' | 'beater';
export type PairStatus = 'on-wall' | 'in-storage' | 'not-on-rack';

export interface Swatch {
  /** sRGB hex, e.g. "#1b2a3c" */
  hex: string;
  /** Share of the cutout pixels this cluster covers, 0..1 */
  weight: number;
}

export interface StoredImage {
  id: string;
  pairId: string;
  kind: 'layout-photo' | 'warped' | 'cutout' | 'extra' | 'tag';
  /** image/png or image/jpeg blob */
  blob: Blob;
  width: number;
  height: number;
  label?: string;
  createdAt: number;
}

export interface Measurement {
  /** Heel-to-toe, inches. */
  lengthIn: number;
  /** Sole-to-collar, inches. */
  heightIn: number;
  /** Pixels per inch of the perspective-corrected image this came from. */
  ppi: number;
  /** How the numbers were arrived at — shown in the UI so nothing looks more certain than it is. */
  source: 'paper-detected' | 'manual-ppi' | 'typed';
  /** True when the user moved the handles after the automatic pass. */
  adjustedByHand: boolean;
}

export interface WearEntry {
  /** ISO date, YYYY-MM-DD */
  date: string;
}

export interface Pair {
  id: string;
  name: string;
  nickname?: string;
  tags: string[];

  measurement: Measurement | null;
  heightClass: HeightClass | null;
  /** Set true once the user overrides the automatic height class. */
  heightClassManual: boolean;

  colors: Swatch[];

  /** id of the StoredImage with kind 'cutout' */
  cutoutImageId: string | null;
  /** id of the StoredImage with kind 'layout-photo' */
  photoImageId: string | null;
  extraImageIds: string[];
  tagImageIds: string[];

  // --- catalog fields (all optional) ---
  brand?: string;
  model?: string;
  colorway?: string;
  styleCode?: string;
  size?: string;
  purchaseDate?: string;
  purchasePrice?: number | null;
  purchasedFrom?: string;
  condition?: Condition;
  status: PairStatus;
  notes?: string;

  /** Derived from the saved layout; never typed by hand. */
  wallLocation: {
    wallIndex: number;
    wallName: string;
    bracketNumber: number;
    arm: 'left' | 'right';
  } | null;

  wearLog: WearEntry[];

  createdAt: number;
  updatedAt: number;
}

export interface WallEnd {
  /** Is this end of the wall a corner shared with another wall in the set? */
  isCorner: boolean;
  /** When a corner: does THIS wall keep the clearance clear (true) or does the neighbour (false)? */
  keepsClear: boolean;
}

export interface Wall {
  id: string;
  name: string;
  /** inches, left-to-right */
  widthIn: number;
  /** inches from the floor; null until entered */
  bandBottomIn: number | null;
  /** inches from the floor; null until entered */
  bandTopIn: number | null;
  left: WallEnd;
  right: WallEnd;
}

export interface HardwareSettings {
  /** Overall bracket width, inches. */
  bracketWidthIn: number;
  /** Arm depth off the wall, inches. */
  armDepthIn: number;
  /** Mounting plate, inches square. */
  plateSizeIn: number;
  /**
   * Vertical distance from the mounting plate CENTRE up to the TOP of the arms.
   * null until measured — install-sheet Y values are blocked while it is null.
   */
  plateToArmTopIn: number | null;
  /** Horizontal distance from bracket centre to where a heel sits. 0 = heels meet at centre. */
  heelInsetFromCenterIn: number;
  /** Vertical gap between the upright shoe and the mirrored shoe hanging below it. */
  pairGapIn: number;
}

export interface SpacingSettings {
  /** Between the toes of neighbouring columns. */
  toeGapIn: number;
  /** Between rows. */
  rowGapIn: number;
  /** Kept clear at a shared corner by whichever wall yields. */
  cornerClearanceIn: number;
}

export interface Settings {
  hardware: HardwareSettings;
  spacing: SpacingSettings;
  /** Height-class cut-offs, inches. Classification only — not a measurement of any shoe. */
  heightClass: { lowMaxIn: number; midMaxIn: number };
  /** Paper used for scale. */
  paper: { widthIn: number; heightIn: number; label: string };
  wallColorHex: string;
  bracketCount: number | null;
}

// --- layout ---

export type Arm = 'left' | 'right';
export type PatternMode = 'grid' | 'half-drop';
export type ColorMode = 'contrast' | 'gradient';

export interface Bracket {
  /** 1-based, per wall. */
  number: number;
  rowIndex: number;
  /** Position within the row, 0-based left to right. */
  colIndex: number;
  /** Mounting-plate centre, inches from the left wall edge. */
  plateXIn: number;
  /** Top of the arms, inches from the floor. */
  armTopYIn: number;
  /**
   * Mounting-plate centre, inches from the floor.
   * null when settings.hardware.plateToArmTopIn has not been measured.
   */
  plateYIn: number | null;
  leftPairId: string | null;
  rightPairId: string | null;
  /** Extent of the loaded bracket, for drawing and overlap checks. */
  extent: { x0: number; x1: number; y0: number; y1: number };
}

export interface LayoutRow {
  rowIndex: number;
  /** Tallest pair height in this row, inches. */
  maxPairHeightIn: number;
  /** 2 * maxPairHeight + pairGap */
  heightIn: number;
  /** Bottom of the row band, inches from the floor. */
  bottomYIn: number;
  bracketNumbers: number[];
  /** Half-drop vertical offset applied to odd columns in this row, inches. */
  halfDropOffsetIn: number;
}

export interface WallLayout {
  wallId: string;
  wallIndex: number;
  wallName: string;
  widthIn: number;
  /** Usable X range after corner clearance. */
  usableX: { x0: number; x1: number };
  usableY: { y0: number; y1: number };
  rows: LayoutRow[];
  brackets: Bracket[];
  warnings: string[];
}

export interface Layout {
  pattern: PatternMode;
  colorMode: ColorMode;
  walls: WallLayout[];
  /** Pair ids the generator could not place. */
  unplacedPairIds: string[];
  bracketsUsed: number;
  bracketsOwned: number | null;
  /** Total arm slots across every wall. */
  slotCount: number;
  notes: string[];
  generatedAt: number;
  /** Pairs the user explicitly excluded before generating. */
  excludedPairIds: string[];
  seed: number;
}

export interface ProjectFile {
  format: 'shoewall-project';
  version: 1;
  exportedAt: string;
  settings: Settings;
  walls: Wall[];
  pairs: Pair[];
  layout: Layout | null;
  /** Images as data URLs so the backup is one self-contained file. */
  images: Array<Omit<StoredImage, 'blob'> & { dataUrl: string }>;
}
