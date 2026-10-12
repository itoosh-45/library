import { jsonResponse } from './batch.mjs';
export function batchCatalog(token, fetcher = fetch) {
    async function service(path, body, signal, retry = true) {
        const response = await fetcher('http://127.0.0.1:4333' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), signal });
        if (response.status === 429 && retry) {
            const seconds = Number(response.headers.get('retry-after'));
            await response.body?.cancel();
            if (!seconds || seconds > 30)
                return undefined;
            await new Promise((resolve, reject) => { const timer = setTimeout(done, seconds * 1000 + 100); function done() { signal.removeEventListener('abort', abort); resolve(); } function abort() { clearTimeout(timer); reject(new Error('Cancelled')); } signal.addEventListener('abort', abort, { once: true }); });
            return service(path, body, signal, false);
        }
        if (!response.ok) {
            await response.body?.cancel();
            return undefined;
        }
        return response.json();
    }
    return async (names, signal) => {
        const query = { title: names.title ?? '', author: names.authors.join(' '), publisher: '', year: '', isbn: '', danacode: '' }, rows = [];
        try {
            const found = await service('/v1/icl-search', { query }, signal);
            rows.push(...(found?.results ?? []));
            if (rows.length === 1) {
                const resolved = await service('/v1/icl-book', { id: rows[0].recordId }, signal);
                if (resolved?.provider === 'icl') {
                    delete resolved.cached;
                    rows[0] = resolved;
                }
            }
        }
        catch { /* Other catalogs remain available. */ }
        try {
            const found = await service('/v1/nli-search', { query }, signal);
            rows.push(...(found?.results ?? []));
        }
        catch { /* Other catalogs remain available. */ }
        try {
            const params = new URLSearchParams({ title: names.title ?? '', author: names.authors.join(' '), limit: '10', fields: 'key,title,author_name,cover_i' });
            const response = await fetcher('https://openlibrary.org/search.json?' + params, { signal, redirect: 'error' });
            if (response.ok) {
                const found = await jsonResponse(response);
                for (const row of (found.docs ?? []).slice(0, 10)) {
                    if (!/^\/works\/OL\d+W$/.test(row.key) || typeof row.title !== 'string' || row.title.length > 300)
                        continue;
                    rows.push({ provider: 'openlibrary', recordId: row.key, sourceUrl: 'https://openlibrary.org' + row.key, kind: 'work', fetchedAt: new Date().toISOString(), fields: { title: row.title, ...(Array.isArray(row.author_name) ? { authors: row.author_name.filter(name => typeof name === 'string' && name.length <= 150).slice(0, 20) } : {}) }, warnings: ['יצירה כללית: יש לבדוק את המהדורה.'], ...(Number.isSafeInteger(row.cover_i) && row.cover_i > 0 ? { coverUrl: `https://covers.openlibrary.org/b/id/${row.cover_i}-M.jpg?default=false` } : {}) });
                }
            }
            else
                await response.body?.cancel();
        }
        catch { /* Keep already returned candidates. */ }
        return rows.slice(0, 20);
    };
}
