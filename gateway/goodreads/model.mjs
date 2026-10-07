export class GoodreadsError extends Error {
  constructor(state, message, status = 503) { super(message); this.state = state; this.status = status; }
}
const fail = () => { throw new GoodreadsError('source-changed', 'מבנה Goodreads אינו מוכר. אפשר להשתמש במקור אחר.'); };
const text = value => typeof value === 'string' && value.trim() && value.length <= 1000 ? value.trim() : undefined;
const positive = value => Number.isInteger(value) && value > 0 && value <= 100000 ? value : undefined;
export function bookId(value) {
  if (typeof value !== 'string') throw new GoodreadsError('invalid', 'נדרש מזהה ספר או קישור Goodreads.', 400);
  if (/^[1-9]\d{0,13}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'www.goodreads.com' && !url.username && !url.password && !url.port) {
      const id = /^\/book\/show\/([1-9]\d{0,13})(?:[./-]|$)/.exec(url.pathname)?.[1]; if (id) return id;
    }
  } catch { /* Invalid URLs never become upstream destinations. */ }
  throw new GoodreadsError('invalid', 'קישור הספר אינו תקין.', 400);
}
export function queryText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300 || [...value].some(char => char.charCodeAt(0) < 32)) throw new GoodreadsError('invalid', 'הזן שם ספר, מחבר או ISBN עד 300 תווים.', 400);
  return value.trim();
}
export function blocked(html) { return /captcha|verify you are human|robot check|awswaf|challenge-platform/i.test(html); }
export function parseBook(html, id) {
  if (blocked(html)) throw new GoodreadsError('blocked', 'Goodreads חסם את השליפה. אפשר לפתוח את הספר ידנית.');
  const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match) return fail();
  let state;
  try { state = JSON.parse(match[1])?.props?.pageProps?.apolloState; } catch { return fail(); }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return fail();
  const row = Object.values(state).find(row => row?.__typename === 'Book' && String(row.legacyId) === id);
  if (!row || !text(row.title)) return fail();
  const resolve = ref => ref?.__ref && Object.hasOwn(state, ref.__ref) ? state[ref.__ref] : undefined;
  const fields = { title: text(row.title) };
  const authors = [row.primaryContributorEdge, ...(Array.isArray(row.secondaryContributorEdges) ? row.secondaryContributorEdges.slice(0, 30) : [])]
    .filter(edge => edge?.role === 'Author').map(edge => text(resolve(edge.node)?.name)).filter(Boolean);
  if (authors.length) fields.authors = [...new Set(authors)];
  const details = row.details ?? {};
  for (const [key, source] of [['publisher', 'publisher'], ['binding', 'format']]) if (text(details[source])) fields[key] = text(details[source]);
  if (text(details.language?.name)) fields.language = text(details.language.name);
  else if (text(details.language)) fields.language = text(details.language);
  if (positive(details.numPages)) fields.pages = details.numPages;
  for (const [key, length] of [['isbn13', 13], ['isbn', 10]]) {
    const code = typeof details[key] === 'string' ? details[key].replace(/[\s-]/g, '').toUpperCase() : '';
    if (code.length === length && (length === 13 ? /^97[89]\d{10}$/ : /^\d{9}[\dX]$/).test(code)) {
      const digits = [...code].map(c => c === 'X' ? 10 : +c);
      if (length === 13 ? digits.reduce((n, d, i) => n + d * (i % 2 ? 3 : 1), 0) % 10 === 0 : digits.reduce((n, d, i) => n + d * (10 - i), 0) % 11 === 0) fields[length === 13 ? 'isbn13' : 'isbn10'] = code;
    }
  }
  if (typeof details.publicationTime === 'number' && Number.isFinite(details.publicationTime)) {
    const date = new Date(details.publicationTime);
    if (Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1000 && date.getUTCFullYear() <= 9999) { fields.publicationDate = date.toISOString().slice(0, 10); fields.publicationYear = date.getUTCFullYear(); }
  }
  const entry = Array.isArray(row.bookSeries) ? row.bookSeries[0] : undefined;
  const series = text(resolve(entry?.series)?.title);
  if (series) { fields.series = series; if (/^\d+(?:\.\d+)?$/.test(entry.userPosition ?? '') && +entry.userPosition <= 1000000) fields.seriesNumber = +entry.userPosition; }
  const cover = text(row.imageUrl);
  let coverUrl;
  try { const url = new URL(cover); const trusted = ['i.gr-assets.com', 'images.gr-assets.com', 's.gr-assets.com'].includes(url.hostname) || ['m.media-amazon.com', 'images-na.ssl-images-amazon.com'].includes(url.hostname) && url.pathname.startsWith('/images/S/compressed.photo.goodreads.com/'); if (url.protocol === 'https:' && trusted && !url.username && !url.password && !url.port) coverUrl = url.href; } catch { /* Optional cover. */ }
  return { provider: 'goodreads', recordId: id, sourceUrl: 'https://www.goodreads.com/book/show/' + id, fields, ...(coverUrl ? { coverUrl } : {}), fetchedAt: new Date().toISOString() };
}
export function parseSearch(html) {
  if (blocked(html)) throw new GoodreadsError('blocked', 'Goodreads חסם את החיפוש האוטומטי. אפשר להשתמש במקור אחר.');
  const ids = new Set();
  for (const match of html.matchAll(/<a\b[^>]*\bclass=["'][^"']*\bbookTitle\b[^"']*["'][^>]*>/gi)) {
    const href = /\bhref=["']([^"']+)["']/i.exec(match[0])?.[1];
    const id = /^\/book\/show\/([1-9]\d{0,13})(?:[./-]|$)/.exec(href ?? '')?.[1]; if (id) ids.add(id);
    if (ids.size === 5) break;
  }
  if (!ids.size && !/No results|No books found|no results found/i.test(html)) return fail();
  return [...ids].map(id => ({ recordId: id, sourceUrl: 'https://www.goodreads.com/book/show/' + id }));
}
