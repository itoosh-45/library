import { useState } from 'react';
import { db } from './data/database';
import { downloadSnapshot, restoreSnapshot, type Snapshot } from './data/backup';
import { createFullSnapshot, recordBackupProduced } from './data/fullBackup';
import { mergeSnapshot, previewMerge, type MergeChoices, type MergePreview } from './data/backupMerge';
import { downloadWorkbook, exportWorkbook, fullWorkbookCandidate, readWorkbook, simpleWorkbook, writeWorkbook, WorkbookValidationError, type ReadWorkbook, type WorkbookCandidate, type WorkbookIssue } from './data/xlsxWorkbook';
import { simpleWorkbookCandidate } from './data/xlsxSimple';
import { simpleFields, simpleFieldLabels, suggestedMapping, type SimpleField } from './data/xlsxSchema';
import { XLSX_LIMITS } from './data/xlsxZip';
import { errorMessage } from './data/errors';
import { MergeReview } from './MergeReview';

export default function ExcelPanel() {
  const [input, setInput] = useState<ReadWorkbook>(), [candidate, setCandidate] = useState<WorkbookCandidate>(), [preview, setPreview] = useState<MergePreview>();
  const [mapping, setMapping] = useState<Record<string, SimpleField>>({}), [choices, setChoices] = useState<MergeChoices>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [issues, setIssues] = useState<WorkbookIssue[]>([]);
  const [separate, setSeparate] = useState(false), [acknowledged, setAcknowledged] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge'), [safety, setSafety] = useState<Snapshot>();
  async function action(work: () => Promise<void>) {
    setBusy(true); setMessage(''); setIssues([]);
    try { await work(); } catch (error) { setMessage(errorMessage(error)); if (error instanceof WorkbookValidationError) setIssues(error.issues); }
    finally { setBusy(false); }
  }
  function resetPreview() { setCandidate(undefined); setPreview(undefined); setSafety(undefined); setChoices({}); setSeparate(false); setAcknowledged(false); setConfirmed(false); }
  async function prepare(source: ReadWorkbook, selected: Record<string, SimpleField>) {
    const next = source.full ? await fullWorkbookCandidate(db, source) : await simpleWorkbookCandidate(db, source, selected);
    const plan = await previewMerge(db, next.backup); setCandidate(next); setPreview(plan);
  }
  async function inspect(file: File) {
    resetPreview(); setInput(undefined); setMode('merge');
    if (file.size > XLSX_LIMITS.file) throw new Error('בחר קובץ XLSX עד 10MiB.');
    const source = await readWorkbook(new Uint8Array(await file.arrayBuffer())); setInput(source);
    const selected = suggestedMapping(source.headers); setMapping(selected);
    if (source.full) await prepare(source, selected);
  }
  const resolved = preview && preview.conflicts.every(conflict => choices[conflict.key]) && (!(preview.duplicateBooks.length || preview.renamedCollections.length) || separate);
  async function commit() {
    if (!candidate || !preview || !safety || !acknowledged || !confirmed) return;
    try {
      if (preview.fingerprint !== safety.fingerprint) throw new Error('הספרייה השתנתה מאז הסקירה. בצע בדיקה מחדש והפק גיבוי מגן חדש.');
      if (mode === 'merge') await mergeSnapshot(db, candidate.backup, safety.fingerprint, choices, separate);
      else await restoreSnapshot(db, candidate.backup, safety.fingerprint);
      resetPreview(); setInput(undefined); setMessage('ייבוא Excel הושלם בהצלחה.');
    } catch (error) { setSafety(undefined); setConfirmed(false); throw error; }
  }
  return <section className="backup-panel excel-panel" data-update-blocked={busy || Boolean(input) ? 'true' : undefined}><h3>Excel — יצוא וייבוא טבלאיים</h3>
    <p>Excel מעביר את הנתונים הטבלאיים והיסטוריית ההשאלות. ImageRefs מכיל הפניות בלבד; תמונות וטִיוטות צילום מדף דורשות גיבוי JSON. הקובץ כולל מידע אישי ואינו מוצפן.</p>
    <fieldset disabled={busy}>
      <button type="button" onClick={() => void action(async () => { const output = await exportWorkbook(db); downloadWorkbook(output.bytes, 'library-tables'); setMessage('הופק קובץ Excel. ודא ששמרת אותו; תמונות אינן כלולות.'); })}>יצוא הספרייה ל־Excel</button>
      <button type="button" className="secondary" onClick={() => { downloadWorkbook(writeWorkbook(simpleWorkbook()), 'Books-template'); setMessage('בתבנית יש שורת דוגמה: מחק אותה לפני הייבוא. מחברים מופרדים באמצעות ; ותאריכים הם טקסט ISO.'); }}>הורדת תבנית Books פשוטה</button>
      <a href={`${import.meta.env.BASE_URL}templates/full-example.xlsx`} download>הורדת דוגמה מלאה סינתטית</a>
      <label className="field">בחירת Excel לייבוא<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void action(() => inspect(file)); }} /></label>
      {input && !input.full && <section><h4>מיפוי עמודות — {input.sheet}</h4><p>בחר שדה לכל עמודה או התעלם ממנה. מזהים כמו ISBN ודאנאקוד חייבים להיות תאי טקסט כדי לשמור אפסים מובילים. מייבאים ערכים בלבד; אין הרצת נוסחאות.</p>
        {input.headers.map(header => <label className="field" key={header}>עמודה: {header}<select value={mapping[header] ?? ''} onChange={event => { resetPreview(); setMapping(previous => { const next = { ...previous }; if (event.target.value) next[header] = event.target.value as SimpleField; else delete next[header]; return next; }); }}><option value="">התעלם מעמודה</option>{simpleFields.map(field => <option key={field} value={field}>{simpleFieldLabels[field]}</option>)}</select></label>)}
        <button type="button" onClick={() => void action(() => prepare(input, mapping))}>בדיקת המיפוי ותצוגה מקדימה</button></section>}
      {candidate && preview && <section><h4>תצוגה מקדימה של Excel</h4><p>{candidate.backup.counts.books} ספרים, {candidate.backup.counts.copies} עותקים, {candidate.backup.counts.loans} השאלות.</p>
        {candidate.warnings.map(warning => <p key={warning}>{warning}</p>)}
        {input?.full && <label className="field">דרך ייבוא Excel<select aria-label="דרך ייבוא Excel" value={mode} onChange={event => { setMode(event.target.value as 'merge' | 'replace'); setSafety(undefined); setConfirmed(false); }}><option value="merge">מיזוג ושמירת הספרייה הנוכחית</option><option value="replace">החלפת הספרייה (כולל הסרת טיוטות ותמונות שאינן בקובץ)</option></select></label>}
        {mode === 'merge' ? <MergeReview preview={preview} choices={choices} onChoice={(key, value) => setChoices(previous => { const next = { ...previous }; if (value) next[key] = value; else delete next[key]; return next; })} separate={separate} onSeparate={setSeparate} /> : <p>הספרייה תוחלף בנתונים הטבלאיים בקובץ. טיוטות צילום מדף וקובצי תמונה שאינם תואמים יוסרו; ניתן להשיב אותם מהגיבוי המגן ב־JSON.</p>}
        <label className="check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />הבנתי את מגבלת התמונות והטיוטות ובדקתי את הסקירה</label>
        <button type="button" className="secondary" onClick={() => void action(async () => { const snapshot = await createFullSnapshot(db); downloadSnapshot(snapshot, 'before-excel-import'); await recordBackupProduced(db, JSON.parse(snapshot.text).exportedAt); setSafety(snapshot); setConfirmed(false); })}>הורדת גיבוי JSON מגן לפני ייבוא Excel</button>
        {safety && <label className="check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />שמרתי את הגיבוי ואני מאשר את ייבוא Excel</label>}
        <button type="button" disabled={!safety || !confirmed || !acknowledged || (mode === 'merge' && !resolved)} onClick={() => void action(commit)}>אישור ושמירת ייבוא Excel</button>
        <button type="button" className="secondary" onClick={() => void action(async () => { resetPreview(); if (input) await prepare(input, mapping); })}>בדיקה מחדש של Excel מול הספרייה</button>
      </section>}
      {input && <button type="button" className="secondary" onClick={() => { resetPreview(); setInput(undefined); setIssues([]); setMessage('ייבוא Excel בוטל.'); }}>ביטול ייבוא Excel</button>}
    </fieldset>
    {issues.length > 0 && <table><caption>שגיאות בקובץ — אין שמירה</caption><thead><tr><th>גיליון</th><th>שורה</th><th>עמודה</th><th>בעיה</th></tr></thead><tbody>{issues.map((issue, index) => <tr key={index}><td>{issue.sheet}</td><td>{issue.row || '—'}</td><td>{issue.column}</td><td>{issue.message}</td></tr>)}</tbody></table>}
    <p className="form-status" aria-live="polite">{message}</p>
  </section>;
}
