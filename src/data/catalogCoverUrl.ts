// Catalog cover destinations only; never fetch an arbitrary URL returned by a provider.
export function safeCatalogCoverUrl(value: unknown, provider?: string): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    if (url.hostname === 'covers.openlibrary.org' && (!provider || provider === 'openlibrary')) {
      return /^\/b\/(?:id\/[1-9]\d{0,11}|isbn\/(?:\d{13}|\d{9}[\dX]))-[MSL]\.jpg$/.test(url.pathname) && url.search === '?default=false';
    }
    if (url.hostname === 'books.google.com' && (!provider || provider === 'googlebooks')) {
      const allowed = ['id', 'printsec', 'img', 'zoom', 'source', 'jscmd', 'h', 'w', 'edge'];
      return url.pathname === '/books/content' && /^[\w-]{1,100}$/.test(url.searchParams.get('id') ?? '') && [...url.searchParams.keys()].every(key => allowed.includes(key));
    }
    return false;
  } catch { return false; }
}
