import type { LibraryDatabase } from './database';
import type { Author, Book, BookShelf, Copy, Loan, MetadataSource, NamedItem, Person, RecognitionDraft, Series, Setting, Shelf, StoredImage } from './models';
import { LibraryValidationError, normalizeText } from './library';
import { hashBytes, jpegDimensions } from './images';
import { parseISBN, readingStates } from './books';
import { validDay } from './loans';
import { validateMetadataSource } from './metadata';
import { validateDraft } from './shelfDraft';
import { fullEnvelope, legacyEnvelope, MAX_BACKUP_BYTES, hasExtendedBookDetails, hasGoodreadsData } from './backupFormat';

export interface Core { books: Book[]; copies: Copy[]; authors: Author[]; settings: Setting[]; images: StoredImage[]; shelves: Shelf[]; bookShelves: BookShelf[]; series: Series[]; genres: NamedItem[]; tags: NamedItem[]; people: Person[]; loans: Loan[]; metadataSources: MetadataSource[]; recognitionDrafts: RecognitionDraft[] }
type ImageJSON = Omit<StoredImage, 'blob'> & { base64: string };
type Payload = Omit<Core, 'images'> & { images: ImageJSON[] };
interface Backup { format: 'personal-library-basic'; version: 7 | 8 | 9; schemaVersion: 2; appVersion: string; libraryId: string; exportedAt: string; counts: Record<keyof Core, number>; checksum: string; data: Payload }
export interface Snapshot { text: string; fingerprint: string; counts: Backup['counts'] }
export interface ValidatedBackup { data: Core; counts: Backup['counts']; libraryName: string }
export const coreKeys = ['books', 'copies', 'authors', 'settings', 'images', 'shelves', 'bookShelves', 'series', 'genres', 'tags', 'people', 'loans', 'metadataSources', 'recognitionDrafts'] as const;
const version5Keys = coreKeys.filter(key => key !== 'recognitionDrafts');
const version3Keys = version5Keys.filter(key => key !== 'metadataSources');
const version2Keys = version3Keys.filter(key => key !== 'people' && key !== 'loans');
const legacyKeys = ['books', 'copies', 'authors', 'settings', 'images'];
const bad = (message = 'קובץ הגיבוי אינו תקין או מכיל שדות שאינם נתמכים.'): never => { throw new LibraryValidationError(message); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad();
  return value as Record<string, unknown>;
};
function exact(value: unknown, keys: string[]) {
  const row = object(value);
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) return bad();
  return row;
}
const text = (value: unknown, max = 20000): value is string => typeof value === 'string' && value.length <= max;
const nullable = (value: unknown): boolean => value === null || text(value);
const integer = (value: unknown, min: number, max: number): boolean => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
const date = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const loanDate = (value: unknown): boolean => date(value) && new Date(value as string).toISOString() === value;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 1000 && value.every(uuid) && new Set(value).size === value.length;
export function canonical(core: Core): string {
  return JSON.stringify({ ...core, settings: core.settings.filter(setting => !['lastBackupAt', 'lastBackupCheckedAt'].includes(setting.key)), images: core.images.map(image => ({ ...image, blob: undefined })) });
}
export async function readCore(database: LibraryDatabase): Promise<Core> {
  return { books: await database.books.toArray(), copies: await database.copies.toArray(), authors: await database.authors.toArray(), settings: await database.settings.toArray(), images: await database.images.toArray(), shelves: await database.shelves.toArray(), bookShelves: await database.bookShelves.toArray(), series: await database.series.toArray(), genres: await database.genres.toArray(), tags: await database.tags.toArray(), people: await database.people.toArray(), loans: await database.loans.toArray(), metadataSources: await database.metadataSources.toArray(), recognitionDrafts: await database.recognitionDrafts.toArray() };
}
const countsOf = (core: Core): Backup['counts'] => Object.fromEntries(coreKeys.map(key => [key, core[key].length])) as Backup['counts'];
const encode = (bytes: Uint8Array): string => {
  let binary = ''; for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
};
export async function envelope(core: Core): Promise<Backup> {
  const estimated = new Blob([canonical(core)]).size + core.images.reduce((total, image) => total + Math.ceil(image.blob.size / 3) * 4, 0);
  if (estimated > MAX_BACKUP_BYTES) return bad('הגיבוי גדול מדי (עד 150 מגה־בייט). אין שינוי בספרייה.');
  const { images, ...tables } = core;
  const data: Payload = { ...tables, images: await Promise.all(images.map(async ({ blob, ...image }) => ({ ...image, base64: encode(new Uint8Array(await blob.arrayBuffer())) }))) };
  return { format: 'personal-library-basic', version: hasGoodreadsData(core) ? 9 : hasExtendedBookDetails(core) ? 8 : 7, schemaVersion: 2, appVersion: '0.24.0', libraryId: core.settings.find(setting => setting.key === 'libraryId')!.value, exportedAt: new Date().toISOString(), counts: countsOf(core), checksum: await hashBytes(new TextEncoder().encode(JSON.stringify(data)).buffer), data };
}
export async function createSnapshot(database: LibraryDatabase, full = false): Promise<Snapshot> {
  const core = await database.transaction('r', database.tables, () => readCore(database));
  const backup = await envelope(core);
  // Apply the same whitelist to outgoing and incoming snapshots: unknown stored fields must never leak.
  const text = JSON.stringify(full ? fullEnvelope(backup) : backup);
  await validateBackup(text);
  return { text, fingerprint: canonical(core), counts: backup.counts };
}
export async function validateBackup(source: string): Promise<ValidatedBackup> {
  if (source.length > MAX_BACKUP_BYTES || new Blob([source]).size > MAX_BACKUP_BYTES) return bad('הגיבוי גדול מדי (עד 150 מגה־בייט).');
  let parsed: unknown; try { parsed = JSON.parse(source); } catch { return bad('הקובץ אינו JSON תקין.'); }
  parsed = legacyEnvelope(parsed);
  const root = exact(parsed, ['format', 'version', 'schemaVersion', 'appVersion', 'libraryId', 'exportedAt', 'counts', 'checksum', 'data']);
  const legacy = root.version === 1 && root.schemaVersion === 1;
  const version2 = root.version === 2 && root.schemaVersion === 2;
  const version3 = root.version === 3 && root.schemaVersion === 2;
  const version5 = [4, 5].includes(root.version as number) && root.schemaVersion === 2;
  if (root.format !== 'personal-library-basic' || (!legacy && !version2 && !version3 && !version5 && (![6, 7, 8, 9].includes(root.version as number) || root.schemaVersion !== 2))) return bad('פורמט או גרסת הגיבוי אינם נתמכים. הספרייה לא שונתה.');
  if (!text(root.appVersion, 100) || !uuid(root.libraryId) || !date(root.exportedAt) || !text(root.checksum, 64)) return bad();
  const keys = legacy ? legacyKeys : version2 ? version2Keys : version3 ? version3Keys : version5 ? version5Keys : [...coreKeys];
  const data = exact(root.data, keys);
  for (const key of Object.keys(data)) if (!Array.isArray(data[key]) || (data[key] as unknown[]).length > 20000) return bad();
  if (await hashBytes(new TextEncoder().encode(JSON.stringify(data)).buffer) !== root.checksum) return bad('בדיקת שלמות הגיבוי נכשלה. הספרייה לא שונתה.');
  const payload = (legacy ? { ...data, shelves: [], bookShelves: [], series: [], genres: [], tags: [], people: [], loans: [], metadataSources: [], recognitionDrafts: [] } : version2 ? { ...data, people: [], loans: [], metadataSources: [], recognitionDrafts: [] } : version3 ? { ...data, metadataSources: [], recognitionDrafts: [] } : version5 ? { ...data, recognitionDrafts: [] } : data) as unknown as Payload;
  const ids = <T extends { id: string }>(rows: T[]) => {
    if (rows.some(row => !uuid(object(row).id)) || new Set(rows.map(row => row.id)).size !== rows.length) return bad();
    return new Set(rows.map(row => row.id));
  };
  const bookIds = ids(payload.books), authorIds = ids(payload.authors), imageIds = ids(payload.images), copyIds = ids(payload.copies), personIds = ids(payload.people); ids(payload.loans);
  ids(payload.metadataSources);
  for (const source of payload.metadataSources) { validateMetadataSource(source); if (!bookIds.has(source.bookId)) return bad(); }
  const shelfIds = ids(payload.shelves), seriesIds = ids(payload.series), genreIds = ids(payload.genres), tagIds = ids(payload.tags); ids(payload.bookShelves);
  ids(payload.recognitionDrafts);
  const draftImageIds = new Set<string>();
  for (const draft of payload.recognitionDrafts) {
    validateDraft(draft);
    if (draft.shelfId !== null && !shelfIds.has(draft.shelfId)) return bad();
    for (const image of draft.images) if (image.storedImageId) { if (!imageIds.has(image.storedImageId) || payload.images.find(source => source.id === image.storedImageId)?.sha256 !== image.preparedHash) return bad(); draftImageIds.add(image.storedImageId); }
    for (const item of draft.items) if (item.status === 'saved' && (!bookIds.has(item.bookId!) || !copyIds.has(item.copyId!) || !payload.copies.some(copy => copy.id === item.copyId && copy.bookId === item.bookId))) return bad();
  }
  for (const [rows, isSeries] of [[payload.series, true], [payload.genres, false], [payload.tags, false]] as const) {
    const names = new Set<string>();
    for (const item of rows) {
      exact(item, isSeries ? ['id', 'name', 'normalizedName', 'collapsed'] : ['id', 'name', 'normalizedName']);
      if (!text(item.name, 120) || !item.name.trim() || !normalizeText(item.name) || item.normalizedName !== normalizeText(item.name) || names.has(item.normalizedName) || (isSeries && typeof (item as Series).collapsed !== 'boolean')) return bad();
      names.add(item.normalizedName);
    }
  }
  const parents = new Map<string, string | null>();
  for (const shelf of payload.shelves) {
    exact(shelf, ['id', 'name', 'parentId', 'imageId', 'sortOrder', 'createdAt', 'updatedAt']);
    if (!text(shelf.name, 120) || !shelf.name.trim() || (shelf.parentId !== null && !shelfIds.has(shelf.parentId)) || (shelf.imageId !== null && !imageIds.has(shelf.imageId)) || !integer(shelf.sortOrder, 0, Number.MAX_SAFE_INTEGER) || !date(shelf.createdAt) || !date(shelf.updatedAt)) return bad();
    parents.set(shelf.id, shelf.parentId);
  }
  const complete = new Set<string>();
  for (const shelf of payload.shelves) {
    const path = new Set<string>(); let id: string | null = shelf.id;
    while (id !== null && !complete.has(id)) {
      if (path.has(id)) return bad('עץ המדפים בגיבוי מכיל מעגל. הספרייה לא שונתה.');
      path.add(id); id = parents.get(id) ?? null;
    }
    for (const visited of path) complete.add(visited);
  }
  const pairs = new Set<string>();
  for (const link of payload.bookShelves) {
    exact(link, ['id', 'bookId', 'shelfId']);
    const pair = link.bookId + '/' + link.shelfId;
    if (!bookIds.has(link.bookId) || !shelfIds.has(link.shelfId) || pairs.has(pair)) return bad();
    pairs.add(pair);
  }
  for (const author of payload.authors) {
    exact(author, ['id', 'displayName', 'givenName', 'familyName', 'normalizedName']);
    if (!text(author.displayName, 1000) || !author.displayName.trim() || !nullable(author.givenName) || !nullable(author.familyName) || author.normalizedName !== normalizeText(author.displayName)) return bad();
  }
  const bookKeys = ['id', 'title', 'subtitle', 'authorIds', 'isbn10', 'isbn13', 'danacode', 'publisher', 'publicationYear', 'edition', 'volume', 'language', 'pages', 'seriesId', 'seriesNumber', 'genreIds', 'tagIds', 'readStatus', 'personalNotes', 'primaryImageId', 'createdAt', 'updatedAt', 'revision', 'titleSortKey'];
  for (const book of payload.books) {
    exact(book, [...bookKeys, ...['rating', 'publicationDate', 'binding'].filter(key => Object.hasOwn(book, key))]);
    if (book.publicationDate !== undefined && book.publicationDate !== null && (!validDay(book.publicationDate) || book.publicationYear !== +book.publicationDate.slice(0, 4))) return bad();
    if (book.binding !== undefined && book.binding !== null && !text(book.binding, 1000)) return bad();
    if (book.rating !== undefined && book.rating !== null && !integer(book.rating, 1, 5)) return bad();
    for (const key of ['title', 'subtitle', 'danacode', 'publisher', 'edition', 'volume', 'language', 'personalNotes'] as const) if (!nullable(book[key])) return bad();
    if (!strings(book.authorIds) || book.authorIds.some(id => !authorIds.has(id)) || !strings(book.genreIds) || book.genreIds.some(id => !genreIds.has(id)) || !strings(book.tagIds) || book.tagIds.some(id => !tagIds.has(id)) || (book.seriesId !== null && !seriesIds.has(book.seriesId)) || (book.seriesNumber !== null && (book.seriesId === null || typeof book.seriesNumber !== 'number' || !Number.isFinite(book.seriesNumber) || book.seriesNumber < 0 || book.seriesNumber > 1000000))) return bad();
    if ((book.publicationYear !== null && !integer(book.publicationYear, 1, 9999)) || (book.pages !== null && !integer(book.pages, 1, 100000)) || !integer(book.revision, 1, Number.MAX_SAFE_INTEGER) || !date(book.createdAt) || !date(book.updatedAt) || typeof book.readStatus !== 'string' || !Object.hasOwn(readingStates, book.readStatus) || book.titleSortKey !== normalizeText(book.title ?? '')) return bad();
    if (book.primaryImageId !== null && !imageIds.has(book.primaryImageId)) return bad();
    if (!nullable(book.isbn10) || !nullable(book.isbn13)) return bad();
    if (book.isbn10 && parseISBN(book.isbn10).isbn10 !== book.isbn10) return bad();
    if (book.isbn13 && parseISBN(book.isbn13).isbn13 !== book.isbn13) return bad();
  }
  for (const copy of payload.copies) {
    exact(copy, ['id', 'bookId', 'label', 'purchasePriceMinor', 'currency', 'notes', 'archivedAt', 'createdAt', 'updatedAt']);
    if (!bookIds.has(copy.bookId) || !nullable(copy.label) || !nullable(copy.notes) || !nullable(copy.currency) || (copy.purchasePriceMinor !== null && !integer(copy.purchasePriceMinor, 0, 100000000)) || (copy.archivedAt !== null && !date(copy.archivedAt)) || !date(copy.createdAt) || !date(copy.updatedAt)) return bad();
  }
  for (const person of payload.people) {
    exact(person, ['id', 'name', 'normalizedName', 'archivedAt']);
    if (!text(person.name, 120) || !person.name.trim() || !normalizeText(person.name) || person.normalizedName !== normalizeText(person.name) || (person.archivedAt !== null && !date(person.archivedAt))) return bad();
  }
  const copiesById = new Map(payload.copies.map(copy => [copy.id, copy]));
  const peopleById = new Map(payload.people.map(person => [person.id, person]));
  const loansByCopy = new Map<string, Loan[]>();
  for (const loan of payload.loans) {
    exact(loan, ['id', 'copyId', 'personId', 'borrowedAt', 'expectedReturnOn', 'returnedAt', 'openFlag', 'notes', 'createdAt', 'updatedAt']);
    if (!copyIds.has(loan.copyId) || !personIds.has(loan.personId) || !loanDate(loan.borrowedAt) || !loanDate(loan.createdAt) || !loanDate(loan.updatedAt) || !nullable(loan.notes) || (loan.expectedReturnOn !== null && !validDay(loan.expectedReturnOn)) || (loan.returnedAt !== null && (!loanDate(loan.returnedAt) || Date.parse(loan.returnedAt) < Date.parse(loan.borrowedAt))) || loan.openFlag !== (loan.returnedAt === null ? 1 : 0)) return bad('נתוני ההשאלות בגיבוי אינם תקינים.');
    if (loan.returnedAt === null && (copiesById.get(loan.copyId)!.archivedAt || peopleById.get(loan.personId)!.archivedAt)) return bad('השאלה פתוחה מפנה לעותק או אדם בארכיון.');
    const history = loansByCopy.get(loan.copyId) ?? [];
    history.push(loan); loansByCopy.set(loan.copyId, history);
  }
  for (const loans of loansByCopy.values()) {
    loans.sort((a, b) => Date.parse(a.borrowedAt) - Date.parse(b.borrowedAt));
    for (let i = 1; i < loans.length; i++) if (loans[i - 1].returnedAt === null || Date.parse(loans[i].borrowedAt) < Date.parse(loans[i - 1].returnedAt!)) return bad('הגיבוי מכיל השאלות חופפות לאותו עותק.');
  }
  if (payload.books.some(book => !payload.copies.some(copy => copy.bookId === book.id))) return bad('חסר עותק לאחד הספרים בגיבוי.');
  const allowed = ['libraryId', 'libraryName', 'displayMode', 'preferredModel', 'lastBackupAt', 'lastBackupCheckedAt'];
  if (new Set(payload.settings.map(setting => object(setting).key)).size !== payload.settings.length) return bad();
  for (const setting of payload.settings) {
    exact(setting, ['key', 'value']);
    if (!allowed.includes(setting.key) || !text(setting.value, 120)) return bad();
    if (setting.key === 'displayMode' && !['compact', 'expanded'].includes(setting.value)) return bad();
    if (setting.key === 'preferredModel' && !['gemini-3.8-flash', 'gemini-3.7-flash'].includes(setting.value)) return bad();
    if (['lastBackupAt', 'lastBackupCheckedAt'].includes(setting.key) && !date(setting.value)) return bad();
  }
  if (payload.settings.find(setting => setting.key === 'libraryId')?.value !== root.libraryId || !payload.settings.find(setting => setting.key === 'libraryName')?.value.trim() || !payload.settings.some(setting => setting.key === 'displayMode')) return bad();
  const images: StoredImage[] = [];
  for (const image of payload.images) {
    exact(image, ['id', 'mimeType', 'width', 'height', 'byteLength', 'sha256', 'sourceUrl', 'createdAt', 'base64']);
    const draftSource = draftImageIds.has(image.id);
    if (!integer(image.width, 1, draftSource ? 2048 : 1200) || !integer(image.height, 1, draftSource ? 2048 : 1200) || !integer(image.byteLength, 1, draftSource ? 1.5 * 1024 * 1024 : 1024 * 1024) || image.mimeType !== 'image/jpeg' || !text(image.sha256, 64) || image.sourceUrl !== null || !date(image.createdAt) || !text(image.base64, draftSource ? 2100000 : 1400000) || !/^[A-Za-z\d+/]*={0,2}$/.test(image.base64)) return bad();
    let bytes: Uint8Array; try { bytes = Uint8Array.from(atob(image.base64), char => char.charCodeAt(0)); } catch { return bad(); }
    const dimensions = jpegDimensions(bytes);
    if (bytes.length !== image.byteLength || dimensions?.width !== image.width || dimensions.height !== image.height || await hashBytes(bytes.buffer as ArrayBuffer) !== image.sha256) return bad('תמונה בגיבוי פגומה. הספרייה לא שונתה.');
    const metadata = { id: image.id, mimeType: image.mimeType, width: image.width, height: image.height, byteLength: image.byteLength, sha256: image.sha256, sourceUrl: image.sourceUrl, createdAt: image.createdAt };
    images.push({ ...metadata, blob: new Blob([bytes.buffer as ArrayBuffer], { type: image.mimeType }) });
    if (typeof createImageBitmap === 'function') {
      let decoded: ImageBitmap | undefined;
      try { decoded = await createImageBitmap(images.at(-1)!.blob); if (decoded.width !== image.width || decoded.height !== image.height) return bad(); }
      catch { return bad('לא ניתן לפענח תמונה בגיבוי. הספרייה לא שונתה.'); }
      finally { decoded?.close(); }
    }
  }
  const core: Core = { ...payload, images };
  const countKeys = keys;
  const counts = exact(root.counts, countKeys);
  for (const key of countKeys as (keyof Core)[]) if (counts[key] !== core[key].length) return bad();
  return { data: core, counts: countsOf(core), libraryName: core.settings.find(setting => setting.key === 'libraryName')!.value };
}
export async function restoreSnapshot(database: LibraryDatabase, backup: ValidatedBackup, expectedFingerprint: string): Promise<void> {
  // Validate and detach a fresh copy at the service boundary, including callers outside the UI.
  const checked = await validateBackup(JSON.stringify(await envelope(backup.data)));
  // All parsing, hashing and file operations finish before this atomic transaction starts.
  await database.transaction('rw', database.tables, async () => {
    if (canonical(await readCore(database)) !== expectedFingerprint) return bad('הספרייה השתנתה מאז הגיבוי המגן. צור גיבוי מגן חדש לפני ההחלפה.');
    for (const key of coreKeys) {
      await database.table(key).clear(); await database.table(key).bulkAdd(checked.data[key]);
    }
    await database.metadataCache.clear();
  });
}
export async function deleteBook(database: LibraryDatabase, id: string, expectedFingerprint: string): Promise<void> {
  await database.transaction('rw', database.tables, async () => {
    if (canonical(await readCore(database)) !== expectedFingerprint) return bad('הספרייה השתנתה. צור גיבוי מגן חדש לפני המחיקה.');
    const book = await database.books.get(id); if (!book) return bad('הספר אינו קיים.');
    const copies = await database.copies.where('bookId').equals(id).toArray();
    for (const copy of copies) if (await database.loans.where('copyId').equals(copy.id).count()) return bad('לספר קיימת היסטוריית השאלות. יש לארכב את העותקים במקום למחוק.');
    await database.copies.bulkDelete(copies.map(copy => copy.id)); await database.books.delete(id);
    await database.bookShelves.where('bookId').equals(id).delete();
    await database.metadataSources.where('bookId').equals(id).delete();
    await database.recognitionDrafts.filter(draft => draft.items.some(item => item.bookId === id)).modify(draft => {
      for (const item of draft.items) if (item.bookId === id) { item.status = 'removed'; item.bookId = null; item.copyId = null; }
      draft.revision++; draft.updatedAt = new Date().toISOString();
    });
    const others = await database.books.toArray();
    if (book.primaryImageId && !others.some(other => other.primaryImageId === book.primaryImageId) && !await database.shelves.filter(shelf => shelf.imageId === book.primaryImageId).count() && !await database.recognitionDrafts.filter(draft => draft.images.some(image => image.storedImageId === book.primaryImageId)).count()) await database.images.delete(book.primaryImageId);
    for (const authorId of book.authorIds) if (!others.some(other => other.authorIds.includes(authorId))) await database.authors.delete(authorId);
  });
}
export function downloadSnapshot(snapshot: Snapshot, prefix = 'library-backup') {
  const url = URL.createObjectURL(new Blob([snapshot.text], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
