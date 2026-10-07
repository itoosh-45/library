import { useOnline } from './pwa';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import VisionKey from './VisionKey';
import { personalVisionSession, visionFailureMessage, type VisionFailure, type VisionOutcome } from './data/vision';
import { fullImage, loadVisionImage, prepareVisionImage, type ImageCrop, type PreparedVisionImage, type VisionImageSource } from './data/visionImage';
import { hashBytes } from './data/images';
import { recognitionFields, recognitionModels, type RecognitionField } from './data/recognition';
import type { RecognitionSelection } from './data/catalogSave';
import { errorMessage } from './data/errors';

const labels: Record<RecognitionField, string> = { title: 'שם הספר', authors: 'מחברים', isbn: 'ISBN', danacode: 'דאנאקוד', publisher: 'הוצאה לאור' };
export default function SingleBookVision({ onClose, onApply, simple = false }: { simple?: boolean; onClose: () => void; onApply: (selection: RecognitionSelection, searchAfter?: boolean, review?: { title: string; authors: string[] }) => void }) {
  const online = useOnline();
  const [method,setMethod]=useState<'auto'|'local'>(personalVisionSession.hasKey?'auto':'local');
  const sourceRef = useRef<VisionImageSource | undefined>(undefined), sequence = useRef(0);
  const previewRef = useRef<HTMLImageElement>(null);
  const [source, setSource] = useState<VisionImageSource>(), [prepared, setPrepared] = useState<PreparedVisionImage>();
  const [crop, setCrop] = useState<ImageCrop>([...fullImage]), [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [ready, setReady] = useState(personalVisionSession.ready), [working, setWorking] = useState(false), [running, setRunning] = useState(false), [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState<VisionOutcome>(), [selected, setSelected] = useState<RecognitionField[]>([]), [imageHash, setImageHash] = useState(''), [fetchedAt, setFetchedAt] = useState('');
  const [reviewTitle, setReviewTitle] = useState(''), [reviewAuthor, setReviewAuthor] = useState('');
  const [failures, setFailures] = useState<VisionFailure[]>([]);
  useEffect(() => () => { sequence.current++; personalVisionSession.cancel(); sourceRef.current?.dispose(); }, []);
  useEffect(() => { if (!prepared) return; const url = URL.createObjectURL(prepared.blob); if (previewRef.current) previewRef.current.src = url; return () => URL.revokeObjectURL(url); }, [prepared]);
  function cancel() { sequence.current++; personalVisionSession.cancel(); setWorking(false); setRunning(false); }
  function invalidate() { cancel(); setPrepared(undefined); setOutcome(undefined); setSelected([]); setMessage(''); setFailures([]); }
  async function choose(file?: File) {
    if (!file) return; invalidate(); sourceRef.current?.dispose(); sourceRef.current = undefined; setSource(undefined); setCrop([...fullImage]); setRotation(0); setWorking(true); const request = sequence.current;
    try {
      const loaded = await loadVisionImage(file); if (request !== sequence.current) { loaded.dispose(); return; }
      sourceRef.current = loaded; setSource(loaded);
      const image = await prepareVisionImage(loaded, fullImage, 0, method === 'local'); if (request !== sequence.current) return;
      setPrepared(image);
      if (method==='local' || personalVisionSession.hasKey) await recognize(image);
      else setMessage('התמונה המלאה מוכנה לשליחה, ללא צורך בחיתוך. חבר מפתח אישי כדי לזהות.');
    }
    catch (error) { if (request === sequence.current) setMessage(errorMessage(error)); }
    finally { if (request === sequence.current) setWorking(false); }
  }
  async function prepare() {
    if (!source) return; cancel(); setWorking(true); setOutcome(undefined); setSelected([]); const request = sequence.current;
    try { const image = await prepareVisionImage(source, crop, rotation, method === 'local'); if (request !== sequence.current) return; setPrepared(image); setMessage('התמונה הוכנה במכשיר; בדוק שהטקסט קריא לפני השליחה.'); }
    catch (error) { if (request === sequence.current) { setPrepared(undefined); setMessage(errorMessage(error)); } }
    finally { if (request === sequence.current) setWorking(false); }
  }
  async function recognize(image = prepared) {
    if (!image) return; cancel(); const request = sequence.current; setWorking(true); setRunning(true); setOutcome(undefined); setSelected([]); setFailures([]); setMessage('מזהה את הספר… אפשר לבטל.');
    try {
      const hash = await hashBytes(await image.blob.arrayBuffer()); if (request !== sequence.current) return;
      const value = await personalVisionSession.recognize(image.blob, reason => { if (request === sequence.current) setMessage(reason ?? 'מנסה זיהוי חלופי…'); }, 'single', method==='local', failure => { if (request === sequence.current) setFailures(old => [...old, failure]); });
      if (request === sequence.current) setReady(personalVisionSession.ready);
      if (request !== sequence.current) return; setOutcome(value); setReviewTitle(value.result.items[0]?.title ?? ''); setReviewAuthor(value.result.items[0]?.authors.join(' · ') ?? ''); setImageHash(hash); setFetchedAt(new Date().toISOString()); setMessage(value.result.items.length ? 'בדוק ותקן את שם הספר והמחבר. להריץ חיפוש לפי הפרטים?' : 'לא זוהה ספר קריא. נסה צילום קרוב יותר או הוסף ידנית.');
    } catch (error) { if (request === sequence.current) { setReady(personalVisionSession.ready); setMessage(errorMessage(error)); } }
    finally { if (request === sequence.current) { setWorking(false); setRunning(false); } }
  }
  const item = outcome?.result.items[0];
  const available = item ? recognitionFields.filter(field => field === 'authors' ? item.authors.length : item[field]) : [];
  const appliedFields = simple ? available.filter(field => field === 'title' || field === 'authors') : selected;
  function apply(searchAfter = false) {
    if (!item || !outcome) return;
    cancel(); onApply({ item, selected: appliedFields, model: outcome.model, imageHash, fetchedAt }, searchAfter, simple ? { title: reviewTitle.trim(), authors: reviewAuthor.split(' · ').map(name => name.trim()).filter(Boolean) } : undefined);
  }
  return <Sheet title="זיהוי ספר מתמונה" onClose={() => { cancel(); onClose(); }}>
    {!online && <p role="status">אין רשת. OCR מקומי זמין במכשיר.</p>}<p className="hint">צלם כריכה או שדרה בעברית כדי לזהות שם ספר ומחבר. בחר או צלם תמונה. כשהמפתח האישי והסכמת השליחה מוגדרים, התמונה המלאה תישלח אוטומטית לזיהוי. אין צורך בחיתוך ואין שמירה אוטומטית של ספר.</p>
    <label className="field">דרך הזיהוי<select aria-label="דרך הזיהוי" value={method} disabled={working} onChange={event=>{invalidate();setMethod(event.target.value as 'auto'|'local');}}><option value="auto">Gemini · Groq · OCR כגיבוי</option><option value="local">OCR מקומי · ללא API</option></select></label>
    {method==='auto' && (!simple || !ready) && <details open={!ready || undefined}><summary>מפתח אישי ותנאי שליחה</summary><VisionKey onChange={value => { cancel(); setReady(value); setOutcome(undefined); setSelected([]); }} /></details>}
    <div className="field-grid"><label className="field">בחירת תמונת ספר<input type="file" accept="image/*" disabled={working} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} /></label><label className="field">צילום ספר במצלמה<input type="file" accept="image/*" capture="environment" disabled={working} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} /></label></div>
    {source && !simple && <section><div className="vision-image"><img src={source.url} width={source.width} height={source.height} alt="תמונת הספר לפני חיתוך" /><div className="vision-crop" style={{ left: `${crop[0] * 100}%`, top: `${crop[1] * 100}%`, right: `${(1 - crop[2]) * 100}%`, bottom: `${(1 - crop[3]) * 100}%` }} aria-hidden="true" /></div>
      <fieldset disabled={working}><legend>אזור הזיהוי בתמונה</legend><p className="hint">גבולות באחוזים לפי התמונה המקורית. המסגרת מציגה את האזור שיישלח.</p><div className="field-grid">{['גבול שמאל', 'גבול עליון', 'גבול ימין', 'גבול תחתון'].map((label, i) => <label className="field" key={label}>{label}<input type="number" min={0} max={100} step={1} value={Math.round(crop[i] * 100)} onChange={event => { invalidate(); setCrop(old => old.map((n, index) => index === i ? +event.target.value / 100 : n) as ImageCrop); }} /></label>)}</div><label className="field">סיבוב התמונה<select value={rotation} onChange={event => { invalidate(); setRotation(+event.target.value as typeof rotation); }}><option value={0}>ללא סיבוב</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select></label><button type="button" onClick={() => void prepare()}>הכנת התמונה לזיהוי</button></fieldset>
    </section>}
    {prepared && <section className="notice"><h3>התמונה לזיהוי</h3><img ref={previewRef} width={prepared.width} height={prepared.height} className="vision-prepared" alt="תמונה מוכנה לשליחה לזיהוי" /><p className="hint">{prepared.width}×{prepared.height} · JPEG · {Math.ceil(prepared.blob.size / 1024)}KB</p><button type="button" disabled={working || method==='auto'&&!personalVisionSession.hasKey} onClick={() => void recognize()}>זיהוי התמונה</button></section>}
    {working && <button type="button" className="secondary" onClick={() => { cancel(); setMessage(running ? 'הזיהוי בוטל. אין ניסיון חוזר אוטומטי.' : 'ההכנה בוטלה.'); }}>ביטול הפעולה</button>}
    <p role="status" aria-live="polite" className="form-status">{message}</p>
    {(outcome || failures.length > 0) && <section className="notice" aria-label="אבחון הזיהוי">{outcome && <p>הזיהוי בוצע באמצעות {outcome.model === recognitionModels.ocr ? 'OCR מקומי' : outcome.model === recognitionModels.groq ? 'Groq' : 'Gemini'}.</p>}{failures.map((failure, i) => <p key={i}>{visionFailureMessage(failure)}</p>)}{failures.some(failure => failure.state === 'key') && <p>בדוק את המפתח והרשאותיו אצל הספק. שמירת מפתח באפליקציה אינה בדיקת חיבור.</p>}</section>}
    {item && <section className="notice"><h3>{simple ? 'פרטי הספר שזוהה' : 'בחירת שדות מהתמונה'}</h3>{!simple && <p className="hint">{outcome?.model}{outcome?.usedBackup ? ' · מודל גיבוי' : ''} · כל השדות מתחילים ללא בחירה.</p>}{item.uncertaintyReasons.map((reason, i) => <p className="hint" key={i}>{reason}</p>)}{simple && <><label className="field">שם הספר שזוהה<input value={reviewTitle} maxLength={1000} onChange={event => setReviewTitle(event.target.value)} /></label><label className="field">מחבר שזוהה<input value={reviewAuthor} maxLength={1000} onChange={event => setReviewAuthor(event.target.value)} /></label><p>להריץ חיפוש לפי הפרטים?</p></>}{(!simple ? available : []).map(field => <label className="catalog-choice" key={field}><input type="checkbox" checked={selected.includes(field)} onChange={event => setSelected(old => event.target.checked ? [...old, field] : old.filter(value => value !== field))} /><span>{labels[field]}: {field === 'authors' ? item.authors.join(' · ') : item[field]}<small>ראיה: {item.evidenceByField[field].join(' · ')}</small></span></label>)}<details><summary>הטקסט שנקרא בתמונה</summary><p className="visible-text">{item.visibleText}</p></details><div className="actions">{simple && <button type="button" disabled={working || !reviewTitle.trim() && !reviewAuthor.trim()} onClick={() => apply(true)}>חפש לפי הפרטים</button>}<button type="button" disabled={working || (simple ? !reviewTitle.trim() && !reviewAuthor.trim() : !appliedFields.length)} onClick={() => apply()}>{simple ? 'שימוש בפרטים ללא חיפוש' : 'החלת השדות מהתמונה על הטיוטה'}</button></div></section>}
  </Sheet>;
}
