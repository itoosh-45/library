import {afterEach,expect,it,vi} from 'vitest';
import {nliCatalogAdapter} from './nliCatalog';
import {catalogServiceRequest,rememberGoodreadsKey,forgetGoodreadsKey} from './goodreads';
import {emptyQuery} from './catalog';
afterEach(forgetGoodreadsKey);
it('NLI uses only the private service token and rejects a foreign provider',async()=>{
 const key='b'.repeat(64);await rememberGoodreadsKey(key);
 const adapter=nliCatalogAdapter(async(_url,init)=>{expect(init?.headers).toMatchObject({Authorization:'Bearer '+key});expect(init?.body).toBe(JSON.stringify({query:{...emptyQuery,title:'ספר'}}));return Response.json({provider:'nli',cached:true,results:[{provider:'goodreads',recordId:'123',kind:'edition',sourceUrl:null,fetchedAt:new Date().toISOString(),fields:{title:'ספר'},warnings:[]}]});});
 await expect(adapter.search({...emptyQuery,title:'ספר'},new AbortController().signal)).rejects.toThrow('מקור');
});
it('shared catalog transport serializes providers so the bounded server never receives overlapping requests',async()=>{
 await rememberGoodreadsKey('b'.repeat(64));let finish!:()=>void;let entered!:()=>void;let calls=0;
 const ready=new Promise<void>(resolve=>{entered=resolve;});const pause=new Promise<void>(resolve=>{finish=resolve;});
 const fetcher:typeof fetch=async()=>{calls++;if(calls===1){entered();await pause;}return Response.json({cached:true});};
 const first=catalogServiceRequest(fetcher,'nli')('/first',{},new AbortController().signal);await ready;
 const second=catalogServiceRequest(fetcher,'goodreads')('/second',{},new AbortController().signal);await Promise.resolve();expect(calls).toBe(1);finish();await Promise.all([first,second]);expect(calls).toBe(2);
});

it('NLI browser spacing is two seconds for uncached successful requests',async()=>{
 await rememberGoodreadsKey('b'.repeat(64));vi.useFakeTimers();
 try {
  let calls=0;const adapter=nliCatalogAdapter(async()=>{calls++;return Response.json({provider:'nli',results:[]});});const signal=new AbortController().signal;
  await adapter.search({...emptyQuery,title:'first'},signal);
  const second=adapter.search({...emptyQuery,title:'second'},signal);
  await vi.advanceTimersByTimeAsync(1999);expect(calls).toBe(1);
  await vi.advanceTimersByTimeAsync(1);await second;expect(calls).toBe(2);
 }finally{vi.useRealTimers();}
});

it('NLI wait shows a fixed local deadline, keeps the remaining hold and allows a fresh request exactly at expiry',async()=>{
 await rememberGoodreadsKey('b'.repeat(64));vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
 try {
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:429,headers:{'Retry-After':'60'}})).mockResolvedValue(Response.json({provider:'nli',cached:true,results:[]}));
  const adapter=nliCatalogAdapter(fetcher),signal=new AbortController().signal,query={...emptyQuery,title:'ספר בדיקה'};
  const first=await adapter.search(query,signal).catch(error=>error);
  expect(first.safeMessage).toContain('שירות הקטלוג');expect(first.safeMessage).toContain('אפשר לנסות שוב אחרי');expect(first.safeMessage).not.toContain('ביקש');expect(first.retryAfterMilliseconds).toBe(60000);
  await vi.advanceTimersByTimeAsync(59999);const second=await adapter.search(query,signal).catch(error=>error);
  expect(second.safeMessage).toBe(first.safeMessage);expect(second.retryAfterMilliseconds).toBe(1);expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);await expect(adapter.search(query,signal)).resolves.toEqual([]);expect(fetcher).toHaveBeenCalledTimes(2);
 }finally{vi.useRealTimers();}
});
