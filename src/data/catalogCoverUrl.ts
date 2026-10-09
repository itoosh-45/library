// Catalog cover destinations only; never fetch an arbitrary URL returned by a provider.
export function safeCatalogCoverUrl(value: unknown, provider?: string): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    if (url.hostname === 'infocenters.co.il' && (!provider || provider === 'icl')) {
      return !url.search && /^\/icl\/multimedia\/\d{4}\/\d{1,2}\/\d{1,2}\/[\w-]+f\.(?:jpg|jpeg|png)$/i.test(url.pathname);
    }
    if (url.hostname === 'covers.openlibrary.org' && (!provider || provider === 'openlibrary')) {
      return /^\/b\/(?:id\/[1-9]\d{0,11}|isbn\/(?:\d{13}|\d{9}[\dX]))-[MSL]\.jpg$/.test(url.pathname) && url.search === '?default=false';
    }
    if (url.hostname === 'books.google.com' && (!provider || provider === 'googlebooks')) {
      const allowed = ['id', 'printsec', 'img', 'zoom', 'source', 'jscmd', 'h', 'w', 'edge'];
      return url.pathname === '/books/content' && /^[\w-]{1,100}$/.test(url.searchParams.get('id') ?? '') && [...url.searchParams.keys()].every(key => allowed.includes(key));
    }
    if ((!provider || provider === 'goodreads') && ['m.media-amazon.com', 'images-na.ssl-images-amazon.com', 'i.gr-assets.com', 'images.gr-assets.com', 's.gr-assets.com'].includes(url.hostname)) {
      if (['m.media-amazon.com', 'images-na.ssl-images-amazon.com'].includes(url.hostname) && !url.pathname.startsWith('/images/S/compressed.photo.goodreads.com/')) return false;
      return !url.search && /^\/(?:images\/S\/compressed\.photo\.goodreads\.com\/)?books\/[\w./-]+\.(?:jpg|png|webp)$/.test(url.pathname);
    }
    return false;
  } catch { return false; }
}
