import { matchesRecognizedBook } from './recognizedCatalog';
import { rememberGroqKey,forgetGroqKey,restoreVisionKey } from './visionCredentials';
import { groqVisionSession } from './vision';
import { expect,it,vi } from 'vitest';
import { booksFromOcr,type OcrLine } from './ocrLayout';
import { GroqVisionSession } from './groqVision';
import { VisionSession,VisionRouter,geminiQuotaDay,visionFailureMessage } from './vision';
import { recognitionModels } from './recognition';
import { LibraryDatabase,initializeLibrary } from './database';
import { emptyInput } from './books';
import { saveBookSelections } from './catalogSave';
import { createFullSnapshot } from './fullBackup';
import { validateBackup } from './backup';
const line=(text:string,x:number,y:number,w:number,h:number,confidence=95):OcrLine=>({text,confidence,bbox:{x0:x,y0:y,x1:x+w,y1:y+h}});
const jpeg=()=>new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'});
const key='synthetic-groq-key-no-live-provider';
function example(){return booksFromOcr([line('ספר לדוגמה',100,100,400,80),line('מאת מחבר',180,210,180,35)],1000,1000).items[0];}
it('OCR groups spatial columns separately and selects title by relative font size, with literal author evidence',()=>{
  const result=booksFromOcr([line('שם גדול',50,100,300,70),line('מאת סופר א',70,190,190,30),line('ספר שני',600,100,300,65),line('מאת סופר ב',620,190,170,30),line('הוצאת דוגמה',70,600,200,20),line('טעות',50,10,100,100,12)],1000,1000);
  expect(result.items).toHaveLength(2);expect(result.items.map(item=>item.title).sort()).toEqual(['ספר שני','שם גדול']);expect(result.items.map(item=>item.authors[0]).sort()).toEqual(['סופר א','סופר ב']);
  expect(booksFromOcr([line('9780306406157',100,100,400,30)],1000,1000).items[0].isbn).toBe('9780306406157');
});
it('Gemini quota and server failures use Groq once; strict results survive backup with accurate provider and no key',async()=>{
  for(const status of [429,503]){
    const primary=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status}));
    const fallback=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[{title:example().title,authors:example().authors}]})}}]})));
    const gemini=new VisionSession(primary),groq=new GroqVisionSession(fallback);gemini.configure('synthetic-gemini-key',true,true);groq.configure(key,true,true);const router=new VisionRouter(gemini,groq),notice=vi.fn();
    const outcome=await router.recognize(jpeg(),notice,'shelf');expect(primary).toHaveBeenCalledTimes(status === 503 ? 3 : 1);expect(fallback).toHaveBeenCalledOnce();expect(outcome.model).toBe(recognitionModels.groq);expect(notice).toHaveBeenCalledWith(expect.stringContaining('Groq'));
    expect(fallback.mock.calls[0][1]).toMatchObject({headers:{Authorization:'Bearer '+key},credentials:'omit',redirect:'error',cache:'no-store'});expect(fallback.mock.calls[0][1]?.body).not.toContain(key);
    const db=new LibraryDatabase('groq-source-'+crypto.randomUUID());try{await initializeLibrary(db);await saveBookSelections(db,{...emptyInput,title:example().title!},[],[{item:example(),selected:['title'],model:outcome.model,imageHash:'a'.repeat(64),fetchedAt:new Date().toISOString()}]);const snapshot=await createFullSnapshot(db);expect(JSON.parse(snapshot.text).formatVersion).toBe(10);expect(snapshot.text).not.toContain(key);expect((await validateBackup(snapshot.text)).data.metadataSources[0].provider).toBe('groq');}finally{await db.delete();}
  }
});
it('Gemini quota hold expires on a new provider day while the saved key remains usable',async()=>{
  vi.useFakeTimers();try{vi.setSystemTime(new Date('2026-10-04T15:00:00Z'));const session=new VisionSession();session.configure('synthetic-gemini-key',true,true);session.stopForQuota(geminiQuotaDay());expect(session.ready).toBe(false);vi.advanceTimersByTime(24*60*60*1000);expect(session.ready).toBe(true);expect(session.hasKey).toBe(true);}finally{vi.useRealTimers();}
});
it('Groq validates Free consent before requests, stops on 429 and rejects echoed secrets',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status:429})),session=new GroqVisionSession(fetcher);session.configure(key,false,true);await expect(session.recognize(jpeg(),'single')).rejects.toMatchObject({state:'spending-lock'});expect(fetcher).not.toHaveBeenCalled();session.configure(key,true,true);await expect(session.recognize(jpeg(),'single')).rejects.toMatchObject({state:'quota'});await expect(session.recognize(jpeg(),'single')).rejects.toMatchObject({state:'spending-lock'});expect(fetcher).toHaveBeenCalledOnce();
  const leaked=new GroqVisionSession(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({error:key}))));leaked.configure(key,true,true);await expect(leaked.recognize(jpeg(),'single')).rejects.not.toThrow(key);
});

it('Groq credential restore stays separate from library backups and deletion is explicit',async()=>{
  await rememberGroqKey(key,true,true);groqVisionSession.clear();await restoreVisionKey();expect(groqVisionSession.ready).toBe(true);
  await forgetGroqKey();await restoreVisionKey();expect(groqVisionSession.hasKey).toBe(false);
});
it('automatic photo catalog matching requires ISBN equivalence or exact title/author; ambiguous titles are rejected',()=>{
 const candidate={provider:'openlibrary' as const,recordId:'/books/OL1M',sourceUrl:'https://openlibrary.org/books/OL1M',fetchedAt:new Date().toISOString(),kind:'edition' as const,fields:{title:'שם הספר',authors:['שם מחבר']},warnings:[]};
 expect(matchesRecognizedBook({...emptyInput,title:'שם הספר',authors:['שם מחבר']},candidate)).toBe(true);
 expect(matchesRecognizedBook({...emptyInput,title:'שם הספר',authors:['מחבר אחר']},candidate)).toBe(false);
 expect(matchesRecognizedBook({...emptyInput,title:'שם הספר'},candidate,false)).toBe(false);
 expect(matchesRecognizedBook({...emptyInput,isbn:'9780140328721'},{...candidate,fields:{isbn13:'9780306406157'}})).toBe(false);
});

it('fallback preserves safe provider failure diagnostics while Groq succeeds; no credentials or raw response survive', async () => {
  for (const status of [400,401,403,429,503]) {
    const gemini = new VisionSession(async () => new Response(key, { status })); gemini.configure(key,true,true);
    const groq = new GroqVisionSession(async () => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:example().title,authors:example().authors})}}]})); groq.configure(key,true,true);
    const report = vi.fn(), outcome = await new VisionRouter(gemini,groq).recognize(jpeg(),vi.fn(),'single',false,report);
    expect(outcome.model).toBe(recognitionModels.groq);
    expect(report).toHaveBeenCalledWith({provider:'Gemini',httpStatus:status,state:status===400?'invalid':[401,403].includes(status)?'key':status===429?'quota':'unavailable'});
    expect(JSON.stringify(report.mock.calls)).not.toContain(key); expect(visionFailureMessage(report.mock.calls[0][0])).toContain('HTTP '+status);
  }
});

it('a configured but quota-stopped Gemini explains its hold without another request; network failure is distinguished', async () => {
  const fetcher = vi.fn<typeof fetch>(), gemini = new VisionSession(fetcher); gemini.configure(key,true,true); gemini.stopForQuota();
  const groq = new GroqVisionSession(async () => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({title:example().title,authors:example().authors})}}]})); groq.configure(key,true,true);
  const report=vi.fn(); await new VisionRouter(gemini,groq).recognize(jpeg(),vi.fn(),'single',false,report);
  expect(fetcher).not.toHaveBeenCalled(); expect(report).toHaveBeenCalledWith({provider:'Gemini',state:'quota'});
  const network = new VisionSession(async () => { throw new TypeError('untrusted '+key); }); network.configure(key,true,true);
  await expect(network.recognize(jpeg(),vi.fn())).rejects.toMatchObject({state:'network'});
});
