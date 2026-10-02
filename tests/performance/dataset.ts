import { createHash } from 'node:crypto';
import type { Author, Book, BookShelf, Copy, Loan, Person, Series, Shelf } from '../../src/data/models';

const now = '2026-01-01T12:00:00.000Z';
const id = (kind: number, index: number) => `${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const normalized = (value: string) => value.normalize('NFKD').replace(/[\u0591-\u05C7]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('he');
export interface SyntheticImage { base64: string; width: number; height: number; byteLength: number; sha256: string }
export function benchmarkDataset(count: 1000 | 5000, image: SyntheticImage) {
  const authors: Author[] = Array.from({ length: 100 }, (_, i) => ({ id: id(2, i), displayName: `מחבר סינתטי ${i}`, givenName: null, familyName: null, normalizedName: `מחבר סינתטי ${i}` }));
  const series: Series[] = [{ id: id(3, 0), name: 'סדרת עומס סינתטית', normalizedName: 'סדרת עומס סינתטית', collapsed: false }];
  const shelves: Shelf[] = Array.from({ length: 150 }, (_, i) => ({ id: id(4, i), name: `מדף סינתטי ${i}`, parentId: i === 0 ? null : id(4, i - 1), imageId: null, sortOrder: i, createdAt: now, updatedAt: now }));
  const tags = Array.from({ length: 20 }, (_, i) => ({ id: id(5, i), name: `תגית סינתטית ${i}`, normalizedName: `תגית סינתטית ${i}` }));
  const genres = [{ id: id(6, 0), name: 'ז׳אנר סינתטי', normalizedName: 'ז׳אנר סינתטי' }];
  const letters = [...'אבגדהוזחטיכלמנסעפצקרשת'];
  const books: Book[] = Array.from({ length: count }, (_, i) => {
    const title = `${letters[i % letters.length]} ספר סינתטי ${String(i).padStart(5, '0')}`;
    return { id: id(1, i), title, subtitle: null, authorIds: [authors[i % authors.length].id], isbn10: null, isbn13: null,
      danacode: `00${String(i).padStart(7, '0')}`, publisher: `הוצאה ${i % 12}`, publicationYear: 1980 + i % 45, edition: null,
      volume: null, language: 'עברית', pages: 100 + i % 400, seriesId: i < 200 ? series[0].id : null,
      seriesNumber: i < 200 ? i + 1 : null, genreIds: [genres[0].id], tagIds: [tags[i % tags.length].id],
      readStatus: (['unread', 'reading', 'read', 'abandoned', 'want-to-read'] as const)[i % 5], personalNotes: `רשמים סינתטיים ${i}`,
      primaryImageId: id(8, i), createdAt: now, updatedAt: now, revision: 1, titleSortKey: normalized(title) };
  });
  const copies: Copy[] = Array.from({ length: count === 5000 ? 8000 : 1600 }, (_, i) => ({ id: id(7, i), bookId: books[i % count].id,
    label: `עותק סינתטי ${i}`, purchasePriceMinor: 2000 + i % 8000, currency: 'ILS', notes: null, archivedAt: null, createdAt: now, updatedAt: now }));
  const people: Person[] = Array.from({ length: 100 }, (_, i) => ({ id: id(9, i), name: `קורא סינתטי ${i}`, normalizedName: `קורא סינתטי ${i}`, archivedAt: null }));
  const loans: Loan[] = Array.from({ length: count === 5000 ? 10000 : 2000 }, (_, i) => {
    const round = Math.floor(i / copies.length), borrowedAt = new Date(Date.UTC(2024, 0, 1 + round * 3, 12)).toISOString();
    return { id: id(10, i), copyId: copies[i % copies.length].id, personId: people[i % people.length].id, borrowedAt,
      expectedReturnOn: null, returnedAt: new Date(Date.parse(borrowedAt) + 86400000).toISOString(), openFlag: 0,
      notes: null, createdAt: borrowedAt, updatedAt: new Date(Date.parse(borrowedAt) + 86400000).toISOString() };
  });
  for (let i = 0; i < 50; i++) loans.push({ id: id(11, i), copyId: copies[i].id, personId: people[i].id, borrowedAt: now,
    expectedReturnOn: '2026-02-01', returnedAt: null, openFlag: 1, notes: null, createdAt: now, updatedAt: now });
  const bookShelves: BookShelf[] = books.map((book, i) => ({ id: id(12, i), bookId: book.id, shelfId: shelves[i % shelves.length].id }));
  const images = books.map((_book, i) => ({ id: id(8, i), ...image, mimeType: 'image/jpeg', sourceUrl: null, createdAt: now }));
  const data = { books, copies, authors, settings: [
    { key: 'libraryId', value: id(13, count) }, { key: 'libraryName', value: `נתוני בדיקה בלבד — ${count}` }, { key: 'displayMode', value: 'compact' },
  ], images, shelves, bookShelves, series, genres, tags, people, loans, metadataSources: [], recognitionDrafts: [] };
  return JSON.stringify({ format: 'personal-library-basic', version: 7, schemaVersion: 2, appVersion: '0.11.0', libraryId: id(13, count),
    exportedAt: now, counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])),
    checksum: createHash('sha256').update(JSON.stringify(data)).digest('hex'), data });
}
