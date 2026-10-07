import type { LibraryDatabase } from './database';
import type { Book, MetadataField, MetadataSource, StoredImage } from './models';
import { saveBook, type BookInput } from './books';
import { validateCandidate, validateMetadataSource, metadataFields, type Candidate, type FieldValues } from './metadata';
import { LibraryValidationError } from './library';
import { emptyInput } from './books';
import { recognitionModels, recognitionInput, recognitionMetadataFields, recognitionValues, recognitionVersion, validateRecognition, type RecognizedBook, type RecognitionField } from './recognition';

export function inputFieldValue(input: BookInput, field: MetadataField): FieldValues[MetadataField] {
  if (field === 'authors') return input.authors.map(name => name.trim()).filter(Boolean);
  if (field === 'isbn10' || field === 'isbn13') return input.isbn.replace(/[\s-]/g, '').toUpperCase() || null;
  if (field === 'publicationYear' || field === 'pages') return input[field].trim() ? +input[field] : null;
  return input[field]?.trim() || null;
}
export function applyCatalogCandidate(input: BookInput, candidate: Candidate) {
  validateCandidate(candidate);
  const fields = metadataFields.filter(field => candidate.fields[field] != null && !(field === 'isbn10' && candidate.fields.isbn13));
  const draft = { ...input, ...(candidate.genres?.length ? { genreNames: [...candidate.genres] } : {}) };
  for (const field of fields) {
    const value = candidate.fields[field];
    if (field === 'authors') { draft.authors = [...value as string[]]; delete draft.authorParts; }
    else if (field === 'isbn10' || field === 'isbn13') draft.isbn = String(value);
    else draft[field] = String(value);
  }
  return { draft, fields };
}
export async function saveCatalogBook(database: LibraryDatabase, input: BookInput, candidate: Candidate, selected: MetadataField[], existing?: Book, allowDuplicate = false): Promise<Book> {
  return saveCatalogSelections(database, input, [{ candidate, selected }], existing, undefined, allowDuplicate);
}
export interface CatalogSelection { candidate: Candidate; selected: MetadataField[] }
export interface RecognitionSelection { item: RecognizedBook; selected: RecognitionField[]; model: string; imageHash: string; fetchedAt: string }
export async function saveBookSelections(database: LibraryDatabase, input: BookInput, catalogs: CatalogSelection[], recognition: RecognitionSelection[], existing?: Book, image?: StoredImage | null, allowDuplicate = false): Promise<Book> {
  if (recognition.length > metadataFields.length) throw new LibraryValidationError('בחירת מקורות הזיהוי אינה תקינה.');
  const used = new Set(catalogs.flatMap(selection => selection.selected));
  const sources = recognition.map(selection => {
    const item = validateRecognition({ items: [selection.item] }).items[0]; recognitionInput(emptyInput, item, selection.selected);
    const fields = recognitionValues(item), selected = recognitionMetadataFields(item, selection.selected);
    if (selected.some(field => used.has(field) || (field.startsWith('isbn') && [...used].some(other => other.startsWith('isbn'))))) throw new LibraryValidationError('בחר מקור אחד לכל שדה.'); selected.forEach(field => used.add(field));
    const source: MetadataSource = { id: crypto.randomUUID(), bookId: 'pending', provider: selection.model === recognitionModels.groq ? 'groq' : selection.model === recognitionModels.ocr ? 'ocr' : 'gemini', recordId: `${selection.model}/${recognitionVersion}/${selection.imageHash}`, sourceUrl: null, fetchedAt: selection.fetchedAt, fieldValues: fields, selectedFields: selected, userOverriddenFields: selected.filter(field => JSON.stringify(inputFieldValue(input, field)) !== JSON.stringify(fields[field])), recognition: { version: recognitionVersion, model: selection.model, imageHash: selection.imageHash, item } };
    validateMetadataSource(source); return source;
  });
  return database.transaction('rw', database.tables, async () => {
    const book = catalogs.length ? await saveCatalogSelections(database, input, catalogs, existing, image, allowDuplicate) : await saveBook(database, input, existing, image, allowDuplicate);
    for (const source of sources) await database.metadataSources.add({ ...source, bookId: book.id }); return book;
  });
}
export async function saveCatalogSelections(database: LibraryDatabase, input: BookInput, selections: CatalogSelection[], existing?: Book, image?: StoredImage | null, allowDuplicate = false): Promise<Book> {
  if (!Array.isArray(selections) || !selections.length || selections.length > metadataFields.length) throw new LibraryValidationError('בחירת המקורות אינה תקינה.');
  const allFields = new Set<MetadataField>();
  for (const { candidate, selected } of selections) {
    validateCandidate(candidate);
    if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(field => !metadataFields.includes(field) || !Object.hasOwn(candidate.fields, field) || candidate.fields[field] == null || allFields.has(field))) throw new LibraryValidationError('בחר לפחות שדה אחד ממקור הקטלוג, ומקור אחד לכל שדה.');
    selected.forEach(field => allFields.add(field));
  }
  return database.transaction('rw', database.tables, async () => {
    const book = await saveBook(database, input, existing, image, allowDuplicate);
    for (const { candidate, selected } of selections) {
      const source: MetadataSource = { id: crypto.randomUUID(), bookId: book.id, provider: candidate.provider, recordId: candidate.recordId, sourceUrl: candidate.sourceUrl, fetchedAt: candidate.fetchedAt, fieldValues: structuredClone(candidate.fields), selectedFields: [...selected], userOverriddenFields: selected.filter(field => JSON.stringify(inputFieldValue(input, field)) !== JSON.stringify(candidate.fields[field])) };
      validateMetadataSource(source); await database.metadataSources.add(source);
    }
    return book;
  });
}
