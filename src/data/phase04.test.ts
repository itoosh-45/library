import { afterEach, beforeEach, expect, it } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import { changeCopy, duplicateBooks, emptyInput, parseISBN, saveBook } from './books';
import { createSnapshot, deleteBook, restoreSnapshot, validateBackup } from './backup';
import { hashBytes } from './images';
import { renameLibrary } from './library';

let database: LibraryDatabase;
beforeEach(async () => { database = new LibraryDatabase('phase04-' + crypto.randomUUID()); await initializeLibrary(database); });
afterEach(async () => { await database.delete(); });
async function changedBackup(edit: (backup: ReturnType<typeof JSON.parse>) => void) {
  const snapshot = await createSnapshot(database); const backup = JSON.parse(snapshot.text); edit(backup);
  backup.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(backup.data)).buffer);
  return JSON.stringify(backup);
}
it('optional fields, whole author names, three copies, archive/reopen and revision protection survive reopening', async () => {
  const original = await saveBook(database, { ...emptyInput, authors: ['שם עט מלא', 'דנה בדיקה', 'דנה בדיקה'], unsupportedField: 9 } as never);
  expect(original.title).toBeNull(); expect(original.authorIds).toHaveLength(2); expect(original).not.toHaveProperty('rating');
  expect((await database.authors.get(original.authorIds[0]))?.displayName).toBe('שם עט מלא');
  const second = await changeCopy(database, original.id, 1, { label: 'עותק שני', price: '12.30' });
  await changeCopy(database, original.id, 2, {});
  expect(await database.books.count()).toBe(1); expect(await database.copies.count()).toBe(3);
  await expect(saveBook(database, emptyInput, original)).rejects.toThrow('השתנה');
  await expect(changeCopy(database, original.id, 1, {})).rejects.toThrow('השתנה');
  await changeCopy(database, original.id, 3, { id: second.id, label: 'עותק שני', price: '12.30', archive: true });
  await changeCopy(database, original.id, 4, { id: second.id, label: 'עותק שני', price: '12.30', archive: false });
  database.close(); await database.open();
  expect(await database.copies.get(second.id)).toMatchObject({ archivedAt: null, purchasePriceMinor: 1230, currency: 'ILS' });
});
it('ISBN checksum and cross-format duplicates require an explicit separate-book decision', async () => {
  expect(parseISBN('0-306-40615-2').isbn10).toBe('0306406152');
  expect(() => parseISBN('9780306406158')).toThrow('ISBN');
  expect(() => parseISBN('123')).toThrow('ISBN');
  const first = await saveBook(database, { ...emptyInput, isbn: '0306406152' });
  const input = { ...emptyInput, isbn: '9780306406157' };
  expect((await duplicateBooks(database, input)).map(book => book.id)).toEqual([first.id]);
  await expect(saveBook(database, input)).rejects.toThrow('כבר נמצא');
  await saveBook(database, input, undefined, undefined, true); expect(await database.books.count()).toBe(2);
});
it('failed copy write rolls back new authors and book; invalid numeric fields never write', async () => {
  await expect(saveBook(database, { ...emptyInput, publicationYear: 'abc' })).rejects.toThrow();
  const fail = () => { throw new Error('injected-copy-failure'); }; database.copies.hook('creating', fail);
  await expect(saveBook(database, { ...emptyInput, title: 'לא יישמר', authors: ['חדש'] })).rejects.toThrow('injected-copy');
  database.copies.hook('creating').unsubscribe(fail);
  expect(await database.books.count()).toBe(0); expect(await database.authors.count()).toBe(0);
});
it('a copy failure rolls back the book edit in the same transaction', async () => {
  const book = await saveBook(database, { ...emptyInput, title: 'לפני' });
  const fail = () => { throw new Error('copy failure'); }; database.copies.hook('creating', fail);
  await expect(database.transaction('rw', [database.books, database.copies, database.authors, database.images, database.loans, database.shelves, database.bookShelves, database.genres, database.tags, database.series], async () => {
    const changed = await saveBook(database, { ...emptyInput, title: 'אחרי' }, book);
    await changeCopy(database, changed.id, changed.revision, {});
  })).rejects.toThrow();
  database.copies.hook('creating').unsubscribe(fail);
  expect((await database.books.get(book.id))?.title).toBe('לפני');
});
it('an open loan prevents archiving and changes nothing', async () => {
  const book = await saveBook(database, emptyInput), copy = (await database.copies.toArray())[0];
  const now = new Date().toISOString();
  await database.loans.add({ id: crypto.randomUUID(), copyId: copy.id, personId: crypto.randomUUID(), borrowedAt: now, expectedReturnOn: null, returnedAt: null, openFlag: 1, notes: null, createdAt: now, updatedAt: now });
  await expect(changeCopy(database, book.id, book.revision, { id: copy.id, archive: true })).rejects.toThrow('מושאל');
  expect((await database.books.get(book.id))?.revision).toBe(1); expect((await database.copies.get(copy.id))?.archivedAt).toBeNull();
});
it('basic snapshot restores exact book/copy/author/settings data and identity', async () => {
  const book = await saveBook(database, { ...emptyInput, title: 'ספר בדיקה', authors: ['מחבר א', 'מחבר ב'], personalNotes: 'הערת בדיקה', pages: '250', readStatus: 'read' });
  await changeCopy(database, book.id, book.revision, {});
  const saved = await createSnapshot(database), incoming = await validateBackup(saved.text);
  await saveBook(database, { ...emptyInput, title: 'זמני' });
  const safety = await createSnapshot(database); await restoreSnapshot(database, incoming, safety.fingerprint);
  expect((await createSnapshot(database)).fingerprint).toBe(saved.fingerprint);
});
it('bad versions, secrets, invalid types, orphan relations and inconsistent counts are rejected without writes', async () => {
  await saveBook(database, emptyInput); const before = await createSnapshot(database);
  const edits = [
    (b: ReturnType<typeof JSON.parse>) => { b.version = 99; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.books[0].apiKey = 'synthetic-forbidden'; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.copies[0].bookId = crypto.randomUUID(); },
    (b: ReturnType<typeof JSON.parse>) => { b.data.books[0].readStatus = ['read']; },
    (b: ReturnType<typeof JSON.parse>) => { b.counts.books = 99; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.settings.push({ key: 'apiKey', value: 'synthetic-forbidden' }); },
    (b: ReturnType<typeof JSON.parse>) => { b.data.books[0].authorIds = [null]; },
  ];
  for (const edit of edits) await expect(validateBackup(await changedBackup(edit))).rejects.toThrow();
  await expect(validateBackup(before.text.replace('ללא-טקסט', 'noop') + 'bad')).rejects.toThrow();
  expect((await createSnapshot(database)).fingerprint).toBe(before.fingerprint);
});
it('incoming checksum tampering and unknown stored fields cannot be exported', async () => {
  const book = await saveBook(database, { ...emptyInput, title: 'לפני' });
  const snapshot = await createSnapshot(database);
  await expect(validateBackup(snapshot.text.replace('לפני', 'אחרי'))).rejects.toThrow('שלמות');
  await database.books.put({ ...book, apiKey: 'synthetic-forbidden' } as never);
  await expect(createSnapshot(database)).rejects.toThrow();
});
it('failed restore rolls back all clears and inserts', async () => {
  await saveBook(database, { ...emptyInput, title: 'מקור' });
  const original = await createSnapshot(database), incoming = await validateBackup(original.text);
  await saveBook(database, { ...emptyInput, title: 'נוסף' }); const safety = await createSnapshot(database);
  const fail = () => { throw new Error('injected restore failure'); }; database.copies.hook('creating', fail);
  await expect(restoreSnapshot(database, incoming, safety.fingerprint)).rejects.toThrow('injected restore');
  database.copies.hook('creating').unsubscribe(fail);
  expect((await createSnapshot(database)).fingerprint).toBe(safety.fingerprint);
});
it('restore revalidates a modified parsed backup before entering its write transaction', async () => {
  await saveBook(database, emptyInput); const snapshot = await createSnapshot(database), backup = await validateBackup(snapshot.text);
  backup.data.copies[0].bookId = crypto.randomUUID();
  await expect(restoreSnapshot(database, backup, snapshot.fingerprint)).rejects.toThrow();
  expect((await createSnapshot(database)).fingerprint).toBe(snapshot.fingerprint);
});
it('changes after a safety snapshot prevent restore and deletion', async () => {
  const book = await saveBook(database, emptyInput), before = await createSnapshot(database), incoming = await validateBackup(before.text);
  await renameLibrary(database, 'שינוי בחלון אחר'); const changed = await createSnapshot(database);
  await expect(restoreSnapshot(database, incoming, before.fingerprint)).rejects.toThrow('השתנתה');
  await expect(deleteBook(database, book.id, before.fingerprint)).rejects.toThrow('השתנתה');
  expect((await createSnapshot(database)).fingerprint).toBe(changed.fingerprint);
});
it('delete removes only the selected book and copies after a safety snapshot', async () => {
  const first = await saveBook(database, { ...emptyInput, title: 'מחיקה', authors: ['מחבר א'] });
  const second = await saveBook(database, { ...emptyInput, title: 'נשאר', authors: ['מחבר ב'] });
  await deleteBook(database, first.id, (await createSnapshot(database)).fingerprint);
  expect(await database.books.toArray()).toEqual([second]); expect(await database.copies.count()).toBe(1); expect(await database.authors.count()).toBe(1);
});
it('basic snapshot refuses malformed stored provenance rather than dropping it', async () => {
  await database.metadataSources.add({ id: crypto.randomUUID() } as never);
  await expect(createSnapshot(database)).rejects.toThrow(); expect(await database.metadataSources.count()).toBe(1);
});
