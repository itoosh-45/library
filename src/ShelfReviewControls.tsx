import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CatalogPanel } from './CatalogPanel';
import { db } from './data/database';
import { duplicateBooks, readingStates } from './data/books';
import { emptyReview, reviewWithCatalog } from './data/draftReviewValues';
import { recognitionFields, recognitionInput, recognitionMetadataFields, type RecognitionField } from './data/recognition';
import { setItemStatus, updateItemReview } from './data/shelfReview';
import type { DraftItem, DraftReview, RecognitionDraft } from './data/models';
import { errorMessage } from './data/errors';

const labels = { title: 'שם הספר', subtitle: 'כותרת משנה', isbn: 'ISBN', danacode: 'דאנאקוד', publisher: 'הוצאה לאור', publicationYear: 'שנת הוצאה', edition: 'מהדורה', volume: 'כרך', language: 'שפה', pages: 'מספר עמודים' } as const;
const originLabels = { title: 'שם', authors: 'מחברים', isbn: 'ISBN', danacode: 'דאנאקוד', publisher: 'הוצאה' };
export default function ShelfReviewControls({ draft, row, index, disabled, onDirty }: { draft: RecognitionDraft; row: DraftItem; index: number; disabled: boolean; onDirty(id: string, dirty: boolean): void }) {
  const [review, setReview] = useState<DraftReview>(() => structuredClone(row.review ?? emptyReview()));
  const [selected, setSelected] = useState<RecognitionField[]>(row.selectedFields), [baseRevision, setBaseRevision] = useState(draft.revision);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [open, setOpen] = useState(false);
  const data = useLiveQuery(async () => open ? ({ books: await db.books.toArray(), duplicates: review.decision === 'new' ? await duplicateBooks(db, review.input) : [] }) : ({ books: [], duplicates: [] }), [open, review.input.isbn, review.decision]);
  function changed(value: DraftReview) { setReview(value); setDirty(true); onDirty(row.id, true); setMessage(''); }
  function reset() { setReview(structuredClone(row.review ?? emptyReview())); setSelected([...row.selectedFields]); setBaseRevision(draft.revision); setDirty(false); onDirty(row.id, false); setMessage('ערכי הפריט נטענו מחדש מהטיוטה.'); }
  async function act(run: () => Promise<void>) { setBusy(true); setMessage(''); try { await run(); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } }
  function chooseImage(field: RecognitionField, checked: boolean) {
    const next = checked ? [...selected, field] : selected.filter(item => item !== field), input = checked ? recognitionInput(review.input, row.item, [field]) : { ...review.input };
    if (!checked && JSON.stringify(input[field]) === JSON.stringify(field === 'authors' ? row.item.authors : row.item[field])) { if (field === 'authors') input.authors = []; else input[field] = ''; }
    const replaced = recognitionMetadataFields(row.item, [field]).map(value => value.startsWith('isbn') ? 'isbn' : value);
    const catalogs = checked ? review.catalogs.map(selection => ({ ...selection, selected: selection.selected.filter(value => !replaced.includes(value.startsWith('isbn') ? 'isbn' : value)) })).filter(selection => selection.selected.length) : review.catalogs;
    setSelected(next); changed({ ...review, input, catalogs });
  }
  if (row.status === 'saved') return <p className="hint">הפריט נשמר בספרייה. חידוש או שמירה חוזרת אינם מוסיפים אותו שוב.</p>;
  if (row.status === 'removed') return <p className="hint">הפריט הוסר מרשימת השמירה. ראיות המקור נשארו בטיוטה.</p>;
  const inactive = disabled || busy, stale = baseRevision !== draft.revision;
  return <details open={open} onToggle={event => { const value = event.currentTarget.open; if (value && !open && !dirty) reset(); setOpen(value); }}>
    <summary>סקירת פריט {index + 1} · {row.status === 'approved' ? 'מאושר לשמירה' : row.status === 'reviewed' ? 'נבדק, ממתין לאישור' : 'זוהה, ממתין לבדיקה'}</summary>
    {open && <><p className="hint">בחר שדות שנראו בתמונה או ערוך ידנית. שמירת הערכים כאן מעדכנת טיוטה; אישור ושמירה לספרייה הם פעולות נפרדות.</p>
      {stale && <p role="alert">הטיוטה השתנתה מאז פתיחת הפריט. טען אותו מחדש לפני אישור.</p>}
      <fieldset disabled={inactive || review.decision === 'copy'}><legend>שדות מהתמונה לפריט {index + 1}</legend>{recognitionFields.filter(field => field === 'authors' ? row.item.authors.length : row.item[field]).map(field => <label className="check" key={field}><input type="checkbox" checked={selected.includes(field)} onChange={event => chooseImage(field, event.target.checked)} />{originLabels[field]} מהתמונה לפריט {index + 1}: {field === 'authors' ? row.item.authors.join(' · ') : row.item[field]}</label>)}</fieldset>
      <fieldset disabled={inactive || review.decision === 'copy'}><legend>ערכי פריט {index + 1}</legend><div className="field-grid">{Object.entries(labels).map(([field, label]) => <label className="field" key={field}>{label} לפריט {index + 1}<input value={review.input[field as keyof typeof labels]} maxLength={1000} dir={['isbn', 'danacode'].includes(field) ? 'ltr' : undefined} inputMode={['pages','publicationYear'].includes(field) ? 'numeric' : undefined} onChange={event => changed({ ...review, input: { ...review.input, [field]: event.target.value } })} /></label>)}</div>
        <label className="field">מחברים לפריט {index + 1}, שם בכל שורה<textarea value={review.input.authors.join('\n')} onChange={event => changed({ ...review, input: { ...review.input, authors: event.target.value.split('\n') } })} /></label>
        <label className="field">הערות אישיות לפריט {index + 1}<textarea maxLength={20000} value={review.input.personalNotes} onChange={event => changed({ ...review, input: { ...review.input, personalNotes: event.target.value } })} /></label>
        <label className="field">מצב קריאה לפריט {index + 1}<select value={review.input.readStatus} onChange={event => changed({ ...review, input: { ...review.input, readStatus: event.target.value as DraftReview['input']['readStatus'] } })}>{Object.entries(readingStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </fieldset>
      <CatalogPanel key={JSON.stringify([review.input.title, review.input.authors, review.input.isbn, review.input.danacode, review.input.publisher, review.input.publicationYear])} input={review.input} disabled={inactive || review.decision === 'copy'} onApply={(input, candidate, fields) => { const groups = new Set(fields.map(field => field.startsWith('isbn') ? 'isbn' : field)); setSelected(selected.filter(field => !recognitionMetadataFields(row.item, [field]).some(value => groups.has(value.startsWith('isbn') ? 'isbn' : value)))); changed(reviewWithCatalog(review, input, candidate, fields)); }} />
      <fieldset disabled={inactive}><legend>החלטת פריט {index + 1}</legend><label className="field">מה לשמור לפריט {index + 1}<select value={review.decision ?? ''} onChange={event => { const decision = event.target.value as DraftReview['decision']; if (decision === 'copy') setSelected([]); changed({ ...review, decision: decision || null, targetBookId: null, targetRevision: null, allowDuplicate: false, catalogs: decision === 'copy' ? [] : review.catalogs }); }}><option value="">בחר החלטה</option><option value="new">ספר חדש ועותק ראשון</option><option value="copy">עוד עותק של ספר קיים</option></select></label>
        {review.decision === 'copy' && <><p className="hint">פרטי הספר הקיים נשמרים. מקור הצילום יתועד עם העותק הנוסף.</p><label className="field">ספר היעד לפריט {index + 1}<select value={review.targetBookId ?? ''} onChange={event => { const target = data?.books.find(book => book.id === event.target.value); changed({ ...review, targetBookId: target?.id ?? null, targetRevision: target?.revision ?? null }); }}><option value="">בחר ספר</option>{data?.books.map(book => <option key={book.id} value={book.id}>{book.title ?? 'ללא שם'}{book.volume ? ' · כרך ' + book.volume : ''}{book.isbn13 || book.isbn10 ? ' · ' + (book.isbn13 ?? book.isbn10) : ''}</option>)}</select></label></>}
        {review.decision === 'new' && <>{!!data?.duplicates.length && <p role="alert">ISBN זה נמצא בספרייה: {data.duplicates.map(book => book.title ?? 'ללא שם').join(' · ')}. בדוק אם נדרש עותק נוסף.</p>}<label className="check"><input type="checkbox" checked={review.allowDuplicate} onChange={event => changed({ ...review, allowDuplicate: event.target.checked })} />אני מאשר ספר חדש נפרד גם אם ISBN זה קיים — פריט {index + 1}</label></>}
      </fieldset>
      <div className="actions"><button type="button" disabled={inactive || !dirty || stale} onClick={() => void act(async () => { const revision = await updateItemReview(db, draft.id, row.id, baseRevision, review, selected); setBaseRevision(revision); setDirty(false); onDirty(row.id, false); setMessage('ערכי הפריט נשמרו בטיוטה. דרוש אישור נפרד.'); })}>עדכון טיוטת פריט {index + 1}</button>
        <button type="button" disabled={inactive || dirty || stale || row.status !== 'reviewed' || !row.review?.decision} onClick={() => void act(async () => { const revision = await setItemStatus(db, draft.id, row.id, baseRevision, 'approved'); setBaseRevision(revision); setMessage('הפריט אושר. הוא יתווסף רק בשמירת המאושרים.'); })}>אישור פריט {index + 1}</button>
        <button type="button" className="secondary" disabled={inactive} onClick={reset}>טעינה מחדש וויתור על עריכות פריט {index + 1}</button>
        <button type="button" className="secondary" disabled={inactive || dirty || stale} onClick={() => void act(async () => { await setItemStatus(db, draft.id, row.id, baseRevision, 'removed'); setMessage('הפריט הוסר מרשימת השמירה.'); })}>הסרת פריט {index + 1}</button>
      </div>
    </>}{message && <p role="status" className="form-status">{message}</p>}
  </details>;
}
