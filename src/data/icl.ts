import { CatalogError, validateQuery, type CatalogAdapter } from './catalog';
import { catalogServiceRequest } from './goodreads';
import { validateCandidate, type Candidate } from './metadata';

export function iclAdapter(fetcher: typeof fetch = fetch): CatalogAdapter {
  const request = catalogServiceRequest(fetcher, 'הקטלוג הישראלי', 0);
  const candidate = (value: unknown): Candidate => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('error', 'תשובת הקטלוג הישראלי אינה תקינה.');
    const result = validateCandidate(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'cached')));
    if (result.provider !== 'icl') throw new CatalogError('error', 'מקור התוצאה אינו תואם לקטלוג הישראלי.');
    return result;
  };
  return { provider: 'icl', async search(input, signal) {
    const query = validateQuery(input), value = await request('/v1/icl-search', { query }, signal);
    if (value.provider !== 'icl' || !Array.isArray(value.results) || value.results.length > 10) throw new CatalogError('error', 'תוצאות הקטלוג הישראלי אינן תקינות.');
    return value.results.map(candidate);
  }, async resolve(value, signal) {
    const result = candidate(await request('/v1/icl-book', { id: value.recordId }, signal));
    if (result.recordId !== value.recordId) throw new CatalogError('error', 'הספר אינו תואם לבחירה.');
    return result;
  } };
}
