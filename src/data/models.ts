export type ReadStatus = 'unread' | 'reading' | 'read' | 'abandoned' | 'want-to-read';
export interface Book {
  id: string; title: string | null; subtitle: string | null; authorIds: string[];
  isbn10: string | null; isbn13: string | null; danacode: string | null;
  publisher: string | null; publicationYear: number | null; edition: string | null;
  volume: string | null; language: string | null; pages: number | null;
  seriesId: string | null; seriesNumber: number | null; genreIds: string[]; tagIds: string[];
  rating?: number | null; readStatus: ReadStatus; personalNotes: string | null; primaryImageId: string | null;
  createdAt: string; updatedAt: string; revision: number; titleSortKey: string;
}
export interface Copy {
  id: string; bookId: string; label: string | null; purchasePriceMinor: number | null;
  currency: string | null; notes: string | null; archivedAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface Author { id: string; displayName: string; givenName: string | null; familyName: string | null; normalizedName: string }
export interface Shelf { id: string; name: string; parentId: string | null; imageId: string | null; sortOrder: number; createdAt: string; updatedAt: string }
export interface BookShelf { id: string; bookId: string; shelfId: string }
export interface NamedItem { id: string; name: string; normalizedName: string }
export interface Series extends NamedItem { collapsed: boolean }
export interface Person extends NamedItem { archivedAt: string | null }
export interface Loan { id: string; copyId: string; personId: string; borrowedAt: string; expectedReturnOn: string | null; returnedAt: string | null; openFlag: 0 | 1; notes: string | null; createdAt: string; updatedAt: string }
export interface StoredImage { id: string; blob: Blob; mimeType: string; width: number; height: number; byteLength: number; sha256: string; sourceUrl: string | null; createdAt: string }
export type SettingKey = 'libraryId' | 'libraryName' | 'displayMode' | 'preferredModel' | 'lastBackupAt' | 'lastBackupCheckedAt';
export interface Setting { key: SettingKey; value: string }
export type MetadataField = 'title' | 'subtitle' | 'authors' | 'isbn10' | 'isbn13' | 'danacode' | 'publisher' | 'publicationYear' | 'edition' | 'volume' | 'language' | 'pages';
export interface MetadataSource { id: string; bookId: string; provider: string; recordId: string; sourceUrl: string | null; fetchedAt: string; fieldValues: Partial<Record<MetadataField, string | number | string[] | null>>; selectedFields: MetadataField[]; userOverriddenFields: MetadataField[]; recognition?: { version: string; model: string; imageHash: string; item: import('./recognition').RecognizedBook; batchId?: string; itemId?: string } }
export interface MetadataCache { key: string; provider: string; fetchedAt: string; expiresAt: string; minimalPayload: MetadataSource['fieldValues'][]; candidates?: { provider: string; recordId: string; sourceUrl: string | null; fetchedAt: string; kind: 'work' | 'edition' | 'volume'; fields: MetadataSource['fieldValues']; warnings: string[] }[] }
export interface DraftImage {
  id: string; name: string; inputHash: string; storedImageId: string | null; preparedHash: string | null;
  status: 'pending' | 'processing' | 'recognized' | 'error' | 'interrupted';
  message: string | null;
}
export interface DraftItem {
  id: string; imageId: string; item: import('./recognition').RecognizedBook; model: string; fetchedAt: string;
  status: 'detected' | 'reviewed' | 'approved' | 'saved' | 'removed';
  selectedFields: import('./recognition').RecognitionField[];
  bookId: string | null; copyId: string | null;
  review?: DraftReview;
}
export interface DraftReview {
  input: import('./books').BookInput; catalogs: import('./catalogSave').CatalogSelection[];
  decision: 'new' | 'copy' | null; targetBookId: string | null; targetRevision: number | null; allowDuplicate: boolean;
}
export interface RecognitionDraft {
  id: string; batchId: string; version: 'shelf-v1'; shelfId: string | null; images: DraftImage[]; items: DraftItem[];
  status: 'paused' | 'running' | 'quota' | 'complete'; runId: string | null; updatedAt: string; revision: number;
}
