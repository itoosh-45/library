import { useOnline } from './pwa';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import VisionKey from './VisionKey';
import { personalVisionSession, type VisionOutcome } from './data/vision';
import { fullImage, loadVisionImage, prepareVisionImage, type ImageCrop, type PreparedVisionImage, type VisionImageSource } from './data/visionImage';
import { hashBytes } from './data/images';
import { recognitionFields, type RecognitionField } from './data/recognition';
import type { RecognitionSelection } from './data/catalogSave';
import { errorMessage } from './data/errors';

const labels: Record<RecognitionField, string> = { title: 'שם הספר', authors: 'מחברים', isbn: 'ISBN', danacode: 'דאנאקוד', publisher: 'הוצאה לאור' };
export default function SingleBookVision({ onClose, onApply }: { onClose: () => void; onApply: (selection: RecognitionSelection) => void }) {
  const online = useOnline();
  const sourceRef = useRef<VisionImageSource | undefined>(undefined), sequence = useRef(0);
  const previewRef = useRef<HTMLImageElement>(null);
  const [source, setSource] = useState<VisionImageSource>(), [prepared, setPrepared] = useState<PreparedVisionImage>();
  const [crop, setCrop] = useState<ImageCrop>([...fullImage]), [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [ready, setReady] = useState(personalVisionSession.ready), [working, setWorking] = useState(false), [running, setRunning] = useState(false), [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState<VisionOutcome>(), [selected, setSelected] = useState<RecognitionField[]>([]), [imageHash, setImageHash] = useState(''), [fetchedAt, setFetchedAt] = useState('');
  useEffect(() => () => { sequence.current++; personalVisionSession.cancel(); sourceRef.current?.dispose(); }, []);
  useEffect(() => { if (!prepared) return; const url = URL.createObjectURL(prepared.blob); if (previewRef.current) previewRef.current.src = url; return () => URL.revokeObjectURL(url); }, [prepared]);
  function cancel() { sequence.current++; personalVisionSession.cancel(); setWorking(false); setRunning(false); }
  function invalidate() { cancel(); setPrepared(undefined); setOutcome(undefined); setSelected([]); setMessage(''); }
  async function choose(file?: File) {
    if (!file) return; invalidate(); sourceRef.current?.dispose(); sourceRef.current = undefined; setSource(undefined); setCrop([...fullImage]); setRotation(0); setWorking(true); const request = sequence.current;
    try { const loaded = await loadVisionImage(file); if (request !== sequence.current) { loaded.dispose(); return; } sourceRef.current = loaded; setSource(loaded); setMessage('בדוק כיוון וחיתוך, ואז הכן את התמונה לפני שליחה.'); }
    catch (error) { if (request === sequence.current) setMessage(errorMessage(error)); }
    finally { if (request === sequence.current) setWorking(false); }
  }
  async function prepare() {
    if (!source) return; cancel(); setWorking(true); setOutcome(undefined); setSelected([]); const request = sequence.current;
    try { const image = await prepareVisionImage(source, crop, rotation); if (request !== sequence.current) return; setPrepared(image); setMessage('התמונה הוכנה במכשיר; בדוק שהטקסט קריא לפני השליחה.'); }
    catch (error) { if (request === sequence.current) { setPrepared(undefined); setMessage(errorMessage(error)); } }
    finally { if (request === sequence.current) setWorking(false); }
  }
  async function recognize() {
    if (!prepared || !navigator.onLine) return; cancel(); const request = sequence.current; setWorking(true); setRunning(true); setOutcome(undefined); setSelected([]); setMessage('מזהה את הספר… אפשר לבטל.');
    try {
      const hash = await hashBytes(await prepared.blob.arrayBuffer()); if (request !== sequence.current) return;
      const value = await personalVisionSession.recognize(prepared.blob, () => { if (request === sequence.current) setMessage('המודל הראשי אינו זמין; מנסה פעם אחת את Gemini 3.7 Flash שאושר.'); });
      if (request !== sequence.current) return; setOutcome(value); setImageHash(hash); setFetchedAt(new Date().toISOString()); setMessage(value.result.items.length ? 'בדוק את התוצאה מול התמונה ובחר שדות. הספר עדיין לא נשמר.' : 'לא זוהה ספר קריא. נסה צילום קרוב יותר או הוסף ידנית.');
    } catch (error) { if (request === sequence.current) { setReady(personalVisionSession.ready); setMessage(errorMessage(error)); } }
    finally { if (request === sequence.current) { setWorking(false); setRunning(false); } }
  }
  const item = outcome?.result.items[0];
  return <Sheet title="זיהוי ספר מתמונה" onClose={() => { cancel(); onClose(); }}>
    {!online && <p role="status">זיהוי דורש רשת. בחירה וחיתוך תמונה זמינים במכשיר.</p>}<p className="hint">צלם כריכה, גב או שדרה עם טקסט קריא. בחירת תמונה והכנתה נשארות במכשיר; שליחה דורשת פעולה מפורשת. אין שמירה אוטומטית של ספר.</p>
    <details open={!ready || undefined}><summary>מפתח אישי ותנאי שליחה</summary><VisionKey onChange={value => { cancel(); setReady(value); setOutcome(undefined); setSelected([]); }} /></details>
    <div className="field-grid"><label className="field">בחירת תמונת ספר<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={working} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} /></label><label className="field">צילום ספר במצלמה<input type="file" accept="image/*" capture="environment" disabled={working} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} /></label></div>
    {source && <section><div className="vision-image"><img src={source.url} width={source.width} height={source.height} alt="תמונת הספר לפני חיתוך" /><div className="vision-crop" style={{ left: `${crop[0] * 100}%`, top: `${crop[1] * 100}%`, right: `${(1 - crop[2]) * 100}%`, bottom: `${(1 - crop[3]) * 100}%` }} aria-hidden="true" /></div>
      <fieldset disabled={working}><legend>אזור הזיהוי בתמונה</legend><p className="hint">גבולות באחוזים לפי התמונה המקורית. המסגרת מציגה את האזור שיישלח.</p><div className="field-grid">{['גבול שמאל', 'גבול עליון', 'גבול ימין', 'גבול תחתון'].map((label, i) => <label className="field" key={label}>{label}<input type="number" min={0} max={100} step={1} value={Math.round(crop[i] * 100)} onChange={event => { invalidate(); setCrop(old => old.map((n, index) => index === i ? +event.target.value / 100 : n) as ImageCrop); }} /></label>)}</div><label className="field">סיבוב התמונה<select value={rotation} onChange={event => { invalidate(); setRotation(+event.target.value as typeof rotation); }}><option value={0}>ללא סיבוב</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select></label><button type="button" onClick={() => void prepare()}>הכנת התמונה לזיהוי</button></fieldset>
    </section>}
    {prepared && <section className="notice"><h3>התמונה שתישלח</h3><img ref={previewRef} width={prepared.width} height={prepared.height} className="vision-prepared" alt="תמונה מוכנה לשליחה לזיהוי" /><p className="hint">{prepared.width}×{prepared.height} · JPEG · {Math.ceil(prepared.blob.size / 1024)}KB</p><button type="button" disabled={!ready || working || !online} onClick={() => void recognize()}>שליחת התמונה לזיהוי</button></section>}
    {working && <button type="button" className="secondary" onClick={() => { cancel(); setMessage(running ? 'הזיהוי בוטל. אין ניסיון חוזר אוטומטי.' : 'ההכנה בוטלה.'); }}>ביטול הפעולה</button>}
    <p role="status" aria-live="polite" className="form-status">{message}</p>
    {item && <section className="notice"><h3>בחירת שדות מהתמונה</h3><p className="hint">{outcome?.model}{outcome?.usedBackup ? ' · מודל גיבוי' : ''} · כל השדות מתחילים ללא בחירה.</p>{item.uncertaintyReasons.map((reason, i) => <p className="hint" key={i}>{reason}</p>)}{recognitionFields.filter(field => field === 'authors' ? item.authors.length : item[field]).map(field => <label className="catalog-choice" key={field}><input type="checkbox" checked={selected.includes(field)} onChange={event => setSelected(old => event.target.checked ? [...old, field] : old.filter(value => value !== field))} /><span>{labels[field]}: {field === 'authors' ? item.authors.join(' · ') : item[field]}<small>ראיה: {item.evidenceByField[field].join(' · ')}</small></span></label>)}<details><summary>הטקסט שנקרא בתמונה</summary><p className="visible-text">{item.visibleText}</p></details><button type="button" disabled={!selected.length} onClick={() => { cancel(); onApply({ item, selected, model: outcome!.model, imageHash, fetchedAt }); }}>החלת השדות מהתמונה על הטיוטה</button></section>}
  </Sheet>;
}
