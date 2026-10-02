import type { Author, Book, BookShelf, Copy, Loan, NamedItem, Shelf } from './models';
import { shelfBookIds } from './collections';

export const hebrewCollator = new Intl.Collator('he', { numeric: true, sensitivity: 'base' });
export function normalizeSearch(value: string): string {
  const finals: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' };
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('he')
    .replace(/[\u0591-\u05c7]/g, character => /[א-ת]/.test(character) ? character : '')
    .replace(/['"‘’“”׳״`]/g, '').replace(/[ךםןףץ]/g, character => finals[character])
    .replace(/\s+/gu, ' ').trim();
}
export const sortLabels = { added: 'תאריך הוספה', title: 'שם', author: 'מחבר', year: 'שנה', genre: 'ז׳אנר', pages: 'עמודים', price: 'מחיר' };
export type SortKey = keyof typeof sortLabels;
export interface LibraryFilters {
  query: string; shelfId: string; descendants: boolean; genreId: string; tagIds: string[];
  readStatus: string; availability: string; publisher: string; language: string; year: string;
}
export const emptyFilters: LibraryFilters = { query: '', shelfId: '', descendants: true, genreId: '', tagIds: [], readStatus: '', availability: '', publisher: '', language: '', year: '' };
export interface SearchData { books: Book[]; authors: Author[]; copies: Copy[]; tags: NamedItem[]; genres: NamedItem[]; shelves: Shelf[]; bookShelves: BookShelf[]; loans: Loan[] }
export function filterBooks(data: SearchData, filters: LibraryFilters, showArchived = false): Book[] {
  const authors = new Map(data.authors.map(item => [item.id, normalizeSearch(item.displayName)]));
  const tags = new Map(data.tags.map(item => [item.id, normalizeSearch(item.name)]));
  const active = new Set<string>(), available = new Set<string>();
  const borrowed = new Set(data.loans.filter(loan => loan.openFlag === 1).map(loan => loan.copyId));
  for (const copy of data.copies) if (!copy.archivedAt) { active.add(copy.bookId); if (!borrowed.has(copy.id)) available.add(copy.bookId); }
  const shelfIds = filters.shelfId ? shelfBookIds(data.shelves, data.bookShelves, filters.shelfId, filters.descendants) : null;
  const terms = normalizeSearch(filters.query).split(' ').filter(Boolean);
  return data.books.filter(book => {
    if (!showArchived && !active.has(book.id)) return false;
    if (shelfIds && !shelfIds.has(book.id)) return false;
    if (filters.genreId && !book.genreIds.includes(filters.genreId)) return false;
    if (!filters.tagIds.every(id => book.tagIds.includes(id))) return false;
    if (filters.readStatus && book.readStatus !== filters.readStatus) return false;
    if (filters.availability && available.has(book.id) !== (filters.availability === 'available')) return false;
    if (filters.publisher && book.publisher !== filters.publisher) return false;
    if (filters.language && book.language !== filters.language) return false;
    if (filters.year && String(book.publicationYear) !== filters.year) return false;
    if (!terms.length) return true;
    const fields = [normalizeSearch(book.title ?? ''), ...book.authorIds.map(id => authors.get(id) ?? ''), ...book.tagIds.map(id => tags.get(id) ?? '')];
    return terms.every(term => fields.some(field => field.includes(term)));
  });
}
export const stableId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function compareTitle(a: Book, b: Book): number {
  return compareOptional(a.title, b.title, (x, y) => hebrewCollator.compare(x, y)) || stableId(a.id, b.id);
}
function compareOptional<T>(a: T | null, b: T | null, compare: (a: T, b: T) => number, descending = false): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return compare(a, b) * (descending ? -1 : 1);
}
export function bookComparator(data: Pick<SearchData, 'authors' | 'genres' | 'copies'>, key: SortKey, descending = false): (a: Book, b: Book) => number {
  const authors = new Map(data.authors.map(item => [item.id, item.displayName]));
  const genres = new Map(data.genres.map(item => [item.id, item.name]));
  const firstName = (ids: string[], names: Map<string, string>) => ids.map(id => names.get(id)).filter((name): name is string => !!name).sort(hebrewCollator.compare)[0] ?? null;
  // Prices are ordered by currency first, then by the lowest active-copy amount in that currency.
  const prices = new Map<string, { currency: string; amount: number }>();
  for (const copy of data.copies) {
    if (copy.archivedAt || copy.purchasePriceMinor === null || !copy.currency) continue;
    const previous = prices.get(copy.bookId), price = { currency: copy.currency, amount: copy.purchasePriceMinor };
    if (!previous || stableId(price.currency, previous.currency) < 0 || (price.currency === previous.currency && price.amount < previous.amount)) prices.set(copy.bookId, price);
  }
  const values = new Map<string, string | number | null>(); // values below are computed once for each encountered book
  const value = (book: Book): string | number | null => {
    if (values.has(book.id)) return values.get(book.id) as string | number | null;
    const result = key === 'added' ? book.createdAt : key === 'title' ? book.title : key === 'author' ? firstName(book.authorIds, authors) : key === 'genre' ? firstName(book.genreIds, genres) : key === 'year' ? book.publicationYear : key === 'pages' ? book.pages : null;
    values.set(book.id, result); return result;
  };
  return (a, b) => {
    const comparison = key === 'price'
      ? compareOptional(prices.get(a.id) ?? null, prices.get(b.id) ?? null, (x, y) => stableId(x.currency, y.currency) || (x.amount - y.amount) * (descending ? -1 : 1))
      : compareOptional(value(a), value(b), (x, y) => typeof x === 'number' && typeof y === 'number' ? x - y : hebrewCollator.compare(String(x), String(y)), descending);
    return comparison || compareTitle(a, b);
  };
}
export function titleLetter(book: Book): string { return normalizeSearch(book.title ?? '').match(/[א-תa-z0-9]/u)?.[0]?.toUpperCase() ?? '#'; }
export function libraryStats(books: Book[], copies: Copy[], tags: NamedItem[], genres: NamedItem[]) {
  const unique = [...new Map(books.map(book => [book.id, book])).values()], ids = new Set(unique.map(book => book.id));
  return { books: unique.length, copies: copies.filter(copy => ids.has(copy.bookId) && !copy.archivedAt).length,
    archivedCopies: copies.filter(copy => ids.has(copy.bookId) && !!copy.archivedAt).length,
    states: Object.fromEntries(['unread', 'reading', 'read', 'abandoned', 'want-to-read'].map(state => [state, unique.filter(book => book.readStatus === state).length])),
    tags: tags.map(item => ({ ...item, count: unique.filter(book => book.tagIds.includes(item.id)).length })),
    genres: genres.map(item => ({ ...item, count: unique.filter(book => book.genreIds.includes(item.id)).length })),
  };
}
