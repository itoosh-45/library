import { imageSignature } from './images';
import { recognitionModels, recognitionPrompt, recognitionSchema, shelfRecognitionPrompt, shelfRecognitionSchema, validateRecognition, validateShelfRecognition, type RecognitionResult } from './recognition';

export const visionModels = recognitionModels;
export type VisionState = 'cancelled' | 'timeout' | 'quota' | 'key' | 'unavailable' | 'invalid' | 'network' | 'spending-lock' | 'busy';
export class VisionError extends Error { constructor(public state: VisionState, message: string) { super(message); } }
export interface VisionOutcome { result: RecognitionResult; model: string; usedBackup: boolean }
const error = (state: VisionState, message: string): never => { throw new VisionError(state, message); };
async function responseValue(response: Response, key: string): Promise<Record<string, unknown>> {
  if (!response.body) return error('invalid', 'תגובת הזיהוי ריקה.');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let length = 0, value = '';
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 128 * 1024) return error('invalid', 'תגובת הזיהוי גדולה מדי.'); value += decoder.decode(part.value, { stream: true }); }
    value += decoder.decode(); if (value.includes(key)) return error('invalid', 'תגובת הזיהוי נדחתה מטעמי פרטיות.');
    const parsed: unknown = JSON.parse(value); if (JSON.stringify(parsed).includes(key)) return error('invalid', 'תגובת הזיהוי נדחתה מטעמי פרטיות.'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return error('invalid', 'תגובת הזיהוי אינה תקינה.'); return parsed as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => {}); }
}
async function jpegBase64(blob: Blob): Promise<string> {
  if (blob.type !== 'image/jpeg' || !blob.size || blob.size > 1.5 * 1024 * 1024) return error('invalid', 'יש להכין תמונת JPEG עד 1.5MB לפני שליחה.');
  const bytes = new Uint8Array(await blob.arrayBuffer()); if (!imageSignature(bytes, 'image/jpeg')) return error('invalid', 'תמונת הזיהוי אינה תקינה.');
  let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192)); return btoa(binary);
}
/** Key and consent are session-only; each new key resets the cost verification. No storage or logs. */
export class VisionSession {
  #key = ''; #freeTierVerified = false; #consent = false; #quotaStopped = false;
  #controller?: AbortController; #sequence = 0;
  constructor(private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init), private timeoutMilliseconds = 60000) {}
  configure(key: string, freeTierVerified: boolean, consent: boolean) {
    this.cancel(); this.#key = ''; this.#freeTierVerified = false; this.#consent = false;
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(key)) return error('key', 'המפתח אינו תקין.');
    this.#key = key; this.#freeTierVerified = freeTierVerified; this.#consent = consent;
  }
  clear() { this.cancel(); this.#key = ''; this.#freeTierVerified = false; this.#consent = false; }
  cancel() { this.#sequence++; this.#controller?.abort(); this.#controller = undefined; }
  get hasKey() { return Boolean(this.#key); }
  get ready() { return Boolean(this.#key && this.#freeTierVerified && this.#consent && !this.#quotaStopped); }
  async recognize(blob: Blob, onBackup: () => void, mode: 'single' | 'shelf' = 'single'): Promise<VisionOutcome> {
    if (this.#quotaStopped) return error('quota', 'המכסה הסתיימה. הזיהוי נעצר; אין חידוש או רכישת קרדיטים.');
    if (!this.#key) return error('key', 'הזן מפתח אישי בזיכרון לפני זיהוי.');
    if (!this.#freeTierVerified || !this.#consent) return error('spending-lock', 'השליחה חסומה עד אימות מסלול ללא חיוב ואישור שליחת התמונה.');
    if (this.#controller) return error('busy', 'זיהוי כבר מתבצע.');
    const controller = new AbortController(), sequence = ++this.#sequence, key = this.#key; this.#controller = controller;
    let timedOut = false;
    const cancelled = () => new VisionError(timedOut ? 'timeout' : 'cancelled', timedOut ? 'הזיהוי ארך יותר מדי. לא בוצע ניסיון חוזר; אפשר להוסיף ידנית.' : 'הזיהוי בוטל.');
    let rejectAbort!: (reason: unknown) => void; const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(cancelled()); controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMilliseconds);
    const run = async (): Promise<VisionOutcome> => {
      const data = await jpegBase64(blob); if (controller.signal.aborted) throw cancelled();
      const body = JSON.stringify({ systemInstruction: { parts: [{ text: mode === 'shelf' ? shelfRecognitionPrompt : recognitionPrompt }] }, contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data } }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: mode === 'shelf' ? shelfRecognitionSchema : recognitionSchema, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } } });
      if (new TextEncoder().encode(body).length > 10 * 1024 * 1024) return error('invalid', 'בקשת הזיהוי גדולה מדי.');
      for (const [index, model] of [visionModels.primary, visionModels.backup].entries()) {
        if (controller.signal.aborted || sequence !== this.#sequence) throw cancelled();
        const response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, body });
        if (controller.signal.aborted || sequence !== this.#sequence) { await response.body?.cancel().catch(() => {}); throw cancelled(); }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if (response.status === 429) { this.#quotaStopped = true; return error('quota', 'המכסה או מגבלת הקצב הושגה. הזיהוי נעצר ללא ניסיון נוסף או רכישת קרדיטים.'); }
          if ([400, 401, 403].includes(response.status)) return error('key', 'המפתח או הרשאת הזיהוי נדחו. לא בוצע ניסיון נוסף.');
          // A missing model did not process the image. Do not retry ambiguous server/network failures.
          if (response.status === 404 && index === 0) { onBackup(); continue; }
          return error('unavailable', 'שירות הזיהוי אינו זמין. אפשר להוסיף ידנית; לא בוצע ניסיון נוסף.');
        }
        const root = await responseValue(response, key); if (controller.signal.aborted || sequence !== this.#sequence) throw cancelled();
        if (!Array.isArray(root.candidates) || root.candidates.length !== 1) return error('invalid', 'הספק לא החזיר תוצאת זיהוי יחידה.');
        const candidate = root.candidates[0] as { finishReason?: unknown; content?: { parts?: { text?: unknown; thought?: boolean }[] } };
        if (candidate?.finishReason !== 'STOP' || !Array.isArray(candidate?.content?.parts)) return error('invalid', 'הספק לא השלים זיהוי תקין.');
        const parts = candidate.content.parts.filter(part => !part.thought); if (!parts.length || parts.some(part => typeof part.text !== 'string')) return error('invalid', 'תוצאת הזיהוי אינה טקסט תקין.');
        const extracted: unknown = JSON.parse(parts.map(part => part.text).join('')); if (JSON.stringify(extracted).includes(key)) return error('invalid', 'תגובת הזיהוי נדחתה מטעמי פרטיות.');
        const result = mode === 'shelf' ? validateShelfRecognition(extracted) : validateRecognition(extracted);
        return { result, model, usedBackup: index === 1 };
      }
      return error('unavailable', 'שירות הזיהוי אינו זמין.');
    };
    try { return await Promise.race([run(), aborted]); }
    catch (cause) { if (cause instanceof VisionError) throw cause; if (controller.signal.aborted || sequence !== this.#sequence) throw cancelled(); return error('invalid', 'הזיהוי לא הושלם או שהתוצאה אינה תקינה. לא בוצע ניסיון חוזר.'); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); if (sequence === this.#sequence) this.#controller = undefined; }
  }
}
export const personalVisionSession = new VisionSession();
