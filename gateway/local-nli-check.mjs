import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Loopback-only, fixed public query. This diagnostic is not the production gateway.
export function responseShape(value, secret) {
  const rows = []; let visited = 0;
  function visit(item, path, depth) {
    if (++visited > 500 || depth > 8 || rows.length >= 100) return;
    if (Array.isArray(item)) { rows.push({ path, type: 'array', count: item.length }); if (item.length) visit(item[0], path + '[0]', depth + 1); }
    else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item).slice(0, 30)) if (/^[a-zA-Z_:@0-9.-]{1,80}$/.test(key) && !key.includes(secret) && !/key|token|secret|url|link|href/i.test(key)) visit(child, path + '.' + key, depth + 1);
    } else {
      const type = item === null ? 'null' : typeof item, row = { path, type };
      // Only fixed-query public bibliographic fields, never body/errors/credentials.
      if (/\.(title|creator|author|publisher|date|isbn|recordid|identifier|display|pnx)$/i.test(path) && (typeof item === 'number' || typeof item === 'string' && item.length <= 300 && !item.includes(secret) && !/api_key|https?:\/\//i.test(item))) row.sample = item;
      rows.push(row);
    }
  }
  visit(value, '$', 0); return rows;
}
export async function boundedJson(response, limit = 1024 * 1024) {
  if (!response.body) throw new Error('empty'); let length = 0; const chunks = [], reader = response.body.getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) throw new Error('large'); chunks.push(value); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  finally { await reader.cancel().catch(() => {}); }
}
export function errorHeaderCodes(headers) {
  try {
    const value = headers.get('Errors'); if (!value || value.length > 5000) return [];
    const parsed = JSON.parse(value), rows = Array.isArray(parsed) ? parsed : parsed.Errors;
    return Array.isArray(rows) ? rows.slice(0, 10).flatMap(row => Number.isInteger(row?.code) && row.code >= 1000 && row.code <= 9999 ? [row.code] : []) : [];
  } catch { return []; }
}
export function createNliCheck({ fetcher = fetch, port = 4332 } = {}) {
  const nonce = randomBytes(24).toString('hex'); let result = { state: 'waiting' }, running = false, nextAt = 0;
  const origin = `http://127.0.0.1:${port}`;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.host !== `127.0.0.1:${port}`) return send(403, { state: 'denied' });
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'" });
      return res.end(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>בדיקת חיבור לספרייה הלאומית</title><style nonce="${nonce}">body{font:18px system-ui;max-width:600px;margin:50px auto;padding:20px;color:#213c42}input,button{font:inherit;min-height:44px;width:100%;box-sizing:border-box;margin:12px 0}button{background:#1f4d57;color:white;border:0;border-radius:6px}p{line-height:1.7}</style><h1>חיבור לספרייה הלאומית</h1><p>המפתח ישמש פעם אחת לחיפוש ציבורי קבוע של Jerusalem. הוא יימחק מהשדה, ולא יישמר בקובץ, בדפדפן או ביומן. נשמור רק תוצאת חיבור ומבנה שדות מסונן לצורך התאמת החיבור.</p><label for="key">מפתח הספרייה הלאומית</label><input id="key" type="password" autocomplete="off" spellcheck="false"><button id="check">בדיקת החיבור פעם אחת</button><p id="status" role="status"></p><script nonce="${nonce}">document.getElementById('check').onclick=async()=>{const input=document.getElementById('key'),button=document.getElementById('check'),status=document.getElementById('status');let key=input.value.trim();input.value='';if(!key){status.textContent='הזן מפתח לפני הבדיקה.';return}button.disabled=true;status.textContent='בודק חיבור…';try{const response=await fetch('/check',{method:'POST',headers:{'X-Check-Token':'${nonce}','X-NLI-Key':key,'Content-Type':'application/json'},body:'{}'});key='';const result=await response.json();status.textContent=result.state==='received'?'התקבלה תשובה. אפשר לחזור לצ׳אט ולהמשיך בהתאמת החיבור.':result.state==='rate-limited'?'הספק ביקש להמתין. לא יבוצע ניסיון חוזר אוטומטי.':'החיבור עדיין לא הושלם. אפשר לחזור לצ׳אט עם הודעת המצב בלבד.'}catch{status.textContent='הבדיקה לא הושלמה. לא נשמר מפתח.'}finally{key='';button.disabled=false}}</script></html>`);
    }
    if (req.url === '/result' && req.method === 'GET') return send(200, result);
    if (req.url !== '/check' || req.method !== 'POST') return send(404, { state: 'not-found' });
    if (req.headers.origin !== origin || req.headers['x-check-token'] !== nonce || req.headers['content-type'] !== 'application/json') return send(403, { state: 'denied' });
    if (running || Date.now() < nextAt) return send(429, { state: 'rate-limited' });
    let secret = req.headers['x-nli-key']; delete req.headers['x-nli-key'];
    if (typeof secret !== 'string' || !/^[\x21-\x7e]{10,300}$/.test(secret)) return send(400, { state: 'invalid-key' });
    let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024) return send(413, { state: 'too-large' }); }
    running = true; nextAt = Date.now() + 60000;
    try {
      const url = new URL('https://api.nli.org.il/openlibrary/search');
      for (const [key, value] of Object.entries({ api_key: secret, query: 'title,exact,Jerusalem', output_format: 'json', items_per_page: '2', result_page: '1', material_type: 'books' })) url.searchParams.set(key, value);
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(12000) });
      const diagnostics = { hasErrorsHeader: response.headers.has('Errors'), errorCodes: errorHeaderCodes(response.headers) };
      if (!response.ok) { await response.body?.cancel(); result = { state: response.status === 429 ? 'rate-limited' : 'provider-error', httpStatus: response.status, diagnostics }; }
      else result = { state: 'received', httpStatus: response.status, diagnostics, shape: responseShape(await boundedJson(response), secret) };
    } catch { result = { state: 'not-completed' }; }
    finally {
      // Release the temporary key reference without claiming deterministic memory erasure.
      // eslint-disable-next-line no-useless-assignment
      secret = ''; running = false;
    }
    send(200, result);
  });
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) createNliCheck().listen(4332, '127.0.0.1', () => console.log('Local NLI check ready: http://127.0.0.1:4332/'));
