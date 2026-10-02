import { useState } from 'react';
import { Thumbnail } from './BookEditor';
import { db } from './data/database';
import { bookGroups, setSeriesCollapsed } from './data/collections';
import { readingStates } from './data/books';
import { errorMessage } from './data/errors';
import type { Author, Book, Copy, NamedItem, Series } from './data/models';

export interface BookListProps { books: Book[]; authors: Author[]; copies: Copy[]; series: Series[]; tags: NamedItem[]; genres: NamedItem[]; displayMode: string; onOpen: (book: Book) => void }
export function BookList({ books, authors, copies, series, tags, genres, displayMode, onOpen }: BookListProps) {
  const [error, setError] = useState('');
  function row(book: Book) {
    return <li key={book.id}><button className="book-row" onClick={() => onOpen(book)}><Thumbnail imageId={book.primaryImageId} /><div className="book-info"><h2>{book.title ?? 'ללא שם'}</h2><p>{book.authorIds.map(id => authors.find(author => author.id === id)?.displayName).filter(Boolean).join(' · ') || 'ללא מחבר'}</p>{book.seriesId && <p>{book.seriesNumber === null ? 'ללא מספר בסדרה' : `מספר ${book.seriesNumber} בסדרה`}</p>}{displayMode === 'expanded' && <><p>{[readingStates[book.readStatus], book.publisher, book.publicationYear, book.isbn13 ?? book.isbn10].filter(Boolean).join(' · ')}</p><p>{[...genres.filter(item => book.genreIds.includes(item.id)), ...tags.filter(item => book.tagIds.includes(item.id))].map(item => item.name).join(' · ')}</p></>}</div><span className="copy-count">{copies.filter(copy => copy.bookId === book.id && !copy.archivedAt).length} עותקים</span></button></li>;
  }
  return <><p className="error-message" role="alert">{error}</p>{bookGroups(books, series).map(group => group.series ? <section className="series-group" key={group.id}><button className="series-toggle secondary" aria-expanded={!group.series.collapsed} aria-controls={'series-' + group.id} onClick={async () => { try { await setSeriesCollapsed(db, group.series!.id, !group.series!.collapsed); setError(''); } catch (error) { setError(errorMessage(error)); } }}><span>{group.series.collapsed ? '▸' : '▾'} {group.series.name}</span><span>{group.books.length} ספרים</span></button><ul className="book-list" id={'series-' + group.id} hidden={group.series.collapsed}>{group.books.map(row)}</ul></section> : <ul className="book-list" key={group.id}>{group.books.map(row)}</ul>)}</>;
}
