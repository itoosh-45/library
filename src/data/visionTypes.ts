import type { RecognitionResult } from './recognition';
export type VisionState = 'cancelled' | 'timeout' | 'quota' | 'key' | 'unavailable' | 'invalid' | 'network' | 'spending-lock' | 'busy';
export type VisionDiagnostic = 'json' | 'shape' | 'truncated' | 'incomplete' | 'validation' | 'privacy' | 'safety';
export class VisionError extends Error { constructor(public state: VisionState, message: string, public httpStatus?: number, public diagnostic?: VisionDiagnostic, public model?: string) { super(message); } }
export interface VisionFailure { provider: 'Gemini' | 'Groq'; state: VisionState; httpStatus?: number; diagnostic?: VisionDiagnostic; model?: string }
export function visionFailureMessage(failure: VisionFailure): string {
  const reasons: Record<VisionState, string> = { key: 'המפתח או הרשאת הגישה נדחו', quota: failure.provider === 'Gemini' ? 'מכסה או מגבלת קצב; הזיהוי דרך Gemini מושהה עד ליום הספק הבא' : 'מכסה או מגבלת קצב; הזיהוי דרך Groq מושהה לפי זמן ההמתנה שלו', invalid: 'הבקשה או התשובה אינן תקינות', network: 'הבקשה לא הגיעה לשירות; ייתכן חיבור רשת או חסימה בדפדפן', unavailable: 'השירות אינו זמין', timeout: 'הבקשה לא הסתיימה בזמן', 'spending-lock': 'אישור המסלול החינמי או הסכמת השליחה חסרים', cancelled: 'הזיהוי בוטל', busy: 'זיהוי אחר כבר מתבצע' };
  const details: Record<VisionDiagnostic, string> = { json: 'התשובה אינה JSON תקין', shape: 'בתשובה חסרים פרטי הזיהוי הנדרשים', truncated: 'התשובה נקטעה בגלל מגבלת אורך', incomplete: 'המודל לא השלים את התשובה', validation: 'פרטי הספר אינם תואמים למבנה או לראיות הטקסט שבתשובה', privacy: 'התשובה נדחתה מטעמי פרטיות', safety: 'הספק עצר את הזיהוי בגלל מסנן תוכן' };
  return failure.provider + (failure.model ? ' · ' + failure.model : '') + ': ' + (failure.diagnostic ? details[failure.diagnostic] : reasons[failure.state]) + (failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : '') + '.';
}
export interface VisionOutcome { result: RecognitionResult; model: string; usedBackup: boolean }
export function normalizeVisionKey(key: string) {
  key = key.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '').trim();
  if (!/^[\x21-\x7E]{20,4096}$/.test(key)) throw new VisionError('key', 'לא ניתן לקרוא את המפתח שהודבק. העתק רק את ערך המפתח, ללא רווחים פנימיים או טקסט נוסף.');
  return key;
}
