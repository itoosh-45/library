export type ColumnType = 'text' | 'number' | 'boolean' | 'json';
export interface SheetSchema { table: string; columns: Record<string, ColumnType> }
const columns = (text: string, number = '', boolean = '', json = ''): Record<string, ColumnType> => Object.fromEntries([
  ...text.split(' ').filter(Boolean).map(key => [key, 'text']), ...number.split(' ').filter(Boolean).map(key => [key, 'number']),
  ...boolean.split(' ').filter(Boolean).map(key => [key, 'boolean']), ...json.split(' ').filter(Boolean).map(key => [key, 'json']),
]);
export const workbookSchema: Record<string, SheetSchema> = {
  Books: { table: 'books', columns: columns('id title subtitle isbn10 isbn13 danacode publisher edition volume language seriesId readStatus personalNotes primaryImageId createdAt updatedAt titleSortKey authorNames shelfNames genreNames tagNames seriesName', 'publicationYear pages seriesNumber revision rating priceILS', 'hasRating') },
  Copies: { table: 'copies', columns: columns('id bookId label currency notes archivedAt createdAt updatedAt', 'purchasePriceMinor') },
  Authors: { table: 'authors', columns: columns('id displayName givenName familyName normalizedName') },
  BookAuthors: { table: 'bookAuthors', columns: columns('bookId authorId', 'position') },
  Shelves: { table: 'shelves', columns: columns('id name parentId imageId createdAt updatedAt', 'sortOrder') },
  BookShelves: { table: 'bookShelves', columns: columns('id bookId shelfId') },
  Series: { table: 'series', columns: columns('id name normalizedName', '', 'collapsed') },
  Genres: { table: 'genres', columns: columns('id name normalizedName') },
  Tags: { table: 'tags', columns: columns('id name normalizedName') },
  BookGenres: { table: 'bookGenres', columns: columns('bookId genreId', 'position') },
  BookTags: { table: 'bookTags', columns: columns('bookId tagId', 'position') },
  People: { table: 'people', columns: columns('id name normalizedName archivedAt') },
  Loans: { table: 'loans', columns: columns('id copyId personId borrowedAt expectedReturnOn returnedAt notes createdAt updatedAt', 'openFlag') },
  MetadataSources: { table: 'metadataSources', columns: columns('id bookId provider recordId sourceUrl fetchedAt', '', '', 'fieldValues selectedFields userOverriddenFields recognition') },
  Settings: { table: 'settings', columns: columns('key value') },
  ImageRefs: { table: 'imageRefs', columns: columns('id sha256 sourceUrl') },
};
export const bookDisplayColumns = ['authorNames', 'shelfNames', 'genreNames', 'tagNames', 'seriesName', 'priceILS', 'hasRating'];
export const legacyWorkbookSchema = { ...workbookSchema, Books: { ...workbookSchema.Books, columns: Object.fromEntries(Object.entries(workbookSchema.Books.columns).filter(([key]) => !bookDisplayColumns.includes(key) && key !== 'rating')) } };
export const manifestColumns = ['key', 'value', 'sheet', 'column', 'type', 'editable'];
export const simpleFields = ['title', 'subtitle', 'authors', 'isbn', 'danacode', 'publisher', 'publicationYear', 'edition', 'volume', 'language', 'pages', 'personalNotes', 'readStatus', 'copies', 'purchasePrice', 'currency', 'copyNotes', 'createdAt'] as const;
export type SimpleField = typeof simpleFields[number];
export const simpleFieldLabels: Record<SimpleField, string> = { title: 'שם הספר', subtitle: 'כותרת משנה', authors: 'מחברים', isbn: 'ISBN', danacode: 'דאנאקוד', publisher: 'הוצאה', publicationYear: 'שנת הוצאה', edition: 'מהדורה', volume: 'כרך', language: 'שפה', pages: 'עמודים', personalNotes: 'הערות לספר', readStatus: 'מצב קריאה', copies: 'כמות עותקים', purchasePrice: 'מחיר עותק', currency: 'מטבע', copyNotes: 'הערות לעותק', createdAt: 'תאריך הוספה' };
const aliases: Record<SimpleField, string[]> = {
  title: ['שם', 'שם הספר', 'כותרת'], subtitle: ['כותרת משנה'], authors: ['מחבר', 'מחברים', 'author'], isbn: ['isbn10', 'isbn13', 'מסתב'], danacode: ['דאנאקוד', 'דנה קוד'], publisher: ['הוצאה', 'מוציא לאור'],
  publicationYear: ['שנה', 'שנת הוצאה'], edition: ['מהדורה'], volume: ['כרך'], language: ['שפה'], pages: ['עמודים'], personalNotes: ['הערות', 'רשמים'], readStatus: ['מצב קריאה'], copies: ['עותקים', 'כמות', 'מספר עותקים'],
  purchasePrice: ['מחיר', 'מחיר רכישה'], currency: ['מטבע'], copyNotes: ['הערות עותק'], createdAt: ['תאריך', 'תאריך הוספה'],
};
export function suggestedMapping(headers: string[]): Record<string, SimpleField> {
  return Object.fromEntries(headers.flatMap(header => {
    const field = simpleFields.find(value => [value.toLowerCase(), ...aliases[value]].includes(header.trim().toLowerCase()));
    return field ? [[header, field]] : [];
  }));
}
