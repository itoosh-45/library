import { normalizeVisionKey, VisionError, type VisionOutcome } from './visionTypes';
import { recognitionModels, recognitionPrompt, recognitionSchema, shelfRecognitionPrompt, shelfRecognitionSchema, validateRecognition, validateShelfRecognition } from './recognition';
import { imageSignature } from './images';
export class GroqVisionSession {
  #key = ''; #free = false; #consent = false; #controller?: AbortController; #blockedUntil = 0;
  constructor(private fetcher: typeof fetch = (input, init) => globalThis.fetch(input,init)) {}
  configure(key: string, free: boolean, consent: boolean) { this.cancel(); this.#key='';this.#free=false;this.#consent=false;this.#key=normalizeVisionKey(key); this.#free=free; this.#consent=consent; }
  clear() { this.cancel(); this.#key=''; this.#free=false; this.#consent=false; }
  cancel() { this.#controller?.abort(); this.#controller=undefined; }
  get hasKey() { return !!this.#key; }
  get ready() { return this.hasKey && this.#free && this.#consent && Date.now() >= this.#blockedUntil; }
  async recognize(blob: Blob, mode: 'single' | 'shelf'): Promise<VisionOutcome> {
    if (!this.ready) throw new VisionError('spending-lock','Groq אינו מוגדר במסלול חינמי מאושר, או שהמכסה שלו ממתינה לחידוש.');
    if (this.#controller) throw new VisionError('busy','זיהוי כבר מתבצע.');
    const key=this.#key, controller=new AbortController(); this.#controller=controller;
    const timer=setTimeout(() => controller.abort('timeout'),60000);
    let rejectAbort!: (reason: unknown) => void;
    const aborted=new Promise<never>((_,reject) => { rejectAbort=reject; });
    const abort=()=>rejectAbort(new VisionError(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled','זיהוי Groq נעצר.'));
    controller.signal.addEventListener('abort',abort,{once:true});
    const run=async () => {
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if (blob.type !== 'image/jpeg' || !bytes.length || bytes.length > 1.5*1024*1024 || !imageSignature(bytes,'image/jpeg')) throw new VisionError('invalid','תמונת הזיהוי אינה תקינה.');
      let binary=''; for(let at=0;at<bytes.length;at+=8192) binary+=String.fromCharCode(...bytes.subarray(at,at+8192));
      if(controller.signal.aborted) throw new VisionError('cancelled','הזיהוי בוטל.');
      const prompt=(mode==='shelf'?shelfRecognitionPrompt:recognitionPrompt)+' Return JSON matching this schema: '+JSON.stringify(mode==='shelf'?shelfRecognitionSchema:recognitionSchema);
      const response=await this.fetcher('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,body:JSON.stringify({model:recognitionModels.groq,messages:[{role:'system',content:prompt},{role:'user',content:[{type:'text',text:'Read the visible books and identifiers in this image. Return only JSON.'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+btoa(binary)}}]}],response_format:{type:'json_object'},max_completion_tokens:8192,temperature:0})});
      if(!response.ok) { await response.body?.cancel().catch(()=>{}); if(response.status===429) { const retry=Number(response.headers.get('retry-after')); this.#blockedUntil=Date.now()+Math.min(86400,Math.max(60,Number.isFinite(retry)?retry:60))*1000; throw new VisionError('quota','מכסת Groq או מגבלת הקצב הושגה. אין חיוב או ניסיון חוזר אוטומטי.'); } throw new VisionError('unavailable','Groq לא השלים זיהוי. אפשר להשתמש ב-OCR המקומי.'); }
      if(!response.body) throw new VisionError('invalid','תגובת Groq ריקה.');
      const reader=response.body.getReader(),decoder=new TextDecoder(); let value='',length=0;
      try { for(;;) { const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>128*1024)throw new VisionError('invalid','תגובת Groq גדולה מדי.');value+=decoder.decode(part.value,{stream:true}); } value+=decoder.decode(); } finally { await reader.cancel().catch(()=>{}); }
      const root=JSON.parse(value); if(value.includes(key)||JSON.stringify(root).includes(key))throw new VisionError('invalid','תגובת Groq נדחתה מטעמי פרטיות.');
      if(!Array.isArray(root.choices)||root.choices.length!==1||root.choices[0].finish_reason!=='stop'||typeof root.choices[0].message?.content!=='string')throw new VisionError('invalid','Groq לא החזיר תוצאה מלאה.');
      const extracted=JSON.parse(root.choices[0].message.content); if(JSON.stringify(extracted).includes(key))throw new VisionError('invalid','תגובת Groq נדחתה מטעמי פרטיות.');
      return { result: mode==='shelf'?validateShelfRecognition(extracted):validateRecognition(extracted),model:recognitionModels.groq,usedBackup:true };
    };
    try { return await Promise.race([run(),aborted]); } catch(error) { if(error instanceof VisionError)throw error;throw new VisionError('invalid','זיהוי Groq נכשל או החזיר תוצאה שאינה תקינה.'); }
    finally { clearTimeout(timer);controller.signal.removeEventListener('abort',abort);if(this.#controller===controller)this.#controller=undefined; }
  }
}
