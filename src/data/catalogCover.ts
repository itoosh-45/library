import { comparableISBN, parseISBN } from './books';
import { prepareImage } from './images';
import { safeCatalogCoverUrl } from './catalogCoverUrl';
import { catalogServiceCover, goodreadsEndpoint } from './goodreads';

export async function downloadCatalogCover(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch, prepare = prepareImage) {
  if (!safeCatalogCoverUrl(url)) throw new Error('כתובת הכריכה אינה מאושרת.');
  const proxied = new URL(url).hostname === 'infocenters.co.il';
  const response = proxied ? await catalogServiceCover(url, signal, fetcher) : await fetcher(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' });
  if (response.url && !(proxied && response.url === goodreadsEndpoint + '/v1/icl-cover') && !safeCatalogCoverUrl(response.url) && !safeCoverRedirect(response.url)) { await response.body?.cancel(); throw new Error('יעד הכריכה אינו מאושר.'); }
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !response.body || !type || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) { await response.body?.cancel(); throw new Error('הכריכה אינה זמינה כתמונה תקינה.'); }
  const limit = 4 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('קובץ הכריכה גדול מדי.'); }
  const reader = response.body.getReader(), parts: ArrayBuffer[] = []; let length = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > limit) throw new Error('קובץ הכריכה גדול מדי.');
      parts.push(value.slice().buffer);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const image = await prepare(new File(parts, 'catalog-cover', { type }));
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  // Keep the released image/JSON format (sourceUrl=null); catalog provenance records the edition.
  return image;
}

function safeCoverRedirect(value: string) {
  try { const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&/^ia\d+\.us\.archive\.org$/.test(url.hostname)&&url.pathname==='/view_archive.php'&&/^\/\d+\/items\/m_covers_\d+\/m_covers_\d+_\d+\.zip$/.test(url.searchParams.get('archive')??'')&&/^\d+-[MSL]\.jpg$/.test(url.searchParams.get('file')??'')&&[...url.searchParams.keys()].every(key=>['archive','file'].includes(key)); }catch{return false;}
}
export async function downloadBookCover(preferred:string|undefined,isbn:string,signal:AbortSignal) {
  const urls:string[]=[];if(preferred)urls.push(preferred);
  if(isbn){try{const code=comparableISBN(parseISBN(isbn));if(code)urls.push(`https://covers.openlibrary.org/b/isbn/${code}-M.jpg?default=false`);}catch{/* Only checksum-valid ISBNs are queried. */}}
  for(const url of [...new Set(urls)]){try{return await downloadCatalogCover(url,signal);}catch(error){if(signal.aborted)throw error;}}
  throw new Error('לא נמצאה כריכה זמינה. אפשר להעלות צילום כריכה.');
}
