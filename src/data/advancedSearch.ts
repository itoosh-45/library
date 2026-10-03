import { bookComparator, emptyFilters, filterBooks, type SearchData, type SortKey } from './search';
export interface AdvancedFilters { genre: string; loan: string; fromYear: string; toYear: string; addedFrom: string; addedTo: string; rating: string; minPrice: string; maxPrice: string; sort: SortKey; descending: boolean }
export const defaultAdvanced: AdvancedFilters = { genre: '', loan: '', fromYear: '', toYear: '', addedFrom: '', addedTo: '', rating: '', minPrice: '', maxPrice: '', sort: 'title', descending: false };
export function advancedBooks(data: SearchData, query: string, filters: AdvancedFilters) {
  const byCopy = new Map(data.copies.map(copy => [copy.id, copy.bookId]));
  const borrowed = new Set(data.loans.filter(loan => !loan.returnedAt).map(loan => byCopy.get(loan.copyId)));
  const prices = new Map<string, number>();
  for (const copy of data.copies) if (!copy.archivedAt && copy.currency === 'ILS' && copy.purchasePriceMinor !== null) prices.set(copy.bookId, Math.min(prices.get(copy.bookId) ?? Infinity, copy.purchasePriceMinor / 100));
  const books = filterBooks(data, { ...emptyFilters, query, genreId: filters.genre }).filter(book => {
    if (filters.loan && borrowed.has(book.id) !== (filters.loan === 'borrowed')) return false;
    if (filters.fromYear && (book.publicationYear === null || book.publicationYear < +filters.fromYear)) return false;
    if (filters.toYear && (book.publicationYear === null || book.publicationYear > +filters.toYear)) return false;
    if (filters.addedFrom && book.createdAt.slice(0, 10) < filters.addedFrom) return false;
    if (filters.addedTo && book.createdAt.slice(0, 10) > filters.addedTo) return false;
    if (filters.rating && (book.rating ?? 0) < +filters.rating) return false;
    const price = prices.get(book.id);
    if (filters.minPrice && (price === undefined || price < +filters.minPrice)) return false;
    if (filters.maxPrice && (price === undefined || price > +filters.maxPrice)) return false;
    return true;
  });
  return books.sort(bookComparator(data, filters.sort, filters.descending));
}
