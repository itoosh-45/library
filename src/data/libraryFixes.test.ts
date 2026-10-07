import { afterEach, expect, it, vi } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import { emptyInput, saveBook } from './books';
import { saveNamedItem, saveShelf } from './collections';
import { resetLibraryBooks } from './reset';
import { booksFromOcr, type OcrLine } from './ocrLayout';

afterEach(() => vi.restoreAllMocks());
const line = (text: string, y: number, h: number): OcrLine => ({ text, confidence: 95, bbox: { x0: 100, y0: y, x1: 800, y1: y + h } });
it('single Hebrew cover joins distant title and author while shelf mode keeps separate books', () => {
  const lines = [line('ספר לדוגמה', 100, 80), line('מאת מחבר בדיקה', 800, 35)];
  const result = booksFromOcr(lines, 1000, 1000, 'single');
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ title: 'ספר לדוגמה', authors: ['מחבר בדיקה'] });
  expect(booksFromOcr(lines, 1000, 1000, 'shelf').items[0].authors).toEqual([]);
  expect(booksFromOcr([line('ENGLISH BOOK', 100, 80)], 1000, 1000, 'single').items).toEqual([]);
});
it('single cover retains valid literal evidence for a two-line Hebrew title', () => {
  const result = booksFromOcr([line('מסע אל', 100, 80), line('הספרייה', 190, 78), line('מאת מחבר בדיקה', 800, 35)], 1000, 1000, 'single');
  expect(result.items[0]).toMatchObject({ title: 'מסע אל הספרייה', authors: ['מחבר בדיקה'] });
});
it('reset removes book relations and photos atomically while retaining settings and collections', async () => {
  const db = new LibraryDatabase('reset-' + crypto.randomUUID());
  try {
    const libraryId = await initializeLibrary(db);
    const shelf = await saveShelf(db, { name: 'מדף בדיקה', parentId: null });
    const series = await saveNamedItem(db, 'series', 'סדרה שמורה');
    const book = await saveBook(db, { ...emptyInput, title: 'ספר בדיקה', authors: ['מחבר'], seriesId: series.id, seriesNumber: '2', shelfIds: [shelf.id] });
    const copy = (await db.copies.toArray())[0];
    await db.images.put({ id: 'photo', blob: new Blob(['synthetic']), mimeType: 'image/png', width: 1, height: 1, byteLength: 9, sha256: 'a'.repeat(64), sourceUrl: null, createdAt: new Date().toISOString() });
    await db.books.update(book.id, { primaryImageId: 'photo' }); await db.shelves.update(shelf.id, { imageId: 'photo' });
    await db.people.put({ id: 'person', name: 'אדם', normalizedName: 'אדם', archivedAt: null });
    await db.loans.put({ id: 'loan', copyId: copy.id, personId: 'person', borrowedAt: new Date().toISOString(), expectedReturnOn: null, returnedAt: null, openFlag: 1, notes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await resetLibraryBooks(db);
    for (const table of [db.books, db.copies, db.authors, db.images, db.bookShelves, db.loans, db.metadataSources, db.metadataCache, db.recognitionDrafts]) expect(await table.count()).toBe(0);
    expect((await db.settings.get('libraryId'))?.value).toBe(libraryId);
    expect(await db.series.get(series.id)).toEqual(series);
    expect((await db.shelves.get(shelf.id))?.imageId).toBeNull();
    expect(await db.people.count()).toBe(1);
    await saveBook(db, { ...emptyInput, title: 'התחלה חדשה' }); expect(await db.books.count()).toBe(1);
  } finally { await db.delete(); }
});
it('failed reset rolls back books and copies already cleared by its transaction', async () => {
  const db = new LibraryDatabase('reset-failure-' + crypto.randomUUID());
  try {
    await initializeLibrary(db); await saveBook(db, { ...emptyInput, title: 'נשאר' });
    vi.spyOn(db.images, 'clear').mockRejectedValue(new Error('synthetic disk failure'));
    await expect(resetLibraryBooks(db)).rejects.toThrow('synthetic disk failure');
    expect(await db.books.count()).toBe(1); expect(await db.copies.count()).toBe(1);
  } finally { await db.delete(); }
});
