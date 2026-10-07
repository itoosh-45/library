/* global __ASSET_LIST__ */
/* The build replaces these two constants. Only public build files enter this cache. */
const build = '37074b8554a9e74cdec2';
const assets = ["/library/assets/BarcodeScanner-BWb-XA2L.js","/library/assets/ExcelPanel-Bjhy483i.js","/library/assets/GoodreadsKey-BhuYmV_G.js","/library/assets/GroqKey-FFTgrYa3.js","/library/assets/SingleBookVision-DXEZzxyc.js","/library/assets/VisionKey-Dfhqe-VO.js","/library/assets/books-iCSgu1gJ.js","/library/assets/esm-BGRWGqjG.js","/library/assets/esm-BmjxaYUB.js","/library/assets/import-wrapper-prod-grVYEHYo.js","/library/assets/index-DSPwBJQE.css","/library/assets/index-Dzx19bMj.js","/library/assets/jsx-runtime-Besl1jO2.js","/library/assets/localOcr-BI_G96LO.js","/library/assets/metadata-CrAPK2iS.js","/library/assets/personalCredentials-CiOguQM7.js","/library/assets/preload-helper-7WFGDMz2.js","/library/assets/recognition-B1kBe_Rl.js","/library/assets/vision-CyHviR3t.js","/library/assets/visionTypes-BFMlA9qZ.js","/library/index.html","/library/fonts/Heebo-OFL.txt","/library/fonts/Heebo.ttf","/library/icons/book-192.png","/library/icons/book-512.png","/library/icons/book-maskable-512.png","/library/manifest.webmanifest","/library/ocr/LICENSE.tessdata.txt","/library/ocr/LICENSE.tesseract.txt","/library/ocr/eng.traineddata.gz","/library/ocr/heb.traineddata.gz","/library/ocr/tesseract-core-lstm.js","/library/ocr/tesseract-core-lstm.wasm","/library/ocr/worker.min.js","/library/templates/Books-template.xlsx","/library/templates/full-example.xlsx"];
const scope = new URL(self.registration.scope).pathname;
// Preserve the released default cache namespace; other paths must not share its cleanup prefix.
const prefix = scope === '/library/' ? 'itoosh-library-shell-' : 'itoosh-library-path-shell-' + encodeURIComponent(scope) + '-';
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
    if (!(await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).some(client => new URL(client.url).pathname.startsWith(scope))) await cleanOldShells();
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || request.headers.has('x-goog-api-key') || request.headers.has('authorization')) return;
  const navigation = request.mode === 'navigate' && url.pathname.startsWith(scope);
  if (!navigation && !paths.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(navigation ? scope + 'index.html' : url.pathname) ?? fetch(request);
  })());
});
self.addEventListener('message', event => {
  if (!event.source || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    const windows = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => new URL(client.url).pathname.startsWith(scope));
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
