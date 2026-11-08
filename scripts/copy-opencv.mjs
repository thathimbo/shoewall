// Copies the prebuilt opencv.js (~13 MB) out of node_modules into public/vendor
// so the browser can load it on demand with a <script> tag. Keeping it out of
// the bundle means Vite never has to parse or transform it.
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../node_modules/@techstark/opencv-js/dist/opencv.js');
const dest = resolve(here, '../public/vendor/opencv.js');

if (!existsSync(src)) {
  console.error('[copy-opencv] not found: ' + src + '\nRun `npm install` first.');
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
if (existsSync(dest) && statSync(dest).size === statSync(src).size) {
  console.log('[copy-opencv] up to date');
} else {
  copyFileSync(src, dest);
  console.log('[copy-opencv] copied ' + (statSync(dest).size / 1e6).toFixed(1) + ' MB -> public/vendor/opencv.js');
}
