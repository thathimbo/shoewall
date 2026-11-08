// Canvas / ImageData helpers. No measurement logic lives here.

export async function fileToImageData(file: Blob, maxPixels = 12_000_000): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const scale = width * height > maxPixels ? Math.sqrt(maxPixels / (width * height)) : 1;
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get a 2D canvas context.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return ctx.getImageData(0, 0, width, height);
}

export function imageDataToCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context.');
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed.'))), type, quality);
  });
}

export async function imageDataToBlob(data: ImageData, type = 'image/png'): Promise<Blob> {
  return canvasToBlob(imageDataToCanvas(data), type);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error('Could not read blob.'));
    fr.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Downscale ImageData, keeping aspect, so the longest side is at most `max`. */
export function downscale(data: ImageData, max: number): ImageData {
  const longest = Math.max(data.width, data.height);
  if (longest <= max) return data;
  const scale = max / longest;
  const w = Math.max(1, Math.round(data.width * scale));
  const h = Math.max(1, Math.round(data.height * scale));
  const src = imageDataToCanvas(data);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get a 2D canvas context.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** A small PNG thumbnail of an RGBA ImageData, transparency preserved. */
export async function makeThumbnail(data: ImageData, max = 320): Promise<Blob> {
  return imageDataToBlob(downscale(data, max), 'image/png');
}
