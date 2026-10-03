import { useRef, useState } from 'react';

const preference = 'itoosh-library.welcome-dismissed.v1';
function firstVisit() {
  try { return localStorage.getItem(preference) !== 'yes'; }
  catch { return true; }
}
const pages = [
  { title: 'נעים להכיר, הספרייה שלך', content: <><p>כל הספרים במקום אחד: חיפוש, מדפים, תגיות, סדרות ומעקב קריאה.</p><p>אפשר לנהל כמה עותקים של ספר ולעקוב למי השאלת כל עותק. להוספת ספר מתחילים בכפתור ״הוספת ספר״.</p><p>צילום ספר או מדף יכול להציע פרטים. בודקים ומאשרים אותם לפני השמירה.</p></> },
  { title: 'הספרייה נשארת אצלך', content: <><p>הספרים נשמרים בדפדפן ובמכשיר הזה. אין חשבון או סנכרון אוטומטי.</p><p>בהגדרות אפשר להוריד גיבוי JSON מלא, כולל התמונות. שמור את הקובץ ובדוק אותו — גם לפני מעבר מכשיר או עדכון.</p><p>Excel מתאים לנתונים בטבלה; הוא אינו גיבוי מלא של התמונות. אחרי הטעינה הראשונה אפשר לנהל את הספרייה גם בלי רשת.</p></> },
  { title: 'רוצה לזהות ספר מתמונה?', content: <><p>חיבור API מאפשר לזיהוי התמונה להשתמש ב־Gemini. החיבור הוא רשות; אפשר להתחיל בהוספה ידנית.</p><ol><li>פתח את Google AI Studio מהקישור בהגדרות וקבל מפתח אישי מפרויקט Free ללא חיוב פעיל. אם המצב לא ברור, אל תחבר.</li><li>בהגדרות, תחת ״מפתח אישי לזיהוי תמונה״, הדבק את המפתח וסמן את אישור Free ואת ההסכמה לשליחת התמונה ל־Google.</li><li>לחץ ״הגדרת המפתח לזיכרון בלבד״. אחרי רענון צריך לחבר שוב. אם המכסה נגמרת, עוצרים בלי תשלום או הוספת קרדיטים.</li></ol><p>חיפוש ב־Open Library אינו דורש מפתח. הספרייה הלאומית ו־Google Books עדיין אינם פעילים באתר הזה.</p></> },
];

export function WelcomeGuide({ settings, onSettings }: { settings: boolean; onSettings: () => void }) {
  const [open, setOpen] = useState(firstVisit);
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  function focusHeading() { requestAnimationFrame(() => heading.current?.focus()); }
  function dismiss(connect = false) {
    // This non-secret UI preference is separate from library backups and schema.
    try { localStorage.setItem(preference, 'yes'); } catch { /* Remains dismissed for this visit when storage is blocked. */ }
    setOpen(false);
    if (connect) onSettings();
    requestAnimationFrame(() => document.getElementById('main-content')?.focus());
  }
  if (!open) return settings ? <div className="setting-note"><button type="button" className="secondary" onClick={() => { setStep(0); setOpen(true); focusHeading(); }}>פתיחת ההיכרות הקצרה</button></div> : null;
  return <section className="welcome-guide" aria-label="היכרות קצרה עם הספרייה">
    <div className="welcome-progress"><span role="status" aria-live="polite">{step + 1} מתוך {pages.length}</span><button type="button" className="secondary" onClick={() => dismiss()}>דילוג להמשך</button></div>
    <h2 ref={heading} tabIndex={-1}>{pages[step].title}</h2>
    {pages[step].content}
    <div className="actions">
      {step > 0 && <button type="button" className="secondary" onClick={() => { setStep(step - 1); focusHeading(); }}>הקודם</button>}
      {step < pages.length - 1 ? <button type="button" onClick={() => { setStep(step + 1); focusHeading(); }}>הבא</button> : <><button type="button" onClick={() => dismiss()}>מתחילים</button><button type="button" className="secondary" onClick={() => dismiss(true)}>פתיחת הגדרות הזיהוי</button></>}
    </div>
    <p className="hint welcome-footer">אפשר לפתוח את ההיכרות שוב מההגדרות.</p>
  </section>;
}
