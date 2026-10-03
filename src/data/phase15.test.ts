import { afterEach, expect, it, vi } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import { emptyInput, saveBook } from './books';
import { createSnapshot, validateBackup, restoreSnapshot } from './backup';
import { createFullSnapshot, recordBackupProduced, confirmBackupChecked } from './fullBackup';
import { mergeSnapshot, previewMerge } from './backupMerge';
import { saveShelf, saveNamedItem } from './collections';
import { lendCopy, localDay } from './loans';
import { hashBytes } from './images';
import { appendDraftImage, createDraft, validateDraft } from './shelfDraft';
import { recognitionModels, validateRecognition } from './recognition';
import { emptyReview } from './draftReviewValues';
import { previewApproved, saveApproved, setItemStatus, updateItemReview } from './shelfReview';
import { readFile } from 'node:fs/promises';

const databases: LibraryDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const database of databases.splice(0)) await database.delete(); });
async function library() { const database = new LibraryDatabase('phase15-' + crypto.randomUUID()); databases.push(database); await initializeLibrary(database); return database; }
async function incoming(database: LibraryDatabase) { return validateBackup((await createFullSnapshot(database)).text); }

it('published synthetic v8 fixtures accept the valid file and reject each corrupt file', async () => {
  await expect(validateBackup(await readFile('tests/fixtures/phase15/valid-empty.json', 'utf8'))).resolves.toMatchObject({ counts: { books: 0 } });
  for (const name of ['unsupported-format', 'corrupt-checksum', 'broken-book-reference']) await expect(validateBackup(await readFile(`tests/fixtures/phase15/${name}.json`, 'utf8'))).rejects.toThrow();
});

it('v8 full envelope restores a fresh install and verifies counts, schema, payload and whitelist before writes', async () => {
  const source = await library(), target = await library();
  await saveBook(source, { ...emptyInput, title: 'ספר מלא סינתטי', authors: ['מחבר'] });
  const snapshot = await createFullSnapshot(source), root = JSON.parse(snapshot.text);
  expect(root).toMatchObject({ format: 'my-library-backup', formatVersion: 8, dbSchemaVersion: 2, manifestCounts: { books: 1, copies: 1, authors: 1 } });
  expect(root).not.toHaveProperty('data'); expect(root).not.toHaveProperty('version');
  const checked = await validateBackup(snapshot.text);
  await restoreSnapshot(target, checked, (await createSnapshot(target)).fingerprint);
  expect((await createSnapshot(target)).fingerprint).toBe(snapshot.fingerprint);
  for (const edit of [
    (value: typeof root) => { value.formatVersion = 999; },
    (value: typeof root) => { value.dbSchemaVersion = 999; },
    (value: typeof root) => { value.tables.books[0].title = 'שינוי בלי checksum'; },
    (value: typeof root) => { value.manifestCounts.books = 99; },
    (value: typeof root) => { value.apiKey = 'forbidden synthetic'; },
  ]) { const forged = structuredClone(root); edit(forged); await expect(validateBackup(JSON.stringify(forged))).rejects.toThrow(); }
  expect((await createSnapshot(target)).fingerprint).toBe(snapshot.fingerprint);
});

it('different-library ID collisions are remapped; all copy/loan/shelf/author links survive and repeat import adds nothing', async () => {
  const source = await library(), target = await library();
  const shelf = await saveShelf(source, { name: 'מדף', parentId: null });
  const sourceBook = await saveBook(source, { ...emptyInput, title: 'המקור', authors: ['מחבר'], shelfIds: [shelf.id] });
  const copy = (await source.copies.toArray())[0];
  await lendCopy(source, { copyId: copy.id, newPersonName: 'שואל', borrowedOn: localDay(), expectedReturnOn: '' });
  const local = await saveBook(target, { ...emptyInput, title: 'נשאר' });
  // Deliberate same UUID in unrelated libraries must never overwrite the target record.
  await source.transaction('rw', source.books, source.copies, source.bookShelves, async () => {
    await source.books.delete(sourceBook.id); await source.books.add({ ...sourceBook, id: local.id });
    await source.copies.update(copy.id, { bookId: local.id }); await source.bookShelves.toCollection().modify({ bookId: local.id });
  });
  const backup = await incoming(source), before = (await createSnapshot(target)).fingerprint;
  const preview = await previewMerge(target, backup); expect((await createSnapshot(target)).fingerprint).toBe(before);
  await mergeSnapshot(target, backup, preview.fingerprint, {}, true);
  expect(await target.books.get(local.id)).toEqual(local);
  const imported = (await target.books.toArray()).find(book => book.title === 'המקור')!;
  expect(imported.id).not.toBe(local.id); expect((await target.authors.get(imported.authorIds[0]))?.displayName).toBe('מחבר');
  const importedCopy = (await target.copies.where('bookId').equals(imported.id).toArray())[0], loan = (await target.loans.toArray())[0];
  expect(loan.copyId).toBe(importedCopy.id); expect((await target.people.get(loan.personId))?.name).toBe('שואל');
  expect((await target.bookShelves.toArray())[0].bookId).toBe(imported.id);
  const merged = (await createSnapshot(target)).fingerprint;
  const repeat = await previewMerge(target, backup); expect(repeat.additions).toBe(0); expect(repeat.conflicts).toEqual([]);
  await mergeSnapshot(target, backup, repeat.fingerprint, {}, true); expect((await createSnapshot(target)).fingerprint).toBe(merged);
});

it('same-library revisions require choices; keeping current preserves edits and incoming choice advances revision', async () => {
  const database = await library(), book = await saveBook(database, { ...emptyInput, title: 'ישן' });
  const backup = await incoming(database);
  await saveBook(database, { ...emptyInput, title: 'חדש' }, book);
  const plan = await previewMerge(database, backup); expect(plan.conflicts).toHaveLength(1);
  await expect(mergeSnapshot(database, backup, plan.fingerprint, {}, true)).rejects.toThrow('בחר גרסה');
  await mergeSnapshot(database, backup, plan.fingerprint, { [plan.conflicts[0].key]: 'current' }, true);
  expect((await database.books.get(book.id))?.title).toBe('חדש');
  const current = (await database.books.get(book.id))!;
  const next = await previewMerge(database, backup);
  await mergeSnapshot(database, backup, next.fingerprint, { [next.conflicts[0].key]: 'incoming' }, true);
  expect((await database.books.get(book.id))?.title).toBe('ישן'); expect((await database.books.get(book.id))!.revision).toBeGreaterThan(current.revision);
});

it('similar titles and colliding collection names need explicit separate confirmation and remain repeatable', async () => {
  const source = await library(), target = await library();
  await saveNamedItem(source, 'tags', 'תגית'); await saveNamedItem(target, 'tags', 'תגית');
  await saveBook(source, { ...emptyInput, title: 'מהדורה דומה' }); await saveBook(target, { ...emptyInput, title: 'מהדורה דומה' });
  const backup = await incoming(source), plan = await previewMerge(target, backup);
  expect(plan.duplicateBooks).toHaveLength(1); expect(plan.renamedCollections).toHaveLength(1);
  await expect(mergeSnapshot(target, backup, plan.fingerprint, {}, false)).rejects.toThrow('אשר');
  await mergeSnapshot(target, backup, plan.fingerprint, {}, true);
  expect(await target.books.count()).toBe(2); expect(await target.tags.count()).toBe(2);
  const repeat = await previewMerge(target, backup); expect(repeat.additions).toBe(0); expect(repeat.conflicts).toEqual([]);
});

it('a changed target, forged incoming graph and an aborted write each preserve every original record', async () => {
  const source = await library(), target = await library(); await saveBook(source, { ...emptyInput, title: 'מייבא' });
  const backup = await incoming(source), plan = await previewMerge(target, backup);
  await saveBook(target, { ...emptyInput, title: 'חלון אחר' });
  const before = (await createSnapshot(target)).fingerprint;
  await expect(mergeSnapshot(target, backup, plan.fingerprint, {}, true)).rejects.toThrow('השתנתה');
  const forged = structuredClone(backup); forged.data.copies[0].bookId = crypto.randomUUID();
  await expect(mergeSnapshot(target, forged, before, {}, true)).rejects.toThrow();
  const abort = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); };
  target.copies.hook('creating', abort);
  try { await expect(mergeSnapshot(target, backup, before, {}, true)).rejects.toThrow(); } finally { target.copies.hook('creating').unsubscribe(abort); }
  expect((await createSnapshot(target)).fingerprint).toBe(before);
});

it('combined loan histories that overlap are rejected before any active-table write', async () => {
  const database = await library(), book = await saveBook(database, { ...emptyInput, title: 'השאלות' });
  const copy = (await database.copies.where('bookId').equals(book.id).toArray())[0];
  await lendCopy(database, { copyId: copy.id, newPersonName: 'א', borrowedOn: localDay(), expectedReturnOn: '' });
  const root = JSON.parse((await createSnapshot(database)).text); root.data.loans[0].id = crypto.randomUUID();
  root.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(root.data)).buffer);
  const backup = await validateBackup(JSON.stringify(root)), before = (await createSnapshot(database)).fingerprint;
  await expect(mergeSnapshot(database, backup, before, {}, true)).rejects.toThrow('חופפות');
  expect((await createSnapshot(database)).fingerprint).toBe(before);
});

it('produced and checked dates are distinct and cannot invalidate an otherwise-current safety snapshot', async () => {
  const database = await library(), snapshot = await createFullSnapshot(database), at = JSON.parse(snapshot.text).exportedAt;
  await recordBackupProduced(database, at); expect(await database.settings.get('lastBackupCheckedAt')).toBeUndefined();
  expect((await createSnapshot(database)).fingerprint).toBe(snapshot.fingerprint);
  await confirmBackupChecked(database, at); expect((await database.settings.get('lastBackupCheckedAt'))?.value).toBe(at);
  await recordBackupProduced(database, '2026-10-03T18:00:00.000Z'); await expect(confirmBackupChecked(database, at)).rejects.toThrow('הופק גיבוי חדש');
  await expect(validateBackup((await createFullSnapshot(database)).text)).resolves.toBeDefined();
});

it('saved shelf review, source image hash, selected provenance and nested review references survive a foreign merge', async () => {
  const source = await library(), target = await library();
  const shelf = await saveShelf(source, { name: 'מדף מקור', parentId: null }), tag = await saveNamedItem(source, 'tags', 'תגית מקור');
  const draft = await createDraft(source, shelf.id);
  // Structural JPEG fixture for the unit decoder; real JPEG decode is covered by browser round trips.
  const blob = new Blob([new Uint8Array([255,216,255,192,0,17,8,0,2,0,3,3,1,17,0,2,17,0,3,17,0,255,217])], { type: 'image/jpeg' });
  const image = { id: crypto.randomUUID(), blob, mimeType: 'image/jpeg', width: 3, height: 2, byteLength: blob.size,
    sha256: await hashBytes(await blob.arrayBuffer()), sourceUrl: null, createdAt: new Date().toISOString() };
  await appendDraftImage(source, draft.id, 'SYNTHETIC.jpg', image.sha256, image);
  const stored = (await source.recognitionDrafts.get(draft.id))!;
  stored.images[0].status = 'recognized'; stored.status = 'complete';
  const item = validateRecognition({ items: [{ title: 'ספר מדף מקור', authors: [], isbn: null, danacode: null, publisher: null, visibleText: 'ספר מדף מקור', evidenceByField: { title: ['ספר מדף מקור'], authors: [], isbn: [], danacode: [], publisher: [] }, imageIndex: 0, bbox: [0,0,1,1], uncertaintyReasons: [] }] }).items[0];
  const itemId = crypto.randomUUID();
  stored.items.push({ id: itemId, imageId: stored.images[0].id, item, model: recognitionModels.primary, fetchedAt: new Date().toISOString(), status: 'detected', selectedFields: ['title'], bookId: null, copyId: null });
  await source.recognitionDrafts.put(validateDraft(stored));
  let revision = await updateItemReview(source, draft.id, itemId, stored.revision, { ...emptyReview(), decision: 'new', input: { ...emptyInput, title: item.title!, shelfIds: [shelf.id], tagIds: [tag.id] } }, ['title']);
  revision = await setItemStatus(source, draft.id, itemId, revision, 'approved'); expect(revision).toBeGreaterThan(stored.revision);
  await saveApproved(source, await previewApproved(source, draft.id));
  const backup = await incoming(source), plan = await previewMerge(target, backup);
  await mergeSnapshot(target, backup, plan.fingerprint, {}, true);
  const importedDraft = (await target.recognitionDrafts.toArray())[0], importedBook = (await target.books.toArray())[0], provenance = (await target.metadataSources.toArray())[0];
  expect(importedDraft.id).not.toBe(draft.id); expect(importedDraft.batchId).toBe(importedDraft.id);
  expect(importedDraft.items[0]).toMatchObject({ status: 'saved', bookId: importedBook.id });
  expect(importedDraft.items[0].review!.input.tagIds).toEqual(importedBook.tagIds);
  expect(importedDraft.items[0].review!.input.shelfIds).toEqual([importedDraft.shelfId]);
  expect(provenance.recognition).toMatchObject({ batchId: importedDraft.id, itemId: importedDraft.items[0].id, imageHash: image.sha256 });
  const importedImage = (await target.images.toArray())[0]; expect(await hashBytes(await importedImage.blob.arrayBuffer())).toBe(image.sha256);
  expect(importedDraft.images[0].storedImageId).toBe(importedImage.id);
  await expect(incoming(target)).resolves.toBeDefined();
  const repeat = await previewMerge(target, backup); expect(repeat.additions).toBe(0); expect(repeat.conflicts).toEqual([]);
});
