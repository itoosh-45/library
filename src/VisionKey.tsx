import { useState } from 'react';
import { personalVisionSession } from './data/vision';
import { errorMessage } from './data/errors';

export default function VisionKey({ onChange }: { onChange?: (ready: boolean) => void }) {
  const [key, setKey] = useState(''), [free, setFree] = useState(false), [consent, setConsent] = useState(false), [ready, setReady] = useState(personalVisionSession.ready), [message, setMessage] = useState('');
  function forget() { personalVisionSession.clear(); setKey(''); setFree(false); setConsent(false); setReady(false); setMessage('המפתח נמחק מהזיכרון.'); onChange?.(false); }
  return <section className="vision-key" data-update-blocked={!!key || (!ready && (free || consent))}><h3>מפתח אישי לזיהוי תמונה</h3><p className="hint">המפתח נשאר בזיכרון עד רענון או מחיקה. התמונה המוכנה תישלח ל־Google Gemini; לא נשלחים הספרייה או ההערות שלך. במסלול החינמי Google עשויה להשתמש בתוכן לשיפור מוצריה.</p><p className="hint">אין תשלום, טעינה או חידוש. בדוק ב־<a href="https://aistudio.google.com/api-keys" target="_blank" rel="noopener noreferrer">Google AI Studio</a> שהפרויקט של המפתח מסומן Free ושאין בו חיוב פעיל. אם המצב אינו ברור, השאר את הזיהוי חסום.</p>
    {ready && personalVisionSession.ready ? <div className="actions"><p role="status">מפתח אישי זמין בזיכרון.</p><button type="button" className="secondary" onClick={forget}>מחיקת המפתח מהזיכרון</button></div> : <form onSubmit={event => { event.preventDefault(); try { personalVisionSession.configure(key.trim(), free, consent); const enabled = personalVisionSession.ready; setKey(''); setReady(enabled); setMessage(enabled ? 'המפתח הוגדר בזיכרון בלבד.' : 'השליחה נשארה חסומה.'); onChange?.(enabled); } catch (error) { setMessage(errorMessage(error)); } }}>
      <label className="field">מפתח Gemini אישי<input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} dir="ltr" maxLength={4096} value={key} onChange={event => setKey(event.target.value)} /></label><p className="hint">הגדרה בזיכרון אינה בדיקת חיבור ל־Google. המפתח נבדק בשירות רק כששולחים תמונה לזיהוי.</p>
      <label className="check"><input type="checkbox" checked={free} onChange={event => setFree(event.target.checked)} />בדקתי שהפרויקט של המפתח הוא Free, ללא חיוב פעיל</label><label className="check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />אני מסכים לשליחת התמונה המוכנה ל־Google Gemini</label><button type="submit" disabled={!key.trim() || !free || !consent}>הגדרת המפתח לזיכרון בלבד</button>
    </form>}{personalVisionSession.hasKey && !(ready && personalVisionSession.ready) && <button type="button" className="secondary" onClick={forget}>מחיקת המפתח מהזיכרון</button>}{message && <p role="status" className="form-status">{message}</p>}
  </section>;
}
