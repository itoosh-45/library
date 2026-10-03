import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CatalogError, readCatalogJson, retryAfterMs, validateQuery, type CatalogAdapter, type CatalogQuery } from '../src/data/catalog';
import { validateCandidate, type Candidate } from '../src/data/metadata';
import { normalizeGoogleBooks } from '../src/data/catalogGateway';

type ServerProvider = 'nli' | 'googlebooks';
interface ProviderConfig { adapter: CatalogAdapter; dailyLimit: number }
interface ServerOptions { providers?: Partial<Record<ServerProvider, ProviderConfig>>; origins?: string[]; timeoutMs?: number; now?: () => number }
const safeFailure = { state: 'error', message: 'שירות הקטלוג אינו זמין כרגע.' };
const localOrigins = ['http://127.0.0.1:4330', 'http://127.0.0.1:4331'];

// Local service only. External hosting, authentication and infrastructure isolation remain separate gates.
export function createCatalogServer({ providers = {}, origins = localOrigins, timeoutMs = 12000, now = Date.now }: ServerOptions = {}) {
  const allowed = new Set(origins), counts = new Map<ServerProvider, { day: string; used: number; nextAt: number }>();
  let windowStart = now(), windowCount = 0, active = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status: number, payload: object) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
    const address = server.address();
    if (!address || typeof address === 'string' || req.headers.host !== `127.0.0.1:${address.port}`) return send(403, { state: 'denied' });
    if (now() - windowStart >= 60000) { windowStart = now(); windowCount = 0; }
    if (++windowCount > 30) { res.setHeader('Retry-After', '60'); return send(429, { state: 'rate-limited' }); }
    if (req.method === 'GET' && req.url === '/health') return send(200, { state: 'ok' });
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) return send(403, { state: 'denied' });
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Expose-Headers', 'Retry-After'); res.setHeader('Vary', 'Origin');
    if (req.url !== '/catalog/search') return send(404, { state: 'not-found' });
    if (req.method === 'OPTIONS') {
      if (req.headers['access-control-request-method'] !== 'POST' || (req.headers['access-control-request-headers'] ?? '').toLowerCase() !== 'content-type') return send(403, { state: 'denied' });
      res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); return send(204, {});
    }
    if (req.method !== 'POST') return send(405, { state: 'method-not-allowed' });
    if (req.headers['content-type'] !== 'application/json') return send(415, { state: 'invalid-request' });
    const length = Number(req.headers['content-length']);
    if (length > 4096) return send(413, { state: 'too-large' });
    let provider: ServerProvider, query: CatalogQuery;
    try {
      let bytes = 0; const chunks: Buffer[] = [];
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) return send(413, { state: 'too-large' }); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || Object.keys(input).length !== 2 || !Object.hasOwn(input, 'provider') || !Object.hasOwn(input, 'query') || !['nli', 'googlebooks'].includes(input.provider)) throw new Error();
      provider = input.provider; query = validateQuery(input.query);
    } catch { return send(400, { state: 'invalid-request' }); }
    const config = providers[provider];
    if (!config || config.adapter.provider !== provider || !Number.isInteger(config.dailyLimit) || config.dailyLimit < 1) return send(503, { state: 'unavailable', message: 'חיבור הקטלוג ממתין להגדרה מאומתת.' });
    const day = new Date(now()).toISOString().slice(0, 10), counter = counts.get(provider) ?? { day, used: 0, nextAt: 0 };
    if (counter.day !== day) { counter.day = day; counter.used = 0; }
    if (counter.used >= config.dailyLimit || counter.nextAt > now()) {
      const wait = counter.used >= config.dailyLimit ? Date.parse(day + 'T00:00:00.000Z') + 86400000 - now() : counter.nextAt - now();
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(wait / 1000)))); return send(429, { state: 'rate-limited' });
    }
    if (active >= 2) { res.setHeader('Retry-After', '5'); return send(429, { state: 'rate-limited' }); }
    counter.used++; counter.nextAt = now() + 10000; counts.set(provider, counter); active++;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
    const disconnect = () => { if (!res.writableEnded) controller.abort('disconnected'); }; res.on('close', disconnect);
    let abortHandler: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => { abortHandler = () => reject(new CatalogError(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled', 'הבקשה הופסקה.')); controller.signal.addEventListener('abort', abortHandler, { once: true }); });
      const candidates = await Promise.race([config.adapter.search(query, controller.signal), aborted]);
      if (!Array.isArray(candidates) || candidates.length > 20) throw new Error();
      const rows = candidates.map(validateCandidate); if (rows.some(row => row.provider !== provider)) throw new Error();
      send(200, { candidates: rows, requestId: randomUUID() });
    } catch (error) {
      if (error instanceof CatalogError && error.state === 'rate-limited') { const wait = error.retryAfterMilliseconds; counter.nextAt = Math.max(counter.nextAt, now() + (wait && Number.isFinite(wait) ? Math.max(1000, wait) : 60000)); res.setHeader('Retry-After', String(Math.ceil((counter.nextAt - now()) / 1000))); send(429, { state: 'rate-limited' }); }
      else if (error instanceof CatalogError && error.state === 'timeout') send(504, { state: 'timeout', message: 'הקטלוג לא ענה בזמן.' });
      else if (error instanceof CatalogError && error.state === 'unavailable') send(503, { state: 'unavailable', message: 'החיבור לקטלוג אינו זמין כרגע.' });
      else send(502, safeFailure);
    } finally { clearTimeout(timeout); if (abortHandler) controller.signal.removeEventListener('abort', abortHandler); res.removeListener('close', disconnect); active--; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 3000; server.maxHeadersCount = 20;
  return server;
}

export function googleBooksServerAdapter(key: string, fetcher: typeof fetch = fetch): CatalogAdapter {
  if (!/^[\x21-\x7e]{10,300}$/.test(key)) throw new Error('Invalid server key');
  let stoppedUntil = 0;
  return { provider: 'googlebooks', async search(input, signal): Promise<Candidate[]> {
    const query = validateQuery(input);
    if (query.danacode) throw new CatalogError('unavailable', 'דאנאקוד דורש חיפוש ידני.');
    const quote = (value: string) => '"' + value.replace(/[\\"]/g, '\\$&') + '"';
    const terms = query.isbn ? 'isbn:' + query.isbn : [['intitle', query.title], ['inauthor', query.author], ['inpublisher', query.publisher]].filter(([, value]) => value).map(([field, value]) => field + ':' + quote(value)).join(' ');
    if (!terms) throw new CatalogError('unavailable', 'הוסף שם, מחבר או ISBN לחיפוש.');
    if (Date.now() < stoppedUntil) throw new CatalogError('rate-limited', 'הקטלוג ביקש להמתין.');
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.search = new URLSearchParams({ q: terms, maxResults: '10', printType: 'books' }).toString();
    const response = await fetcher(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { 'X-Goog-Api-Key': key } });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) { const wait = retryAfterMs(response.headers); stoppedUntil = Date.now() + wait; throw new CatalogError('rate-limited', 'הקטלוג ביקש להמתין.', wait); }
      throw new CatalogError('error', 'החיבור לקטלוג אינו זמין כרגע.');
    }
    const payload = await readCatalogJson(response);
    if (JSON.stringify(payload).includes(key)) throw new CatalogError('error', 'תשובת הקטלוג אינה תקינה.');
    const rows = normalizeGoogleBooks(payload);
    return query.year ? rows.filter(row => row.fields.publicationYear === +query.year) : rows;
  } };
}
