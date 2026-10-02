/* global __ASSET_LIST__ */
/* The build replaces these two constants. Only public build files enter this cache. */
const build = '__BUILD_ID__';
const assets = __ASSET_LIST__;
const prefix = 'itoosh-library-shell-';
const cacheName = prefix + build;
const paths = new Set(assets);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try { await cache.addAll(assets.map(url => new Request(url, { cache: 'reload' }))); }
    catch (error) { await caches.delete(cacheName); throw error; }
  })());
});
async function cleanOldShells() {
  for (const name of await caches.keys()) if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
}
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Natural activation with no windows is safe. Explicit activation retains old lazy chunks until reload.
    if (!(await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).some(client => new URL(client.url).pathname.startsWith('/library/'))) await cleanOldShells();
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || request.headers.has('x-goog-api-key') || request.headers.has('authorization')) return;
  const navigation = request.mode === 'navigate' && url.pathname.startsWith('/library/');
  if (!navigation && !paths.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(navigation ? '/library/index.html' : url.pathname) ?? fetch(request);
  })());
});
self.addEventListener('message', event => {
  if (!event.source || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => new URL(client.url).pathname.startsWith('/library/'));
    if (windows.length !== 1 || windows[0].id !== event.source.id) { port.postMessage('OTHER_WINDOWS'); return; }
    if (event.data === 'ACTIVATE_UPDATE') { port.postMessage('ACTIVATING'); await self.skipWaiting(); }
    if (event.data?.type === 'CLEAN_OLD_SHELLS') {
      if (self.registration.waiting || self.registration.installing) { port.postMessage('UPDATE_PENDING'); return; }
      const shell = new URL(event.data.shellModule, self.location.origin);
      // An old open page may still use old lazy chunks after controllerchange.
      if (shell.origin !== self.location.origin || !paths.has(shell.pathname) || !shell.pathname.endsWith('.js')) { port.postMessage('OLD_SHELL'); return; }
      await cleanOldShells();
      port.postMessage('CLEANED');
    }
  })());
});
