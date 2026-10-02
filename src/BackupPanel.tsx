import { useState } from 'react';
import { db } from './data/database';
import { createSnapshot, downloadSnapshot, restoreSnapshot, validateBackup, type Snapshot, type ValidatedBackup } from './data/backup';
import { errorMessage } from './data/errors';

export function BackupPanel() {
  const [incoming, setIncoming] = useState<ValidatedBackup>(), [safety, setSafety] = useState<Snapshot>();
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [message, setMessage] = useState('');
  async function backup(protect = false) {
    setBusy(true); setMessage(''); try { const snapshot = await createSnapshot(db); downloadSnapshot(snapshot, protect ? 'before-restore' : 'library-backup'); if (protect) setSafety(snapshot); setMessage('הגיבוי הוכן להורדה. ודא שהוא נשמר במחשב.'); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  async function inspect(file?: File) {
    if (!file) return; setBusy(true); setIncoming(undefined); setSafety(undefined); setConfirmed(false); setMessage('');
    try { if (file.size > 100 * 1024 * 1024) throw new Error('הגיבוי גדול מדי. בחר קובץ עד 100 מגה־בייט.'); setIncoming(await validateBackup(await file.text())); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  async function restore() {
    if (!incoming || !safety || !confirmed) return; setBusy(true); setMessage('');
    try { await restoreSnapshot(db, incoming, safety.fingerprint); setIncoming(undefined); setSafety(undefined); setConfirmed(false); setMessage('הספרייה שוחזרה בהצלחה.'); } catch (error) { setSafety(undefined); setConfirmed(false); setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  return <section className="setting-note"><h3>גיבוי ושחזור</h3><p>גיבוי בסיסי של הספרים, העותקים, המחברים, המדפים, התגיות, הז׳אנרים, הסדרות, האנשים, היסטוריית ההשאלות, התמונות וההגדרות. שמור את הקובץ במחשב לפני ניקוי הדפדפן. שחזור מחליף את הספרייה הנוכחית.</p><fieldset disabled={busy}><button type="button" onClick={() => void backup()}>הורדת גיבוי הספרייה</button><label className="field">בחירת גיבוי לשחזור<input type="file" accept=".json,application/json" onChange={event => { void inspect(event.target.files?.[0]); event.target.value = ''; }} /></label>
    {incoming && <section className="notice"><h3>תצוגה מקדימה: {incoming.libraryName}</h3><p>{incoming.counts.books} ספרים · {incoming.counts.copies} עותקים · {incoming.counts.authors} מחברים · {incoming.counts.images} תמונות · {incoming.counts.shelves} מדפים · {incoming.counts.bookShelves} שיוכים למדפים · {incoming.counts.tags} תגיות · {incoming.counts.genres} ז׳אנרים · {incoming.counts.series} סדרות · {incoming.counts.people} אנשים · {incoming.counts.loans} השאלות, כולל היסטוריה</p><p>גיבוי ישן ללא אנשים והשאלות יחליף אותם ברשימות ריקות.</p><p>הנתונים הנוכחיים יוחלפו. עד האישור הסופי לא מתבצע שינוי.</p><button type="button" className="secondary" onClick={() => void backup(true)}>הורדת גיבוי מגן לפני החלפה</button>{safety && <><p>בספרייה הנוכחית: {safety.counts.books} ספרים ו־{safety.counts.copies} עותקים.</p><label className="check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה</label><button type="button" disabled={!confirmed} onClick={() => void restore()}>החלפת הספרייה ושחזור</button></>}<button type="button" className="secondary" onClick={() => { setIncoming(undefined); setSafety(undefined); setConfirmed(false); }}>ביטול השחזור</button></section>}</fieldset><p className="form-status" aria-live="polite">{message}</p></section>;
}
