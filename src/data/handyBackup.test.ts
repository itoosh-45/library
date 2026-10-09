import { afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { LibraryDatabase, initializeLibrary } from './database';
import { canonical, createSnapshot, readCore, restoreSnapshot, validateBackup } from './backup';
import { createFullSnapshot } from './fullBackup';
import { createHandyBackup, handySql, importHandyBackup, inspectHandyBackup, readHandyCsv, writeHandyCsv } from './handyBackup';
import schema from './handySchema.json';
import { emptyInput, saveBook } from './books';
import { saveShelf, deleteShelf } from './collections';
import { lendCopy } from './loans';

vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: new URL('../../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url).pathname }));
const databases: LibraryDatabase[] = [];
afterEach(async () => { for (const database of databases.splice(0)) await database.delete(); });
async function library() { const db = new LibraryDatabase('handy-' + crypto.randomUUID()); databases.push(db); await initializeLibrary(db); return db; }
async function sourceArchive(options: { copies?: boolean; badISBN?: boolean; extraFile?: boolean } = {}) {
  const SQL = await handySql(), sqlite = new SQL.Database();
  for (const statement of Object.values(schema.tables)) sqlite.run(statement);
  sqlite.run(`PRAGMA user_version=${schema.userVersion}`);
  sqlite.run('INSERT INTO room_master_table VALUES(42,?)', [schema.identityHash]);
  sqlite.run("INSERT INTO android_metadata VALUES('he_IL')");
  const csvRows = [];
  for (let index = 1; index <= (options.copies ? 2 : 1); index++) {
    const row = { _id: index, Title: 'ספר סינתטי, "בדיקה"\nשורה', Author: 'שם, מחבר', ISBN: options.badISBN ? '123-invalid' : '9780140328721', Copy: index - 1, Rating: '4.27', Summary: 'תקציר מקור', Currency: 'ILS', Location: 'מדף סינתטי', Original_Title: 'Original synthetic title', Icon_Path: '/Pictures/Icons/כריכה.jpg', Photo_Path: '/Pictures/Photos/כריכה.jpg', Price: 35.5, Read: 1, Favorite: 1, Person: 'שואל סינתטי', Lend_or_Borrow: 1, Start_Date: '2026-01-03', Due_Date: '2026-02-03' };
    const columns = Object.keys(row);
    sqlite.run(`INSERT INTO book_library (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, Object.values(row));
    const csv = Object.fromEntries(schema.csvHeaders.map(key => [key, '']));
    Object.assign(csv, { Title: row.Title, Author: row.Author, ISBN: row.ISBN, Rating: row.Rating, Summary: row.Summary, BookShelf: row.Location, Price: '35.5', Read: 'Yes', 'Copy Index': index > 1 ? String(index - 1) : '', 'Icon Path': row.Icon_Path, 'Photo Path': row.Photo_Path, 'Added Date': '01/02/2026', 'Published Date': '2020-03-02', Settings: index === 1 ? '3.0.5;283;MM/DD/YYYY;YYYY-MM-DD;09/13/2026' : '' });
    csvRows.push(csv);
  }
  const jpeg = new Uint8Array([255,216,255,192,0,17,8,0,2,0,3,3,1,17,0,2,17,0,3,17,0,255,217]);
  const files = { 'handy_book_library.db': sqlite.export(), 'HandyLib.csv': strToU8(writeHandyCsv(csvRows)), 'Icons/כריכה.jpg': jpeg, 'Photos/כריכה.jpg': jpeg, ...(options.extraFile ? { 'extra.json': strToU8('{}') } : {}) };
  sqlite.close(); return new Uint8Array(zipSync(files));
}

it('CSV handles Hebrew, quoted commas/newlines, escaped quotes and short Settings rows without new columns', () => {
  const row = Object.fromEntries(schema.csvHeaders.map(key => [key, ''])); row.Title = 'עברית, "שם"\nשורה';
  expect(readHandyCsv(writeHandyCsv([row]))).toEqual([row]);
  expect(() => readHandyCsv('Title,Extra\nhello,world')).toThrow();
  expect(() => readHandyCsv(writeHandyCsv([row]) + '"unfinished')).toThrow();
});

it('Handy ZIP round trip preserves copies, raw unsupported fields, decimal ratings, both pictures and only the original schema', async () => {
  const db = await library(), incoming = await inspectHandyBackup(await sourceArchive({ copies: true }));
  expect(incoming.backup.counts).toMatchObject({ books: 2, copies: 2, images: 2, shelves: 1, loans: 2 });
  await importHandyBackup(db, incoming, 'merge', (await createSnapshot(db)).fingerprint);
  const snapshot = await createFullSnapshot(db); expect(JSON.parse(snapshot.text).formatVersion).toBe(13);
  const restored = await library(); await restoreSnapshot(restored, await validateBackup(snapshot.text), (await createSnapshot(restored)).fingerprint);
  const zip = new Uint8Array(await (await createHandyBackup(restored)).arrayBuffer());
  const files = unzipSync(zip); expect(Object.keys(files).filter(name => !/^(Icons|Photos)\//.test(name)).sort()).toEqual(['HandyLib.csv', 'handy_book_library.db']);
  const SQL = await handySql(), sql = new SQL.Database(files['handy_book_library.db']);
  try {
    expect(sql.exec('PRAGMA user_version')[0].values[0][0]).toBe(schema.userVersion);
    expect(sql.exec('SELECT identity_hash FROM room_master_table')[0].values[0][0]).toBe(schema.identityHash);
    expect(sql.exec('PRAGMA table_info(book_library)')[0].values.map(row => row[1])).toEqual(schema.bookColumns);
    expect(sql.exec('SELECT Rating,Summary,Original_Title,Favorite FROM book_library')[0].values).toEqual([['4.27', 'תקציר מקור', 'Original synthetic title', 1], ['4.27', 'תקציר מקור', 'Original synthetic title', 1]]);
  } finally { sql.close(); }
  const result = await inspectHandyBackup(zip); expect(result.backup.counts).toMatchObject(incoming.backup.counts);
  expect(result.backup.data.books[0]).toMatchObject({ title: incoming.backup.data.books[0].title, readStatus: 'read', publicationDate: '2020-03-02' });
  expect(result.backup.data.copies[0].purchasePriceMinor).toBe(3550);
  expect(result.backup.data.loans[0].expectedReturnOn).toBe('2026-02-03');
});

it('adding skips existing duplicates and a second import changes no data; replacement clears existing books atomically', async () => {
  const db = await library(); await saveBook(db, { ...emptyInput, title: 'נשאר' });
  const incoming = await inspectHandyBackup(await sourceArchive());
  const before = await createSnapshot(db);
  expect(await importHandyBackup(db, incoming, 'merge', before.fingerprint)).toEqual({ added: 1, skipped: 0 });
  const merged = await createSnapshot(db);
  expect(await importHandyBackup(db, await inspectHandyBackup(await sourceArchive()), 'merge', merged.fingerprint)).toEqual({ added: 0, skipped: 1 });
  expect((await createSnapshot(db)).fingerprint).toBe(merged.fingerprint);
  await importHandyBackup(db, incoming, 'replace', merged.fingerprint);
  expect(await db.books.count()).toBe(1); expect(await db.books.filter(book => book.title === 'נשאר').count()).toBe(0);
});

it('ISBN-10/13 duplicates are comparable, title with different authors is kept and invalid ISBN survives export', async () => {
  const db = await library(); await saveBook(db, { ...emptyInput, title: 'שם שונה', isbn: '0140328726' });
  const incoming = await inspectHandyBackup(await sourceArchive());
  expect(await importHandyBackup(db, incoming, 'merge', (await createSnapshot(db)).fingerprint)).toEqual({ added: 0, skipped: 1 });
  const invalid = await inspectHandyBackup(await sourceArchive({ badISBN: true }));
  expect(invalid.warnings).toHaveLength(1);
  await importHandyBackup(db, invalid, 'merge', (await createSnapshot(db)).fingerprint);
  const result = await inspectHandyBackup(new Uint8Array(await (await createHandyBackup(db)).arrayBuffer()));
  expect(result.backup.data.copies.some(copy => copy.handyLibrary?.csv.ISBN === '123-invalid')).toBe(true);
});

it('corrupt archives, extra ZIP entries, changed targets and quota failures cannot alter any existing table', async () => {
  const db = await library(); await saveBook(db, { ...emptyInput, title: 'קיים' });
  const incoming = await inspectHandyBackup(await sourceArchive()), old = await createSnapshot(db);
  await expect(inspectHandyBackup(await sourceArchive({ extraFile: true }))).rejects.toThrow();
  const damaged = await sourceArchive(); damaged[100] ^= 255; await expect(inspectHandyBackup(damaged)).rejects.toThrow();
  await saveBook(db, { ...emptyInput, title: 'חדש בחלון אחר' }); const before = await createSnapshot(db);
  await expect(importHandyBackup(db, incoming, 'replace', old.fingerprint)).rejects.toThrow('השתנתה');
  const abort = () => { throw new DOMException('synthetic quota', 'QuotaExceededError'); }; db.copies.hook('creating', abort);
  try { await expect(importHandyBackup(db, incoming, 'replace', before.fingerprint)).rejects.toThrow(); } finally { db.copies.hook('creating').unsubscribe(abort); }
  expect((await createSnapshot(db)).fingerprint).toBe(before.fingerprint);
});

it('native books export shelves, personal rating, price, loans and local covers without native-only fields', async () => {
  const db = await library(), shelf = await saveShelf(db, { name: 'מדף חדש', parentId: null });
  await saveBook(db, { ...emptyInput, title: 'ספר חדש', authors: ['מחבר חדש'], price: '12.50', rating: 5, shelfIds: [shelf.id], publicationDate: '2024-01-01', publicationYear: '2024' });
  const copy = (await db.copies.toArray())[0]; await lendCopy(db, { copyId: copy.id, newPersonName: 'שואל', borrowedOn: '2026-01-01', expectedReturnOn: '2026-01-30' });
  const zip = new Uint8Array(await (await createHandyBackup(db)).arrayBuffer()), result = await inspectHandyBackup(zip);
  expect(result.backup.data.books[0]).toMatchObject({ title: 'ספר חדש', rating: 5, publicationDate: '2024-01-01' });
  expect(result.backup.data.shelves[0].name).toBe('מדף חדש'); expect(result.backup.data.copies[0].purchasePriceMinor).toBe(1250); expect(result.backup.data.loans).toHaveLength(1);
  expect(result.backup.data.copies[0].handyLibrary?.row).not.toHaveProperty('metadataSources');
});

it('empty library ZIP is importable', async () => {
  const db = await library(); expect((await inspectHandyBackup(new Uint8Array(await (await createHandyBackup(db)).arrayBuffer()))).sourceRows).toBe(0);
});

// Personal fixture remains outside Git; enable only for local evidence.
it.skipIf(!process.env.HANDY_FIXTURE_PATH)('the supplied private 1886-book archive imports and exports with pictures and source fields', async () => {
  const bytes = new Uint8Array(await readFile(process.env.HANDY_FIXTURE_PATH!)), db = await library();
  const incoming = await inspectHandyBackup(bytes); expect(incoming.sourceRows).toBe(1886);
  await importHandyBackup(db, incoming, 'merge', (await createSnapshot(db)).fingerprint);
  const before = canonical(await readCore(db));
  const exported = await createHandyBackup(db), roundtrip = await inspectHandyBackup(new Uint8Array(await exported.arrayBuffer()));
  expect(roundtrip.sourceRows).toBe(1886); expect(roundtrip.backup.counts.images).toBe(incoming.backup.counts.images);
  expect(roundtrip.backup.data.books.map(book => book.title).sort()).toEqual(incoming.backup.data.books.map(book => book.title).sort());
  expect(canonical(await readCore(db))).toBe(before);
  console.info(JSON.stringify({ sourceBooks: incoming.sourceRows, sourceImages: incoming.backup.counts.images, shelves: incoming.backup.counts.shelves, exportedBytes: exported.size, warnings: incoming.warnings }));
}, 60000);

it('changing a shelf cover keeps source pictures referenced by Handy copies', async () => {
  const db = await library(), incoming = await inspectHandyBackup(await sourceArchive());
  await importHandyBackup(db, incoming, 'merge', (await createSnapshot(db)).fingerprint);
  const image = (await db.images.toArray())[0], sourceShelf = (await db.shelves.toArray())[0];
  const withCover = await saveShelf(db, { name: sourceShelf.name, parentId: null }, sourceShelf, image);
  const withoutCover = await saveShelf(db, { name: sourceShelf.name, parentId: null }, withCover, null);
  expect(await db.images.get(image.id)).toBeDefined();
  await deleteShelf(db, withoutCover);
  await expect(validateBackup((await createFullSnapshot(db)).text)).resolves.toBeDefined();
});
