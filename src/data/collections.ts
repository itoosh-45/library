import type { LibraryDatabase } from './database';
import type { Book, BookShelf, NamedItem, Series, Shelf, StoredImage } from './models';
import { LibraryValidationError, normalizeText } from './library';
import { compareTitle } from './search';

export type CollectionKind = 'tags' | 'genres' | 'series';
export const collectionLabels = { tags: 'תגיות', genres: 'ז׳אנרים', series: 'סדרות' };
export const presetGenres = ['ספרות', 'מתח', 'פנטזיה', 'מדע בדיוני', 'היסטוריה', 'ביוגרפיה', 'שירה', 'ילדים ונוער', 'עיון', 'יהדות'];
const fail = (message: string): never => { throw new LibraryValidationError(message); };
function nameField(name: string): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || !normalizeText(name)) return fail('השם צריך להכיל בין 1 ל־120 תווים.');
  return name.trim();
}
function checkCurrent(current: unknown, expected: unknown) {
  if (!current || JSON.stringify(current) !== JSON.stringify(expected)) return fail('האוסף השתנה בחלון אחר. סגור ופתח אותו מחדש.');
}
export function descendantIds(shelves: Shelf[], root: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const shelf of shelves) if (shelf.parentId) children.set(shelf.parentId, [...(children.get(shelf.parentId) ?? []), shelf.id]);
  const seen = new Set<string>(), stack = [root];
  while (stack.length) { const id = stack.pop()!; if (seen.has(id)) continue; seen.add(id); stack.push(...(children.get(id) ?? [])); }
  return seen;
}
export function shelfRows(shelves: Shelf[]): { shelf: Shelf; depth: number; path: string }[] {
  const children = new Map<string | null, Shelf[]>();
  for (const shelf of shelves) children.set(shelf.parentId, [...(children.get(shelf.parentId) ?? []), shelf]);
  const compare = (a: Shelf, b: Shelf) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'he') || a.id.localeCompare(b.id);
  for (const rows of children.values()) rows.sort(compare);
  const stack = [...(children.get(null) ?? [])].reverse().map(shelf => ({ shelf, depth: 0, path: shelf.name }));
  const rows = [], seen = new Set<string>();
  while (stack.length) {
    const row = stack.pop()!; if (seen.has(row.shelf.id)) continue; seen.add(row.shelf.id); rows.push(row);
    for (const shelf of [...(children.get(row.shelf.id) ?? [])].reverse()) stack.push({ shelf, depth: row.depth + 1, path: row.path + ' / ' + shelf.name });
  }
  return rows;
}
export function shelfBookIds(shelves: Shelf[], links: BookShelf[], shelfId: string, includeDescendants: boolean, visibleIds?: Set<string>): Set<string> {
  const selected = includeDescendants ? descendantIds(shelves, shelfId) : new Set([shelfId]);
  return new Set(links.filter(link => selected.has(link.shelfId) && (!visibleIds || visibleIds.has(link.bookId))).map(link => link.bookId));
}
export async function removeUnusedImage(database: LibraryDatabase, id: string | null) {
  if (id && !await database.books.filter(book => book.primaryImageId === id).count() && !await database.shelves.filter(shelf => shelf.imageId === id).count() && !await database.recognitionDrafts.filter(draft => draft.images.some(image => image.storedImageId === id)).count()) await database.images.delete(id);
}
export async function saveShelf(database: LibraryDatabase, input: { name: string; parentId: string | null }, existing?: Shelf, image?: StoredImage | null): Promise<Shelf> {
  const name = nameField(input.name);
  return database.transaction('rw', [database.shelves, database.images, database.books, database.recognitionDrafts], async () => {
    const current = existing ? await database.shelves.get(existing.id) : undefined;
    if (existing) checkCurrent(current, existing);
    const shelves = await database.shelves.toArray();
    if (input.parentId !== null && !shelves.some(shelf => shelf.id === input.parentId)) return fail('מדף האב אינו קיים. בחר אותו מחדש.');
    if (current && input.parentId && descendantIds(shelves, current.id).has(input.parentId)) return fail('אי אפשר להעביר מדף לתוך עצמו או לתוך צאצא שלו.');
    const now = new Date().toISOString();
    if (image) await database.images.put(image);
    const shelf: Shelf = { id: current?.id ?? crypto.randomUUID(), name, parentId: input.parentId, imageId: image === undefined ? current?.imageId ?? null : image?.id ?? null, sortOrder: current?.sortOrder ?? shelves.length, createdAt: current?.createdAt ?? now, updatedAt: now };
    await database.shelves.put(shelf);
    if (current?.imageId !== shelf.imageId) await removeUnusedImage(database, current?.imageId ?? null);
    return shelf;
  });
}
export async function deleteShelf(database: LibraryDatabase, expected: Shelf): Promise<void> {
  await database.transaction('rw', [database.shelves, database.bookShelves, database.books, database.images, database.recognitionDrafts], async () => {
    const shelf = await database.shelves.get(expected.id); checkCurrent(shelf, expected);
    const now = new Date().toISOString();
    await database.shelves.where('parentId').equals(expected.id).modify({ parentId: expected.parentId, updatedAt: now });
    const links = await database.bookShelves.where('shelfId').equals(expected.id).toArray();
    await database.bookShelves.where('shelfId').equals(expected.id).delete();
    for (const id of new Set(links.map(link => link.bookId))) await database.books.where('id').equals(id).modify(book => { book.revision++; book.updatedAt = now; });
    await database.recognitionDrafts.filter(draft => draft.shelfId === expected.id).modify(draft => { draft.shelfId = null; draft.revision++; draft.updatedAt = now; });
    await database.shelves.delete(expected.id); await removeUnusedImage(database, expected.imageId);
  });
}
export async function saveNamedItem(database: LibraryDatabase, kind: CollectionKind, value: string, existing?: NamedItem): Promise<NamedItem> {
  const name = nameField(value), normalizedName = normalizeText(name);
  return database.transaction('rw', database.table(kind), async () => {
    const current = existing ? await database.table(kind).get(existing.id) as NamedItem | undefined : undefined;
    if (existing) checkCurrent(current, existing);
    const duplicate = await database.table(kind).where('normalizedName').equals(normalizedName).first() as NamedItem | undefined;
    if (duplicate && duplicate.id !== existing?.id) return fail('שם זה כבר קיים. בחר את האוסף הקיים.');
    const item = { ...current, id: current?.id ?? crypto.randomUUID(), name, normalizedName, ...(kind === 'series' && !current ? { collapsed: false } : {}) };
    await database.table(kind).put(item); return item;
  });
}
export async function deleteNamedItem(database: LibraryDatabase, kind: CollectionKind, expected: NamedItem): Promise<void> {
  await database.transaction('rw', [database.table(kind), database.books], async () => {
    checkCurrent(await database.table(kind).get(expected.id), expected);
    const now = new Date().toISOString();
    await database.books.toCollection().modify(book => {
      const affected = kind === 'series' ? book.seriesId === expected.id : book[kind === 'tags' ? 'tagIds' : 'genreIds'].includes(expected.id);
      if (!affected) return;
      if (kind === 'series') { book.seriesId = null; book.seriesNumber = null; }
      else { const key = kind === 'tags' ? 'tagIds' : 'genreIds'; book[key] = book[key].filter(id => id !== expected.id); }
      book.revision++; book.updatedAt = now;
    });
    await database.table(kind).delete(expected.id);
  });
}
export async function setSeriesCollapsed(database: LibraryDatabase, id: string, collapsed: boolean) {
  if (typeof collapsed !== 'boolean') return fail('מצב הקיפול אינו תקין.');
  await database.transaction('rw', database.series, async () => {
    if (!await database.series.get(id)) return fail('הסדרה אינה קיימת.');
    await database.series.update(id, { collapsed });
  });
}
export function bookGroups(books: Book[], series: Series[], compare?: (a: Book, b: Book) => number): { id: string; series?: Series; books: Book[] }[] {
  const byTitle = compareTitle;
  const groups = new Map<string, { id: string; series?: Series; books: Book[] }>();
  for (const book of [...books].sort(compare ?? byTitle)) {
    const item = series.find(item => item.id === book.seriesId), id = item ? 'series:' + item.id : 'book:' + book.id;
    if (!groups.has(id)) groups.set(id, { id, series: item, books: [] });
    groups.get(id)!.books.push(book);
  }
  for (const group of groups.values()) if (group.series) group.books.sort((a, b) => (a.seriesNumber ?? Infinity) - (b.seriesNumber ?? Infinity) || byTitle(a, b));
  return [...groups.values()];
}
