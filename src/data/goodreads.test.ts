import { afterEach, expect, it, vi } from 'vitest';
import { emptyInput } from './books';
import { applyCatalogCandidate, saveCatalogBook } from './catalogSave';
import { forgetGoodreadsKey, goodreadsAdapter, goodreadsConfigured, goodreadsEndpoint, rememberGoodreadsKey, restoreGoodreadsKey } from './goodreads';
import { personalCredentials } from './personalCredentials';
import { emptyQuery } from './catalog';
import { LibraryDatabase, initializeLibrary } from './database';
import { createFullSnapshot } from './fullBackup';
import { createSnapshot, restoreSnapshot, validateBackup } from './backup';
import { fullWorkbook, fullWorkbookCandidate } from './xlsxWorkbook';
import { emptyReview, reviewWithCatalog } from './draftReviewValues';

const key = 'a'.repeat(64), signal = () => new AbortController().signal;
const source = { provider: 'goodreads', recordId: '123', sourceUrl: 'https://www.goodreads.com/book/show/123', fetchedAt: '2026-10-07T00:00:00.000Z', cached: true };
const details = { ...source, fields: { title: 'ספר סינתטי', authors: ['מחבר בדיקה'], publicationDate: '2024-02-29', publicationYear: 2024, binding: 'Paperback', series: 'סדרת בדיקה', seriesNumber: 2.5 }, coverUrl: 'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/example.jpg' };
afterEach(async () => { vi.useRealTimers(); await forgetGoodreadsKey(); });

it('private credentials restore independently and stay outside both JSON and Excel', async () => {
  await expect(rememberGoodreadsKey('invalid')).rejects.toThrow();
  await personalCredentials.credentials.put({ id: 'goodreads', key }); await restoreGoodreadsKey(); expect(goodreadsConfigured()).toBe(true);
  const db = new LibraryDatabase('goodreads-privacy-' + crypto.randomUUID());
  try {
    await initializeLibrary(db); const snapshot = await createFullSnapshot(db);
    expect(snapshot.text).not.toContain(key); expect(JSON.stringify(fullWorkbook((await validateBackup(snapshot.text)).data))).not.toContain(key);
  } finally { await db.delete(); }
  await forgetGoodreadsKey(); await restoreGoodreadsKey(); expect(goodreadsConfigured()).toBe(false);
});

it('normal search sends only query and private auth to the fixed endpoint; resolve validates the chosen record', async () => {
  await rememberGoodreadsKey(key);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ provider: 'goodreads', cached: true, results: [{ ...source, fields: { title: 'ספר סינתטי' } }] })).mockResolvedValueOnce(Response.json(details));
  const adapter = goodreadsAdapter(fetcher), candidate = (await adapter.search({ ...emptyQuery, title: 'ספר', author: 'מחבר' }, signal()))[0];
  expect(fetcher.mock.calls[0][0]).toBe(goodreadsEndpoint + '/v1/search');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify({ query: 'ספר מחבר' }) });
  const resolved = await adapter.resolve!(candidate, signal()); expect(resolved.fields).toMatchObject({ seriesName: 'סדרת בדיקה', seriesNumber: 2.5, publicationDate: '2024-02-29' });
  const wrong = goodreadsAdapter(async () => Response.json({ ...details, recordId: '456' }));
  await expect(wrong.resolve!(candidate, signal())).rejects.toThrow('אינה תואמת');
});

it('malformed IDs, sources, fields and cover URLs cannot become library candidates', async () => {
  await rememberGoodreadsKey(key);
  for (const row of [{ ...source, recordId: '0' }, { ...source, sourceUrl: 'https://evil.test/book/show/123' }, { ...source, fields: { secret: key } }, { ...source, coverUrl: 'https://m.media-amazon.com/unrelated.jpg' }]) {
    await expect(goodreadsAdapter(async () => Response.json({ provider: 'goodreads', results: [row], cached: true })).search({ ...emptyQuery, title: 'ספר' }, signal())).rejects.toThrow();
  }
});

it('source failures expose safe messages and daily limits do not trigger retries', async () => {
  await rememberGoodreadsKey(key);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(key, { status: 429, headers: { 'Retry-After': '3600' } }));
  const adapter = goodreadsAdapter(fetcher), query = { ...emptyQuery, title: 'ספר' };
  await expect(adapter.search(query, signal())).rejects.toMatchObject({ state: 'rate-limited' });
  await expect(adapter.search(query, signal())).rejects.toMatchObject({ state: 'rate-limited' }); expect(fetcher).toHaveBeenCalledTimes(1);
  await rememberGoodreadsKey(key);
  await expect(goodreadsAdapter(async () => new Response(key, { status: 503 })).search(query, signal())).rejects.toThrow('מקור אחר');
});

it('uncached search observes server spacing before details and cancellation prevents another request', async () => {
  await rememberGoodreadsKey(key); vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ provider: 'goodreads', results: [source] }));
  const adapter = goodreadsAdapter(fetcher), candidate = (await adapter.search({ ...emptyQuery, title: 'ספר' }, signal()))[0];
  const controller = new AbortController(), result = adapter.resolve!(candidate, controller.signal).catch(error => error);
  controller.abort(); expect((await result).name).toBe('AbortError'); expect(fetcher).toHaveBeenCalledTimes(1);
});

it('series, edition fields and provenance round-trip through drafts, JSON and Excel; no series is created before saving', async () => {
  await rememberGoodreadsKey(key);
  const candidate = await goodreadsAdapter(async () => Response.json(details)).resolve!({ provider: 'goodreads', recordId: source.recordId, sourceUrl: source.sourceUrl, fetchedAt: source.fetchedAt, kind: 'edition', fields: {}, warnings: [] }, signal());
  const db = new LibraryDatabase('goodreads-save-' + crypto.randomUUID());
  try {
    await initializeLibrary(db); const { draft, fields } = applyCatalogCandidate({ ...emptyInput, personalNotes: 'מידע ישן' }, candidate);
    expect(await db.series.count()).toBe(0); expect(reviewWithCatalog(emptyReview(), draft, candidate, fields).input.seriesName).toBe('סדרת בדיקה');
    const book = await saveCatalogBook(db, draft, candidate, fields); expect(book).toMatchObject({ seriesNumber: 2.5, publicationDate: '2024-02-29', binding: 'Paperback', personalNotes: 'מידע ישן' });
    expect(await db.series.get(book.seriesId!)).toMatchObject({ name: 'סדרת בדיקה' });
    const snapshot = await createFullSnapshot(db); expect(JSON.parse(snapshot.text).formatVersion).toBe(12); expect(JSON.parse((await createSnapshot(db)).text).version).toBe(9);
    const backup = await validateBackup(snapshot.text), excel = await fullWorkbookCandidate(db, { full: true, workbook: fullWorkbook(backup.data), fingerprint: 'synthetic', sheet: 'Books', headers: [] });
    expect(excel.backup.data.metadataSources).toEqual(backup.data.metadataSources); expect(excel.backup.data.series).toEqual(backup.data.series);
    await restoreSnapshot(db, backup, snapshot.fingerprint); expect(await db.books.get(book.id)).toEqual(book);
    await saveCatalogBook(db, { ...draft, title: 'ספר שני' }, candidate, fields); expect(await db.series.count()).toBe(1);
  } finally { await db.delete(); }
});
