import { CatalogError, validateQuery, type CatalogAdapter, type CatalogQuery } from './catalog';
import { catalogServiceRequest } from './goodreads';
import { validateCandidate, type Candidate } from './metadata';
import { comparableISBN, parseISBN } from './books';
export function normalizedDanacode(value: string): string {
  const parts = /^\s*(\d{1,4})\s*-\s*(\d{1,8})\s*$/.exec(value);
  return parts ? parts[1].padStart(4, '0') + parts[2].padStart(8, '0') : value.replace(/\s/g, '');
}
export function exactIdentifierMatch(query: CatalogQuery, candidate: Candidate): boolean {
  if (query.danacode) return typeof candidate.fields.danacode === 'string' && normalizedDanacode(query.danacode) === normalizedDanacode(candidate.fields.danacode);
  if (query.isbn) {
    try { return [candidate.fields.isbn13, candidate.fields.isbn10].some(code => typeof code === 'string' && comparableISBN(parseISBN(code)) === comparableISBN(parseISBN(query.isbn))); } catch { return false; }
  }
  return false;
}
export function danibooksAdapter(fetcher: typeof fetch = fetch): CatalogAdapter {
  const request = catalogServiceRequest(fetcher, 'דני ספרים');
  function reference(value: unknown): Candidate {
    if (!value || typeof value !== 'object') throw new CatalogError('error', 'תשובת דני ספרים אינה תקינה.');
    const row = value as Record<string, unknown>;
    return validateCandidate({ provider: 'danibooks', recordId: row.recordId, sourceUrl: row.sourceUrl, kind: 'edition', fetchedAt: row.fetchedAt ?? new Date().toISOString(), fields: row.fields ?? {}, warnings: row.warnings ?? ['בדוק את הפרטים מול העותק.'] });
  }
  return { provider: 'danibooks', async search(input: CatalogQuery, signal) {
    const query = validateQuery(input), digits = normalizedDanacode(query.danacode);
    if (!/^\d{12}$/.test(digits)) throw new CatalogError('unavailable', 'דני ספרים מחפש לפי דאנאקוד בן 12 ספרות או קוד מו״ל־ספר.');
    const value = await request('/v1/danacode', { query: digits }, signal);
    if (value.provider !== 'danibooks' || !Array.isArray(value.results) || value.results.length > 5) throw new CatalogError('error', 'תוצאות דני ספרים אינן תקינות.');
    return value.results.map(reference);
  }, async resolve(candidate, signal) {
    const value = await request('/v1/danibook', { id: candidate.recordId }, signal);
    if (value.provider !== 'danibooks' || value.recordId !== candidate.recordId) throw new CatalogError('error', 'הספר אינו תואם לבחירה.');
    return reference(value);
  } };
}
