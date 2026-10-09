import { useEffect, useRef, useState, type ReactNode } from 'react';

let locks = 0;
let restoreScroll: (() => void) | undefined;
function lockDocument() {
  if (locks++ === 0) {
    const body = document.body, root = document.documentElement, x = window.scrollX, y = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow, rootOverflow: root.style.overflow };
    // Native modal focus alone does not stop document scrolling in iOS standalone mode.
    Object.assign(body.style, { position: 'fixed', top: `${-y}px`, left: `${-x}px`, width: '100%', overflow: 'hidden' });
    root.style.overflow = 'hidden';
    restoreScroll = () => {
      Object.assign(body.style, { position: previous.position, top: previous.top, left: previous.left, width: previous.width, overflow: previous.overflow });
      root.style.overflow = previous.rootOverflow;
      window.scrollTo({ left: x, top: y, behavior: 'instant' });
      // Native dialog focus restoration and scroll anchoring can run after layout.
      requestAnimationFrame(() => { if (locks === 0) window.scrollTo({ left: x, top: y, behavior: 'instant' }); });
    };
  }
  return () => { if (--locks === 0) { restoreScroll?.(); restoreScroll = undefined; } };
}

export function Sheet({ title, children, onClose, busy = false, dirty = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; dirty?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [discard, setDiscard] = useState(false);
  useEffect(() => {
    const dialog = ref.current!, unlock = lockDocument();
    dialog.showModal();
    return () => {
      dialog.close();
      unlock();
    };
  }, []);
  function close() { if (busy) return; if (dirty) setDiscard(true); else onClose(); }
  return <dialog ref={ref} className="sheet" aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}>
    <header className="sheet-heading"><h2>{title}</h2><button type="button" className="secondary" onClick={close} disabled={busy} aria-label="סגירה">✕</button></header>
    <div className="sheet-content">
      {discard && <section><p>יש שינויים שלא נשמרו. לסגור ולוותר עליהם?</p><div className="actions"><button onClick={onClose}>ויתור על השינויים</button><button className="secondary" onClick={() => setDiscard(false)}>חזרה לעריכה</button></div></section>}
      <div hidden={discard}>{children}</div>
    </div>
  </dialog>;
}
