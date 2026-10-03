import { StrictMode, useEffect, useRef, useState } from 'react';
import { App } from './App';
import { ErrorBoundary, StorageError } from './StorageError';
import { db, initializeLibrary } from './data/database';
import { watchDatabaseConnection, type ConnectionNotice } from './data/databaseLifecycle';
import { restoreVisionKey } from './data/visionCredentials';
import { registerOffline } from './pwa';

export function LibraryStartup() {
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<ConnectionNotice | 'closed' | 'newer' | 'error'>();
  const cancelled = useRef(false);
  const message = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (notice && message.current) {
      if (!message.current.open) message.current.showModal();
      message.current.focus();
    }
  }, [notice]);
  useEffect(() => {
    let stopped = false;
    const unwatch = watchDatabaseConnection(db, next => { if (!stopped) setNotice(next); });
    void Promise.all([initializeLibrary(db), restoreVisionKey()]).then(() => {
      if (stopped || cancelled.current || db.upgradePending) return;
      setReady(true); setNotice(undefined);
      void registerOffline()?.catch(() => {});
    }).catch((error: unknown) => {
      if (!stopped && !cancelled.current && !db.upgradePending) setNotice(error instanceof Error && error.name === 'VersionError' ? 'newer' : 'error');
    });
    return () => { stopped = true; unwatch(); };
  }, []);
  function closeConnection() { cancelled.current = true; db.close(); setNotice('closed'); }
  return <>
    {ready && <div inert={!!notice} aria-hidden={notice ? true : undefined}><StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode></div>}
    {!ready && !notice && <p className="loading" role="status">פותח את הספרייה…</p>}
    {notice === 'error' ? <StorageError /> : notice && <dialog ref={message} tabIndex={-1} onCancel={event => event.preventDefault()} className="storage-error connection-notice" aria-label="מצב חיבור הספרייה">
      <h1>{notice === 'blocked' ? 'חלון אחר חוסם את שדרוג הספרייה' : notice === 'versionchange' ? 'שדרוג ממתין בחלון אחר' : notice === 'newer' ? 'הספרייה נפתחה בגרסה חדשה יותר' : 'החיבור לספרייה נסגר'}</h1>
      <p role="alert">{notice === 'blocked' ? 'סגור לשוניות וחלונות נוספים של הספרייה. כשהחסימה תוסר, הפתיחה תמשיך. אפשר גם לבטל את הפתיחה כאן.' : notice === 'versionchange' ? 'השמירה בחלון הזה נעצרה כדי לא לערבב גרסאות. עריכה שטרם נשמרה נשארת על המסך; העתק את הטקסט הדרוש לפני סגירה. סגירת החיבור תאפשר לחלון השני להמשיך.' : notice === 'newer' ? 'קוד ישן אינו יכול לפתוח מסד חדש יותר. פתח את גרסת האפליקציה העדכנית; אין לנסות להקטין גרסת מסד או לאפס נתונים.' : 'פתח מחדש רק לאחר סיום השדרוג בחלון השני. עריכה שלא נשמרה לא תישמר ברענון.'}</p>
      <p>אין איפוס או מחיקה של הספרייה.</p>
      {(notice === 'blocked' || notice === 'versionchange') && <button onClick={closeConnection}>סגירת החיבור בלי איפוס</button>}
      {(notice === 'closed' || notice === 'newer') && <button onClick={() => window.location.reload()}>פתיחה מחדש</button>}
    </dialog>}
  </>;
}
