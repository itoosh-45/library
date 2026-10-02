import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('shares observation, releases the last target and ignores a disposed observer callback for a reused element', async () => {
  const instances: Observer[] = [];
  class Observer {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
    constructor(readonly callback: IntersectionObserverCallback) { instances.push(this); }
    deliver(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  const { observeNearViewport } = await import('./nearViewport');
  const first = {} as Element, second = {} as Element, firstListener = vi.fn(), secondListener = vi.fn();
  const removeFirst = observeNearViewport(first, firstListener), removeSecond = observeNearViewport(second, secondListener);
  expect(instances).toHaveLength(1); instances[0].deliver(first); expect(firstListener).toHaveBeenCalledWith(true);
  removeFirst(); expect(instances[0].disconnect).not.toHaveBeenCalled();
  instances[0].deliver(first); expect(firstListener).toHaveBeenCalledTimes(1);
  removeSecond(); expect(instances[0].disconnect).toHaveBeenCalledTimes(1);
  const nextListener = vi.fn(), removeNext = observeNearViewport(first, nextListener);
  expect(instances).toHaveLength(2); instances[0].deliver(first); expect(nextListener).not.toHaveBeenCalled();
  instances[1].deliver(first); expect(nextListener).toHaveBeenCalledWith(true); removeNext();
});
