import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createGoodreadsService } from './service.mjs';
import { iclSearchForm, parseIclSearch, parseIclBook, iclUrl } from './icl.mjs';
const token='a'.repeat(64),origin='https://itoosh-45.github.io';
const form=`<FORM NAME="htmldw_submitForm"><INPUT TYPE="hidden" NAME="site" VALUE="icl"></FORM><script>htmldw.context = "(synthetic)";htmldw.rows[0] = new HTDW_RowClass( "((46 0 'TI'))",2,null);htmldw.cols[79] = new HTDW_ColumnClass(79, 'get_var');</script>`;
const results=`<div id="results_list"><table><a href="multimedia/2026/10/9/26-001f.jpg"></a><td id="element1"><a href="notebook.asp?param=<book_id>123</>" title="פרטים נוספים"><span class="bidi">ספר סינתטי</span></a><p>מחבר: <span>מחבר</span></p></td></table><table><td id="element2"><a href="notebook.asp?param=<book_id>124</>"><span>ספר בלי כריכה</span></a></td></table></div>`;
const book=`<script>var url='<book_id>123</>';</script><a class="main_image" href="multimedia/2026/10/9/26-001f.jpg"></a><div id="item"><table><tbody><tr><td class="strong">כותר</td><td><span>ספר סינתטי</span></td></tr><tr><td class="strong">מסת&quot;ב</td><td><span>9780140328721</span></td></tr></tbody></table>`;
test('ICL parsing binds each cover to its book and keeps only the selected record',()=>{
  const rows=parseIclSearch(results);assert.equal(rows.length,2);assert.match(rows[0].coverUrl,/26-001f.jpg$/);assert.equal(rows[1].coverUrl,undefined);
  assert.equal(parseIclBook(book,'123').fields.isbn13,'9780140328721');assert.throws(()=>parseIclBook(book,'124'));
  assert.match(iclSearchForm(form,"שם 'ספר'").get('htmldw_context'),/~'ספר~'/);
  assert.throws(()=>parseIclSearch('<h5 role="alert">לא נבחר מאגר</h5>'));
});
test('ICL service authenticates, caches searches, preserves quota and proxies only front covers',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'library-icl-'));let calls=0;
  const app=createGoodreadsService({token,origins:[origin],path:join(dir,'quota.sqlite'),dailyLimit:20,fetcher:async(url,init)=>{
    calls++;assert.equal(new URL(url).hostname,'infocenters.co.il');assert.equal(init.redirect,'error');
    if(String(url).includes('/multimedia/'))return new Response(new Uint8Array([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}});
    return new Response(String(url).includes('search.asp')?form:String(url).endsWith('list.asp')?results:book,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  }});app.listen(0,'127.0.0.1');await once(app,'listening');
  const request=(route,body,auth=token)=>fetch(`http://127.0.0.1:${app.address().port}${route}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Authorization:'Bearer '+auth},body:JSON.stringify(body)});
  try{
    assert.equal((await request('/v1/icl-search',{query:{title:'ספר'}},'bad')).status,401);assert.equal(calls,0);
    const first=await request('/v1/icl-search',{query:{title:'ספר'}});assert.equal(first.status,200);assert.equal((await first.json()).results.length,2);assert.equal(calls,2);
    const repeat=await request('/v1/icl-search',{query:{title:'ספר'}});assert.equal((await repeat.json()).cached,true);assert.equal(calls,2);
    assert.equal((await request('/v1/icl-book',{id:'123'})).status,200);
    assert.equal((await request('/v1/icl-cover',{url:'http://127.0.0.1/admin'})).status,400);
    const cover=await request('/v1/icl-cover',{url:'https://infocenters.co.il/icl/multimedia/2026/10/9/26-001f.jpg'});assert.equal(cover.status,200);assert.equal((await cover.arrayBuffer()).byteLength,4);
    assert.throws(()=>iclUrl('123?key=secret'));
  }finally{app.close();app.closeAllConnections();await once(app,'close');await rm(dir,{recursive:true,force:true});}
});
