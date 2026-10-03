import { useEffect, useMemo, useRef, useState } from 'react';
import { Thumbnail } from './BookEditor';
import { db } from './data/database';
import { bookGroups, setSeriesCollapsed } from './data/collections';
import { readingStates } from './data/books';
import { errorMessage } from './data/errors';
import type { Author, Book, Copy, Loan, NamedItem, Series } from './data/models';
import { compareTitle, titleLetter } from './data/search';

export interface BookListProps { simple?: boolean; books: Book[]; allBooks?: Book[]; authors: Author[]; copies: Copy[]; loans?: Loan[]; series: Series[]; tags: NamedItem[]; genres: NamedItem[]; displayMode: string; compare?: (a: Book, b: Book) => number; alphabetical?: boolean; onOpen: (book: Book) => void }
export function BookList({ books, allBooks, authors, copies, loans = [], series, tags, genres, displayMode, compare, alphabetical, onOpen, simple = false }: BookListProps) {
  const [error, setError] = useState(''), [current, setCurrent] = useState('');
  const root = useRef<HTMLDivElement>(null), index = useRef<HTMLDivElement>(null);
  const pendingJump = useRef<string | null>(null);
  const groups = useMemo(() => bookGroups(books, series, compare), [books, series, compare]), showIndex = !simple && alphabetical && books.length > 8;
  const present = new Set(books.map(titleLetter));
  const letters = [...'אבגדהוזחטיכלמנסעפצקרשת', ...[...present].filter(letter => !/[א-ת]/.test(letter)).sort()];
  function position(row: HTMLElement) {
    window.scrollTo({ top: row.getBoundingClientRect().top + window.scrollY - (index.current?.getBoundingClientRect().height ?? 0) - 8, behavior: 'instant' });
    row.querySelector('button')?.focus({ preventScroll: true });
    setCurrent(row.dataset.letter ?? '');
  }
  useEffect(() => {
    if (simple) return;
    const rows = [...(root.current?.querySelectorAll<HTMLElement>('[data-letter]') ?? [])].filter(row => !row.closest('[hidden]'));
    const update = () => {
      const top = Math.max(index.current?.getBoundingClientRect().bottom ?? 0, 0);
      let low = 0, high = rows.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (rows[middle].getBoundingClientRect().bottom <= top) low = middle + 1;
        else high = middle;
      }
      const row = rows[low];
      if (row && row.getBoundingClientRect().top >= innerHeight) { setCurrent(''); return; }
      setCurrent(row?.dataset.letter ?? '');
    };
    let frame = requestAnimationFrame(() => { frame = 0; update(); });
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); };
    window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [books, series, simple]);
  useEffect(() => {
    if (!pendingJump.current) return;
    if (!books.some(book => book.id === pendingJump.current)) { pendingJump.current = null; return; }
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
  // Retain a large flat segment across filters; hidden rows cannot receive focus or appear in the accessibility tree.
  const retainedPlain = useMemo(() => allBooks && allBooks.length >= 1000 ? allBooks.filter(book => !series.some(item => item.id === book.seriesId)).sort(compare ?? compareTitle) : undefined, [allBooks, series, compare]);
  const renderedGroups = useMemo(() => {
    const copyCounts = new Map<string, number>();
    const borrowedCopies = new Set(loans.filter(loan => loan.returnedAt === null).map(loan => loan.copyId));
    const availableCounts = new Map<string, number>();
    for (const copy of copies) if (!copy.archivedAt) copyCounts.set(copy.bookId, (copyCounts.get(copy.bookId) ?? 0) + 1);
    for (const copy of copies) if (!copy.archivedAt && !borrowedCopies.has(copy.id)) availableCounts.set(copy.bookId, (availableCounts.get(copy.bookId) ?? 0) + 1);
    const authorNames = new Map(authors.map(author => [author.id, author.displayName]));
    const visibleIds = new Set(books.map(book => book.id));
    function row(book: Book) {
      return <li key={book.id} hidden={!visibleIds.has(book.id)} data-book-id={book.id} data-letter={titleLetter(book)}><button className="book-row" onClick={() => onOpen(book)}><span className="book-jacket"><Thumbnail imageId={book.primaryImageId} defer /><span className="jacket-title" aria-hidden="true">{book.title ?? 'ללא שם'}</span></span><div className="book-info"><h2>{book.title ?? 'ללא שם'}</h2><p>{book.authorIds.map(id => authorNames.get(id)).filter(Boolean).join(' · ') || 'ללא מחבר'}</p>{(copyCounts.get(book.id) ?? 0) > (availableCounts.get(book.id) ?? 0) && <p className="loan-badge">{(copyCounts.get(book.id) ?? 0) - (availableCounts.get(book.id) ?? 0)}/{copyCounts.get(book.id)} מושאלים</p>}{!simple && <p className="reading-status">{readingStates[book.readStatus]}</p>}{!simple && book.seriesId && <p>{book.seriesNumber === null ? 'ללא מספר בסדרה' : `מספר ${book.seriesNumber} בסדרה`}</p>}{displayMode === 'expanded' && <><p>{[readingStates[book.readStatus], book.publisher, book.publicationYear, book.isbn13 ?? book.isbn10].filter(Boolean).join(' · ')}</p><p>{[...genres.filter(item => book.genreIds.includes(item.id)), ...tags.filter(item => book.tagIds.includes(item.id))].map(item => item.name).join(' · ')}</p></>}</div>{!simple && <span className="copy-count"><span>{copyCounts.get(book.id) ?? 0} עותקים</span><span className="availability">{availableCounts.get(book.id) ?? 0} זמינים</span>{(copyCounts.get(book.id) ?? 0) > (availableCounts.get(book.id) ?? 0) && <span className="loan-badge">מושאל · {(copyCounts.get(book.id) ?? 0) - (availableCounts.get(book.id) ?? 0)}</span>}</span>}</button></li>;
    }
    const runs: typeof groups = [];
    for (const group of groups) {
      const previous = runs.at(-1);
      if (!group.series && previous && !previous.series) previous.books.push(...group.books);
      else runs.push({ ...group, books: [...group.books] });
    }
    const retain = retainedPlain && runs.filter(group => !group.series).length <= 1;
    if (retain) {
      const plain = runs.find(group => !group.series);
      if (plain) plain.books = retainedPlain;
      else runs.push({ id: 'retained-plain', books: retainedPlain });
    }
    let plainIndex = 0;
    return runs.map(group => group.series ? <section className="series-group" key={group.id}><button className="series-toggle secondary" aria-expanded={!group.series.collapsed} aria-controls={'series-' + group.id} onClick={async () => { try { await setSeriesCollapsed(db, group.series!.id, !group.series!.collapsed); setError(''); } catch (error) { setError(errorMessage(error)); } }}><span>{group.series.collapsed ? '▸' : '▾'} {group.series.name}</span><span>{group.books.length} ספרים</span></button><ul className="book-list" id={'series-' + group.id} hidden={group.series.collapsed}>{group.books.map(row)}</ul></section> : <ul className="book-list" key={"plain-" + plainIndex++}>{group.books.map(row)}</ul>);
  }, [groups, books, retainedPlain, authors, copies, loans, tags, genres, displayMode, onOpen, simple]);
  return <div ref={root}><p className="error-message" role="alert">{error}</p>{showIndex && <div className="letter-index" ref={index} aria-label="קפיצה לפי אות"><p>האות הנוכחית: <span>{current || '—'}</span></p><div className="letter-buttons">{letters.map(letter => <button key={letter} disabled={!present.has(letter)} aria-label={'קפיצה לאות ' + letter} aria-current={current === letter ? 'true' : undefined} onClick={() => void jump(letter)}>{letter}</button>)}</div></div>}{renderedGroups}</div>;
}
