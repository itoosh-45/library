import {expect,it,vi} from 'vitest';
import {transcriptionToRecognition,coverTranscriptionSchema} from './coverTranscription';
import {VisionSession,visionModels} from './vision';
import {GroqVisionSession} from './groqVision';
import {recognitionInput} from './recognition';
import {emptyInput} from './books';
import {LibraryDatabase,initializeLibrary} from './database';
import {saveBookSelections} from './catalogSave';
import {createFullSnapshot} from './fullBackup';
import {validateBackup} from './backup';
const raw={title_lines:['ספר בדיקה','כותרת משנה'],authors:['מחבר בדיקה']};
const jpeg=()=>new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'});
it('literal title lines and author map into existing evidence without identifiers or extra facts',()=>{
 const item=transcriptionToRecognition(raw).items[0];expect(item.title).toBe('ספר בדיקה כותרת משנה');expect(item.authors).toEqual(raw.authors);expect(item.isbn).toBeNull();expect(item.danacode).toBeNull();expect(item.publisher).toBeNull();expect(item.bbox).toBeNull();expect(item.visibleText).toBe('ספר בדיקה\nכותרת משנה\nמחבר בדיקה');expect(recognitionInput({...emptyInput,isbn:'9780140328721'},item,['title','authors'])).toMatchObject({title:item.title,authors:raw.authors,isbn:'9780140328721'});expect(transcriptionToRecognition({title_lines:[],authors:[]}).items).toEqual([]);
});
it('unsupported, duplicate, oversized or URL-shaped transcription is rejected',()=>{
 for(const value of [null,[],{...raw,isbn:'9780140328721'},{title_lines:['English only'],authors:[]},{...raw,authors:['מחבר בדיקה','מחבר בדיקה']},{title_lines:['א'.repeat(301)],authors:[]},{title_lines:['ספר https://example.com'],authors:[]},{title_lines:[''],authors:[]}])expect(()=>transcriptionToRecognition(value)).toThrow();
});
it('Gemini cover mode uses only two output fields and one successful request',async()=>{
 const f=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]}));const session=new VisionSession(f);session.configure('SYNTHETIC-NEVER-LIVE-KEY',true,true);const outcome=await session.recognize(jpeg(),vi.fn(),'cover');expect(outcome.model).toBe(visionModels.primary);expect(f).toHaveBeenCalledOnce();const body=JSON.parse(f.mock.calls[0][1]!.body as string);expect(body.generationConfig.responseJsonSchema).toEqual(coverTranscriptionSchema);expect(Object.keys(body.generationConfig.responseJsonSchema.properties)).toEqual(['title_lines','authors']);
});
it('Groq cover fallback uses the same short transcription while evidence survives save and backup',async()=>{
 const f=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}));const session=new GroqVisionSession(f);session.configure('SYNTHETIC-NEVER-LIVE-KEY',true,true);const outcome=await session.recognize(jpeg(),'cover');expect(f).toHaveBeenCalledOnce();expect(JSON.parse(f.mock.calls[0][1]!.body as string).messages[0].content).toContain('title_lines');const db=new LibraryDatabase('cover-'+crypto.randomUUID());try{await initializeLibrary(db);await saveBookSelections(db,{...emptyInput,title:outcome.result.items[0].title!},[],[{item:outcome.result.items[0],selected:['title','authors'],model:outcome.model,imageHash:'a'.repeat(64),fetchedAt:new Date().toISOString()}]);const snapshot=await createFullSnapshot(db);expect(snapshot.text).not.toContain('SYNTHETIC-NEVER-LIVE-KEY');expect((await validateBackup(snapshot.text)).data.metadataSources[0].recognition!.item.title).toBe('ספר בדיקה כותרת משנה');}finally{await db.delete();}
});
