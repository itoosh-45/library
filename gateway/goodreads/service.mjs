import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SqliteCatalogQuota } from '../quota.ts';
import { bookId, queryText, parseBook, parseSearch, GoodreadsError } from './model.mjs';
import { danaDigits, daniId, daniUrl, parseDaniBook } from './danibooks.mjs';

export function createGoodreadsService({ token, origins, path, dailyLimit = 200, fetcher = fetch, now = Date.now }) {
  if (!/^[a-f0-9]{64}$/.test(token) || !Array.isArray(origins) || !origins.length || !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) throw new Error('Invalid service configuration');
  const quota = new SqliteCatalogQuota(path);
  const cache = new DatabaseSync(path);
  cache.exec('CREATE TABLE IF NOT EXISTS goodreads_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL) STRICT');
  cache.exec('CREATE TABLE IF NOT EXISTS goodreads_status (key TEXT PRIMARY KEY, blocked_until INTEGER NOT NULL) STRICT');
  const allowed = new Set(origins), secret = Buffer.from(token);
  let active = false, windowAt = now(), requests = 0;
  async function upstream(url, parse, signal) {
    const provider = new URL(url).hostname === 'www.danibooks.co.il' ? 'danibooks' : 'goodreads';
    const daniSearch = provider === 'danibooks' && new URL(url).pathname === '/search/';
    const search = new URL(url).pathname === '/search';
    const isbnRoute = new URL(url).pathname.startsWith('/book/isbn/');
    if (search && Number(cache.prepare("SELECT blocked_until FROM goodreads_status WHERE key='search'").get()?.blocked_until ?? 0) > now()) throw new GoodreadsError('blocked', 'חיפוש Goodreads חסום זמנית. אפשר להשתמש במקור אחר.');
    const defer = wait => {
      if (search) { cache.prepare("INSERT OR REPLACE INTO goodreads_status VALUES ('search',?)").run(now() + wait); quota.defer('goodreads', now() + 10000); }
      else quota.defer(provider, now() + wait);
    };
    const wait = quota.reserve(provider, now(), dailyLimit);
    if (wait) { const error = new GoodreadsError('rate-limited', 'יש להמתין לפני פנייה נוספת ל־Goodreads.', 429); error.retryAfterMilliseconds = wait; throw error; }
    let response;
    try { response = await fetcher(url, { signal, redirect: 'manual', headers: { Accept: 'text/html' } }); }
    catch (error) { defer(60000); throw error; }
    if (daniSearch && [301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const id = daniId(new URL(response.headers.get('location'), url).href);
      quota.defer(provider, now() + 10000);
      return { provider, results: [{ recordId: id, sourceUrl: daniUrl(id) }] };
    }
    if (isbnRoute && [301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      try {
        const location = new URL(response.headers.get('location'), url);
        const id = bookId(location.href);
        quota.defer('goodreads', now() + 10000);
        return { provider: 'goodreads', results: [{ recordId: id, sourceUrl: 'https://www.goodreads.com/book/show/' + id }] };
      } catch { defer(6 * 3600000); throw new GoodreadsError('blocked', 'Goodreads לא מאפשר את השליפה כרגע. אפשר להשתמש במקור אחר.'); }
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      const blocked = [202, 403, 429].includes(response.status) || response.status >= 300 && response.status < 400;
      defer(blocked ? 6 * 3600000 : 60000);
      throw new GoodreadsError(blocked ? 'blocked' : 'unavailable', 'Goodreads לא מאפשר את השליפה כרגע. אפשר להשתמש במקור אחר.');
    }
    if (!response.headers.get('content-type')?.includes('text/html') || !response.body) throw new GoodreadsError('source-changed', 'Goodreads החזיר תשובה לא מוכרת.');
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2 * 1024 * 1024) throw new GoodreadsError('too-large', 'תשובת Goodreads גדולה מדי.'); chunks.push(Buffer.from(part.value)); }
    } finally { await reader.cancel().catch(() => {}); }
    try { const result = parse(Buffer.concat(chunks).toString('utf8')); quota.defer(provider, now() + 10000); return result; }
    catch (error) { defer(6 * 3600000); throw error; }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); } };
    if (req.method === 'GET' && req.url === '/health') return send(200, { state: 'ok', provider: 'goodreads' });
    if (now() - windowAt >= 60000) { windowAt = now(); requests = 0; }
    if (++requests > 30) { res.setHeader('Retry-After', '60'); return send(429, { state: 'rate-limited' }); }
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) return send(403, { state: 'denied' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Expose-Headers', 'Retry-After'); }
    if (!['/v1/book', '/v1/search', '/v1/danacode', '/v1/danibook'].includes(req.url)) return send(404, { state: 'not-found' });
    if (req.method === 'OPTIONS' && origin) { res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); return send(204, {}); }
    const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? '');
    if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret)) return send(401, { state: 'unauthorized' });
    if (req.method !== 'POST') return send(405, { state: 'method-not-allowed' });
    if (req.headers['content-type'] !== 'application/json') return send(415, { state: 'invalid-request' });
    if (Number(req.headers['content-length']) > 1024) return send(413, { state: 'too-large' });
    let key, url, parse;
    try {
      let length = 0; const chunks = [];
      for await (const chunk of req) { length += chunk.length; if (length > 1024) return send(413, { state: 'too-large' }); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1) throw new GoodreadsError('invalid', 'בקשה אינה תקינה.', 400);
      if (req.url === '/v1/danibook') { const id = daniId(input.id); key = 'danibook:' + id; url = daniUrl(id); parse = html => parseDaniBook(html, id); }
      else if (req.url === '/v1/danacode') { const digits = danaDigits(input.query); key = 'danacode:' + digits; url = 'https://www.danibooks.co.il/search/?q=' + digits; parse = () => ({ provider: 'danibooks', results: [] }); }
      else if (req.url === '/v1/book') { const id = bookId(input.id); key = 'book:v2:' + id; url = 'https://www.goodreads.com/book/show/' + id; parse = html => parseBook(html, id); }
      else {
        const query = queryText(input.query), digits = query.replace(/[\s-]/g, '').toUpperCase();
        const isbn = /^97[89]\d{10}$/.test(digits) && [...digits].reduce((n, d, i) => n + +d * (i % 2 ? 3 : 1), 0) % 10 === 0 || /^\d{9}[\dX]$/.test(digits) && [...digits].reduce((n, d, i) => n + (d === 'X' ? 10 : +d) * (10 - i), 0) % 11 === 0;
        key = (isbn ? 'isbn:' : 'search:') + createHash('sha256').update(query).digest('hex');
        url = new URL(isbn ? 'https://www.goodreads.com/book/isbn/' + digits : 'https://www.goodreads.com/search');
        if (!isbn) url.searchParams.set('q', query);
        parse = html => ({ provider: 'goodreads', results: parseSearch(html) });
      }
    } catch { return send(400, { state: 'invalid-request' }); }
    try {
      const cached = cache.prepare('SELECT value FROM goodreads_cache WHERE key=? AND expires>?').get(key, now());
      if (cached) return send(200, { ...JSON.parse(cached.value), cached: true });
      if (active) { res.setHeader('Retry-After', '10'); return send(429, { state: 'busy' }); }
      active = true;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
      const disconnect = () => { if (!res.writableEnded) controller.abort(); }; res.on('close', disconnect);
      try {
        const value = await upstream(url, parse, controller.signal);
        cache.prepare('DELETE FROM goodreads_cache WHERE expires<=?').run(now());
        cache.prepare('INSERT OR REPLACE INTO goodreads_cache VALUES (?,?,?)').run(key, JSON.stringify(value), now() + 86400000);
        cache.exec('DELETE FROM goodreads_cache WHERE key NOT IN (SELECT key FROM goodreads_cache ORDER BY expires DESC LIMIT 200)');
        send(200, value);
      } finally { clearTimeout(timer); res.removeListener('close', disconnect); active = false; }
    } catch (error) {
      if (error instanceof GoodreadsError) { if (error.status === 429) res.setHeader('Retry-After', String(Math.ceil((error.retryAfterMilliseconds ?? 10000) / 1000))); send(error.status, { state: error.state, message: error.message }); }
      else send(503, { state: 'unavailable', message: 'שליפת המידע אינה זמינה כרגע.' });
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000; server.keepAliveTimeout = 2000; server.maxHeadersCount = 20; server.maxConnections = 32;
  server.on('close', () => { cache.close(); quota.close(); });
  return server;
}
