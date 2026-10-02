import { describe, expect, it } from 'vitest';
import { bookComparator, emptyFilters, filterBooks, libraryStats, normalizeSearch, sortLabels, titleLetter, type SearchData, type SortKey } from './search';
import { bookGroups } from './collections';
import type { Book, Copy } from './models';
const book = (id: string, fields: Partial<Book> = {}): Book => ({ id, title: id, titleSortKey: id, subtitle: null, authorIds: [], isbn10: null, isbn13: null, danacode: null, publisher: null, publicationYear: null, edition: null, volume: null, language: null, pages: null, seriesId: null, seriesNumber: null, genreIds: [], tagIds: [], readStatus: 'unread', personalNotes: null, primaryImageId: null, createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1, ...fields });
const copy = (id: string, bookId: string, fields: Partial<Copy> = {}): Copy => ({ id, bookId, label: null, purchasePriceMinor: null, currency: null, notes: null, archivedAt: null, createdAt: '', updatedAt: '', ...fields });
function fixture(): SearchData {
  const books = [book('a', { title: 'שָׁלוֹם ״עולם״', authorIds: ['pen'], genreIds: ['g'], tagIds: ['t', 'u'], publisher: 'הוצאה', language: 'עברית', publicationYear: 2020, readStatus: 'read' }), book('b', { title: 'English 10', tagIds: ['t'] }), book('c', { title: 'ספר בארכיון' })];
  return { books, copies: [copy('1', 'a'), copy('2', 'a'), copy('3', 'b'), copy('4', 'c', { archivedAt: '2026' })], authors: [{ id: 'pen', displayName: 'שם עט O’Neil', givenName: null, familyName: null, normalizedName: '' }], tags: [{ id: 't', name: 'חוֹרף', normalizedName: '' }, { id: 'u', name: 'נוסף', normalizedName: '' }], genres: [{ id: 'g', name: 'עיון', normalizedName: '' }], shelves: [{ id: 'root', parentId: null, name: 'ראשי', imageId: null, sortOrder: 0, createdAt: '', updatedAt: '' }, { id: 'child', parentId: 'root', name: 'ילד', imageId: null, sortOrder: 1, createdAt: '', updatedAt: '' }], bookShelves: [{ id: '1', shelfId: 'child', bookId: 'a' }, { id: '2', shelfId: 'child', bookId: 'a' }], loans: [] };
}
describe('T13 search and cumulative filters', () => {
  it('normalizes marks, Unicode, quotes, finals, spaces and case without mutating source', () => {
    const data = fixture(), original = structuredClone(data);
    for (const query of ['שלום עולם', 'שָׁלוֹם', 'שלומ', '"עולם"', 'שם עט', "O'Neil", '  שלום   חורף ']) expect(filterBooks(data, { ...emptyFilters, query }).map(book => book.id)).toEqual(['a']);
    expect(filterBooks(data, { ...emptyFilters, query: 'חורפ' }).map(book => book.id)).toEqual(['a', 'b']);
    expect(filterBooks(data, { ...emptyFilters, query: 'english 10' }).map(book => book.id)).toEqual(['b']);
    expect(filterBooks(data, { ...emptyFilters, query: 'אין תוצאות' })).toEqual([]);
    expect(normalizeSearch('שָׁלוֹם\u00a0״ךםןףץ״ Café')).toBe('שלומ כמנפצ cafe');
    expect(data).toEqual(original);
  });
  it('ANDs all filters and all selected tags, with unique descendant memberships', () => {
    const data = fixture(), filters = { ...emptyFilters, shelfId: 'root', genreId: 'g', tagIds: ['t', 'u'], readStatus: 'read', availability: 'available', publisher: 'הוצאה', language: 'עברית', year: '2020', query: 'שלום' };
    expect(filterBooks(data, filters).map(book => book.id)).toEqual(['a']);
    for (const fields of [{ descendants: false }, { year: '2021' }, { tagIds: ['missing'] }, { availability: 'unavailable' }, { publisher: 'אחר' }, { language: 'English' }, { readStatus: 'reading' }]) expect(filterBooks(data, { ...filters, ...fields })).toEqual([]);
    data.loans = ['1', '2'].map(id => ({ id, copyId: id, personId: 'p', borrowedAt: '', expectedReturnOn: null, returnedAt: null, openFlag: 1, notes: null, createdAt: '', updatedAt: '' }));
    expect(filterBooks(data, { ...filters, availability: 'unavailable' }).map(book => book.id)).toEqual(['a']);
    expect(filterBooks(data, emptyFilters, true)).toHaveLength(3);
  });
  it('counts books once and active/archive copies separately', () => {
    const data = fixture(), stats = libraryStats([...data.books, data.books[0]], data.copies, data.tags, data.genres);
    expect(stats).toMatchObject({ books: 3, copies: 3, archivedCopies: 1, states: { read: 1, unread: 2 } });
    expect(stats.tags.map(item => item.count)).toEqual([2, 1]); expect(stats.genres[0].count).toBe(1);
  });
});
describe('T13 sorting and intact series', () => {
  for (const key of ['added', 'title', 'author', 'year', 'genre', 'pages'] as SortKey[]) it(`${key} matches an independent known order`, () => {
    const data = fixture();
    data.authors = ['א', 'ב', 'ג'].map((displayName, i) => ({ id: String(i), displayName, givenName: null, familyName: null, normalizedName: '' }));
    data.genres = ['א', 'ב', 'ג'].map((name, i) => ({ id: String(i), name, normalizedName: '' }));
    data.books = [book('a', { title: 'ג', authorIds: ['2'], genreIds: ['2'], publicationYear: 2020, pages: 200, createdAt: '2026-03-01' }), book('b', { title: 'א', authorIds: ['0', '2'], genreIds: ['0', '2'], publicationYear: 1990, pages: 10, createdAt: '2026-02-01' }), book('c', { title: 'ב', authorIds: ['1'], genreIds: ['1'], publicationYear: 2010, pages: 100, createdAt: '2026-01-01' })];
    const expected = key === 'added' ? ['c', 'b', 'a'] : ['b', 'c', 'a'];
    expect([...data.books].sort(bookComparator(data, key)).map(book => book.id)).toEqual(expected);
    expect([...data.books].sort(bookComparator(data, key, true)).map(book => book.id)).toEqual([...expected].reverse());
  });
  it('keeps numeric ties and missing series numbers stable by title and id', () => {
    const books = [book('z', { title: 'ב', seriesId: 's', seriesNumber: 2 }), book('b', { title: 'א', seriesId: 's', seriesNumber: 2 }), book('a', { title: 'א', seriesId: 's', seriesNumber: 2 }), book('d', { title: 'א', seriesId: 's' }), book('c', { title: 'א', seriesId: 's' })];
    expect(bookGroups(books, [{ id: 's', name: 'סדרה', normalizedName: '', collapsed: false }])[0].books.map(book => book.id)).toEqual(['a', 'b', 'z', 'c', 'd']);
  });
  for (const key of Object.keys(sortLabels) as SortKey[]) for (const descending of [false, true]) it(`${key} ${descending ? 'descending' : 'ascending'} positions groups by first matching book`, () => {
    const data = fixture();
    data.books = [book('a', { title: 'אחד', authorIds: ['pen'], genreIds: ['g'], publicationYear: 2020, pages: 100, seriesId: 's', seriesNumber: 10 }), book('b', { title: 'בית', publicationYear: 1990, pages: 20, seriesId: 's', seriesNumber: 2 }), book('c', { title: 'גימל', publicationYear: 2010, pages: 70 }), book('d', { title: 'דלת', seriesId: 's', seriesNumber: null })];
    const series = [{ id: 's', name: 'סדרה', normalizedName: '', collapsed: false }], compare = bookComparator(data, key, descending);
    const sorted = [...data.books].sort(compare), groups = bookGroups(data.books, series, compare);
    expect(groups[0].books.some(book => book.id === sorted[0].id)).toBe(true);
    expect(groups.find(group => group.series)!.books.map(book => book.id)).toEqual(['b', 'a', 'd']);
    const filtered = bookGroups(data.books.filter(book => book.id !== 'b'), series, compare);
    expect(filtered.find(group => group.series)!.books.map(book => book.id)).toEqual(['a', 'd']);
  });
  it('uses currency groups and minimum active price, zero and missing last both ways', () => {
    const data = fixture(); data.books = ['a', 'b', 'c', 'd', 'e'].map(id => book(id));
    data.copies = [copy('1', 'a', { currency: 'USD', purchasePriceMinor: 1 }), copy('2', 'b', { currency: 'ILS', purchasePriceMinor: 500 }), copy('3', 'c', { currency: 'ILS', purchasePriceMinor: 0 }), copy('4', 'b', { currency: 'ILS', purchasePriceMinor: 100 }), copy('5', 'e', { currency: 'ILS', purchasePriceMinor: 1, archivedAt: '2026' })];
    expect([...data.books].sort(bookComparator(data, 'price')).map(book => book.id)).toEqual(['c', 'b', 'a', 'd', 'e']);
    expect([...data.books].sort(bookComparator(data, 'price', true)).map(book => book.id)).toEqual(['b', 'c', 'a', 'd', 'e']);
  });
  for (const key of ['title', 'author', 'year', 'genre', 'pages'] as SortKey[]) it(`missing ${key} stays last with stable ties`, () => {
    const data = fixture(); data.books = [book('z', { title: null }), book('b', { title: 'זהה', authorIds: ['pen'], genreIds: ['g'], publicationYear: 2000, pages: 20 }), book('a', { title: 'זהה', authorIds: ['pen'], genreIds: ['g'], publicationYear: 2000, pages: 20 })];
    for (const descending of [true, false]) expect([...data.books].sort(bookComparator(data, key, descending)).map(book => book.id)).toEqual(['a', 'b', 'z']);
  });
  it('letters handle finals and Hebrew/English/numbers', () => { expect(['שָׁלוֹם', 'ץד', 'English', '123', ''].map(title => titleLetter(book('a', { title })))).toEqual(['ש', 'צ', 'E', '1', '#']); });
});
