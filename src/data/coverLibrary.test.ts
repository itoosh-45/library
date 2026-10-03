import { expect, it, vi } from 'vitest';
import { applyCatalogCandidate } from './catalogSave';
import { emptyInput } from './books';
import { validateCandidate, type Candidate } from './metadata';
import { safeCatalogCoverUrl } from './catalogCoverUrl';
import { downloadCatalogCover } from './catalogCover';

const candidate: Candidate = { provider: 'openlibrary', recordId: '/books/OL88M', sourceUrl: 'https://openlibrary.org/books/OL88M', fetchedAt: '2026-10-03T00:00:00.000Z', kind: 'edition', fields: { title: 'ספר סינתטי', authors: ['מחבר סינתטי'], language: 'heb', publisher: 'הוצאה', publicationYear: 2020, isbn10: '0140328726', isbn13: '9780140328721', pages: 120 }, warnings: [] };
it('all available catalog fields apply without opt-in; absent values retain the draft and ISBN13 wins', () => {
  const result = applyCatalogCandidate({ ...emptyInput, personalNotes: 'רשמים', subtitle: 'קיים', readStatus: 'reading' }, candidate);
  expect(result.draft).toMatchObject({ title: 'ספר סינתטי', authors: ['מחבר סינתטי'], language: 'heb', publisher: 'הוצאה', publicationYear: '2020', isbn: '9780140328721', pages: '120', subtitle: 'קיים', personalNotes: 'רשמים', readStatus: 'reading' });
  expect(result.fields).toContain('language'); expect(result.fields).not.toContain('isbn10');
  expect(emptyInput.title).toBe('');
});
it('cover validation refuses wrong provider, credentials, redirects targets and key-like query parameters', () => {
  const good = 'https://covers.openlibrary.org/b/id/88-M.jpg?default=false';
  expect(safeCatalogCoverUrl(good)).toBe(true); expect(validateCandidate({ ...candidate, coverUrl: good }).coverUrl).toBe(good);
  for (const url of ['https://evil.test/88.jpg', 'http://covers.openlibrary.org/b/id/88-M.jpg?default=false', 'https://covers.openlibrary.org@evil.test/b/id/88-M.jpg?default=false', 'https://covers.openlibrary.org/b/id/88-M.jpg?default=false&key=synthetic', 'https://covers.openlibrary.org/b/id/88-M.jpg?default=false#secret', 'https://books.google.com/books/content?id=ok&token=synthetic']) expect(safeCatalogCoverUrl(url)).toBe(false);
  expect(() => validateCandidate({ ...candidate, provider: 'googlebooks', sourceUrl: 'https://books.google.com/books?id=ok', coverUrl: good })).toThrow();
});
it('cover download bounds the stream and refuses HTML before decoding, without credentials', async () => {
  const url = 'https://covers.openlibrary.org/b/id/88-M.jpg?default=false';
  const prepare = vi.fn().mockResolvedValue({ sourceUrl: null, sha256: 'synthetic' });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1,2,3]), { headers: { 'content-type': 'image/jpeg' } }));
  await expect(downloadCatalogCover(url, new AbortController().signal, fetcher, prepare)).resolves.toMatchObject({ sourceUrl: null });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' });
  expect(prepare.mock.calls[0][0].type).toBe('image/jpeg');
  fetcher.mockResolvedValueOnce(new Response('<script>bad</script>', { headers: { 'content-type': 'text/html' } }));
  await expect(downloadCatalogCover(url, new AbortController().signal, fetcher, prepare)).rejects.toThrow();
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } }));
  await expect(downloadCatalogCover(url, new AbortController().signal, fetcher, prepare)).rejects.toThrow('גדול מדי');
  expect(prepare).toHaveBeenCalledTimes(1);
});
it('cancelled cover never reaches image preparation', async () => {
  const signal = AbortSignal.abort(), prepare = vi.fn();
  await expect(downloadCatalogCover('https://covers.openlibrary.org/b/id/88-M.jpg?default=false', signal, async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }), prepare)).rejects.toThrow();
  expect(prepare).not.toHaveBeenCalled();
});

it('cover downloads accept only the official archive redirect and reject a foreign final destination',async()=>{
 const prepare=vi.fn().mockResolvedValue({sourceUrl:null});
 for(const [url,allowed] of [['https://ia800703.us.archive.org/view_archive.php?archive=/4/items/m_covers_0008/m_covers_0008_73.zip&file=0008739161-M.jpg',true],['https://attacker.example.test/cover.jpg',false]] as const){
  const response=new Response(new Uint8Array([1]),{headers:{'content-type':'image/jpeg'}});Object.defineProperty(response,'url',{value:url});const downloading=downloadCatalogCover('https://covers.openlibrary.org/b/id/8739161-M.jpg?default=false',new AbortController().signal,async()=>response,prepare);
  if(allowed)await expect(downloading).resolves.toMatchObject({sourceUrl:null});else await expect(downloading).rejects.toThrow('מאושר');
 }
});
