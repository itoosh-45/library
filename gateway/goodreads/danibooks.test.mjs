import { test } from 'node:test';
import assert from 'node:assert/strict';
import { danaDigits, daniId, parseDaniBook } from './danibooks.mjs';
test('Dani parser retains literal identifiers, reads public author fields and refuses foreign destinations', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({ '@type': 'Product', name: 'ספר בדיקה', url: 'https://www.danibooks.co.il/web/?itemid=123&pagetype=9', sku: 'unrelated author' }) + '</script><span aria-label="מק&quot;ט מוצר 012300004567"></span><span aria-label="מחבר/ת מחבר בדיקה"></span><span aria-label="שם יצרן הוצאה לבדיקה"></span>';
  const candidate = parseDaniBook(html, '123'); assert.equal(candidate.fields.danacode, danaDigits('123-4567')); assert.deepEqual(candidate.fields.authors, ['מחבר בדיקה']); assert.equal(candidate.fields.publisher, 'הוצאה לבדיקה');
  for (const url of ['https://evil.test/web/?pagetype=9&itemid=123', 'https://www.danibooks.co.il/redirect?itemid=123', 'https://www.danibooks.co.il/web/?pagetype=9&itemid=123&redirect=evil']) assert.throws(() => daniId(url));
  assert.throws(() => parseDaniBook(html, '124')); assert.throws(() => parseDaniBook(html.replace('מק&quot;ט מוצר', 'unrelated'), '123'));
});
