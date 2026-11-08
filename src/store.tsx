import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import type { Layout, Pair, Settings, StoredImage, Wall } from './types';
import * as db from './lib/db';
import { DEFAULT_SETTINGS, makeDefaultWalls } from './lib/defaults';

interface Store {
  ready: boolean;
  pairs: Pair[];
  settings: Settings;
  walls: Wall[];
  layout: Layout | null;

  savePair: (p: Pair) => Promise<void>;
  savePairs: (p: Pair[]) => Promise<void>;
  removePair: (id: string) => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  saveWalls: (w: Wall[]) => Promise<void>;
  setLayout: (l: Layout | null) => Promise<void>;
  addImage: (img: StoredImage) => Promise<void>;
  removeImage: (id: string) => Promise<void>;
  replaceAll: (data: {
    settings: Settings; walls: Wall[]; pairs: Pair[]; layout: Layout | null; images: StoredImage[];
  }) => Promise<void>;
  wipe: () => Promise<void>;
  /** Bumped whenever an image is written, so thumbnails re-resolve. */
  imageEpoch: number;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [walls, setWallsState] = useState<Wall[]>(makeDefaultWalls);
  const [layout, setLayoutState] = useState<Layout | null>(null);
  const [imageEpoch, setImageEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, s, w, l] = await Promise.all([
        db.getAllPairs(), db.loadSettings(), db.loadWalls(), db.loadLayout(),
      ]);
      if (cancelled) return;
      setPairs(p);
      // Merge so a project saved by an older build still gets every field.
      setSettingsState({
        ...DEFAULT_SETTINGS, ...s,
        hardware: { ...DEFAULT_SETTINGS.hardware, ...s.hardware },
        spacing: { ...DEFAULT_SETTINGS.spacing, ...s.spacing },
        heightClass: { ...DEFAULT_SETTINGS.heightClass, ...s.heightClass },
        paper: { ...DEFAULT_SETTINGS.paper, ...s.paper },
      });
      setWallsState(w);
      setLayoutState(l);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const savePair = useCallback(async (p: Pair) => {
    const stamped = { ...p, updatedAt: Date.now() };
    await db.putPair(stamped);
    setPairs((prev) => {
      const i = prev.findIndex((x) => x.id === stamped.id);
      if (i === -1) return [...prev, stamped];
      const next = [...prev];
      next[i] = stamped;
      return next;
    });
  }, []);

  const savePairs = useCallback(async (list: Pair[]) => {
    const stamped = list.map((p) => ({ ...p, updatedAt: Date.now() }));
    await db.putPairs(stamped);
    setPairs((prev) => {
      const map = new Map(prev.map((p) => [p.id, p] as const));
      for (const p of stamped) map.set(p.id, p);
      return [...map.values()];
    });
  }, []);

  const removePair = useCallback(async (id: string) => {
    await db.deletePair(id);
    setPairs((prev) => prev.filter((p) => p.id !== id));
    setImageEpoch((e) => e + 1);
  }, []);

  const saveSettings = useCallback(async (s: Settings) => {
    await db.saveSettings(s);
    setSettingsState(s);
  }, []);

  const saveWalls = useCallback(async (w: Wall[]) => {
    await db.saveWalls(w);
    setWallsState(w);
  }, []);

  const setLayout = useCallback(async (l: Layout | null) => {
    await db.saveLayout(l);
    setLayoutState(l);
  }, []);

  const addImage = useCallback(async (img: StoredImage) => {
    await db.putImage(img);
    setImageEpoch((e) => e + 1);
  }, []);

  const removeImage = useCallback(async (id: string) => {
    await db.deleteImage(id);
    releaseImageUrl(id);
    setImageEpoch((e) => e + 1);
  }, []);

  const replaceAll = useCallback<Store['replaceAll']>(async (data) => {
    await db.wipeAll();
    clearImageUrlCache();
    await Promise.all([
      db.saveSettings(data.settings),
      db.saveWalls(data.walls),
      db.saveLayout(data.layout),
      db.putPairs(data.pairs),
      db.putImages(data.images),
    ]);
    setSettingsState(data.settings);
    setWallsState(data.walls);
    setLayoutState(data.layout);
    setPairs(data.pairs);
    setImageEpoch((e) => e + 1);
  }, []);

  const wipe = useCallback(async () => {
    await db.wipeAll();
    clearImageUrlCache();
    setPairs([]);
    setSettingsState(DEFAULT_SETTINGS);
    setWallsState(makeDefaultWalls());
    setLayoutState(null);
    setImageEpoch((e) => e + 1);
  }, []);

  // Keep each pair's wall location in step with the saved layout. Derived data:
  // never typed by hand, and cleared when a pair leaves the wall.
  const syncing = useRef(false);
  useEffect(() => {
    if (!ready || syncing.current) return;
    const next = new Map<string, Pair['wallLocation']>();
    if (layout) {
      for (const wl of layout.walls) {
        for (const b of wl.brackets) {
          if (b.leftPairId) next.set(b.leftPairId, { wallIndex: wl.wallIndex, wallName: wl.wallName, bracketNumber: b.number, arm: 'left' });
          if (b.rightPairId) next.set(b.rightPairId, { wallIndex: wl.wallIndex, wallName: wl.wallName, bracketNumber: b.number, arm: 'right' });
        }
      }
    }
    const changed = pairs.filter((p) => {
      const want = next.get(p.id) ?? null;
      return JSON.stringify(want) !== JSON.stringify(p.wallLocation);
    });
    if (!changed.length) return;
    syncing.current = true;
    const updated = changed.map((p) => {
      const want = next.get(p.id) ?? null;
      // A pair that lands on the wall is on the wall; one that leaves goes back
      // to storage unless the user had already marked it "not on rack".
      const status: Pair['status'] = want ? 'on-wall' : p.status === 'not-on-rack' ? 'not-on-rack' : 'in-storage';
      return { ...p, wallLocation: want, status };
    });
    savePairs(updated).finally(() => { syncing.current = false; });
  }, [layout, pairs, ready, savePairs]);

  const value = useMemo<Store>(
    () => ({
      ready, pairs, settings, walls, layout,
      savePair, savePairs, removePair, saveSettings, saveWalls, setLayout,
      addImage, removeImage, replaceAll, wipe, imageEpoch,
    }),
    [ready, pairs, settings, walls, layout, savePair, savePairs, removePair,
     saveSettings, saveWalls, setLayout, addImage, removeImage, replaceAll, wipe, imageEpoch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside <StoreProvider>.');
  return v;
}

// --- image URL cache -------------------------------------------------------

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

function releaseImageUrl(id: string) {
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(id);
  pending.delete(id);
}
function clearImageUrlCache() {
  for (const u of urlCache.values()) URL.revokeObjectURL(u);
  urlCache.clear();
  pending.clear();
}

export function resolveImageUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return Promise.resolve(cached);
  const p = pending.get(id);
  if (p) return p;
  const task = db.getImage(id).then((img) => {
    if (!img) return null;
    const url = URL.createObjectURL(img.blob);
    urlCache.set(id, url);
    return url;
  }).finally(() => pending.delete(id));
  pending.set(id, task);
  return task;
}

/** Resolves a stored image id to an object URL. null while loading or missing. */
export function useImageUrl(id: string | null | undefined): string | null {
  const { imageEpoch } = useStore();
  const [url, setUrl] = useState<string | null>(() => (id ? urlCache.get(id) ?? null : null));
  useEffect(() => {
    if (!id) { setUrl(null); return; }
    let live = true;
    resolveImageUrl(id).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [id, imageEpoch]);
  return url;
}
