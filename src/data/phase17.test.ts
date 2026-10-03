import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { LibraryDatabase, initializeLibrary, completeSeriesMigration } from './database';
import { watchDatabaseConnection } from './databaseLifecycle';
import { emptyInput, saveBook } from './books';
import { readCore, createSnapshot, restoreSnapshot, validateBackup } from './backup';
import { createFullSnapshot } from './fullBackup';
import { saveNamedItem } from './collections';
import { lendCopy, localDay } from './loans';
import { createDraft, appendDraftImage } from './shelfDraft';
import { hashBytes } from './images';

const connections: Dexie[] = [];
const names = new Set<string>();
function track<T extends Dexie>(db: T): T { connections.push(db); names.add(db.name); return db; }
afterEach(async () => { for (const db of connections.splice(0)) db.close(); for (const name of names) await Dexie.delete(name); names.clear(); });
const schema = () => Object.fromEntries(new LibraryDatabase('schema-only').tables.map(table => [table.name, [table.schema.primKey.src, ...table.schema.indexes.map(index => index.src)].join(',')]));
async function richSource() {
  const db = track(new LibraryDatabase('stage17-source-' + crypto.randomUUID()));
  await initializeLibrary(db);
  const series = await saveNamedItem(db, 'series', 'סדרה סינתטית');
  await db.series.update(series.id, { collapsed: true });
  const book = await saveBook(db, { ...emptyInput, title: 'תרגיל שדרוג', authors: ['מחבר'], seriesId: series.id });
  await lendCopy(db, { copyId: (await db.copies.toArray())[0].id, newPersonName: 'שואל סינתטי', borrowedOn: localDay(), expectedReturnOn: '' });
  const blob = new Blob([new Uint8Array([255,216,255,192,0,17,8,0,2,0,3,3,1,17,0,2,17,0,3,17,0,255,217])], { type: 'image/jpeg' });
  const image = { id: crypto.randomUUID(), blob, mimeType: 'image/jpeg', width: 3, height: 2, byteLength: blob.size, sha256: await hashBytes(await blob.arrayBuffer()), sourceUrl: null, createdAt: new Date().toISOString() };
  await db.images.add(image); await db.books.update(book.id, { primaryImageId: image.id });
  const draft = await createDraft(db, null);
  await appendDraftImage(db, draft.id, 'SYNTHETIC.jpg', image.sha256, { ...image, id: crypto.randomUUID() });
  return db;
}

it('T23 migration transformation fills only a missing field and is idempotent', () => {
  for (const row of [{}, { collapsed: true }, { collapsed: false }]) {
    completeSeriesMigration(row); const once = structuredClone(row); completeSeriesMigration(row); expect(row).toEqual(once);
  }
  const missing = {}; completeSeriesMigration(missing); expect(missing).toEqual({ collapsed: false });
});

it.each([1, 2])('T23 native upgrade/reopen from released schema %i preserves every persisted table and image bytes', async version => {
  const source = await richSource(), data = await readCore(source), name = 'stage17-history-' + crypto.randomUUID();
  const older = track(new Dexie(name)); older.version(version).stores(schema()); await older.open();
  const tables = await Promise.all(source.tables.map(async table => [table.name, await source.table(table.name).toArray()] as const));
  await older.transaction('rw', older.tables, async () => {
    for (const [name, rows] of tables) {
      if (version === 1 && name === 'series') {
        rows.push({ id: crypto.randomUUID(), name: 'ללא שדה', normalizedName: 'ללא שדה' });
      }
      await older.table(name).bulkAdd(rows);
    }
  });
  older.close(); const upgraded = track(new LibraryDatabase(name)); await initializeLibrary(upgraded);
  const actual = await readCore(upgraded);
  expect(actual.series.find(row => row.id === data.series[0].id)?.collapsed).toBe(true);
  if (version === 1) {
    expect(actual.series.find(row => row.name === 'ללא שדה')?.collapsed).toBe(false);
    actual.series = actual.series.filter(row => row.name !== 'ללא שדה');
  }
  expect(actual).toEqual(data);
  for (let i = 0; i < actual.images.length; i++) expect(await actual.images[i].blob.arrayBuffer()).toEqual(await data.images[i].blob.arrayBuffer());
  const before = await createFullSnapshot(upgraded); upgraded.close(); await initializeLibrary(upgraded);
  expect((await createFullSnapshot(upgraded)).fingerprint).toBe(before.fingerprint);
});

it('T23 a failed native version transaction restores both data and original schema, then permits forward repair', async () => {
  const source = await richSource(), before = await createFullSnapshot(source), name = source.name; source.close();
  const failing = track(new Dexie(name)); failing.version(2).stores(schema());
  failing.version(3).stores({}).upgrade(async tx => { await tx.table('books').clear(); await tx.table('images').clear(); throw new Error('synthetic migration failure'); });
  await expect(failing.open()).rejects.toThrow('synthetic migration failure'); failing.close();
  const repaired = track(new LibraryDatabase(name)); await initializeLibrary(repaired);
  expect(repaired.verno).toBe(2); expect((await createFullSnapshot(repaired)).fingerprint).toBe(before.fingerprint);
});

it('T23 current startup refuses a future schema despite Dexie fallback, without deleting data', async () => {
  const source = await richSource(), before = await createFullSnapshot(source), data = await readCore(source); source.close();
  const future = track(new Dexie(source.name)); future.version(3).stores(schema()); await future.open(); future.close();
  await expect(initializeLibrary(source)).rejects.toMatchObject({ name: 'VersionError' });
  expect(source.isOpen()).toBe(false);
  await future.open(); expect(await future.table('books').count()).toBe(before.counts.books);
  expect((await future.table('settings').get('libraryName')).value).toBe('הספרייה שלי');
  for (const [name, rows] of Object.entries(data)) expect(await future.table(name).toArray()).toEqual(rows);
});

it('T23 lifecycle holds version change until explicit release and blocks late writes', async () => {
  const source = await richSource(), notices: string[] = [];
  const unwatch = watchDatabaseConnection(source, notice => notices.push(notice));
  source.on('versionchange').fire(new Event('versionchange') as IDBVersionChangeEvent);
  expect(notices).toEqual(['versionchange']); expect(source.isOpen()).toBe(true);
  await expect(source.settings.put({ key: 'libraryName', value: 'must not save' })).rejects.toThrow('שדרוג');
  expect((await source.settings.get('libraryName'))?.value).toBe('הספרייה שלי');
  source.close(); unwatch(); expect(source.isOpen()).toBe(false);
});

it('T23 every backup version 1–8 upgrades on import and can be exported/restored again', async () => {
  const source = track(new LibraryDatabase('stage17-backups-' + crypto.randomUUID())); await initializeLibrary(source);
  await saveBook(source, { ...emptyInput, title: 'ישן לחדש', authors: ['מחבר'] });
  const latest = JSON.parse((await createSnapshot(source)).text);
  for (let version = 1; version <= 8; version++) {
    let text: string;
    if (version === 8) text = (await createFullSnapshot(source)).text;
    else {
      const root = structuredClone(latest); root.version = version; root.schemaVersion = version === 1 ? 1 : 2;
      const missing = version === 1 ? ['shelves', 'bookShelves', 'series', 'genres', 'tags', 'people', 'loans', 'metadataSources', 'recognitionDrafts'] : version === 2 ? ['people', 'loans', 'metadataSources', 'recognitionDrafts'] : version === 3 ? ['metadataSources', 'recognitionDrafts'] : version < 6 ? ['recognitionDrafts'] : [];
      for (const key of missing) { delete root.data[key]; delete root.counts[key]; }
      root.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(root.data)).buffer); text = JSON.stringify(root);
    }
    const target = track(new LibraryDatabase('stage17-target-' + crypto.randomUUID())); await initializeLibrary(target);
    await restoreSnapshot(target, await validateBackup(text), (await createSnapshot(target)).fingerprint);
    expect((await target.books.toArray())[0].title).toBe('ישן לחדש');
    const once = await createFullSnapshot(target);
    await restoreSnapshot(target, await validateBackup(once.text), once.fingerprint);
    expect((await createFullSnapshot(target)).fingerprint).toBe(once.fingerprint);
  }
});
