import type { LibraryDatabase } from './database';
import { canonical, coreKeys, envelope, readCore, validateBackup, type Core, type ValidatedBackup } from './backup';
import { hashBytes } from './images';
import { LibraryValidationError, normalizeText } from './library';

type TableKey = Exclude<keyof Core, 'settings'>;
export interface MergeConflict { key: string; table: TableKey; id: string; label: string; currentRevision?: number; incomingRevision?: number; current: string; incoming: string }
export interface MergePreview {
  incoming: Core; fingerprint: string; additions: number; unchanged: number; conflicts: MergeConflict[];
  renamedCollections: string[]; duplicateBooks: string[];
}
export type MergeChoices = Record<string, 'current' | 'incoming'>;
const fail = (message: string): never => { throw new LibraryValidationError(message); };
const rowText = (row: object) => JSON.stringify(row, (key, value) => {
  if (key === 'blob') return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  return value;
});

async function mappedCore(source: Core, targetLibraryId: string): Promise<Core> {
  const libraryId = source.settings.find(setting => setting.key === 'libraryId')!.value;
  if (libraryId === targetLibraryId) return structuredClone(source);
  // Table-qualified, deterministic UUIDs: source library identity is part of the namespace.
  const mapping = new Map<string, string>();
  async function id(table: string, value: string): Promise<string> {
    const key = table + '/' + value;
    if (!mapping.has(key)) {
      const hash = await hashBytes(new TextEncoder().encode(JSON.stringify(['library-merge-v1', targetLibraryId, libraryId, table, value])).buffer);
      mapping.set(key, `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`);
    }
    return mapping.get(key)!;
  }
  const result = structuredClone(source);
  for (const table of coreKeys) if (table !== 'settings') for (const row of result[table]) row.id = await id(table, row.id);
  for (const book of result.books) {
    book.authorIds = await Promise.all(book.authorIds.map(value => id('authors', value)));
    book.genreIds = await Promise.all(book.genreIds.map(value => id('genres', value)));
    book.tagIds = await Promise.all(book.tagIds.map(value => id('tags', value)));
    if (book.seriesId) book.seriesId = await id('series', book.seriesId);
    if (book.primaryImageId) book.primaryImageId = await id('images', book.primaryImageId);
  }
  for (const copy of result.copies) {
    copy.bookId = await id('books', copy.bookId);
    if (copy.handyLibrary?.iconImageId) copy.handyLibrary.iconImageId = await id('images', copy.handyLibrary.iconImageId);
    if (copy.handyLibrary?.photoImageId) copy.handyLibrary.photoImageId = await id('images', copy.handyLibrary.photoImageId);
  }
  for (const shelf of result.shelves) {
    if (shelf.parentId) shelf.parentId = await id('shelves', shelf.parentId);
    if (shelf.imageId) shelf.imageId = await id('images', shelf.imageId);
  }
  for (const link of result.bookShelves) { link.bookId = await id('books', link.bookId); link.shelfId = await id('shelves', link.shelfId); }
  for (const loan of result.loans) { loan.copyId = await id('copies', loan.copyId); loan.personId = await id('people', loan.personId); }
  for (const metadata of result.metadataSources) {
    metadata.bookId = await id('books', metadata.bookId);
    if (metadata.recognition?.batchId) metadata.recognition.batchId = await id('recognitionDrafts', metadata.recognition.batchId);
    if (metadata.recognition?.itemId) {
      metadata.recognition.itemId = await id('draftItems', metadata.recognition.itemId);
      const evidence = metadata.recognition;
      metadata.recordId = `${evidence.model}/${evidence.version}/${evidence.imageHash}/${evidence.itemId}`;
    }
  }
  for (const draft of result.recognitionDrafts) {
    draft.batchId = draft.id;
    if (draft.shelfId) draft.shelfId = await id('shelves', draft.shelfId);
    if (draft.runId) draft.runId = await id('draftRuns', draft.runId);
    for (const image of draft.images) { image.id = await id('draftImages', image.id); if (image.storedImageId) image.storedImageId = await id('images', image.storedImageId); }
    for (const item of draft.items) {
      item.id = await id('draftItems', item.id); item.imageId = await id('draftImages', item.imageId);
      if (item.bookId) item.bookId = await id('books', item.bookId);
      if (item.copyId) item.copyId = await id('copies', item.copyId);
      if (item.review) {
        const input = item.review.input;
        if (input.shelfIds) input.shelfIds = await Promise.all(input.shelfIds.map(value => id('shelves', value)));
        if (input.genreIds) input.genreIds = await Promise.all(input.genreIds.map(value => id('genres', value)));
        if (input.tagIds) input.tagIds = await Promise.all(input.tagIds.map(value => id('tags', value)));
        if (input.seriesId) input.seriesId = await id('series', input.seriesId);
        if (item.review.targetBookId) item.review.targetBookId = await id('books', item.review.targetBookId);
      }
    }
  }
  return result;
}

async function prepare(current: Core, backup: ValidatedBackup): Promise<MergePreview> {
  const checked = await validateBackup(JSON.stringify(await envelope(backup.data)));
  const incoming = await mappedCore(checked.data, current.settings.find(setting => setting.key === 'libraryId')!.value);
  const renamedCollections: string[] = [], conflicts: MergeConflict[] = [], duplicateBooks: string[] = [];
  // Preserve separate collection identities; propose an explicit visible name rather than silently unifying them.
  for (const table of ['tags', 'genres', 'series'] as const) {
    const names = new Set(current[table].map(row => row.normalizedName));
    for (const row of incoming[table]) {
      const existing = current[table].find(value => value.id === row.id);
      if (!existing && names.has(row.normalizedName)) {
        const original = row.name; let suffix = 1;
        do { row.name = `${original.slice(0, 85)} (ייבוא ${row.id.slice(-8)}-${suffix++})`; row.normalizedName = normalizeText(row.name); } while (names.has(row.normalizedName));
        renamedCollections.push(row.name);
      }
      // A repeated import reuses its earlier proposed name if the original name still collides.
      if (existing && existing.name.startsWith(row.name.slice(0, 85) + ' (ייבוא ') && current[table].some(other => other.id !== row.id && other.normalizedName === row.normalizedName)) { row.name = existing.name; row.normalizedName = existing.normalizedName; }
      names.add(row.normalizedName);
    }
  }
  let additions = 0, unchanged = 0;
  for (const table of coreKeys) if (table !== 'settings') {
    const rows = new Map<string, object>(current[table].map(row => [row.id, row]));
    for (const row of incoming[table]) {
      const existing = rows.get(row.id);
      if (!existing) { additions++; continue; }
      if (rowText(existing) === rowText(row)) { unchanged++; continue; }
      const value = row as { title?: string | null; name?: string; displayName?: string; revision?: number };
      conflicts.push({ key: table + '/' + row.id, table, id: row.id, label: value.title ?? value.name ?? value.displayName ?? row.id,
        currentRevision: (existing as { revision?: number }).revision, incomingRevision: value.revision, current: rowText(existing), incoming: rowText(row) });
    }
  }
  const ids = new Set(current.books.map(book => book.id));
  for (const book of incoming.books) if (!ids.has(book.id) && current.books.some(other =>
    (book.isbn13 && book.isbn13 === other.isbn13) || (book.isbn10 && book.isbn10 === other.isbn10) ||
    (book.danacode && book.danacode === other.danacode) || (book.title && normalizeText(book.title) === normalizeText(other.title ?? '')))) duplicateBooks.push(book.title ?? book.id);
  return { incoming, fingerprint: canonical(current), additions, unchanged, conflicts, renamedCollections, duplicateBooks };
}

export async function previewMerge(database: LibraryDatabase, backup: ValidatedBackup): Promise<MergePreview> {
  const current = await database.transaction('r', database.tables, () => readCore(database));
  return prepare(current, backup);
}

export async function mergeSnapshot(database: LibraryDatabase, backup: ValidatedBackup, expectedFingerprint: string, choices: MergeChoices, confirmedSeparate: boolean): Promise<void> {
  const current = await database.transaction('r', database.tables, () => readCore(database));
  if (canonical(current) !== expectedFingerprint) return fail('הספרייה השתנתה מאז התצוגה המקדימה. בדוק מחדש והכן גיבוי מגן.');
  const plan = await prepare(current, backup);
  if ((plan.duplicateBooks.length || plan.renamedCollections.length) && !confirmedSeparate) return fail('אשר שמירת ספרים ואוספים דומים בנפרד לפני המיזוג.');
  for (const conflict of plan.conflicts) if (!['current', 'incoming'].includes(choices[conflict.key])) return fail('בחר גרסה לכל סתירה לפני המיזוג.');
  const merged = structuredClone(current);
  for (const table of coreKeys) if (table !== 'settings') {
    const rows = new Map<string, Core[typeof table][number]>(current[table].map(row => [row.id, row]));
    for (const row of plan.incoming[table]) if (!rows.has(row.id) || choices[table + '/' + row.id] === 'incoming') {
      const next = structuredClone(row);
      const existing = rows.get(row.id);
      if (table === 'books' && existing && 'revision' in next && 'revision' in existing) { next.revision = Math.max(next.revision, existing.revision) + 1; next.updatedAt = new Date().toISOString(); }
      rows.set(row.id, next);
    }
    // Every table is validated together below, including references across conflict choices.
    Object.assign(merged, { [table]: [...rows.values()] });
  }
  const checked = await validateBackup(JSON.stringify(await envelope(merged)));
  await database.transaction('rw', database.tables, async () => {
    if (canonical(await readCore(database)) !== expectedFingerprint) return fail('הספרייה השתנתה בזמן ההכנה. בדוק מחדש לפני המיזוג.');
    for (const table of coreKeys) if (table !== 'settings') {
      const existing = new Map(current[table].map(row => [row.id, rowText(row)]));
      const changes = checked.data[table].filter(row => existing.get(row.id) !== rowText(row));
      if (changes.length) await database.table(table).bulkPut(changes);
    }
    await database.metadataCache.clear();
  });
}
