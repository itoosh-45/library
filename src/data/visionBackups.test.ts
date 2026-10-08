import { expect, it, vi } from 'vitest';
import { VisionSession, visionModels, VisionRouter, visionFailureMessage } from './vision';
import { GroqVisionSession } from './groqVision';
import { saveBookSelections } from './catalogSave';
import { emptyInput } from './books';
import { LibraryDatabase, initializeLibrary } from './database';
import { createFullSnapshot } from './fullBackup';
import { validateBackup } from './backup';
const item = { title: 'ספר בדיקה', authors: [], isbn: null, danacode: null, publisher: null, visibleText: 'ספר בדיקה', evidenceByField: { title: ['ספר בדיקה'], authors: [], isbn: [], danacode: [], publisher: [] }, imageIndex: 0 as const, bbox: null, uncertaintyReasons: [] };
it('service failure tries each approved model once in order and stops after success', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValue(Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ items: [item] }) }] } }] }));
  const session = new VisionSession(fetcher); session.configure('SYNTHETIC-NEVER-LIVE-KEY', true, true); const notice = vi.fn();
  const result = await session.recognize(new Blob([new Uint8Array([255,216,255,217])], { type: 'image/jpeg' }), notice);
  expect([visionModels.primary,visionModels.backup,visionModels.backup2]).toEqual(['gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3.5-flash']); expect(result.model).toBe(visionModels.backup2); expect(result.usedBackup).toBe(true); expect(fetcher.mock.calls.map(([url]) => String(url).split('/models/')[1].split(':')[0])).toEqual([visionModels.primary, visionModels.backup, visionModels.backup2]); expect(notice).toHaveBeenCalledTimes(2);
});
it('released and new Gemini evidence remain valid in the same backup', async () => {
  const db = new LibraryDatabase('model-history-' + crypto.randomUUID());
  try {
    await initializeLibrary(db);
    for (const model of [visionModels.legacy, visionModels.legacyBackup, visionModels.legacyBackup2, visionModels.primary, visionModels.backup, visionModels.backup2]) await saveBookSelections(db, { ...emptyInput, title: item.title }, [], [{ item: { ...item, bbox: null }, selected: ['title'], model, imageHash: 'a'.repeat(64), fetchedAt: new Date().toISOString() }]);
    expect((await validateBackup((await createFullSnapshot(db)).text)).data.metadataSources.map(source => source.recognition?.model).sort()).toEqual([visionModels.legacy, visionModels.legacyBackup, visionModels.legacyBackup2, visionModels.primary, visionModels.backup, visionModels.backup2].sort());
  } finally { await db.delete(); }
});

const jpeg=()=>new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'});
const valid=()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({items:[item]})}]}}]});
it('malformed, truncated and unsupported book evidence try the next approved model without accepting bad data',async()=>{
 const failures=[()=>new Response('{'),()=>Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[]}}]}),()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({items:[{...item,title:'invented'}]})}]}}]}),()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[null]}}]})];
 for(const fail of failures){const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(async()=>fail()).mockImplementation(async()=>valid());const session=new VisionSession(fetcher);session.configure('SYNTHETIC-NEVER-LIVE-KEY',true,true);const notice=vi.fn();const result=await session.recognize(jpeg(),notice);expect(result.model).toBe(visionModels.backup);expect(result.result.items[0].title).toBe(item.title);expect(fetcher).toHaveBeenCalledTimes(2);expect(notice).toHaveBeenCalledOnce();}
});
it('exhausted malformed responses retain a safe diagnostic and model while privacy and safety stop Gemini retries',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('{'));const session=new VisionSession(fetcher);session.configure('SYNTHETIC-NEVER-LIVE-KEY',true,true);await expect(session.recognize(jpeg(),vi.fn())).rejects.toMatchObject({state:'invalid',diagnostic:'json',model:visionModels.backup2});expect(fetcher).toHaveBeenCalledTimes(3);
 for(const response of [()=>Response.json({candidates:[{finishReason:'SAFETY'}]}),()=>Response.json({error:'SYNTHETIC-NEVER-LIVE-KEY'})]){const f=vi.fn<typeof fetch>().mockImplementation(async()=>response());const isolated=new VisionSession(f);isolated.configure('SYNTHETIC-NEVER-LIVE-KEY',true,true);await expect(isolated.recognize(jpeg(),vi.fn())).rejects.toMatchObject({state:'invalid'});expect(f).toHaveBeenCalledOnce();}
});

it('the router retains a specific safe reason and model when all Gemini responses fail and Groq succeeds',async()=>{
 const gemini=new VisionSession(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({items:[{...item,title:'PRIVATE-UNTRUSTED-TITLE'}]})}]}}]}));gemini.configure('SYNTHETIC-NEVER-LIVE-KEY',true,true);
 const groq=new GroqVisionSession(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[item]})}}]}));groq.configure('SYNTHETIC-NEVER-LIVE-KEY',true,true);
 const report=vi.fn();const outcome=await new VisionRouter(gemini,groq).recognize(jpeg(),vi.fn(),'single',false,report);expect(outcome.model).toBe(visionModels.groq);expect(report).toHaveBeenCalledWith({provider:'Gemini',state:'invalid',diagnostic:'validation',model:visionModels.backup2});const notice=visionFailureMessage(report.mock.calls[0][0]);expect(notice).toContain(visionModels.backup2);expect(notice).toContain('ראיות');expect(notice).not.toContain('PRIVATE-UNTRUSTED');expect(notice).not.toContain('SYNTHETIC-NEVER-LIVE-KEY');
});
