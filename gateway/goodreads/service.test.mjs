import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { bookId, parseBook, parseSearch } from './model.mjs';
import { createGoodreadsService } from './service.mjs';
const token = 'a'.repeat(64), origin = 'https://itoosh-45.github.io';

test('ISBN lookup returns only a validated Goodreads redirect without following it or fetching arbitrary hosts', async () => {
  let requested;
  const app = await setup({ fetcher: async url => { requested = String(url); return new Response(null, { status: 302, headers: { Location: '/book/show/123.Title' } }); } });
  try {
    const response = await app.request({ query: '9780140328721' }, {}, '/v1/search'); assert.equal(response.status, 200);
    assert.equal(requested, 'https://www.goodreads.com/book/isbn/9780140328721');
    assert.deepEqual((await response.json()).results, [{ recordId: '123', sourceUrl: 'https://www.goodreads.com/book/show/123' }]);
  } finally { await app.close(); }
  const bad = await setup({ fetcher: async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } }) });
  try { assert.equal((await bad.request({ query: '9780140328721' }, {}, '/v1/search')).status, 503); } finally { await bad.close(); }
});
function fixture(id = '123') {
  return '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { apolloState: {
    book: { __typename: 'Book', legacyId: id, title: 'ספר סינתטי', primaryContributorEdge: { role: 'Author', node: { __ref: 'author' } }, secondaryContributorEdges: [{ role: 'Translator', node: { __ref: 'translator' } }], details: { isbn13: '9780140328721', numPages: 200, publisher: 'הוצאה', language: { name: 'Hebrew' }, format: 'Paperback', publicationTime: Date.UTC(2024, 1, 29) }, bookSeries: [{ userPosition: '2', series: { __ref: 'series' } }], imageUrl: 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/example.jpg' },
    author: { name: 'מחבר בדיקה' }, translator: { name: 'מתרגם בדיקה' }, series: { title: 'סדרת בדיקה' },
  } } } }) + '</script>';
}
async function setup(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'library-goodreads-'));
  const path = join(dir, 'test.sqlite');
  let time = Date.UTC(2026, 9, 7), calls = 0;
  const server = createGoodreadsService({ token, origins: [origin], path, dailyLimit: 2, now: () => time,
    fetcher: async url => { calls++; return new Response(fixture(new URL(url).pathname.split('/').pop()), { headers: { 'Content-Type': 'text/html' } }); }, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  return { server, path, calls: () => calls, advance: () => { time += 10001; }, now: () => time,
    request: (body = { id: '123' }, headers = {}, route = '/v1/book') => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, Origin: origin, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    close: async () => { server.close(); server.closeAllConnections(); await once(server, 'close'); await rm(dir, { recursive: true, force: true }); } };
}
test('only fixed Goodreads book URLs and bounded IDs can reach upstream', () => {
  assert.equal(bookId('https://www.goodreads.com/book/show/123.Title'), '123');
  for (const url of ['https://127.0.0.1/book/show/123', 'https://www.goodreads.com.evil.test/book/show/123', 'https://user:pass@www.goodreads.com/book/show/123', 'https://www.goodreads.com:444/book/show/123', 'file:///etc/passwd', '0', '999999999999999']) assert.throws(() => bookId(url));
});
test('edition fields include series, Hebrew, exact date and only author-role contributors', () => {
  const row = parseBook(fixture(), '123');
  assert.deepEqual(row.fields, { title: 'ספר סינתטי', authors: ['מחבר בדיקה'], publisher: 'הוצאה', binding: 'Paperback', language: 'Hebrew', pages: 200, isbn13: '9780140328721', publicationDate: '2024-02-29', publicationYear: 2024, series: 'סדרת בדיקה', seriesNumber: 2 });
  assert.equal(row.provider, 'goodreads'); assert.ok(row.coverUrl);
  assert.throws(() => parseBook(fixture(), '124')); assert.throws(() => parseBook('captcha', '123')); assert.throws(() => parseBook('changed markup', '123'));
  assert.equal(parseBook(fixture().replace('i.gr-assets.com', 'evil.test'), '123').coverUrl, undefined);
  assert.ok(parseBook(fixture().replace('i.gr-assets.com', 'm.media-amazon.com'), '123').coverUrl);
  assert.equal(parseBook(fixture().replace('i.gr-assets.com/images/S/compressed.photo.goodreads.com', 'm.media-amazon.com/unrelated'), '123').coverUrl, undefined);
});
test('search extracts at most five distinct fixed book IDs and rejects unknown pages', () => {
  const html = Array.from({ length: 8 }, (_, i) => '<a href="/book/show/' + (i + 1) + '.Title" class="bookTitle">title</a>').join('');
  assert.equal(parseSearch(html).length, 5); assert.deepEqual(parseSearch('No results'), []); assert.throws(() => parseSearch('verify you are human')); assert.throws(() => parseSearch('unexpected page'));
});
test('token and origin are checked before upstream; invalid and oversized bodies are rejected', async () => {
  const app = await setup();
  try {
    assert.equal((await app.request(undefined, { Authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await app.request(undefined, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await app.request({ id: '123', extra: true })).status, 400);
    assert.equal((await app.request({ id: 'https://127.0.0.1/admin' })).status, 400);
    assert.equal((await app.request('x'.repeat(1025))).status, 413); assert.equal(app.calls(), 0);
  } finally { await app.close(); }
});
test('cache costs no upstream slot, cooldown and daily budget survive restart', async () => {
  const app = await setup(); let restarted;
  try {
    assert.equal((await app.request()).status, 200); const cached = await app.request(); assert.equal((await cached.json()).cached, true); assert.equal(app.calls(), 1);
    assert.equal((await app.request({ id: '124' })).status, 429); app.advance(); assert.equal((await app.request({ id: '124' })).status, 200);
    app.advance(); assert.equal((await app.request({ id: '125' })).status, 429); assert.equal(app.calls(), 2);
    app.server.close(); app.server.closeAllConnections(); await once(app.server, 'close');
    restarted = createGoodreadsService({ token, origins: [origin], path: app.path, dailyLimit: 2, now: app.now, fetcher: () => { throw new Error('must not fetch'); } });
    restarted.listen(0, '127.0.0.1'); await once(restarted, 'listening');
    const response = await fetch('http://127.0.0.1:' + restarted.address().port + '/v1/book', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: '{"id":"125"}' });
    assert.equal(response.status, 429); assert.ok(+response.headers.get('Retry-After') > 10000);
  } finally { if (restarted) { restarted.close(); restarted.closeAllConnections(); await once(restarted, 'close'); } if (app.server.listening) await app.close(); else await rm(join(app.path, '..'), { recursive: true, force: true }); }
});
test('blocked responses cause persistent cooldown and never retry or bypass the provider', async () => {
  let calls = 0;
  const app = await setup({ fetcher: async () => { calls++; return new Response('', { status: 202 }); } });
  try {
    const response = await app.request(); assert.equal(response.status, 503); assert.equal((await response.json()).state, 'blocked');
    app.advance(); assert.equal((await app.request({ id: '124' })).status, 429); assert.equal(calls, 1);
  } finally { await app.close(); }
});
test('concurrent lookup is rejected while one upstream request is active', async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const app = await setup({ fetcher: async () => { entered(); await pending; return new Response(fixture(), { headers: { 'Content-Type': 'text/html' } }); } });
  try {
    const first = app.request(); await ready;
    assert.equal((await app.request({ id: '124' })).status, 429); release(); assert.equal((await first).status, 200);
  } finally { release(); await app.close(); }
});
test('blocked search is suspended independently while direct book lookup remains available', async () => {
  let calls = 0;
  const app = await setup({ fetcher: async url => { calls++; return new URL(url).pathname === '/search' ? new Response('', { status: 202 }) : new Response(fixture(), { headers: { 'Content-Type': 'text/html' } }); } });
  try {
    assert.equal((await app.request({ query: 'ספר בדיקה' }, {}, '/v1/search')).status, 503);
    app.advance(); assert.equal((await app.request()).status, 200);
    app.advance(); assert.equal((await app.request({ query: 'חיפוש אחר' }, {}, '/v1/search')).status, 503); assert.equal(calls, 2);
  } finally { await app.close(); }
});
test('oversized upstream pages fail safely and keep the durable reservation', async () => {
  const app = await setup({ fetcher: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'text/html' } }) });
  try { assert.equal((await app.request()).status, 503); app.advance(); assert.equal((await app.request({ id: '124' })).status, 429); }
  finally { await app.close(); }
});
test('redirects are not followed and completed search network failures do not freeze book lookup', async () => {
  let searchCalls = 0;
  const app = await setup({ dailyLimit: 3, fetcher: async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (new URL(url).pathname === '/search') { searchCalls++; if (searchCalls === 1) throw new Error('network unavailable'); return new Response('', { status: 302, headers: { Location: 'https://evil.test/' } }); }
    return new Response(fixture(), { headers: { 'Content-Type': 'text/html' } });
  } });
  try {
    assert.equal((await app.request({ query: 'בדיקה' }, {}, '/v1/search')).status, 503);
    app.advance(); assert.equal((await app.request()).status, 200);
    app.advance(); assert.equal((await app.request({ query: 'בדיקה' }, {}, '/v1/search')).status, 503); assert.equal(searchCalls, 1);
  } finally { await app.close(); }
  const redirect = await setup({ fetcher: async () => new Response('', { status: 302, headers: { Location: 'https://evil.test/' } }) });
  try { const response = await redirect.request({ query: 'בדיקה' }, {}, '/v1/search'); assert.equal((await response.json()).state, 'blocked'); }
  finally { await redirect.close(); }
});
