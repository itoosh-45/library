import {expect,it,vi} from 'vitest';
import {LibraryDatabase,initializeLibrary} from './database';
import {createDraft,appendDraftImage} from './shelfDraft';
import {batchRequest,clearBookMatch,syncBookBatch,type RemoteBatch} from './bookBatch';
import {personalCredentials} from './personalCredentials';
import {validateCandidate} from './metadata';
import {recognitionModels} from './recognition';
import {previewApproved,saveApproved,setItemStatus,updateItemReview} from './shelfReview';
import {createFullSnapshot} from './fullBackup';
import {validateBackup} from './backup';
const hash='d'.repeat(64);
const candidate=validateCandidate({provider:'icl',recordId:'123',sourceUrl:'https://infocenters.co.il/icl/notebook_ext.asp?book=123&lang=heb&site=icl',kind:'edition',fetchedAt:'2026-10-12T00:00:00.000Z',fields:{title:'ספר סינתטי',authors:['מחבר בדיקה'],isbn13:'9780140328721'},warnings:[],coverUrl:'https://infocenters.co.il/icl/multimedia/2026/10/12/testf.jpg'});
it('clear matches require title and author and leave competing editions for review',()=>{
 const names={title:'ספר סינתטי',authors:['מחבר בדיקה']};expect(clearBookMatch(names,[candidate])).toEqual(candidate);expect(clearBookMatch({...names,authors:[]},[candidate])).toBeUndefined();expect(clearBookMatch(names,[candidate,{...candidate,recordId:'124',fields:{...candidate.fields,isbn13:'9789655643657'}}])).toBeUndefined();
});
it('upload waits for the server rate limit and then retries the same image with its private capability',async()=>{
 const id=crypto.randomUUID(),capability='c'.repeat(64),service='b'.repeat(64);
 await personalCredentials.credentials.put({id:'goodreads',key:service});await personalCredentials.credentials.put({id:'batch:'+id,key:capability});
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('{}',{status:429,headers:{'Retry-After':'1'}})).mockResolvedValueOnce(Response.json({id,status:'paused',nextAt:0,expiresAt:'2026-10-19T00:00:00.000Z',images:[]}));
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
 try{const request=batchRequest(id,'upload',{itemId:'synthetic'});await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());await vi.advanceTimersByTimeAsync(1100);expect((await request).id).toBe(id);expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({'X-Batch-Token':capability,Authorization:'Bearer '+service});}
 finally{vi.useRealTimers();fetcher.mockRestore();await personalCredentials.credentials.delete('batch:'+id);await personalCredentials.credentials.delete('goodreads');}
});
it('remote results preserve reviews through polling, require approval, survive backup and save only once',async()=>{
 const database=new LibraryDatabase('batch-'+crypto.randomUUID());try{await initializeLibrary(database);const draft=await createDraft(database,null),image=await appendDraftImage(database,draft.id,'synthetic.jpg',hash);await database.recognitionDrafts.update(draft.id,{images:[{...image,preparedHash:hash}]});
 const remote:RemoteBatch={id:draft.id,status:'complete',nextAt:0,expiresAt:'2026-10-19T00:00:00.000Z',images:[{id:image.id,name:image.name,sha:hash,status:'recognized',message:null,names:{title:'ספר סינתטי',authors:['מחבר בדיקה']},model:recognitionModels.primary,fetchedAt:'2026-10-12T00:00:00.000Z',candidates:[candidate]}]};
 let synced=await syncBookBatch(remote,database);expect(synced.items).toHaveLength(1);expect(await database.books.count()).toBe(0);expect((await previewApproved(database,draft.id)).itemIds).toHaveLength(0);
 const item=synced.items[0];await updateItemReview(database,draft.id,item.id,synced.revision,{...item.review!,input:{...item.review!.input,title:'שם שתוקן'}},item.selectedFields);synced=await syncBookBatch(remote,database);expect(synced.items[0].review?.input.title).toBe('שם שתוקן');expect(synced.items).toHaveLength(1);
 const snapshot=await createFullSnapshot(database),restored=await validateBackup(snapshot.text);expect(restored.data.recognitionDrafts[0].items[0].review?.input.title).toBe('שם שתוקן');expect(snapshot.text).not.toContain('batch:'+draft.id);
 await setItemStatus(database,draft.id,item.id,synced.revision,'approved');const preview=await previewApproved(database,draft.id);expect((await saveApproved(database,preview)).saved).toBe(1);expect((await saveApproved(database,preview)).saved).toBe(0);expect(await database.books.count()).toBe(1);
 }finally{await database.delete();}
});
