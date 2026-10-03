import type { MergeChoices, MergePreview } from './data/backupMerge';

export function MergeReview({ preview, choices, onChoice, separate, onSeparate }: {
  preview: MergePreview; choices: MergeChoices; onChoice: (key: string, value: 'current' | 'incoming' | '') => void;
  separate: boolean; onSeparate: (value: boolean) => void;
}) {
  return <section aria-label="סקירת מיזוג"><p>יתווספו {preview.additions} רשומות; {preview.unchanged} זהות; {preview.conflicts.length} סתירות דורשות בחירה. שם הספרייה וההגדרות המקומיות נשמרים. רשומות שאינן בקובץ לא נמחקות.</p>
    {!!preview.duplicateBooks.length && <><h4>ספרים דומים שיישמרו בנפרד</h4><ul>{preview.duplicateBooks.map((title, index) => <li key={index}>{title}</li>)}</ul><p>שם או מזהה דומה אינם הוכחה לאותה מהדורה. אין איחוד ספרים או עותקים אוטומטי.</p></>}
    {!!preview.renamedCollections.length && <><h4>שמות אוספים נפרדים מוצעים</h4><ul>{preview.renamedCollections.map(name => <li key={name}>{name}</li>)}</ul></>}
    {(!!preview.duplicateBooks.length || !!preview.renamedCollections.length) && <label className="check"><input type="checkbox" checked={separate} onChange={event => onSeparate(event.target.checked)} />אני מאשר לשמור את הספרים והאוספים הדומים בנפרד</label>}
    {preview.conflicts.map(conflict => <section className="notice" key={conflict.key}><h4>{conflict.label}</h4><p>{conflict.table} · גרסה קיימת {conflict.currentRevision ?? 'ללא מספר'} · גרסה בקובץ {conflict.incomingRevision ?? 'ללא מספר'}</p><details><summary>השוואת הנתונים בסתירה</summary><p>בספרייה</p><pre className="visible-text">{conflict.current}</pre><p>בקובץ</p><pre className="visible-text">{conflict.incoming}</pre></details><label className="field">בחירת גרסה: {conflict.label}<select value={choices[conflict.key] ?? ''} onChange={event => onChoice(conflict.key, event.target.value as 'current' | 'incoming' | '')}><option value="">בחר לפני מיזוג</option><option value="current">שמירת הקיימת</option><option value="incoming">הנתונים מהקובץ</option></select></label></section>)}
  </section>;
}
