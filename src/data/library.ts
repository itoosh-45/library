import type { LibraryDatabase } from './database';
import type { Book, Copy, ReadStatus } from './models';

export class LibraryValidationError extends Error {}
export function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0591-\u05C7]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('he');
}
export async function renameLibrary(database: LibraryDatabase, name: string): Promise<void> {
  const value = name.trim();
  if (!value || value.length > 120) throw new LibraryValidationError('שם הספרייה צריך להכיל בין 1 ל־120 תווים.');
  await database.settings.put({ key: 'libraryName', value });
}
export interface NewBookInput { title?: string | null; authorIds?: string[]; readStatus?: ReadStatus }
export async function createBookWithCopy(database: LibraryDatabase, input: NewBookInput): Promise<{ book: Book; copy: Copy }> {
  if (input.title !== undefined && input.title !== null && typeof input.title !== 'string') throw new LibraryValidationError('שם ספר אינו תקין.');
  if (input.authorIds !== undefined && (!Array.isArray(input.authorIds) || input.authorIds.some(id => typeof id !== 'string' || !id))) throw new LibraryValidationError('רשימת המחברים אינה תקינה.');
  const title = input.title?.trim() || null;
  if (title && title.length > 1000) throw new LibraryValidationError('שם הספר ארוך מדי.');
  const authorIds = [...new Set(input.authorIds ?? [])];
  const readStatus = input.readStatus ?? 'unread';
  if (!['unread', 'reading', 'read', 'abandoned', 'want-to-read'].includes(readStatus)) throw new LibraryValidationError('מצב הקריאה אינו תקין.');
  const now = new Date().toISOString();
  const book: Book = {
    id: crypto.randomUUID(), title, subtitle: null, authorIds,
    isbn10: null, isbn13: null, danacode: null, publisher: null, publicationYear: null,
    edition: null, volume: null, language: null, pages: null, seriesId: null, seriesNumber: null,
    genreIds: [], tagIds: [], readStatus, personalNotes: null, primaryImageId: null,
    createdAt: now, updatedAt: now, revision: 1, titleSortKey: normalizeText(title ?? ''),
  };
  const copy: Copy = { id: crypto.randomUUID(), bookId: book.id, label: null, purchasePriceMinor: null, currency: null, notes: null, archivedAt: null, createdAt: now, updatedAt: now };
  await database.transaction('rw', database.books, database.copies, database.authors, async () => {
    const authors = await database.authors.bulkGet(authorIds);
    if (authors.some(author => !author)) throw new LibraryValidationError('מחבר שנבחר אינו קיים בספרייה.');
    await database.books.add(book);
    await database.copies.add(copy);
  });
  return { book, copy };
}
