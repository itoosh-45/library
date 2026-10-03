import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import type { BookInput } from './data/books';

export function GenreField({ input, onChange }: { input: BookInput; onChange: (input: BookInput) => void }) {
  const genres = useLiveQuery(() => db.genres.toArray()) ?? [];
  const names = input.genreNames ?? genres.filter(genre => input.genreIds?.includes(genre.id)).map(genre => genre.name);
  return <label className="field">ז׳אנרים<input aria-label="ז׳אנרים" value={names.join(', ')} placeholder="למשל: פנטזיה, הרפתקאות" onChange={event => onChange({ ...input, genreNames: event.target.value.split(',').map(name => name.trim()) })} /><small>קטגוריות מהקטלוג ניתנות לתיקון. הפרד בפסיקים.</small></label>;
}
