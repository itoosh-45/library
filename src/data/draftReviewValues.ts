import type { DraftReview } from './models';
import { bookFields, emptyInput, type BookInput } from './books';
import { LibraryValidationError } from './library';
import { metadataFields, validateCandidate } from './metadata';
import type { CatalogSelection } from './catalogSave';

const fail = (): never => { throw new LibraryValidationError('ערכי סקירת הפריט אינם תקינים.'); };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(); return value as Record<string, unknown>; }
export function validateReview(value: unknown): DraftReview {
  const row = record(value), keys = ['input', 'catalogs', 'decision', 'targetBookId', 'targetRevision', 'allowDuplicate'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key)) || ![null, 'new', 'copy'].includes(row.decision as null | string) || typeof row.allowDuplicate !== 'boolean') return fail();
  if (row.decision === 'copy' ? !uuid(row.targetBookId) || !Number.isSafeInteger(row.targetRevision) || (row.targetRevision as number) < 1 || row.allowDuplicate : row.targetBookId !== null || row.targetRevision !== null) return fail();
  const input = record(row.input), required = Object.keys(emptyInput), extra = ['shelfIds', 'genreIds', 'tagIds', 'seriesId', 'seriesNumber', 'genreNames', 'price', 'rating'];
  if (required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !required.includes(key) && !extra.includes(key))) return fail();
  for (const key of required.filter(key => key !== 'authors')) if (typeof input[key] !== 'string' || (input[key] as string).length > (key === 'personalNotes' ? 20000 : 1000)) return fail();
  if (!Array.isArray(input.authors) || input.authors.length > 30 || input.authors.some(name => typeof name !== 'string' || name.length > 1000)) return fail();
  for (const key of ['shelfIds', 'genreIds', 'tagIds']) if (input[key] !== undefined && (!Array.isArray(input[key]) || (input[key] as unknown[]).length > 1000 || new Set(input[key] as unknown[]).size !== (input[key] as unknown[]).length || (input[key] as unknown[]).some(id => !uuid(id)))) return fail();
  if (input.seriesId !== undefined && input.seriesId !== null && !uuid(input.seriesId)) return fail();
  if (input.seriesNumber !== undefined && (typeof input.seriesNumber !== 'string' || (input.seriesNumber && (!/^\d+(\.\d+)?$/.test(input.seriesNumber) || +input.seriesNumber > 1000000 || !input.seriesId)))) return fail();
  if (input.price !== undefined && (typeof input.price !== 'string' || input.price.length > 1000)) return fail();
  if (input.genreNames !== undefined && (!Array.isArray(input.genreNames) || input.genreNames.length > 20 || input.genreNames.some(name => typeof name !== 'string' || name.length > 120))) return fail();
  bookFields(input as unknown as BookInput);
  if (!Array.isArray(row.catalogs) || row.catalogs.length > metadataFields.length) return fail();
  const selected = new Set<string>();
  for (const value of row.catalogs) {
    const selection = record(value); if (Object.keys(selection).length !== 2 || !Object.hasOwn(selection, 'candidate') || !Object.hasOwn(selection, 'selected')) return fail();
    const candidate = validateCandidate(selection.candidate), fields = selection.selected;
    if (!Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length || fields.some(field => !metadataFields.includes(field) || candidate.fields[field as keyof typeof candidate.fields] == null || selected.has(field) || (String(field).startsWith('isbn') && [...selected].some(other => other.startsWith('isbn'))))) return fail();
    fields.forEach(field => selected.add(field));
  }
  return structuredClone(row) as unknown as DraftReview;
}
export function emptyReview(): DraftReview { return { input: structuredClone(emptyInput), catalogs: [], decision: null, targetBookId: null, targetRevision: null, allowDuplicate: false }; }
export function reviewWithCatalog(review: DraftReview, input: BookInput, candidate: CatalogSelection['candidate'], fields: CatalogSelection['selected']): DraftReview {
  const group = (field: string) => field.startsWith('isbn') ? 'isbn' : field, replaced = new Set(fields.map(group));
  const catalogs = review.catalogs.map(selection => ({ ...selection, selected: selection.selected.filter(field => !replaced.has(group(field))) })).filter(selection => selection.selected.length);
  return validateReview({ ...review, input, catalogs: [...catalogs, { candidate, selected: fields }] });
}
