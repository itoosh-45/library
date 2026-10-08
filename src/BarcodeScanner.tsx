import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { CameraScanner, decodeBarcodeFile, identifierValue, scannedIdentifier, type IdentifierKind } from './data/barcode';
import { errorMessage } from './data/errors';

export default function BarcodeScanner({ onClose, onApply }: { onClose: () => void; onApply: (kind: IdentifierKind, value: string) => void }) {
  const video = useRef<HTMLVideoElement>(null), camera = useRef<CameraScanner | undefined>(undefined), request = useRef(0);
  const [warning, setWarning] = useState(false);
  const [value, setValue] = useState(''), [kind, setKind] = useState<IdentifierKind>('danacode'), [message, setMessage] = useState('');
  const [starting, setStarting] = useState(false), [active, setActive] = useState(false), [loadingImage, setLoadingImage] = useState(false);
  const [torch, setTorch] = useState(false), [capabilities, setCapabilities] = useState({ torch: false, focus: false }), [crop, setCrop] = useState(true);
  useEffect(() => () => { request.current++; camera.current?.stop(); }, []);
  function stop() { request.current++; camera.current?.stop(); setActive(false); setStarting(false); setTorch(false); }
  function received(raw: string) { const code = scannedIdentifier(raw), detectedKind = code.isbn ? 'isbn' : 'danacode'; stop(); setLoadingImage(false); setValue(code.value); setKind(detectedKind); onApply(detectedKind, identifierValue(code.value, detectedKind)); }
  async function start() {
    stop(); setWarning(false); setStarting(true); setMessage('פותח מצלמה…'); const sequence = request.current;
    camera.current = new CameraScanner({ video: video.current!, onCode: raw => { if (sequence === request.current) received(raw); }, onError: message => { if (sequence === request.current) { setWarning(true); setMessage(message); setStarting(false); setActive(false); } }, onReady: result => { if (sequence === request.current) { setCapabilities(result); setActive(true); setStarting(false); setMessage('כוון את הברקוד למסגרת; הסריקה נשארת במכשיר.'); } } });
    camera.current.crop = crop; await camera.current.start();
  }
  async function image(file?: File) {
    if (!file) return; setWarning(false); stop(); const sequence = request.current; setLoadingImage(true); setMessage('מפענח תמונה במכשיר…');
    try { const code = await decodeBarcodeFile(file); if (sequence === request.current) { if (code) received(code); else { setWarning(true); setMessage('לא נקרא ברקוד. נסה תמונה קרובה וברורה או הקלד.'); } } }
    catch (error) { if (sequence === request.current) setWarning(true); setMessage(errorMessage(error)); }
    finally { if (sequence === request.current) setLoadingImage(false); }
  }
  function apply() { try { const identifier = identifierValue(value, kind); stop(); onApply(kind, identifier); } catch (error) { setWarning(true); setMessage(errorMessage(error)); } }
  return <Sheet title="סריקת ברקוד" onClose={() => { stop(); onClose(); }}>
    <p className="hint">סריקת דאנאקוד כברירת מחדל, עם זיהוי ISBN כשקיים. אחרי קריאת ברקוד החיפוש מתחיל אוטומטית; הספר נשמר רק לאחר אישורך.</p>
    <div className="scanner-preview"><video ref={video} playsInline muted aria-label="תצוגת המצלמה" />{active && crop && <div className="scanner-frame" aria-hidden="true" />}</div>
    <div className="actions"><button type="button" disabled={starting || loadingImage || active} onClick={() => void start()}>פתיחת מצלמה אחורית</button>{(starting || active) && <button type="button" className="secondary" onClick={stop}>הפסקת המצלמה</button>}{active && capabilities.torch && <button type="button" className="secondary" aria-pressed={torch} onClick={async () => { try { await camera.current?.torch(!torch); setTorch(!torch); } catch { setMessage('הפנס לא הופעל במכשיר הזה.'); } }}>{torch ? 'כיבוי פנס' : 'הפעלת פנס'}</button>}{active && capabilities.focus && <button type="button" className="secondary" onClick={async () => { try { await camera.current?.focus(); } catch { setMessage('מיקוד ידני אינו זמין. נסה לקרב את הברקוד.'); } }}>מיקוד</button>}</div>
    <label className="check"><input type="checkbox" checked={crop} onChange={event => { setCrop(event.target.checked); if (camera.current) camera.current.crop = event.target.checked; }} />סריקה במסגרת המרכזית</label>
    <label className="field">תמונת ברקוד<input type="file" accept="image/*" disabled={loadingImage} onChange={event => { void image(event.target.files?.[0]); event.target.value = ''; }} /></label>
    <label className="field">צילום ברקוד<input type="file" accept="image/*" capture="environment" disabled={loadingImage} onChange={event => { void image(event.target.files?.[0]); event.target.value = ''; }} /></label>
    <form onSubmit={event => { event.preventDefault(); apply(); }}><label className="field">סוג המזהה<select aria-label="סוג המזהה" value={kind} onChange={event => { stop(); setLoadingImage(false); setKind(event.target.value as IdentifierKind); }}><option value="isbn">ISBN</option><option value="danacode">דאנאקוד</option></select></label><label className="field">מזהה שנקרא או הוקלד<input value={value} inputMode="text" dir="ltr" maxLength={300} onChange={event => { stop(); setLoadingImage(false); setValue(event.target.value); setMessage(''); }} /></label><button type="submit" disabled={!value.trim() || starting || loadingImage}>חיפוש לפי המזהה</button></form>
    <p role={warning ? "alert" : "status"} aria-live="polite" className="form-status">{message}</p>
  </Sheet>;
}
