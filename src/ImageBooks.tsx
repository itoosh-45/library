import { GenreField } from './GenreField';
import { useEffect, useRef, useState } from 'react';
import { CatalogPanel } from './CatalogPanel';
import { openLibraryAdapter, emptyQuery } from './data/catalog';
import { downloadCatalogCover } from './data/catalogCover';
import type { StoredImage } from './data/models';
import { Thumbnail } from './BookEditor';
import { Sheet } from './Sheet';
import VisionKey from './VisionKey';
import { SimpleShelfField } from './SimpleShelfField';
import { db } from './data/database';
import { emptyInput, duplicateBooks, comparableISBN, parseISBN, type BookInput } from './data/books';
import { applyCatalogCandidate, saveBookSelections, type CatalogSelection, type RecognitionSelection } from './data/catalogSave';
import { recognitionFields, recognitionInput, recognitionMetadataFields } from './data/recognition';
import { personalVisionSession } from './data/vision';
import { loadVisionImage, prepareVisionImage, type PreparedVisionImage } from './data/visionImage';
import { hashBytes } from './data/images';
import { errorMessage } from './data/errors';
import { useOnline } from './pwa';

interface ImageBook { selection: RecognitionSelection; input: BookInput; included: boolean; duplicate: boolean; catalogs: CatalogSelection[]; cover?: StoredImage }
export default function ImageBooks({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const online = useOnline();
  const [ready, setReady] = useState(personalVisionSession.ready);
  const [image, setImage] = useState<PreparedVisionImage>();
  const [rows, setRows] = useState<ImageBook[]>([]), [shelf, setShelf] = useState<BookInput>({ ...emptyInput });
  const [catalogBusy, setCatalogBusy] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const [catalog] = useState(() => openLibraryAdapter());
  const lookup = useRef<AbortController | undefined>(undefined);
  const sequence = useRef(0), preview = useRef<HTMLImageElement>(null);
  useEffect(() => () => { sequence.current++; lookup.current?.abort(); personalVisionSession.cancel(); }, []);
  useEffect(() => { if (!image) return; const url = URL.createObjectURL(image.blob); if (preview.current) preview.current.src = url; return () => URL.revokeObjectURL(url); }, [image]);
  function cancel() { sequence.current++; lookup.current?.abort(); personalVisionSession.cancel(); setBusy(false); setMessage('הזיהוי בוטל. אפשר לבחור תמונה אחרת.'); }
  async function recognize(prepared: PreparedVisionImage, request: number) {
    setMessage('מזהה את הספרים בתמונה…');
    const imageHash = await hashBytes(await prepared.blob.arrayBuffer());
    if (request !== sequence.current) return;
    const outcome = await personalVisionSession.recognize(prepared.blob, () => setMessage('מנסה את מודל הגיבוי שאושר…'), 'shelf');
    if (request !== sequence.current) return;
    const fetchedAt = new Date().toISOString(), found: ImageBook[] = [];
    for (const item of outcome.result.items) {
      const selected = recognitionFields.filter(field => field === 'authors' ? item.authors.length : item[field]);
      if (!selected.length) continue;
      let input = recognitionInput({ ...emptyInput }, item, selected);
      const duplicate = (await duplicateBooks(db, input)).length > 0 || !!input.isbn && found.some(row => row.input.isbn === input.isbn);
      const row: ImageBook = { input, included: !duplicate, duplicate, catalogs: [], selection: { item, selected, model: outcome.model, imageHash, fetchedAt } };
      if (input.isbn && !duplicate && navigator.onLine) {
        const controller = new AbortController(); lookup.current = controller;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
        try {
          setMessage(`מחפש פרטים וכריכה לספר ${found.length + 1}…`);
          const candidates = await catalog.search({ ...emptyQuery, isbn: input.isbn }, signal);
          for (const candidate of candidates.slice(0, 3)) {
            const resolved = await catalog.resolve!(candidate, signal);
            if (![resolved.fields.isbn13, resolved.fields.isbn10].some(code => typeof code === 'string' && comparableISBN(parseISBN(code)) === comparableISBN(parseISBN(input.isbn)))) continue;
            const applied = applyCatalogCandidate(input, resolved); input = applied.draft; row.input = input;
            row.catalogs = [{ candidate: resolved, selected: applied.fields }];
            row.selection.selected = row.selection.selected.filter(field => !recognitionMetadataFields(item, [field]).some(metadata => applied.fields.includes(metadata)));
            if (resolved.coverUrl) { try { row.cover = await downloadCatalogCover(resolved.coverUrl, signal); } catch { /* Keep the recognized details when a cover is unavailable. */ } }
            break;
          }
        } catch { /* A catalog outage must not lose the recognized identifier. */ }
      }
      if (request !== sequence.current) return;
      found.push(row);
    }
    if (request !== sequence.current) return;
    setRows(old => [...old, ...found.map(row => ({ ...row, included: row.included && (!row.input.isbn || !old.some(previous => previous.input.isbn === row.input.isbn)) }))]); setMessage(found.length ? 'בחר אילו ספרים להוסיף. לחיצה על שם פותחת את הפרטים.' : 'לא זוהו פרטים קריאים. נסה תמונה קרובה וברורה יותר.');
  }
  async function choose(files: FileList | null) {
    if (!files?.length) return;
    const queue = Array.from(files);
    if (queue.length > 20) { setMessage('בחר עד 20 תמונות בכל פעם.'); return; }
    lookup.current?.abort(); personalVisionSession.cancel(); const request = ++sequence.current;
    setImage(undefined); setBusy(true);
    const errors: string[] = [];
    try {
      for (const [index, file] of queue.entries()) {
        if (request !== sequence.current) return;
        setMessage(`מכין תמונה ${index + 1} מתוך ${queue.length}…`);
        try {
          const source = await loadVisionImage(file);
          let prepared: PreparedVisionImage;
          try { prepared = await prepareVisionImage(source); } finally { source.dispose(); }
          if (request !== sequence.current) return;
          setImage(prepared);
          if (!personalVisionSession.ready || !navigator.onLine) { setMessage('התמונה מוכנה. הגדר מפתח Gemini וחיבור לרשת כדי לזהות.'); return; }
          await recognize(prepared, request);
        } catch (error) {
          if (request !== sequence.current) return;
          errors.push(`תמונה ${index + 1}: ${errorMessage(error)}`);
          if (!personalVisionSession.ready || !navigator.onLine) break;
        }
      }
      if (request === sequence.current && errors.length) setMessage(errors.join(' '));
    } finally { if (request === sequence.current) { setBusy(false); setReady(personalVisionSession.ready); } }
  }
  async function retry() {
    if (!image || !navigator.onLine) return;
    const request = ++sequence.current; setBusy(true);
    try { await recognize(image, request); }
    catch (error) { if (request === sequence.current) setMessage(errorMessage(error)); }
    finally { if (request === sequence.current) { setBusy(false); setReady(personalVisionSession.ready); } }
  }
  function update(index: number, input: BookInput) { setRows(old => old.map((row, i) => i === index ? { ...row, input } : row)); }
  async function save() {
    setSaving(true); setMessage('שומר את הספרים שבחרת…');
    try {
      await db.transaction('rw', db.tables, async () => {
        for (const row of rows.filter(row => row.included)) {
          await saveBookSelections(db, { ...row.input, shelfIds: shelf.shelfIds }, row.catalogs, row.selection.selected.length ? [row.selection] : [], undefined, row.cover);
        }
      });
      onSaved();
    } catch (error) { setMessage(errorMessage(error) + ' לא נשמרו ספרים מהפעולה הזאת.'); }
    finally { setSaving(false); }
  }
  const count = rows.filter(row => row.included).length;
  return <Sheet title="הוספה מתמונה" onClose={onClose} busy={saving || catalogBusy.size > 0} dirty={rows.length > 0}>
    <div className="image-books">
      {!rows.length && <p>ספרים, שדרות או ברקודים — אפשר לבחור כמה תמונות. התוצאות יופיעו יחד לבחירה.</p>}
      {!ready && <VisionKey onChange={value => { setReady(value); setRows([]); }} />}
      <div className="image-pick"><label className="image-pick-action">בחירת תמונות<input aria-label="בחירת תמונת ספר" type="file" multiple accept="image/*" disabled={!ready || !online || busy || saving || catalogBusy.size > 0} onChange={event => { void choose(event.target.files); event.target.value = ''; }} /></label><label className="image-pick-action">צילום במצלמה<input aria-label="צילום ספר במצלמה" type="file" accept="image/*" capture="environment" disabled={!ready || !online || busy || saving || catalogBusy.size > 0} onChange={event => { void choose(event.target.files); event.target.value = ''; }} /></label></div>
      {image && !rows.length && <img ref={preview} className="image-books-preview" width={image.width} height={image.height} alt="תמונה מוכנה לשליחה לזיהוי" />}
      {busy && <button className="secondary" onClick={cancel}>ביטול הזיהוי</button>}
      <p role="status" aria-live="polite">{message}</p>
      {!online && <p>הזיהוי דורש חיבור לרשת. התמונה נשארת כאן.</p>}
      {image && !busy && !rows.length && <button disabled={!ready || !online} onClick={() => void retry()}>זיהוי הספרים בתמונה</button>}
      {!!rows.length && <fieldset disabled={saving || busy || catalogBusy.size > 0}>
        <h3>ספרים שזוהו ({rows.length})</h3>
        <SimpleShelfField input={shelf} onChange={setShelf} />
        <ul className="image-book-results">{rows.map((row, index) => <li key={index}>
          <label className="image-book-check"><input type="checkbox" aria-label={'הוספת ' + (row.input.title || `ספר ${index + 1}`)} checked={row.included} onChange={event => setRows(old => old.map((item, i) => i === index ? { ...item, included: event.target.checked } : item))} /></label>
          <details><summary>{row.cover && <Thumbnail image={row.cover} />}<strong>{row.input.title || 'שם לא זוהה'}</strong><span>{row.input.authors.join(' · ') || 'מחבר לא זוהה'}</span></summary>
            <label className="field">שם הספר<input value={row.input.title} onChange={event => update(index, { ...row.input, title: event.target.value })} /></label>
            <label className="field">מחבר<input value={row.input.authors.join(' · ')} onChange={event => update(index, { ...row.input, authors: [event.target.value] })} /></label>
            <label className="field">הוצאה לאור<input value={row.input.publisher} onChange={event => update(index, { ...row.input, publisher: event.target.value })} /></label>
            <label className="field">ISBN<input value={row.input.isbn} onChange={event => update(index, { ...row.input, isbn: event.target.value })} /></label>
            {([['subtitle', 'כותרת משנה'], ['danacode', 'דאנאקוד'], ['publicationYear', 'שנת הוצאה'], ['edition', 'מהדורה'], ['volume', 'כרך'], ['language', 'שפה'], ['pages', 'מספר עמודים']] as const).map(([field, label]) => <label className="field" key={field}>{label}<input value={row.input[field]} onChange={event => update(index, { ...row.input, [field]: event.target.value })} /></label>)}
            <GenreField input={row.input} onChange={input => update(index, input)} />
            {row.selection.item.uncertaintyReasons.map((reason, i) => <p key={i}>{reason}</p>)}
            <p className="hint">{row.selection.item.visibleText}</p>
            <CatalogPanel simple onBusy={value => setCatalogBusy(old => { if (old.has(index) === value) return old; const next = new Set(old); if (value) next.add(index); else next.delete(index); return next; })} input={row.input} fetchCover disabled={busy || saving || catalogBusy.size > 0} onApply={(input, candidate, selected, cover) => setRows(old => old.map((value, i) => i === index ? { ...value, input, cover: cover ?? value.cover, catalogs: [{ candidate, selected }], selection: { ...value.selection, selected: value.selection.selected.filter(field => !recognitionMetadataFields(value.selection.item, [field]).some(metadata => selected.includes(metadata))) } } : value))} />
          </details>
          {row.duplicate && <p className="hint">מזהה שכבר קיים. השאר ללא בחירה או תקן את המזהה בפרטים.</p>}
        </li>)}</ul>
        <p className="hint">רק הספרים שסימנת יישמרו. הזיהוי עשוי להחמיץ ספרים או לטעות בפרטים.</p>
        <div className="image-save-actions"><button disabled={!count || saving || busy || catalogBusy.size > 0} onClick={() => void save()}>{saving ? 'שומר…' : `הוספת ${count} ספרים לספרייה`}</button></div>
      </fieldset>}
    </div>
  </Sheet>;
}
