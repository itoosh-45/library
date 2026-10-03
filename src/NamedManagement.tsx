import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './data/database';
import { NamedEditor } from './CollectionsPanel';
import type { NamedItem } from './data/models';
export function NamedManagement({ kind }: { kind: 'genres' | 'tags' }) {
  const data = useLiveQuery(async () => ({ items: await db[kind].toArray(), books: await db.books.toArray() }), [kind]);
  const [editor, setEditor] = useState<{ item?: NamedItem }>();
  if (!data) return <p role="status">טוען…</p>;
  const noun = kind === 'genres' ? 'ז׳אנר' : 'תגית';
  return <section className="named-management"><button onClick={() => setEditor({})}>הוספת {noun}</button>{!data.items.length && <p>הרשימה עדיין ריקה.</p>}<ul>{[...data.items].sort((a,b) => a.name.localeCompare(b.name,'he')).map(item => <li key={item.id}><span><strong>{item.name}</strong><small>{data.books.filter(book => book[kind === 'genres' ? 'genreIds' : 'tagIds'].includes(item.id)).length} ספרים</small></span><button className="secondary" aria-label={'עריכת ' + noun + ' ' + item.name} onClick={() => setEditor({ item })}>עריכה ומחיקה</button></li>)}</ul>{kind === 'genres' && <p className="hint">ז׳אנר שמשויך לספר אינו ניתן למחיקה.</p>}{editor && <NamedEditor kind={kind} item={editor.item} onClose={() => setEditor(undefined)} />}</section>;
}
