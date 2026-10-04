import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import { emptyInput, saveBook } from './books';
import { CatalogSearch, emptyQuery, openLibraryAdapter, readCatalogJson, validateQuery, type CatalogAdapter, type ProviderResult } from './catalog';
import { validateCandidate, validateMetadataSource, type Candidate } from './metadata';
import { saveCatalogBook } from './catalogSave';
import { createSnapshot, deleteBook, restoreSnapshot, validateBackup } from './backup';
import { hashBytes } from './images';
import { normalizeGoogleBooks, gatewayAdapter } from './catalogGateway';
import { lendCopy, localDay, savePerson } from './loans';

let database: LibraryDatabase;
beforeEach(async () => { database = new LibraryDatabase('phase08-' + crypto.randomUUID()); await initializeLibrary(database); });
afterEach(async () => { vi.useRealTimers(); await database.delete(); });
const candidate = (fields: Candidate['fields'] = { title: 'כותרת סינתטית', publicationYear: 2001, authors: ['מחבר סינתטי'] }): Candidate => ({ provider: 'openlibrary', kind: 'edition', recordId: '/books/OL123M', sourceUrl: 'https://openlibrary.org/books/OL123M', fetchedAt: new Date().toISOString(), fields, warnings: [] });
const query = { ...emptyQuery, title: 'כותרת סינתטית' };
it('T15 rejects empty/foreign query fields and bad identifiers without a provider call', () => {
  expect(() => validateQuery(emptyQuery)).toThrow(); expect(() => validateQuery({ ...query, isbn: '9780000000001' })).toThrow(); expect(() => validateQuery({ ...query, year: '20' })).toThrow();
  expect(() => validateQuery({ ...query, secret: 'excluded' } as never)).toThrow(); expect(validateQuery({ ...query, danacode: '002001' }).danacode).toBe('002001');
});
it('T15 Work metadata cannot masquerade as edition year or ISBN', () => {
  expect(() => validateCandidate({ ...candidate(), kind: 'work' })).toThrow();
  expect(validateCandidate({ ...candidate({ title: 'יצירה' }), kind: 'work' }).fields).toEqual({ title: 'יצירה' });
  for (const fields of [{ description: 'omitted' }, { pages: -1 }, { isbn13: '9780000000001' }]) expect(() => validateCandidate(candidate(fields as never))).toThrow();
  for (const sourceUrl of ['javascript:alert(1)', 'https://evil.test/book', 'https://openlibrary.org/book?api_key=canary', 'https://openlibrary.org/book#api_key=canary', 'https://openlibrary.org/book?%61pi_key=canary', 'https://user:pass@openlibrary.org/book']) expect(() => validateCandidate({ ...candidate(), sourceUrl })).toThrow();
  expect(() => validateCandidate({ ...candidate(), fetchedAt: '2026-02-30T12:00:00.000Z' })).toThrow();
});
it('catalog stream size is bounded before the whole response is buffered', async () => {
  const cancel = vi.fn(), stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel });
  await expect(readCatalogJson(new Response(stream))).rejects.toThrow('גדולה מדי'); expect(cancel).toHaveBeenCalledTimes(1);
});
it('T15 Open Library uses edition title separately, never copies Work identifiers/year, and does not follow ISBN redirects', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ docs: [{ key: '/works/OL12W', title: 'יצירה', isbn: ['9780140328721'], first_publish_year: 1920, author_name: ['מחבר יצירה'], editions: { docs: [{ key: '/books/OL123M', title: 'מהדורה' }] } }, { key: '/works/OL13W', title: 'רמז', first_publish_year: 1940, isbn: ['9780140328721'] }] })));
  const rows = await openLibraryAdapter(fetcher).search({ ...query, isbn: '9780140328721' }, new AbortController().signal);
  expect(rows.map(row => row.fields)).toEqual([{ title: 'מהדורה' }, { title: 'רמז' }]); expect(rows.map(row => row.kind)).toEqual(['edition', 'work']);
  expect(fetcher.mock.calls[0][0]).toContain('/search.json?'); expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
});
it('T15 partial results arrive before a slow provider, cancellation ignores a late result', async () => {
  let finish!: (value: Candidate[]) => void;
  const slow: CatalogAdapter = { provider: 'nli', search: () => new Promise(resolve => { finish = resolve; }) }, fast: CatalogAdapter = { provider: 'openlibrary', search: async () => [candidate()] };
  const results: ProviderResult[] = [], search = new CatalogSearch(database, [slow, fast]); const pending = search.search(query, result => results.push(result));
  await vi.waitFor(() => expect(results).toHaveLength(1)); expect(results[0].provider).toBe('openlibrary'); search.cancel(); finish([]); await pending; expect(results).toHaveLength(1);
});
it('T15 a newer search excludes old results even if an adapter ignores AbortSignal', async () => {
  let finish!: (value: Candidate[]) => void; let calls = 0;
  const adapter: CatalogAdapter = { provider: 'openlibrary', search: () => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([candidate({ title: 'חדש' })]) };
  const results: ProviderResult[] = [], search = new CatalogSearch(database, [adapter]); const first = search.search(query, result => results.push(result)); await vi.waitFor(() => expect(calls).toBe(1));
  await search.search({ ...query, title: 'חדש' }, result => results.push(result)); finish([candidate({ title: 'ישן' })]); await first; expect(results.map(row => row.candidates[0].fields.title)).toEqual(['חדש']);
});
it('T15 timeout terminates a provider that never resolves and uses safe errors', async () => {
  const search = new CatalogSearch(database, [{ provider: 'openlibrary', search: () => new Promise(() => {}) }], 10), results: ProviderResult[] = [];
  await search.search(query, result => results.push(result)); expect(results[0].state).toBe('timeout'); expect(results[0].message).not.toContain('http');
});
it('T15 positive cache retains provenance, empty cache expires sooner and errors are not cached', async () => {
  const call = vi.fn(async () => [candidate()]), search = new CatalogSearch(database, [{ provider: 'openlibrary', search: call }]); const rows: ProviderResult[] = [];
  await search.search(query, row => rows.push(row)); await search.search(query, row => rows.push(row)); expect(call).toHaveBeenCalledTimes(1); expect(rows[1].cached).toBe(true); expect(rows[1].candidates[0].recordId).toBe('/books/OL123M');
  const cache = (await database.metadataCache.toArray())[0]; expect(Date.parse(cache.expiresAt) - Date.parse(cache.fetchedAt)).toBe(7 * 86400000);
  await database.metadataCache.clear(); const empty = new CatalogSearch(database, [{ provider: 'openlibrary', search: async () => [] }]); await empty.search(query, () => {});
  const negative = (await database.metadataCache.toArray())[0]; expect(Date.parse(negative.expiresAt) - Date.parse(negative.fetchedAt)).toBe(15 * 60000);
  await database.metadataCache.clear(); const broken = new CatalogSearch(database, [{ provider: 'openlibrary', search: async () => { throw new Error('SECRET-CANARY'); } }]); await broken.search(query, row => expect(row.message).not.toContain('SECRET-CANARY')); expect(await database.metadataCache.count()).toBe(0);
});
it('T15 429 honors waiting and does not immediately call the provider again', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } })), adapter = openLibraryAdapter(fetcher);
  await expect(adapter.search(query, new AbortController().signal)).rejects.toMatchObject({ state: 'rate-limited' }); await expect(adapter.search(query, new AbortController().signal)).rejects.toMatchObject({ state: 'rate-limited' }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('T15 choosing fields requires explicit selection, respects edits and records overrides', async () => {
  await expect(saveCatalogBook(database, emptyInput, candidate(), [])).rejects.toThrow('בחר'); expect(await database.books.count()).toBe(0);
  const book = await saveCatalogBook(database, { ...emptyInput, title: 'שם ידני', publicationYear: '2001', authors: ['מחבר סינתטי'] }, candidate(), ['title', 'publicationYear', 'authors']);
  expect(book.title).toBe('שם ידני'); const source = (await database.metadataSources.toArray())[0]; expect(source.userOverriddenFields).toEqual(['title']);
  const edited = await saveBook(database, { ...emptyInput, title: 'שם ידני', publicationYear: '2003', authors: ['מחבר חדש'] }, book); expect(edited.publicationYear).toBe(2003); expect((await database.metadataSources.get(source.id))?.userOverriddenFields).toEqual(['title', 'publicationYear', 'authors']);
  await expect(saveCatalogBook(database, { ...emptyInput, title: 'ישן' }, candidate(), ['title'], book)).rejects.toThrow('השתנה');
});
it('T19 provenance saves with book atomically and rolls back all related writes on failure', async () => {
  const before = await createSnapshot(database), fail = () => { throw new Error('source-storage-failure'); }; database.metadataSources.hook('creating', fail);
  await expect(saveCatalogBook(database, { ...emptyInput, title: 'אושר', authors: ['שם'] }, candidate(), ['title', 'authors'])).rejects.toThrow('source-storage'); database.metadataSources.hook('creating').unsubscribe(fail); expect((await createSnapshot(database)).fingerprint).toBe(before.fingerprint);
});
it('T19 v4 source round trip validates references and whitelist; cache is excluded; deletion cleans source', async () => {
  const book = await saveCatalogBook(database, { ...emptyInput, title: 'כותרת סינתטית' }, candidate({ title: 'כותרת סינתטית' }), ['title']);
  await database.metadataCache.add({ key: 'ignored', provider: 'openlibrary', fetchedAt: new Date().toISOString(), expiresAt: new Date().toISOString(), minimalPayload: [] });
  const snapshot = await createSnapshot(database), root = JSON.parse(snapshot.text); expect(root.version).toBe(7); expect(root.counts.metadataSources).toBe(1); expect(root.data.metadataCache).toBeUndefined();
  const previousFormat = structuredClone(root); previousFormat.version = 4; delete previousFormat.data.recognitionDrafts; delete previousFormat.counts.recognitionDrafts; previousFormat.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(previousFormat.data)).buffer); expect((await validateBackup(JSON.stringify(previousFormat))).data.metadataSources).toEqual(root.data.metadataSources);
  await restoreSnapshot(database, await validateBackup(snapshot.text), snapshot.fingerprint); expect((await createSnapshot(database)).fingerprint).toBe(snapshot.fingerprint); expect(await database.metadataCache.count()).toBe(0);
  const broken = structuredClone(root); broken.data.metadataSources[0].bookId = crypto.randomUUID(); broken.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(broken.data)).buffer); await expect(validateBackup(JSON.stringify(broken))).rejects.toThrow();
  const source = root.data.metadataSources[0]; expect(() => validateMetadataSource({ ...source, fieldValues: { ...source.fieldValues, secret: 'forbidden' } })).toThrow();
  await deleteBook(database, book.id, snapshot.fingerprint); expect(await database.metadataSources.count()).toBe(0);
});
it('T19 v3 legacy keeps loans while restoring empty provenance', async () => {
  await saveCatalogBook(database, { ...emptyInput, title: 'ישן' }, candidate({ title: 'ישן' }), ['title']);
  const person = await savePerson(database, 'אדם סינתטי'); await lendCopy(database, { copyId: (await database.copies.toArray())[0].id, personId: person.id, borrowedOn: localDay(), expectedReturnOn: '' });
  const before = await createSnapshot(database), root = JSON.parse(before.text);
  root.version = 3; delete root.data.recognitionDrafts; delete root.counts.recognitionDrafts; delete root.data.metadataSources; delete root.counts.metadataSources; root.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(root.data)).buffer);
  const legacy = await validateBackup(JSON.stringify(root)); expect(legacy.counts.metadataSources).toBe(0); await restoreSnapshot(database, legacy, before.fingerprint); expect(await database.metadataSources.count()).toBe(0); expect(await database.books.count()).toBe(1); expect(await database.loans.count()).toBe(1);
});
it('T15 Google Books maps only edition fields, equivalent ISBNs and no description/rating/remote cover', () => {
  const rows = normalizeGoogleBooks({ items: [{ id: 'synthetic_1', volumeInfo: { title: 'מהדורה סינתטית', authors: ['מחבר'], publishedDate: '1988-10-01', pageCount: 144, description: 'excluded', averageRating: 4, imageLinks: { thumbnail: 'https://evil.test/track' }, industryIdentifiers: [{ type: 'ISBN_10', identifier: '0140328726' }, { type: 'ISBN_13', identifier: '9780140328721' }] } }] });
  expect(rows[0].fields).toEqual({ title: 'מהדורה סינתטית', authors: ['מחבר'], publicationYear: 1988, pages: 144, isbn10: '0140328726', isbn13: '9780140328721' }); expect(rows[0].kind).toBe('volume'); expect(rows[0].warnings).toEqual([]); expect(normalizeGoogleBooks({ totalItems: 0 })).toEqual([]);
});
it('T15 gateway client fixes route, excludes credentials and rejects foreign provenance and raw failures', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ candidates: [candidate()] })));
  const adapter = gatewayAdapter('nli', 'https://catalog.example.test/', fetcher);
  await expect(adapter.search(query, new AbortController().signal)).rejects.toThrow('מקור');
  expect(fetcher.mock.calls[0][0]).toBe('https://catalog.example.test/catalog/search'); expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', body: JSON.stringify({ provider: 'nli', query }) });
  for (const origin of ['http://catalog.example.test/', 'https://user:secret@catalog.example.test/', 'https://catalog.example.test/?key=canary']) expect(() => gatewayAdapter('nli', origin)).toThrow();
  fetcher.mockResolvedValue(new Response('SECRET-CANARY', { status: 503 })); await expect(adapter.search(query, new AbortController().signal)).rejects.toMatchObject({ state: 'unavailable', safeMessage: 'החיבור לקטלוג אינו זמין כרגע.' });
  fetcher.mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
  await expect(adapter.search(query, new AbortController().signal)).rejects.toMatchObject({ state: 'rate-limited' });
  await expect(adapter.search(query, new AbortController().signal)).rejects.toMatchObject({ state: 'rate-limited' }); expect(fetcher).toHaveBeenCalledTimes(3);
});

it('catalog results prefer the edition cover and can retrieve a missing preview without fetching authors',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async input=>String(input).includes('/search.json')?new Response(JSON.stringify({docs:[{key:'/works/OL1W',cover_i:10,editions:{docs:[{key:'/books/OL1M',title:'ספר כריכה',cover_i:20}]}}]})):new Response(JSON.stringify({covers:[30],authors:[{key:'/authors/OL1A'}]})));
 const adapter=openLibraryAdapter(fetcher),signal=new AbortController().signal;const rows=await adapter.search({...emptyQuery,title:'ספר כריכה'},signal);
 expect(rows[0].coverUrl).toBe('https://covers.openlibrary.org/b/id/20-M.jpg?default=false');
 await expect(adapter.previewCover!(rows[0],signal)).resolves.toBe('https://covers.openlibrary.org/b/id/30-M.jpg?default=false');
 expect(fetcher).toHaveBeenCalledTimes(2);expect(String(fetcher.mock.calls[1][0])).toContain('/books/OL1M.json');
 await expect(adapter.previewCover!({...rows[0],kind:'work',recordId:'/works/OL1W'},signal)).resolves.toBeUndefined();expect(fetcher).toHaveBeenCalledTimes(2);
});
