import { bookFields, emptyInput, parseISBN, readingStates } from './books';
import { envelope, validateBackup, type Core } from './backup';
import { fullEnvelope } from './backupFormat';
import { normalizeText } from './library';
import type { LibraryDatabase } from './database';
import type { ReadStatus } from './models';
import { simpleFields, type SimpleField } from './xlsxSchema';
import { sheetRows, workbookError, workbookRow, WorkbookValidationError, type ReadWorkbook, type WorkbookCandidate, type WorkbookIssue } from './xlsxWorkbook';
import { importId } from './xlsxIds';
export async function simpleWorkbookCandidate(database: LibraryDatabase, input: ReadWorkbook, mapping: Record<string, SimpleField>): Promise<WorkbookCandidate> {
  if (input.full) return workbookError('Manifest', 0, 'format', 'לקובץ מלא משתמשים במיפוי הקבוע');
  const mapped = Object.values(mapping);
  if (!mapped.length || mapped.some(field => !simpleFields.includes(field)) || Object.keys(mapping).some(header => !input.headers.includes(header)) || new Set(mapped).size !== mapped.length) return workbookError(input.sheet, 1, 'mapping', 'נדרש לפחות שדה אחד; אין למפות שתי עמודות לאותו שדה');
  const namespace = `xlsx-simple-v1/${input.fingerprint}/${input.sheet}`, libraryId = await importId(namespace);
  const targetLibrary = (await database.settings.get('libraryId'))!.value;
  const existingBooks = new Map((await database.books.toArray()).map(book => [book.id, book]));
  const importedAt = new Date().toISOString();
  const core: Core = { books: [], copies: [], authors: [], shelves: [], bookShelves: [], series: [], genres: [], tags: [], people: [], loans: [], metadataSources: [], recognitionDrafts: [], images: [], settings: [{ key: 'libraryId', value: libraryId }, { key: 'libraryName', value: 'ייבוא קובץ ספרים' }, { key: 'displayMode', value: 'compact' }] };
  const rows = sheetRows(input.workbook, input.sheet), issues: WorkbookIssue[] = [];
  for (const [index, row] of rows.entries()) {
    const value = (field: SimpleField) => String(row[Object.keys(mapping).find(key => mapping[key] === field) ?? ''] ?? '').trim();
    let column: SimpleField = 'title';
    try {
      const current = { ...emptyInput };
      for (const key of ['title','subtitle','danacode','publisher','publicationYear','edition','volume','language','pages','personalNotes'] as const) {
        column = key; current[key] = value(key);
        if (current[key].length > (key === 'personalNotes' ? 20000 : 1000)) return workbookError(input.sheet, workbookRow(row, index), key, 'טקסט ארוך מדי');
        if (['pages','publicationYear'].includes(key) && current[key] && (!/^\d+$/.test(current[key]) || +current[key] < 1 || +current[key] > (key === 'pages' ? 100000 : 9999))) return workbookError(input.sheet, workbookRow(row, index), key, 'מספר חיובי מחוץ לטווח');
      }
      for (const field of ['isbn', 'danacode'] as const) {
        const header = Object.keys(mapping).find(key => mapping[key] === field);
        if (header && row[header] !== null && typeof row[header] !== 'string') return workbookError(input.sheet, workbookRow(row, index), field, 'מזהים חייבים להיות תאי טקסט; אין להסיק אפסים שנעלמו');
      }
      column = 'isbn'; current.isbn = value('isbn'); parseISBN(current.isbn);
      column = 'readStatus'; const status = value('readStatus');
      const state = Object.entries(readingStates).find(([key, label]) => key === status || label === status)?.[0];
      if (status && !state) return workbookError(input.sheet, workbookRow(row, index), column, 'מצב קריאה לא מוכר');
      current.readStatus = (state ?? 'unread') as ReadStatus;
      column = 'authors'; const names = value('authors').split(';').map(name => name.trim()).filter(Boolean);
      if (names.length > 100 || names.some(name => name.length > 1000 || !normalizeText(name))) return workbookError(input.sheet, workbookRow(row, index), column, 'רשימת מחברים אינה תקינה');
      column = 'copies'; const quantity = value('copies') || '1';
      if (!/^\d+$/.test(quantity) || +quantity < 1 || +quantity > 100 || core.copies.length + +quantity > 20000) return workbookError(input.sheet, workbookRow(row, index), column, 'כמות עותקים: 1–100 לשורה, עד 20,000 בקובץ');
      column = 'purchasePrice'; const price = value('purchasePrice');
      if (price && (!/^\d+(?:\.\d{1,2})?$/.test(price) || +price > 1000000)) return workbookError(input.sheet, workbookRow(row, index), column, 'מחיר אינו תקין');
      column = 'currency'; const currency = value('currency') || (price ? 'ILS' : '');
      if (currency && !/^[A-Z]{3}$/.test(currency)) return workbookError(input.sheet, workbookRow(row, index), column, 'נדרש קוד מטבע בן שלוש אותיות גדולות');
      column = 'copyNotes'; const copyNotes = value('copyNotes'); if (copyNotes.length > 20000) return workbookError(input.sheet, workbookRow(row, index), column, 'טקסט ארוך מדי');
      const id = await importId(namespace + `/book/${index}`);
      const mappedId = await importId(JSON.stringify(['library-merge-v1', targetLibrary, libraryId, 'books', id]));
      const existing = existingBooks.get(mappedId);
      column = 'createdAt'; const date = value('createdAt'), createdAt = date ? (/^\d{4}-\d\d-\d\d$/.test(date) ? date + 'T00:00:00.000Z' : date) : existing?.createdAt ?? importedAt;
      if (!Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) return workbookError(input.sheet, workbookRow(row, index), column, 'תאריך חייב להיות YYYY-MM-DD או ISO UTC מלא');
      const updatedAt = date ? createdAt : existing?.updatedAt ?? importedAt, authorIds: string[] = [];
      for (const [position, displayName] of names.entries()) { const authorId = await importId(namespace + `/author/${index}/${position}`); authorIds.push(authorId); core.authors.push({ id: authorId, displayName, givenName: null, familyName: null, normalizedName: normalizeText(displayName) }); }
      core.books.push({ id, ...bookFields(current), authorIds, tagIds: [], genreIds: [], seriesId: null, seriesNumber: null, primaryImageId: null, createdAt, updatedAt, revision: 1 });
      for (let copy = 0; copy < +quantity; copy++) core.copies.push({ id: await importId(namespace + `/copy/${index}/${copy}`), bookId: id, label: null, notes: copyNotes || null, purchasePriceMinor: price ? Math.round(+price * 100) : null, currency: currency || null, archivedAt: null, createdAt, updatedAt });
    } catch (error) {
      if (error instanceof WorkbookValidationError) issues.push(...error.issues);
      else issues.push({ sheet: input.sheet, row: workbookRow(row, index), column, message: error instanceof Error ? error.message : 'נתון אינו תקין' });
    }
  }
  if (issues.length) throw new WorkbookValidationError(issues);
  const backup = await validateBackup(JSON.stringify(fullEnvelope(await envelope(core))));
  return { backup, missingImages: 0, warnings: ['קובץ פשוט מיובא כספרים נפרדים במיזוג. ללא תאריך מקור נרשם מועד הייבוא הראשון; מידע ספר חסר נשאר ריק.', 'הפרדת מחברים באמצעות ;. אין תמונות, אוספים או היסטוריית השאלה בקובץ פשוט.'] };
}
