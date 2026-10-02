import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.env.PWA_TEST_DIST ?? 'dist');
const index = await readFile(resolve(root, 'index.html'), 'utf8');
const entry = index.match(/src="\/library\/(assets\/index-[^"/]+\.js)"/)[1];
let generation = 'one';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ttf': 'font/ttf' };
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4334');
  if (request.method === 'POST' && url.pathname === '/__test/build') { generation = crypto.randomUUID(); response.end('changed'); return; }
  if (!url.pathname.startsWith('/library/')) { response.writeHead(404); response.end(); return; }
  const name = url.pathname.slice('/library/'.length) || 'index.html';
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
  try {
    const variantEntry = entry.replace('.js', `-${generation}.js`);
    let body = await readFile(name === variantEntry ? resolve(root, entry) : path);
    if (name === 'index.html') body = Buffer.from(body.toString().replace(entry, variantEntry));
    // Lazy chunks import shared exports from the entry; keep the entire test module graph consistent.
    if (name.endsWith('.js') && name !== 'service-worker.js') body = Buffer.from(body.toString().replaceAll(entry.slice('assets/'.length), variantEntry.slice('assets/'.length)));
    if (name === variantEntry) body = Buffer.concat([Buffer.from(`/* isolated build ${generation} */\n`), body]);
    if (name === 'service-worker.js') body = Buffer.from(body.toString().replace("const build = '", `const build = '${generation}-`).replaceAll('/library/' + entry, '/library/' + variantEntry));
    response.writeHead(200, { 'Content-Type': types[extname(name)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(body);
  } catch { response.writeHead(404); response.end(); }
}).listen(Number(process.env.PWA_TEST_PORT ?? 4334), '127.0.0.1');
