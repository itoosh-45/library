import { useOnline } from './pwa';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { CatalogSearch, emptyQuery, openLibraryAdapter, unavailableAdapter, type CatalogQuery, type ProviderResult } from './data/catalog';
import { providerNames, type Candidate } from './data/metadata';
import { applyCatalogCandidate } from './data/catalogSave';
import { downloadCatalogCover } from './data/catalogCover';
import type { MetadataField, StoredImage } from './data/models';
import type { BookInput } from './data/books';
import { errorMessage } from './data/errors';
import { gatewayAdapter } from './data/catalogGateway';

const fieldLabels: Record<MetadataField, string> = { title: 'שם הספר', subtitle: 'כותרת משנה', authors: 'מחברים', isbn10: 'ISBN-10', isbn13: 'ISBN-13', danacode: 'דאנאקוד', publisher: 'הוצאה לאור', publicationYear: 'שנת הוצאה', edition: 'מהדורה', volume: 'כרך', language: 'שפה', pages: 'מספר עמודים' };
const openLibrary = openLibraryAdapter();
function serverAdapter(provider: 'nli' | 'googlebooks') {
  const origin = import.meta.env.VITE_CATALOG_GATEWAY;
  if (!origin) return unavailableAdapter(provider);
  try { return gatewayAdapter(provider, origin); } catch { return unavailableAdapter(provider); }
}
const serverAdapters = [serverAdapter('nli'), serverAdapter('googlebooks')];
export function CatalogPanel({ input, disabled, onApply, autoOpen = false, autoSearch = false, fetchCover = false, onBusy, simple = false }: { simple?: boolean; onBusy?: (busy: boolean) => void; input: BookInput; disabled: boolean; autoOpen?: boolean; autoSearch?: boolean; fetchCover?: boolean; onApply: (input: BookInput, candidate: Candidate, fields: MetadataField[], cover?: StoredImage) => void }) {
  const online = useOnline();
  const [query, setQuery] = useState<CatalogQuery>(() => autoSearch ? { ...emptyQuery, isbn: input.isbn, danacode: input.danacode } : ({ ...emptyQuery, title: input.title, author: input.authors.filter(Boolean).join(' '), publisher: input.publisher, year: input.publicationYear, isbn: input.isbn, danacode: input.danacode }));
  const [results, setResults] = useState<ProviderResult[]>([]), [searching, setSearching] = useState(false), [error, setError] = useState('');
  const [resolving, setResolving] = useState(false), [appliedMessage, setAppliedMessage] = useState('');
  const [adapter] = useState(() => openLibrary), [search] = useState(() => new CatalogSearch(db, [adapter, ...serverAdapters]));
  const request = useRef(0), resolveRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => { onBusy?.(resolving); }, [onBusy, resolving]);
  useEffect(() => () => { search.cancel(); resolveRequest.current?.abort(); request.current++; }, [search]);
  async function run() {
    if (!navigator.onLine) { setError('חיפוש בקטלוגים דורש חיבור לרשת. אפשר למלא ידנית.'); return; }
    const sequence = ++request.current; resolveRequest.current?.abort(); setResolving(false); setAppliedMessage(''); setError(''); setResults([]); setSearching(true);
    try { await search.search(query, result => setResults(old => [...old.filter(item => item.provider !== result.provider), result])); }
    catch (error) { setError(errorMessage(error)); } finally { if (sequence === request.current) setSearching(false); }
  }
  const autoRun = useEffectEvent(run);
  useEffect(() => { if (!autoSearch) return; const timer = window.setTimeout(() => void autoRun(), 0); return () => window.clearTimeout(timer); }, [autoSearch]);
  async function choose(value: Candidate) {
    if (!navigator.onLine) { setError('טעינת מועמד דורשת חיבור לרשת.'); return; }
    resolveRequest.current?.abort(); const controller = new AbortController(); resolveRequest.current = controller;
    setResolving(true); setAppliedMessage(''); setError('');
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const resolved = value.provider === 'openlibrary' && adapter.resolve ? await adapter.resolve(value, controller.signal) : value;
      if (controller.signal.aborted) return;
      const { draft, fields } = applyCatalogCandidate(input, resolved);
      let cover: StoredImage | undefined, message = 'כל הפרטים הזמינים הועברו לטיוטה. אפשר לערוך לפני שמירת הספר.';
      if (fetchCover && resolved.coverUrl) {
        const coverSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
        try { cover = await downloadCatalogCover(resolved.coverUrl, coverSignal); message += ' הכריכה נטענה.'; }
        catch { if (controller.signal.aborted) return; message += ' הכריכה לא נטענה; אפשר להעלות תמונה ידנית.'; }
      } else if (fetchCover) message += ' לא נמצאה כריכה בתוצאה.';
      if (controller.signal.aborted || resolveRequest.current !== controller) return;
      // Keep transient cover URLs out of released backup/draft candidate shapes.
      const candidate: Candidate = { provider: resolved.provider, recordId: resolved.recordId, sourceUrl: resolved.sourceUrl, fetchedAt: resolved.fetchedAt, kind: resolved.kind, fields: resolved.fields, warnings: resolved.warnings };
      onApply(draft, candidate, fields, cover);
      setAppliedMessage(message); setError(resolved.warnings.join(' '));
    } catch {
      if (resolveRequest.current === controller) setError(controller.signal.aborted ? 'טעינת המהדורה הופסקה. אפשר לבחור שוב או למלא ידנית.' : 'פרטי המהדורה לא נטענו. לא הוחל מידע על הספר.');
    } finally { clearTimeout(timer); if (resolveRequest.current === controller) { setResolving(false); if (controller.signal.aborted) setError('הטעינה הופסקה. אפשר לבחור שוב או למלא ידנית.'); } }
  }
  const labels: Record<keyof CatalogQuery, string> = { title: 'שם לחיפוש', author: 'מחבר לחיפוש', publisher: 'הוצאה לחיפוש', year: 'שנה לחיפוש', isbn: 'ISBN לחיפוש', danacode: 'דאנאקוד לחיפוש' };
  return <details data-update-blocked={searching || resolving} className="catalog-panel" open={autoOpen || undefined}><summary>{simple ? 'חיפוש ספר' : 'חיפוש והשלמה מקטלוגים'}</summary>{!online && <p role="status">החיפוש דורש חיבור לרשת.</p>}{simple ? <label className="field">שם ספר או ISBN<input value={query.isbn || query.title} maxLength={300} disabled={disabled} onChange={event => { const value = event.target.value; setQuery({ ...emptyQuery, ...(/^[\d -]+$/.test(value) && value.trim() ? { isbn: value } : { title: value }) }); }} /></label> : <><p className="hint">בחירת תוצאה מעבירה את כל הפרטים הזמינים לטיוטה.</p><div className="field-grid">{Object.entries(labels).map(([key, label]) => <label className="field" key={key}>{label}<input maxLength={300} value={query[key as keyof CatalogQuery]} disabled={disabled} onChange={event => setQuery({ ...query, [key]: event.target.value })} /></label>)}</div></>}<div className="actions"><button type="button" disabled={disabled || !online} onClick={() => void run()}>חיפוש בקטלוגים</button>{(searching || resolving) && <button type="button" className="secondary" onClick={() => { search.cancel(); resolveRequest.current?.abort(); request.current++; setSearching(false); setResolving(false); }}>ביטול החיפוש</button>}{!simple && <button type="button" className="secondary" disabled={disabled || searching || resolving} onClick={async () => { try { await db.metadataCache.clear(); setResults([]); setError('מטמון החיפוש נמחק.'); } catch (error) { setError(errorMessage(error)); } }}>ניקוי תוצאות שמורות</button>}</div>
    {query.danacode && <p>דאנאקוד נשמר כפי שהוזן. <a href={'https://www.nli.org.il/he/search?projectName=NLI#&q=any,contains,' + encodeURIComponent(query.danacode) + '&bulkSize=30&index=0&sort=rank&t=allresults&mode=basic'} target="_blank" rel="noopener noreferrer">פתיחת חיפוש ידני בספרייה הלאומית</a></p>}
    <p role="status" aria-live="polite">{searching ? 'מחפש בקטלוגים…' : resolving ? 'טוען פרטי מהדורה…' : ''}</p><p role="alert" className="error-message">{error}</p>
    <div className="catalog-results">{results.filter(result => !simple || result.provider === 'openlibrary' || result.state !== 'unavailable').map(result => <section key={result.provider}><h3>{providerNames[result.provider]}</h3><p role="status">{result.message}</p>{result.candidates.map(item => <article className="candidate" key={item.recordId}><h4>{item.fields.title ?? 'ללא שם'}</h4><p>{item.kind === 'work' ? 'יצירה כללית · מהדורה לא מאומתת' : 'מהדורה מוצעת · בדוק מול העותק'}</p>{item.fields.authors && <p>{(item.fields.authors as string[]).join(' · ')}</p>}<button type="button" className="secondary" disabled={disabled || resolving || !online} onClick={() => void choose(item)}>בחירת מועמד {item.fields.title ?? 'ללא שם'}</button></article>)}</section>)}</div>
    {appliedMessage && <p className="notice" role="status">{appliedMessage}</p>}

  </details>;
}
export function Provenance({ bookId }: { bookId: string }) {
  const sources = useLiveQuery(() => db.metadataSources.where('bookId').equals(bookId).toArray(), [bookId]);
  return sources?.length ? <details><summary>מקורות המידע ({sources.length})</summary>{sources.map(source => <section key={source.id}><h3>{source.provider === 'gemini' ? 'זיהוי מתמונה · Gemini' : providerNames[source.provider as keyof typeof providerNames]}</h3><p>{source.selectedFields.map(field => fieldLabels[field]).join(' · ')}</p>{source.userOverriddenFields.length > 0 && <p>נערך ידנית: {source.userOverriddenFields.map(field => fieldLabels[field]).join(' · ')}</p>}{source.recognition && <details><summary>ראיות הזיהוי מהתמונה</summary><p className="hint">{source.recognition.model} · {source.recognition.version}</p><p className="visible-text">{source.recognition.item.visibleText}</p>{source.recognition.item.uncertaintyReasons.map((reason, i) => <p key={i}>{reason}</p>)}</details>}{source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">רשומת המקור</a>}</section>)}</details> : null;
}
