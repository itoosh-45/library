import type { StoredImage } from './models';
import { LibraryValidationError } from './library';

export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function imageSignature(bytes: Uint8Array, type: string): boolean {
  return type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === 'image/png' ? [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)
    : type === 'image/webp' && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!imageSignature(bytes, 'image/jpeg') || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 255) return null;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) return null;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ([192, 193, 194].includes(marker) && length >= 8) return { height: bytes[offset + 3] * 256 + bytes[offset + 4], width: bytes[offset + 5] * 256 + bytes[offset + 6] };
    offset += length;
  }
  return null;
}
export async function prepareImage(file: File): Promise<StoredImage> {
  if (file.size > 12 * 1024 * 1024) throw new LibraryValidationError('התמונה גדולה מדי. בחר תמונה עד 12 מגה־בייט.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const heic = ['image/heic', 'image/heif'].includes(file.type);
  if (heic && (String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp' || !['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(String.fromCharCode(...bytes.slice(8, 12))))) throw new LibraryValidationError('קובץ HEIC אינו תקין. בחר JPEG או PNG.');
  if (!heic && !imageSignature(bytes, file.type)) throw new LibraryValidationError('בחר תמונת JPEG, PNG או WebP תקינה.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new LibraryValidationError('הדפדפן לא מצליח לקרוא את התמונה. שמור אותה כ־JPEG או PNG ונסה שוב.'); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60000000) throw new LibraryValidationError('ממדי התמונה גדולים מדי.');
    const ratio = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d'); if (!context) throw new Error('לא ניתן להכין תמונה.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.85, 0.7, 0.5, 0.3]) {
      blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 1024 * 1024) break;
    }
    if (!blob || blob.size > 1024 * 1024) throw new LibraryValidationError('לא ניתן להקטין את התמונה מספיק. בחר תמונה אחרת.');
    return { id: crypto.randomUUID(), blob, mimeType: 'image/jpeg', width: canvas.width, height: canvas.height, byteLength: blob.size, sha256: await hashBytes(await blob.arrayBuffer()), sourceUrl: null, createdAt: new Date().toISOString() };
  } finally { URL.revokeObjectURL(url); }
}
