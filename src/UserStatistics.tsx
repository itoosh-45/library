import type { Book, Copy, Loan, NamedItem } from './data/models';
export function UserStatistics({ books, copies, loans, genres }: { books: Book[]; copies: Copy[]; loans: Loan[]; genres: NamedItem[] }) {
  const ratings = books.flatMap(book => book.rating ? [book.rating] : []);
  const active = copies.filter(copy => !copy.archivedAt), borrowed = new Set(loans.filter(loan => !loan.returnedAt).map(loan => loan.copyId));
  return <section aria-label="סטטיסטיקות הספרייה"><dl className="user-statistics"><div><dt>ספרים</dt><dd>{books.length}</dd></div><div><dt>עותקים פעילים</dt><dd>{active.length}</dd></div><div><dt>עותקים מושאלים</dt><dd>{active.filter(copy => borrowed.has(copy.id)).length}</dd></div><div><dt>דירוג ממוצע</dt><dd>{ratings.length ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1) + '/5' : 'טרם דורגו ספרים'}</dd></div><div><dt>ספרים מדורגים</dt><dd>{ratings.length}</dd></div></dl><h3>ספרים לפי ז׳אנר</h3><ul>{genres.map(genre => <li key={genre.id}>{genre.name}: {books.filter(book => book.genreIds.includes(genre.id)).length}</li>)}<li>ללא ז׳אנר: {books.filter(book => !book.genreIds.length).length}</li></ul></section>;
}
