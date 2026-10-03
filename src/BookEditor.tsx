import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import type { Book, Copy, MetadataField, StoredImage } from './data/models';
import { changeCopy, duplicateBooks, emptyInput, readingStates, type BookInput } from './data/books';
import { prepareImage } from './data/images';
import { deleteBook, downloadSnapshot, type Snapshot } from './data/backup';
import { errorMessage } from './data/errors';
import { CollectionFields } from './CollectionFields';
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
  return <span ref={container} className={load ? 'thumbnail' : 'book-placeholder'} aria-hidden={load ? undefined : true}>{load ? <LoadedThumbnail imageId={imageId} image={image} alt={alt} /> : '▤'}</span>;
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
  return blob ? <img ref={ref} className="book-cover" alt={alt} /> : <span className="book-placeholder" aria-hidden="true">▤</span>;
}
function inputFromBook(book: Book | undefined, names: string[]): BookInput {
  if (!book) return { ...emptyInput, authors: [''], genreIds: [], tagIds: [], seriesId: null, seriesNumber: '' };
  return { title: book.title ?? '', subtitle: book.subtitle ?? '', authors: names, readStatus: book.readStatus, isbn: book.isbn13 ?? book.isbn10 ?? '', danacode: book.danacode ?? '', publisher: book.publisher ?? '', publicationYear: book.publicationYear?.toString() ?? '', edition: book.edition ?? '', volume: book.volume ?? '', language: book.language ?? '', pages: book.pages?.toString() ?? '', personalNotes: book.personalNotes ?? '', genreIds: book.genreIds, tagIds: book.tagIds, seriesId: book.seriesId, seriesNumber: book.seriesNumber?.toString() ?? '' };
}
export function BookEditor({ book, authorNames, onClose, onOpen, startWith = 'manual' }: { startWith?: 'manual' | 'barcode' | 'vision' | 'catalog'; book?: Book; authorNames: string[]; onClose: () => void; onOpen: (book: Book) => void }) {
  const [input, setInput] = useState(() => inputFromBook(book, authorNames));
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
  const [barcodeSearch, setBarcodeSearch] = useState(false);
  const copies = useLiveQuery(() => book ? db.copies.where('bookId').equals(book.id).toArray() : [], [book?.id]) ?? [];
  function field(key: Exclude<keyof BookInput, 'authors' | 'readStatus' | 'shelfIds' | 'genreIds' | 'tagIds' | 'seriesId' | 'seriesNumber'>, label: string, numeric = false) {
    return <label className="field">{label}<input value={input[key]} inputMode={numeric ? 'numeric' : undefined} maxLength={key === 'personalNotes' ? 20000 : 1000} onChange={event => { setInput({ ...input, [key]: event.target.value }); setDirty(true); setDuplicates([]); }} /></label>;
  }
  async function save(event?: FormEvent, allowDuplicate = false) {
    event?.preventDefault(); setError(''); setBusy(true);
    try {
      if (!allowDuplicate) { const matches = await duplicateBooks(db, input, book?.id); if (matches.length) { setDuplicates(matches); return; } }
      await saveDraft(allowDuplicate);
      onClose();
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  function saveDraft(allowDuplicate = false) { return saveBookSelections(db, input, catalogSelections, recognitionSelections, book, image, allowDuplicate); }
  async function upload(file?: File) {
    if (!file) return; setBusy(true); setError('');
    try { setImage(await prepareImage(file)); setDirty(true); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function protectDelete() {
    setBusy(true); setError(''); try { const snapshot = await createFullSnapshot(db); downloadSnapshot(snapshot, 'before-delete'); setSafety(snapshot); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!book || !safety || !confirmed) return; setBusy(true); setError('');
    try { await deleteBook(db, book.id, safety.fingerprint); onClose(); } catch (error) { setSafety(undefined); setConfirmed(false); setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <Sheet title={book ? 'עריכת ספר' : 'הוספת ספר'} onClose={onClose} busy={busy} dirty={dirty}>
    {dirtyCopyId && <p className="notice">יש שינוי בעותק. שמור את העותק לפני שמירה נוספת של הספר.</p>}
    <button type="button" className="secondary" disabled={busy || !!dirtyCopyId} onClick={() => setScanner(true)}>סריקת ברקוד או הקלדת מזהה</button>
    {scanner && <Suspense fallback={<p role="status">טוען סורק…</p>}><BarcodeScanner onClose={() => setScanner(false)} onApply={(kind, value) => { setInput(old => ({ ...old, isbn: kind === 'isbn' ? value : '', danacode: kind === 'danacode' ? value : '' })); setBarcodeSearch(true); setDirty(true); setDuplicates([]); setBarcodeRevision(old => old + 1); setScanner(false); }} /></Suspense>}
    <button type="button" className="secondary" disabled={busy || !!dirtyCopyId} onClick={() => setVision(true)}>זיהוי ספר מתמונה</button>
    {vision && <Suspense fallback={<p role="status">טוען זיהוי תמונה…</p>}><SingleBookVision onClose={() => setVision(false)} onApply={selection => { const fields = recognitionMetadataFields(selection.item, selection.selected); setInput(old => recognitionInput(old, selection.item, selection.selected)); setRecognitionSelections(old => [...old.map(item => remainingRecognition(item, fields)).filter(item => item.selected.length), selection]); setCatalogSelections(old => old.map(item => ({ ...item, selected: item.selected.filter(field => !overlapsSource(field, fields)) })).filter(item => item.selected.length)); setDirty(true); setDuplicates([]); setBarcodeRevision(old => old + 1); setBarcodeSearch(false); setVision(false); }} /></Suspense>}
    <CatalogPanel key={barcodeRevision} autoOpen={barcodeRevision > 0 || startWith === 'catalog'} autoSearch={barcodeSearch} fetchCover onBusy={setCatalogBusy} input={input} disabled={busy || !!dirtyCopyId} onApply={(draft, candidate, selected, cover) => { setInput(draft); if (cover) setImage(cover); setDirty(true); setDuplicates([]); setRecognitionSelections(old => old.map(item => remainingRecognition(item, selected)).filter(item => item.selected.length)); setCatalogSelections(old => [...old.map(item => ({ ...item, selected: item.selected.filter(field => !overlapsSource(field, selected)) })).filter(item => item.selected.length), { candidate, selected }]); }} />
    {book && <Provenance bookId={book.id} />}
    <form onSubmit={event => void save(event)}><fieldset disabled={busy || catalogBusy || !!dirtyCopyId}><p className="hint">כל השדות לבחירה. אפשר לשמור ספר גם ללא שם ולמלא בהמשך.</p>
      <div className="cover-editor"><Thumbnail imageId={image === undefined ? book?.primaryImageId : null} image={image} /><label className="field">תמונת כריכה<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label><button type="button" className="secondary" onClick={() => { setImage(null); setDirty(true); }}>הסרת תמונה</button></div>
      {field('title', 'שם הספר')}
      {input.authors.map((name, i) => <div className="author-row" key={i}><label className="field">{`שם מחבר ${i + 1}`}<input value={name} maxLength={1000} onChange={event => { setInput({ ...input, authors: input.authors.map((old, n) => n === i ? event.target.value : old) }); setDirty(true); }} /></label><button type="button" className="secondary" aria-label={`הסרת מחבר ${i + 1}`} onClick={() => { setInput({ ...input, authors: input.authors.filter((_, n) => n !== i) }); setDirty(true); }}>הסרה</button></div>)}
      <button type="button" className="secondary" disabled={input.authors.length >= 30} onClick={() => { setInput({ ...input, authors: [...input.authors, ''] }); setDirty(true); }}>הוספת מחבר</button>
      <label className="field">מצב קריאה<select value={input.readStatus} onChange={event => { setInput({ ...input, readStatus: event.target.value as BookInput['readStatus'] }); setDirty(true); }}>{Object.entries(readingStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <CollectionFields bookId={book?.id} input={input} onBusyChange={setBusy} onChange={value => { setInput(value); setDirty(true); }} />
      <details><summary>פרטים נוספים</summary><div className="field-grid">{field('subtitle', 'כותרת משנה')}{field('isbn', 'ISBN')}{field('danacode', 'דאנאקוד')}{field('publisher', 'הוצאה לאור')}{field('publicationYear', 'שנת הוצאה', true)}{field('edition', 'מהדורה')}{field('volume', 'כרך')}{field('language', 'שפה')}{field('pages', 'מספר עמודים', true)}</div>{field('personalNotes', 'הערות אישיות')}</details>
      <p role="alert" className="error-message">{error}</p>
      {!!duplicates.length && <section className="notice"><h3>ISBN זה כבר נמצא בספרייה</h3>{duplicates.map(match => <div key={match.id}><p>{match.title ?? 'ללא שם'}</p><div className="actions"><button type="button" onClick={() => onOpen(match)}>פתיחת הספר הקיים</button><button type="button" onClick={async () => { setBusy(true); try { await changeCopy(db, match.id, match.revision, {}); onClose(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>הוספת עותק לספר הקיים</button></div></div>)}<button type="button" className="secondary" onClick={() => void save(undefined, true)}>שמירה כספר נפרד</button></section>}
      <div className="actions"><button type="submit">{busy ? 'שומר…' : 'שמירת הספר'}</button></div>
    </fieldset></form>
    {book && <BookLoans book={book} copies={copies} disabled={busy || dirty || !!dirtyCopyId} onBusy={setBusy} />}
    {book && <section className="copies-section"><h3>עותקים ({copies.length})</h3><p className="hint">עריכה והוספת עותק שומרות גם את הפרטים שמופיעים למעלה.</p>{copies.map(copy => <CopyEditor key={copy.id} copy={copy} disabled={busy || (!!dirtyCopyId && dirtyCopyId !== copy.id)} onDirty={() => { setDirty(true); setDirtyCopyId(copy.id); }} onSave={async values => {
      setBusy(true); try { await db.transaction('rw', db.tables, async () => { const updated = await saveDraft(); await changeCopy(db, book.id, updated.revision, { id: copy.id, ...values }); }); onOpen((await db.books.get(book.id))!); } finally { setBusy(false); }
    }} />)}<button type="button" className="secondary" disabled={busy || !!dirtyCopyId} onClick={async () => { setBusy(true); setError(''); try { await db.transaction('rw', db.tables, async () => { const updated = await saveDraft(); await changeCopy(db, book.id, updated.revision, {}); }); onOpen((await db.books.get(book.id))!); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>הוספת עותק</button>
      <details className="delete-section"><summary>מחיקת הספר</summary><p>יימחקו הספר, {copies.length} העותקים ותמונתו אם אינה משמשת ספר אחר. חלופה: ארכוב עותקים שומר את הספר.</p><button type="button" className="secondary" disabled={busy} onClick={() => void protectDelete()}>הורדת גיבוי מגן לפני מחיקה</button>{safety && <><label className="check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />וידאתי שהגיבוי ירד למחשב ואני מאשר את המחיקה</label><button type="button" disabled={!confirmed || busy} onClick={() => void remove()}>מחיקה סופית של הספר</button></>}</details>
    </section>}
  </Sheet>;
}
function CopyEditor({ copy, disabled, onSave, onDirty }: { copy: Copy; disabled: boolean; onDirty: () => void; onSave: (values: { label: string; notes: string; price: string; archive?: boolean }) => Promise<void> }) {
  const [label, setLabel] = useState(copy.label ?? ''), [notes, setNotes] = useState(copy.notes ?? ''), [price, setPrice] = useState(copy.purchasePriceMinor === null ? '' : (copy.purchasePriceMinor / 100).toString());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save(archive?: boolean) { setBusy(true); setError(''); try { await onSave({ label, notes, price, archive }); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }
  return <form className="copy-card" onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={disabled || busy}><p>{copy.archivedAt ? 'עותק בארכיון' : 'עותק פעיל'}</p><label className="field">תיאור העותק<input value={label} onChange={event => { setLabel(event.target.value); onDirty(); }} /></label><label className="field">מחיר בש״ח<input inputMode="decimal" value={price} onChange={event => { setPrice(event.target.value); onDirty(); }} /></label><label className="field">הערות לעותק<input value={notes} onChange={event => { setNotes(event.target.value); onDirty(); }} /></label><div className="actions"><button type="submit">שמירת העותק</button><button type="button" className="secondary" onClick={() => void save(!copy.archivedAt)}>{copy.archivedAt ? 'החזרת העותק מהארכיון' : 'ארכוב העותק'}</button></div><p role="alert" className="error-message">{error}</p></fieldset></form>;
}
