// A live-query update can replace the original row after the editor has closed.
export function restoreBookFocus(original: HTMLElement | null, bookId: string | undefined, scroll: number) {
  let started = false, restoring = false, cancelled = false, frame = 0, target = original;
  const root = document.getElementById('main-content');
  const observer = new MutationObserver(() => { if (started && (!target?.isConnected || target.closest('[hidden]'))) restore(); });
  function cleanup() {
    cancelled = true; observer.disconnect(); clearTimeout(timeout); cancelAnimationFrame(frame);
    document.removeEventListener('focusin', changedFocus);
    for (const event of ['pointerdown', 'keydown', 'wheel']) window.removeEventListener(event, cleanup);
  }
  function changedFocus(event: FocusEvent) { if (started && !restoring && event.target !== target) cleanup(); }
  function restore() {
    const candidate = bookId ? document.querySelector<HTMLButtonElement>(`[data-book-id="${CSS.escape(bookId)}"]:not([hidden]) button`) : null;
    const row = candidate?.closest('[hidden]') ? null : candidate;
    const active = document.activeElement;
    if (active && ![document.body, document.documentElement, root, original, row, target].includes(active as HTMLElement)) { cleanup(); return; }
    target = original?.isConnected && !original.closest('[hidden]') ? original : row ?? root;
    restoring = true; target?.focus({ preventScroll: true }); restoring = false;
    window.scrollTo({ top: scroll, behavior: 'instant' });
  }
  if (root) observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  const timeout = window.setTimeout(cleanup, 2000);
  for (const event of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(event, cleanup, { once: true, passive: true });
  frame = requestAnimationFrame(() => {
    if (cancelled) return;
    started = true; restore(); if (!cancelled) document.addEventListener('focusin', changedFocus);
  });
}
