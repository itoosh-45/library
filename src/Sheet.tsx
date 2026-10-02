import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Sheet({ title, children, onClose, busy = false, dirty = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; dirty?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [discard, setDiscard] = useState(false);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  function close() { if (busy) return; if (dirty) setDiscard(true); else onClose(); }
  return <dialog ref={ref} className="sheet" aria-label={title} onCancel={event => { event.preventDefault(); close(); }}>
    <header className="sheet-heading"><h2>{title}</h2><button type="button" className="secondary" onClick={close} disabled={busy} aria-label="סגירה">✕</button></header>
    {discard ? <section><p>יש שינויים שלא נשמרו. לסגור ולוותר עליהם?</p><div className="actions"><button onClick={onClose}>ויתור על השינויים</button><button className="secondary" onClick={() => setDiscard(false)}>חזרה לעריכה</button></div></section> : children}
  </dialog>;
}
