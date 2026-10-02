import { useEffect, useRef, useState } from 'react';
import { Thumbnail } from './BookEditor';
import { db } from './data/database';
import { bookGroups, setSeriesCollapsed } from './data/collections';
import { readingStates } from './data/books';
import { errorMessage } from './data/errors';
import type { Author, Book, Copy, NamedItem, Series } from './data/models';
import { titleLetter } from './data/search';

export interface BookListProps { books: Book[]; authors: Author[]; copies: Copy[]; series: Series[]; tags: NamedItem[]; genres: NamedItem[]; displayMode: string; compare?: (a: Book, b: Book) => number; alphabetical?: boolean; onOpen: (book: Book) => void }
export function BookList({ books, authors, copies, series, tags, genres, displayMode, compare, alphabetical, onOpen }: BookListProps) {
  const [error, setError] = useState(''), [current, setCurrent] = useState('');
  const root = useRef<HTMLDivElement>(null), index = useRef<HTMLDivElement>(null);
  const pendingJump = useRef<string | null>(null);
  const groups = bookGroups(books, series, compare), showIndex = alphabetical && books.length > 8;
  const present = new Set(books.map(titleLetter));
  const letters = [...'אבגדהוזחטיכלמנסעפצקרשת', ...[...present].filter(letter => !/[א-ת]/.test(letter)).sort()];
  function position(row: HTMLElement) {
    window.scrollTo({ top: row.getBoundingClientRect().top + window.scrollY - (index.current?.getBoundingClientRect().height ?? 0) - 8, behavior: 'instant' });
    row.querySelector('button')?.focus({ preventScroll: true });
    setCurrent(row.dataset.letter ?? '');
  }
  useEffect(() => {
    const update = () => {
      const top = index.current?.getBoundingClientRect().bottom ?? 0;
      const rows = [...(root.current?.querySelectorAll<HTMLElement>('[data-letter]') ?? [])].filter(row => row.getClientRects().length);
      const row = rows.find(row => row.getBoundingClientRect().bottom > Math.max(top, 0) && row.getBoundingClientRect().top < innerHeight);
      setCurrent(row?.dataset.letter ?? '');
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener('scroll', update, { passive: true }); window.addEventListener('resize', update);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [books, series]);
  useEffect(() => {
    if (!pendingJump.current) return;
    const row = [...(root.current?.querySelectorAll<HTMLElement>('[data-book-id]') ?? [])].find(row => row.dataset.bookId === pendingJump.current);
    if (!row?.getClientRects().length) return;
    const frame = requestAnimationFrame(() => {
      pendingJump.current = null;
      window.scrollTo({ top: row.getBoundingClientRect().top + window.scrollY - (index.current?.getBoundingClientRect().height ?? 0) - 8, behavior: 'instant' });
      row.querySelector('button')?.focus({ preventScroll: true });
      setCurrent(row.dataset.letter ?? '');
    });
    return () => cancelAnimationFrame(frame);
  }, [series, books]);
  async function jump(letter: string) {
    const group = groups.find(group => group.books.some(book => titleLetter(book) === letter)), book = group?.books.find(book => titleLetter(book) === letter);
    if (!book || !group) return;
    try {
      if (group.series?.collapsed) { pendingJump.current = book.id; await setSeriesCollapsed(db, group.series.id, false); }
      else { const row = [...(root.current?.querySelectorAll<HTMLElement>('[data-book-id]') ?? [])].find(row => row.dataset.bookId === book.id); if (row) position(row); }
      setError('');
    } catch (error) { pendingJump.current = null; setError(errorMessage(error)); }
  }
  const copyCounts = new Map<string, number>();
  for (const copy of copies) if (!copy.archivedAt) copyCounts.set(copy.bookId, (copyCounts.get(copy.bookId) ?? 0) + 1);
  const authorNames = new Map(authors.map(author => [author.id, author.displayName]));
  function row(book: Book) {
    return <li key={book.id} data-book-id={book.id} data-letter={titleLetter(book)}><button className="book-row" onClick={() => onOpen(book)}><Thumbnail imageId={book.primaryImageId} /><div className="book-info"><h2>{book.title ?? 'ללא שם'}</h2><p>{book.authorIds.map(id => authorNames.get(id)).filter(Boolean).join(' · ') || 'ללא מחבר'}</p>{book.seriesId && <p>{book.seriesNumber === null ? 'ללא מספר בסדרה' : `מספר ${book.seriesNumber} בסדרה`}</p>}{displayMode === 'expanded' && <><p>{[readingStates[book.readStatus], book.publisher, book.publicationYear, book.isbn13 ?? book.isbn10].filter(Boolean).join(' · ')}</p><p>{[...genres.filter(item => book.genreIds.includes(item.id)), ...tags.filter(item => book.tagIds.includes(item.id))].map(item => item.name).join(' · ')}</p></>}</div><span className="copy-count">{copyCounts.get(book.id) ?? 0} עותקים</span></button></li>;
  }
  return <div ref={root}><p className="error-message" role="alert">{error}</p>{showIndex && <div className="letter-index" ref={index} aria-label="קפיצה לפי אות"><p>האות הנוכחית: <span>{current || '—'}</span></p><div className="letter-buttons">{letters.map(letter => <button key={letter} disabled={!present.has(letter)} aria-label={'קפיצה לאות ' + letter} aria-current={current === letter ? 'true' : undefined} onClick={() => void jump(letter)}>{letter}</button>)}</div></div>}{groups.map(group => group.series ? <section className="series-group" key={group.id}><button className="series-toggle secondary" aria-expanded={!group.series.collapsed} aria-controls={'series-' + group.id} onClick={async () => { try { await setSeriesCollapsed(db, group.series!.id, !group.series!.collapsed); setError(''); } catch (error) { setError(errorMessage(error)); } }}><span>{group.series.collapsed ? '▸' : '▾'} {group.series.name}</span><span>{group.books.length} ספרים</span></button><ul className="book-list" id={'series-' + group.id} hidden={group.series.collapsed}>{group.books.map(row)}</ul></section> : <ul className="book-list" key={group.id}>{group.books.map(row)}</ul>)}</div>;
}
