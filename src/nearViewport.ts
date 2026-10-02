const listeners = new Map<Element, (near: boolean) => void>();
let observer: IntersectionObserver | undefined;
export function observeNearViewport(element: Element, listener: (near: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') { listener(true); return () => {}; }
  observer ??= new IntersectionObserver((entries, source) => {
    if (source !== observer) return;
    for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: '600px 0px' });
  listeners.set(element, listener); observer.observe(element);
  return () => {
    observer?.unobserve(element); listeners.delete(element);
    if (!listeners.size) { observer?.disconnect(); observer = undefined; }
  };
}
