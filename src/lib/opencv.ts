// Loads the prebuilt opencv.js from /vendor/opencv.js on demand.
// It is ~13 MB, so it is never part of the app bundle and never loaded until
// the first capture. Types come from @techstark/opencv-js (type-only import,
// erased at build time).
import type * as CV from '@techstark/opencv-js';

type Cv = typeof CV;

/**
 * Builds of opencv.js differ in how they hand over the module:
 *  - OpenCV 5.x assigns `window.cv` a Promise that resolves to the module;
 *  - some builds assign a factory function returning that Promise;
 *  - older Emscripten builds assign a module and call `onRuntimeInitialized`;
 *  - a few assign the ready module outright.
 * All four are handled here so a version bump does not silently hang the
 * capture screen.
 */
type CvGlobal =
  | (Partial<Cv> & { onRuntimeInitialized?: () => void })
  | PromiseLike<Cv>
  | (() => PromiseLike<Cv>);

// @techstark/opencv-js already declares a global `cv`, so read and write the
// real global through a narrow view of our own instead of re-declaring it.
const globalCv = globalThis as { cv?: CvGlobal };

let ready: Cv | null = null;
let loading: Promise<Cv> | null = null;

export const OPENCV_URL = `${import.meta.env.BASE_URL}vendor/opencv.js`;

export function openCvLoadState(): 'unloaded' | 'loading' | 'ready' {
  if (ready) return 'ready';
  return loading ? 'loading' : 'unloaded';
}

const isThenable = (v: unknown): v is PromiseLike<Cv> =>
  !!v && typeof (v as PromiseLike<Cv>).then === 'function';
const isReady = (v: unknown): v is Cv =>
  !!v && typeof (v as Cv).Mat === 'function';

async function adoptGlobal(): Promise<Cv> {
  const g = globalCv.cv;
  if (!g) throw new Error('OpenCV.js loaded but window.cv was never set.');
  if (isReady(g)) return g;
  if (isThenable(g)) return await g;
  if (typeof g === 'function') return await (g as () => PromiseLike<Cv>)();
  // Emscripten module that still has to finish initialising.
  return await new Promise<Cv>((resolve, reject) => {
    const mod = g as Partial<Cv> & { onRuntimeInitialized?: () => void };
    const timer = setTimeout(
      () => reject(new Error('OpenCV.js did not finish initialising within 60 seconds.')),
      60_000,
    );
    mod.onRuntimeInitialized = () => {
      clearTimeout(timer);
      const now = globalCv.cv;
      if (isReady(now)) resolve(now);
      else reject(new Error('OpenCV.js initialised but exposes no Mat constructor.'));
    };
  });
}

export function loadOpenCv(): Promise<Cv> {
  if (typeof window === 'undefined') return Promise.reject(new Error('OpenCV.js needs a browser.'));
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;

  loading = (async () => {
    if (!globalCv.cv) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>('script[data-shoewall-opencv]');
        if (existing) {
          existing.addEventListener('load', () => resolve(), { once: true });
          existing.addEventListener('error', () => reject(scriptError()), { once: true });
          return;
        }
        const script = document.createElement('script');
        script.src = OPENCV_URL;
        script.async = true;
        script.dataset.shoewallOpencv = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(scriptError());
        document.head.appendChild(script);
      });
    }
    const cv = await adoptGlobal();
    // Keep the resolved module on the global so a second script tag is never added.
    globalCv.cv = cv;
    ready = cv;
    return cv;
  })().catch((err) => {
    loading = null;
    throw err;
  });

  return loading;
}

function scriptError(): Error {
  return new Error(
    `Could not load OpenCV.js from ${OPENCV_URL}. Run "npm run prepare:opencv" (or "npm install") so the file exists in public/vendor/, then reload.`,
  );
}
