import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import type { BookInput } from './data/books';
import { collectionLabels, presetGenres, saveNamedItem, shelfRows, type CollectionKind } from './data/collections';
import { errorMessage } from './data/errors';

export function CollectionFields({ bookId, input, onChange, onBusyChange }: { bookId?: string; input: BookInput; onChange: (input: BookInput) => void; onBusyChange: (busy: boolean) => void }) {
  const data = useLiveQuery(async () => ({ shelves: await db.shelves.toArray(), links: bookId ? await db.bookShelves.where('bookId').equals(bookId).toArray() : [], tags: await db.tags.toArray(), genres: await db.genres.toArray(), series: await db.series.toArray() }), [bookId]);
  if (!data) return <p role="status">טוען שיוכים…</p>;
  const ids = input.shelfIds ?? data.links.map(link => link.shelfId);
  const toggle = (key: 'shelfIds' | 'tagIds' | 'genreIds', id: string, checked: boolean) => {
    const old = key === 'shelfIds' ? ids : input[key] ?? [];
    onChange({ ...input, [key]: checked ? [...old, id] : old.filter(value => value !== id) });
  };
  return <details className="classification"><summary>מדפים, תגיות וסדרה</summary>
    <fieldset className="choices"><legend>שיוך למדפים</legend>{!data.shelves.length && <p className="hint">אפשר ליצור מדף במסך המדפים ולבחור אותו כאן.</p>}{shelfRows(data.shelves).map(({ shelf, depth, path }) => <label className="check" key={shelf.id} title={path}><input type="checkbox" checked={ids.includes(shelf.id)} onChange={event => toggle('shelfIds', shelf.id, event.target.checked)} /><span>{depth > 0 ? `רמה ${depth + 1}: ` : ''}{shelf.name}</span></label>)}</fieldset>
    {(['genres', 'tags'] as const).map(kind => <fieldset className="choices" key={kind}><legend>{collectionLabels[kind]}</legend>{data[kind].map(item => <label className="check" key={item.id}><input type="checkbox" checked={(input[kind === 'tags' ? 'tagIds' : 'genreIds'] ?? []).includes(item.id)} onChange={event => toggle(kind === 'tags' ? 'tagIds' : 'genreIds', item.id, event.target.checked)} /><span>{item.name}</span></label>)}<QuickCollection kind={kind} onBusyChange={onBusyChange} onCreated={id => toggle(kind === 'tags' ? 'tagIds' : 'genreIds', id, true)} /></fieldset>)}
    <label className="field">סדרה<select value={input.seriesId ?? ''} onChange={event => onChange({ ...input, seriesId: event.target.value || null, seriesNumber: event.target.value ? input.seriesNumber : '' })}><option value="">ללא סדרה</option>{data.series.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <QuickCollection kind="series" onBusyChange={onBusyChange} onCreated={id => onChange({ ...input, seriesId: id })} />
    <label className="field">מספר בסדרה<input inputMode="decimal" disabled={!input.seriesId} value={input.seriesNumber ?? ''} maxLength={20} onChange={event => onChange({ ...input, seriesNumber: event.target.value })} /></label><p className="hint">מספר חסר מופיע בסוף הסדרה ומסומן במפורש.</p>
  </details>;
}
function QuickCollection({ kind, onCreated, onBusyChange }: { kind: CollectionKind; onCreated: (id: string) => void; onBusyChange: (busy: boolean) => void }) {
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function create(value = name) {
    setBusy(true); onBusyChange(true); setError('');
    try { const item = await saveNamedItem(db, kind, value); onCreated(item.id); setName(''); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); onBusyChange(false); }
  }
  const label = kind === 'tags' ? 'תגית חדשה' : kind === 'genres' ? 'ז׳אנר חדש' : 'סדרה חדשה';
  return <div className="quick-collection"><label className="field">{label}<input maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><button type="button" className="secondary" disabled={busy || !name.trim()} onClick={() => void create()}>יצירת {kind === 'tags' ? 'תגית' : kind === 'genres' ? 'ז׳אנר' : 'סדרה'}</button>{kind === 'genres' && <label className="field">ז׳אנרים מוכנים<select value="" disabled={busy} onChange={event => { if (event.target.value) void create(event.target.value); }}><option value="">בחירת ז׳אנר מוכן</option>{presetGenres.map(name => <option key={name}>{name}</option>)}</select></label>}<p role="alert" className="error-message">{error}</p></div>;
}
