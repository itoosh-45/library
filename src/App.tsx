import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { LibraryValidationError, renameLibrary } from './data/library';

const sections = [
  { id: 'books', label: 'כל הספרים', icon: 'book' },
  { id: 'shelves', label: 'מדפים', icon: 'shelf' },
  { id: 'loans', label: 'השאלות', icon: 'loan' },
  { id: 'settings', label: 'הגדרות', icon: 'settings' },
] as const;
type Section = typeof sections[number]['id'];
function currentSection(): Section {
  const hash = window.location.hash.slice(1);
  return sections.find(item => item.id === hash)?.id ?? 'books';
}
function Icon({ kind }: { kind: string }) {
  const paths: Record<string, string> = {
    book: 'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3z M12 6v15',
    shelf: 'M3 4h18M3 12h18M3 20h18M5 5v6M9 5v6M15 13v6M19 13v6',
    loan: 'M4 7h14l-3-3M18 7l-3 3M20 17H6l3-3M6 17l3 3',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind] ?? paths.book} /></svg>;
}
function LibraryNameForm({ name }: { name: string }) {
  const [value, setValue] = useState(name);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage('');
    try { await renameLibrary(db, value); setMessage('שם הספרייה נשמר.'); }
    catch (error) { setMessage(error instanceof LibraryValidationError ? error.message : 'השם לא נשמר. נסה שוב.'); }
    finally { setSaving(false); }
  }
  return <form className="name-form" onSubmit={submit}><label htmlFor="library-name">שם הספרייה</label><div className="form-row"><input id="library-name" value={value} maxLength={120} required onChange={event => setValue(event.target.value)} /><button type="submit" disabled={saving}>{saving ? 'שומר…' : 'שמירת השם'}</button></div><p className="form-status" role="status" aria-live="polite">{message}</p></form>;
}
export function App() {
  const [section, setSection] = useState<Section>(currentSection);
  useEffect(() => {
    const changed = () => setSection(currentSection());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const data = useLiveQuery(async () => ({
    name: (await db.settings.get('libraryName'))?.value ?? 'הספרייה שלי',
    books: await db.books.toArray(), copies: await db.copies.toArray(), authors: await db.authors.toArray(),
    shelves: await db.shelves.count(), openLoans: await db.loans.where('openFlag').equals(1).count(),
  }));
  if (!data) return <p className="loading" role="status">טוען את הספרייה…</p>;
  const title = sections.find(item => item.id === section)!.label;
  const total = section === 'books' ? data.books.length : section === 'shelves' ? data.shelves : section === 'loans' ? data.openLoans : null;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>דילוג לתוכן</a>
    <aside className="sidebar"><div className="brand"><Icon kind="book" /><span>הספרייה שלי</span></div><p className="library-name">{data.name}</p><nav aria-label="ניווט ראשי">{sections.map(item => <a key={item.id} href={'#' + item.id} aria-current={section === item.id ? 'page' : undefined}><Icon kind={item.icon} /><span>{item.label}</span></a>)}</nav><p className="local-note">הספרייה שלך נשמרת<br />בדפדפן הזה.</p></aside>
    <main id="main-content" tabIndex={-1} className="content"><header className="page-heading"><div><p className="eyebrow">{data.name}</p><h1>{title}{total !== null && <span className="total">{total}</span>}</h1></div><span className="local-badge"><span aria-hidden="true" />ספרייה מקומית</span></header>
      {section === 'settings' ? <section className="settings-card"><h2>הספרייה שלך</h2><p>בחר שם שיופיע בראש הספרייה.</p><LibraryNameForm name={data.name} /><div className="setting-note"><h3>שמירה במכשיר</h3><p>הנתונים נשמרים בדפדפן ובמכשיר שבהם פתחת את הספרייה.</p></div></section> : section === 'books' && data.books.length > 0 ? <ul className="book-list">{data.books.map(book => <li key={book.id}><div className="book-placeholder" aria-hidden="true"><Icon kind="book" /></div><div className="book-info"><h2>{book.title ?? 'ללא שם'}</h2><p>{book.authorIds.map(id => data.authors.find(author => author.id === id)?.displayName).filter(Boolean).join(' · ') || 'ללא מחבר'}</p></div><span className="copy-count">{data.copies.filter(copy => copy.bookId === book.id && !copy.archivedAt).length} עותקים</span></li>)}</ul> : <section className="empty-state"><div className="empty-icon"><Icon kind={sections.find(item => item.id === section)!.icon} /></div><h2>{section === 'books' ? 'כאן מתחילה הספרייה שלך' : section === 'shelves' ? 'המדפים שלך' : 'ההשאלות שלך'}</h2><p>{section === 'books' ? 'הספרים שלך יופיעו כאן ברשימה אחת מסודרת.' : section === 'shelves' ? 'כאן תוכל לארגן את הספרים באוספים ובתתי־מדפים.' : 'כאן תוכל לעקוב אחר עותקים שהשאלת ומועד החזרתם.'}</p><span className="empty-caption">{section === 'books' ? 'עוד לא נוספו ספרים' : section === 'shelves' ? 'עוד לא נוספו מדפים' : 'אין השאלות פתוחות'}</span></section>}
    </main>
  </div>;
}
