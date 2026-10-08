import { existsSync, readFileSync } from 'node:fs';
import { nliServerAdapter } from './nli/nli-adapter.mjs';
import { createGoodreadsService } from './service.mjs';
const server = createGoodreadsService({ token: readFileSync('/run/secrets/library-token', 'utf8').trim(), origins: ['https://itoosh-45.github.io'], path: '/data/goodreads.sqlite', dailyLimit: 200, ...(existsSync('/run/secrets/nli-api-key') ? {nliAdapter:nliServerAdapter(readFileSync('/run/secrets/nli-api-key','utf8').trim())} : {}) });
server.listen(4333, '0.0.0.0');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
