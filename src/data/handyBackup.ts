import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { zipSync, strToU8 } from 'fflate';
import schema from './handySchema.json';
import { readHandyZip } from './xlsxZip';
import { canonical, coreKeys, envelope, readCore, restoreSnapshot, validateBackup, type Core, type ValidatedBackup } from './backup';
import type { LibraryDatabase } from './database';
import type { Book, Copy, NamedItem, StoredImage } from './models';
import { LibraryValidationError, normalizeText } from './library';
import { comparableISBN, parseISBN } from './books';
import { hashBytes, jpegDimensions } from './images';
import { validDay } from './loans';
import { MAX_BACKUP_BYTES } from './backupFormat';

type Row = Record<string, string | number | null>;
export interface HandyBackup { backup: ValidatedBackup; sourceRows: number; warnings: string[] }
const fail = (message: string): never => { throw new LibraryValidationError(`Handy Library: ${message}. הספרייה לא שונתה.`); };
let sql: ReturnType<typeof initSqlJs> | undefined;
export const handySql = () => sql ??= initSqlJs({ locateFile: () => wasmUrl });
const text = (value: unknown) => value === null || value === undefined ? '' : String(value);
const nullable = (value: unknown) => text(value).trim() || null;
const uuid = () => crypto.randomUUID();
const positive = (value: unknown, max: number) => /^\d+$/.test(text(value)) && +text(value) > 0 && +text(value) <= max ? +text(value) : null;

// Quoted commas, embedded newlines, escaped quotes, BOM and Handy's short final Settings column.
export function readHandyCsv(source: string): Record<string, string>[] {
  const records: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  for (let i = source.charCodeAt(0) === 0xfeff ? 1 : 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') { if (source[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === '"') { if (field || closed) return fail('CSV פגום'); quoted = true; }
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (c === '\r' && source[i + 1] === '\n') i++; records.push(row); row = []; }
    } else { if (closed) return fail('CSV פגום'); field += c; }
    if (field.length > 20000 || row.length > 30 || records.length > 20001) return fail('CSV גדול מדי');
  }
  if (quoted) return fail('CSV פגום');
  if (field || row.length || closed) { row.push(field); records.push(row); }
  const headers = records.shift();
  if (!headers || headers.join('\0') !== schema.csvHeaders.join('\0')) return fail('כותרות CSV אינן תואמות לקובץ המקורי');
  return records.map(values => {
    if (![29, 30].includes(values.length)) return fail('מספר שדות CSV אינו תואם');
    return Object.fromEntries(headers.map((key, index) => [key, values[index] ?? '']));
  });
}
export function writeHandyCsv(rows: Record<string, string>[]) {
  const line = (values: string[]) => values.map(value => '"' + value.replaceAll('"', '""') + '"').join(',');
  return line(schema.csvHeaders) + '\r\n' + rows.map(row => line(schema.csvHeaders.map(key => row[key] ?? ''))).join('\r\n') + (rows.length ? '\r\n' : '');
}
function query(database: Database, statement: string): Row[] {
  const result = database.exec(statement)[0];
  if (!result) return [];
  return result.values.map(values => Object.fromEntries(result.columns.map((column, index) => {
    const value = values[index]; if (value instanceof Uint8Array) return fail('שדה בינארי לא נתמך');
    return [column, value];
  })));
}
function dateDay(value: unknown): string | null {
  let source = text(value);
  if (source.startsWith('{')) { try { source = text(JSON.parse(source).date_string); } catch { return null; } }
  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(source);
  if (iso) source = `${iso[1]}-${iso[2].padStart(2, '0')}-${(iso[3] ?? '1').padStart(2, '0')}`;
  else { const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(source); if (us) source = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`; }
  return validDay(source) ? source : null;
}
const dateJson = (day: string | null) => day ? JSON.stringify({ date_string: day, timestamp: Date.parse(day + 'T00:00:00Z'), is_month_shown: true, is_day_shown: true, is_origin_month_shown: true, is_origin_day_shown: true }) : null;
const split = (value: unknown) => [...new Set(text(value).split(';').map(value => value.trim()).filter(Boolean))];
const rowKey = (title: unknown, copy: unknown) => JSON.stringify([text(title), +text(copy) || 0]);
function isbn(value: unknown) { try { return parseISBN(text(value)); } catch { return { isbn10: null, isbn13: null }; } }
function blankCore(): Core {
  return { books: [], copies: [], authors: [], settings: [{ key: 'libraryId', value: uuid() }, { key: 'libraryName', value: 'Handy Library' }, { key: 'displayMode', value: 'compact' }], images: [], shelves: [], bookShelves: [], series: [], genres: [], tags: [], people: [], loans: [], metadataSources: [], recognitionDrafts: [] };
}

export async function inspectHandyBackup(bytes: Uint8Array<ArrayBuffer>): Promise<HandyBackup> {
  const entries = await readHandyZip(bytes), csv = readHandyCsv(new TextDecoder('utf-8', { fatal: true }).decode(entries.get('HandyLib.csv')!));
  const SQL = await handySql(), database = new SQL.Database(entries.get('handy_book_library.db'));
  const core = blankCore(), now = new Date().toISOString(), warnings: string[] = [];
  try {
    const structures = query(database, "SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
    if (structures.length !== Object.keys(schema.tables).length || structures.some(row => row.type !== 'table' || !Object.hasOwn(schema.tables, text(row.name)))) return fail('מבנה מסד הנתונים אינו תואם');
    if (query(database, 'SELECT identity_hash FROM room_master_table WHERE id=42')[0]?.identity_hash !== schema.identityHash || query(database, 'PRAGMA user_version')[0]?.user_version !== schema.userVersion || query(database, 'PRAGMA integrity_check')[0]?.integrity_check !== 'ok') return fail('מסד הנתונים פגום או בגרסה אחרת');
    if (query(database, 'PRAGMA table_info(book_library)').map(row => row.name).join() !== schema.bookColumns.join()) return fail('עמודות מסד הנתונים אינן תואמות');
    const rows = query(database, 'SELECT * FROM book_library ORDER BY _id');
    if (rows.length > 20000 || rows.length !== csv.length) return fail('מספר הספרים ב־CSV ובמסד הנתונים אינו תואם');
    const csvByKey = new Map<string, Record<string, string>[]>();
    for (const row of csv) { const key = rowKey(row.Title, row['Copy Index']); csvByKey.set(key, [...csvByKey.get(key) ?? [], row]); }
    const images = new Map<string, StoredImage>();
    const imageFor = async (value: unknown, directory: string): Promise<string | null> => {
      const path = text(value).split('/').at(-1); if (!path) return null;
      const key = directory + '/' + path, bytes = entries.get(key); if (!bytes) return null;
      const existing = images.get(key); if (existing) return existing.id;
      const dimensions = jpegDimensions(bytes);
      if (!dimensions || Math.max(dimensions.width, dimensions.height) > 1200 || bytes.length > 1024 * 1024) return fail('ממדי תמונת המקור אינם נתמכים');
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const image = { id: uuid(), blob, mimeType: 'image/jpeg', ...dimensions, byteLength: bytes.length, sha256: await hashBytes(bytes.buffer), sourceUrl: null, createdAt: now };
      images.set(key, image); core.images.push(image); return image.id;
    };
    const named = (table: 'tags' | 'genres' | 'series', name: string) => {
      let item = core[table].find(item => item.normalizedName === normalizeText(name));
      if (!item) { item = { id: uuid(), name, normalizedName: normalizeText(name), ...(table === 'series' ? { collapsed: false } : {}) }; (core[table] as NamedItem[]).push(item); }
      return item.id;
    };
    if (Number(query(database, 'SELECT count(*) AS n FROM tag')[0]?.n) > 20000 || Number(query(database, 'SELECT count(*) AS n FROM title_tag')[0]?.n) > 20000 || query(database, 'PRAGMA foreign_key_check').length) return fail('שיוכי התגיות פגומים או גדולים מדי');
    const tagNames = new Map(query(database, 'SELECT id,name FROM tag').map(row => [Number(row.id), text(row.name)]));
    const tagLinks = query(database, 'SELECT titleId,tagId FROM title_tag');
    for (const row of rows) {
      const choices = csvByKey.get(rowKey(row.Title, row.Copy));
      let match = choices?.findIndex(item => !row.Author || split(item.Author).includes(text(row.Author)) || !!row.Author2 && split(item.Author).includes(text(row.Author2)));
      if (choices?.length && match === -1) match = choices.findIndex(item => !!item.ISBN && [row.ISBN, row.ISBN10].includes(item.ISBN));
      if (choices?.length && match === -1) match = 0;
      if (!choices?.length || match === undefined || match < 0) return fail('הספרים ב־CSV ובמסד הנתונים אינם תואמים');
      const csvRow = choices.splice(match, 1)[0];
      const id = uuid(), copyId = uuid(), createdAt = dateDay(csvRow['Added Date']) ? dateDay(csvRow['Added Date']) + 'T00:00:00.000Z' : now;
      const authorNames = split(csvRow.Author || [row.Author, row.Author2].filter(Boolean).join('; ')), authorIds: string[] = [];
      for (const displayName of authorNames) {
        let author = core.authors.find(author => author.displayName === displayName);
        if (!author) { author = { id: uuid(), displayName, givenName: null, familyName: null, normalizedName: normalizeText(displayName) }; core.authors.push(author); }
        authorIds.push(author.id);
      }
      const series = nullable(csvRow.Series || row.Series), day = dateDay(csvRow['Published Date'] || row.Published_Date);
      const originalISBN = csvRow.ISBN || row.ISBN || row.ISBN10, parsedISBN = isbn(originalISBN);
      if (originalISBN && !parsedISBN.isbn10 && !parsedISBN.isbn13) warnings.push('ISBN שאינו תקין נשמר בנתוני המקור בלבד.');
      const iconImageId = await imageFor(csvRow['Icon Path'] || row.Icon_Path, 'Icons');
      const photoImageId = await imageFor(csvRow['Photo Path'] || row.Photo_Path, 'Photos');
      const read = text(csvRow.Read || row.Read), rating = Number(csvRow.Rating || row.Rating);
      const book: Book = { id, title: nullable(csvRow.Title), subtitle: nullable(row.SubTitle), authorIds, ...parsedISBN, danacode: null,
        publisher: nullable(csvRow.Publisher || row.Publisher), publicationYear: day ? +day.slice(0, 4) : positive(csvRow['Published Date'], 9999), publicationDate: day,
        edition: nullable(row.Edition), binding: nullable(csvRow.Format), volume: nullable(csvRow.Volume || row.Volume), language: nullable(csvRow.Language || row.Language), pages: positive(csvRow.Pages || row.Pages_Number, 100000),
        seriesId: series ? named('series', series) : null, seriesNumber: series ? positive(csvRow.Volume || row.Volume, 1000000) : null,
        genreIds: split(csvRow.Genres || row.Category).map(name => named('genres', name)), tagIds: [...new Set([...split(csvRow.Tags), ...tagLinks.filter(link => link.titleId === row._id).map(link => tagNames.get(Number(link.tagId)) ?? '').filter(Boolean)])].map(name => named('tags', name)),
        rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
        readStatus: +text(row.Wish) === 1 ? 'want-to-read' : ['1', 'Yes', 'true', 'Read'].includes(read) ? 'read' : +text(row.Status) === 1 ? 'reading' : 'unread',
        personalNotes: nullable(csvRow.Comments || row.Comment), primaryImageId: iconImageId || photoImageId, createdAt, updatedAt: now, revision: 1, titleSortKey: normalizeText(csvRow.Title) };
      core.books.push(book);
      const price = csvRow.Price || row.Price, minor = price === null || text(price) === '' ? null : Math.round(Number(price) * 100);
      const copy: Copy = { id: copyId, bookId: id, label: positive(csvRow['Copy Index'], 1000000) ? csvRow['Copy Index'] : null,
        purchasePriceMinor: minor !== null && Number.isInteger(minor) && minor >= 0 && minor <= 100000000 ? minor : null, currency: nullable(row.Currency), notes: null,
        archivedAt: dateDay(row.Deleted_At) ? dateDay(row.Deleted_At) + 'T00:00:00.000Z' : null, createdAt, updatedAt: now,
        handyLibrary: { row, csv: csvRow, iconImageId, photoImageId } };
      core.copies.push(copy);
      for (const name of split(csvRow.BookShelf || row.Location)) {
        let shelf = core.shelves.find(shelf => shelf.name === name);
        if (!shelf) { shelf = { id: uuid(), name, parentId: null, imageId: null, sortOrder: core.shelves.length, createdAt: now, updatedAt: now }; core.shelves.push(shelf); }
        core.bookShelves.push({ id: uuid(), bookId: id, shelfId: shelf.id });
      }
      if (+text(row.Lend_or_Borrow) === 1 && row.Person && !copy.archivedAt) {
        const borrowed = dateDay(row.Start_Date);
        if (borrowed) {
          let person = core.people.find(person => person.name === row.Person);
          if (!person) { person = { id: uuid(), name: text(row.Person), normalizedName: normalizeText(text(row.Person)), archivedAt: null }; core.people.push(person); }
          const returned = dateDay(row.Returned_Date || row.Return_Date);
          core.loans.push({ id: uuid(), copyId, personId: person.id, borrowedAt: borrowed + 'T12:00:00.000Z', expectedReturnOn: dateDay(row.Due_Date), returnedAt: returned ? returned + 'T12:00:00.000Z' : null, openFlag: returned ? 0 : 1, notes: null, createdAt: now, updatedAt: now });
        } else warnings.push('השאלה ללא תאריך תקין נשמרה בנתוני המקור בלבד.');
      }
    }
    return { backup: await validateBackup(JSON.stringify(await envelope(core))), sourceRows: rows.length, warnings: [...new Set(warnings)] };
  } finally { database.close(); }
}

function bookIdentity(core: Core, book: Book) {
  const names = book.authorIds.map(id => normalizeText(core.authors.find(author => author.id === id)?.displayName ?? '')).sort();
  // Title alone does not establish identity. ISBN-10 and ISBN-13 are comparable.
  return { isbn: comparableISBN(book), title: book.title ? JSON.stringify([normalizeText(book.title), names, book.volume ?? '', book.edition ?? '']) : null };
}
export function mergeHandyCore(current: Core, incoming: Core) {
  const merged = structuredClone(current), identities = current.books.map(book => bookIdentity(current, book));
  const skipped = new Set<string>();
  for (const book of incoming.books) {
    const key = bookIdentity(incoming, book);
    if (identities.some(other => key.isbn && other.isbn ? key.isbn === other.isbn : !!key.title && key.title === other.title)) skipped.add(book.id);
    // Keep intentional copies within a single source archive; only skip matches already in the target.
  }
  const kept = new Set(incoming.books.filter(book => !skipped.has(book.id)).map(book => book.id));
  const additions = structuredClone(incoming);
  additions.books = additions.books.filter(book => kept.has(book.id));
  additions.copies = additions.copies.filter(copy => kept.has(copy.bookId));
  const copyIds = new Set(additions.copies.map(copy => copy.id));
  additions.loans = additions.loans.filter(loan => copyIds.has(loan.copyId));
  additions.bookShelves = additions.bookShelves.filter(link => kept.has(link.bookId));
  const authors = new Set(additions.books.flatMap(book => book.authorIds)), people = new Set(additions.loans.map(loan => loan.personId));
  additions.authors = additions.authors.filter(author => authors.has(author.id)); additions.people = additions.people.filter(person => people.has(person.id));
  const imageIds = new Set(additions.books.flatMap(book => book.primaryImageId ? [book.primaryImageId] : []));
  for (const copy of additions.copies) for (const id of [copy.handyLibrary?.iconImageId, copy.handyLibrary?.photoImageId]) if (id) imageIds.add(id);
  additions.images = additions.images.filter(image => imageIds.has(image.id));
  for (const table of ['genres', 'tags', 'series', 'shelves'] as const) {
    const used = new Set(table === 'shelves' ? additions.bookShelves.map(link => link.shelfId) : table === 'series' ? additions.books.flatMap(book => book.seriesId ? [book.seriesId] : []) : additions.books.flatMap(book => table === 'tags' ? book.tagIds : book.genreIds));
    const mapping = new Map<string, string>();
    const keptRows = additions[table].filter(row => used.has(row.id)).filter(row => {
      const existing = merged[table].find(other => normalizeText(other.name) === normalizeText(row.name));
      if (existing) { mapping.set(row.id, existing.id); return false; } return true;
    });
    Object.assign(additions, { [table]: keptRows });
    for (const book of additions.books) {
      if (table === 'series' && book.seriesId) book.seriesId = mapping.get(book.seriesId) ?? book.seriesId;
      if (table === 'tags') book.tagIds = book.tagIds.map(id => mapping.get(id) ?? id);
      if (table === 'genres') book.genreIds = book.genreIds.map(id => mapping.get(id) ?? id);
    }
    if (table === 'shelves') for (const link of additions.bookShelves) link.shelfId = mapping.get(link.shelfId) ?? link.shelfId;
  }
  for (const table of coreKeys) if (table !== 'settings') Object.assign(merged, { [table]: [...merged[table], ...additions[table]] });
  return { data: merged, added: additions.books.length, skipped: skipped.size };
}
export async function importHandyBackup(database: LibraryDatabase, incoming: HandyBackup, mode: 'merge' | 'replace', fingerprint: string) {
  const checked = await validateBackup(JSON.stringify(await envelope(incoming.backup.data)));
  const current = await database.transaction('r', database.tables, () => readCore(database));
  if (canonical(current) !== fingerprint) return fail('הספרייה השתנתה מאז הגיבוי המגן');
  const plan = mode === 'merge' ? mergeHandyCore(current, checked.data) : { data: { ...checked.data, settings: current.settings }, added: checked.data.books.length, skipped: 0 };
  const validated = await validateBackup(JSON.stringify(await envelope(plan.data)));
  await restoreSnapshot(database, validated, fingerprint);
  return { added: plan.added, skipped: plan.skipped };
}

export async function createHandyBackup(database: LibraryDatabase): Promise<Blob> {
  const core = await database.transaction('r', database.tables, () => readCore(database));
  // Verify all native references before producing another format.
  await validateBackup(JSON.stringify(await envelope(core)));
  const SQL = await handySql(), sqlite = new SQL.Database();
  const files: Record<string, Uint8Array<ArrayBuffer>> = {}, csvRows: Record<string, string>[] = [];
  let totalBytes = 0;
  const putFile = (name: string, bytes: Uint8Array<ArrayBuffer>) => {
    if (files[name]) return;
    if (Object.keys(files).length >= 20002) return fail('יותר מדי קבצים בגיבוי');
    totalBytes += bytes.length; if (totalBytes > MAX_BACKUP_BYTES) return fail('הגיבוי גדול מדי'); files[name] = bytes;
  };
  try {
    for (const statement of Object.values(schema.tables)) sqlite.run(statement);
    sqlite.run(`PRAGMA user_version = ${schema.userVersion}`);
    sqlite.run('INSERT INTO android_metadata(locale) VALUES (?)', ['he_IL']);
    sqlite.run('INSERT INTO room_master_table(id,identity_hash) VALUES (?,?)', [42, schema.identityHash]);
    const insert = sqlite.prepare(`INSERT INTO book_library (${schema.bookColumns.map(column => '`' + column + '`').join(',')}) VALUES (${schema.bookColumns.map(() => '?').join(',')})`);
    let index = 0;
    try {
      for (const copy of core.copies) {
        const book = core.books.find(book => book.id === copy.bookId)!;
        const original = copy.handyLibrary;
        const row: Row = Object.fromEntries(schema.bookColumns.map(column => [column, original?.row[column] ?? null]));
        const csv: Record<string, string> = Object.fromEntries(schema.csvHeaders.map(column => [column, original?.csv[column] ?? '']));
        const authors = book.authorIds.map(id => core.authors.find(author => author.id === id)!.displayName);
        const shelves = core.bookShelves.filter(link => link.bookId === book.id).map(link => core.shelves.find(shelf => shelf.id === link.shelfId)!.name).join('; ');
        const genres = book.genreIds.map(id => core.genres.find(item => item.id === id)!.name).join('; ');
        const tags = book.tagIds.map(id => core.tags.find(item => item.id === id)!.name).join('; ');
        const series = book.seriesId ? core.series.find(item => item.id === book.seriesId)!.name : '';
        const set = (column: string, csvColumn: string | null, value: string | number | null) => { row[column] = value; if (csvColumn) csv[csvColumn] = text(value); };
        row._id = ++index;
        set('Title', 'Title', book.title); set('SubTitle', null, book.subtitle); set('Author', 'Author', authors[0] ?? null); row.Author2 = authors[1] ?? null;
        csv.Author = authors.join('; ');
        // Preserve the contributor JSON when it represents the same imported list.
        if (!original || original.csv.Author !== csv.Author) row.Author3 = authors.length > 2 ? JSON.stringify({ contributors: authors.slice(2).map(name => ({ name, role: 'author', imageUrl: '', link: '' })) }) : null;
        if (book.isbn13 || book.isbn10 || !original) set('ISBN', 'ISBN', book.isbn13 || book.isbn10); row.ISBN10 = book.isbn10;
        set('Publisher', 'Publisher', book.publisher); set('Pages_Number', 'Pages', book.pages); set('Series', 'Series', series || null);
        set('Volume', 'Volume', book.volume ?? book.seriesNumber); set('Language', 'Language', book.language); set('Edition', null, book.edition);
        if (book.publicationDate) { row.Published_Date = dateJson(book.publicationDate); csv['Published Date'] = book.publicationDate; }
        else if (book.publicationYear) { row.Published_Date = dateJson(book.publicationYear + '-01-01'); csv['Published Date'] = String(book.publicationYear); }
        else if (!original || dateDay(original.csv['Published Date'] || original.row.Published_Date) || positive(original.csv['Published Date'], 9999)) { row.Published_Date = null; csv['Published Date'] = ''; }
        if (book.binding) csv.Format = book.binding;
        set('Category', 'Genres', genres || null); csv.Tags = tags; set('Location', 'BookShelf', shelves || null);
        set('Comment', 'Comments', book.personalNotes); set('Price', 'Price', copy.purchasePriceMinor === null ? null : copy.purchasePriceMinor / 100); row.Currency = copy.currency;
        row.Copy = copy.label && /^\d+$/.test(copy.label) ? +copy.label : 0; csv['Copy Index'] = row.Copy ? text(row.Copy) : '';
        row.Wish = book.readStatus === 'want-to-read' ? 1 : 0; row.Read = book.readStatus === 'read' ? 1 : 0; csv.Read = row.Read ? 'Yes' : '';
        // Decimal catalog ratings remain exact until a personal star rating is supplied.
        if (book.rating) set('Rating', 'Rating', String(book.rating));
        csv['Added Date'] ||= new Date(book.createdAt).toLocaleDateString('en-US', { timeZone: 'UTC' });
        if (index === 1) csv.Settings ||= `3.0.5;283;MM/DD/YYYY;YYYY-MM-DD;${new Date().toLocaleDateString('en-US', { timeZone: 'UTC' })}`; else csv.Settings = '';
        for (const [column, csvColumn, directory, originalId] of [['Icon_Path', 'Icon Path', 'Icons', original?.iconImageId], ['Photo_Path', 'Photo Path', 'Photos', original?.photoImageId]] as const) {
          const imageId = original && book.primaryImageId === (original.iconImageId || original.photoImageId) ? originalId : book.primaryImageId;
          const image = imageId ? core.images.find(image => image.id === imageId) : undefined;
          if (!image) { if (!original || book.primaryImageId !== (original.iconImageId || original.photoImageId)) set(column, csvColumn, null); continue; }
          const filename = `${image.id}.jpg`;
          putFile(`${directory}/${filename}`, new Uint8Array(await image.blob.arrayBuffer()));
          set(column, csvColumn, `/Pictures/${directory}/${filename}`);
        }
        const loan = core.loans.filter(loan => loan.copyId === copy.id).sort((a, b) => b.borrowedAt.localeCompare(a.borrowedAt))[0];
        if (loan) { row.Lend_or_Borrow = loan.returnedAt ? 0 : 1; row.Person = core.people.find(person => person.id === loan.personId)!.name; row.Start_Date = dateJson(loan.borrowedAt.slice(0, 10)); row.Due_Date = dateJson(loan.expectedReturnOn); row.Returned_Date = dateJson(loan.returnedAt?.slice(0, 10) ?? null); }
        insert.run(schema.bookColumns.map(column => row[column] as SqlValue));
        csvRows.push(csv);
        for (const tagId of book.tagIds) {
          const tagIndex = core.tags.findIndex(tag => tag.id === tagId) + 1;
          sqlite.run('INSERT INTO title_tag(titleId,tagId) VALUES (?,?)', [index, tagIndex]);
        }
      }
    } finally { insert.free(); }
    for (const [index, tag] of core.tags.entries()) sqlite.run('INSERT INTO tag(id,name,totalBooks,tagOrder) VALUES (?,?,?,?)', [index + 1, tag.name, core.books.filter(book => book.tagIds.includes(tag.id)).length, index]);
    putFile('handy_book_library.db', new Uint8Array(sqlite.export())); putFile('HandyLib.csv', strToU8(writeHandyCsv(csvRows)));
    const zipped = zipSync(files, { level: 6 });
    if (zipped.length > MAX_BACKUP_BYTES) return fail('הגיבוי גדול מדי');
    return new Blob([zipped], { type: 'application/zip' });
  } finally { sqlite.close(); }
}
export function downloadHandyBackup(blob: Blob) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `handy_library_backup_${new Date().toISOString().slice(0, 10)}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
