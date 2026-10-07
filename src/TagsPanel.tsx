import { useState } from 'react';
import { BookList, type BookListProps } from './BookList';
import { NamedManagement } from './NamedManagement';

export function TagsPanel({ list }: { list: BookListProps }) {
  const [selected, setSelected] = useState('');
  const tag = list.tags.find(item => item.id === selected);
  const tagged = list.books.filter(book => book.tagIds.includes(selected));
  return <section className="tags-panel">
    <ul className="tag-list">{[...list.tags].sort((a, b) => a.name.localeCompare(b.name, 'he')).map(item => <li key={item.id}><button className="secondary" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><strong>{item.name}</strong><span>{list.books.filter(book => book.tagIds.includes(item.id)).length} ספרים</span></button></li>)}</ul>
    {tag && <><h2>{tag.name}</h2>{tagged.length ? <BookList {...list} books={tagged} /> : <p>אין ספרים עם תגית זו.</p>}</>}
    <details><summary>ניהול תגיות</summary><NamedManagement kind="tags" /></details>
  </section>;
}
