import { coverTranscriptionPrompt, coverTranscriptionSchema, transcriptionToRecognition } from './coverTranscription';
import { normalizeVisionKey, VisionError, type VisionState, type VisionOutcome, type VisionFailure, type VisionDiagnostic } from './visionTypes';
export { normalizeVisionKey, VisionError, visionFailureMessage, type VisionState, type VisionOutcome, type VisionFailure } from './visionTypes';
import { GroqVisionSession } from './groqVision';
import { imageSignature } from './images';
import { recognitionModels, recognitionPrompt, recognitionSchema, shelfRecognitionPrompt, shelfRecognitionSchema, validateRecognition, validateShelfRecognition } from './recognition';

export const geminiQuotaDay = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const visionModels = recognitionModels;
const error = (state: VisionState, message: string, status?: number, diagnostic?: VisionDiagnostic): never => { throw new VisionError(state, message, status, diagnostic); };
async function responseValue(response: Response, key: string): Promise<Record<string, unknown>> {
  if (!response.body) return error('invalid', 'תגובת הזיהוי ריקה.');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let length = 0, value = '';
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > 128 * 1024) return error('invalid', 'תגובת הזיהוי גדולה מדי.'); value += decoder.decode(part.value, { stream: true }); }
    value += decoder.decode(); if (value.includes(key)) return error('invalid', 'תגובת הזיהוי נדחתה מטעמי פרטיות.', undefined, 'privacy');
    const parsed: unknown = JSON.parse(value); if (JSON.stringify(parsed).includes(key)) return error('invalid', 'תגובת הזיהוי נדחתה מטעמי פרטיות.', undefined, 'privacy'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return error('invalid', 'תגובת הזיהוי אינה תקינה.', undefined, 'shape'); return parsed as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => {}); }
}
async function jpegBase64(blob: Blob): Promise<string> {
  if (blob.type !== 'image/jpeg' || !blob.size || blob.size > 1.5 * 1024 * 1024) return error('invalid', 'יש להכין תמונת JPEG עד 1.5MB לפני שליחה.');
  const bytes = new Uint8Array(await blob.arrayBuffer()); if (!imageSignature(bytes, 'image/jpeg')) return error('invalid', 'תמונת הזיהוי אינה תקינה.');
  let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192)); return btoa(binary);
}
/** Provider requests use a memory session; explicitly authorized local retention lives separately. */
export class VisionSession {
  onQuotaStop?: () => void;
  stopForQuota(day=geminiQuotaDay()) { this.#quotaStopped = true; this.#quotaDay=day; }
  #key = ''; #freeTierVerified = false; #consent = false; #quotaStopped = false; #quotaDay='';
  #controller?: AbortController; #sequence = 0;
  constructor(private fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init), private timeoutMilliseconds = 60000) {}
  configure(key: string, freeTierVerified: boolean, consent: boolean) {
    this.cancel(); this.#key = ''; this.#freeTierVerified = false; this.#consent = false;
    // Validate safe header text, not an undocumented provider-specific key format.
    key = normalizeVisionKey(key);
    this.#key = key; this.#freeTierVerified = freeTierVerified; this.#consent = consent;
  }
  clear() { this.cancel(); this.#key = ''; this.#freeTierVerified = false; this.#consent = false; }
  cancel() { this.#sequence++; this.#controller?.abort(); this.#controller = undefined; }
  get hasKey() { return Boolean(this.#key); }
  get blockedReason(): VisionState { return !this.#key ? 'key' : !this.#freeTierVerified || !this.#consent ? 'spending-lock' : 'quota'; }
  get ready() { return Boolean(this.#key && this.#freeTierVerified && this.#consent && !(this.#quotaStopped && this.#quotaDay===geminiQuotaDay())); }
  async recognize(blob: Blob, onBackup: (reason?: string) => void, mode: 'single' | 'shelf' | 'cover' = 'single'): Promise<VisionOutcome> {
    if (this.#quotaStopped && this.#quotaDay===geminiQuotaDay()) return error('quota', 'המכסה הסתיימה. הזיהוי נעצר; אין חידוש או רכישת קרדיטים.');
    if (!this.#key) return error('key', 'הגדר מפתח Gemini אישי בהגדרות לפני זיהוי.');
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
      const body = JSON.stringify({ systemInstruction: { parts: [{ text: mode === 'cover' ? coverTranscriptionPrompt : mode === 'shelf' ? shelfRecognitionPrompt : recognitionPrompt }] }, contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data } }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: mode === 'cover' ? coverTranscriptionSchema : mode === 'shelf' ? shelfRecognitionSchema : recognitionSchema, maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: 'low' } } });
      if (new TextEncoder().encode(body).length > 10 * 1024 * 1024) return error('invalid', 'בקשת הזיהוי גדולה מדי.');
      const models = [visionModels.primary, visionModels.backup, visionModels.backup2];
      for (const [index, model] of models.entries()) {
        if (controller.signal.aborted || sequence !== this.#sequence) throw cancelled();
        const response = await this.fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, body });
        if (controller.signal.aborted || sequence !== this.#sequence) { await response.body?.cancel().catch(() => {}); throw cancelled(); }
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          if (response.status === 429) { this.stopForQuota(); this.onQuotaStop?.(); return error('quota', 'המכסה או מגבלת הקצב הושגה. הזיהוי נעצר ללא ניסיון נוסף או רכישת קרדיטים.', 429); }
          if (response.status === 400) return error('invalid', 'Gemini דחה את בקשת הזיהוי (HTTP 400).', 400);
          if ([401, 403].includes(response.status)) return error('key', 'המפתח או הרשאת הזיהוי נדחו. לא בוצע ניסיון נוסף.', response.status);
          // Each approved free model is attempted once; quota/access errors above stop this chain.
          if ([404, 500, 502, 503, 504].includes(response.status) && index < models.length - 1) { onBackup(`Gemini החזיר HTTP ${response.status}; מנסה את ${models[index + 1]}.`); continue; }
          return error('unavailable', 'שירות הזיהוי אינו זמין. אפשר להוסיף ידנית; לא בוצע ניסיון נוסף.', response.status);
        }
        try {
          let root: Record<string, unknown>;
          try { root = await responseValue(response, key); }
          catch (cause) { if (cause instanceof SyntaxError) return error('invalid', 'התשובה אינה JSON תקין.', undefined, 'json'); throw cause; }
          if (controller.signal.aborted || sequence !== this.#sequence) throw cancelled();
          if (!Array.isArray(root.candidates) || root.candidates.length !== 1) return error('invalid', 'הספק לא החזיר תוצאת זיהוי יחידה.', undefined, root.promptFeedback ? 'safety' : 'shape');
          const candidate = root.candidates[0] as { finishReason?: unknown; content?: { parts?: { text?: unknown; thought?: boolean }[] } };
          if (candidate?.finishReason !== 'STOP') return error('invalid', 'הספק לא השלים זיהוי תקין.', undefined, candidate?.finishReason === 'MAX_TOKENS' ? 'truncated' : ['SAFETY','BLOCKLIST','PROHIBITED_CONTENT'].includes(String(candidate?.finishReason)) ? 'safety' : 'incomplete');
          if (!Array.isArray(candidate?.content?.parts)) return error('invalid', 'בתשובה חסרים פרטי הזיהוי.', undefined, 'shape');
          if (candidate.content.parts.some(part => !part || typeof part !== 'object')) return error('invalid', 'מבנה חלקי התשובה אינו תקין.', undefined, 'shape');
          const parts = candidate.content.parts.filter(part => !part.thought);
          if (!parts.length || parts.some(part => typeof part.text !== 'string')) return error('invalid', 'תוצאת הזיהוי אינה טקסט תקין.', undefined, 'shape');
          let extracted: unknown;
          try { extracted = JSON.parse(parts.map(part => part.text).join('')); }
          catch { return error('invalid', 'התשובה אינה JSON תקין.', undefined, 'json'); }
          if (JSON.stringify(extracted).includes(key)) return error('invalid', 'תגובת הזיהוי נדחתה מטעמי פרטיות.', undefined, 'privacy');
          let result;
          try { result = mode === 'cover' ? transcriptionToRecognition(extracted) : mode === 'shelf' ? validateShelfRecognition(extracted) : validateRecognition(extracted); }
          catch { return error('invalid', 'פרטי הספר לא עברו אימות.', undefined, 'validation'); }
          return { result, model, usedBackup: index > 0 };
        } catch (cause) {
          if (!(cause instanceof VisionError) || cause.state !== 'invalid') throw cause;
          cause.model = model;
          // Retry a malformed result only on the remaining approved models; keep privacy/content refusals terminal.
          if (cause.diagnostic && ['json','shape','truncated','incomplete','validation'].includes(cause.diagnostic) && index < models.length - 1) {
            onBackup(`${model}: ${cause.message} מנסה את ${models[index + 1]}.`); continue;
          }
          throw cause;
        }
      }
      return error('unavailable', 'שירות הזיהוי אינו זמין.');
    };
    try { return await Promise.race([run(), aborted]); }
    catch (cause) { if (cause instanceof VisionError) throw cause; if (controller.signal.aborted || sequence !== this.#sequence) throw cancelled(); if (cause instanceof TypeError) return error('network', 'בקשת הזיהוי לא הגיעה לשירות.'); return error('invalid', 'הזיהוי לא הושלם או שהתוצאה אינה תקינה. לא בוצע ניסיון חוזר.'); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); if (sequence === this.#sequence) this.#controller = undefined; }
  }
}
export const geminiVisionSession = new VisionSession();
export const groqVisionSession = new GroqVisionSession();
export class VisionRouter {
  #sequence=0; #local?: { cancel(): void };
  constructor(private gemini=geminiVisionSession, private groq=groqVisionSession) {}
  configure(key: string,free: boolean,consent: boolean) { this.gemini.configure(key,free,consent); }
  clear() { this.cancel(); this.gemini.clear(); }
  get hasKey() { return this.gemini.hasKey || this.groq.hasKey; }
  get ready() { return this.gemini.ready || this.groq.ready; }
  stopForQuota() { this.gemini.stopForQuota(); }
  set onQuotaStop(value: (()=>void)|undefined) { this.gemini.onQuotaStop=value; }
  cancel() { this.#sequence++;this.gemini.cancel();this.groq.cancel();this.#local?.cancel(); }
  async recognize(blob: Blob,onBackup: (reason?:string)=>void,mode:'single'|'shelf'|'cover'='single',localOnly=false,onFailure?: (failure: VisionFailure) => void): Promise<VisionOutcome> {
    const sequence=++this.#sequence;
    const current=()=> { if(sequence!==this.#sequence)throw new VisionError('cancelled','הזיהוי בוטל.'); };
    const cloudAllowed=typeof navigator==='undefined'||navigator.onLine !== false;
    if(!localOnly && cloudAllowed) {
      if(this.gemini.ready) { try { const result=await this.gemini.recognize(blob,onBackup,mode);current();return result; } catch(error) { current();if(error instanceof VisionError && ['cancelled','busy','spending-lock'].includes(error.state))throw error; onFailure?.({ provider: 'Gemini', state: error instanceof VisionError ? error.state : 'invalid', ...(error instanceof VisionError && error.httpStatus ? { httpStatus: error.httpStatus } : {}), ...(error instanceof VisionError && error.diagnostic ? { diagnostic: error.diagnostic, model: error.model } : {}) }); } }
      else if(this.gemini.hasKey) onFailure?.({ provider: 'Gemini', state: this.gemini.blockedReason });
      if(this.groq.ready) { current();onBackup('Gemini אינו זמין — עובר לזיהוי דרך Groq.');try {const result=await this.groq.recognize(blob,mode);current();return result;}catch(error){current();if(error instanceof VisionError && ['cancelled','busy','spending-lock'].includes(error.state))throw error; onFailure?.({ provider: 'Groq', state: error instanceof VisionError ? error.state : 'invalid', ...(error instanceof VisionError && error.httpStatus ? { httpStatus: error.httpStatus } : {}) });} }
      else if(this.groq.hasKey) onFailure?.({ provider: 'Groq', state: this.groq.blockedReason });
    }
    current();onBackup(localOnly?'קורא טקסט במכשיר בעזרת OCR…':'שירותי הענן אינם זמינים — עובר ל-OCR מקומי.');
    const { localOcrSession }=await import('./localOcr');current();this.#local=localOcrSession;
    const result=await localOcrSession.recognize(blob,mode==='cover'?'single':mode,onBackup);current();return result;
  }
}
export const personalVisionSession = new VisionRouter();
