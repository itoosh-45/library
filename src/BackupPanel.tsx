import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { downloadSnapshot, restoreSnapshot, validateBackup, type Snapshot, type ValidatedBackup } from './data/backup';
import { createFullSnapshot, recordBackupProduced, confirmBackupChecked } from './data/fullBackup';
import { mergeSnapshot, previewMerge, type MergeChoices, type MergePreview } from './data/backupMerge';
import { errorMessage } from './data/errors';
import { MergeReview } from './MergeReview';
import type { HandyBackup } from './data/handyBackup';
import { readCore } from './data/backup';
import { MAX_BACKUP_BYTES } from './data/backupFormat';

export function BackupPanel() {
  const [handy, setHandy] = useState<HandyBackup>(), [handyStats, setHandyStats] = useState<{ added: number; skipped: number }>();
  const [incoming, setIncoming] = useState<ValidatedBackup>(), [safety, setSafety] = useState<Snapshot>();
  const [openedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [message, setMessage] = useState('');
  const [mode, setMode] = useState<'replace' | 'merge'>('replace'), [preview, setPreview] = useState<MergePreview>();
  const [choices, setChoices] = useState<MergeChoices>({}), [separate, setSeparate] = useState(false);
  const backupDates = useLiveQuery(async () => ({ produced: (await db.settings.get('lastBackupAt'))?.value, checked: (await db.settings.get('lastBackupCheckedAt'))?.value }));
  function reset() { setHandy(undefined); setHandyStats(undefined); setIncoming(undefined); setSafety(undefined); setPreview(undefined); setConfirmed(false); setChoices({}); setSeparate(false); }
  async function backup(protect = false) {
    setBusy(true); setMessage('');
    try {
      const snapshot = await createFullSnapshot(db); downloadSnapshot(snapshot, protect ? 'before-restore' : 'library-backup');
      await recordBackupProduced(db, JSON.parse(snapshot.text).exportedAt);
      if (protect) { setSafety(snapshot); setConfirmed(false); }
      setMessage('הגיבוי הוכן להורדה. ודא שהוא נשמר במחשב.');
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  async function handyExport() {
    setBusy(true); setMessage('');
    try { const { createHandyBackup, downloadHandyBackup } = await import('./data/handyBackup'); downloadHandyBackup(await createHandyBackup(db)); setMessage('גיבוי Handy Library הוכן להורדה.'); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  async function inspect(file?: File) {
    if (!file) return; setBusy(true); reset(); setMode('replace'); setMessage('');
    try { if (file.size > MAX_BACKUP_BYTES) throw new Error('הגיבוי גדול מדי. בחר קובץ עד 150 מגה־בייט.'); if (/\.zip$/i.test(file.name)) {
        const { inspectHandyBackup, mergeHandyCore } = await import('./data/handyBackup');
        const checked = await inspectHandyBackup(new Uint8Array(await file.arrayBuffer()));
        setHandy(checked); setIncoming(checked.backup); setMode('merge');
        const plan = mergeHandyCore(await db.transaction('r', db.tables, () => readCore(db)), checked.backup.data);
        setHandyStats({ added: plan.added, skipped: plan.skipped });
      } else setIncoming(await validateBackup(await file.text())); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  async function changeMode(next: 'replace' | 'merge') {
    setMode(next); setSafety(undefined); setConfirmed(false); setPreview(undefined); setChoices({}); setSeparate(false); setMessage('');
    if (next !== 'merge' || !incoming) return;
    setBusy(true); try {
      if (handy) { const { mergeHandyCore } = await import('./data/handyBackup'); const plan = mergeHandyCore(await db.transaction('r', db.tables, () => readCore(db)), incoming.data); setHandyStats({ added: plan.added, skipped: plan.skipped }); }
      else setPreview(await previewMerge(db, incoming));
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  const resolved = !!handy || !!preview && preview.conflicts.every(conflict => !!choices[conflict.key]) && (!(preview.duplicateBooks.length || preview.renamedCollections.length) || separate);
  async function restore() {
    if (!incoming || !safety || !confirmed || (mode === 'merge' && !resolved)) return; setBusy(true); setMessage('');
    try {
      if (handy) {
        const { importHandyBackup } = await import('./data/handyBackup');
        const result = await importHandyBackup(db, handy, mode, safety.fingerprint);
        reset(); setMessage(`ייבוא Handy Library הושלם: ${result.added} ספרים נוספו, ${result.skipped} כפילויות דולגו.`); return;
      }
      if (mode === 'merge') {
        if (preview!.fingerprint !== safety.fingerprint) throw new Error('הספרייה השתנתה מאז התצוגה המקדימה. בחר שוב מיזוג לבדיקה חדשה.');
        await mergeSnapshot(db, incoming, safety.fingerprint, choices, separate);
      } else await restoreSnapshot(db, incoming, safety.fingerprint);
      reset(); setMessage(mode === 'merge' ? 'הגיבוי מוזג בהצלחה. הנתונים הקיימים נשמרו.' : 'הספרייה שוחזרה בהצלחה.');
    } catch (error) { setSafety(undefined); setConfirmed(false); setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  async function checked() {
    if (!backupDates?.produced) return;
    setBusy(true); try { await confirmBackupChecked(db, backupDates.produced); setMessage('נרשם אישורך ששמרת ובדקת את הקובץ.'); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  const overdue = !backupDates?.produced || openedAt - Date.parse(backupDates.produced) >= 30 * 86400000;
  return <section className="setting-note" data-update-blocked={busy || !!incoming}><h3>גיבוי ושחזור</h3><p>גיבוי מלא של הספרים, העותקים, המחברים, המדפים, התגיות, הז׳אנרים, הסדרות, האנשים, היסטוריית ההשאלות, מקורות המידע שנבחרו, התמונות, טיוטות צילום המדף וההגדרות. הקובץ אינו מוצפן וכולל מידע אישי. שמור במקום שבחרת ובדוק אותו לפני ניקוי הדפדפן.</p>
    <p>גיבוי אחרון שהופק: {backupDates?.produced ? new Date(backupDates.produced).toLocaleString('he') : 'טרם הופק'}. הפקת קובץ אינה הוכחה שנשמר עותק בטוח.</p>
    {backupDates?.checked && <p>קובץ שאישרת שנשמר ונבדק: {new Date(backupDates.checked).toLocaleString('he')}</p>}
    {overdue && <p className="notice">מומלץ להפיק גיבוי עכשיו; לא נרשם גיבוי ב־30 הימים האחרונים.</p>}
    <fieldset disabled={busy}><button type="button" onClick={() => void backup()}>הורדת גיבוי הספרייה</button>
    <button type="button" className="secondary" onClick={() => void handyExport()}>הורדת גיבוי Handy Library · ZIP</button>
    <p>פורמט Handy Library כולל רק את השדות והתמונות הנתמכים בו, ללא שדות נוספים של האפליקציה.</p>
    {backupDates?.produced && backupDates.checked !== backupDates.produced && <button type="button" className="secondary" onClick={() => void checked()}>שמרתי ובדקתי את קובץ הגיבוי האחרון</button>}
    <label className="field">בחירת גיבוי לשחזור<input type="file" accept=".json,.zip,application/json,application/zip" onChange={event => { void inspect(event.target.files?.[0]); event.target.value = ''; }} /></label>
    {incoming && <section className="notice"><h3>תצוגה מקדימה: {incoming.libraryName}</h3><p>{incoming.counts.books} ספרים · {incoming.counts.copies} עותקים · {incoming.counts.authors} מחברים · {incoming.counts.images} תמונות · {incoming.counts.shelves} מדפים · {incoming.counts.bookShelves} שיוכים למדפים · {incoming.counts.tags} תגיות · {incoming.counts.genres} ז׳אנרים · {incoming.counts.series} סדרות · {incoming.counts.people} אנשים · {incoming.counts.loans} השאלות, כולל היסטוריה · {incoming.counts.metadataSources} מקורות מידע · {incoming.counts.recognitionDrafts} טיוטות צילום מדף</p>
      <label className="field">אופן הייבוא<select value={mode} onChange={event => void changeMode(event.target.value as 'replace' | 'merge')}><option value="replace">החלפת הספרייה</option><option value="merge">{handy ? 'הוספה ודילוג על כפילויות' : 'מיזוג עם הספרייה'}</option></select></label>
      {handy && handy.warnings.map(warning => <p key={warning}>{warning}</p>)}
      {handy && mode === 'merge' && handyStats && <p>{handyStats.added} ספרים יתווספו · {handyStats.skipped} כפילויות ידולגו. הנתונים הקיימים נשמרים.</p>}
      {mode === 'replace' ? <><p>גיבוי ישן ללא אנשים, השאלות, מקורות מידע או טיוטות צילום מדף יחליף את הרשימות החסרות ברשימות ריקות.</p><p>הנתונים הנוכחיים יוחלפו. עד האישור הסופי לא מתבצע שינוי.</p></> : preview && <MergeReview preview={preview} choices={choices} onChoice={(key, value) => setChoices(previous => { const next = { ...previous }; if (value) next[key] = value; else delete next[key]; return next; })} separate={separate} onSeparate={setSeparate} />}
      <button type="button" className="secondary" disabled={mode === 'merge' && !handy && !preview} onClick={() => void backup(true)}>הורדת גיבוי מגן לפני החלפה</button>
      {safety && <><p>בספרייה הנוכחית: {safety.counts.books} ספרים ו־{safety.counts.copies} עותקים.</p><label className="check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{mode === 'replace' ? 'וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה' : 'וידאתי שהגיבוי ירד למחשב ואני מאשר מיזוג'}</label><button type="button" disabled={!confirmed || (mode === 'merge' && !resolved)} onClick={() => void restore()}>{mode === 'replace' ? 'החלפת הספרייה ושחזור' : 'מיזוג הגיבוי לאחר הסקירה'}</button></>}
      <button type="button" className="secondary" onClick={reset}>ביטול השחזור</button></section>}</fieldset><p className="form-status" aria-live="polite">{message}</p></section>;
}
