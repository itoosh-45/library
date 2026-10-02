import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import { createBookWithCopy, renameLibrary } from './library';

let database: LibraryDatabase;
beforeEach(() => { database = new LibraryDatabase('test-library-' + crypto.randomUUID()); });
afterEach(async () => { await database.delete(); });
describe('local library persistence and transaction safety', () => {
  it('creates 15 stores and one stable identity across repeated and concurrent initialization', async () => {
    const ids = await Promise.all([initializeLibrary(database), initializeLibrary(database)]);
    expect(ids[0]).toBe(ids[1]);
    expect(database.tables).toHaveLength(15);
    expect(await database.settings.count()).toBe(3);
    database.close();
    expect(await initializeLibrary(database)).toBe(ids[0]);
  });
  it('stores a book without optional details and its first copy, then reloads both', async () => {
    await initializeLibrary(database);
    const { book, copy } = await createBookWithCopy(database, {});
    expect(book.title).toBeNull(); expect(book.authorIds).toEqual([]);
    expect(copy.bookId).toBe(book.id);
    database.close(); await database.open();
    expect(await database.books.get(book.id)).toEqual(book);
    expect(await database.copies.get(copy.id)).toEqual(copy);
  });
  it('rejects missing authors without saving a book or copy', async () => {
    await initializeLibrary(database);
    await expect(createBookWithCopy(database, { title: 'ספר לדוגמה', authorIds: ['missing'] })).rejects.toThrow('אינו קיים');
    expect(await database.books.count()).toBe(0); expect(await database.copies.count()).toBe(0);
  });
  it('rolls back an earlier book insert when the copy write fails', async () => {
    await initializeLibrary(database);
    const fail = () => { throw new Error('simulated copy storage failure'); };
    database.copies.hook('creating', fail);
    await expect(createBookWithCopy(database, { title: 'בדיקת עסקה' })).rejects.toThrow('simulated copy');
    database.copies.hook('creating').unsubscribe(fail);
    expect(await database.books.count()).toBe(0); expect(await database.copies.count()).toBe(0);
  });
  it('accepts several existing authors, removes repeated ids and avoids splitting names', async () => {
    await database.authors.bulkAdd(['דנה כהן', 'שם עט'].map((displayName, i) => ({ id: String(i), displayName, normalizedName: displayName, givenName: null, familyName: null })));
    const { book } = await createBookWithCopy(database, { title: 'כותרת', authorIds: ['0', '1', '0'] });
    expect(book.authorIds).toEqual(['0', '1']);
  });
  it('persists library name while refusing an empty or excessive name', async () => {
    await initializeLibrary(database); await renameLibrary(database, ' ספריית הבית ');
    await expect(renameLibrary(database, ' ')).rejects.toThrow();
    await expect(renameLibrary(database, 'א'.repeat(121))).rejects.toThrow();
    database.close(); await database.open();
    expect((await database.settings.get('libraryName'))?.value).toBe('ספריית הבית');
  });
  it('keeps settings limited and does not copy forbidden or unknown input fields', async () => {
    await initializeLibrary(database);
    const input = { title: 'דוגמה', description: 'must not persist', rating: 5, apiKey: 'fake-test-value' };
    const { book } = await createBookWithCopy(database, input);
    for (const field of ['description', 'rating', 'apiKey']) expect(book).not.toHaveProperty(field);
    expect(await database.settings.toArray()).toEqual(expect.arrayContaining([{ key: 'displayMode', value: 'compact' }]));
  });
  it('rejects invalid runtime input before writes', async () => {
    await initializeLibrary(database);
    await expect(createBookWithCopy(database, { title: 8 } as never)).rejects.toThrow();
    await expect(createBookWithCopy(database, { authorIds: [null] } as never)).rejects.toThrow();
    await expect(createBookWithCopy(database, { readStatus: 'invalid' } as never)).rejects.toThrow();
    expect(await database.books.count()).toBe(0);
  });
});
