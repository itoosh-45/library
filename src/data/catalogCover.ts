import { prepareImage } from './images';
import { safeCatalogCoverUrl } from './catalogCoverUrl';

export async function downloadCatalogCover(url: string, signal: AbortSignal, fetcher: typeof fetch = fetch, prepare = prepareImage) {
  if (!safeCatalogCoverUrl(url)) throw new Error('כתובת הכריכה אינה מאושרת.');
  const response = await fetcher(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
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
