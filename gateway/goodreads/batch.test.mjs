import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import {createGoodreadsService} from './service.mjs';
import {createBatchQueue,bookNames,quotaWait,batchModels} from './batch.mjs';
const token='a'.repeat(64),capability='b'.repeat(64),jpeg=Buffer.from([255,216,255,217]),sha=createHash('sha256').update(jpeg).digest('hex');
const response=(title='ספר סינתטי')=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title,authors:['מחבר בדיקה']})}]}}]}),{headers:{'Content-Type':'application/json'}});
const input=id=>({id,capability,gemini:'SYNTHETIC-KEY-NEVER-LIVE',free:true,consent:true});
const photo=(id,itemId=randomUUID())=>({id,itemId,name:'synthetic.jpg',sha,data:jpeg.toString('base64')});
test('names reject extra model fields and quota resets follow provider hints and daily DST boundary',()=>{
 assert.deepEqual(bookNames({title:'ספר',authors:['מחבר']}),{title:'ספר',authors:['מחבר']});assert.throws(()=>bookNames({title:'ספר',authors:[],isbn:'123'}));
 assert.equal(quotaWait(new Headers({'retry-after':'120'}),{},'groq'),120000);assert.equal(quotaWait(new Headers(),{error:{message:'insufficient credits'}},'groq'),null);
 const now=Date.parse('2026-10-12T06:50:00Z'),wait=quotaWait(new Headers(),{error:{details:[{violations:[{quotaId:'RequestsPerDay'}]}]}},'gemini',now);assert.ok(wait>=10*60000&&wait<=12*60000);
});
test('100 photos process once, persist encrypted, isolate capabilities and resume after restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'library-batch-')),path=join(dir,'batch.sqlite'),id=randomUUID();let calls=0;let queue;
 const options={path,token,automatic:false,fetcher:async()=>{calls++;return response();},catalogSearch:async()=>[]};
 try{queue=createBatchQueue(options);queue.create(input(id));for(let n=0;n<100;n++)queue.upload(photo(id),capability);assert.throws(()=>queue.status(id,'c'.repeat(64)));queue.action({id,action:'start'},capability);
  for(let n=0;n<30;n++)await queue.tick();assert.equal(calls,30);queue.close();queue=createBatchQueue(options);for(let n=0;n<71;n++)await queue.tick();const result=queue.status(id,capability);assert.equal(result.status,'complete');assert.equal(calls,100);assert.equal(result.images.filter(row=>row.status==='recognized').length,100);assert.equal(JSON.stringify(result).includes('SYNTHETIC-KEY'),false);queue.close();queue=undefined;assert.equal((await readFile(path)).includes(Buffer.from('SYNTHETIC-KEY-NEVER-LIVE')),false);
 }finally{queue?.close();await rm(dir,{recursive:true,force:true});}
});
test('quota switches only approved models then waits and resumes the same pending photo',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'library-batch-quota-')),path=join(dir,'batch.sqlite'),id=randomUUID();let time=Date.now(),quota=true;const models=[];
 const queue=createBatchQueue({path,token,automatic:false,now:()=>time,fetcher:async(url,init)=>{models.push(String(url).includes('groq')?JSON.parse(init.body).model:String(url).split('/models/')[1].split(':')[0]);return quota?new Response('{}',{status:429,headers:{'retry-after':'60'}}):response();}});
 try{queue.create(input(id));queue.upload(photo(id),capability);queue.action({id,action:'start'},capability);await queue.tick();assert.deepEqual(models,batchModels.gemini);let job=queue.status(id,capability);assert.equal(job.status,'waiting');assert.equal(job.images[0].status,'pending');await queue.tick();assert.equal(models.length,3);quota=false;time+=61000;await queue.tick();job=queue.status(id,capability);assert.equal(job.images[0].status,'recognized');assert.equal(models.length,4);
 }finally{queue.close();await rm(dir,{recursive:true,force:true});}
});
test('pause and delete during a request do not revive a job or send the next photo',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'library-batch-pause-')),path=join(dir,'batch.sqlite'),id=randomUUID();let finish,started;const began=new Promise(resolve=>{started=resolve;});let calls=0;
 const queue=createBatchQueue({path,token,automatic:false,fetcher:()=>{calls++;started();return new Promise(resolve=>{finish=resolve;});}});
 try{queue.create(input(id));queue.upload(photo(id),capability);queue.upload(photo(id),capability);queue.action({id,action:'start'},capability);const running=queue.tick();await began;queue.action({id,action:'pause'},capability);finish(response());await running;await queue.tick();assert.equal(calls,1);assert.equal(queue.status(id,capability).status,'paused');queue.action({id,action:'delete'},capability);assert.throws(()=>queue.status(id,capability));
 }finally{queue.close();await rm(dir,{recursive:true,force:true});}
});
test('HTTP batches require both credentials and retain CORS retry headers at the upload rate limit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'library-batch-http-')),origin='https://itoosh-45.github.io',id=randomUUID();
 const app=createGoodreadsService({path:join(dir,'quota.sqlite'),batchPath:join(dir,'batch.sqlite'),token,origins:[origin],fetcher:async()=>{throw new Error('No provider requests in protocol test');}});app.listen(0,'127.0.0.1');await once(app,'listening');
 const request=(route,body,extra={})=>fetch(`http://127.0.0.1:${app.address().port}/v1/batch/${route}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Batch-Token':capability,...extra},body:JSON.stringify(body)});
 try{assert.equal((await request('create',input(id),{Authorization:'Bearer bad'})).status,401);assert.equal((await request('create',input(id))).status,200);assert.equal((await request('status',{id},{'X-Batch-Token':'c'.repeat(64)})).status,403);assert.equal((await request('upload',photo(id))).status,200);
  let limited;for(let n=0;n<120;n++){const response=await request('status',{id});await response.body?.cancel();if(response.status===429){limited=response;break;}}assert.equal(limited.status,429);assert.equal(limited.headers.get('access-control-allow-origin'),origin);assert.equal(limited.headers.get('retry-after'),'60');
 }finally{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test('rejected keys pause rather than wait for quota; explicit key update repairs the same job',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'library-batch-key-')),id=randomUUID();let valid=false,calls=0;
 const queue=createBatchQueue({path:join(dir,'batch.sqlite'),token,automatic:false,fetcher:async()=>{calls++;return valid?response():new Response('{}',{status:401});}});
 try{queue.create(input(id));queue.upload(photo(id),capability);queue.action({id,action:'start'},capability);await queue.tick();let job=queue.status(id,capability);assert.equal(job.status,'paused');assert.equal(job.images[0].status,'error');assert.equal(calls,1);valid=true;queue.action({...input(id),action:'credentials'},capability);queue.action({id,action:'start'},capability);await queue.tick();job=queue.status(id,capability);assert.equal(job.images[0].status,'recognized');assert.equal(calls,2);}
 finally{queue.close();await rm(dir,{recursive:true,force:true});}
});
test('server timer advances an uploaded job without any client polling',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'library-batch-background-')),id=randomUUID();
 let completed;const recognized=new Promise(resolve=>{completed=resolve;});
 const queue=createBatchQueue({path:join(dir,'batch.sqlite'),token,fetcher:async()=>response(),catalogSearch:async()=>{completed();return [];}});
 try{queue.create(input(id));queue.upload(photo(id),capability);queue.action({id,action:'start'},capability);await Promise.race([recognized,new Promise((_,reject)=>{setTimeout(()=>reject(new Error('Background worker did not advance')),7000).unref();})]);await new Promise(resolve=>setImmediate(resolve));assert.equal(queue.status(id,capability).images[0].status,'recognized');}
 finally{queue.close();await rm(dir,{recursive:true,force:true});}
});
