import { GoodreadsError } from './model.mjs';
const fail = () => { throw new GoodreadsError('source-changed', 'נתוני דני ספרים אינם זמינים או אינם תואמים לחיפוש.'); };
export function danaDigits(value) {
  if (typeof value !== 'string' || value.length > 50) return fail();
  const parts = /^\s*(\d{1,4})\s*-\s*(\d{1,8})\s*$/.exec(value);
  const digits = parts ? parts[1].padStart(4, '0') + parts[2].padStart(8, '0') : value.replace(/\s/g, '');
  if (!/^\d{12}$/.test(digits)) throw new GoodreadsError('invalid', 'נדרש דאנאקוד בן 12 ספרות או קוד מו״ל־ספר.', 400);
  return digits;
}
export function daniId(value) {
  if (typeof value === 'string' && /^[1-9]\d{0,11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://www.danibooks.co.il' || url.username || url.password || !['/web/', '/web/default.aspx'].includes(url.pathname) || url.hash || url.searchParams.get('pagetype') !== '9' || [...url.searchParams.keys()].some(key => !['pagetype', 'itemid'].includes(key))) return fail();
    return daniId(url.searchParams.get('itemid'));
  } catch { return fail(); }
}
export const daniUrl = id => 'https://www.danibooks.co.il/web/?pagetype=9&itemid=' + daniId(id);
const unescape = text => text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  if (named[entity]) return named[entity];
  const code = parseInt(entity.slice(entity[2] === 'x' ? 3 : 2, -1), entity[2] === 'x' ? 16 : 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}).replace(/\s+/g, ' ').trim();
export function parseDaniBook(html, id) {
  let product;
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let value; try { value = JSON.parse(match[1]); } catch { continue; }
    for (const item of (Array.isArray(value) ? value : value['@graph'] ?? [value]).slice(0, 100)) if (item && (item['@type'] === 'Product' || Array.isArray(item['@type']) && item['@type'].includes('Product'))) { if (product) return fail(); product = item; }
  }
  if (!product || typeof product.name !== 'string' || !product.name.trim() || product.name.length > 1000 || daniId(product.url) !== daniId(id)) return fail();
  const labels = [...html.matchAll(/aria-label="([^"]{1,1200})"/g)].map(match => unescape(match[1]));
  const field = label => labels.find(text => text.startsWith(label + ' '))?.slice(label.length + 1).trim();
  const dana = field('מק"ט מוצר'); if (!dana) return fail();
  const authors = field('מחבר/ת'), publisher = field('שם יצרן');
  const fields = { title: unescape(product.name), danacode: danaDigits(dana), ...(authors ? { authors: [authors] } : {}), ...(publisher ? { publisher } : {}) };
  return { provider: 'danibooks', recordId: daniId(id), sourceUrl: daniUrl(id), kind: 'edition', fetchedAt: new Date().toISOString(), fields, warnings: [] };
}
