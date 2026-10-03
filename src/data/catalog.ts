import type { LibraryDatabase } from './database';
import { comparableISBN, parseISBN } from './books';
import { LibraryValidationError } from './library';
import { validateCandidate, type Candidate, type FieldValues, type Provider } from './metadata';

export interface CatalogQuery { title: string; author: string; publisher: string; year: string; isbn: string; danacode: string }
export const emptyQuery: CatalogQuery = { title: '', author: '', publisher: '', year: '', isbn: '', danacode: '' };
export type ProviderState = 'success' | 'empty' | 'timeout' | 'error' | 'rate-limited' | 'unavailable' | 'cancelled';
export interface ProviderResult { provider: Provider; state: ProviderState; candidates: Candidate[]; message: string; cached?: boolean }
export interface CatalogAdapter { provider: Provider; search(query: CatalogQuery, signal: AbortSignal): Promise<Candidate[]>; resolve?(candidate: Candidate, signal: AbortSignal): Promise<Candidate> }
export class CatalogError extends Error { constructor(public state: ProviderState, public safeMessage: string, public retryAfterMilliseconds?: number) { super(safeMessage); } }
export function retryAfterMs(headers: Headers): number {
  const retry = headers.get('Retry-After'), milliseconds = retry && /^\d+$/.test(retry) ? +retry * 1000 : retry ? Date.parse(retry) - Date.now() : 60000;
  return Math.max(1000, Number.isFinite(milliseconds) ? milliseconds : 60000);
}
const cancelled = () => new CatalogError('cancelled', 'החיפוש בוטל.');
export function validateQuery(value: CatalogQuery): CatalogQuery {
  if (!value || Object.keys(value).length !== 6 || Object.keys(value).some(key => !Object.hasOwn(emptyQuery, key)) || Object.values(value).some(item => typeof item !== 'string' || item.length > 300)) throw new LibraryValidationError('פרטי החיפוש אינם תקינים.');
  const query = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.trim()])) as unknown as CatalogQuery;
  if (!Object.values(query).some(Boolean)) throw new LibraryValidationError('הזן פרטי ספר לחיפוש.');
  if (query.year && (!/^\d{4}$/.test(query.year) || +query.year < 1000)) throw new LibraryValidationError('שנת החיפוש אינה תקינה.');
  if (query.isbn) { const isbn = parseISBN(query.isbn); query.isbn = isbn.isbn13 ?? isbn.isbn10 ?? ''; }
  return query;
}
const quote = (value: string) => '"' + value.replace(/[\\"]/g, '\\$&') + '"';
const string = (value: unknown): string | undefined => typeof value === 'string' && value.trim() && value.length <= 1000 ? value.trim() : undefined;
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('error', 'הקטלוג החזיר נתונים לא תקינים.'); return value as Record<string, unknown>; };
export async function readCatalogValue(response: Response): Promise<unknown> {
  if (!response.body) throw new CatalogError('error', 'תגובת הקטלוג ריקה.');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let length = 0, text = '';
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 2 * 1024 * 1024) throw new CatalogError('error', 'תגובת הקטלוג גדולה מדי.'); text += decoder.decode(value, { stream: true }); } return JSON.parse(text + decoder.decode()); }
  finally { await reader.cancel().catch(() => {}); }
}
export async function readCatalogJson(response: Response): Promise<Record<string, unknown>> { return object(await readCatalogValue(response)); }
const stringList = (value: unknown): string[] => Array.isArray(value) ? value.slice(0, 20).map(string).filter((item): item is string => !!item) : [];
const number = (value: unknown, max: number): number | undefined => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max ? value : undefined;
async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw cancelled();
  return new Promise<T>((resolve, reject) => { const abort = () => reject(cancelled()); signal.addEventListener('abort', abort, { once: true }); promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)); });
}
async function delay(ms: number, signal: AbortSignal) {
  if (signal.aborted) throw cancelled();
  await new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(cancelled()); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms); signal.addEventListener('abort', abort, { once: true }); });
}
export function openLibraryAdapter(fetcher: typeof fetch = fetch): CatalogAdapter {
  let nextAt = 0, stoppedUntil = 0;
  async function request(path: string, signal: AbortSignal, retried = false): Promise<Record<string, unknown>> {
    if (Date.now() < stoppedUntil) throw new CatalogError('rate-limited', 'הקטלוג ביקש להמתין לפני חיפוש נוסף.');
    const start = Math.max(Date.now(), nextAt); nextAt = start + 1050;
    await delay(Math.max(0, start - Date.now()), signal);
    if (Date.now() < stoppedUntil) throw new CatalogError('rate-limited', 'הקטלוג ביקש להמתין לפני חיפוש נוסף.');
    let response: Response;
    try { response = await fetcher('https://openlibrary.org' + path, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' }); }
    catch { if (signal.aborted) throw cancelled(); if (!retried) { await delay(1500, signal); return request(path, signal, true); } throw new CatalogError('error', 'הקטלוג אינו זמין כרגע.'); }
    if (response.status === 429) {
      stoppedUntil = Date.now() + retryAfterMs(response.headers);
      throw new CatalogError('rate-limited', 'הקטלוג הגביל את קצב החיפוש. נסה מאוחר יותר.');
    }
    if (response.status >= 500 && !retried) { await response.body?.cancel(); await delay(1500, signal); return request(path, signal, true); }
    if (!response.ok) throw new CatalogError('error', 'הקטלוג אינו זמין כרגע. לא נשמר מידע.');
    return readCatalogJson(response);
  }
  return { provider: 'openlibrary', async search(query, signal) {
    if (query.danacode) throw new CatalogError('unavailable', 'דאנאקוד דורש חיפוש ידני בקטלוג מורשה.');
    const q = query.isbn ? 'isbn:' + quote(query.isbn) : [['title', query.title], ['author', query.author], ['publisher', query.publisher], ['publish_year', query.year]].filter(([, value]) => value).map(([key, value]) => key + ':' + quote(value)).join(' AND ');
    const params = new URLSearchParams({ q, limit: '10', lang: 'he', fields: 'key,title,author_name,editions,editions.key,editions.title,cover_i' });
    const response = await request('/search.json?' + params, signal);
    if (!Array.isArray(response.docs)) throw new CatalogError('error', 'תגובת החיפוש אינה תקינה.');
    const candidates: Candidate[] = [];
    for (const item of response.docs.slice(0, 10)) {
      const work = object(item), editions = work.editions ? object(work.editions) : undefined, rows = editions && Array.isArray(editions.docs) ? editions.docs : [];
      const edition = rows[0] && object(rows[0]), editionKey = edition && string(edition.key), workKey = string(work.key);
      const key = editionKey && /^\/books\/OL\d+M$/.test(editionKey) ? editionKey : workKey && /^(\/works\/)?OL\d+W$/.test(workKey) ? (workKey.startsWith('/') ? workKey : '/works/' + workKey) : undefined;
      if (!key) continue;
      const title = string(editionKey === key ? edition?.title : work.title), fields: FieldValues = {};
      if (title) fields.title = title;
      if (!editionKey || editionKey !== key) { const authors = stringList(work.author_name); if (authors.length) fields.authors = authors; }
      candidates.push(validateCandidate({ provider: 'openlibrary', recordId: key, sourceUrl: 'https://openlibrary.org' + key, fetchedAt: new Date().toISOString(), kind: key.startsWith('/books/') ? 'edition' : 'work', fields, ...(typeof work.cover_i === 'number' && Number.isSafeInteger(work.cover_i) && work.cover_i > 0 && work.cover_i < 1e12 && key.startsWith('/works/') ? { coverUrl: `https://covers.openlibrary.org/b/id/${work.cover_i}-M.jpg?default=false` } : {}), warnings: [key.startsWith('/books/') ? 'פרטי המהדורה ייטענו אחרי בחירה.' : 'יצירה כללית: אינה מאמתת מהדורה או ISBN.'] }));
    }
    return candidates;
  }, async resolve(candidate, signal) {
    validateCandidate(candidate);
    if (candidate.provider !== 'openlibrary' || candidate.kind !== 'edition' || !/^\/books\/OL\d+M$/.test(candidate.recordId)) return candidate;
    const row = await request(candidate.recordId + '.json', signal), fields: FieldValues = {}, warnings: string[] = [];
    for (const key of ['title', 'subtitle', 'edition', 'volume'] as const) { const value = string(row[key === 'edition' ? 'edition_name' : key]); if (value) fields[key] = value; }
    const publishers = stringList(row.publishers); if (publishers.length === 1) fields.publisher = publishers[0]; else if (publishers.length > 1) warnings.push('כמה הוצאות: השדה נשאר לבחירה ידנית.');
    const date = string(row.publish_date); if (date && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(date) && +date.slice(0, 4) >= 1000) fields.publicationYear = +date.slice(0, 4);
    else if (date) warnings.push('תאריך הפרסום אינו שנה חד־משמעית.');
    const pages = number(row.number_of_pages, 100000); if (pages) fields.pages = pages;
    const isbns = [...stringList(row.isbn_13), ...stringList(row.isbn_10)].flatMap(code => { try { const isbn = parseISBN(code); return [isbn.isbn13 ?? isbn.isbn10!]; } catch { warnings.push('ISBN לא תקין הושמט.'); return []; } });
    const unique = [...new Set(isbns)], equivalent = new Set(unique.map(code => comparableISBN(parseISBN(code))));
    if (equivalent.size === 1) for (const code of unique) fields[code.length === 13 ? 'isbn13' : 'isbn10'] = code;
    else if (unique.length > 1) warnings.push('כמה מזהי ISBN: בדוק את המזהה על העותק לפני הזנה ידנית.');
    const languages = Array.isArray(row.languages) ? row.languages.map(value => object(value).key).filter((key): key is string => typeof key === 'string' && /^\/languages\/[a-z]{3}$/.test(key)) : [];
    if (languages.length === 1) fields.language = languages[0].slice(-3);
    if (Array.isArray(row.authors)) {
      const names: string[] = [];
      for (const ref of row.authors.slice(0, 6)) { const key = object(ref).key; if (typeof key !== 'string' || !/^\/authors\/OL\d+A$/.test(key)) continue; const name = string((await request(key + '.json', signal)).name); if (name) names.push(name); }
      if (names.length) fields.authors = [...new Set(names)];
    }
    const cover = Array.isArray(row.covers) ? row.covers.find(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < 1e12) : undefined;
    return validateCandidate({ ...candidate, fields, warnings, ...(cover ? { coverUrl: `https://covers.openlibrary.org/b/id/${cover}-M.jpg?default=false` } : {}), fetchedAt: new Date().toISOString() });
  } };
}
export function unavailableAdapter(provider: 'nli' | 'googlebooks'): CatalogAdapter {
  return { provider, async search() { throw new CatalogError('unavailable', 'החיבור לקטלוג זה ממתין לשירות ולמפתח מורשה.'); } };
}
export class CatalogSearch {
  private active?: AbortController;
  private sequence = 0;
  constructor(private database: LibraryDatabase, private adapters: CatalogAdapter[], private timeoutMs = 12000) {}
  cancel() { this.active?.abort(); this.sequence++; }
  async search(input: CatalogQuery, update: (result: ProviderResult) => void): Promise<void> {
    const query = validateQuery(input); this.cancel(); const sequence = this.sequence, controller = new AbortController(); this.active = controller;
    await Promise.all(this.adapters.map(async adapter => {
      const key = adapter.provider + ':v1:' + JSON.stringify(query), cached = await this.database.metadataCache.get(key);
      if (controller.signal.aborted || sequence !== this.sequence) return;
      if (cached && Date.parse(cached.expiresAt) > Date.now()) {
        try { if (cached.candidates) { const rows = cached.candidates.map(validateCandidate); if (rows.length > 20 || rows.some(row => row.provider !== adapter.provider)) throw new Error(); update({ provider: adapter.provider, state: rows.length ? 'success' : 'empty', candidates: rows, message: rows.length ? `${rows.length} מועמדים מהחיפוש האחרון` : 'אין תוצאות בחיפוש האחרון.', cached: true }); return; } } catch { await this.database.metadataCache.delete(key); }
      }
      const timer = setTimeout(() => local.abort('timeout'), this.timeoutMs), local = new AbortController();
      const abort = () => local.abort(); controller.signal.addEventListener('abort', abort, { once: true });
      let result: ProviderResult;
      try {
        const rows = (await abortable(adapter.search(query, local.signal), local.signal)).map(validateCandidate);
        if (rows.length > 20 || rows.some(row => row.provider !== adapter.provider)) throw new CatalogError('error', 'תוצאות הקטלוג אינן תקינות.');
        result = { provider: adapter.provider, state: rows.length ? 'success' : 'empty', candidates: rows, message: rows.length ? `${rows.length} מועמדים` : 'לא נמצאו תוצאות.' };
        if (!local.signal.aborted) { const now = Date.now(); try { await this.database.metadataCache.put({ key, provider: adapter.provider, fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + (rows.length ? 7 * 86400000 : 15 * 60000)).toISOString(), minimalPayload: rows.map(row => row.fields), candidates: rows }); } catch { result.message += ' · המטמון לא נשמר.'; } }
      } catch (error) { result = { provider: adapter.provider, state: local.signal.reason === 'timeout' ? 'timeout' : controller.signal.aborted ? 'cancelled' : error instanceof CatalogError ? error.state : 'error', candidates: [], message: local.signal.reason === 'timeout' ? 'הקטלוג לא ענה בזמן.' : error instanceof CatalogError ? error.safeMessage : 'החיפוש נכשל. אפשר לנסות שוב או להוסיף ידנית.' }; }
      finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); }
      if (!controller.signal.aborted && sequence === this.sequence) update(result);
    }));
  }
}
