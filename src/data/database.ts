import Dexie, { type Table } from 'dexie';
import type { Author, Book, BookShelf, Copy, Loan, MetadataCache, MetadataSource, NamedItem, Person, RecognitionDraft, Setting, SettingKey, Shelf, StoredImage } from './models';

// IndexedDB is scoped by origin. This name keeps other Pages apps separate.
export const DATABASE_NAME = 'itoosh-45.library.personal.v1';
export class LibraryDatabase extends Dexie {
  books!: Table<Book, string>; copies!: Table<Copy, string>; authors!: Table<Author, string>;
  shelves!: Table<Shelf, string>; bookShelves!: Table<BookShelf, string>;
  series!: Table<NamedItem, string>; genres!: Table<NamedItem, string>; tags!: Table<NamedItem, string>;
  people!: Table<Person, string>; loans!: Table<Loan, string>; images!: Table<StoredImage, string>;
  settings!: Table<Setting, SettingKey>; metadataSources!: Table<MetadataSource, string>;
  metadataCache!: Table<MetadataCache, string>; recognitionDrafts!: Table<RecognitionDraft, string>;
  constructor(name = DATABASE_NAME) {
    super(name);
    this.version(1).stores({
      books: 'id,updatedAt,createdAt,titleSortKey,publisher,publicationYear,seriesId,readStatus,isbn13,isbn10,danacode,*authorIds,*tagIds,*genreIds',
      copies: 'id,bookId', authors: 'id,normalizedName', shelves: 'id,parentId',
      bookShelves: 'id,bookId,shelfId,&[bookId+shelfId]', series: 'id,normalizedName',
      genres: 'id,normalizedName', tags: 'id,normalizedName', people: 'id,normalizedName',
      loans: 'id,copyId,personId,borrowedAt,openFlag,[copyId+openFlag],[personId+openFlag]',
      images: 'id', settings: 'key', metadataSources: 'id,bookId,provider',
      metadataCache: 'key,provider,expiresAt', recognitionDrafts: 'id,batchId,status,updatedAt',
    });
  }
}
export async function initializeLibrary(database: LibraryDatabase): Promise<string> {
  await database.open();
  return database.transaction('rw', database.settings, async () => {
    const existing = await database.settings.get('libraryId');
    if (existing) return existing.value;
    const libraryId = crypto.randomUUID();
    await database.settings.bulkAdd([
      { key: 'libraryId', value: libraryId },
      { key: 'libraryName', value: 'הספרייה שלי' },
      { key: 'displayMode', value: 'compact' },
    ]);
    return libraryId;
  });
}
export const db = new LibraryDatabase();
