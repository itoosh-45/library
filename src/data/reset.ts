import type { LibraryDatabase } from './database';

export async function resetLibraryBooks(database: LibraryDatabase): Promise<void> {
  // One transaction keeps the remaining collections free of dangling references.
  await database.transaction('rw', database.tables, async () => {
    await database.books.clear();
    await database.copies.clear();
    await database.authors.clear();
    await database.images.clear();
    await database.bookShelves.clear();
    await database.loans.clear();
    await database.metadataSources.clear();
    await database.metadataCache.clear();
    await database.recognitionDrafts.clear();
    await database.shelves.toCollection().modify({ imageId: null });
  });
}
