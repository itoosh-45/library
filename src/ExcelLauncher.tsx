import { lazy, Suspense, useState } from 'react';
const ExcelPanel = lazy(() => import('./ExcelPanel'));
export function ExcelLauncher() {
  const [open, setOpen] = useState(false);
  return open ? <Suspense fallback={<p role="status">טוען כלי Excel…</p>}><ExcelPanel /></Suspense> : <section className="backup-panel"><h3>Excel — יצוא וייבוא טבלאיים</h3><p>לעריכה והעברת נתונים. התמונות נשמרות בגיבוי JSON.</p><button type="button" className="secondary" onClick={() => setOpen(true)}>פתיחת כלי Excel</button></section>;
}
