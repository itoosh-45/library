import { useState, type Dispatch, type SetStateAction } from 'react';
import { readingStates } from './data/books';
import { emptyFilters, hebrewCollator, libraryStats, sortLabels, type LibraryFilters, type SearchData, type SortKey } from './data/search';
import { shelfRows } from './data/collections';

export function SearchControls({ data, filters, setFilters, sort, setSort, descending, setDescending }: {
  data: SearchData; filters: LibraryFilters; setFilters: Dispatch<SetStateAction<LibraryFilters>>;
  sort: SortKey; setSort: (key: SortKey) => void; descending: boolean; setDescending: (value: boolean) => void;
}) {
  function set<K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) { setFilters(previous => ({ ...previous, [key]: value })); }
  const options = (key: 'publisher' | 'language' | 'publicationYear') => [...new Set(data.books.map(book => book[key]).filter(value => value !== null))].sort((a, b) => hebrewCollator.compare(String(a), String(b)));
  return <section className="search-controls" aria-label="חיפוש וסינון">
    <label className="field">חיפוש בכל הספרייה<input type="search" placeholder="שם ספר, מחבר או תגית" value={filters.query} onChange={event => set('query', event.target.value)} /></label>
    <details className="search-options"><summary>מיון וסינון</summary><div className="sort-controls"><label className="field">מיון לפי<select value={sort} onChange={event => setSort(event.target.value as SortKey)}>{Object.entries(sortLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field">כיוון המיון<select value={descending ? 'desc' : 'asc'} onChange={event => setDescending(event.target.value === 'desc')}><option value="asc">עולה</option><option value="desc">יורד</option></select></label></div>
    {sort === 'price' && <p className="hint">המחירים מסודרים לפי מטבע, ובתוכו לפי המחיר הנמוך לעותק פעיל. אין המרת מטבע.</p>}
    <details><summary>סינון הספרים</summary><div className="filter-grid">
      <label className="field">מדף לסינון<select value={filters.shelfId} onChange={event => set('shelfId', event.target.value)}><option value="">כל המדפים</option>{shelfRows(data.shelves).map(({ shelf, depth }) => <option key={shelf.id} value={shelf.id}>{depth ? `רמה ${depth + 1}: ` : ''}{shelf.name}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={filters.descendants} onChange={event => set('descendants', event.target.checked)} />כולל צאצאי המדף</label>
      <label className="field">ז׳אנר לסינון<select value={filters.genreId} onChange={event => set('genreId', event.target.value)}><option value="">כל הז׳אנרים</option>{[...data.genres].sort((a, b) => hebrewCollator.compare(a.name, b.name)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="field">מצב קריאה לסינון<select value={filters.readStatus} onChange={event => set('readStatus', event.target.value)}><option value="">כל מצבי הקריאה</option>{Object.entries(readingStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="field">זמינות<select value={filters.availability} onChange={event => set('availability', event.target.value)}><option value="">כל הספרים</option><option value="available">עותק זמין</option><option value="unavailable">אין עותק זמין</option></select></label>
      {(['publisher', 'language', 'publicationYear'] as const).map(key => <label className="field" key={key}>{key === 'publisher' ? 'הוצאה לסינון' : key === 'language' ? 'שפה לסינון' : 'שנה לסינון'}<select value={filters[key === 'publicationYear' ? 'year' : key]} onChange={event => set(key === 'publicationYear' ? 'year' : key, event.target.value)}><option value="">הכול</option>{options(key).map(value => <option key={value} value={String(value)}>{value}</option>)}</select></label>)}
    </div><fieldset className="choices"><legend>תגיות לסינון — כל הנבחרות</legend>{[...data.tags].sort((a, b) => hebrewCollator.compare(a.name, b.name)).map(item => <label className="check" key={item.id}><input type="checkbox" checked={filters.tagIds.includes(item.id)} onChange={event => set('tagIds', event.target.checked ? [...filters.tagIds, item.id] : filters.tagIds.filter(id => id !== item.id))} />{item.name}</label>)}{!data.tags.length && <p>עוד לא נוספו תגיות.</p>}</fieldset></details>
  </details>{Object.entries(filters).some(([key, value]) => key !== 'descendants' && (Array.isArray(value) ? value.length > 0 : !!value)) && <button className="secondary" onClick={() => setFilters({ ...emptyFilters, tagIds: [] })}>ניקוי החיפוש והמסננים</button>}</section>;
}
export function Statistics({ data, books }: { data: SearchData; books: SearchData['books'] }) {
  const [scope, setScope] = useState('results');
  const results = libraryStats(books, data.copies, data.tags, data.genres);
  const stats = scope === 'all' ? libraryStats(data.books, data.copies, data.tags, data.genres) : results;
  return <section className="statistics" aria-label="סטטיסטיקת ספרים"><p className="result-count" role="status">{results.books} ספרים ייחודיים · {results.copies} עותקים פעילים · {results.archivedCopies} עותקים בארכיון</p><details><summary>סטטיסטיקה</summary><label className="field">ספרים לסטטיסטיקה<select value={scope} onChange={event => setScope(event.target.value)}><option value="results">תוצאות החיפוש והמסננים</option><option value="all">הספרייה כולה, כולל ארכיון</option></select></label><p>{stats.books} ספרים ייחודיים · {stats.copies} עותקים פעילים · {stats.archivedCopies} עותקים בארכיון</p><ul>{Object.entries(readingStates).map(([key, label]) => <li key={key}>{label}: {stats.states[key]}</li>)}</ul>{([['תגיות', stats.tags], ['ז׳אנרים', stats.genres]] as const).map(([label, items]) => <div key={label}><h3>{label}</h3>{items.length ? <ul>{items.map(item => <li key={item.id}>{item.name}: {item.count}</li>)}</ul> : <p>אין אוספים בתצוגה.</p>}</div>)}</details></section>;
}
