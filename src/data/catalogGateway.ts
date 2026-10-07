import { validDay } from './loans';
import { safeCatalogCoverUrl } from './catalogCoverUrl';
import { parseISBN, comparableISBN } from './books';
import { CatalogError, readCatalogJson, retryAfterMs, type CatalogAdapter, type CatalogQuery } from './catalog';
import { validateCandidate, type Candidate, type FieldValues } from './metadata';

const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('error', 'תשובת הקטלוג אינה תקינה.'); return value as Record<string, unknown>; };
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() && value.length <= 1000 ? value.trim() : undefined;
export function normalizeGoogleBooks(value: unknown): Candidate[] {
  const root = object(value);
  if (root.totalItems === 0 && root.items === undefined) return [];
  if (!Array.isArray(root.items)) throw new CatalogError('error', 'תשובת הקטלוג אינה תקינה.');
  return root.items.slice(0, 10).flatMap(value => {
    const item = object(value); if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)) return [];
    const row = object(item.volumeInfo), fields: FieldValues = {}, warnings: string[] = [];
    for (const key of ['title', 'subtitle', 'publisher', 'language'] as const) { const value = text(row[key]); if (value) fields[key] = value; }
    const date = text(row.publishedDate); if (date && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(date) && +date.slice(0, 4) >= 1000) fields.publicationYear = +date.slice(0, 4);
    if (date && validDay(date)) fields.publicationDate = date;
    if (typeof row.pageCount === 'number' && Number.isInteger(row.pageCount) && row.pageCount > 0 && row.pageCount <= 100000) fields.pages = row.pageCount;
    if (Array.isArray(row.authors)) { const authors = row.authors.slice(0, 20).map(text).filter((item): item is string => !!item); if (authors.length) fields.authors = authors; }
    const codes = Array.isArray(row.industryIdentifiers) ? row.industryIdentifiers.slice(0, 10).flatMap(item => { const row = object(item); if (!['ISBN_10', 'ISBN_13'].includes(row.type as string) || typeof row.identifier !== 'string') return []; try { const isbn = parseISBN(row.identifier); return [isbn.isbn13 ?? isbn.isbn10!]; } catch { warnings.push('ISBN לא תקין הושמט.'); return []; } }) : [];
    if (new Set(codes.map(code => comparableISBN(parseISBN(code)))).size === 1) for (const code of codes) fields[code.length === 13 ? 'isbn13' : 'isbn10'] = code;
    else if (codes.length) warnings.push('מזהי ISBN סותרים: בדוק את המזהה על העותק.');
    const thumbnail = row.imageLinks && typeof row.imageLinks === 'object' ? text((row.imageLinks as Record<string, unknown>).thumbnail) : undefined;
    const coverUrl = thumbnail?.replace(/^http:/, 'https:');
    return [validateCandidate({ ...(safeCatalogCoverUrl(coverUrl, 'googlebooks') ? { coverUrl } : {}), provider: 'googlebooks', recordId: item.id, sourceUrl: 'https://books.google.com/books?id=' + item.id, fetchedAt: new Date().toISOString(), kind: 'volume', fields, warnings })];
  });
}
// The configured server returns normalized NLI candidates only after its mapping has been verified.
// No browser-side provider keys or arbitrary proxy URL are accepted.
export function gatewayAdapter(provider: 'nli' | 'googlebooks', origin: string, fetcher: typeof fetch = fetch): CatalogAdapter {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new CatalogError('unavailable', 'כתובת שירות הקטלוג אינה תקינה.');
  let stoppedUntil = 0;
  return { provider, async search(query: CatalogQuery, signal) {
    if (Date.now() < stoppedUntil) throw new CatalogError('rate-limited', 'הקטלוג ביקש להמתין לפני חיפוש נוסף.');
    const response = await fetcher(url.origin + '/catalog/search', { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, query }) });
    if (response.status === 429) stoppedUntil = Date.now() + retryAfterMs(response.headers);
    if (!response.ok) throw new CatalogError(response.status === 429 ? 'rate-limited' : response.status === 503 ? 'unavailable' : response.status === 504 ? 'timeout' : 'error', response.status === 429 ? 'הקטלוג ביקש להמתין לפני חיפוש נוסף.' : response.status === 504 ? 'הקטלוג לא ענה בזמן.' : 'החיבור לקטלוג אינו זמין כרגע.');
    const payload = await readCatalogJson(response); if (!Array.isArray(payload.candidates) || payload.candidates.length > 20) throw new CatalogError('error', 'תשובת הקטלוג אינה תקינה.');
    const candidates = payload.candidates.map(validateCandidate); if (candidates.some(row => row.provider !== provider)) throw new CatalogError('error', 'מקור התוצאה אינו תואם לקטלוג.'); return candidates;
  } };
}
