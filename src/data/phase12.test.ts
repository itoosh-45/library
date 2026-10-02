import { afterEach, expect, it, vi } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import type { DraftItem, DraftReview } from './models';
import Dexie from 'dexie';
import { recognitionInput, recognitionModels, validateRecognition } from './recognition';
import { createDraft, validateDraft } from './shelfDraft';
import { emptyReview, validateReview } from './draftReviewValues';
import { previewApproved, saveApproved, setItemStatus, updateItemReview } from './shelfReview';
import { createSnapshot, deleteBook, restoreSnapshot, validateBackup } from './backup';
import { emptyInput, saveBook } from './books';
import { hashBytes } from './images';
import { validateMetadataSource, type Candidate } from './metadata';
import { saveShelf } from './collections';

const databases: LibraryDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const database of databases.splice(0)) await database.delete(); });
async function fixture(count = 3, shelf = false) {
  const database = new LibraryDatabase('phase12-' + crypto.randomUUID()); databases.push(database); await initializeLibrary(database);
  const shelfId = shelf ? (await saveShelf(database, { name: 'מדף דמה', parentId: null })).id : null, draft = await createDraft(database, shelfId);
  for (let i = 0; i < Math.ceil(count / 25); i++) draft.images.push({ id: crypto.randomUUID(), name: 'synthetic-' + i + '.jpg', inputHash: 'a'.repeat(64), storedImageId: null, preparedHash: 'b'.repeat(64), status: 'recognized', message: null });
  for (let i = 0; i < count; i++) {
    const title = 'ספר מדף ' + i, item = validateRecognition({ items: [{ title, authors: [], isbn: null, danacode: null, publisher: null, visibleText: title, evidenceByField: { title: [title], authors: [], isbn: [], danacode: [], publisher: [] }, imageIndex: 0, bbox: [0,0,1,1], uncertaintyReasons: ['מחבר לא נראה'] }] }).items[0];
    draft.items.push({ id: crypto.randomUUID(), imageId: draft.images[Math.floor(i / 25)].id, item, model: recognitionModels.primary, fetchedAt: new Date().toISOString(), status: 'detected', selectedFields: [], bookId: null, copyId: null });
  }
  draft.status = 'complete'; await database.recognitionDrafts.put(validateDraft(draft));
  return { database, id: draft.id };
}
async function draft(database: LibraryDatabase, id: string) { return (await database.recognitionDrafts.get(id))!; }
function newReview(item: DraftItem): DraftReview { return { ...emptyReview(), input: recognitionInput(emptyInput, item.item, ['title']), decision: 'new' }; }
async function edit(database: LibraryDatabase, id: string, index: number, review?: DraftReview, selected: DraftItem['selectedFields'] = ['title']) {
  const current = await draft(database, id); await updateItemReview(database, id, current.items[index].id, current.revision, review ?? newReview(current.items[index]), selected);
}
async function approve(database: LibraryDatabase, id: string, index: number) { const current = await draft(database, id); await setItemStatus(database, id, current.items[index].id, current.revision, 'approved'); }
it('T18 detected/reviewed rows never write books; only approved rows save with explicit preview', async () => {
  const { database, id } = await fixture(); await edit(database, id, 0); await edit(database, id, 1); expect(await database.books.count()).toBe(0); await approve(database, id, 0);
  const preview = await previewApproved(database, id); expect(preview).toMatchObject({ newBooks: 1, extraCopies: 0, excluded: 2 }); const outcome = await saveApproved(database, preview); expect(outcome.saved).toBe(1); expect(await database.books.count()).toBe(1); expect((await draft(database, id)).items.map(item => item.status)).toEqual(['saved','reviewed','detected']);
  const source = (await database.metadataSources.toArray())[0]; expect(source.recognition?.batchId).toBe(id); expect(source.recognition?.itemId).toBe(preview.itemIds[0]); expect(source.selectedFields).toEqual(['title']); validateMetadataSource(source);
});
it('T18 50 items preserve item IDs, shelf links and idempotency under concurrent save attempts', async () => {
  const { database, id } = await fixture(50, true), ids = (await draft(database, id)).items.map(item => item.id);
  for (let i = 0; i < 50; i++) { await edit(database, id, i); await approve(database, id, i); }
  const preview = await previewApproved(database, id), [a,b] = await Promise.all([saveApproved(database, preview), saveApproved(database, preview)]);
  expect(a.saved + b.saved).toBe(50); expect(await database.books.count()).toBe(50); expect(await database.copies.count()).toBe(50); expect(await database.metadataSources.count()).toBe(50); expect(await database.bookShelves.count()).toBe(50); expect((await draft(database, id)).items.map(item => item.id)).toEqual(ids); expect((await saveApproved(database, preview)).saved).toBe(0);
});
it('T09 extra copies leave existing bibliographic values intact, including two copies in one save', async () => {
  const { database, id } = await fixture(2, true), existing = await saveBook(database, { ...emptyInput, title: 'קיים', authors: ['מחבר קיים'], personalNotes: 'הערה קיימת' });
  for (let i = 0; i < 2; i++) { await edit(database, id, i, { ...newReview((await draft(database,id)).items[i]), decision: 'copy', targetBookId: existing.id, targetRevision: existing.revision }); await approve(database, id, i); }
  const outcome = await saveApproved(database, await previewApproved(database,id)); expect(outcome.saved).toBe(2); expect(await database.books.count()).toBe(1); expect(await database.copies.count()).toBe(3); const after = (await database.books.get(existing.id))!; expect(after.title).toBe('קיים'); expect(after.authorIds).toEqual(existing.authorIds); expect(after.personalNotes).toBe('הערה קיימת'); expect(await database.bookShelves.count()).toBe(1); expect((await database.metadataSources.toArray()).every(source => !source.selectedFields.length)).toBe(true);
});
it('T09 ISBN duplicate requires a copy choice or explicit separate-new-book acknowledgement', async () => {
  const { database,id } = await fixture(1); await saveBook(database, { ...emptyInput,title:'קיים',isbn:'0140328726' });
  const review = { ...newReview((await draft(database,id)).items[0]), input: { ...newReview((await draft(database,id)).items[0]).input, isbn:'9780140328721' } }; await edit(database,id,0,review); await expect(approve(database,id,0)).rejects.toThrow('כבר קיים'); expect(await database.books.count()).toBe(1);
  await edit(database,id,0,{...review,allowDuplicate:true}); await approve(database,id,0); await saveApproved(database,await previewApproved(database,id)); expect(await database.books.count()).toBe(2);
});
it('T18 editing after approval clears approval and stale or forged previews cannot save', async () => {
  const {database,id}=await fixture(2); await edit(database,id,0); await approve(database,id,0); const preview=await previewApproved(database,id); await edit(database,id,0,{...newReview((await draft(database,id)).items[0]),input:{...emptyInput,title:'ידני'}});
  expect((await draft(database,id)).items[0].status).toBe('reviewed'); await expect(saveApproved(database,preview)).rejects.toThrow('השתנתה'); expect(await database.books.count()).toBe(0); await approve(database,id,0); const fresh=await previewApproved(database,id); await expect(saveApproved(database,{...fresh,newBooks:0})).rejects.toThrow('סיכום'); expect(await database.books.count()).toBe(0);
});
it('T18 metadata-write failure rolls back every book/copy/source and all saved item markers', async () => {
  const {database,id}=await fixture(2); for(let i=0;i<2;i++){await edit(database,id,i);await approve(database,id,i);} const before=await createSnapshot(database), preview=await previewApproved(database,id);
  const original=database.metadataSources.add.bind(database.metadataSources); let calls=0; const write=vi.spyOn(database.metadataSources,'add').mockImplementation((...args)=>{calls++;if(calls===2)return Dexie.Promise.reject(new Error('synthetic-write'));return original(...args);});
  await expect(saveApproved(database,preview)).rejects.toThrow('synthetic-write'); write.mockRestore(); expect(await database.books.count()).toBe(0);expect(await database.copies.count()).toBe(0);expect(await database.metadataSources.count()).toBe(0);expect((await createSnapshot(database)).fingerprint).toBe(before.fingerprint);
});
it('T18 stale item edit or changed copy target cannot overwrite another window', async () => {
  const {database,id}=await fixture(1), original=await draft(database,id); await edit(database,id,0);await expect(updateItemReview(database,id,original.items[0].id,original.revision,newReview(original.items[0]),['title'])).rejects.toThrow('חלון אחר');
  const book=await saveBook(database,{...emptyInput,title:'יעד'});await edit(database,id,0,{...newReview(original.items[0]),decision:'copy',targetBookId:book.id,targetRevision:book.revision});await approve(database,id,0);const preview=await previewApproved(database,id);await saveBook(database,{...emptyInput,title:'שונה'},book);await expect(saveApproved(database,preview)).rejects.toThrow('היעד השתנה');expect(await database.copies.count()).toBe(1);
});
it('T18 catalog and manual values keep image evidence distinct and survive full backup/restore', async () => {
  const {database,id}=await fixture(1), item=(await draft(database,id)).items[0]; const candidate:Candidate={provider:'openlibrary',recordId:'/books/synthetic',sourceUrl:null,fetchedAt:new Date().toISOString(),kind:'edition',fields:{publisher:'הוצאה מקטלוג'},warnings:[]};
  await edit(database,id,0,{...newReview(item),input:{...newReview(item).input,title:'שם שערכתי',publisher:'הוצאה מקטלוג'},catalogs:[{candidate,selected:['publisher']}]});await approve(database,id,0);await saveApproved(database,await previewApproved(database,id));
  const sources=await database.metadataSources.toArray(), image=sources.find(source=>source.provider==='gemini')!;expect(image.userOverriddenFields).toEqual(['title']);expect(image.recognition?.item.title).toBe('ספר מדף 0');expect(sources).toHaveLength(2);
  const snapshot=await createSnapshot(database),incoming=await validateBackup(snapshot.text);expect(JSON.parse(snapshot.text).version).toBe(7);await restoreSnapshot(database,incoming,snapshot.fingerprint);expect((await draft(database,id)).items[0].status).toBe('saved');expect((await database.metadataSources.toArray()).find(source=>source.provider==='gemini')).toEqual(image);
  const protectedSnapshot=await createSnapshot(database);await deleteBook(database,(await database.books.toArray())[0].id,protectedSnapshot.fingerprint);expect((await draft(database,id)).items[0].status).toBe('removed');await createSnapshot(database);
});
it('T18 removal and malformed review fields never approve or enter the library', async () => {
  const {database,id}=await fixture(1),current=await draft(database,id);await expect(setItemStatus(database,id,current.items[0].id,current.revision,'approved')).rejects.toThrow('בדוק');await setItemStatus(database,id,current.items[0].id,current.revision,'removed');expect((await previewApproved(database,id)).itemIds).toEqual([]);expect(await database.books.count()).toBe(0);
  expect(()=>validateReview({...emptyReview(),input:{...emptyInput,apiKey:'forbidden'}})).toThrow();expect(()=>validateReview({...emptyReview(),decision:'copy',targetBookId:crypto.randomUUID(),targetRevision:null})).toThrow();
});
it('T18 v6 detected drafts retain evidence and remain unapproved on import', async () => {
  const {database,id}=await fixture(2),snapshot=await createSnapshot(database),root=JSON.parse(snapshot.text);root.version=6;root.checksum=await hashBytes(new TextEncoder().encode(JSON.stringify(root.data)).buffer);const incoming=await validateBackup(JSON.stringify(root));await restoreSnapshot(database,incoming,snapshot.fingerprint);expect((await draft(database,id)).items.every(item=>item.status==='detected'&&!item.review)).toBe(true);
});
