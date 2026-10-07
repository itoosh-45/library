import { parseISBN } from './books';
import { LibraryValidationError } from './library';

export type IdentifierKind = 'isbn' | 'danacode';
export function identifierValue(value: string, kind: IdentifierKind): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new LibraryValidationError('הזן מזהה באורך עד 300 תווים.');
  if (kind === 'danacode') return value.trim();
  const parsed = parseISBN(value); return parsed.isbn13 ?? parsed.isbn10!;
}
export function scannedIdentifier(value: string): { value: string; isbn: boolean } {
  try { return { value: identifierValue(value, 'isbn'), isbn: true }; }
  catch { return { value: value.slice(0, 300), isbn: false }; }
}
export type BarcodeDecoder = (canvas: HTMLCanvasElement) => Promise<string | undefined>;
interface NativeDetector { detect(source: HTMLCanvasElement): Promise<{ rawValue: string }[]> }
interface NativeDetectorConstructor { new(options: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> }
export async function barcodeDecoder(): Promise<BarcodeDecoder> {
  let fallback: Promise<BarcodeDecoder> | undefined;
  const local = () => fallback ??= zxingDecoder();
  const Constructor = (globalThis as unknown as { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector;
  if (Constructor) {
    try { const formats = (await Constructor.getSupportedFormats()).filter(format => ['ean_13', 'ean_8', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'upc_a', 'upc_e'].includes(format)); if (formats.length) { const detector = new Constructor({ formats }); let failed = false; return async canvas => { if (!failed) { try { const value = (await detector.detect(canvas)).find(result => result.rawValue)?.rawValue; if (value) return value; } catch { failed = true; } } return (await local())(canvas); }; } } catch { /* Use local fallback if native initialization fails. */ }
  }
  return local();
}
async function zxingDecoder(): Promise<BarcodeDecoder> {
  const [{ BrowserMultiFormatOneDReader }, { DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const reader = new BrowserMultiFormatOneDReader(new Map([[DecodeHintType.TRY_HARDER, true]]));
  let rotated: HTMLCanvasElement | undefined;
  return async canvas => {
    try { return reader.decodeFromCanvas(canvas).getText(); } catch { /* Try the other barcode orientation locally. */ }
    rotated ??= document.createElement('canvas'); rotated.width = canvas.height; rotated.height = canvas.width;
    const context = rotated.getContext('2d', { willReadFrequently: true }); if (!context) return undefined;
    context.translate(rotated.width, 0); context.rotate(Math.PI / 2); context.drawImage(canvas, 0, 0);
    try { return reader.decodeFromCanvas(rotated).getText(); } catch { return undefined; }
  };
}
interface ScannerOptions {
  video: HTMLVideoElement; onCode: (value: string) => void; onError: (message: string) => void; onReady: (capabilities: { torch: boolean; focus: boolean }) => void;
  media?: Pick<MediaDevices, 'getUserMedia'>; decoder?: () => Promise<BarcodeDecoder>; canvas?: () => HTMLCanvasElement;
}
type ExtraConstraints = MediaTrackConstraintSet & { torch?: boolean; focusMode?: string };
export class CameraScanner {
  private sequence = 0;
  private stream?: MediaStream;
  private timer?: ReturnType<typeof setTimeout>;
  private removeEnded?: () => void;
  crop = true;
  constructor(private options: ScannerOptions) {}
  stop() {
    this.sequence++; clearTimeout(this.timer); this.removeEnded?.(); this.removeEnded = undefined;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.options.video.pause(); this.options.video.srcObject = null;
  }
  async start() {
    this.stop(); const sequence = this.sequence;
    try {
      const media = this.options.media ?? navigator.mediaDevices;
      if (!media?.getUserMedia) throw new Error('camera-unavailable');
      const stream = await media.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (sequence !== this.sequence) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream; const track = stream.getVideoTracks()[0]; if (!track) throw new Error('camera-unavailable');
      const ended = () => { if (sequence === this.sequence) { this.stop(); this.options.onError('המצלמה נותקה. אפשר לבחור תמונה או להקליד.'); } }; track.addEventListener('ended', ended); this.removeEnded = () => track.removeEventListener('ended', ended);
      this.options.video.srcObject = stream; await this.options.video.play();
      const decode = await (this.options.decoder ?? barcodeDecoder)(); if (sequence !== this.sequence) return;
      const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      this.options.onReady({ torch: capabilities?.torch === true, focus: capabilities?.focusMode?.includes('single-shot') === true });
      const canvas = (this.options.canvas ?? (() => document.createElement('canvas')))();
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('canvas-unavailable');
      const tick = async () => {
        if (sequence !== this.sequence) return;
        const video = this.options.video, width = video.videoWidth, height = video.videoHeight;
        if (width && height) {
          const cropWidth = this.crop ? width * 0.9 : width, cropHeight = this.crop ? height * 0.55 : height, scale = Math.min(1, 1280 / cropWidth);
          canvas.width = Math.round(cropWidth * scale); canvas.height = Math.round(cropHeight * scale);
          let value: string | undefined; try { context.drawImage(video, (width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height); value = await decode(canvas); } catch { /* Unreadable frame; no stored frame or network request. */ }
          if (sequence !== this.sequence) return;
          if (value) { this.stop(); this.options.onCode(value); return; }
        }
        this.timer = setTimeout(() => void tick(), 350);
      };
      void tick();
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.stop(); const name = error instanceof Error ? error.name : '';
      this.options.onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'לא ניתנה הרשאה למצלמה. אפשר לבחור תמונה או להקליד.' : 'המצלמה לא נפתחה. אפשר לבחור תמונה או להקליד.');
    }
  }
  async torch(value: boolean) { await this.constraint({ torch: value }); }
  async focus() { await this.constraint({ focusMode: 'single-shot' }); }
  private async constraint(value: ExtraConstraints) { const track = this.stream?.getVideoTracks()[0]; if (!track) throw new Error('camera-unavailable'); await track.applyConstraints({ advanced: [value] }); }
}
export async function decodeBarcodeFile(file: File, decoder: () => Promise<BarcodeDecoder> = barcodeDecoder): Promise<string | undefined> {
  if ((!/^image\//.test(file.type) && !(!file.type && /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))) || !file.size || file.size > 20 * 1024 * 1024) throw new LibraryValidationError('בחר תמונה עד 20MB. לתמונת HEIC שאינה נפתחת, המר ל־JPEG.');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60000000) throw new Error('image-size');
    const canvas = document.createElement('canvas'), decode = await decoder();
    for (const [edge, fraction] of [[2048, 1], [3000, 1], [2048, 0.6]]) {
      const width = image.naturalWidth * fraction, height = image.naturalHeight * fraction, scale = Math.min(1, edge / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error();
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, (image.naturalWidth - width) / 2, (image.naturalHeight - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
      const value = await decode(canvas); if (value) return value;
    }
    return undefined;
  } catch { throw new LibraryValidationError('התמונה לא פוענחה. נסה צילום ברור ב־JPEG או הקלד את המזהה.'); }
  finally { URL.revokeObjectURL(url); image.src = ''; }
}
