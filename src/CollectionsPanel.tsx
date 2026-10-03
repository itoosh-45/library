import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { Sheet, Thumbnail } from './BookEditor';
import { BookList, type BookListProps } from './BookList';
import { collectionLabels, deleteNamedItem, deleteShelf, descendantIds, presetGenres, saveNamedItem, saveShelf, shelfBookIds, shelfRows, type CollectionKind } from './data/collections';
import type { NamedItem, Shelf, StoredImage } from './data/models';
import { prepareImage } from './data/images';
import { errorMessage } from './data/errors';

export function ShelvesPanel({ list, simple = false }: { list: BookListProps; simple?: boolean }) {
  const data = useLiveQuery(async () => ({ shelves: await db.shelves.toArray(), links: await db.bookShelves.toArray() }));
  const [editor, setEditor] = useState<{ shelf?: Shelf }>(), [selected, setSelected] = useState<string>(), [descendants, setDescendants] = useState(true);
  if (!data) return <p role="status">טוען מדפים…</p>;
  const visible = new Set(list.books.map(book => book.id)), shelf = data.shelves.find(item => item.id === selected);
  const ids = shelf ? shelfBookIds(data.shelves, data.links, shelf.id, descendants, visible) : new Set<string>();
  return <><div className="toolbar"><button onClick={() => setEditor({})}>הוספת מדף</button>{!simple && <p className="hint">ספר יכול להופיע בכמה מדפים. הספירות כוללות כל ספר פעם אחת.</p>}</div>
    {!data.shelves.length ? <section className="empty-state"><h2>המדפים שלך</h2><p>צור מדף, ותוכל לבחור אותו בכרטיס הספר.</p></section> : <ul className={simple ? "shelf-tree shelf-gallery" : "shelf-tree"} aria-label="עץ המדפים">{shelfRows(data.shelves).map(({ shelf, depth, path }) => <li key={shelf.id} style={{ paddingInlineStart: Math.min(depth, 4) * 12 }}><button className="shelf-select secondary" aria-pressed={selected === shelf.id} onClick={() => setSelected(shelf.id)} title={path}><Thumbnail imageId={shelf.imageId} alt={'תמונת המדף ' + shelf.name} /><span className="shelf-info">{shelf.name}{depth > 0 && <small>רמה {depth + 1} · בתוך {data.shelves.find(item => item.id === shelf.parentId)?.name}</small>}</span><span className="shelf-count">{shelfBookIds(data.shelves, data.links, shelf.id, true, visible).size} ספרים</span></button><button className="secondary edit-collection" aria-label={'עריכת מדף ' + shelf.name} onClick={() => setEditor({ shelf })}>עריכה</button></li>)}</ul>}
    {shelf && <section className="shelf-books"><h2>ספרים במדף: {shelf.name}</h2>{!simple && <label className="check"><input type="checkbox" checked={descendants} onChange={event => setDescendants(event.target.checked)} />כולל תתי־מדפים</label>}<p>{ids.size} ספרים בתצוגה</p>{ids.size ? <BookList {...list} books={list.books.filter(book => ids.has(book.id))} /> : <p>אין ספרים בתצוגה הזאת.</p>}</section>}
    {editor && <ShelfEditor shelf={editor.shelf} shelves={data.shelves} onClose={() => setEditor(undefined)} />}
  </>;
}
function ShelfEditor({ shelf, shelves, onClose }: { shelf?: Shelf; shelves: Shelf[]; onClose: () => void }) {
  const [name, setName] = useState(shelf?.name ?? ''), [parentId, setParent] = useState(shelf?.parentId ?? ''), [image, setImage] = useState<StoredImage | null | undefined>();
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const excluded = shelf ? descendantIds(shelves, shelf.id) : new Set<string>();
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await saveShelf(db, { name, parentId: parentId || null }, shelf, image); onClose(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return; setBusy(true); setError('');
    try { setImage(await prepareImage(file)); setDirty(true); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <Sheet title={shelf ? 'עריכת מדף' : 'הוספת מדף'} onClose={onClose} busy={busy} dirty={dirty}><form onSubmit={event => void save(event)}><fieldset disabled={busy}>
    <label className="field">שם המדף<input required maxLength={120} value={name} onChange={event => { setName(event.target.value); setDirty(true); }} /></label>
    <label className="field">בתוך מדף<select value={parentId} onChange={event => { setParent(event.target.value); setDirty(true); }}><option value="">מדף ראשי</option>{shelfRows(shelves).filter(row => !excluded.has(row.shelf.id)).map(({ shelf, depth, path }) => <option key={shelf.id} value={shelf.id} title={path}>{depth ? `רמה ${depth + 1}: ` : ''}{shelf.name}</option>)}</select></label>
    <div className="cover-editor"><Thumbnail imageId={image === undefined ? shelf?.imageId : null} image={image} alt="תמונת המדף" /><label className="field">תמונת מדף<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }} /></label><button type="button" className="secondary" onClick={() => { setImage(null); setDirty(true); }}>הסרת תמונה</button></div>
    <button type="submit">שמירת המדף</button><p className="error-message" role="alert">{error}</p>
    {shelf && <details><summary>מחיקת המדף</summary><p>הספרים והעותקים יישארו בספרייה. תתי־המדפים יעברו למדף האב, או לרמה הראשית.</p><label className="check"><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} />אני מאשר מחיקת המדף והסרת השיוך אליו</label><button type="button" disabled={!confirmDelete} onClick={async () => { setBusy(true); setError(''); try { await deleteShelf(db, shelf); onClose(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>מחיקת המדף בלבד</button></details>}
  </fieldset></form></Sheet>;
}
export function CollectionsPanel({ list }: { list: BookListProps }) {
  const [kind, setKind] = useState<CollectionKind>('tags'), [editor, setEditor] = useState<{ kind: CollectionKind; item?: NamedItem }>(), [selected, setSelected] = useState<string>();
  const data = useLiveQuery(async () => ({ tags: await db.tags.toArray(), genres: await db.genres.toArray(), series: await db.series.toArray() }));
  if (!data) return <p role="status">טוען אוספים…</p>;
  const selectedItem = data[kind].find(item => item.id === selected);
  const includes = (id: string) => list.books.filter(book => kind === 'tags' ? book.tagIds.includes(id) : kind === 'genres' ? book.genreIds.includes(id) : book.seriesId === id);
  return <><div className="toolbar" aria-label="סוג אוסף">{(['tags', 'genres', 'series'] as const).map(value => <button className="secondary" aria-pressed={kind === value} key={value} onClick={() => { setKind(value); setSelected(undefined); }}>{collectionLabels[value]}</button>)}<button onClick={() => setEditor({ kind })}>הוספת {kind === 'tags' ? 'תגית' : kind === 'genres' ? 'ז׳אנר' : 'סדרה'}</button></div>
    <p className="hint">בחר אוסף כדי לראות את ספריו. את השיוכים בוחרים בכרטיס הספר.</p>
    {!data[kind].length ? <section className="empty-state"><h2>עוד לא נוספו {collectionLabels[kind]}</h2><p>אפשר ליצור כאן אוסף ולשייך אליו ספרים.</p></section> : <ul className="collection-list">{[...data[kind]].sort((a, b) => a.name.localeCompare(b.name, 'he')).map(item => <li key={item.id}><button className="secondary collection-select" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span>{item.name}</span><span>{includes(item.id).length} ספרים</span></button><button className="secondary" aria-label={'עריכת אוסף ' + item.name} onClick={() => setEditor({ kind, item })}>עריכה</button></li>)}</ul>}
    {selectedItem && <section className="shelf-books"><h2>ספרים באוסף: {selectedItem.name}</h2>{includes(selectedItem.id).length ? <BookList {...list} books={includes(selectedItem.id)} /> : <p>אין ספרים בתצוגה הזאת.</p>}</section>}
    {editor && <NamedEditor {...editor} onClose={() => setEditor(undefined)} />}
  </>;
}
function NamedEditor({ kind, item, onClose }: { kind: CollectionKind; item?: NamedItem; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? ''), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  return <Sheet title={item ? 'עריכת אוסף' : 'הוספת אוסף'} busy={busy} dirty={dirty} onClose={onClose}><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await saveNamedItem(db, kind, name, item); onClose(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}><fieldset disabled={busy}>
    <label className="field">שם האוסף<input required maxLength={120} value={name} onChange={event => { setName(event.target.value); setDirty(true); }} /></label>
    {kind === 'genres' && !item && <label className="field">ז׳אנרים מוכנים<select value="" onChange={event => { setName(event.target.value); setDirty(true); }}><option value="">בחירת ז׳אנר מוכן</option>{presetGenres.map(name => <option key={name}>{name}</option>)}</select></label>}
    <button type="submit">שמירת האוסף</button><p className="error-message" role="alert">{error}</p>
    {item && <details><summary>מחיקת האוסף</summary><p>הספרים יישארו. השיוך לאוסף יוסר{kind === 'series' ? ' וגם המספרים בסדרה יימחקו' : ''}.</p><label className="check"><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} />אני מאשר הסרת האוסף והשיוכים אליו</label><button type="button" disabled={!confirmDelete} onClick={async () => { setBusy(true); setError(''); try { await deleteNamedItem(db, kind, item); onClose(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }}>מחיקת האוסף בלבד</button></details>}
  </fieldset></form></Sheet>;
}
