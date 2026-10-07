import { CatalogError, readCatalogJson, retryAfterMs, validateQuery, type CatalogAdapter } from './catalog';
import { validateCandidate, validateFieldValues, type Candidate } from './metadata';
import { personalCredentials } from './personalCredentials';

export const goodreadsEndpoint = 'https://maya-n8n.duckdns.org/library-catalog';
let token = '', stoppedUntil = 0;
export const goodreadsConfigured = () => !!token;
function normalizeKey(value: string) {
  value = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('מפתח הגישה ל־Goodreads אינו תקין.');
  return value;
}
function configure(value: string) { token = normalizeKey(value); stoppedUntil = 0; }
export async function rememberGoodreadsKey(value: string) {
  const key = normalizeKey(value);
  await personalCredentials.credentials.put({ id: 'goodreads', key });
  configure(key);
}
export async function forgetGoodreadsKey() { token = ''; stoppedUntil = 0; await personalCredentials.credentials.delete('goodreads'); }
export async function restoreGoodreadsKey() {
  try { const saved = await personalCredentials.credentials.get('goodreads'); if (saved?.key) configure(saved.key); }
  catch { token = ''; }
}
export function goodreadsAdapter(fetcher: typeof fetch = fetch): CatalogAdapter {
  let nextAt = 0;
  async function request(path: string, body: object, signal: AbortSignal) {
    if (!token) throw new CatalogError('unavailable', 'להפעלת Goodreads, הגדר את מפתח הגישה בהגדרות.');
    if (Date.now() < stoppedUntil) throw new CatalogError('rate-limited', 'Goodreads ביקש להמתין לפני חיפוש נוסף.');
    const wait = nextAt - Date.now();
    if (wait > 0) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, wait);
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
    const response = await fetcher(goodreadsEndpoint + path, { method: 'POST', signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    if (response.status === 429) { const wait = retryAfterMs(response.headers); await response.body?.cancel(); stoppedUntil = Date.now() + wait; throw new CatalogError('rate-limited', 'Goodreads ביקש להמתין לפני חיפוש נוסף.', wait); }
    if (!response.ok) { await response.body?.cancel(); throw new CatalogError('unavailable', response.status === 401 ? 'מפתח הגישה ל־Goodreads נדחה. עדכן אותו בהגדרות.' : 'Goodreads אינו זמין כרגע. אפשר לבחור תוצאה ממקור אחר.'); }
    const value = await readCatalogJson(response);
    if (value.cached !== true) nextAt = Date.now() + 10000;
    if (JSON.stringify(value).includes(token)) throw new CatalogError('error', 'תשובת Goodreads אינה תקינה.');
    return value;
  }
  const reference = (value: unknown): Candidate => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('error', 'תשובת Goodreads אינה תקינה.');
    const row = value as Record<string, unknown>;
    if (typeof row.recordId !== 'string' || !/^[1-9]\d{0,13}$/.test(row.recordId) || row.sourceUrl !== 'https://www.goodreads.com/book/show/' + row.recordId) throw new CatalogError('error', 'מזהה Goodreads אינו תקין.');
    return validateCandidate({ provider: 'goodreads', recordId: row.recordId, sourceUrl: row.sourceUrl, kind: 'edition', fetchedAt: typeof row.fetchedAt === 'string' ? row.fetchedAt : new Date().toISOString(), fields: row.fields ? validateFieldValues(row.fields) : {}, warnings: row.fields ? ['בדוק את פרטי המהדורה מול הספר.'] : ['פרטי הספר ייטענו אחרי בחירה.'], ...(row.coverUrl ? { coverUrl: row.coverUrl } : {}) });
  };
  return { provider: 'goodreads', async search(input, signal) {
    const query = validateQuery(input);
    if (query.danacode && !query.isbn) throw new CatalogError('unavailable', 'Goodreads אינו תומך בחיפוש לפי דאנאקוד.');
    const terms = query.isbn || [query.title, query.author].filter(Boolean).join(' ').slice(0, 300);
    if (!terms) throw new CatalogError('unavailable', 'הוסף שם ספר, מחבר או ISBN לחיפוש Goodreads.');
    const response = await request('/v1/search', { query: terms }, signal);
    if (response.provider !== 'goodreads' || !Array.isArray(response.results) || response.results.length > 5) throw new CatalogError('error', 'תוצאות Goodreads אינן תקינות.');
    return response.results.map(reference);
  }, async resolve(candidate, signal) {
    validateCandidate(candidate);
    if (candidate.provider !== 'goodreads') throw new CatalogError('error', 'מקור המועמד אינו Goodreads.');
    const response = await request('/v1/book', { id: candidate.recordId }, signal);
    if (response.provider !== 'goodreads' || response.recordId !== candidate.recordId) throw new CatalogError('error', 'מהדורת Goodreads אינה תואמת לבחירה.');
    // Map the server's public series name into the application's existing series model.
    const fields = response.fields as Record<string, unknown>;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new CatalogError('error', 'פרטי Goodreads אינם תקינים.');
    const { series, ...rest } = fields;
    return reference({ ...response, fields: { ...rest, ...(series !== undefined ? { seriesName: series } : {}) } });
  } };
}
