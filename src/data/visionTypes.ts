import type { RecognitionResult } from './recognition';
export type VisionState = 'cancelled' | 'timeout' | 'quota' | 'key' | 'unavailable' | 'invalid' | 'network' | 'spending-lock' | 'busy';
export class VisionError extends Error { constructor(public state: VisionState, message: string) { super(message); } }
export interface VisionOutcome { result: RecognitionResult; model: string; usedBackup: boolean }
export function normalizeVisionKey(key: string) {
  key = key.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').trim();
  if (!/^[\x21-\x7E]{20,4096}$/.test(key)) throw new VisionError('key', 'לא ניתן לקרוא את המפתח שהודבק. העתק רק את ערך המפתח, ללא רווחים פנימיים או טקסט נוסף.');
  return key;
}
