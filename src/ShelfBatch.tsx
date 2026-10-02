import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sheet } from './Sheet';
import VisionKey from './VisionKey';
import { db } from './data/database';
import { createDraft, overlapSuggestions, removeDraftSource, retryDraftImage, ShelfQueue } from './data/shelfDraft';
import { personalVisionSession } from './data/vision';
import { errorMessage } from './data/errors';

const imageLabels = { pending: 'ממתינה', processing: 'בזיהוי', recognized: 'התוצאה נשמרה בטיוטה', error: 'נדרש טיפול', interrupted: 'בקשה שנקטעה' };
function SourcePreview({ imageId, storedImageId, queue }: { imageId: string; storedImageId: string | null; queue: ShelfQueue }) {
  const stored = useLiveQuery(async () => storedImageId ? await db.images.get(storedImageId) : undefined, [storedImageId]);
  const blob = stored?.blob ?? queue.file(imageId);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { if (!blob || !ref.current) return; const url = URL.createObjectURL(blob); ref.current.src = url; return () => URL.revokeObjectURL(url); }, [blob]);
  return blob ? <img ref={ref} className="vision-prepared" alt="מקור תמונת המדף לבדיקה" /> : <p className="hint">מקור התמונה אינו זמין אחרי סגירה אם לא בחרת לשמור אותו.</p>;
}
export default function ShelfBatch({ onClose }: { onClose(): void }) {
  const [queue] = useState(() => new ShelfQueue(db, personalVisionSession));
  const [draftId, setDraftId] = useState<string>(), [shelfId, setShelfId] = useState(''), [keepSource, setKeepSource] = useState(false);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(personalVisionSession.ready), [message, setMessage] = useState('');
  const [previewId, setPreviewId] = useState<string>();
  const activeDraft = useRef<string | undefined>(undefined);
  const data = useLiveQuery(async () => ({ drafts: await db.recognitionDrafts.orderBy('updatedAt').reverse().toArray(), shelves: await db.shelves.toArray() }));
  const draft = data?.drafts.find(row => row.id === draftId), overlaps = draft ? overlapSuggestions(draft) : [];
  useEffect(() => { activeDraft.current = draftId; }, [draftId]);
  useEffect(() => {
    // StrictMode rehearses effect cleanup/mount; reopening the lifecycle never resets a quota stop.
    queue.activate();
    return () => { if (queue.active && activeDraft.current) void queue.pause(activeDraft.current).catch(() => {}); queue.dispose(); };
  }, [queue]);
  async function action(run: () => Promise<void>) { setBusy(true); setMessage(''); try { await run(); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } }
  async function add(files: FileList | null) {
    if (!files || !draftId) return;
    // File handles stay compressed; decode and optional persistence happen one at a time.
    const selected = Array.from(files);
    await action(async () => { for (const file of selected) await queue.addFile(draftId, file, keepSource); setMessage('התמונות נוספו לתור. שליחה מתחילה רק בלחיצה מפורשת.'); });
  }
  async function close() { if (draftId && queue.active) await queue.pause(draftId); queue.dispose(); onClose(); }
  return <Sheet title="צילום מדף בכמה תמונות" onClose={() => { void close().catch(error => setMessage(errorMessage(error))); }}>
    <p className="hint">כל תמונה מעובדת בנפרד. התוצאות נשמרות כטיוטה אחרי כל תמונה; ספרים אינם מתווספים לספרייה אוטומטית. בלי שמירת מקור, אחרי סגירה תתבקש לבחור שוב תמונות שטרם עובדו.</p>
    <details open={!ready || undefined}><summary>מפתח אישי ותנאי שליחה</summary><VisionKey onChange={value => { setReady(value); if (queue.active && draftId) void queue.pause(draftId).catch(error => setMessage(errorMessage(error))); }} /></details>
    <fieldset disabled={busy || queue.active}><legend>טיוטות צילום מדף</legend>
      <label className="field">מדף יעד<select value={shelfId} onChange={event => setShelfId(event.target.value)}><option value="">ללא מדף</option>{data?.shelves.map(shelf => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select></label>
      <button type="button" onClick={() => void action(async () => { const created = await createDraft(db, shelfId || null); setDraftId(created.id); })}>פתיחת טיוטת מדף חדשה</button>
      <label className="field">בחירת טיוטת מדף<select value={draftId ?? ''} onChange={event => setDraftId(event.target.value || undefined)}><option value="">בחר טיוטה</option>{data?.drafts.map(row => <option key={row.id} value={row.id}>{data.shelves.find(shelf => shelf.id === row.shelfId)?.name ?? 'ללא מדף'} · {row.images.length} תמונות · {row.items.length} פריטים · {new Date(row.updatedAt).toLocaleString('he-IL')}</option>)}</select></label>
    </fieldset>
    {draft && <>
      <section className="notice"><h3>תור תמונות</h3><p>{draft.images.length} תמונות · {draft.items.length} פריטים בטיוטה</p>
        <fieldset disabled={busy || queue.active || draft.status === 'running'}><label className="check"><input type="checkbox" checked={keepSource} onChange={event => setKeepSource(event.target.checked)} />שמירת תמונה מוכנה במכשיר לצורך התהליך והגיבוי</label>
          <label className="field">הוספת תמונות מדף<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event => { void add(event.target.files); event.target.value = ''; }} /></label>
          <label className="field">צילום תמונת מדף<input type="file" accept="image/*" capture="environment" onChange={event => { void add(event.target.files); event.target.value = ''; }} /></label>
        </fieldset>
        <div className="actions"><button type="button" disabled={!ready || busy || queue.active || draft.status === 'running' || draft.status === 'quota' || !draft.images.some(image => image.status === 'pending')} onClick={() => void action(async () => { await queue.start(draft.id, () => setMessage('המודל הראשי אינו זמין; מנסה פעם אחת את המודל החלופי שאושר.')); })}>התחלת או חידוש התור</button>
          <button type="button" className="secondary" disabled={draft.status !== 'running'} onClick={() => void queue.pause(draft.id).catch(error => setMessage(errorMessage(error)))}>השהיית התור</button></div>
        {draft.status === 'quota' && <p role="alert">המכסה הסתיימה. הטיוטה נשמרה; אין תשלום, חידוש או ניסיון נוסף.</p>}
        <ol className="shelf-queue">{draft.images.map((image, index) => <li key={image.id}><h4>{index + 1}. <bdi>{image.name}</bdi></h4><p>{imageLabels[image.status]}{image.storedImageId ? ' · מקור נשמר במכשיר' : ' · מקור אינו שמור'}</p>{image.message && <p className="hint">{image.message}</p>}
          <button type="button" className="secondary" onClick={() => setPreviewId(previewId === image.id ? undefined : image.id)}>בדיקת מקור תמונה {index + 1}</button>{previewId === image.id && <SourcePreview imageId={image.id} storedImageId={image.storedImageId} queue={queue} />}
          {draft.images.some(other => other.id !== image.id && other.inputHash === image.inputHash) && <p className="hint">התמונה הזו מופיעה שוב בתור; הפריטים אינם נמחקים אוטומטית.</p>}
          {!image.storedImageId && !queue.hasFile(image.id) && <label className="field">בחירת אותה תמונה מחדש {index + 1}<input type="file" disabled={busy || draft.status === 'running'} accept="image/*" onChange={event => { const file = event.target.files?.[0]; if (file) void action(async () => { await queue.attachFile(draft.id, image.id, file); setMessage(image.status === 'recognized' ? 'התמונה הותאמה לתצוגת המקור; אין שליחה נוספת.' : 'התמונה הותאמה; אפשר לחדש את התור.'); }); event.target.value = ''; }} /></label>}
          {['error', 'interrupted'].includes(image.status) && draft.status !== 'quota' && <button type="button" className="secondary" disabled={busy || draft.status === 'running'} onClick={() => void action(async () => { await retryDraftImage(db, draft.id, image.id); setMessage('ניסיון נוסף אושר לתמונה זו בלבד; יש לחדש את התור מפורשות.'); })}>אישור ניסיון נוסף לתמונה {index + 1}</button>}
          {image.storedImageId && <button type="button" className="secondary" disabled={busy || draft.status === 'running'} onClick={() => void action(async () => { await removeDraftSource(db, draft.id, image.id); setMessage('מקור התמונה נמחק; תוצאות הזיהוי נשארו בטיוטה.'); })}>מחיקת מקור תמונה {index + 1}</button>}
        </li>)}</ol>
      </section>
      <section aria-label="פריטים שזוהו במדף"><h3>תוצאות לבדיקה</h3><p className="hint">אין כאן ציון ביטחון מכויל או הבטחה שכל הספרים זוהו. הפריטים ממתינים לסקירה ואישור פרטניים.</p>
        {draft.items.map((row, index) => <article className="notice" key={row.id}><h4>{index + 1}. {row.item.title ?? 'ספר ללא שם קריא'}</h4><p>תמונה {draft.images.findIndex(image => image.id === row.imageId) + 1} · {row.item.authors.join(' · ') || 'מחבר לא נראה בתמונה'}</p>{row.item.uncertaintyReasons.map((reason, i) => <p className="hint" key={i}>{reason}</p>)}
          {overlaps.filter(pair => pair.firstId === row.id || pair.secondId === row.id).map(pair => <p className="hint" key={pair.firstId + pair.secondId}>{pair.reason} הפריט נשאר נפרד.</p>)}
          <details><summary>טקסט וראיות מתמונה {draft.images.findIndex(image => image.id === row.imageId) + 1}</summary><p className="visible-text">{row.item.visibleText}</p><p className="hint">{row.model} · shelf-v1</p>{Object.entries(row.item.evidenceByField).filter(([, evidence]) => evidence.length).map(([field, evidence]) => <p key={field}>{({ title: 'שם', authors: 'מחברים', isbn: 'ISBN', danacode: 'דאנאקוד', publisher: 'הוצאה' })[field as keyof typeof row.item.evidenceByField]}: {evidence.join(' · ')}</p>)}<p className="hint">{row.item.bbox ? 'מיקום בתמונה: ' + row.item.bbox.map(n => Math.round(n * 100) + '%').join(' · ') : 'המיקום בתמונה אינו ודאי.'}</p></details>
        </article>)}
      </section>
    </>}
    {message && <p role="status" className="form-status" aria-live="polite">{message}</p>}
  </Sheet>;
}
