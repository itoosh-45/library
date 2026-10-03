import { LibraryValidationError } from './library';

export const MAX_BACKUP_BYTES = 150 * 1024 * 1024;

export function fullEnvelope(legacy: { data: object & { images: unknown[] }; appVersion: string; libraryId: string; exportedAt: string; counts: object; checksum: string }) {
  const { images, ...tables } = legacy.data;
  return { format: 'my-library-backup', formatVersion: 'books' in tables && Array.isArray(tables.books) && tables.books.some(book => Object.hasOwn(book, 'rating')) ? 9 : 8, dbSchemaVersion: 2, appVersion: legacy.appVersion,
    libraryId: legacy.libraryId, exportedAt: legacy.exportedAt, tables, images, manifestCounts: legacy.counts,
    checksums: { payload: legacy.checksum } };
}

// v1–v7 stay readable; v8 uses the full envelope specified in the project book.
export function legacyEnvelope(input: unknown): unknown {
  if (!input || typeof input !== 'object' || !('format' in input) || input.format !== 'my-library-backup') return input;
  const root = input as Record<string, unknown>;
  const keys = ['format', 'formatVersion', 'dbSchemaVersion', 'appVersion', 'libraryId', 'exportedAt', 'tables', 'images', 'manifestCounts', 'checksums'];
  const fail = (): never => { throw new LibraryValidationError('פורמט או בדיקת שלמות הגיבוי אינם תקינים. הספרייה לא שונתה.'); };
  if (Object.keys(root).length !== keys.length || Object.keys(root).some(key => !keys.includes(key)) || ![8, 9].includes(root.formatVersion as number) || root.dbSchemaVersion !== 2) return fail();
  if (!root.tables || typeof root.tables !== 'object' || Array.isArray(root.tables) || Object.hasOwn(root.tables, 'images') || !Array.isArray(root.images)) return fail();
  const checksums = root.checksums as Record<string, unknown> | null;
  if (!checksums || typeof checksums !== 'object' || Object.keys(checksums).length !== 1 || typeof checksums.payload !== 'string') return fail();
  const data = { ...root.tables, images: root.images };
  // The canonical validator checks this payload hash once, together with all tables and images.
  return { format: 'personal-library-basic', version: 7, schemaVersion: 2, appVersion: root.appVersion, libraryId: root.libraryId, exportedAt: root.exportedAt, counts: root.manifestCounts, checksum: checksums.payload, data };
}
