import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Server } from 'node:http';
import { SqliteCatalogQuota } from './quota';
import { createCatalogServer } from './catalog-server';
import { emptyQuery } from '../src/data/catalog';
import type { Candidate } from '../src/data/metadata';

const stores: SqliteCatalogQuota[] = [], servers: Server[] = [];
const directory = resolve('private/phase18-quota-test'); mkdirSync(directory, { recursive: true });
const path = () => resolve(directory, randomUUID() + '.sqlite');
const store = (file: string) => { const value = new SqliteCatalogQuota(file); stores.push(value); return value; };
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); for (const value of stores.splice(0)) value.close(); });
async function start(server: Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error(); return `http://127.0.0.1:${address.port}`; }
const request = (url: string) => fetch(url + '/catalog/search', { method: 'POST', headers: { Origin: 'http://127.0.0.1:4330', 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'nli', query: { ...emptyQuery, title: 'ספר מכסה סינתטי' } }) });
const candidate: Candidate = { provider: 'nli', kind: 'edition', recordId: 'quota-synthetic', sourceUrl: null, fetchedAt: '2026-10-03T00:00:00.000Z', fields: { title: 'ספר מכסה סינתטי' }, warnings: [] };
const childScript = `import { SqliteCatalogQuota } from './gateway/quota.ts';
const [file,mode,clock]=process.argv.slice(1), now=Number(clock), quota=new SqliteCatalogQuota(file);
try { const wait=quota.reserve('nli',now,2); if (!wait && mode==='success') quota.defer('nli',now+10000); console.log(wait); } finally { quota.close(); }`;
function child(file: string, mode: 'success' | 'unfinished', now: number) {
  return new Promise<number>((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '--eval', childScript, file, mode, String(now)], { windowsHide: true });
    let output = '', error = ''; process.stdout.on('data', data => output += data); process.stderr.on('data', data => error += data);
    process.on('error', reject); process.on('close', code => { if (code !== 0) reject(new Error(error)); else resolve(Number(output.trim())); });
  });
}

it('T24/T26 durable day limits and cooldown survive actual independent Node processes', async () => {
  const file = path(), now = Date.parse('2026-10-03T12:00:00Z');
  expect(await child(file, 'success', now)).toBe(0);
  expect(await child(file, 'success', now + 1)).toBe(9999);
  expect(await child(file, 'success', now + 10001)).toBe(0);
  expect(await child(file, 'success', now + 20002)).toBe(43200000 - 20002);
});

it('T24 simultaneous processes share one reservation and an interrupted request keeps a conservative 24-hour hold', async () => {
  const file = path(), now = Date.parse('2026-10-03T12:00:00Z');
  const results = await Promise.all([child(file, 'unfinished', now), child(file, 'unfinished', now)]);
  expect(results.sort((a,b) => a-b)).toEqual([0,86400000]);
  expect(await child(file, 'success', now + 10001)).toBe(86400000 - 10001);
});

it('T24 provider Retry-After persists across reopening and UTC day rollover does not erase it', () => {
  const file = path(), now = Date.parse('2026-10-03T23:59:55Z'), first = store(file);
  expect(first.reserve('nli', now, 1)).toBe(0); first.defer('nli', now + 120000);
  const reopened = store(file);
  expect(reopened.reserve('nli', now + 10000, 1)).toBe(110000);
  expect(reopened.reserve('googlebooks', now + 10000, 1)).toBe(0);
  expect(reopened.reserve('nli', now + 120001, 1)).toBe(0);
  reopened.defer('nli', now + 130001);
  expect(reopened.reserve('nli', now + 130002, 1)).toBeGreaterThan(0);
  expect(() => reopened.reserve('nli', now, 1)).toThrow('clock rollback');
  expect(reopened.reserve('nli', now + 130002, 1)).toBeGreaterThan(0);
});

it('T24 configured providers fail closed without a quota store or after storage corruption, without leaking errors', async () => {
  const search = vi.fn(async () => [candidate]), providers = { nli: { adapter: { provider: 'nli' as const, search }, dailyLimit: 10 } };
  expect((await request(await start(createCatalogServer({ providers })))).status).toBe(503);
  const file = path(); writeFileSync(file, 'CORRUPT_SECRET_CANARY'); expect(() => new SqliteCatalogQuota(file)).toThrow();
  const response = await request(await start(createCatalogServer({ providers, quotaStore: { reserve() { throw new Error('CORRUPT_SECRET_CANARY'); }, defer() { throw new Error(); } } })));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('CORRUPT_SECRET_CANARY'); expect(search).not.toHaveBeenCalled();
});

it('T24 a failed post-request ledger write keeps the durable hold and never retries the provider', async () => {
  const file = path(), quota = store(file), now = Date.parse('2026-10-03T12:00:00Z'), search = vi.fn(async () => [candidate]);
  const base = await start(createCatalogServer({ now: () => now, providers: { nli: { adapter: { provider: 'nli', search }, dailyLimit: 10 } }, quotaStore: { reserve: (...args) => quota.reserve(...args), defer() { throw new Error('STORAGE_SECRET_CANARY'); } } }));
  const first = await request(base); expect(first.status).toBe(502); expect(await first.text()).not.toContain('STORAGE_SECRET_CANARY');
  expect((await request(base)).status).toBe(429); expect(search).toHaveBeenCalledTimes(1);
  expect(store(file).reserve('nli', now + 20000, 10)).toBe(86400000 - 20000);
});
