import { LibraryValidationError } from './library';

export type ImageCrop = [number, number, number, number];
export interface VisionImageSource { image: HTMLImageElement; url: string; width: number; height: number; dispose(): void }
export interface PreparedVisionImage { blob: Blob; width: number; height: number }
export const fullImage: ImageCrop = [0, 0, 1, 1];
async function encodeJPEG(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number): Promise<Blob | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const encoded = 'convertToBlob' in canvas ? canvas.convertToBlob({ type: 'image/jpeg', quality }) : new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    return await Promise.race([encoded, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('encode-timeout')), 1500); })]);
  } catch {
    // Some browser encoders do not settle. The already bounded canvas permits a local synchronous fallback.
    const fallback = document.createElement('canvas'); fallback.width = canvas.width; fallback.height = canvas.height;
    const context = fallback.getContext('2d'); if (!context) return null; context.drawImage(canvas, 0, 0);
    const data = fallback.toDataURL('image/jpeg', quality).split(',')[1]; if (!data) return null;
    const binary = atob(data); return new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: 'image/jpeg' });
  } finally { clearTimeout(timer); }
}
export function validateCrop(crop: ImageCrop): ImageCrop {
  if (!Array.isArray(crop) || crop.length !== 4 || crop.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) || crop[2] <= crop[0] || crop[3] <= crop[1]) throw new LibraryValidationError('בחר אזור תמונה בעל רוחב וגובה חיוביים.');
  return [...crop];
}
export async function loadVisionImage(file: File): Promise<VisionImageSource> {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new LibraryValidationError('בחר תמונה עד 20MB.');
  const url = URL.createObjectURL(file), image = new Image();
  const dispose = () => { image.src = ''; URL.revokeObjectURL(url); };
  try {
    image.src = url; try { await image.decode(); } catch { throw new LibraryValidationError('התמונה לא נפתחה בדפדפן. צלם או המר ל־JPEG ונסה שוב.'); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60000000) throw new LibraryValidationError('ממדי התמונה גדולים מדי.');
    return { image, url, width: image.naturalWidth, height: image.naturalHeight, dispose };
  } catch (cause) { dispose(); throw cause; }
}
export async function prepareVisionImage(source: VisionImageSource, crop: ImageCrop = fullImage, rotation: 0 | 90 | 180 | 270 = 0, localOcr = false): Promise<PreparedVisionImage> {
  validateCrop(crop); if (![0, 90, 180, 270].includes(rotation)) throw new LibraryValidationError('סיבוב התמונה אינו תקין.');
  const x = Math.round(crop[0] * source.width), y = Math.round(crop[1] * source.height), width = Math.max(1, Math.round((crop[2] - crop[0]) * source.width)), height = Math.max(1, Math.round((crop[3] - crop[1]) * source.height));
  const canvas = typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.convertToBlob === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas'), quarterTurn = rotation === 90 || rotation === 270;
  for (const longestEdge of localOcr ? [2000, 1600, 1200, 900] : [1200, 900, 600, 300]) {
    const scale = Math.min(1, longestEdge / Math.max(width, height)), outputWidth = Math.max(1, Math.round(width * scale)), outputHeight = Math.max(1, Math.round(height * scale));
    canvas.width = quarterTurn ? outputHeight : outputWidth; canvas.height = quarterTurn ? outputWidth : outputHeight;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null; if (!context) throw new LibraryValidationError('לא ניתן להכין את התמונה בדפדפן הזה.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    if (rotation === 90) context.translate(canvas.width, 0); if (rotation === 180) context.translate(canvas.width, canvas.height); if (rotation === 270) context.translate(0, canvas.height);
    context.rotate(rotation * Math.PI / 180); context.drawImage(source.image, x, y, Math.min(width, source.width - x), Math.min(height, source.height - y), 0, 0, outputWidth, outputHeight);
    for (const quality of localOcr ? [0.92, 0.85] : [0.75, 0.65, 0.55]) {
      const blob = await encodeJPEG(canvas, quality);
      if (blob && blob.size <= (localOcr ? 2 * 1024 * 1024 : 500 * 1024)) return { blob, width: canvas.width, height: canvas.height };
    }
  }
  throw new LibraryValidationError('הדפדפן לא הצליח להכין את התמונה לשליחה. נסה לבחור אותה מחדש.');
}
