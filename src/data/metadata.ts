import { safeCatalogCoverUrl } from './catalogCoverUrl';
import type { MetadataField, MetadataSource } from './models';
import { LibraryValidationError } from './library';
import { comparableISBN, parseISBN } from './books';
import { validDay } from './loans';
import { recognitionModels, recognitionVersion, recognitionValues, shelfRecognitionVersion, validateRecognition } from './recognition';

export const metadataFields: MetadataField[] = ['title', 'subtitle', 'authors', 'isbn10', 'isbn13', 'danacode', 'publisher', 'publicationYear', 'publicationDate', 'binding', 'edition', 'volume', 'language', 'pages'];
export const providerNames = { openlibrary: 'Open Library', googlebooks: 'Google Books', nli: 'הספרייה הלאומית' } as const;
export type Provider = keyof typeof providerNames;
export type FieldValues = MetadataSource['fieldValues'];
export interface Candidate { provider: Provider; recordId: string; sourceUrl: string | null; fetchedAt: string; kind: 'work' | 'edition' | 'volume'; fields: FieldValues; warnings: string[]; coverUrl?: string; genres?: string[] }
const fail = (): never => { throw new LibraryValidationError('נתוני מקור הקטלוג אינם תקינים.'); };
const utcDate = (value: unknown): boolean => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(); return value as Record<string, unknown>; };
export const isProvider = (value: unknown): value is Provider => typeof value === 'string' && Object.hasOwn(providerNames, value);
export function safeSourceUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 1000) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && ['openlibrary.org', 'books.google.com', 'www.nli.org.il'].includes(url.hostname) && ![...url.searchParams.keys()].some(key => /key|token|secret/i.test(key)); } catch { return false; }
}
function matchesProvider(provider: Provider, value: string | null): boolean {
  return value === null || new URL(value).hostname === ({ openlibrary: 'openlibrary.org', googlebooks: 'books.google.com', nli: 'www.nli.org.il' })[provider];
}
export function validateFieldValues(value: unknown): FieldValues {
  const fields = record(value);
  for (const [key, item] of Object.entries(fields)) {
    if (!metadataFields.includes(key as MetadataField)) return fail();
    if (item === null) continue;
    if (key === 'authors') { if (!Array.isArray(item) || item.length > 20 || item.some(name => typeof name !== 'string' || !name.trim() || name.length > 1000)) return fail(); }
    else if (key === 'publicationYear' || key === 'pages') { if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > (key === 'pages' ? 100000 : 9999)) return fail(); }
    else if (typeof item !== 'string' || !item.trim() || item.length > 1000) return fail();
    if ((key === 'isbn10' || key === 'isbn13') && parseISBN(item as string)[key] !== item) return fail();
    if (key === 'publicationDate' && !validDay(item)) return fail();
  }
  if (fields.isbn10 && fields.isbn13 && comparableISBN({ isbn10: fields.isbn10 as string, isbn13: null }) !== fields.isbn13) return fail();
  return fields as FieldValues;
}
export function validateCandidate(value: unknown): Candidate {
  const row = record(value), keys = ['provider', 'recordId', 'sourceUrl', 'fetchedAt', 'kind', 'fields', 'warnings', ...(Object.hasOwn(row, 'coverUrl') ? ['coverUrl'] : []), ...(Object.hasOwn(row, 'genres') ? ['genres'] : [])];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key)) || !isProvider(row.provider) || typeof row.recordId !== 'string' || !row.recordId || row.recordId.length > 300 || !safeSourceUrl(row.sourceUrl) || !utcDate(row.fetchedAt) || !['work', 'edition', 'volume'].includes(row.kind as string) || !Array.isArray(row.warnings) || row.warnings.length > 10 || row.warnings.some(item => typeof item !== 'string' || item.length > 300)) return fail();
  if (Object.hasOwn(row, 'coverUrl') && !safeCatalogCoverUrl(row.coverUrl, row.provider as string)) return fail();
  if (Object.hasOwn(row, 'genres') && (!Array.isArray(row.genres) || row.genres.length > 20 || row.genres.some(name => typeof name !== 'string' || !name.trim() || name.length > 120))) return fail();
  validateFieldValues(row.fields);
  if (!matchesProvider(row.provider, row.sourceUrl)) return fail();
  if (row.kind === 'work' && ['isbn10', 'isbn13', 'publicationYear', 'publicationDate', 'binding', 'pages', 'publisher', 'edition', 'volume'].some(key => (row.fields as FieldValues)[key as MetadataField] != null)) return fail();
  return row as unknown as Candidate;
}
export function validateMetadataSource(value: unknown): MetadataSource {
  const row = record(value), vision = ['gemini','groq','ocr'].includes(String(row.provider)), keys = ['id', 'bookId', 'provider', 'recordId', 'sourceUrl', 'fetchedAt', 'fieldValues', 'selectedFields', 'userOverriddenFields', ...(vision ? ['recognition'] : [])];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key)) || (!vision && !isProvider(row.provider)) || typeof row.recordId !== 'string' || !row.recordId || row.recordId.length > 300 || !safeSourceUrl(row.sourceUrl) || !utcDate(row.fetchedAt)) return fail();
  const fields = validateFieldValues(row.fieldValues);
  if (vision) {
    const evidence = record(row.recognition);
    const batch = evidence.version === shelfRecognitionVersion, evidenceKeys = ['version', 'model', 'imageHash', 'item', ...(batch ? ['batchId', 'itemId'] : [])];
    const uuid = (value: unknown) => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
    if (Object.keys(evidence).length !== evidenceKeys.length || Object.keys(evidence).some(key => !evidenceKeys.includes(key)) || (!batch && evidence.version !== recognitionVersion) || (batch && (!uuid(evidence.batchId) || !uuid(evidence.itemId))) || !Object.values(recognitionModels).includes(evidence.model as never) || typeof evidence.imageHash !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.imageHash) || row.sourceUrl !== null || row.recordId !== `${evidence.model}/${evidence.version}/${evidence.imageHash}${batch ? '/' + evidence.itemId : ''}`) return fail();
    if (row.provider !== (evidence.model === recognitionModels.groq ? 'groq' : evidence.model === recognitionModels.ocr ? 'ocr' : 'gemini')) return fail();
    const item = validateRecognition({ items: [evidence.item] }).items[0], expected = recognitionValues(item);
    if (Object.keys(expected).length !== Object.keys(fields).length || metadataFields.some(field => JSON.stringify(expected[field]) !== JSON.stringify(fields[field]))) return fail();
  } else if (!matchesProvider(row.provider as Provider, row.sourceUrl)) return fail();
  for (const key of ['selectedFields', 'userOverriddenFields']) {
    const selected = row[key];
    if (!Array.isArray(selected) || selected.length > metadataFields.length || new Set(selected).size !== selected.length || selected.some(field => !metadataFields.includes(field) || !Object.hasOwn(fields, field) || fields[field as MetadataField] == null)) return fail();
  }
  if ((row.userOverriddenFields as MetadataField[]).some(field => !(row.selectedFields as MetadataField[]).includes(field))) return fail();
  if (!(row.selectedFields as MetadataField[]).length && !(vision && (row.recognition as MetadataSource['recognition'])?.version === shelfRecognitionVersion)) return fail();
  return row as unknown as MetadataSource;
}
