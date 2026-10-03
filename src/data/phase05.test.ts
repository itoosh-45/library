import { afterEach, beforeEach, expect, it } from 'vitest';
import Dexie from 'dexie';
import { LibraryDatabase, initializeLibrary } from './database';
import { emptyInput, saveBook } from './books';
import { createSnapshot, deleteBook, restoreSnapshot, validateBackup } from './backup';
import { bookGroups, deleteNamedItem, deleteShelf, descendantIds, saveNamedItem, saveShelf, setSeriesCollapsed, shelfBookIds, shelfRows } from './collections';
import { hashBytes } from './images';
import type { Series, Shelf } from './models';

let database: LibraryDatabase;
beforeEach(async () => { database = new LibraryDatabase('phase05-' + crypto.randomUUID()); await initializeLibrary(database); });
afterEach(async () => { await database.delete(); });
async function fixture() {
  const root = await saveShelf(database, { name: 'ראשי', parentId: null });
  const child = await saveShelf(database, { name: 'ילד', parentId: root.id });
  const leaf = await saveShelf(database, { name: 'עלה', parentId: child.id });
  const tag = await saveNamedItem(database, 'tags', 'ניסוי'), genre = await saveNamedItem(database, 'genres', 'עיון');
  const series = await saveNamedItem(database, 'series', 'סדרה סינתטית') as Series;
  const book = await saveBook(database, { ...emptyInput, title: 'ספר סינתטי', shelfIds: [root.id, child.id, leaf.id], genreIds: [genre.id], tagIds: [tag.id], seriesId: series.id, seriesNumber: '2' });
  return { root, child, leaf, tag, genre, series, book };
}
async function editedSnapshot(edit: (value: ReturnType<typeof JSON.parse>) => void) {
  const snapshot = JSON.parse((await createSnapshot(database)).text); edit(snapshot);
  snapshot.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(snapshot.data)).buffer);
  return JSON.stringify(snapshot);
}
it('T11 rejects self/descendant cycles and missing parents, moves safely and detects stale shelf edits', async () => {
  const { root, child, leaf } = await fixture();
  const before = await createSnapshot(database);
  await expect(saveShelf(database, { name: root.name, parentId: root.id }, root)).rejects.toThrow('צאצא');
  await expect(saveShelf(database, { name: root.name, parentId: leaf.id }, root)).rejects.toThrow('צאצא');
  await expect(saveShelf(database, { name: 'אבוד', parentId: crypto.randomUUID() })).rejects.toThrow('אינו קיים');
  expect((await createSnapshot(database)).fingerprint).toBe(before.fingerprint);
  await saveShelf(database, { name: child.name, parentId: null }, child);
  await expect(saveShelf(database, { name: 'ישן', parentId: root.id }, child)).rejects.toThrow('השתנה');
  expect(descendantIds(await database.shelves.toArray(), root.id).size).toBe(1);
});
it('T11 serializes competing moves so two windows cannot create a cycle', async () => {
  const first = await saveShelf(database, { name: 'ראשון', parentId: null }), second = await saveShelf(database, { name: 'שני', parentId: null });
  const other = new LibraryDatabase(database.name); await other.open();
  try {
    const results = await Promise.allSettled([saveShelf(database, { name: first.name, parentId: second.id }, first), saveShelf(other, { name: second.name, parentId: first.id }, second)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(shelfRows(await database.shelves.toArray())).toHaveLength(2);
  } finally { other.close(); }
});
it('T11 counts a book in three shelves once with descendants; deletion promotes children and preserves book/copy', async () => {
  const { root, child, leaf, book } = await fixture();
  const shelves = await database.shelves.toArray(), links = await database.bookShelves.toArray();
  expect(links).toHaveLength(3);
  expect(shelfBookIds(shelves, links, root.id, true)).toEqual(new Set([book.id]));
  expect(shelfBookIds(shelves, links, root.id, false)).toEqual(new Set([book.id]));
  expect(shelfBookIds(shelves, links, root.id, true, new Set())).toEqual(new Set());
  await deleteShelf(database, child);
  expect((await database.shelves.get(leaf.id))?.parentId).toBe(root.id);
  expect(await database.bookShelves.count()).toBe(2);
  expect(await database.books.count()).toBe(1); expect(await database.copies.count()).toBe(1);
  await expect(saveBook(database, emptyInput, book)).rejects.toThrow('השתנה');
  await deleteShelf(database, root); expect((await database.shelves.get(leaf.id))?.parentId).toBeNull();
});
it('T11 progressively handles depth 1/10/100, deepest move, counts and backup without recursion', async () => {
  let last: Shelf | undefined;
  const shelves: Shelf[] = [];
  for (let i = 0; i < 100; i++) {
    last = await saveShelf(database, { name: `רמה ${i + 1}`, parentId: last?.id ?? null }); shelves.push(last);
    if ([0, 9, 99].includes(i)) { expect(shelfRows(shelves)).toHaveLength(i + 1); expect(descendantIds(shelves, shelves[0].id).size).toBe(i + 1); }
  }
  await saveBook(database, { ...emptyInput, shelfIds: [last!.id] });
  expect(shelfRows(shelves).at(-1)?.depth).toBe(99);
  expect(shelfBookIds(shelves, await database.bookShelves.toArray(), shelves[0].id, true).size).toBe(1);
  await expect(saveShelf(database, { name: shelves[0].name, parentId: last!.id }, shelves[0])).rejects.toThrow('צאצא');
  expect((await validateBackup((await createSnapshot(database)).text)).counts.shelves).toBe(100);
});
it('failed shelf deletion rolls back promoted children, removed memberships and revised books', async () => {
  const { child } = await fixture(), before = await createSnapshot(database);
  const fail = () => { throw new Error('shelf-delete-failed'); }; database.shelves.hook('deleting', fail);
  await expect(deleteShelf(database, child)).rejects.toThrow('shelf-delete');
  database.shelves.hook('deleting').unsubscribe(fail);
  expect((await createSnapshot(database)).fingerprint).toBe(before.fingerprint);
});
it('T12 groups by first title representative, orders 1/2/10 then missing with stable ties and preserves folding', async () => {
  const series = await saveNamedItem(database, 'series', 'סדרה') as Series;
  const books = [];
  for (const [title, seriesNumber] of [['ג', '10'], ['ב', '2'], ['ד', '1'], ['א', ''], ['ה', '2']]) books.push(await saveBook(database, { ...emptyInput, title, seriesId: series.id, seriesNumber }));
  const standalone = await saveBook(database, { ...emptyInput, title: 'ת' }); books.push(standalone);
  const groups = bookGroups(books, [series]);
  expect(groups[0].series?.id).toBe(series.id);
  expect(groups[0].books.map(book => book.seriesNumber)).toEqual([1, 2, 2, 10, null]);
  expect(groups[0].books.filter(book => book.seriesNumber === 2).map(book => book.title)).toEqual(['ב', 'ה']);
  expect(groups[1].books).toEqual([standalone]);
  await setSeriesCollapsed(database, series.id, true); database.close(); await database.open();
  expect((await database.series.get(series.id))?.collapsed).toBe(true);
  await expect(saveBook(database, { ...emptyInput, seriesNumber: '1' })).rejects.toThrow('בחר סדרה');
  for (const value of ['-1', 'abc', 'Infinity', '1000001']) await expect(saveBook(database, { ...emptyInput, seriesId: series.id, seriesNumber: value })).rejects.toThrow();
  expect((await saveBook(database, { ...emptyInput, seriesId: series.id, seriesNumber: '0.5' })).seriesNumber).toBe(0.5);
});
it('multiple genres/tags, normalized duplicate prevention, renaming and deleting collections preserve books', async () => {
  const { tag, genre, series, book } = await fixture();
  await expect(saveNamedItem(database, 'genres', ' עיון ')).rejects.toThrow('כבר קיים');
  const extra = await saveNamedItem(database, 'tags', 'נוסף');
  const updated = await saveBook(database, { ...emptyInput, tagIds: [tag.id, extra.id] }, book);
  expect(updated.genreIds).toEqual([genre.id]); expect(await database.bookShelves.count()).toBe(3);
  const renamed = await saveNamedItem(database, 'tags', 'שם חדש', tag);
  await expect(deleteNamedItem(database, 'tags', tag)).rejects.toThrow('השתנה');
  await deleteNamedItem(database, 'tags', renamed); await deleteNamedItem(database, 'series', series);
  const current = (await database.books.get(book.id))!;
  await expect(deleteNamedItem(database, 'genres', genre)).rejects.toThrow('משויך');
  expect((await database.books.get(book.id))?.genreIds).toEqual([genre.id]);
  await saveBook(database, { ...emptyInput, genreIds: [] }, current);
  await deleteNamedItem(database, 'genres', genre);
  expect(await database.books.get(book.id)).toMatchObject({ seriesId: null, seriesNumber: null, genreIds: [], tagIds: [extra.id], revision: 5 });
  expect(await database.copies.count()).toBe(1);
  await expect(saveBook(database, emptyInput, updated)).rejects.toThrow('השתנה');
});
it('classification invalid ids/duplicates fail and a link-write failure rolls back book/copy/authors and memberships', async () => {
  const shelf = await saveShelf(database, { name: 'בדיקה', parentId: null });
  for (const value of [{ shelfIds: [crypto.randomUUID()] }, { shelfIds: [shelf.id, shelf.id] }, { tagIds: [null] }, { genreIds: [crypto.randomUUID()] }, { seriesId: crypto.randomUUID() }]) await expect(saveBook(database, { ...emptyInput, ...value } as never)).rejects.toThrow();
  const fail = () => { throw new Error('link-write-failed'); }; database.bookShelves.hook('creating', fail);
  await expect(saveBook(database, { ...emptyInput, authors: ['סינתטי'], shelfIds: [shelf.id] })).rejects.toThrow('link-write');
  database.bookShelves.hook('creating').unsubscribe(fail);
  expect(await database.books.count()).toBe(0); expect(await database.copies.count()).toBe(0); expect(await database.authors.count()).toBe(0); expect(await database.bookShelves.count()).toBe(0);
});
it('v2 backup round trip preserves all stage 5 data, counts and collapsed state; deleting book cleans links', async () => {
  const { book, series } = await fixture(); await setSeriesCollapsed(database, series.id, true);
  const snapshot = await createSnapshot(database), incoming = await validateBackup(snapshot.text);
  expect(incoming.counts).toMatchObject({ books: 1, shelves: 3, bookShelves: 3, genres: 1, tags: 1, series: 1 });
  await deleteBook(database, book.id, snapshot.fingerprint); expect(await database.bookShelves.count()).toBe(0);
  await restoreSnapshot(database, incoming, (await createSnapshot(database)).fingerprint);
  expect((await createSnapshot(database)).fingerprint).toBe(snapshot.fingerprint);
});
it('legacy phase 4 v1 backup restores and clears stage 5 collections atomically', async () => {
  await saveBook(database, { ...emptyInput, title: 'גיבוי ישן' });
  const old = await editedSnapshot(value => {
    value.version = 1; value.schemaVersion = 1; value.appVersion = '0.2.0';
    for (const key of ['shelves', 'bookShelves', 'series', 'genres', 'tags', 'people', 'loans', 'metadataSources', 'recognitionDrafts']) { delete value.data[key]; delete value.counts[key]; }
  });
  const incoming = await validateBackup(old); expect(incoming.counts.shelves).toBe(0);
  await fixture(); await restoreSnapshot(database, incoming, (await createSnapshot(database)).fingerprint);
  expect(await database.books.count()).toBe(1); expect(await database.shelves.count()).toBe(0); expect(await database.series.count()).toBe(0);
  expect((await database.books.toArray())[0].title).toBe('גיבוי ישן');
});
it('v2 rejects cycles, dangling relationships, duplicate memberships, bad numbers, names, images and foreign fields', async () => {
  await fixture(); const before = await createSnapshot(database);
  const edits = [
    (b: ReturnType<typeof JSON.parse>) => { b.data.shelves[0].parentId = b.data.shelves[0].id; },
    (b: ReturnType<typeof JSON.parse>) => { const root = b.data.shelves.find((s: Shelf) => !s.parentId); const leaf = b.data.shelves.find((s: Shelf) => s.name === 'עלה'); root.parentId = leaf.id; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.shelves[0].parentId = crypto.randomUUID(); },
    (b: ReturnType<typeof JSON.parse>) => { b.data.shelves[0].imageId = crypto.randomUUID(); },
    (b: ReturnType<typeof JSON.parse>) => { b.data.bookShelves[0].bookId = crypto.randomUUID(); },
    (b: ReturnType<typeof JSON.parse>) => { b.data.bookShelves[1].shelfId = b.data.bookShelves[0].shelfId; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.books[0].tagIds = [crypto.randomUUID()]; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.books[0].seriesNumber = -1; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.series[0].collapsed = 'true'; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.genres[0].normalizedName = 'שגוי'; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.tags[0].apiKey = 'synthetic-forbidden'; },
    (b: ReturnType<typeof JSON.parse>) => { b.counts.bookShelves = 0; },
  ];
  for (const edit of edits) await expect(validateBackup(await editedSnapshot(edit))).rejects.toThrow();
  expect((await createSnapshot(database)).fingerprint).toBe(before.fingerprint);
});
it('stage 5 restore failures roll back all tables and shelf/folding changes invalidate protective snapshots', async () => {
  const { root, series } = await fixture();
  const before = await createSnapshot(database), incoming = await validateBackup(before.text);
  await saveShelf(database, { name: 'שינוי', parentId: null }, root);
  await expect(restoreSnapshot(database, incoming, before.fingerprint)).rejects.toThrow('השתנתה');
  const safety = await createSnapshot(database);
  const fail = () => { throw new Error('stage5-restore-failed'); }; database.tags.hook('creating', fail);
  await expect(restoreSnapshot(database, incoming, safety.fingerprint)).rejects.toThrow('stage5-restore');
  database.tags.hook('creating').unsubscribe(fail);
  expect((await createSnapshot(database)).fingerprint).toBe(safety.fingerprint);
  await setSeriesCollapsed(database, series.id, true);
  await expect(restoreSnapshot(database, incoming, safety.fingerprint)).rejects.toThrow('השתנתה');
});
it('schema migration preserves phase 4 books/copies/settings and fills series collapsed state', async () => {
  const book = await saveBook(database, emptyInput), snapshot = await createSnapshot(database);
  const name = 'migration-' + crypto.randomUUID(), legacy = new Dexie(name);
  legacy.version(1).stores(Object.fromEntries(database.tables.map(table => [table.name, table.schema.primKey.src + (table.schema.indexes.length ? ',' + table.schema.indexes.map(index => index.src).join(',') : '')])));
  await legacy.open();
  await legacy.table('books').add(book); await legacy.table('copies').bulkAdd(await database.copies.toArray()); await legacy.table('settings').bulkAdd(await database.settings.toArray());
  await legacy.table('series').add({ id: crypto.randomUUID(), name: 'ישן', normalizedName: 'ישן' }); legacy.close();
  const migrated = new LibraryDatabase(name);
  try { await migrated.open(); expect(migrated.verno).toBe(2); expect(await migrated.books.get(book.id)).toEqual(book); expect((await migrated.series.toArray())[0].collapsed).toBe(false); expect((await createSnapshot(migrated)).counts.books).toBe(snapshot.counts.books); }
  finally { await migrated.delete(); }
});
