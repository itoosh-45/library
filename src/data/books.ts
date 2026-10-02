import type { LibraryDatabase } from './database';
import type { Book, Copy, ReadStatus, StoredImage } from './models';
import { createBookWithCopy, LibraryValidationError, normalizeText } from './library';

export const readingStates: Record<ReadStatus, string> = { unread: 'טרם נקרא', reading: 'בקריאה', read: 'נקרא', abandoned: 'הופסק', 'want-to-read': 'רוצה לקרוא' };
export interface BookInput {
  title: string; subtitle: string; authors: string[]; readStatus: ReadStatus;
  isbn: string; danacode: string; publisher: string; publicationYear: string;
  edition: string; volume: string; language: string; pages: string; personalNotes: string;
}
export const emptyInput: BookInput = { title: '', subtitle: '', authors: [], readStatus: 'unread', isbn: '', danacode: '', publisher: '', publicationYear: '', edition: '', volume: '', language: '', pages: '', personalNotes: '' };
const fail = (message: string): never => { throw new LibraryValidationError(message); };
function optional(value: string, limit = 1000): string | null {
  if (typeof value !== 'string' || value.length > limit) return fail('אחד השדות ארוך מדי או אינו תקין.');
  return value.trim() || null;
}
function number(value: string, max: number): number | null {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value) || +value < 1 || +value > max) return fail('השנה ומספר העמודים צריכים להיות מספרים חיוביים בטווח תקין.');
  return +value;
}
export function parseISBN(value: string): { isbn10: string | null; isbn13: string | null } {
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  if (!code) return { isbn10: null, isbn13: null };
  const ten = /^\d{9}[\dX]$/.test(code) && [...code].reduce((sum, c, i) => sum + (c === 'X' ? 10 : +c) * (10 - i), 0) % 11 === 0;
  const thirteen = /^97[89]\d{10}$/.test(code) && [...code].reduce((sum, c, i) => sum + +c * (i % 2 ? 3 : 1), 0) % 10 === 0;
  if (!ten && !thirteen) return fail('מספר ISBN אינו תקין. בדוק את הספרות או השאר את השדה ריק.');
  return { isbn10: ten ? code : null, isbn13: thirteen ? code : null };
}
export function bookFields(input: BookInput) {
  if (typeof input.readStatus !== 'string' || !Object.hasOwn(readingStates, input.readStatus)) return fail('מצב הקריאה אינו תקין.');
  return { title: optional(input.title), subtitle: optional(input.subtitle), ...parseISBN(input.isbn), danacode: optional(input.danacode), publisher: optional(input.publisher), publicationYear: number(input.publicationYear, 9999), edition: optional(input.edition), volume: optional(input.volume), language: optional(input.language), pages: number(input.pages, 100000), personalNotes: optional(input.personalNotes, 20000), readStatus: input.readStatus, titleSortKey: normalizeText(input.title) };
}
function comparableISBN(book: Pick<Book, 'isbn10' | 'isbn13'>): string | null {
  if (book.isbn13) return book.isbn13;
  if (!book.isbn10) return null;
  const prefix = '978' + book.isbn10.slice(0, 9);
  const sum = [...prefix].reduce((n, c, i) => n + +c * (i % 2 ? 3 : 1), 0);
  return prefix + (10 - sum % 10) % 10;
}
export async function duplicateBooks(database: LibraryDatabase, input: BookInput, except?: string) {
  const isbn = comparableISBN(parseISBN(input.isbn));
  if (!isbn) return [];
  const books = await database.books.toArray();
  if (except && books.some(book => book.id === except && comparableISBN(book) === isbn)) return [];
  return books.filter(book => book.id !== except && comparableISBN(book) === isbn);
}
export async function saveBook(database: LibraryDatabase, input: BookInput, existing?: Book, image?: StoredImage | null, allowDuplicate = false): Promise<Book> {
  const fields = bookFields(input);
  if (!Array.isArray(input.authors) || input.authors.length > 30) return fail('רשימת המחברים אינה תקינה.');
  const names = [...new Set(input.authors.map(name => optional(name)).filter((name): name is string => !!name))];
  return database.transaction('rw', [database.books, database.copies, database.authors, database.images], async () => {
    const current = existing ? await database.books.get(existing.id) : undefined;
    if (existing && (!current || current.revision !== existing.revision)) return fail('הספר השתנה בחלון אחר. סגור ופתח אותו מחדש לפני העריכה.');
    if (!allowDuplicate && (await duplicateBooks(database, input, existing?.id)).length) return fail('ISBN זה כבר נמצא בספרייה. בחר כיצד להמשיך.');
    const authorIds: string[] = [];
    for (const name of names) {
      // Reuse only authors explicitly associated with the edited book. Names alone do not establish identity.
      const linked = current ? await database.authors.bulkGet(current.authorIds) : [];
      const author = linked.find(author => author?.displayName === name);
      const id = author?.id ?? crypto.randomUUID();
      if (!author) await database.authors.add({ id, displayName: name, givenName: null, familyName: null, normalizedName: normalizeText(name) });
      if (!authorIds.includes(id)) authorIds.push(id);
    }
    const base = current ?? (await createBookWithCopy(database, {})).book;
    if (image) await database.images.put(image);
    const book = { ...base, ...fields, authorIds, primaryImageId: image === undefined ? base.primaryImageId : image?.id ?? null, updatedAt: new Date().toISOString(), revision: current ? current.revision + 1 : 1 };
    await database.books.put(book);
    if (base.primaryImageId && book.primaryImageId !== base.primaryImageId && !(await database.books.toArray()).some(other => other.primaryImageId === base.primaryImageId)) await database.images.delete(base.primaryImageId);
    return book;
  });
}
export async function changeCopy(database: LibraryDatabase, bookId: string, revision: number, input: { id?: string; label?: string; notes?: string; price?: string; archive?: boolean }): Promise<Copy> {
  if (input.archive !== undefined && typeof input.archive !== 'boolean') return fail('מצב הארכוב אינו תקין.');
  const label = optional(input.label ?? ''), notes = optional(input.notes ?? '', 20000);
  const price = input.price?.trim() ?? '';
  if (price && (!/^\d+(\.\d{1,2})?$/.test(price) || +price > 1000000)) return fail('מחיר העותק אינו תקין.');
  return database.transaction('rw', [database.books, database.copies, database.loans], async () => {
    const book = await database.books.get(bookId);
    if (!book || book.revision !== revision) return fail('הספר השתנה. סגור ופתח אותו מחדש לפני השינוי.');
    const now = new Date().toISOString();
    const copy = input.id ? await database.copies.get(input.id) : { id: crypto.randomUUID(), bookId, label: null, notes: null, purchasePriceMinor: null, currency: null, archivedAt: null, createdAt: now, updatedAt: now };
    if (!copy || copy.bookId !== bookId) return fail('העותק אינו קיים בספר הזה.');
    if (input.archive && await database.loans.where('[copyId+openFlag]').equals([copy.id, 1]).count()) return fail('העותק מושאל כעת. יש לרשום את החזרתו לפני ארכוב.');
    const changed: Copy = { ...copy, label, notes, purchasePriceMinor: price ? Math.round(+price * 100) : null, currency: price ? 'ILS' : null, archivedAt: input.archive === undefined ? copy.archivedAt : input.archive ? now : null, updatedAt: now };
    await database.copies.put(changed);
    await database.books.update(book.id, { revision: book.revision + 1, updatedAt: now });
    return changed;
  });
}
