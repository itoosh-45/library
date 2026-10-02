import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sheet } from './Sheet';
import { db } from './data/database';
import { archivePerson, lendCopy, localDay, overdue, returnCopy, savePerson } from './data/loans';
import { errorMessage } from './data/errors';
import type { Book, Copy, Loan, Person } from './data/models';

function useToday() {
  const [today, setToday] = useState(localDay);
  useEffect(() => {
    const update = () => setToday(localDay());
    const timer = window.setInterval(update, 60000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  return today;
}
function personLabel(person: Person, people: Person[]): string {
  const same = people.filter(item => item.normalizedName === person.normalizedName).sort((a, b) => a.id.localeCompare(b.id));
  return person.name + (same.length > 1 ? ` — אדם ${same.findIndex(item => item.id === person.id) + 1}` : '');
}
const dateFormatter = new Intl.DateTimeFormat('he');
const dateLabel = (value: string) => dateFormatter.format(new Date(value.length === 10 ? value + 'T12:00:00' : value));
function LoanEntry({ loan, title, copyLabel, today, disabled = false, onBusy }: { loan: Loan; title: string; copyLabel: string; today: string; disabled?: boolean; onBusy?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div className="loan-entry"><p><strong>{title}</strong> · {copyLabel}</p><p>הושאל ב־{dateLabel(loan.borrowedAt)}{loan.expectedReturnOn && ` · החזרה צפויה: ${dateLabel(loan.expectedReturnOn)}`}</p>{loan.returnedAt ? <p>הוחזר ב־{dateLabel(loan.returnedAt)}</p> : <div className="actions"><span className="loan-badge">{overdue(loan, today) ? 'מושאל · באיחור' : 'מושאל'}</span><button type="button" className="secondary" disabled={disabled || busy} onClick={async () => { setBusy(true); onBusy?.(true); setError(''); try { await returnCopy(db, loan.id); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); onBusy?.(false); } }}>רישום החזרה</button></div>}<p className="error-message" role="alert">{error}</p></div>;
}
export function BookLoans({ book, copies, disabled, onBusy }: { book: Book; copies: Copy[]; disabled: boolean; onBusy: (busy: boolean) => void }) {
  const data = useLiveQuery(async () => ({ people: await db.people.toArray(), loans: await db.loans.toArray() }));
  const today = useToday(), [copyId, setCopyId] = useState(''), [personId, setPersonId] = useState('');
  const [name, setName] = useState(''), [separate, setSeparate] = useState(false), [borrowedOn, setBorrowedOn] = useState(localDay), [expectedReturnOn, setExpectedReturnOn] = useState('');
  const [error, setError] = useState('');
  if (!data) return <p role="status">טוען השאלות…</p>;
  const copyIds = new Set(copies.map(copy => copy.id)), history = data.loans.filter(loan => copyIds.has(loan.copyId));
  const open = history.filter(loan => loan.returnedAt === null), borrowed = new Set(open.map(loan => loan.copyId));
  const available = copies.filter(copy => !copy.archivedAt && !borrowed.has(copy.id));
  const copyLabel = (id: string) => { const index = copies.findIndex(copy => copy.id === id); return copies[index]?.label || `עותק ${index + 1}`; };
  return <section className="book-loans"><h3>השאלות הספר</h3><p>{available.length} עותקים זמינים להשאלה</p>{disabled && <p className="hint">שמור שינויים בספר או בעותק לפני פעולת השאלה או החזרה.</p>}
    {open.map(loan => <div key={loan.id}><p>אצל {personLabel(data.people.find(person => person.id === loan.personId)!, data.people)}</p><LoanEntry today={today} loan={loan} title={book.title ?? 'ללא שם'} copyLabel={copyLabel(loan.copyId)} disabled={disabled} onBusy={onBusy} /></div>)}
    {available.length > 0 && <details><summary>השאלת עותק</summary><form onSubmit={async event => {
      event.preventDefault(); onBusy(true); setError('');
      try { await lendCopy(db, { copyId: copyId || (available.length === 1 ? available[0].id : ''), personId: personId || undefined, newPersonName: personId ? undefined : name, separateDuplicate: separate, borrowedOn, expectedReturnOn }); setCopyId(''); setName(''); setSeparate(false); }
      catch (error) { setError(errorMessage(error)); } finally { onBusy(false); }
    }}><fieldset disabled={disabled}>
      <label className="field">עותק להשאלה<select required value={copyId || (available.length === 1 ? available[0].id : '')} onChange={event => setCopyId(event.target.value)}><option value="">בחר עותק</option>{available.map(copy => <option key={copy.id} value={copy.id}>{copyLabel(copy.id)}</option>)}</select></label>
      <label className="field">למי להשאיל<select value={personId} onChange={event => { setPersonId(event.target.value); setSeparate(false); }}><option value="">אדם חדש</option>{data.people.filter(person => !person.archivedAt).sort((a, b) => a.name.localeCompare(b.name, 'he') || a.id.localeCompare(b.id)).map(person => <option key={person.id} value={person.id}>{personLabel(person, data.people)}</option>)}</select></label>
      {!personId && <><label className="field">שם האדם להשאלה<input required maxLength={120} value={name} onChange={event => { setName(event.target.value); setSeparate(false); }} /></label><label className="check"><input type="checkbox" checked={separate} onChange={event => setSeparate(event.target.checked)} />זהו אדם נוסף, גם אם קיים אדם באותו שם</label></>}
      <div className="field-grid"><label className="field">תאריך ההשאלה<input type="date" required max={today} value={borrowedOn} onChange={event => setBorrowedOn(event.target.value)} /></label><label className="field">תאריך החזרה צפוי (רשות)<input type="date" min={borrowedOn} value={expectedReturnOn} onChange={event => setExpectedReturnOn(event.target.value)} /></label></div>
      <button type="submit">שמירת ההשאלה</button><p className="error-message" role="alert">{error}</p>
    </fieldset></form></details>}
    {history.some(loan => loan.returnedAt !== null) && <details><summary>היסטוריית השאלות הספר</summary>{history.filter(loan => loan.returnedAt !== null).sort((a, b) => b.borrowedAt.localeCompare(a.borrowedAt) || a.id.localeCompare(b.id)).map(loan => <div key={loan.id}><p>אצל {personLabel(data.people.find(person => person.id === loan.personId)!, data.people)}</p><LoanEntry today={today} loan={loan} title={book.title ?? 'ללא שם'} copyLabel={copyLabel(loan.copyId)} /></div>)}</details>}
  </section>;
}
function PersonEditor({ person, onClose }: { person?: Person; onClose: () => void }) {
  const [name, setName] = useState(person?.name ?? ''), [separate, setSeparate] = useState(false), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  return <Sheet title={person ? 'עריכת אדם' : 'הוספת אדם'} onClose={onClose} busy={busy} dirty={dirty}><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await savePerson(db, name, person, separate); onClose(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}><fieldset disabled={busy}><label className="field">שם האדם<input required maxLength={120} value={name} onChange={event => { setName(event.target.value); setDirty(true); setSeparate(false); }} /></label><label className="check"><input type="checkbox" checked={separate} onChange={event => { setSeparate(event.target.checked); setDirty(true); }} />זהו אדם נוסף, גם אם קיים אדם באותו שם</label><div className="actions"><button type="submit">שמירת האדם</button>{person && <button className="secondary" type="button" onClick={async () => { setBusy(true); setError(''); try { await archivePerson(db, person, !person.archivedAt); onClose(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>{person.archivedAt ? 'החזרת האדם מהארכיון' : 'ארכוב האדם'}</button>}</div><p className="hint">ארכוב שומר את האדם ואת היסטוריית ההשאלות שלו.</p><p className="error-message" role="alert">{error}</p></fieldset></form></Sheet>;
}
export function LoansPanel() {
  const data = useLiveQuery(async () => ({ people: await db.people.toArray(), loans: await db.loans.toArray(), copies: await db.copies.toArray(), books: await db.books.toArray() }));
  const [editor, setEditor] = useState<{ person?: Person }>();
  const today = useToday();
  if (!data) return <p role="status">טוען השאלות…</p>;
  const copies = new Map(data.copies.map(copy => [copy.id, copy])), books = new Map(data.books.map(book => [book.id, book]));
  const copyRows = data.copies;
  function entry(loan: Loan) {
    const copy = copies.get(loan.copyId), book = copy && books.get(copy.bookId);
    return <LoanEntry today={today} key={loan.id} loan={loan} title={book?.title ?? 'ללא שם'} copyLabel={copy?.label || `עותק ${copyRows.filter(item => item.bookId === copy?.bookId).findIndex(item => item.id === copy?.id) + 1}`} />;
  }
  return <section className="loans-panel"><div className="toolbar"><button onClick={() => setEditor({})}>הוספת אדם</button></div><p>השאלות מקובצות לפי אדם. כדי להשאיל, פתח ספר ובחר עותק זמין.</p>{!data.people.length && <section className="empty-state"><h2>עוד לא נוספו אנשים</h2><p>אפשר להוסיף אדם כאן או בזמן השאלת ספר.</p></section>}{[...data.people].sort((a, b) => a.name.localeCompare(b.name, 'he') || a.id.localeCompare(b.id)).map(person => {
    const loans = data.loans.filter(loan => loan.personId === person.id).sort((a, b) => b.borrowedAt.localeCompare(a.borrowedAt) || a.id.localeCompare(b.id)), open = loans.filter(loan => loan.returnedAt === null), returned = loans.filter(loan => loan.returnedAt !== null);
    return <section className="person-group" key={person.id}><div className="person-heading"><h2>{personLabel(person, data.people)}{person.archivedAt && ' · בארכיון'}</h2><button className="secondary" aria-label={'עריכת אדם ' + personLabel(person, data.people)} onClick={() => setEditor({ person })}>עריכה</button></div><p>{open.length} השאלות פתוחות</p>{open.map(entry)}{!open.length && <p>אין השאלות פתוחות לאדם זה.</p>}{returned.length > 0 && <details><summary>היסטוריית השאלות ({returned.length})</summary>{returned.map(entry)}</details>}</section>;
  })}{editor && <PersonEditor person={editor.person} onClose={() => setEditor(undefined)} />}</section>;
}
