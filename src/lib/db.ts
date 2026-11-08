// IndexedDB persistence. Everything the app knows lives here; nothing leaves
// the browser.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Layout, Pair, Settings, StoredImage, Wall } from '../types';
import { DEFAULT_SETTINGS, makeDefaultWalls } from './defaults';

interface ShoeWallDB extends DBSchema {
  pairs: { key: string; value: Pair };
  images: { key: string; value: StoredImage; indexes: { byPair: string } };
  meta: { key: string; value: unknown };
}

const DB_NAME = 'shoewall';
const DB_VERSION = 1;

let dbp: Promise<IDBPDatabase<ShoeWallDB>> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB<ShoeWallDB>(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('pairs')) d.createObjectStore('pairs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('images')) {
          const s = d.createObjectStore('images', { keyPath: 'id' });
          s.createIndex('byPair', 'pairId');
        }
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      },
    });
  }
  return dbp;
}

export async function getAllPairs(): Promise<Pair[]> {
  return (await db()).getAll('pairs');
}
export async function putPair(pair: Pair): Promise<void> {
  await (await db()).put('pairs', pair);
}
export async function putPairs(pairs: Pair[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('pairs', 'readwrite');
  await Promise.all([...pairs.map((p) => tx.store.put(p)), tx.done]);
}
export async function deletePair(id: string): Promise<void> {
  const d = await db();
  const imgs = await d.getAllFromIndex('images', 'byPair', id);
  const tx = d.transaction(['pairs', 'images'], 'readwrite');
  await Promise.all([
    tx.objectStore('pairs').delete(id),
    ...imgs.map((i) => tx.objectStore('images').delete(i.id)),
    tx.done,
  ]);
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return (await db()).get('images', id);
}
export async function getImagesForPair(pairId: string): Promise<StoredImage[]> {
  return (await db()).getAllFromIndex('images', 'byPair', pairId);
}
export async function getAllImages(): Promise<StoredImage[]> {
  return (await db()).getAll('images');
}
export async function putImage(img: StoredImage): Promise<void> {
  await (await db()).put('images', img);
}
export async function putImages(imgs: StoredImage[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('images', 'readwrite');
  await Promise.all([...imgs.map((i) => tx.store.put(i)), tx.done]);
}
export async function deleteImage(id: string): Promise<void> {
  await (await db()).delete('images', id);
}

async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const v = await (await db()).get('meta', key);
  return (v as T | undefined) ?? fallback;
}
async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}

export const loadSettings = () => getMeta<Settings>('settings', DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => setMeta('settings', s);
export const loadWalls = () => getMeta<Wall[]>('walls', makeDefaultWalls());
export const saveWalls = (w: Wall[]) => setMeta('walls', w);
export const loadLayout = () => getMeta<Layout | null>('layout', null);
export const saveLayout = (l: Layout | null) => setMeta('layout', l);

export async function wipeAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['pairs', 'images', 'meta'], 'readwrite');
  await Promise.all([
    tx.objectStore('pairs').clear(),
    tx.objectStore('images').clear(),
    tx.objectStore('meta').clear(),
    tx.done,
  ]);
}

export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
