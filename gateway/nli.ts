import { validDay } from '../src/data/loans';
import { normalizedDanacode } from '../src/data/danacode';
import { CatalogError, readCatalogValue, retryAfterMs, validateQuery, type CatalogAdapter } from '../src/data/catalog';
import { parseISBN, comparableISBN } from '../src/data/books';
import { validateCandidate, safeSourceUrl, type Candidate, type FieldValues } from '../src/data/metadata';

const fields = new Set(['title', 'creator', 'publisher', 'date', 'language', 'recordid', 'identifier', 'type', 'isbn']);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('error', 'תשובת הספרייה הלאומית אינה תקינה.');
  return value as Record<string, unknown>;
}
// NLI live JSON-LD shape observed on 2026-10-02: URI properties -> [{ '@value': string }].
// Unknown material types remain general references; they cannot provide edition identifiers/year.
export function normalizeNli(value: unknown, ignoredMaterialFilter = false): Candidate[] {
  if (!Array.isArray(value) || value.length > 20) throw new CatalogError('error', 'מבנה תשובת הספרייה הלאומית אינו נתמך.');
  return value.flatMap(item => {
    const row = record(item), data = new Map<string, string[]>();
    for (const [key, value] of Object.entries(row)) {
      let name = key.toLowerCase();
      if (/^https?:\/\//.test(key)) { try { const uri = new URL(key); if (uri.username || uri.password || uri.search || uri.hash) continue; name = uri.pathname.split('/').filter(Boolean).at(-1)?.toLowerCase() ?? ''; } catch { continue; } }
      if (!fields.has(name)) continue;
      if (data.has(name)) throw new CatalogError('error', 'שדות קטלוג כפולים אינם נתמכים.');
      if (!Array.isArray(value) || value.length > 20) throw new CatalogError('error', 'שדה קטלוג אינו תקין.');
      const values = value.map(entry => record(entry)['@value']);
      if (values.some(value => typeof value !== 'string' || value.length > 1000)) throw new CatalogError('error', 'ערך קטלוג אינו תקין.');
      data.set(name, (values as string[]).map(value => value.trim()).filter(Boolean));
    }
    const one = (name: string) => data.get(name)?.length === 1 ? data.get(name)![0] : undefined;
    const id = one('recordid') ?? one('identifier'); if (!id || id.length > 300) return [];
    const book = ['book', 'books', 'ספר'].includes(one('type')?.toLowerCase() ?? ''), result: FieldValues = {}, warnings: string[] = [];
    const title = one('title'); if (title) result.title = title;
    const creators = data.get('creator'); if (creators?.length) result.authors = [...new Set(creators.map(name => name.split('$$')[0].trim()).filter(Boolean))]; // Contributor is not assumed to be an author.
    if (ignoredMaterialFilter) warnings.push('הספק לא אישר את מסנן סוג החומר; בדוק את הרשומה מול העותק.');
    if (book) {
      const publisher = one('publisher'), language = one('language'), date = one('date');
      if (publisher) result.publisher = publisher;
      if (language) result.language = language;
      if (date && /^\d{4}$/.test(date) && +date >= 1000) result.publicationYear = +date;
      else if (date && /^\d{8}$/.test(date) && validDay(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8))) { result.publicationDate = date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8); result.publicationYear = +date.slice(0,4); }
      else if (date) warnings.push('תאריך הפרסום דורש בדיקה ידנית.');
      const codes = (data.get('isbn') ?? []).flatMap(code => { try { const parsed = parseISBN(code); return [parsed.isbn13 ?? parsed.isbn10!]; } catch { warnings.push('ISBN לא תקין הושמט.'); return []; } });
      if (new Set(codes.map(code => comparableISBN(parseISBN(code)))).size === 1) for (const code of codes) result[code.length === 13 ? 'isbn13' : 'isbn10'] = code;
      else if (codes.length) warnings.push('מזהי ISBN סותרים; בדוק את העותק.');
    } else warnings.push('סוג הרשומה אינו ספר מאומת; מוצגים שם ויוצר בלבד.');
    const source = typeof row['@id'] === 'string' && safeSourceUrl(row['@id']) && new URL(row['@id']).hostname === 'www.nli.org.il' ? row['@id'] : null;
    return [validateCandidate({ provider: 'nli', kind: book ? 'edition' : 'work', recordId: id, sourceUrl: source, fetchedAt: new Date().toISOString(), fields: result, warnings: warnings.slice(0, 10) })];
  });
}

export function nliServerAdapter(key: string, fetcher: typeof fetch = fetch): CatalogAdapter {
  if (!/^[\x21-\x7e]{10,300}$/.test(key)) throw new Error('Invalid server key');
  let stoppedUntil = 0;
  return { provider: 'nli', async search(input, signal) {
    const query = validateQuery(input);
    const identifier = query.danacode ? normalizedDanacode(query.danacode) : query.isbn ? (parseISBN(query.isbn).isbn13 ?? parseISBN(query.isbn).isbn10!) : '';
    if (query.danacode && !/^\d{12}$/.test(identifier)) throw new CatalogError('unavailable', 'נדרש דאנאקוד בן 12 ספרות או קוד מו״ל־ספר.');
    const terms = [['title', query.title], ['creator', query.author], ['publisher', query.publisher], ['start_date', query.year]].filter(([, value]) => value);
    if (terms.some(([, value]) => value.length < 3 || /[,;]/.test(value))) throw new CatalogError('unavailable', 'החיפוש דורש לפחות שלושה תווים ללא פסיק או נקודה־פסיק.');
    if (Date.now() < stoppedUntil) throw new CatalogError('rate-limited', 'הספרייה הלאומית ביקשה להמתין.');
    const url = new URL('https://api.nli.org.il/openlibrary/search');
    // material_type=books was ignored with code 1010 in the observed live response. Filter locally by explicit type.
    url.search = new URLSearchParams({ api_key: key, query: identifier ? `any,exact,${identifier}` : terms.map(([field, value]) => `${field},contains,${value}`).join(',AND;'), output_format: 'json', items_per_page: '5', result_page: '1' }).toString().replace(/\+/g, '%20');
    const response = await fetcher(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json', 'User-Agent': 'Library-App/0.25.1 (+https://github.com/itoosh-45/library)' } });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) { const wait = retryAfterMs(response.headers); stoppedUntil = Date.now() + wait; throw new CatalogError('rate-limited', 'הספרייה הלאומית ביקשה להמתין.', wait); }
      throw new CatalogError('error', 'הספרייה הלאומית אינה זמינה כרגע.');
    }
    // An ignored search condition can return unrelated records. Stop rather than quietly broaden the query.
    if (response.headers.has('Errors')) { await response.body?.cancel(); throw new CatalogError('error', 'הספרייה הלאומית לא אישרה את כל תנאי החיפוש.'); }
    const payload = await readCatalogValue(response);
    if (JSON.stringify(payload).includes(key)) throw new CatalogError('error', 'תגובת הספרייה הלאומית אינה תקינה.');
    return normalizeNli(payload);
  } };
}
