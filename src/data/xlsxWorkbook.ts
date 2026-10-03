import * as XLSX from 'xlsx';
import { canonical, envelope, readCore, validateBackup, type Core, type ValidatedBackup } from './backup';
import { fullEnvelope } from './backupFormat';
import type { LibraryDatabase } from './database';
import { LibraryValidationError, normalizeText } from './library';
import { guardXlsxZip, XLSX_LIMITS } from './xlsxZip';
import { manifestColumns, workbookSchema, type ColumnType } from './xlsxSchema';
import { importId } from './xlsxIds';
import { parseISBN, readingStates } from './books';
import { safeSourceUrl, validateMetadataSource } from './metadata';

type Row = Record<string, unknown>;
const sourceRows = new WeakMap<object, number>();
export const workbookRow = (row: object, index: number) => sourceRows.get(row) ?? index + 2;
export interface WorkbookIssue { sheet: string; row: number; column: string; message: string }
export class WorkbookValidationError extends LibraryValidationError {
  issues: WorkbookIssue[];
  constructor(issues: WorkbookIssue[]) { super(issues.map(issue => `${issue.sheet}:${issue.row || '—'}:${issue.column} — ${issue.message}`).join('\n')); this.issues = issues; }
}
export interface ReadWorkbook { workbook: XLSX.WorkBook; fingerprint: string; full: boolean; sheet: string; headers: string[] }
export interface WorkbookCandidate { backup: ValidatedBackup; warnings: string[]; missingImages: number }
export function workbookError(sheet: string, row: number, column: string, message: string): never { throw new WorkbookValidationError([{ sheet, row, column, message }]); }

function addSheet(workbook: XLSX.WorkBook, name: string, headers: string[], rows: Row[], types?: Record<string, ColumnType>) {
  if (rows.length > XLSX_LIMITS.rows || headers.length > XLSX_LIMITS.columns) return workbookError(name, 0, 'range', 'הנתונים חורגים ממגבלת גיליון Excel; השתמש בגיבוי JSON');
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  rows.forEach((row, index) => headers.forEach((key, column) => {
    const value = row[key]; if (value === null || value === undefined) return;
    const type = types?.[key];
    sheet[XLSX.utils.encode_cell({ r: index + 1, c: column })] = type === 'number' ? { t: 'n', v: value as number } : type === 'boolean' ? { t: 'b', v: value as boolean } : { t: 's', v: type === 'json' ? JSON.stringify(value) : String(value) };
  }));
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } });
  sheet['!cols'] = headers.map(key => ({ wch: ['personalNotes', 'notes', 'value', 'fieldValues'].includes(key) ? 45 : /id|At|sha256/i.test(key) ? 38 : 24 }));
  sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}
export function fullWorkbook(core: Core): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const manifest: Row[] = [
    { key: 'format', value: 'my-library-xlsx' }, { key: 'templateVersion', value: '1' }, { key: 'dbSchemaVersion', value: '2' },
    { key: 'libraryId', value: core.settings.find(row => row.key === 'libraryId')!.value }, { key: 'exportedAt', value: new Date().toISOString() },
    { key: 'instructions', value: 'שורה 1 היא כותרת; אין לשנות IDs וקשרים ללא התאמה בכל הגיליונות. ריק משמעו null. תאריכים הם ISO; מחיר ביחידות קטנות. אין נוסחאות.' },
    { key: 'images', value: 'ImageRefs הם הפניות בלבד, ללא קובצי תמונה. JSON הוא הגיבוי המלא. טיוטות צילום מדף אינן נכללות.' },
  ];
  for (const [name, schema] of Object.entries(workbookSchema)) for (const [column, type] of Object.entries(schema.columns)) manifest.push({ sheet: name, column, type,
    value: column === 'purchasePriceMinor' ? 'מחיר ביחידות קטנות של המטבע: 100 = יחידה אחת' : column === 'position' ? 'מיקום בקשר, החל מ־0 ברצף' : /At$/.test(column) ? 'תאריך ISO בטקסט; ריק רק כשמותר לפי השדה' : type === 'json' ? 'JSON מובנה לפי הסכמה; ללא תוצאות ספק גולמיות' : type === 'text' ? 'תא טקסט, מזהים ואפסים נשמרים כפי שהם' : type === 'boolean' ? 'TRUE/FALSE מסוג בוליאני' : 'מספר לפי טווח השדה',
    editable: !/^(id|.*Id|key|revision|normalizedName|titleSortKey|createdAt|updatedAt|sha256)$/.test(column) ? 'yes' : 'no' });
  addSheet(workbook, 'Manifest', manifestColumns, manifest);
  for (const [name, schema] of Object.entries(workbookSchema)) {
    let rows: Row[];
    if (['BookAuthors', 'BookGenres', 'BookTags'].includes(name)) {
      const key = name === 'BookAuthors' ? 'authorIds' : name === 'BookGenres' ? 'genreIds' : 'tagIds';
      const ref = name === 'BookAuthors' ? 'authorId' : name === 'BookGenres' ? 'genreId' : 'tagId';
      rows = core.books.flatMap(book => book[key].map((id, position) => ({ bookId: book.id, [ref]: id, position })));
    } else if (name === 'ImageRefs') rows = core.images.map(image => ({ id: image.id, sha256: image.sha256, sourceUrl: image.sourceUrl }));
    else rows = core[schema.table as keyof Core] as unknown as Row[];
    addSheet(workbook, name, Object.keys(schema.columns), rows, schema.columns);
  }
  return workbook;
}
export function simpleWorkbook(): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  addSheet(workbook, 'Books', ['שם הספר', 'מחברים', 'isbn', 'דאנאקוד', 'עותקים', 'הערות', 'מחיר', 'מטבע', 'תאריך'], [
    { 'שם הספר': 'דוגמה בלבד — מחקו שורה זו', 'מחברים': "שרה לוי; א׳ כהן", isbn: '0306406152', 'דאנאקוד': '0000123', 'עותקים': 3, 'הערות': '=טקסט לדוגמה, אינו נוסחה', 'מחיר': 0, 'מטבע': 'ILS', 'תאריך': '2026-10-03T00:00:00.000Z' },
  ], { 'עותקים': 'number', 'מחיר': 'number' });
  return workbook;
}
export function writeWorkbook(workbook: XLSX.WorkBook): Uint8Array<ArrayBuffer> {
  let cells = 0;
  for (const [name, sheet] of Object.entries(workbook.Sheets)) {
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    if (range.e.r > XLSX_LIMITS.rows || range.e.c >= XLSX_LIMITS.columns) return workbookError(name, 0, 'range', 'יותר מדי שורות או עמודות');
    cells += Object.keys(sheet).filter(key => !key.startsWith('!')).length;
  }
  if (cells > XLSX_LIMITS.cells) return workbookError('Workbook', 0, 'cells', 'יותר מדי תאים; השתמש בגיבוי JSON');
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, bookSST: false }));
  if (bytes.length > XLSX_LIMITS.file) return workbookError('Workbook', 0, 'file', 'היצוא גדול מ־10MiB; השתמש בגיבוי JSON');
  return bytes;
}
export function downloadWorkbook(bytes: Uint8Array<ArrayBuffer>, prefix: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${prefix}.xlsx`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportWorkbook(database: LibraryDatabase) {
  const core = await database.transaction('r', database.tables, () => readCore(database));
  // Excel exports references, so never encode image Blobs merely to validate the tabular whitelist.
  const imageIds = new Set(core.images.map(image => image.id));
  for (const image of core.images) if (!/^[a-f\d]{64}$/i.test(image.sha256) || !safeSourceUrl(image.sourceUrl)) return workbookError('ImageRefs', 0, 'sha256/sourceUrl', 'הפניית תמונה אינה תקינה');
  if (core.books.some(book => book.primaryImageId && !imageIds.has(book.primaryImageId)) || core.shelves.some(shelf => shelf.imageId && !imageIds.has(shelf.imageId))) return workbookError('ImageRefs', 0, 'id', 'קשר תמונה אינו תקין');
  const tabular: Core = { ...core, images: [], recognitionDrafts: [], books: core.books.map(book => ({ ...book, primaryImageId: null })), shelves: core.shelves.map(shelf => ({ ...shelf, imageId: null })) };
  await validateBackup(JSON.stringify(fullEnvelope(await envelope(tabular))));
  const bytes = writeWorkbook(fullWorkbook(core)); await guardXlsxZip(bytes);
  return { bytes, fingerprint: canonical(core) };
}
export async function readWorkbook(bytes: Uint8Array<ArrayBuffer>): Promise<ReadWorkbook> {
  await guardXlsxZip(bytes);
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(bytes, { type: 'array', cellFormula: true, cellHTML: false, cellNF: false, cellText: false, cellDates: false, bookVBA: false, sheetRows: XLSX_LIMITS.rows + 2 }); }
  catch { return workbookError('Workbook', 0, 'file', 'לא ניתן לפענח XLSX'); }
  const full = workbook.SheetNames.includes('Manifest');
  const expected = ['Manifest', ...Object.keys(workbookSchema)];
  if (full ? workbook.SheetNames.length !== expected.length || workbook.SheetNames.some(name => !expected.includes(name)) : workbook.SheetNames.length !== 1) return workbookError('Workbook', 0, 'sheets', 'גיליונות חסרים או לא מוכרים');
  let cells = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name], range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    if (range.e.r > XLSX_LIMITS.rows || range.e.c >= XLSX_LIMITS.columns) return workbookError(name, 0, 'range', 'יותר מדי שורות או עמודות');
    for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith('!')) {
      if (++cells > XLSX_LIMITS.cells) return workbookError(name, 0, 'cells', 'יותר מדי תאים');
      if (cell.f || cell.F || ['e', 'd'].includes(cell.t) || cell.l) { const point = XLSX.utils.decode_cell(address); return workbookError(name, point.r + 1, XLSX.utils.encode_col(point.c), 'נדרשים ערכים בלבד, ללא נוסחה, שגיאה או קישור פעיל'); }
    }
  }
  const sheet = full ? 'Books' : workbook.SheetNames[0];
  const headers = headerRow(workbook, sheet);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return { workbook, full, sheet, headers, fingerprint: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
}
export function headerRow(workbook: XLSX.WorkBook, name: string): string[] {
  const sheet = workbook.Sheets[name], range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  const headers = Array.from({ length: range.e.c + 1 }, (_, c) => { const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })]; return cell?.t === 's' ? String(cell.v).trim() : ''; });
  if (headers.some(header => !header) || new Set(headers).size !== headers.length) return workbookError(name, 1, 'headers', 'כותרת חסרה או כפולה');
  return headers;
}
export function sheetRows(workbook: XLSX.WorkBook, name: string, types?: Record<string, ColumnType>): Row[] {
  const headers = headerRow(workbook, name), sheet = workbook.Sheets[name], range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
  if (types && (headers.length !== Object.keys(types).length || headers.some(key => !Object.hasOwn(types, key)))) return workbookError(name, 1, 'headers', 'עמודות חסרות או לא מוכרות');
  const rows: Row[] = [];
  for (let r = 1; r <= range.e.r; r++) {
    if (headers.every((_, c) => sheet[XLSX.utils.encode_cell({ r, c })]?.v == null)) continue;
    const row: Row = {};
    headers.forEach((key, c) => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })], value = cell?.v ?? null, type = types?.[key];
      if (value !== null && type && ((type === 'number' && (cell.t !== 'n' || !Number.isFinite(value))) || (type === 'boolean' && cell.t !== 'b') || (['text', 'json'].includes(type) && cell.t !== 's'))) return workbookError(name, r + 1, key, `נדרש תא מסוג ${type}`);
      if (typeof value === 'string' && value.length > 200000) return workbookError(name, r + 1, key, 'תא ארוך מדי');
      if (type === 'json' && value !== null) { try { row[key] = JSON.parse(String(value)); } catch { return workbookError(name, r + 1, key, 'JSON אינו תקין'); } }
      else row[key] = value;
    });
    sourceRows.set(row, r + 1); rows.push(row);
  }
  return rows;
}
export async function fullWorkbookCandidate(database: LibraryDatabase, input: ReadWorkbook): Promise<WorkbookCandidate> {
  if (!input.full) return workbookError('Manifest', 0, 'format', 'זה אינו template מלא');
  const manifest = sheetRows(input.workbook, 'Manifest', Object.fromEntries(manifestColumns.map(key => [key, 'text'])));
  const values = new Map(manifest.filter(row => row.key !== null).map(row => [row.key, row.value]));
  if (values.get('format') !== 'my-library-xlsx' || values.get('templateVersion') !== '1' || values.get('dbSchemaVersion') !== '2') return workbookError('Manifest', 0, 'templateVersion', 'גרסת template אינה נתמכת');
  const tables = Object.fromEntries(Object.entries(workbookSchema).map(([name, schema]) => [schema.table, sheetRows(input.workbook, name, schema.columns)])) as Record<string, Row[]>;
  for (const [name, schema] of Object.entries(workbookSchema)) for (const [index, row] of tables[schema.table].entries()) for (const [key, value] of Object.entries(row)) {
    if (value !== null && /At$/.test(key) && (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value)))) return workbookError(name, workbookRow(row, index), key, 'תאריך ISO אינו תקין');
    if (value !== null && typeof value === 'string' && schema.columns[key] === 'text' && value.length > (['notes','personalNotes'].includes(key) ? 20000 : 1000)) return workbookError(name, workbookRow(row, index), key, 'טקסט ארוך מדי');
    if (name === 'Books' && value !== null && ['isbn10','isbn13'].includes(key)) { try { if (parseISBN(String(value))[key as 'isbn10' | 'isbn13'] !== value) throw new Error(); } catch { return workbookError(name, workbookRow(row, index), key, 'ISBN אינו תקין'); } }
    if (name === 'Books' && key === 'readStatus' && (typeof value !== 'string' || !Object.hasOwn(readingStates, value))) return workbookError(name, workbookRow(row, index), key, 'מצב קריאה אינו תקין');
    if (name === 'ImageRefs' && key === 'sha256' && (typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value))) return workbookError(name, workbookRow(row, index), key, 'hash אינו תקין');
    if (name === 'ImageRefs' && key === 'sourceUrl' && !safeSourceUrl(value)) return workbookError(name, workbookRow(row, index), key, 'כתובת מקור אינה מותרת');
  }
  const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
  for (const [name, schema] of Object.entries(workbookSchema)) if (Object.hasOwn(schema.columns, 'id')) {
    const ids = new Set<unknown>();
    tables[schema.table].forEach((row, index) => { if (typeof row.id !== 'string' || !uuid.test(row.id) || ids.has(row.id)) return workbookError(name, workbookRow(row, index), 'id', 'מזהה חסר, לא תקין או כפול'); ids.add(row.id); });
  }
  const books = new Map(tables.books.map(row => [row.id, row]));
  const join = (table: string, field: string, ref: string, target: string, sheet: string) => {
    for (const book of books.values()) book[field] = [];
    const groups = new Map<unknown, Row[]>(), ids = new Set(tables[target].map(row => row.id));
    tables[table].forEach((row, index) => {
      if (!books.has(row.bookId) || !ids.has(row[ref]) || typeof row.position !== 'number' || !Number.isInteger(row.position) || row.position < 0) return workbookError(sheet, workbookRow(row, index), ref, 'קשר או מיקום לא תקינים');
      groups.set(row.bookId, [...(groups.get(row.bookId) ?? []), row]);
    });
    for (const [bookId, rows] of groups) {
      rows.sort((a, b) => Number(a.position) - Number(b.position));
      if (rows.some((row, index) => row.position !== index) || new Set(rows.map(row => row[ref])).size !== rows.length) return workbookError(sheet, 0, 'position', 'קשר כפול או סדר שאינו רציף');
      books.get(bookId)![field] = rows.map(row => row[ref]);
    }
  };
  join('bookAuthors', 'authorIds', 'authorId', 'authors', 'BookAuthors'); join('bookGenres', 'genreIds', 'genreId', 'genres', 'BookGenres'); join('bookTags', 'tagIds', 'tagId', 'tags', 'BookTags');
  for (const [sheet, table, field, target] of [['Copies','copies','bookId','books'], ['BookShelves','bookShelves','bookId','books'], ['BookShelves','bookShelves','shelfId','shelves'], ['Shelves','shelves','parentId','shelves'], ['Books','books','seriesId','series'], ['Loans','loans','copyId','copies'], ['Loans','loans','personId','people'], ['MetadataSources','metadataSources','bookId','books']]) {
    const ids = new Set(tables[target].map(row => row.id));
    tables[table].forEach((row, index) => { if (row[field] !== null && !ids.has(row[field])) return workbookError(sheet, workbookRow(row, index), field, 'מזהה יעד אינו קיים'); });
  }
  for (const row of tables.books) row.titleSortKey = normalizeText(String(row.title ?? ''));
  for (const table of ['authors','genres','tags','series','people']) for (const row of tables[table]) row.normalizedName = normalizeText(String(row.displayName ?? row.name ?? ''));
  for (const [name, table] of [['Genres','genres'],['Tags','tags'],['Series','series']]) {
    const names = new Set<unknown>();
    tables[table].forEach((row, index) => { if (names.has(row.normalizedName)) return workbookError(name, workbookRow(row, index), 'name', 'שם אוסף כפול'); names.add(row.normalizedName); });
  }
  // Report graph errors at the responsible row before the canonical whole-library validation.
  const parents = new Map(tables.shelves.map(row => [row.id, row.parentId])), complete = new Set<unknown>();
  for (const [index, shelf] of tables.shelves.entries()) {
    const path = new Set<unknown>(); let id = shelf.id;
    while (id !== null && !complete.has(id)) {
      if (path.has(id)) return workbookError('Shelves', workbookRow(shelf, index), 'parentId', 'מעגל מדפים');
      path.add(id); id = parents.get(id) ?? null;
    }
    for (const visited of path) complete.add(visited);
  }
  const loanGroups = new Map<unknown, { row: Row; index: number; start: number; finish: number }[]>();
  tables.loans.forEach((row, index) => {
    const start = Date.parse(String(row.borrowedAt)), finish = row.returnedAt === null ? Infinity : Date.parse(String(row.returnedAt));
    if (!Number.isFinite(start) || Number.isNaN(finish) || finish < start) return workbookError('Loans', workbookRow(row, index), 'borrowedAt/returnedAt', 'תקופת השאלה לא תקינה');
    loanGroups.set(row.copyId, [...(loanGroups.get(row.copyId) ?? []), { row, index, start, finish }]);
  });
  for (const loans of loanGroups.values()) {
    loans.sort((a, b) => a.start - b.start);
    for (let index = 1; index < loans.length; index++) if (loans[index].start < loans[index - 1].finish) return workbookError('Loans', workbookRow(loans[index].row, loans[index].index), 'copyId/borrowedAt', 'השאלות חופפות לאותו עותק');
  }
  for (const [index, row] of tables.metadataSources.entries()) {
    if (row.recognition === null) delete row.recognition;
    let source; try { source = validateMetadataSource(row); } catch { return workbookError('MetadataSources', workbookRow(row, index), 'fieldValues/recognition', 'נתוני מקור אינם תקינים'); }
    const book = books.get(row.bookId)!;
    const names = new Map(tables.authors.map(author => [author.id, author.displayName]));
    for (const field of source.selectedFields) {
      const actual = field === 'authors' ? (book.authorIds as string[]).map(id => names.get(id)) : book[field];
      if (JSON.stringify(actual) !== JSON.stringify(source.fieldValues[field]) && !source.userOverriddenFields.includes(field)) source.userOverriddenFields.push(field);
    }
  }
  const references = new Map(tables.imageRefs.map(row => [row.id, row]));
  const existingImages = await database.images.toArray(), used = new Set<string>(); let missingImages = 0;
  for (const [sheet, table, field] of [['Books','books','primaryImageId'], ['Shelves','shelves','imageId']]) tables[table].forEach((row, index) => {
    if (row[field] === null) return;
    const ref = references.get(row[field]); if (!ref) return workbookError(sheet, workbookRow(row, index), field, 'הפניית תמונה אינה קיימת ב־ImageRefs');
    if (existingImages.some(image => image.id === row[field] && image.sha256 === ref.sha256)) used.add(String(row[field]));
    else { row[field] = null; missingImages++; }
  });
  const core = Object.fromEntries(['books','copies','authors','shelves','bookShelves','series','genres','tags','people','loans','metadataSources','settings'].map(key => [key, tables[key]])) as unknown as Core;
  core.recognitionDrafts = []; core.images = existingImages.filter(image => used.has(image.id));
  if (values.get('libraryId') !== core.settings.find(row => row.key === 'libraryId')?.value) return workbookError('Manifest', 0, 'libraryId', 'מזהה הספרייה אינו תואם להגדרות');
  // A book without a Copies row gets the first copy required by the template contract.
  for (const book of core.books) if (!core.copies.some(copy => copy.bookId === book.id)) core.copies.push({ id: await importId(`xlsx-first-copy-v1/${values.get('libraryId')}/${book.id}`), bookId: book.id, label: null, notes: null, purchasePriceMinor: null, currency: null, archivedAt: null, createdAt: book.createdAt, updatedAt: book.updatedAt });
  try { return { backup: await validateBackup(JSON.stringify(fullEnvelope(await envelope(core)))), missingImages, warnings: ['Excel אינו מכיל קובצי תמונה או טיוטות צילום מדף. JSON הוא גיבוי השחזור המלא.', ...(missingImages ? [`${missingImages} קשרי תמונה ללא קובץ מקומי תואם יוסרו מהנתונים המיובאים.`] : [])] }; }
  catch (error) { return workbookError('Workbook', 0, 'relationships', error instanceof Error ? error.message : 'נתוני הגיליונות אינם תקינים'); }
}
