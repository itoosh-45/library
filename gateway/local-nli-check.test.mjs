import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNliCheck, responseShape, boundedJson, errorHeaderCodes } from './local-nli-check.mjs';

test('T24 probe emits public bibliographic shape only and excludes secret/error/url fields', () => {
  const secret = 'SECRET_CANARY_123456';
  const shape = responseShape({ records: [{ title: 'Jerusalem', api_key: secret, error: secret, publisher: secret, url: 'https://example.test/?key=' + secret, [secret]: 'hidden' }] }, secret);
  assert(!JSON.stringify(shape).includes(secret)); assert(!JSON.stringify(shape).includes('https://')); assert(shape.some(row => row.sample === 'Jerusalem'));
});
test('T24 bounded response rejects oversized data', async () => { await assert.rejects(boundedJson(new Response('x'.repeat(100)), 10)); });
test('NLI documented Errors header retains numeric codes without logging provider messages or keys', () => {
  const codes = errorHeaderCodes(new Headers({ Errors: JSON.stringify({ Errors: [{ code: 1010, description: 'SECRET_CANARY_123456' }, { code: 'secret' }] }) }));
  assert.deepEqual(codes, [1010]); assert.deepEqual(errorHeaderCodes(new Headers({ Errors: 'invalid-json' })), []);
});
test('T24 local probe requires origin+nonce, calls only fixed NLI public query, refuses rapid repeat and safely handles failures', async () => {
  const secret = 'SECRET_CANARY_123456', calls = [], port = 4333;
  const server = createNliCheck({ port, fetcher: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ records: [{ title: 'Jerusalem', creator: 'Public author', secret }] })); } });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${port}`, html = await (await fetch(base)).text(), token = html.match(/'X-Check-Token':'([a-f0-9]+)'/)[1];
    const headers = { 'Content-Type': 'application/json', 'X-NLI-Key': secret, 'X-Check-Token': token, Origin: base };
    assert.equal((await fetch(base + '/check', { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: '{}' })).status, 403); assert.equal(calls.length, 0);
    const response = await (await fetch(base + '/check', { method: 'POST', headers, body: '{}' })).text(); assert(!response.includes(secret)); assert.equal(JSON.parse(response).state, 'received');
    assert.equal(calls.length, 1); assert.equal(calls[0].url.hostname, 'api.nli.org.il'); assert.equal(calls[0].url.searchParams.get('query'), 'title,exact,Jerusalem'); assert.equal(calls[0].options.redirect, 'error');
    assert.equal((await fetch(base + '/check', { method: 'POST', headers, body: '{}' })).status, 429); assert.equal(calls.length, 1);
    assert(!await (await fetch(base + '/result')).text().then(text => text.includes(secret)));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
