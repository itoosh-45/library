import { useState } from 'react';
import { db } from './data/database';
import { resetLibraryBooks } from './data/reset';
import { errorMessage } from './data/errors';

export function ResetLibrary({ onReset }: { onReset: () => void }) {
  const [confirming, setConfirming] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function reset() {
    if (!confirmed || busy) return;
    setBusy(true); setMessage('');
    try { await resetLibraryBooks(db); onReset(); setConfirming(false); setConfirmed(false); setMessage('הספרים והתמונות נמחקו. אפשר להתחיל ספרייה חדשה.'); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <section data-update-blocked={busy || confirming}>
    <button type="button" className="secondary" disabled={busy} onClick={() => { setConfirming(true); setConfirmed(false); setMessage(''); }}>איפוס מידע</button>
    {confirming && <div className="notice"><h3>מחיקת כל הספרים והתמונות</h3><p>כל הספרים, העותקים, התמונות, טיוטות הסריקה והיסטוריית ההשאלות בספרייה המקומית בדפדפן הזה יימחקו. המדפים, הסדרות, ההגדרות והמפתחות האישיים יישמרו. אפשר להוריד גיבוי באזור ״גיבוי ושחזור הספרייה״ לפני המחיקה.</p>
      <label className="check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />אני מאשר מחיקת כל הספרים והתמונות והמידע המשויך להם</label>
      <div className="actions"><button type="button" disabled={!confirmed || busy} onClick={() => void reset()}>{busy ? 'מוחק…' : 'מחיקה סופית ואיפוס'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setConfirming(false); setConfirmed(false); }}>ביטול</button></div>
    </div>}
    <p role="status">{message}</p>
  </section>;
}
