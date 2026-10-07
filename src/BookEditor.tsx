import { downloadBookCover } from './data/catalogCover';
import { openLibraryAdapter } from './data/catalog';
import { findRecognizedCandidate } from './data/recognizedCatalog';
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import type { Author, Book, Copy, MetadataField, StoredImage } from './data/models';
import { changeCopy, duplicateBooks, emptyInput, readingStates, type BookInput } from './data/books';
import { prepareImage } from './data/images';
import { deleteBook, downloadSnapshot, type Snapshot } from './data/backup';
import { errorMessage } from './data/errors';
import { GenreField } from './GenreField';
import { StarRating } from './StarRating';
import { SimpleShelfField } from './SimpleShelfField';
import { CollectionFields, SeriesFields, TagField } from './CollectionFields';
import { BookLoans } from './LoansPanel';
import { Sheet } from './Sheet';
import { CatalogPanel, Provenance } from './CatalogPanel';
import { saveBookSelections, type CatalogSelection, type RecognitionSelection } from './data/catalogSave';
import { recognitionInput, recognitionMetadataFields } from './data/recognition';
import { observeNearViewport } from './nearViewport';
import { createFullSnapshot } from './data/fullBackup';
export { Sheet } from './Sheet';
const BarcodeScanner = lazy(() => import('./BarcodeScanner'));
const SingleBookVision = lazy(() => import('./SingleBookVision'));
const overlapsSource = (field: MetadataField, selected: MetadataField[]) => selected.includes(field) || (field.startsWith('isbn') && selected.some(next => next.startsWith('isbn')));
const remainingRecognition = (selection: RecognitionSelection, fields: MetadataField[]) => ({ ...selection, selected: selection.selected.filter(field => !recognitionMetadataFields(selection.item, [field]).some(metadata => overlapsSource(metadata, fields))) });

export function Thumbnail({ imageId, image, alt = 'כריכת הספר', defer = false }: { imageId?: string | null; image?: StoredImage | null; alt?: string; defer?: boolean }) {
  const [near, setNear] = useState(!defer);
  const container = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!defer || !imageId || !container.current) return;
    return observeNearViewport(container.current, setNear);
  }, [defer, imageId]);
  if (!defer) return <LoadedThumbnail imageId={imageId} image={image} alt={alt} />;
  const load = near || !!image;
  return <span ref={container} className={load ? 'thumbnail' : 'book-placeholder'} aria-hidden={load ? undefined : true}>{load ? <LoadedThumbnail imageId={imageId} image={image} alt={alt} /> : <span className="book-placeholder" aria-hidden="true" />}</span>;
}
function LoadedThumbnail({ imageId, image, alt }: { imageId?: string | null; image?: StoredImage | null; alt: string }) {
  const stored = useLiveQuery(() => imageId ? db.images.get(imageId) : undefined, [imageId]);
  const blob = image?.blob ?? stored?.blob;
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!blob) return;
    const value = URL.createObjectURL(blob); if (ref.current) ref.current.src = value;
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return blob ? <img ref={ref} className="book-cover" alt={alt} /> : <span className="book-placeholder" aria-hidden="true" />;
}
function inputFromBook(book: Book | undefined, names: string[], records: Author[] = []): BookInput {
  if (!book) return { ...emptyInput, authors: [''], genreIds: [], tagIds: [], seriesId: null, seriesNumber: '' };
  return { ...(book.rating === undefined ? {} : { rating: book.rating }), title: book.title ?? '', subtitle: book.subtitle ?? '', authors: names.length ? names : [''], readStatus: book.readStatus, isbn: book.isbn13 ?? book.isbn10 ?? '', danacode: book.danacode ?? '', publisher: book.publisher ?? '', publicationYear: book.publicationYear?.toString() ?? '', publicationDate: book.publicationDate ?? '', binding: book.binding ?? '', authorParts: names.map((_, i) => records[i]?.givenName || records[i]?.familyName ? { givenName: records[i].givenName ?? '', familyName: records[i].familyName ?? '' } : null), edition: book.edition ?? '', volume: book.volume ?? '', language: book.language ?? '', pages: book.pages?.toString() ?? '', personalNotes: book.personalNotes ?? '', genreIds: book.genreIds, tagIds: book.tagIds, seriesId: book.seriesId, seriesNumber: book.seriesNumber?.toString() ?? '' };
}
function partsFor(input: BookInput) {
  return input.authors.map((name, i) => {
    const part = input.authorParts?.[i];
    return part && [part.givenName.trim(), part.familyName.trim()].filter(Boolean).join(' ') === name.trim() ? part : { givenName: name, familyName: '' };
  });
}
export function BookEditor({ book, authorNames, authorRecords, onClose, onOpen, startWith = 'manual', simple = false }: { simple?: boolean; startWith?: 'manual' | 'barcode' | 'vision' | 'catalog'; book?: Book; authorNames: string[]; authorRecords?: Author[]; onClose: () => void; onOpen: (book: Book) => void }) {
  const [input, setInput] = useState(() => inputFromBook(book, authorNames, authorRecords));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [dirtyCopyId, setDirtyCopyId] = useState<string>();
  const [image, setImage] = useState<StoredImage | null | undefined>();
  const [duplicates, setDuplicates] = useState<Book[]>([]);
  const [safety, setSafety] = useState<Snapshot>();
  const [confirmed, setConfirmed] = useState(false);
  const [catalogSelections, setCatalogSelections] = useState<CatalogSelection[]>([]);
  const [recognitionSelections, setRecognitionSelections] = useState<RecognitionSelection[]>([]), [vision, setVision] = useState(startWith === 'vision');
  const [scanner, setScanner] = useState(startWith === 'barcode'), [barcodeRevision, setBarcodeRevision] = useState(0);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const coverRequest=useRef<AbortController|undefined>(undefined);
  const [coverMessage,setCoverMessage]=useState('');
  useEffect(()=>()=>coverRequest.current?.abort(),[]);
  const [catalogSearchKind, setCatalogSearchKind] = useState<'identifier' | 'details'>('identifier');
  const [catalogAutoSearch, setCatalogAutoSearch] = useState(false), [catalogOpen, setCatalogOpen] = useState(startWith === 'catalog');
  const copies = useLiveQuery(() => book ? db.copies.where('bookId').equals(book.id).toArray() : [], [book?.id]) ?? [];
  function field(key: Exclude<keyof BookInput, 'authors' | 'authorParts' | 'readStatus' | 'shelfIds' | 'genreIds' | 'tagIds' | 'seriesId' | 'seriesNumber' | 'rating' | 'genreNames'>, label: string, numeric = false) {
    return <label className="field">{label}<input value={input[key] ?? ''} inputMode={numeric ? 'numeric' : undefined} maxLength={key === 'personalNotes' ? 20000 : 1000} onChange={event => { setInput({ ...input, [key]: event.target.value }); setDirty(true); setDuplicates([]); }} /></label>;
  }
  async function save(event?: FormEvent, allowDuplicate = false) {
    event?.preventDefault(); setError(''); setBusy(true);
    try {
      if (!allowDuplicate) { const matches = await duplicateBooks(db, input, book?.id); if (matches.length) { setDuplicates(matches); return; } }
      await saveDraft(allowDuplicate);
      onClose();
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  function saveDraft(allowDuplicate = false) { return saveBookSelections(db, { ...input, authorParts: input.authorParts && input.authors.map((name, i) => { const part = input.authorParts?.[i]; return part && [part.givenName.trim(), part.familyName.trim()].filter(Boolean).join(' ') === name.trim() ? part : null; }) }, catalogSelections, recognitionSelections, book, image, allowDuplicate); }
  async function upload(file?: File) {
    if (!file) return; setBusy(true); setError('');
    try { setImage(await prepareImage(file)); setDirty(true); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function findCover(values=input) {
    if(!navigator.onLine){setCoverMessage('משיכת כריכה דורשת חיבור לרשת.');return;}
    coverRequest.current?.abort();const controller=new AbortController();coverRequest.current=controller;
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]);setBusy(true);setCoverMessage('מחפש כריכה…');
    try {
      let cover:StoredImage|undefined;
      if(values.isbn){try{cover=await downloadBookCover(undefined,values.isbn,signal);}catch{/* Search the catalog if an ISBN cover is absent. */}}
      if(!cover){const candidate=await findRecognizedCandidate(values,openLibraryAdapter(),signal);cover=await downloadBookCover(candidate?.coverUrl,values.isbn,signal);}
      if(!signal.aborted){setImage(cover);setDirty(true);setCoverMessage('הכריכה נטענה. לחץ על שמירת הספר כדי לשמור אותה.');}
    }catch{if(!controller.signal.aborted)setCoverMessage('לא נמצאה כריכה זמינה. אפשר להעלות צילום כריכה.');}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }
  async function protectDelete() {
    setBusy(true); setError(''); try { const snapshot = await createFullSnapshot(db); downloadSnapshot(snapshot, 'before-delete'); setSafety(snapshot); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!book || !safety || !confirmed) return; setBusy(true); setError('');
    try { await deleteBook(db, book.id, safety.fingerprint); onClose(); } catch (error) { setSafety(undefined); setConfirmed(false); setError(errorMessage(error)); } finally { setBusy(false); }
  }
  function applyRecognition(selection: RecognitionSelection, searchAfter = false, review?: { title: string; authors: string[] }) {
    const fields = recognitionMetadataFields(selection.item, selection.selected);
    const recognized = { ...(selection.selected.length ? recognitionInput(input, selection.item, selection.selected) : input), ...(review ?? {}) };
    setInput(recognized);
    setRecognitionSelections(old => [...old.map(item => remainingRecognition(item, fields)).filter(item => item.selected.length), ...(selection.selected.length ? [selection] : [])]);
    setCatalogSelections(old => old.map(item => ({ ...item, selected: item.selected.filter(field => !overlapsSource(field, fields)) })).filter(item => item.selected.length));
    setDirty(true); setDuplicates([]); setBarcodeRevision(old => old + 1);
    setCatalogSearchKind('details'); setCatalogAutoSearch(searchAfter); setCatalogOpen(searchAfter); setVision(false);
  }
  return <Sheet title={book ? 'עריכת ספר' : 'הוספת ספר'} onClose={onClose} busy={busy || catalogBusy} dirty={dirty}><div className={simple ? 'simple-book-editor' : undefined}>
    <StarRating value={input.rating ?? null} disabled={busy || catalogBusy} onChange={rating => { setInput({ ...input, rating }); setDirty(true); }} />
    {dirtyCopyId && <p className="notice">יש שינוי בעותק. שמור את העותק לפני שמירה נוספת של הספר.</p>}
    <div className="actions"><button type="button" className="secondary" disabled={busy || catalogBusy || !!dirtyCopyId} onClick={() => setVision(true)}>סריקת תמונה</button><button type="button" className="secondary" disabled={busy || catalogBusy || !!dirtyCopyId} onClick={() => setScanner(true)}>סריקת ברקוד</button><button type="button" className="secondary" disabled={busy || catalogBusy || !!dirtyCopyId} onClick={() => { setCatalogAutoSearch(false); setCatalogOpen(true); setBarcodeRevision(old => old + 1); }}>חיפוש</button></div>
    {scanner && <Suspense fallback={<p role="status">טוען סורק…</p>}><BarcodeScanner onClose={() => setScanner(false)} onApply={(kind, value) => { setInput(old => ({ ...old, isbn: kind === 'isbn' ? value : '', danacode: kind === 'danacode' ? value : '' })); setCatalogSearchKind('identifier'); setCatalogAutoSearch(true); setDirty(true); setDuplicates([]); setBarcodeRevision(old => old + 1); setScanner(false); }} /></Suspense>}
    {vision && <Suspense fallback={<p role="status">טוען זיהוי תמונה…</p>}><SingleBookVision simple={simple} onClose={() => setVision(false)} onApply={applyRecognition} /></Suspense>}
    <details className={simple ? 'simple-import' : undefined} open={!simple || catalogAutoSearch || catalogOpen || undefined}><summary hidden={!simple}>חיפוש והשלמת פרטים</summary>
    <CatalogPanel simple={simple} key={barcodeRevision} autoOpen={catalogOpen || catalogAutoSearch} autoSearch={catalogAutoSearch} searchBy={catalogSearchKind} fetchCover onBusy={setCatalogBusy} input={input} disabled={busy || catalogBusy || !!dirtyCopyId} onApply={(draft, candidate, selected, cover) => { setInput(draft); if (cover) setImage(cover); setDirty(true); setDuplicates([]); setRecognitionSelections(old => old.map(item => remainingRecognition(item, selected)).filter(item => item.selected.length)); setCatalogSelections(old => [...old.map(item => ({ ...item, selected: item.selected.filter(field => !overlapsSource(field, selected)) })).filter(item => item.selected.length), { candidate, selected }]); }} />
    </details>{book && !simple && <Provenance bookId={book.id} />}
    <form onSubmit={event => void save(event)}><fieldset disabled={busy || catalogBusy || !!dirtyCopyId}>{!simple && <p className="hint">כל השדות לבחירה. אפשר לשמור ספר גם ללא שם ולמלא בהמשך.</p>}
      {field('title', 'שם הספר')}
      {simple && <SeriesFields input={input} onBusyChange={setBusy} onChange={value => { setInput(value); setDirty(true); }} />}
      {field('edition', 'מהדורה')}
      <GenreField input={input} onChange={value => { setInput(value); setDirty(true); }} />
      {partsFor(input).map((part, i) => <div className="author-row split-author" key={i}><div className="field-grid">{(['givenName', 'familyName'] as const).map(key => <label className="field" key={key}>{key === 'givenName' ? 'שם פרטי של המחבר' : 'שם משפחה של המחבר'}<input aria-label={(key === 'givenName' ? 'שם פרטי של המחבר' : 'שם משפחה של המחבר') + (i ? ' ' + (i + 1) : '')} value={part[key]} maxLength={1000} onChange={event => { const parts = partsFor(input); parts[i] = { ...part, [key]: event.target.value }; setInput({ ...input, authorParts: input.authors.map((_, n) => n === i ? parts[i] : input.authorParts?.[n] ?? null), authors: parts.map(row => [row.givenName.trim(), row.familyName.trim()].filter(Boolean).join(' ')) }); setDirty(true); }} /></label>)}</div>{input.authors.length > 1 && <button type="button" className="secondary" aria-label={'הסרת מחבר ' + (i + 1)} onClick={() => { setInput({ ...input, authors: input.authors.filter((_, n) => n !== i), authorParts: input.authorParts?.filter((_, n) => n !== i) }); setDirty(true); }}>הסרה</button>}</div>)}
      {simple && <button type="button" className="secondary" disabled={input.authors.length >= 30} onClick={() => { setInput({ ...input, authors: [...input.authors, ''], authorParts: [...(input.authorParts ?? input.authors.map(() => null)), null] }); setDirty(true); }}>הוספת מחבר</button>}
      <div className="cover-editor"><Thumbnail imageId={image === undefined ? book?.primaryImageId : null} image={image} /><label className="field">תמונת כריכה<input type="file" accept="image/*" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label><button type="button" className="secondary" disabled={!input.title&&!input.isbn} onClick={()=>void findCover()}>חיפוש כריכה</button><button type="button" className="secondary" onClick={() => { setImage(null); setDirty(true); }}>הסרת תמונה</button></div>{coverMessage&&<p role="status">{coverMessage}</p>}
      <div className="field-grid">{field('publisher', 'הוצאה לאור')}<label className="field">תאריך פרסום<input type="date" min="1000-01-01" max="9999-12-31" value={input.publicationDate ?? ''} onChange={event => { const date = event.target.value; setInput({ ...input, publicationDate: date, publicationYear: date ? date.slice(0, 4) : input.publicationYear }); setDirty(true); }} /></label><label className="field">סוג כריכה<input list="binding-options" value={input.binding ?? ''} maxLength={1000} onChange={event => { setInput({ ...input, binding: event.target.value }); setDirty(true); }} /><datalist id="binding-options">{['כריכה רכה', 'כריכה קשה', 'ספירלה', 'דיגיטלי'].map(value => <option key={value} value={value} />)}</datalist></label></div>
      {!simple && <><button type="button" className="secondary" disabled={input.authors.length >= 30} onClick={() => { setInput({ ...input, authors: [...input.authors, ''] }); setDirty(true); }}>הוספת מחבר</button>
      <label className="field">מצב קריאה<select value={input.readStatus} onChange={event => { setInput({ ...input, readStatus: event.target.value as BookInput['readStatus'] }); setDirty(true); }}>{Object.entries(readingStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <CollectionFields bookId={book?.id} input={input} onBusyChange={setBusy} onChange={value => { setInput(value); setDirty(true); }} />
      </>}{simple && <><SimpleShelfField bookId={book?.id} input={input} onChange={value => { setInput(value); setDirty(true); }} /></>}{simple && <TagField input={input} onChange={value => { setInput(value); setDirty(true); }} />}<details><summary>פרטים נוספים</summary><label className="field">מחיר הספר בש״ח<input inputMode="decimal" value={input.price ?? (() => { const copy = copies.filter(row => !row.archivedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]; return copy?.purchasePriceMinor == null ? '' : (copy.purchasePriceMinor / 100).toString(); })()} onChange={event => { setInput({ ...input, price: event.target.value }); setDirty(true); }} /></label><div className="field-grid">{field('subtitle', 'כותרת משנה')}{field('isbn', 'ISBN')}{field('danacode', 'דאנאקוד')}{field('publicationYear', 'שנת הוצאה', true)}{field('volume', 'כרך')}{field('language', 'שפה')}{field('pages', 'מספר עמודים', true)}</div></details>
      <p role="alert" className="error-message">{error}</p>
      {!!duplicates.length && <section className="notice"><h3>ISBN זה כבר נמצא בספרייה</h3>{duplicates.map(match => <div key={match.id}><p>{match.title ?? 'ללא שם'}</p><div className="actions"><button type="button" onClick={() => onOpen(match)}>פתיחת הספר הקיים</button><button type="button" onClick={async () => { setBusy(true); try { await changeCopy(db, match.id, match.revision, {}); onClose(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>הוספת עותק לספר הקיים</button></div></div>)}<button type="button" className="secondary" onClick={() => void save(undefined, true)}>שמירה כספר נפרד</button></section>}
      <div className="actions book-save-actions"><button type="submit">{busy ? 'שומר…' : 'שמירת הספר'}</button></div>
    </fieldset></form>
    {book && <BookLoans book={book} copies={copies} disabled={busy || dirty || !!dirtyCopyId} onBusy={setBusy} />}
    {book && <section className="copies-section">{simple && <button type="button" className="secondary" disabled={busy || dirty} onClick={async () => { setBusy(true); try { await changeCopy(db, book.id, book.revision, {}); onOpen((await db.books.get(book.id))!); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>הוספת עותק</button>}{!simple && <><h3>עותקים ({copies.length})</h3><p className="hint">עריכה והוספת עותק שומרות גם את הפרטים שמופיעים למעלה.</p>{copies.map(copy => <CopyEditor key={copy.id} copy={copy} disabled={busy || (!!dirtyCopyId && dirtyCopyId !== copy.id)} onDirty={() => { setDirty(true); setDirtyCopyId(copy.id); }} onSave={async values => {
      setBusy(true); try { await db.transaction('rw', db.tables, async () => { const updated = await saveDraft(); await changeCopy(db, book.id, updated.revision, { id: copy.id, ...values }); }); onOpen((await db.books.get(book.id))!); } finally { setBusy(false); }
    }} />)}<button type="button" className="secondary" disabled={busy || catalogBusy || !!dirtyCopyId} onClick={async () => { setBusy(true); setError(''); try { await db.transaction('rw', db.tables, async () => { const updated = await saveDraft(); await changeCopy(db, book.id, updated.revision, {}); }); onOpen((await db.books.get(book.id))!); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>הוספת עותק</button>
      </>}<details className="delete-section"><summary>מחיקת הספר</summary><p>יימחקו הספר, {copies.length} העותקים ותמונתו אם אינה משמשת ספר אחר. חלופה: ארכוב עותקים שומר את הספר.</p><button type="button" className="secondary" disabled={busy} onClick={() => void protectDelete()}>הורדת גיבוי מגן לפני מחיקה</button>{safety && <><label className="check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />וידאתי שהגיבוי ירד למחשב ואני מאשר את המחיקה</label><button type="button" disabled={!confirmed || busy} onClick={() => void remove()}>מחיקה סופית של הספר</button></>}</details>
    </section>}
  </div></Sheet>;
}
function CopyEditor({ copy, disabled, onSave, onDirty }: { copy: Copy; disabled: boolean; onDirty: () => void; onSave: (values: { label: string; notes: string; price: string; archive?: boolean }) => Promise<void> }) {
  const [label, setLabel] = useState(copy.label ?? ''), [notes, setNotes] = useState(copy.notes ?? ''), [price, setPrice] = useState(copy.purchasePriceMinor === null ? '' : (copy.purchasePriceMinor / 100).toString());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(archive?: boolean) { setBusy(true); setError(''); try { await onSave({ label, notes, price, archive }); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }
  return <form className="copy-card" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={disabled || busy}><p>{copy.archivedAt ? 'עותק בארכיון' : 'עותק פעיל'}</p><label className="field">תיאור העותק<input value={label} onChange={event => { setLabel(event.target.value); onDirty(); }} /></label><label className="field">מחיר בש״ח<input inputMode="decimal" value={price} onChange={event => { setPrice(event.target.value); onDirty(); }} /></label><label className="field">הערות לעותק<input value={notes} onChange={event => { setNotes(event.target.value); onDirty(); }} /></label><div className="actions"><button type="submit">שמירת העותק</button><button type="button" className="secondary" onClick={() => void save(!copy.archivedAt)}>{copy.archivedAt ? 'החזרת העותק מהארכיון' : 'ארכוב העותק'}</button></div><p role="alert" className="error-message">{error}</p></fieldset></form>;
}
