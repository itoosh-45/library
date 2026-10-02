import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { CatalogSearch, emptyQuery, openLibraryAdapter, unavailableAdapter, type CatalogQuery, type ProviderResult } from './data/catalog';
import { providerNames, metadataFields, type Candidate } from './data/metadata';
import { inputFieldValue } from './data/catalogSave';
import type { MetadataField } from './data/models';
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
export function CatalogPanel({ input, disabled, onApply }: { input: BookInput; disabled: boolean; onApply: (input: BookInput, candidate: Candidate, fields: MetadataField[]) => void }) {
  const [query, setQuery] = useState<CatalogQuery>(() => ({ ...emptyQuery, title: input.title, author: input.authors.filter(Boolean).join(' '), publisher: input.publisher, year: input.publicationYear, isbn: input.isbn, danacode: input.danacode }));
  const [results, setResults] = useState<ProviderResult[]>([]), [searching, setSearching] = useState(false), [error, setError] = useState('');
  const [candidate, setCandidate] = useState<Candidate>(), [selected, setSelected] = useState<MetadataField[]>([]), [resolving, setResolving] = useState(false);
  const [adapter] = useState(() => openLibrary), [search] = useState(() => new CatalogSearch(db, [adapter, ...serverAdapters]));
  const request = useRef(0), resolveRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { search.cancel(); resolveRequest.current?.abort(); request.current++; }, [search]);
  async function run() {
    const sequence = ++request.current; resolveRequest.current?.abort(); setResolving(false); setCandidate(undefined); setSelected([]); setError(''); setResults([]); setSearching(true);
    try { await search.search(query, result => setResults(old => [...old.filter(item => item.provider !== result.provider), result])); }
    catch (error) { setError(errorMessage(error)); } finally { if (sequence === request.current) setSearching(false); }
  }
  async function choose(value: Candidate) {
    resolveRequest.current?.abort(); const controller = new AbortController(); resolveRequest.current = controller; setResolving(true); setCandidate(undefined); setSelected([]); setError('');
    const timer = setTimeout(() => controller.abort(), 12000);
    try { const resolved = value.provider === 'openlibrary' && adapter.resolve ? await adapter.resolve(value, controller.signal) : value; if (!controller.signal.aborted) setCandidate(resolved); }
    catch { if (resolveRequest.current === controller) setError(controller.signal.aborted ? 'טעינת המהדורה הופסקה. אפשר לבחור שוב או למלא ידנית.' : 'פרטי המהדורה לא נטענו. לא הוחל מידע על הספר.'); }
    finally { clearTimeout(timer); if (resolveRequest.current === controller) setResolving(false); }
  }
  const labels: Record<keyof CatalogQuery, string> = { title: 'שם לחיפוש', author: 'מחבר לחיפוש', publisher: 'הוצאה לחיפוש', year: 'שנה לחיפוש', isbn: 'ISBN לחיפוש', danacode: 'דאנאקוד לחיפוש' };
  return <details className="catalog-panel"><summary>חיפוש והשלמה מקטלוגים</summary><p className="hint">רק פרטי החיפוש יישלחו לקטלוג. בחר שדות ובדוק את המהדורה לפני שמירה.</p><div className="field-grid">{Object.entries(labels).map(([key, label]) => <label className="field" key={key}>{label}<input maxLength={300} value={query[key as keyof CatalogQuery]} disabled={disabled} onChange={event => setQuery({ ...query, [key]: event.target.value })} /></label>)}</div><div className="actions"><button type="button" disabled={disabled} onClick={() => void run()}>חיפוש בקטלוגים</button>{(searching || resolving) && <button type="button" className="secondary" onClick={() => { search.cancel(); resolveRequest.current?.abort(); request.current++; setSearching(false); setResolving(false); }}>ביטול החיפוש</button>}<button type="button" className="secondary" disabled={disabled || searching || resolving} onClick={async () => { try { await db.metadataCache.clear(); setResults([]); setError('מטמון החיפוש נמחק.'); } catch (error) { setError(errorMessage(error)); } }}>ניקוי תוצאות שמורות</button></div>
    {query.danacode && <p>דאנאקוד נשמר כפי שהוזן. <a href={'https://www.nli.org.il/he/search?projectName=NLI#&q=any,contains,' + encodeURIComponent(query.danacode) + '&bulkSize=30&index=0&sort=rank&t=allresults&mode=basic'} target="_blank" rel="noopener noreferrer">פתיחת חיפוש ידני בספרייה הלאומית</a></p>}
    <p role="status" aria-live="polite">{searching ? 'מחפש בקטלוגים…' : resolving ? 'טוען פרטי מהדורה…' : ''}</p><p role="alert" className="error-message">{error}</p>
    <div className="catalog-results">{results.map(result => <section key={result.provider}><h3>{providerNames[result.provider]}</h3><p role="status">{result.message}</p>{result.candidates.map(item => <article className="candidate" key={item.recordId}><h4>{item.fields.title ?? 'ללא שם'}</h4><p>{item.kind === 'work' ? 'יצירה כללית · מהדורה לא מאומתת' : 'מהדורה מוצעת · בדוק מול העותק'}</p>{item.fields.authors && <p>{(item.fields.authors as string[]).join(' · ')}</p>}<button type="button" className="secondary" disabled={disabled || resolving} onClick={() => void choose(item)}>בחירת מועמד {item.fields.title ?? 'ללא שם'}</button></article>)}</section>)}</div>
    {candidate && <section className="notice"><h3>בחירת שדות: {candidate.fields.title ?? 'ללא שם'}</h3><p>{providerNames[candidate.provider]} · {candidate.kind === 'work' ? 'יצירה כללית' : 'מהדורה מוצעת'}</p>{candidate.sourceUrl && <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">פתיחת רשומת המקור</a>}{candidate.warnings.map((warning, i) => <p key={i} className="hint">{warning}</p>)}
      {metadataFields.filter(field => candidate.fields[field] != null).map(field => { const current = inputFieldValue(input, field), value = candidate.fields[field]; return <label className="catalog-choice" key={field}><input type="checkbox" disabled={disabled} checked={selected.includes(field)} onChange={event => setSelected(event.target.checked ? [...selected.filter(item => !(item.startsWith('isbn') && field.startsWith('isbn'))), field] : selected.filter(item => item !== field))} /><span><strong>{fieldLabels[field]}: </strong>{Array.isArray(value) ? value.join(' · ') : String(value)}{current != null && JSON.stringify(current) !== JSON.stringify(value) && <small>כעת בספר: {Array.isArray(current) ? current.join(' · ') : String(current)} · יוחלף רק אם תבחר בשדה</small>}</span></label>; })}
      <button type="button" disabled={disabled || !selected.length} onClick={() => { const draft = { ...input }; for (const field of selected) { const value = candidate.fields[field]; if (field === 'authors') draft.authors = [...value as string[]]; else if (field === 'isbn10' || field === 'isbn13') draft.isbn = String(value); else draft[field] = String(value); } onApply(draft, candidate, selected); setCandidate(undefined); setSelected([]); }}>החלת השדות שנבחרו</button><p className="hint">השדות יועברו לטיוטה. אפשר לערוך אותם לפני ״שמירת הספר״.</p>
    </section>}
  </details>;
}
export function Provenance({ bookId }: { bookId: string }) {
  const sources = useLiveQuery(() => db.metadataSources.where('bookId').equals(bookId).toArray(), [bookId]);
  return sources?.length ? <details><summary>מקורות המידע ({sources.length})</summary>{sources.map(source => <section key={source.id}><h3>{providerNames[source.provider as keyof typeof providerNames]}</h3><p>{source.selectedFields.map(field => fieldLabels[field]).join(' · ')}</p>{source.userOverriddenFields.length > 0 && <p>נערך ידנית: {source.userOverriddenFields.map(field => fieldLabels[field]).join(' · ')}</p>}{source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">רשומת המקור</a>}</section>)}</details> : null;
}
