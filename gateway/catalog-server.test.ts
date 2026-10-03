import { afterEach, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createCatalogServer, googleBooksServerAdapter } from './catalog-server';
import type { Candidate } from '../src/data/metadata';
import { CatalogError, emptyQuery } from '../src/data/catalog';

const servers: Server[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function start(server: Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error(); return `http://127.0.0.1:${address.port}`; }
const headers = { Origin: 'http://127.0.0.1:4330', 'Content-Type': 'application/json' };
const query = { ...emptyQuery, title: 'ספר בדיקה סינתטי' };
const candidate: Candidate = { provider: 'nli', kind: 'edition', recordId: 'synthetic-1', sourceUrl: null, fetchedAt: new Date().toISOString(), fields: { title: 'ספר סינתטי' }, warnings: [] };
const request = (base: string, value: unknown = { provider: 'nli', query }, extra = {}) => fetch(base + '/catalog/search', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(value) });

it('T24 local service rejects unknown origins, foreign query fields, arbitrary URLs and oversized bodies without contacting a provider', async () => {
  const search = vi.fn(async () => [candidate]), base = await start(createCatalogServer({ providers: { nli: { adapter: { provider: 'nli', search }, dailyLimit: 10 } } }));
  expect((await fetch(base + '/health')).status).toBe(200);
  expect((await request(base, undefined, { Origin: 'https://evil.test' })).status).toBe(403);
  expect((await fetch(base + '/catalog/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'nli', query }) })).status).toBe(403);
  expect((await request(base, { provider: 'nli', query: { ...query, url: 'http://169.254.169.254/' } })).status).toBe(400);
  expect((await request(base, { provider: 'nli', query, api_key: 'SECRET-CANARY' })).status).toBe(400);
  expect((await request(base, { provider: 'nli', query: { ...query, title: 'x'.repeat(5000) } })).status).toBe(413);
  expect((await fetch(base + '/catalog/search', { method: 'OPTIONS', headers: { Origin: headers.Origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })).status).toBe(204);
  expect(search).not.toHaveBeenCalled();
});
it('T24 rejects a third active request without calling the provider and releases slots after completion', async () => {
  let now = Date.now(); const pending: Array<() => void> = [];
  const search = vi.fn(() => new Promise<Candidate[]>(resolve => pending.push(() => resolve([candidate]))));
  const base = await start(createCatalogServer({ now: () => now, providers: { nli: { adapter: { provider: 'nli', search }, dailyLimit: 10 } } }));
  const first = request(base); await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  now += 10001;
  const second = request(base); await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  now += 10001;
  expect((await request(base)).status).toBe(429); expect(search).toHaveBeenCalledTimes(2);
  pending.shift()!(); pending.shift()!(); expect((await first).status).toBe(200); expect((await second).status).toBe(200);
  const next = request(base); await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(3));
  pending.shift()!(); expect((await next).status).toBe(200);
});
it('T24 normalized results have explicit CORS, no cache and finite rate/day limits, even when the query changes', async () => {
  let now = Date.now(); const search = vi.fn(async () => [candidate]), base = await start(createCatalogServer({ now: () => now, providers: { nli: { adapter: { provider: 'nli', search }, dailyLimit: 2 } } }));
  const first = await request(base); expect(first.headers.get('Access-Control-Allow-Origin')).toBe(headers.Origin); expect(first.headers.get('Cache-Control')).toBe('no-store'); expect((await first.json()).candidates).toEqual([candidate]);
  expect((await request(base, { provider: 'nli', query: { ...query, title: 'ספר אחר' } })).status).toBe(429); expect(search).toHaveBeenCalledTimes(1);
  now += 10001; expect((await request(base)).status).toBe(200); now += 10001;
  const limited = await request(base); expect(limited.status).toBe(429); expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(1); expect(search).toHaveBeenCalledTimes(2);
  expect(limited.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
  const upstream = { provider: 'nli' as const, search: async (): Promise<Candidate[]> => { throw new CatalogError('rate-limited', 'SAFE', 120000); } };
  const upstreamResponse = await request(await start(createCatalogServer({ providers: { nli: { adapter: upstream, dailyLimit: 10 } } })));
  expect(upstreamResponse.status).toBe(429); expect(Number(upstreamResponse.headers.get('Retry-After'))).toBeGreaterThanOrEqual(120);
});
it('T24 disabled/failed/malformed providers expose safe errors and timeout finishes a provider that ignores cancellation', async () => {
  expect((await request(await start(createCatalogServer()))).status).toBe(503);
  const adapter = { provider: 'nli' as const, search: async (): Promise<Candidate[]> => { throw new Error('https://evil.test/?api_key=SECRET-CANARY'); } };
  const failure = await request(await start(createCatalogServer({ providers: { nli: { adapter, dailyLimit: 10 } } }))); expect(failure.status).toBe(502); expect(await failure.text()).not.toContain('SECRET-CANARY');
  const malformed = { provider: 'nli' as const, search: async () => [{ ...candidate, provider: 'googlebooks' as const }] };
  expect((await request(await start(createCatalogServer({ providers: { nli: { adapter: malformed, dailyLimit: 10 } } })))).status).toBe(502);
  const never = { provider: 'nli' as const, search: () => new Promise<Candidate[]>(() => {}) };
  expect((await request(await start(createCatalogServer({ providers: { nli: { adapter: never, dailyLimit: 10 } }, timeoutMs: 20 })))).status).toBe(504);
});
it('T24 Google server adapter fixes upstream target, omits user data, uses the shared mapper and honors 429 without retry', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: 'synthetic1', volumeInfo: { title: 'ספר סינתטי', publishedDate: '2001' } }] })));
  const adapter = googleBooksServerAdapter('SECRET-CANARY-KEY', fetcher), signal = new AbortController().signal;
  const rows = await adapter.search({ ...query, year: '2001' }, signal); expect(rows[0].fields).toEqual({ title: 'ספר סינתטי', publicationYear: 2001 });
  const [target, options] = fetcher.mock.calls[0], url = new URL(String(target)); expect(url.origin + url.pathname).toBe('https://www.googleapis.com/books/v1/volumes'); expect(url.searchParams.get('q')).toBe('intitle:"ספר בדיקה סינתטי"'); expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
  expect(url.searchParams.has('key')).toBe(false); expect(String(target)).not.toContain('SECRET-CANARY-KEY'); expect(new Headers(options?.headers).get('X-Goog-Api-Key')).toBe('SECRET-CANARY-KEY');
  fetcher.mockResolvedValue(new Response('SECRET-CANARY-KEY', { status: 429, headers: { 'Retry-After': '60' } })); await expect(adapter.search(query, signal)).rejects.toMatchObject({ state: 'rate-limited' }); await expect(adapter.search(query, signal)).rejects.toMatchObject({ state: 'rate-limited' }); expect(fetcher).toHaveBeenCalledTimes(2);
});
