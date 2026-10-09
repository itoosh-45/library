import { GoodreadsError } from './model.mjs';

const origin = 'https://infocenters.co.il';
const base = origin + '/icl/';
const fail = () => { throw new GoodreadsError('source-changed', 'מבנה הקטלוג הישראלי אינו מוכר.'); };
const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
  if (named[entity]) return named[entity];
  const code = parseInt(entity.slice(entity[2]?.toLowerCase() === 'x' ? 3 : 2, -1), entity[2]?.toLowerCase() === 'x' ? 16 : 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
});
const text = value => decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export function iclId(id) { if (typeof id !== 'string' || !/^[1-9]\d{0,11}$/.test(id)) return fail(); return id; }
export const iclUrl = id => base + 'notebook_ext.asp?book=' + iclId(id) + '&lang=heb&site=icl';
export function iclCoverUrl(value) {
  try { const url = new URL(value, base); if (url.origin !== origin || url.username || url.password || url.search || url.hash || !/^\/icl\/multimedia\/\d{4}\/\d{1,2}\/\d{1,2}\/[\w-]+f\.(?:jpg|jpeg|png)$/i.test(url.pathname)) return undefined; return url.href; } catch { return undefined; }
}
const candidate = (id, fields, coverUrl) => ({ provider: 'icl', recordId: iclId(id), sourceUrl: iclUrl(id), fetchedAt: new Date().toISOString(), kind: 'edition', fields, warnings: ['בדוק את המהדורה מול הספר.'], ...(coverUrl ? { coverUrl } : {}) });
export function parseIclSearch(html) {
  const results = [];
  // The site's link attributes contain literal XML; match quoted values, never execute its scripts.
  for (const match of html.matchAll(/<td\b[^>]*id="element\d+"[^>]*>([\s\S]*?)<\/td>/gi)) {
    const section = match[1], link = /href="(notebook\.asp\?[^"]+)"[^>]*><span\b[^>]*>([\s\S]*?)<\/span>/i.exec(section);
    if (!link) continue;
    const id = /<book_id>([1-9]\d{0,11})<\/>/.exec(decode(link[1]))?.[1];
    if (!id) continue;
    const fields = { title: text(link[2]) };
    for (const row of section.matchAll(/<p\b[^>]*>([^<]+):\s*<span\b[^>]*>([\s\S]*?)<\/span>/gi)) {
      const label = text(row[1]), value = text(row[2]);
      if (label === 'מחבר' && value) fields.authors = [value];
      if (label === 'מוציא לאור' && value) fields.publisher = value;
      if (label === 'שנה לועזית' && /^[1-9]\d{3}$/.test(value)) fields.publicationYear = +value;
    }
    const before = html.slice(Math.max(0, html.lastIndexOf('<table', match.index)), match.index);
    const images = [...before.matchAll(/href="(multimedia\/[^"]+)"/gi)];
    const coverUrl = iclCoverUrl(images.at(-1)?.[1]);
    results.push(candidate(id, fields, coverUrl));
    if (results.length === 10) break;
  }
  if (!results.length && !/תוצאות|לא נמצאו|אין תוצאות/.test(html)) return fail();
  if (/לא נבחר מאגר|role="alert"/.test(html) && !results.length && !/לא נמצאו|אין תוצאות/.test(html)) return fail();
  return results;
}
export function parseIclBook(html, id) {
  if (!html.includes('<book_id>' + iclId(id) + '</>')) return fail();
  const fields = {}, authors = [];
  const item = html.split('<div id="item">')[1]?.split('</tbody>')[0];
  if (!item) return fail();
  for (const row of item.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const label = /<td class="strong">([\s\S]*?)<\/td>/.exec(row[1]);
    const value = /<td><span\b[^>]*>([\s\S]*?)<\/span>/.exec(row[1]);
    if (!label || !value) continue;
    const key = text(label[1]), content = text(value[1]);
    if (!content || content.length > 1000) continue;
    if (key === 'מחבר') authors.push(content);
    const names = { 'כותר': 'title', 'מוציא לאור': 'publisher', 'מספר דנה קוד': 'danacode', 'שפה': 'language', 'מהדורה': 'edition', 'סוג כריכה': 'binding' };
    if (names[key]) fields[names[key]] = content;
    if (key === 'שנה לועזית' && /^[1-9]\d{3}$/.test(content)) fields.publicationYear = +content;
    if (key === 'מספר עמודים' && /^[1-9]\d{0,4}$/.test(content)) fields.pages = +content;
    const isbn = content.replace(/[\s-]/g, '').toUpperCase();
    if (/מסת/.test(key) && /^97[89]\d{10}$/.test(isbn) && [...isbn].reduce((sum, digit, index) => sum + +digit * (index % 2 ? 3 : 1), 0) % 10 === 0) fields.isbn13 = isbn;
    if (/מסת/.test(key) && /^\d{9}[\dX]$/.test(isbn) && [...isbn].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : +digit) * (10 - index), 0) % 11 === 0) fields.isbn10 = isbn;
  }
  if (!fields.title) return fail();
  if (authors.length) fields.authors = [...new Set(authors)].slice(0, 20);
  const cover = /class="main_image"[^>]*href="([^"]+)"/i.exec(html)?.[1];
  return candidate(id, fields, iclCoverUrl(cover));
}
export function iclSearchForm(html, terms) {
  if (typeof terms !== 'string' || !terms.trim() || terms.length > 300 || [...terms].some(char => char.charCodeAt(0) < 32)) throw new GoodreadsError('invalid', 'חיפוש אינו תקין.', 400);
  const context = /htmldw\.context\s*=\s*"([^"\r\n]+)"/.exec(html)?.[1];
  const rowId = /htmldw\.rows\[0\]\s*=\s*new HTDW_RowClass\(\s*"([^"\r\n]+)"/.exec(html)?.[1];
  const column = /htmldw\.cols\[(\d+)\]\s*=\s*new HTDW_ColumnClass\(\d+, 'get_var'/.exec(html)?.[1];
  const form = /<FORM\s+NAME="htmldw_submitForm"[^>]*>([\s\S]*?)<\/FORM>/i.exec(html)?.[1];
  if (!context || !rowId || !column || !form) return fail();
  const body = new URLSearchParams();
  for (const input of form.matchAll(/<INPUT\s+TYPE="hidden"\s+NAME="([\w_]+)"\s+VALUE="([^"]*)"/gi)) body.set(input[1], decode(input[2]));
  const escape = value => value.replace(/["']/g, char => '~' + char);
  body.set('htmldw_action', 'Update');
  body.set('htmldw_context', context + `((ModifyRow 0 ${rowId} ((${column} 0 '${escape(terms)}')))(row 0))`);
  return body;
}
export function createIclCatalog(fetcher = fetch) {
  async function request(url, signal, init = {}) {
    // IDEA's legacy renderer omits the form data unless it recognizes this compatibility token.
    const response = await fetcher(url, { ...init, signal, redirect: 'error', headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) ItooshLibrary/1.0 (+https://github.com/itoosh-45/library)', ...init.headers } });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !response.body) { await response.body?.cancel(); throw new GoodreadsError('unavailable', 'הקטלוג הישראלי לא ענה.'); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2 * 1024 * 1024) return fail(); chunks.push(Buffer.from(part.value)); } } finally { await reader.cancel().catch(() => {}); }
    return { html: Buffer.concat(chunks).toString('utf8'), cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
  }
  return {
    async search(query, signal) {
      if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !['title','author','publisher','year','isbn','danacode'].includes(key)) || Object.values(query).some(value => typeof value !== 'string' || value.length > 300)) throw new GoodreadsError('invalid', 'חיפוש אינו תקין.', 400);
      const terms = query.isbn || query.danacode || query.title || query.author || query.publisher;
      const kind = query.isbn || query.danacode ? 'global' : 'simple';
      // This legacy site treats an encoded slash inside its XML parameter differently.
      const page = await request(base + `search.asp?lang=HEB&dlang=HEB&module=search&page=criteria&rsvr=all&param=%3Cuppernav%3E${kind}%3C/%3E&param2=&site=icl`, signal);
      // For author-only or publisher-only queries, select the observed field column.
      let html = page.html;
      if (kind === 'simple' && !query.title) {
        const selected = query.author ? 'AU' : 'PB';
        html = html.replace(/\(46 0 'TI'\)/g, `(46 0 '${selected}')`).replace(/\(58 0 'Y'\)/g, "(58 0 'N')").replace(selected === 'AU' ? /\(59 0 'N'\)/g : /\(60 0 'N'\)/g, selected === 'AU' ? "(59 0 'Y')" : "(60 0 'Y')");
      }
      const result = await request(base + 'list.asp', signal, { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded; charset=utf-8', ...(page.cookie ? { Cookie: page.cookie } : {}) }, body:iclSearchForm(html, terms).toString() });
      return { provider:'icl', results:parseIclSearch(result.html) };
    },
    async resolve(id, signal) { const result = await request(iclUrl(id), signal); return parseIclBook(result.html, id); },
  };
}
