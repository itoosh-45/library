import { useEffect, useRef, useState } from 'react';
import { registerOffline, useOnline, workerMessage } from './pwa';
import { updateBlocked } from './updateSafety';

export function OfflinePanel() {
  const online = useOnline();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration>();
  const [waiting, setWaiting] = useState(false), [cached, setCached] = useState(false), [message, setMessage] = useState('');
  const [persisting, setPersisting] = useState(false);
  const requested = useRef(false);
  const reloadTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let disposed = false, cleanup = () => {};
    const controlled = () => { if (requested.current) window.location.reload(); else setCached(!!navigator.serviceWorker.controller); };
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', controlled);
    const pending = registerOffline();
    if (pending) void pending.then(reg => {
      if (disposed) return;
      setRegistration(reg); setCached(!!navigator.serviceWorker.controller); setWaiting(!!reg.waiting);
      const found = () => {
        const worker = reg.installing;
        if (worker) worker.addEventListener('statechange', () => { if (!disposed && worker.state === 'installed') setWaiting(!!reg.waiting); });
      };
      reg.addEventListener('updatefound', found); found(); cleanup = () => reg.removeEventListener('updatefound', found);
    }).catch(() => { if (!disposed) setMessage('הכנת אופליין לא הושלמה. התחבר לרשת ופתח שוב; הנתונים המקומיים נשארו במכשיר.'); });
    return () => { disposed = true; cleanup(); clearTimeout(reloadTimeout.current); if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('controllerchange', controlled); };
  }, []);
  async function update() {
    if (!registration?.waiting || updateBlocked()) { setMessage('סיים או סגור עריכה ושחזור לפני העדכון.'); return; }
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (!shell) return;
    // Freeze this window before asking the worker to check other windows.
    shell.inert = true; requested.current = true;
    try {
      const result = await workerMessage(registration.waiting, 'ACTIVATE_UPDATE');
      if (result !== 'ACTIVATING') { requested.current = false; shell.inert = false; setMessage('סגור חלונות נוספים של הספרייה ונסה שוב.'); }
      else reloadTimeout.current = setTimeout(() => { requested.current = false; shell.inert = false; setMessage('הפתיחה מחדש לא הושלמה. סיים עריכה ואז פתח שוב את הספרייה.'); }, 10000);
    } catch (error) { requested.current = false; shell.inert = false; setMessage(error instanceof Error ? error.message : 'העדכון לא הופעל.'); }
  }
  async function persist() {
    setPersisting(true);
    try {
      if (!navigator.storage?.persist) setMessage('הדפדפן אינו תומך בבקשת אחסון מתמיד. הורד גיבוי.');
      else setMessage(await navigator.storage.persist() ? 'הדפדפן אישר אחסון מתמיד. ניקוי ידני עדיין מוחק נתונים; שמור גיבוי.' : 'הדפדפן לא אישר אחסון מתמיד. הנתונים קיימים, אך יש לשמור גיבוי.');
    } catch { setMessage('מצב האחסון לא זמין. שמור גיבוי לפני ניקוי הדפדפן.'); }
    finally { setPersisting(false); }
  }
  return <section className="setting-note" aria-label="התקנה ואופליין"><h3>התקנה ואופליין</h3>
    <p role="status">{online ? 'יש חיבור לרשת' : 'אין חיבור לרשת — הספרים, החיפוש המקומי וההשאלות זמינים'}</p>
    <p>{cached ? 'קובצי האפליקציה מוכנים לפתיחה ללא רשת.' : import.meta.env.PROD ? ('serviceWorker' in navigator ? 'מכין קובצי אפליקציה לפתיחה ללא רשת…' : 'הדפדפן אינו תומך בהכנת האפליקציה לאופליין.') : 'התקנה ואופליין נבדקים בגרסה הבנויה.'}</p>
    <p>{window.matchMedia('(display-mode: standalone)').matches ? 'הספרייה פתוחה כאפליקציה מותקנת.' : 'ב־iPhone: פתח את כתובת הספרייה ב־Safari, בחר שיתוף ואז ״הוסף למסך הבית״. בדפדפן אחר השתמש בתפריט ההתקנה אם הוא מוצע.'}</p>
    <p>הנתונים שייכים לדפדפן ולכתובת שבה נוצרו. אל תניח שהתקנה חדשה, Safari או כתובת אחרת מציגים אותה ספרייה. הורד גיבוי לפני מעבר ובדוק את הנתונים לאחריו.</p>
    <button type="button" disabled={persisting} onClick={() => void persist()}>בקשת אחסון מתמיד</button>
    {registration && <button type="button" className="secondary" disabled={!online} onClick={() => void registration.update().then(() => setMessage('בדיקת העדכון הסתיימה.')).catch(() => setMessage('בדיקת העדכון לא הושלמה. נסה עם חיבור לרשת.'))}>בדיקת עדכון</button>}
    {waiting && <div className="notice"><p>גרסה חדשה ממתינה. העדכון מרענן את החלון; סיים עריכה וסגור חלונות נוספים קודם.</p><button type="button" onClick={() => void update()}>עדכון ופתיחה מחדש</button></div>}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
