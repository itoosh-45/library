import { afterEach, expect, it } from 'vitest';
import { iclAdapter } from './icl';
import { rememberGoodreadsKey, forgetGoodreadsKey } from './goodreads';
import { emptyQuery } from './catalog';
import { validateCandidate } from './metadata';
import { safeCatalogCoverUrl } from './catalogCoverUrl';
import { LibraryDatabase, initializeLibrary } from './database';
import { saveCatalogBook } from './catalogSave';
import { emptyInput } from './books';
import { createFullSnapshot } from './fullBackup';
import { validateBackup } from './backup';
const source = {provider:'icl',recordId:'123',sourceUrl:'https://infocenters.co.il/icl/notebook_ext.asp?book=123&lang=heb&site=icl',fetchedAt:'2026-10-09T00:00:00.000Z',kind:'edition',fields:{title:'ספר בדיקה',authors:['מחבר בדיקה'],isbn13:'9780140328721'},warnings:[],coverUrl:'https://infocenters.co.il/icl/multimedia/2026/10/9/26-123f.jpg'};
afterEach(forgetGoodreadsKey);
it('ICL validates fixed source and front cover URLs',()=>{
  expect(validateCandidate(source).provider).toBe('icl');
  expect(()=>validateCandidate({...source,sourceUrl:source.sourceUrl.replace('book=123','book=124')})).toThrow();
  for(const url of [source.coverUrl.replace('f.jpg','b.jpg'),source.coverUrl+'?token=x','https://infocenters.co.il/admin.jpg']) expect(safeCatalogCoverUrl(url,'icl')).toBe(false);
});
it('authenticated ICL search, selection and backup preserve metadata and omit the key',async()=>{
  const key='b'.repeat(64);await rememberGoodreadsKey(key);
  const adapter=iclAdapter(async(url,init)=>{expect(init?.headers).toMatchObject({Authorization:'Bearer '+key});return Response.json(String(url).endsWith('icl-search')?{provider:'icl',results:[source],cached:true}:source);});
  const rows=await adapter.search({...emptyQuery,title:'ספר בדיקה'},new AbortController().signal);
  const result=await adapter.resolve!(rows[0],new AbortController().signal);
  const db=new LibraryDatabase('icl-'+crypto.randomUUID());
  try{await initializeLibrary(db);await saveCatalogBook(db,{...emptyInput,title:'ספר בדיקה'},result,['title','authors','isbn13']);const backup=await createFullSnapshot(db);expect(backup.text).not.toContain(key);expect((await validateBackup(backup.text)).data.metadataSources[0].provider).toBe('icl');}finally{await db.delete();}
});
