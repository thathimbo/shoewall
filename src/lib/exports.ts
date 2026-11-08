// CSV builders for the install sheet and the catalog, plus whole-project JSON.
import type { Layout, Pair, ProjectFile, Settings, StoredImage, Wall } from '../types';
import { toCsv } from './csv';
import { blobToDataUrl, dataUrlToBlob } from './image';

const n = (v: number | null | undefined, places = 2) =>
  v === null || v === undefined ? '' : v.toFixed(places);

export const TOGGLE_ANCHOR_NOTE =
  'Brackets will often land between studs. Where a plate does not hit a stud, use heavy-duty toggle anchors rated for the load.';

export function installSheetCsv(layout: Layout, pairs: Pair[], settings: Settings): string {
  const byId = new Map(pairs.map((p) => [p.id, p] as const));
  const label = (id: string | null) => {
    if (!id) return '(empty)';
    const p = byId.get(id);
    if (!p) return '(missing pair)';
    return p.nickname ? `${p.name} (${p.nickname})` : p.name;
  };
  const rows: (string | number | null)[][] = [];
  rows.push(['ShoeWall install sheet']);
  rows.push(['Generated', new Date(layout.generatedAt).toISOString()]);
  rows.push(['Pattern', layout.pattern === 'grid' ? 'Straight grid' : 'Half-drop']);
  rows.push(['Note', TOGGLE_ANCHOR_NOTE]);
  if (settings.hardware.plateToArmTopIn === null) {
    rows.push(['WARNING', 'Plate-to-arm-top offset not measured — plate Y heights are blank.']);
  }
  rows.push([]);
  rows.push([
    'Wall', 'Bracket #', 'Row',
    'Plate centre X (in from left wall edge)',
    'Plate centre Y (in from floor)',
    'Arm top Y (in from floor)',
    'Left arm pair', 'Left length (in)', 'Left height (in)',
    'Right arm pair', 'Right length (in)', 'Right height (in)',
  ]);
  for (const wl of layout.walls) {
    for (const b of [...wl.brackets].sort((a, c) => a.number - c.number)) {
      const l = b.leftPairId ? byId.get(b.leftPairId) : undefined;
      const r = b.rightPairId ? byId.get(b.rightPairId) : undefined;
      rows.push([
        wl.wallName, b.number, b.rowIndex + 1,
        n(b.plateXIn), b.plateYIn === null ? 'NOT MEASURED' : n(b.plateYIn), n(b.armTopYIn),
        label(b.leftPairId), n(l?.measurement?.lengthIn), n(l?.measurement?.heightIn),
        label(b.rightPairId), n(r?.measurement?.lengthIn), n(r?.measurement?.heightIn),
      ]);
    }
  }
  return toCsv(rows);
}

export function catalogCsv(pairs: Pair[]): string {
  const rows: (string | number | null)[][] = [];
  rows.push([
    'Name', 'Nickname', 'Brand', 'Model', 'Colourway', 'Style code / SKU', 'Size',
    'Length (in)', 'Height (in)', 'Height class', 'Measurement source', 'Adjusted by hand',
    'Colours', 'Condition', 'Status',
    'Wall', 'Bracket #', 'Arm',
    'Purchase date', 'Purchase price', 'Bought from',
    'Times worn', 'Last worn', 'Tags', 'Notes',
  ]);
  for (const p of [...pairs].sort((a, b) => a.name.localeCompare(b.name))) {
    const last = lastWorn(p);
    rows.push([
      p.name, p.nickname ?? '', p.brand ?? '', p.model ?? '', p.colorway ?? '', p.styleCode ?? '', p.size ?? '',
      n(p.measurement?.lengthIn), n(p.measurement?.heightIn), p.heightClass ?? '',
      p.measurement?.source ?? '', p.measurement ? (p.measurement.adjustedByHand ? 'yes' : 'no') : '',
      p.colors.map((c) => c.hex).join(' '), p.condition ?? '', p.status,
      p.wallLocation?.wallName ?? '', p.wallLocation?.bracketNumber ?? '', p.wallLocation?.arm ?? '',
      p.purchaseDate ?? '', p.purchasePrice ?? '', p.purchasedFrom ?? '',
      p.wearLog.length, last ?? '', p.tags.join(' '), p.notes ?? '',
    ]);
  }
  return toCsv(rows);
}

export function lastWorn(p: Pair): string | null {
  if (!p.wearLog.length) return null;
  return p.wearLog.map((w) => w.date).sort().at(-1) ?? null;
}

export async function buildProjectFile(
  settings: Settings, walls: Wall[], pairs: Pair[], layout: Layout | null, images: StoredImage[],
): Promise<ProjectFile> {
  const encoded = await Promise.all(
    images.map(async (img) => {
      const { blob, ...rest } = img;
      return { ...rest, dataUrl: await blobToDataUrl(blob) };
    }),
  );
  return {
    format: 'shoewall-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings, walls, pairs, layout,
    images: encoded,
  };
}

export interface ParsedProject {
  settings: Settings;
  walls: Wall[];
  pairs: Pair[];
  layout: Layout | null;
  images: StoredImage[];
}

export async function parseProjectFile(text: string): Promise<ParsedProject> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const p = json as Partial<ProjectFile>;
  if (p.format !== 'shoewall-project') {
    throw new Error('That JSON is not a ShoeWall project file (missing "format": "shoewall-project").');
  }
  if (p.version !== 1) {
    throw new Error(`Unsupported project version ${String(p.version)}. This app reads version 1.`);
  }
  if (!p.settings || !Array.isArray(p.walls) || !Array.isArray(p.pairs)) {
    throw new Error('The project file is missing settings, walls or pairs.');
  }
  const images: StoredImage[] = await Promise.all(
    (p.images ?? []).map(async (img) => {
      const { dataUrl, ...rest } = img;
      return { ...rest, blob: await dataUrlToBlob(dataUrl) } as StoredImage;
    }),
  );
  return {
    settings: p.settings,
    walls: p.walls,
    pairs: p.pairs.map((x) => ({ ...x, wearLog: x.wearLog ?? [], tags: x.tags ?? [], colors: x.colors ?? [] })),
    layout: p.layout ?? null,
    images,
  };
}
