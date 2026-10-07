import { expect, it } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import { bookFields, emptyInput, saveBook } from './books';
import { createFullSnapshot } from './fullBackup';
import { restoreSnapshot, validateBackup } from './backup';
import { fullWorkbook, fullWorkbookCandidate } from './xlsxWorkbook';
import { normalizeGoogleBooks } from './catalogGateway';

it('full dates validate the calendar and derive a consistent searchable year', () => {
  expect(bookFields({ ...emptyInput, publicationDate: '2024-02-29' })).toMatchObject({ publicationDate: '2024-02-29', publicationYear: 2024 });
  for (const publicationDate of ['2023-02-29', '2024-13-01', '2024-02']) expect(() => bookFields({ ...emptyInput, publicationDate })).toThrow();
  expect(() => bookFields({ ...emptyInput, publicationDate: '2024-02-29', publicationYear: '2020' })).toThrow();
  expect(normalizeGoogleBooks({ items: [{ id: 'example', volumeInfo: { publishedDate: '2024-02' } }] })[0].fields).toEqual({ publicationYear: 2024 });
});

it('split author names, binding and publication date survive JSON restore and Excel round trips', async () => {
  const db = new LibraryDatabase('details-' + crypto.randomUUID());
  try {
    await initializeLibrary(db);
    const book = await saveBook(db, { ...emptyInput, title: 'ספר בדיקה', authors: ['שם פרטי משפחה כפולה'], authorParts: [{ givenName: 'שם פרטי', familyName: 'משפחה כפולה' }], publicationDate: '2024-02-29', binding: 'כריכה קשה', personalNotes: 'מידע ישן נשמר' });
    const author = await db.authors.get(book.authorIds[0]);
    expect(author).toMatchObject({ givenName: 'שם פרטי', familyName: 'משפחה כפולה', displayName: 'שם פרטי משפחה כפולה' });
    const snapshot = await createFullSnapshot(db);
    expect(JSON.parse(snapshot.text).formatVersion).toBe(11);
    const backup = await validateBackup(snapshot.text);
    const workbook = await fullWorkbookCandidate(db, { full: true, workbook: fullWorkbook(backup.data), fingerprint: 'synthetic', sheet: 'Books', headers: [] });
    expect(workbook.backup.data.books).toEqual(backup.data.books);
    expect(workbook.backup.data.authors).toEqual(backup.data.authors);
    await restoreSnapshot(db, backup, snapshot.fingerprint);
    expect(await db.books.get(book.id)).toMatchObject({ publicationDate: '2024-02-29', publicationYear: 2024, binding: 'כריכה קשה', personalNotes: 'מידע ישן נשמר' });
    const updated = await saveBook(db, { ...emptyInput, title: 'עדכון ממסך ישן', publicationYear: '2024', authors: ['שם פרטי משפחה כפולה'] }, (await db.books.get(book.id))!);
    expect(updated).toMatchObject({ publicationDate: '2024-02-29', binding: 'כריכה קשה' });
    expect(await db.authors.get(book.authorIds[0])).toEqual(author);
  } finally { await db.delete(); }
});

it('inconsistent split names fail before changing a saved book', async () => {
  const db = new LibraryDatabase('author-details-' + crypto.randomUUID());
  try {
    await initializeLibrary(db);
    await expect(saveBook(db, { ...emptyInput, authors: ['שם אחר'], authorParts: [{ givenName: 'מחבר', familyName: 'בדיקה' }] })).rejects.toThrow();
    expect(await db.books.count()).toBe(0);
    expect(await db.authors.count()).toBe(0);
  } finally { await db.delete(); }
});
