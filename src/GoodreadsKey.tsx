import { useState } from 'react';
import { forgetGoodreadsKey, goodreadsConfigured, rememberGoodreadsKey } from './data/goodreads';
import { errorMessage } from './data/errors';
export default function GoodreadsKey() {
  const [ready, setReady] = useState(goodreadsConfigured), [value, setValue] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  return <section data-update-blocked={busy || !!value}><p className="hint">Goodreads משלים פרטי ספר וכריכות בחיפוש הרגיל. זמינות המידע תלויה במקור. מפתח הגישה נשמר במכשיר בנפרד מהספרים והגיבויים.</p>
    {ready ? <><p>חיבור Goodreads מוגדר במכשיר הזה.</p><button type="button" className="secondary" disabled={busy} onClick={async () => { setBusy(true); try { await forgetGoodreadsKey(); setReady(false); setMessage('מפתח הגישה נמחק מהמכשיר.'); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } }}>מחיקת מפתח Goodreads</button></> : <form onSubmit={async event => { event.preventDefault(); setBusy(true); try { await rememberGoodreadsKey(value); setReady(true); setValue(''); setMessage('מפתח הגישה נשמר. החיבור ייבדק בחיפוש הבא.'); } catch (error) { setReady(goodreadsConfigured()); setValue(''); setMessage(errorMessage(error)); } finally { setBusy(false); } }}><label className="field">מפתח גישה ל־Goodreads<input type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" dir="ltr" maxLength={64} value={value} onChange={event => setValue(event.target.value)} /></label><button type="submit" disabled={busy || !value.trim()}>שמירת מפתח Goodreads</button></form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
