import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { renameLibrary } from './data/library';
import { errorMessage } from './data/errors';
import type { Book } from './data/models';
import { BookEditor } from './BookEditor';
import { BookList, type BookListProps } from './BookList';
import { NamedManagement } from './NamedManagement';
import { ExcelLauncher } from './ExcelLauncher';
import { ShelvesPanel } from './CollectionsPanel';
import { BackupPanel } from './BackupPanel';
import { ResetLibrary } from './ResetLibrary';
import { OfflinePanel } from './OfflinePanel';
import { AdvancedSearch } from './AdvancedSearch';
import { advancedBooks, defaultAdvanced } from './data/advancedSearch';
import { bookComparator } from './data/search';
import { UserStatistics } from './UserStatistics';
import { LoansPanel } from './LoansPanel';
import { TagsPanel } from './TagsPanel';
import { restoreBookFocus } from './focusRestore';
import { useOnline } from './pwa';
const GroqKey = lazy(() => import('./GroqKey'));
const GoodreadsKey = lazy(() => import('./GoodreadsKey'));
const VisionKey = lazy(() => import('./VisionKey'));
const sections = [{ id: 'shelves', label: 'מדפים' }, { id: 'books', label: 'כל הספרים' }, { id: 'loans', label: 'השאלות' }, { id: 'tags', label: 'תגיות' }, { id: 'settings', label: 'הגדרות' }] as const;
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
  const [filters, setFilters] = useState({ ...defaultAdvanced });
  const [editor, setEditor] = useState<{ book?: Book; key: number }>();
  const focus = useRef<HTMLElement | null>(null), scroll = useRef(0), bookId = useRef<string | undefined>(undefined);
  useEffect(() => { const changed = () => setSection(currentSection()); window.addEventListener('hashchange', changed); return () => window.removeEventListener('hashchange', changed); }, []);
  const data = useLiveQuery(async () => ({ name: (await db.settings.get('libraryName'))?.value ?? 'הספרייה שלי', books: await db.books.toArray(), authors: await db.authors.toArray(), copies: await db.copies.toArray(), loans: await db.loans.toArray(), genres: await db.genres.toArray(), tags: await db.tags.toArray(), shelves: await db.shelves.toArray(), bookShelves: await db.bookShelves.toArray(), series: await db.series.toArray() }));
  if (!data) return <p role="status">טוען את הספרייה…</p>;
  function open(book?: Book) { focus.current = document.activeElement as HTMLElement; scroll.current = window.scrollY; bookId.current = book?.id; setEditor(previous => ({ book, key: (previous?.key ?? 0) + 1 })); }
  function close() { setEditor(undefined); restoreBookFocus(focus.current, bookId.current, scroll.current); }
  const authors = new Map(data.authors.map(author => [author.id, author.displayName]));
  const books = advancedBooks(data, query, filters);
  const list: BookListProps = { ...data, books, compare: bookComparator(data, filters.sort, filters.descending), series: data.series, displayMode: 'compact', simple: true, onOpen: open };
  return <div className="app-shell simple-library">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>דילוג לתוכן</a>
    <header className="simple-header"><strong>{data.name}</strong><a href="#settings" aria-current={section === 'settings' ? 'page' : undefined}> <svg className="settings-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-2 2 2 3 3 1 1 3h6l1-3 3-1 2-3-2-2 2-2-2-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg><span>הגדרות</span></a></header>
    <nav className="simple-nav" aria-label="ניווט ראשי">{sections.slice(0, 4).map(item => <a key={item.id} href={'#' + item.id} aria-current={section === item.id ? 'page' : undefined}>{item.label}</a>)}</nav>
    <main id="main-content" tabIndex={-1} className="simple-content">
      {!online && <p className="hint" role="status">אין חיבור לרשת. הספרים והמדפים זמינים במכשיר.</p>}
      {(section === 'books' || section === 'shelves') && <button className="add-book-button" onClick={() => open()}><span aria-hidden="true">+</span>הוספת ספר</button>}
      <h1>{sections.find(item => item.id === section)!.label}{section === 'books' && <span className="simple-count">{books.length}</span>}</h1>
      {(section === 'books' || section === 'shelves') && <><label className="field simple-search">חיפוש ספר<input type="search" placeholder="שם הספר, המחבר או הסדרה" value={query} onChange={event => setQuery(event.target.value)} /></label><AdvancedSearch filters={filters} onChange={setFilters} genres={data.genres} series={data.series} /></>}
      {section === 'books' && <>{books.length ? <BookList {...list} /> : <div className="simple-empty"><h2>{query ? 'לא נמצאו ספרים' : 'כאן יופיעו הספרים שלך'}</h2><p>{query ? 'נסה שם אחר או נקה את החיפוש.' : 'הוסף ספר ראשון. מספיק להתחיל בשם.'}</p>{query && <button className="secondary" onClick={() => setQuery('')}>ניקוי החיפוש</button>}</div>}</>}
      {section === 'shelves' && <ShelvesPanel list={list} simple searching={!!query.trim()} />}
      {section === 'loans' && <LoansPanel />}
      {section === 'tags' && <TagsPanel list={{ ...list, books: data.books }} />}
      {section === 'settings' && <div className="simple-settings"><LibraryNameForm name={data.name} /><details><summary>סטטיסטיקות הספרייה</summary><UserStatistics books={data.books} copies={data.copies} loans={data.loans} genres={data.genres} shelves={data.shelves} /></details><details><summary>Excel · ייצוא וייבוא</summary><ExcelLauncher /></details><details><summary>ניהול ז׳אנרים</summary><NamedManagement kind="genres" /></details><details><summary>זיהוי ספר מתמונה · Gemini</summary><Suspense fallback={<p role="status">טוען הגדרות…</p>}><VisionKey /></Suspense></details><details><summary>Groq · גיבוי לזיהוי תמונות</summary><Suspense fallback={<p role="status">טוען…</p>}><GroqKey /></Suspense></details><details><summary>קטלוגים · הקטלוג הישראלי, דני ספרים, הספרייה הלאומית ו־Goodreads</summary><Suspense fallback={<p role="status">טוען…</p>}><GoodreadsKey /></Suspense></details><details><summary>OCR מקומי</summary><p>קריאת שם הספר והמחבר בעברית מכריכה או משדרה, ללא מפתח וללא מכסת סריקות. בחר ״OCR מקומי״ במסך סריקת התמונה. יש לבדוק את שם הספר והמחבר לפני השמירה.</p></details><details><summary>גיבוי ושחזור הספרייה</summary><BackupPanel /></details><details><summary>עדכון ואופליין</summary><OfflinePanel /></details><ResetLibrary onReset={() => { setQuery(''); setFilters({ ...defaultAdvanced }); setEditor(undefined); }} /></div>}
    </main>
    {editor && <BookEditor simple key={editor.key} book={editor.book} authorNames={editor.book?.authorIds.map(id => authors.get(id) ?? '') ?? []} authorRecords={editor.book?.authorIds.map(id => data.authors.find(author => author.id === id)!).filter(Boolean) ?? []} onClose={close} onOpen={book => setEditor(previous => ({ book, key: (previous?.key ?? 0) + 1 }))} />}
  </div>;
}
