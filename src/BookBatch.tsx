import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Sheet, Thumbnail } from './BookEditor';
import { CatalogPanel, CatalogCoverPreview } from './CatalogPanel';
import { db } from './data/database';
import { personalCredentials } from './data/personalCredentials';
import { addBookPhoto, batchIds, batchRequest, openBookBatch, syncBookBatch, updateBookBatchKeys, uploadBookPhotos, type RemoteBatch } from './data/bookBatch';
import { previewApproved, saveApproved, setItemStatus, updateItemReview } from './data/shelfReview';
import { downloadCatalogCover } from './data/catalogCover';
import { emptyReview, reviewWithCatalog } from './data/draftReviewValues';
import { recognitionFields, recognitionInput, recognitionMetadataFields } from './data/recognition';
import { errorMessage } from './data/errors';
import type { DraftItem, RecognitionDraft, StoredImage } from './data/models';
import { useOnline } from './pwa';
import type { Candidate } from './data/metadata';
export default function BookBatch({ onClose }: {
    onClose(): void;
}) {
    const [id, setId] = useState(''), [remote, setRemote] = useState<RemoteBatch>(), [consent, setConsent] = useState(false), [shelfId, setShelfId] = useState('');
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [group, setGroup] = useState('all'), [page, setPage] = useState(0), [reviewId, setReviewId] = useState(''), [localOnly, setLocalOnly] = useState(false);
    const upload = useRef<AbortController | undefined>(undefined), online = useOnline();
    const data = useLiveQuery(async () => {
        const [ids, drafts, shelves] = await Promise.all([batchIds(), db.recognitionDrafts.toArray(), db.shelves.toArray()]);
        return {ids:[...new Set([...ids,...drafts.map(draft => draft.id)])],drafts,shelves};
    });
    const draft = data?.drafts.find(row => row.id === id);
    useEffect(() => () => upload.current?.abort(), []);
    function selectBatch(value: string) { setId(value); setRemote(undefined); setLocalOnly(false); setReviewId(''); setPage(0); setMessage(''); }
    useEffect(() => {
        if (!id || !online)
            return;
        let cancelled = false, inFlight = false;
        async function refresh() { if (inFlight)
            return; inFlight = true; try {
            const credential = await personalCredentials.credentials.get('batch:' + id);
            if (credential?.stopped || !credential?.key) {
                if (!cancelled)
                    setLocalOnly(true);
                return;
            }
            const result = await batchRequest(id, 'status');
            if (cancelled)
                return;
            await syncBookBatch(result);
            if (!cancelled) {
                setLocalOnly(false);
                setRemote(result);
            }
        }
        catch (error) {
            if (!cancelled) {
                if(error instanceof Error&&error.name==='BatchMissing')setLocalOnly(true);
                setMessage(errorMessage(error));
            }
        }
        finally {
            inFlight = false;
        } }
        void refresh();
        const timer = setInterval(() => { if (document.visibilityState === 'visible')
            void refresh(); }, 10000);
        const visible = () => { if (document.visibilityState === 'visible')
            void refresh(); };
        document.addEventListener('visibilitychange', visible);
        return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
    }, [id, online]);
    async function action(run: () => Promise<void>) { setBusy(true); setMessage(''); try {
        await run();
    }
    catch (error) {
        setMessage(errorMessage(error));
    }
    finally {
        setBusy(false);
    } }
    async function control(action: 'pause' | 'start' | 'delete' | 'retry', itemId?: string) { const result = await batchRequest(id, 'action', { action, ...(itemId ? { itemId } : {}) }); if (action === 'delete') {
        await personalCredentials.credentials.put({ id: 'batch:' + id, stopped: true });
        setLocalOnly(true);
        setRemote(undefined);
        setMessage('התמונות והמפתחות נמחקו מהתור בשרת. הטיוטה המקומית נשארה.');
    }
    else
        setRemote(result); }
    async function approve(rows: DraftItem[]) { let approved = 0; const failed: string[] = []; for (const row of rows) {
        try {
            const current = await db.recognitionDrafts.get(id);
            if (!current)
                throw new Error();
            await setItemStatus(db, id, row.id, current.revision, 'approved');
            approved++;
        }
        catch {
            failed.push(row.review?.input.title || row.item.title || 'ללא שם');
        }
    } setMessage(`${approved} ספרים אושרו. הם עדיין בטיוטה.` + (failed.length ? ' יש לבדוק כפילויות או החלטה לגבי: ' + failed.join(' · ') : '')); }
    async function save() {
        const preview = await previewApproved(db, id);
        if (!preview.itemIds.length)
            throw new Error('בחר ספרים לאישור לפני השמירה.');
        const covers = new Map<string, StoredImage>(), current = await db.recognitionDrafts.get(id);
        if (!current)
            throw new Error();
        for (const [index, itemId] of preview.itemIds.entries()) {
            setMessage(`מכין לשמירה ${index + 1} מתוך ${preview.itemIds.length}…`);
            const row = current.items.find(row => row.id === itemId)!;
            if (row.review?.decision === 'copy')
                continue;
            const candidate = row.review?.catalogs.at(-1)?.candidate;
            let cover: StoredImage | undefined;
            if (candidate?.coverUrl) {
                try {
                    cover = await downloadCatalogCover(candidate.coverUrl, AbortSignal.timeout(30000));
                }
                catch { /* The uploaded book photo remains an available cover. */ }
            }
            const source = current.images.find(image => image.id === row.imageId)?.storedImageId;
            if (!cover && source)
                cover = await db.images.get(source);
            if (cover)
                covers.set(itemId, cover);
        }
        const latest = await previewApproved(db, id);
        if (JSON.stringify(latest.itemIds) !== JSON.stringify(preview.itemIds))
            throw new Error('רשימת המאושרים השתנתה. בדוק אותה שוב לפני שמירה.');
        const result = await saveApproved(db, latest, covers);
        setMessage(`${result.saved} ספרים נשמרו בספרייה.`);
    }
    const activeItems = draft?.items.filter(row => row.status !== 'removed' && row.status !== 'saved') ?? [], ready = activeItems.filter(row => row.review?.catalogs.length && (!remote || remote.images.find(image => image.id === row.imageId)?.status === 'recognized')), needs = activeItems.filter(row => !ready.includes(row));
    const canStart = draft?.images.some(image => !remote?.images.some(row => row.id === image.id) || remote.images.find(row => row.id === image.id)?.status === 'pending');
    const filtered = group === 'ready' ? ready : group === 'needs' ? needs : activeItems, shown = filtered.slice(page * 20, page * 20 + 20), editing = draft?.items.find(row => row.id === reviewId), running = remote?.status === 'running' || remote?.status === 'waiting';
    return <Sheet title="הוספת ספרים מתמונות" busy={busy} onClose={onClose}>
    <p className="hint">תמונה אחת לכל ספר. אפשר לבחור עד 500 תמונות בתור. הזיהוי והחיפוש ממשיכים בשרת גם כשהטלפון נעול; הספרים נשמרים רק באישור שלך.</p>
    <fieldset disabled={busy}><label className="field">תורים קודמים<select value={id} onChange={event => { selectBatch(event.target.value); }}><option value="">תור חדש</option>{data?.ids.map(value => { const item = data.drafts.find(row => row.id === value); return <option key={value} value={value}>{item ? new Date(item.updatedAt).toLocaleString('he-IL') : 'תור'} · {item?.images.length ?? 0} תמונות</option>; })}</select></label>
    {!id && <><label className="field">מדף יעד<select value={shelfId} onChange={event => setShelfId(event.target.value)}><option value="">ללא מדף</option>{data?.shelves.map(shelf => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select></label><label className="check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/>אני מאשר העלאת תמונות מוקטנות ומפתחות Gemini/Groq האישיים לשרת לצורך התור, במסלול Free ללא חיוב.</label><p className="hint">התור נשמר מוצפן בשרת עד 7 ימים. אפשר למחוק אותו קודם. התמונות והטיוטות נשמרות גם במכשיר הזה.</p><button type="button" disabled={!consent || !online} onClick={() => void action(async () => { const created = await openBookBatch(shelfId || null, consent); selectBatch(created.id); })}>פתיחת תור תמונות</button></>}
    </fieldset>
    {draft && <><section className="batch-progress"><p>{draft.images.length} תמונות · {draft.items.filter(row => row.status === 'saved').length} נשמרו · {ready.length} מוכנים לבדיקה · {needs.length} דורשים טיפול</p>
      {remote && <p role="status">{({ paused: 'התור מושהה', running: 'השרת מזהה ומחפש ספרים', waiting: 'ממתין לזמינות המודלים או לחידוש המכסה', complete: 'העיבוד הסתיים' })[remote.status]}{remote.status === 'waiting' ? ' · הניסיון הבא: ' + new Date(remote.nextAt).toLocaleString('he-IL') : ''}</p>}
      {!localOnly && <><label className="field">בחירת תמונות ספרים<input type="file" multiple accept="image/*" disabled={busy || running} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void action(async () => { if (draft.images.length + files.length > 500)
                throw new Error('אפשר עד 500 תמונות בתור אחד.'); for (const [index, file] of files.entries()) {
                setMessage(`מכין תמונה ${index + 1} מתוך ${files.length}…`);
                await addBookPhoto(id, file);
            } setMessage('התמונות מוכנות במכשיר. לחץ על העלאה והתחלה כדי לשלוח לשרת.'); }); }}/></label>
      <div className="actions"><button type="button" disabled={!online || busy || running || !canStart} onClick={() => void action(async () => { const controller = new AbortController(); upload.current = controller; try {
                await uploadBookPhotos(id, (n, total) => setMessage(`הועלו ${n} מתוך ${total} תמונות…`), controller.signal);
                await control('start');
                setMessage('התור התחיל בשרת. אפשר לסגור את האפליקציה אחרי שההעלאה הסתיימה.');
            }
            finally {
                upload.current = undefined;
            } })}>העלאה והתחלת התור</button><button type="button" className="secondary" disabled={!online || busy || !running} onClick={() => void action(() => control('pause'))}>השהיית התור</button></div></>}
      {localOnly && <p className="hint">זו טיוטה מקומית. אפשר להמשיך לבדוק ולשמור את התוצאות גם בלי חיבור לתור בשרת.</p>}
      {draft.images.some(image => image.status === 'error' || image.status === 'recognized' && !draft.items.some(item => item.imageId === image.id && item.status !== 'removed')) && <details><summary>תמונות שדורשות זיהוי נוסף</summary>{draft.images.filter(image => image.status === 'error' || image.status === 'recognized' && !draft.items.some(item => item.imageId === image.id && item.status !== 'removed')).map(image => <div key={image.id}><p>{image.name} · {image.message ?? 'לא זוהה ספר'}</p>{!localOnly && <button type="button" className="secondary" disabled={busy || running} onClick={() => void action(() => control('retry', image.id))}>ניסיון נוסף לתמונה {image.name}</button>}</div>)}</details>}
    </section>
    <div className="actions batch-filters">{[['all', 'כל התוצאות'], ['ready', 'מוכנים לבדיקה'], ['needs', 'דורשים טיפול']].map(([value, label]) => <button type="button" className="secondary" aria-pressed={group === value} key={value} onClick={() => { setGroup(value); setPage(0); }}>{label}</button>)}</div>
    {ready.some(row => row.status === 'reviewed') && <button type="button" className="secondary" disabled={busy} onClick={() => void action(() => approve(ready.filter(row => row.status === 'reviewed')))}>אישור ההצעות המוכנות לשמירה</button>}
    <p className="hint">„מוכנים לבדיקה” הם הצעות בלבד. אפשר לפתוח כל ספר, להשוות לתמונה, לתקן שמות ולבחור תוצאה אחרת.</p>
    <div className="batch-save-actions"><button type="button" disabled={busy || !draft.items.some(row => row.status === 'approved')} onClick={() => void action(save)}>שמירת {draft.items.filter(row => row.status === 'approved').length} ספרים מאושרים בספרייה</button></div>
    <ol className="batch-books" start={page * 20 + 1}>{shown.map(row => <li key={row.id}><Thumbnail defer imageId={draft.images.find(image => image.id === row.imageId)?.storedImageId} alt="צילום הספר המקורי"/><div><strong>{row.review?.input.title || row.item.title || 'שם לא קריא'}</strong><p>{row.review?.input.authors.join(' · ') || 'מחבר לא קריא'}</p><label className="check"><input type="checkbox" disabled={busy} checked={row.status === 'approved'} onChange={event => void action(async () => { if (event.target.checked)
            await approve([row]);
        else {
            const current = await db.recognitionDrafts.get(id);
            if (current)
                await setItemStatus(db, id, row.id, current.revision, 'reviewed');
        } })}/>אישור לשמירה</label><button type="button" className="secondary" disabled={busy} onClick={() => setReviewId(row.id)}>בדיקה ותיקון</button></div></li>)}</ol>
    {filtered.length > 20 && <div className="actions"><button type="button" className="secondary" disabled={!page} onClick={() => setPage(page - 1)}>הקודמים</button><span>{page + 1} מתוך {Math.ceil(filtered.length / 20)}</span><button type="button" className="secondary" disabled={(page + 1) * 20 >= filtered.length} onClick={() => setPage(page + 1)}>הבאים</button></div>}
      {!localOnly && <details><summary>מפתחות ומחיקת התור מהשרת</summary><p>אם שינית מפתח Gemini או Groq בהגדרות, אפשר לעדכן אותו לתור הזה לאחר השהיה.</p><button type="button" className="secondary" disabled={busy||running||!online} onClick={()=>void action(async()=>{setRemote(await updateBookBatchKeys(id));setMessage('מפתחות התור עודכנו מההגדרות. אפשר לחדש את התור.');})}>עדכון מפתחות התור מההגדרות</button><p>מחיקה מסירה את התמונות והמפתחות מהתור בשרת. התוצאות שכבר ירדו למכשיר נשארות.</p><button type="button" className="secondary" disabled={busy || !online} onClick={() => void action(() => control('delete'))}>מחיקת התור מהשרת</button></details>}
    </>}
    {message && <p role="status" className="form-status">{message}</p>}
    {editing && draft && <BatchBookReview key={editing.id} draft={draft} row={editing} candidates={remote?.images.find(image=>image.id===editing.imageId)?.candidates??[]} running={!!running} localOnly={localOnly} onClose={() => setReviewId('')} onRetry={() => action(async () => { await control('retry', editing.imageId); const current = await db.recognitionDrafts.get(id); if (current)
        await setItemStatus(db, id, editing.id, current.revision, 'reviewed'); setReviewId(''); setMessage('התמונה ממתינה לזיהוי חוזר. לחץ על העלאה והתחלת התור כדי לחדש.'); })}/>}
  </Sheet>;
}
function BatchBookReview({ draft, row, candidates, running, localOnly, onClose, onRetry }: {
    draft: RecognitionDraft;
    row: DraftItem;
    candidates: Candidate[];
    running: boolean;
    localOnly: boolean;
    onClose(): void;
    onRetry(): Promise<void>;
}) {
    const available = recognitionFields.filter(field => field === 'authors' ? row.item.authors.length : !!row.item[field]);
    const [review, setReview] = useState(() => {
        if (row.review) return structuredClone(row.review);
        const initial = emptyReview();
        initial.input = recognitionInput(initial.input, row.item, available);
        initial.decision = 'new';
        return initial;
    }), [selected, setSelected] = useState(row.review ? row.selectedFields : available), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [search, setSearch] = useState(0);
    const original = useRef(JSON.stringify(row.review)), books = useLiveQuery(() => db.books.toArray());
    async function update() { setBusy(true); try {
        const latest = await db.recognitionDrafts.get(draft.id), current = latest?.items.find(item => item.id === row.id);
        if (!latest || !current || current.fetchedAt !== row.fetchedAt || JSON.stringify(current.review) !== original.current)
            throw new Error('הפריט השתנה. סגור ופתח אותו שוב כדי לבדוק את התוצאה העדכנית.');
        await updateItemReview(db, draft.id, row.id, latest.revision, review, selected);
        onClose();
    }
    catch (error) {
        setMessage(errorMessage(error));
    }
    finally {
        setBusy(false);
    } }
    function changed(next: typeof review) { setReview(next); setDirty(true); }
    return <Sheet title="בדיקת ספר לפני שמירה" dirty={dirty} busy={busy} onClose={onClose}><div className="batch-comparison"><div><p>התמונה שהעלית</p><Thumbnail imageId={draft.images.find(image => image.id === row.imageId)?.storedImageId} alt="צילום הספר המקורי" /></div>{review.catalogs.at(-1)?.candidate && <div><p>הכריכה המוצעת</p><CatalogCoverPreview candidate={review.catalogs.at(-1)!.candidate} /></div>}</div><p className="hint">מהתמונה: {row.item.title ?? 'שם לא קריא'} · {row.item.authors.join(' · ')}</p>
    <fieldset disabled={busy}><label className="field">שם הספר לבדיקה<input value={review.input.title} onChange={event => changed({ ...review, input: { ...review.input, title: event.target.value } })} maxLength={300}/></label><label className="field">מחברים לבדיקה, שם בכל שורה<textarea value={review.input.authors.join('\n')} onChange={event => changed({ ...review, input: { ...review.input, authors: event.target.value.split('\n') } })}/></label><button type="button" className="secondary" onClick={() => setSearch(search + 1)}>חיפוש מחדש לפי השמות שתיקנתי</button>
    <CatalogPanel simple key={search} initialCandidates={search===0?candidates:[]} autoSearch={search > 0} searchBy="details" input={review.input} disabled={busy || review.decision === 'copy'} fetchCover keepCoverReference onApply={(input, candidate, fields) => { setSelected(selected.filter(field => !recognitionMetadataFields(row.item, [field]).some(value => fields.includes(value)))); changed(reviewWithCatalog(review, input, candidate, fields)); }}/>
    <label className="field">מה לשמור<select value={review.decision ?? 'new'} onChange={event => { const decision = event.target.value as 'new' | 'copy'; if (decision === 'copy')
        setSelected([]); changed({ ...review, decision, targetBookId: null, targetRevision: null, allowDuplicate: false, catalogs: decision === 'copy' ? [] : review.catalogs }); }}><option value="new">ספר חדש</option><option value="copy">עותק נוסף של ספר קיים</option></select></label>
    {review.decision === 'copy' && <label className="field">ספר היעד<select value={review.targetBookId ?? ''} onChange={event => { const book = books?.find(book => book.id === event.target.value); changed({ ...review, targetBookId: book?.id ?? null, targetRevision: book?.revision ?? null }); }}><option value="">בחר ספר</option>{books?.map(book => <option key={book.id} value={book.id}>{book.title ?? 'ללא שם'}</option>)}</select></label>}
    <div className="actions"><button type="button" onClick={() => void update()}>עדכון ההצעה בטיוטה</button><button type="button" className="secondary" onClick={async () => { setBusy(true); try {
        const latest = await db.recognitionDrafts.get(draft.id);
        if (latest)
            await setItemStatus(db, draft.id, row.id, latest.revision, 'removed');
        onClose();
    }
    catch (error) {
        setMessage(errorMessage(error));
    }
    finally {
        setBusy(false);
    } }}>דילוג על הספר</button>{!localOnly && <button type="button" className="secondary" disabled={running} onClick={() => void onRetry()}>זיהוי מחדש לתמונה הזו</button>}</div></fieldset>
    {message && <p role="alert">{message}</p>}
  </Sheet>;
}
