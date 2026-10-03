import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { renameLibrary } from './data/library';
import { errorMessage } from './data/errors';
import type { Book } from './data/models';
import { BookEditor } from './BookEditor';
import { BookList, type BookListProps } from './BookList';
import { ShelvesPanel } from './CollectionsPanel';
import { BackupPanel } from './BackupPanel';
import { OfflinePanel } from './OfflinePanel';
import { normalizeSearch, compareTitle } from './data/search';
import { restoreBookFocus } from './focusRestore';
import { useOnline } from './pwa';
const VisionKey = lazy(() => import('./VisionKey'));
const sections = [{ id: 'books', label: 'כל הספרים' }, { id: 'shelves', label: 'מדפים' }, { id: 'settings', label: 'הגדרות' }] as const;
const currentSection = () => sections.find(item => item.id === location.hash.slice(1))?.id ?? 'books';

function LibraryNameForm({ name }: { name: string }) {
  const [value, setValue] = useState(name), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await renameLibrary(db, value); setMessage('שם הספרייה נשמר.'); }
    catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  return <form onSubmit={event => void save(event)} data-update-blocked={busy || value !== name}><label className="field">שם הספרייה<input required maxLength={120} value={value} onChange={event => setValue(event.target.value)} /></label><button disabled={busy}>שמירת השם</button><p role="status">{message}</p></form>;
}

export function App() {
  const online = useOnline();
  const [section, setSection] = useState(currentSection), [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ book?: Book; key: number }>();
  const focus = useRef<HTMLElement | null>(null), scroll = useRef(0), bookId = useRef<string | undefined>(undefined);
  useEffect(() => { const changed = () => setSection(currentSection()); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  const data = useLiveQuery(async () => ({ name: (await db.settings.get('libraryName'))?.value ?? 'הספרייה שלי', books: await db.books.toArray(), authors: await db.authors.toArray(), copies: await db.copies.toArray() }));
  if (!data) return <p role="status">טוען את הספרייה…</p>;
  function open(book?: Book) { focus.current = document.activeElement as HTMLElement; scroll.current = window.scrollY; bookId.current = book?.id; setEditor(previous => ({ book, key: (previous?.key ?? 0) + 1 })); }
  function close() { setEditor(undefined); restoreBookFocus(focus.current, bookId.current, scroll.current); }
  const authors = new Map(data.authors.map(author => [author.id, author.displayName]));
  const needle = normalizeSearch(query);
  const active = new Set(data.copies.filter(copy => !copy.archivedAt).map(copy => copy.bookId));
  const books = data.books.filter(book => active.has(book.id) && normalizeSearch([book.title, ...book.authorIds.map(id => authors.get(id)), book.isbn13, book.isbn10].filter(Boolean).join(' ')).includes(needle)).sort(compareTitle);
  const list: BookListProps = { ...data, books, series: [], tags: [], genres: [], displayMode: 'compact', simple: true, onOpen: open };
  return <div className="app-shell simple-library">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>דילוג לתוכן</a>
    <header className="simple-header"><strong>{data.name}</strong><a href="#settings" aria-current={section === 'settings' ? 'page' : undefined}>הגדרות</a></header>
    <nav className="simple-nav" aria-label="ניווט ראשי">{sections.slice(0, 2).map(item => <a key={item.id} href={'#' + item.id} aria-current={section === item.id ? 'page' : undefined}>{item.label}</a>)}</nav>
    <main id="main-content" tabIndex={-1} className="simple-content">
      {!online && <p className="hint" role="status">אין חיבור לרשת. הספרים והמדפים זמינים במכשיר.</p>}
      {section !== 'settings' && <button className="add-book-button" onClick={() => open()}><span aria-hidden="true">+</span>הוספת ספר</button>}
      <h1>{sections.find(item => item.id === section)!.label}{section === 'books' && <span className="simple-count">{books.length}</span>}</h1>
      {section === 'books' && <><label className="field simple-search">חיפוש ספר<input type="search" placeholder="שם הספר או המחבר" value={query} onChange={event => setQuery(event.target.value)} /></label>{books.length ? <BookList {...list} /> : <div className="simple-empty"><h2>{query ? 'לא נמצאו ספרים' : 'כאן יופיעו הספרים שלך'}</h2><p>{query ? 'נסה שם אחר או נקה את החיפוש.' : 'הוסף ספר ראשון. מספיק להתחיל בשם.'}</p>{query && <button className="secondary" onClick={() => setQuery('')}>ניקוי החיפוש</button>}</div>}</>}
      {section === 'shelves' && <ShelvesPanel list={list} simple />}
      {section === 'settings' && <div className="simple-settings"><LibraryNameForm name={data.name} /><details><summary>זיהוי ספר מתמונה · Gemini</summary><Suspense fallback={<p role="status">טוען הגדרות…</p>}><VisionKey /></Suspense></details><details><summary>גיבוי ושחזור הספרייה</summary><BackupPanel /></details><details><summary>עדכון ואופליין</summary><OfflinePanel /></details></div>}
    </main>
    {editor && <BookEditor simple key={editor.key} book={editor.book} authorNames={editor.book?.authorIds.map(id => authors.get(id) ?? '') ?? []} onClose={close} onOpen={book => setEditor(previous => ({ book, key: (previous?.key ?? 0) + 1 }))} />}
  </div>;
}