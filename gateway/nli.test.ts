import { expect, it, vi } from 'vitest';
import { normalizeNli, nliServerAdapter } from './nli';
import { emptyQuery } from '../src/data/catalog';

const entry = (values: Record<string, string | string[]>) => Object.fromEntries(Object.entries(values).map(([field, value]) => ['http://purl.org/dc/elements/1.1/' + field, (Array.isArray(value) ? value : [value]).map(value => ({ '@value': value }))]));
const book = entry({ recordid: 'synthetic-1', title: 'ספר סינתטי', type: 'books', creator: ['מחבר אחד', 'מחבר שני'], contributor: 'מתרגם', publisher: 'הוצאה סינתטית', date: '2001', isbn: ['0140328726', '9780140328721'], language: 'heb' });
it('NLI observed JSON-LD shape maps explicit books only; unknown material is a general reference, not an edition', () => {
  const mapped = normalizeNli([book], true)[0]; expect(mapped.kind).toBe('edition'); expect(mapped.fields).toEqual({ title: 'ספר סינתטי', authors: ['מחבר אחד', 'מחבר שני'], publisher: 'הוצאה סינתטית', publicationYear: 2001, isbn10: '0140328726', isbn13: '9780140328721', language: 'heb' }); expect(mapped.sourceUrl).toBeNull(); expect(mapped.warnings).toHaveLength(1);
  const unknown = normalizeNli([entry({ recordid: 'synthetic-2', title: 'רשומה כללית', type: 'map', isbn: '9780140328721', date: '2001', publisher: 'הוצאה' })])[0]; expect(unknown.kind).toBe('work'); expect(unknown.fields).toEqual({ title: 'רשומה כללית' });
  expect(normalizeNli([entry({ title: 'חסר מזהה' })])).toEqual([]);
});
it('NLI contradictory identifiers, ambiguous dates and namespace collisions cannot invent or overwrite edition facts', () => {
  const rows = normalizeNli([entry({ recordid: 'synthetic-1', title: 'ספר', type: 'book', date: '2001?', isbn: ['9780140328721', '9780306406157'] })]); expect(rows[0].fields).toEqual({ title: 'ספר' }); expect(rows[0].warnings).toHaveLength(2);
  expect(() => normalizeNli([{ ...book, title: [{ '@value': 'שם סותר' }] }])).toThrow('כפולים'); expect(() => normalizeNli([{ ...book, title: 'לא מערך' }])).toThrow();
});
it('NLI server fixes target/query, rejects unverified identifiers and syntax, and does not accept silently ignored conditions', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([book]))), adapter = nliServerAdapter('SECRET-CANARY-KEY', fetcher), signal = new AbortController().signal;
  await expect(adapter.search({ ...emptyQuery, title: 'ספר סינתטי', author: 'מחבר' }, signal)).resolves.toHaveLength(1);
  const [target, options] = fetcher.mock.calls[0], url = new URL(String(target)); expect(url.origin + url.pathname).toBe('https://api.nli.org.il/openlibrary/search'); expect(url.searchParams.get('query')).toBe('title,contains,ספר סינתטי,AND;creator,contains,מחבר'); expect(url.searchParams.has('material_type')).toBe(false); expect(options).toMatchObject({ redirect: 'error', credentials: 'omit' });
  for (const query of [{ ...emptyQuery, title: 'ab' }, { ...emptyQuery, title: 'ספר,AND;evil' }, { ...emptyQuery, danacode: '00123' }]) await expect(adapter.search(query, signal)).rejects.toMatchObject({ state: 'unavailable' }); expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValue(new Response(JSON.stringify([book]), { headers: { Errors: '{"Errors":[{"code":1010}]}' } })); await expect(adapter.search({ ...emptyQuery, title: 'ספר' }, signal)).rejects.toThrow('תנאי');
  fetcher.mockResolvedValue(new Response(JSON.stringify([entry({ recordid: 'synthetic', title: 'SECRET-CANARY-KEY', type: 'books' })]))); await expect(adapter.search({ ...emptyQuery, title: 'ספר' }, signal)).rejects.toThrow('תקינה');
});

it('NLI authentic client maps live date format and strips authority suffixes without guessing identifiers', async()=>{
 const row=entry({recordid:'synthetic-date',type:'book',title:'ספר',creator:'מחבר$$Qauthor authority',date:'20240229'});
 expect(normalizeNli([row])[0].fields).toMatchObject({authors:['מחבר'],publicationYear:2024,publicationDate:'2024-02-29'});
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json([])),adapter=nliServerAdapter('SYNTHETIC-NLI-KEY-NEVER-LIVE',fetcher);
 await adapter.search({...emptyQuery,danacode:'674-2621'},new AbortController().signal);
 const [url,init]=fetcher.mock.calls[0];expect(new URL(String(url)).searchParams.get('query')).toBe('any,exact,067400002621');expect(init?.headers).toMatchObject({'User-Agent':'Library-App/0.25.1 (+https://github.com/itoosh-45/library)',Accept:'application/json'});
 expect(normalizeNli([row])[0].fields.danacode).toBeUndefined();
});
