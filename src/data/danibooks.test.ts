import { afterEach, expect, it } from 'vitest';
import { danibooksAdapter, exactIdentifierMatch } from './danibooks';
import { rememberGoodreadsKey, forgetGoodreadsKey } from './goodreads';
import { emptyQuery } from './catalog';
import { validateCandidate } from './metadata';
import { LibraryDatabase, initializeLibrary } from './database';
import { saveCatalogBook } from './catalogSave';
import { emptyInput } from './books';
import { createFullSnapshot } from './fullBackup';
import { validateBackup } from './backup';
const source = { provider: 'danibooks', recordId: '123', sourceUrl: 'https://www.danibooks.co.il/web/?pagetype=9&itemid=123', fetchedAt: '2026-10-08T00:00:00.000Z', kind: 'edition', fields: { title: 'ספר בדיקה', authors: ['מחבר בדיקה'], danacode: '012300004567' }, warnings: [] };
afterEach(forgetGoodreadsKey);
it('requires exact identifiers before automatic application, preserving leading zeros and ISBN equivalence', () => {
  const candidate = validateCandidate(source);
  expect(exactIdentifierMatch({ ...emptyQuery, danacode: '123-4567' }, candidate)).toBe(true);
  expect(exactIdentifierMatch({ ...emptyQuery, danacode: '123-4568' }, candidate)).toBe(false);
  expect(exactIdentifierMatch({ ...emptyQuery, title: 'ספר בדיקה' }, candidate)).toBe(false);
  expect(exactIdentifierMatch({ ...emptyQuery, isbn: '0140328726' }, { ...candidate, fields: { isbn13: '9780140328721' } })).toBe(true);
  expect(() => validateCandidate({ ...source, sourceUrl: 'https://www.danibooks.co.il/redirect?itemid=123' })).toThrow();
});
it('uses private service auth, validates resolution and keeps the new source through a full backup', async () => {
  const key = 'b'.repeat(64); await rememberGoodreadsKey(key);
  const paths: string[] = [];
  const adapter = danibooksAdapter(async (url, init) => {
    paths.push(String(url)); expect(init?.headers).toMatchObject({ Authorization: 'Bearer ' + key });
    return Response.json({ ...source, cached: true, ...(String(url).endsWith('/danacode') ? { results: [source] } : {}) });
  });
  const query = { ...emptyQuery, danacode: '123-4567' }, candidates = await adapter.search(query, new AbortController().signal), resolved = await adapter.resolve!(candidates[0], new AbortController().signal);
  expect(exactIdentifierMatch(query, resolved)).toBe(true); expect(paths.map(path => new URL(path).pathname)).toEqual(['/library-catalog/v1/danacode', '/library-catalog/v1/danibook']);
  const db = new LibraryDatabase('dani-' + crypto.randomUUID());
  try { await initializeLibrary(db); await saveCatalogBook(db, { ...emptyInput, title: 'ספר בדיקה', danacode: resolved.fields.danacode as string }, resolved, ['title', 'danacode']); const snapshot = await createFullSnapshot(db); expect(snapshot.text).not.toContain(key); expect(JSON.parse(snapshot.text).formatVersion).toBe(12); expect((await validateBackup(snapshot.text)).data.metadataSources[0].provider).toBe('danibooks'); } finally { await db.delete(); }
});
