import { observeNearViewport } from './nearViewport';
import { Thumbnail } from './BookEditor';
import { useOnline } from './pwa';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { CatalogSearch, emptyQuery, openLibraryAdapter, unavailableAdapter, type CatalogQuery, type ProviderResult, type CatalogAdapter } from './data/catalog';
import { providerNames, type Candidate } from './data/metadata';
import { applyCatalogCandidate } from './data/catalogSave';
import { downloadBookCover } from './data/catalogCover';
import type { MetadataField, StoredImage } from './data/models';
import type { BookInput } from './data/books';
import { errorMessage } from './data/errors';
import { gatewayAdapter } from './data/catalogGateway';
import { goodreadsAdapter, goodreadsConfigured } from './data/goodreads';
import { danibooksAdapter, exactIdentifierMatch } from './data/danibooks';

const fieldLabels: Record<MetadataField, string> = { title: 'שם הספר', subtitle: 'כותרת משנה', authors: 'מחברים', isbn10: 'ISBN-10', isbn13: 'ISBN-13', danacode: 'דאנאקוד', publisher: 'הוצאה לאור', publicationYear: 'שנת הוצאה', publicationDate: 'תאריך פרסום', binding: 'סוג כריכה', edition: 'מהדורה', volume: 'כרך', language: 'שפה', pages: 'מספר עמודים', seriesName: 'סדרה', seriesNumber: 'מספר בסדרה' };
const openLibrary = openLibraryAdapter();
function serverAdapter(provider: 'nli' | 'googlebooks') {
  const origin = import.meta.env.VITE_CATALOG_GATEWAY;
  if (!origin) return unavailableAdapter(provider);
  try { return gatewayAdapter(provider, origin); } catch { return unavailableAdapter(provider); }
}
const serverAdapters = [serverAdapter('nli'), serverAdapter('googlebooks')];
function CatalogCoverPreview({ candidate, adapter }: { candidate: Candidate; adapter: CatalogAdapter }) {
  const container=useRef<HTMLDivElement>(null),completed=useRef('');
  const [near,setNear]=useState(false);
  useEffect(()=>container.current?observeNearViewport(container.current,setNear):undefined,[]);
  const token = JSON.stringify([candidate.provider,candidate.recordId,candidate.coverUrl,candidate.fetchedAt,candidate.fields.isbn13,candidate.fields.isbn10]);
  const [preview, setPreview] = useState<{ token: string; image?: StoredImage }>();
  const title = typeof candidate.fields.title === 'string' ? candidate.fields.title : 'ספר';
  useEffect(() => {
    if(!near || completed.current === token) return;
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]);
    const load = async () => {
      const isbn = String(candidate.fields.isbn13 ?? candidate.fields.isbn10 ?? '');
      try { return await downloadBookCover(candidate.coverUrl,isbn,signal); }
      catch { if(signal.aborted) return; }
      const url = await adapter.previewCover?.(candidate,signal);
      if(url && url !== candidate.coverUrl) return downloadBookCover(url,isbn,signal);
    };
    void load().then(image => { if(!controller.signal.aborted) { completed.current=token;setPreview({ token,image }); } }).catch(() => { if(!controller.signal.aborted) { completed.current=token;setPreview({ token }); } });
    return () => controller.abort();
  }, [candidate,adapter,token,near]);
  const image = preview?.token === token ? preview.image : undefined;
  const loading = Boolean(candidate.coverUrl || candidate.fields.isbn13 || candidate.fields.isbn10 || candidate.kind === 'edition' && adapter.previewCover) && preview?.token !== token;
  return <div ref={container} className="catalog-cover-preview">{image ? <Thumbnail image={image} alt={'כריכת ' + title} /> : <><span className="book-placeholder" aria-hidden="true" /><small>{loading ? 'טוען כריכה…' : 'אין כריכה זמינה'}</small></>}</div>;
}

export function CatalogPanel({ input, disabled, onApply, autoOpen = false, autoSearch = false, fetchCover = false, onBusy, simple = false, searchBy = 'identifier' }: { searchBy?: 'identifier' | 'details'; simple?: boolean; onBusy?: (busy: boolean) => void; input: BookInput; disabled: boolean; autoOpen?: boolean; autoSearch?: boolean; fetchCover?: boolean; onApply: (input: BookInput, candidate: Candidate, fields: MetadataField[], cover?: StoredImage) => void }) {
  const online = useOnline();
  const [query, setQuery] = useState<CatalogQuery>(() => simple && searchBy === 'details' ? { ...emptyQuery, title: input.title, author: input.authors.filter(Boolean).join(' ') } : autoSearch ? { ...emptyQuery, ...(searchBy === 'identifier' && (input.isbn || input.danacode) ? { isbn: input.isbn, danacode: input.danacode } : { title: input.title, author: input.authors.filter(Boolean).join(' ') }) } : ({ ...emptyQuery, title: input.title, author: input.authors.filter(Boolean).join(' '), publisher: input.publisher, year: input.publicationYear, isbn: input.isbn, danacode: input.danacode }));
  const [results, setResults] = useState<ProviderResult[]>([]), [searching, setSearching] = useState(false), [error, setError] = useState('');
  const [resolving, setResolving] = useState(false), [appliedMessage, setAppliedMessage] = useState('');
  const [adapter] = useState(() => openLibrary), [adapters] = useState(() => [openLibrary, ...serverAdapters, danibooksAdapter(), ...(goodreadsConfigured() ? [goodreadsAdapter()] : [])]), [search] = useState(() => new CatalogSearch(db, adapters));
  const request = useRef(0), resolveRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => { onBusy?.(searching || resolving); }, [onBusy, searching, resolving]);
  useEffect(() => () => { search.cancel(); resolveRequest.current?.abort(); request.current++; }, [search]);
  async function run() {
    if (!navigator.onLine) { setError('חיפוש בקטלוגים דורש חיבור לרשת. אפשר למלא ידנית.'); return; }
    const sequence = ++request.current; resolveRequest.current?.abort(); setResolving(false); setAppliedMessage(''); setError(''); setResults([]); setSearching(true);
    try { const collected: ProviderResult[] = []; await search.search(query, result => { collected.push(result); setResults(old => [...old.filter(item => item.provider !== result.provider), result]); }); const candidates = collected.flatMap(result => result.candidates); if (sequence === request.current && autoSearch && searchBy === 'identifier' && candidates.length === 1) await choose(candidates[0], true); }
    catch (error) { setError(errorMessage(error)); } finally { if (sequence === request.current) setSearching(false); }
  }
  const autoRun = useEffectEvent(run);
  useEffect(() => { if (!autoSearch) return; const timer = window.setTimeout(() => void autoRun(), 0); return () => window.clearTimeout(timer); }, [autoSearch]);
  async function choose(value: Candidate, automatic = false) {
    if (!navigator.onLine) { setError('טעינת מועמד דורשת חיבור לרשת.'); return; }
    resolveRequest.current?.abort(); const controller = new AbortController(); resolveRequest.current = controller;
    setResolving(true); setAppliedMessage(''); setError('');
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const source = adapters.find(item => item.provider === value.provider);
      const resolved = source?.resolve ? await source.resolve(value, controller.signal) : value;
      if (controller.signal.aborted) return;
      if (automatic && !exactIdentifierMatch(query, resolved)) { setError('נמצאה תוצאה ללא התאמה מדויקת למזהה. בדוק את פרטי הספר ובחר אותה רק אם היא מתאימה.'); return; }
      const { draft, fields } = applyCatalogCandidate(input, resolved);
      let cover: StoredImage | undefined, message = 'כל הפרטים הזמינים הועברו לטיוטה. אפשר לערוך לפני שמירת הספר.';
      if (fetchCover && (resolved.coverUrl || draft.isbn)) {
        const coverSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
        try { cover = await downloadBookCover(resolved.coverUrl, draft.isbn, coverSignal); message += ' הכריכה נטענה.'; }
        catch { if (controller.signal.aborted) return; message += ' הכריכה לא נטענה; אפשר להעלות תמונה ידנית.'; }
      } else if (fetchCover) message += ' לא נמצאה כריכה בתוצאה.';
      if (controller.signal.aborted || resolveRequest.current !== controller) return;
      // Keep transient cover URLs out of released backup/draft candidate shapes.
      const candidate: Candidate = { provider: resolved.provider, recordId: resolved.recordId, sourceUrl: resolved.sourceUrl, fetchedAt: resolved.fetchedAt, kind: resolved.kind, fields: resolved.fields, warnings: resolved.warnings, ...(resolved.genres ? { genres: resolved.genres } : {}) };
      onApply(draft, candidate, fields, cover);
      setAppliedMessage(message); setError(resolved.warnings.join(' '));
    } catch {
      if (resolveRequest.current === controller) setError(controller.signal.aborted ? 'טעינת המהדורה הופסקה. אפשר לבחור שוב או למלא ידנית.' : 'פרטי המהדורה לא נטענו. לא הוחל מידע על הספר.');
    } finally { clearTimeout(timer); if (resolveRequest.current === controller) { setResolving(false); if (controller.signal.aborted) setError('הטעינה הופסקה. אפשר לבחור שוב או למלא ידנית.'); } }
  }
  const labels: Record<keyof CatalogQuery, string> = { title: 'שם לחיפוש', author: 'מחבר לחיפוש', publisher: 'הוצאה לחיפוש', year: 'שנה לחיפוש', isbn: 'ISBN לחיפוש', danacode: 'דאנאקוד לחיפוש' };
  return <details data-update-blocked={searching || resolving} className="catalog-panel" open={autoOpen || undefined}><summary>{simple ? 'חיפוש ספר' : 'חיפוש והשלמה מקטלוגים'}</summary>{!online && <p role="status">החיפוש דורש חיבור לרשת.</p>}{simple ? <label className="field">שם ספר, דאנאקוד או ISBN<input value={query.isbn || query.danacode || query.title} maxLength={300} disabled={disabled} onChange={event => { const value = event.target.value; setQuery({ ...emptyQuery, ...(/^[\d -]+$/.test(value) && value.trim() ? (/^97[89][\d -]+$/.test(value) ? { isbn: value } : { danacode: value }) : { title: value, author: query.author }) }); }} /></label> : <><p className="hint">בחירת תוצאה מעבירה את כל הפרטים הזמינים לטיוטה.</p><div className="field-grid">{Object.entries(labels).map(([key, label]) => <label className="field" key={key}>{label}<input maxLength={300} value={query[key as keyof CatalogQuery]} disabled={disabled} onChange={event => setQuery({ ...query, [key]: event.target.value })} /></label>)}</div></>}{simple && <label className="field">מחבר לחיפוש<input value={query.author} maxLength={300} disabled={disabled} onChange={event => setQuery({ ...query, author: event.target.value })} /></label>}<div className="actions"><button type="button" disabled={disabled || !online} onClick={() => void run()}>חיפוש בקטלוגים</button>{(searching || resolving) && <button type="button" className="secondary" onClick={() => { search.cancel(); resolveRequest.current?.abort(); request.current++; setSearching(false); setResolving(false); }}>ביטול החיפוש</button>}{!simple && <button type="button" className="secondary" disabled={disabled || searching || resolving} onClick={async () => { try { await db.metadataCache.clear(); setResults([]); setError('מטמון החיפוש נמחק.'); } catch (error) { setError(errorMessage(error)); } }}>ניקוי תוצאות שמורות</button>}</div>

    <p role="status" aria-live="polite">{searching ? 'מחפש בקטלוגים…' : resolving ? 'טוען פרטי מהדורה…' : ''}</p><p role="alert" className="error-message">{error}</p>
    <div className="catalog-results">{results.filter(result => !simple || (query.danacode ? result.provider === 'danibooks' : result.provider !== 'danibooks' && (result.provider === 'openlibrary' || result.provider === 'goodreads' || result.state !== 'unavailable'))).map(result => <section key={result.provider}><h3>{providerNames[result.provider]}</h3><p role={['error','timeout','rate-limited','unavailable'].includes(result.state) ? 'alert' : 'status'}>{result.message}</p>{result.candidates.map(item => <article className="candidate" key={item.recordId}><CatalogCoverPreview candidate={item} adapter={adapters.find(value=>value.provider===item.provider) ?? adapter} /><div className="catalog-candidate-details"><h4>{item.fields.title ?? (item.provider === 'goodreads' ? 'מהדורת Goodreads ' + item.recordId : 'ללא שם')}</h4><p>{item.kind === 'work' ? 'יצירה כללית · מהדורה לא מאומתת' : 'מהדורה מוצעת · בדוק מול העותק'}</p>{item.fields.authors && <p>{(item.fields.authors as string[]).join(' · ')}</p>}<button type="button" className="secondary" disabled={disabled || resolving || !online} onClick={() => void choose(item)}>בחירת מועמד {item.fields.title ?? (item.provider === 'goodreads' ? 'מהדורת Goodreads ' + item.recordId : 'ללא שם')}</button></div></article>)}</section>)}</div>
    {appliedMessage && <p className="notice" role="status">{appliedMessage}</p>}

  </details>;
}
export function Provenance({ bookId }: { bookId: string }) {
  const sources = useLiveQuery(() => db.metadataSources.where('bookId').equals(bookId).toArray(), [bookId]);
  return sources?.length ? <details><summary>מקורות המידע ({sources.length})</summary>{sources.map(source => <section key={source.id}><h3>{source.provider === 'groq' ? 'זיהוי מתמונה · Groq' : source.provider === 'ocr' ? 'OCR מקומי' : source.provider === 'gemini' ? 'זיהוי מתמונה · Gemini' : providerNames[source.provider as keyof typeof providerNames]}</h3><p>{source.selectedFields.map(field => fieldLabels[field]).join(' · ')}</p>{source.userOverriddenFields.length > 0 && <p>נערך ידנית: {source.userOverriddenFields.map(field => fieldLabels[field]).join(' · ')}</p>}{source.recognition && <details><summary>ראיות הזיהוי מהתמונה</summary><p className="hint">{source.recognition.model} · {source.recognition.version}</p><p className="visible-text">{source.recognition.item.visibleText}</p>{source.recognition.item.uncertaintyReasons.map((reason, i) => <p key={i}>{reason}</p>)}</details>}{source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">רשומת המקור</a>}</section>)}</details> : null;
}
