import type { LibraryDatabase } from './database';
import type { Book, MetadataField, MetadataSource, StoredImage } from './models';
import { saveBook, type BookInput } from './books';
import { validateCandidate, validateMetadataSource, metadataFields, type Candidate, type FieldValues } from './metadata';
import { LibraryValidationError } from './library';

export function inputFieldValue(input: BookInput, field: MetadataField): FieldValues[MetadataField] {
  if (field === 'authors') return input.authors.map(name => name.trim()).filter(Boolean);
  if (field === 'isbn10' || field === 'isbn13') return input.isbn.replace(/[\s-]/g, '').toUpperCase() || null;
  if (field === 'publicationYear' || field === 'pages') return input[field].trim() ? +input[field] : null;
  return input[field].trim() || null;
}
export async function saveCatalogBook(database: LibraryDatabase, input: BookInput, candidate: Candidate, selected: MetadataField[], existing?: Book, allowDuplicate = false): Promise<Book> {
  return saveCatalogSelections(database, input, [{ candidate, selected }], existing, undefined, allowDuplicate);
}
export interface CatalogSelection { candidate: Candidate; selected: MetadataField[] }
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
