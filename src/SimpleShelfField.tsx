import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { shelfRows } from './data/collections';
import type { BookInput } from './data/books';

export function SimpleShelfField({ bookId, input, onChange }: { bookId?: string; input: BookInput; onChange: (input: BookInput) => void }) {
  const data = useLiveQuery(async () => ({ shelves: await db.shelves.toArray(), links: bookId ? await db.bookShelves.where('bookId').equals(bookId).toArray() : [] }), [bookId]);
  if (!data) return <p role="status">טוען מדפים…</p>;
  const selected = input.shelfIds ?? data.links.map(link => link.shelfId);
  return <label className="field">מדף<select aria-label="מדף" value={selected[0] ?? ''} onChange={event => onChange({ ...input, shelfIds: event.target.value ? [event.target.value] : [] })}><option value="">ללא מדף</option>{shelfRows(data.shelves).map(({ shelf, path }) => <option key={shelf.id} value={shelf.id}>{path}</option>)}</select>{selected.length > 1 && <small>הספר משויך לכמה מדפים. השיוכים נשמרים עד שינוי הבחירה.</small>}</label>;
}
