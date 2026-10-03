import { createCatalogServer, googleBooksServerAdapter } from './catalog-server';
import { nliServerAdapter } from './nli';
import { SqliteCatalogQuota } from './quota';

const key = process.env.GOOGLE_BOOKS_API_KEY, dailyLimit = Number(process.env.GOOGLE_BOOKS_DAILY_LIMIT);
const enabled = key && Number.isInteger(dailyLimit) && dailyLimit > 0;
const nliKey = process.env.NLI_API_KEY, nliDailyLimit = Number(process.env.NLI_DAILY_LIMIT);
const nliEnabled = nliKey && Number.isInteger(nliDailyLimit) && nliDailyLimit > 0 && process.env.NLI_MAPPING_VERIFIED === 'true';
const providers = {
  ...(enabled ? { googlebooks: { adapter: googleBooksServerAdapter(key), dailyLimit } } : {}),
  ...(nliEnabled ? { nli: { adapter: nliServerAdapter(nliKey), dailyLimit: nliDailyLimit } } : {}),
};
// NLI stays disabled by default until normalized live results and approved quota are verified.
const hasProvider = Object.keys(providers).length > 0;
if (hasProvider && !process.env.CATALOG_QUOTA_DB) throw new Error('Configured providers require CATALOG_QUOTA_DB with an absolute persistent file path.');
const quotaStore = hasProvider ? new SqliteCatalogQuota(process.env.CATALOG_QUOTA_DB!) : undefined;
const server = createCatalogServer({ providers, quotaStore });
server.on('close', () => quotaStore?.close());
server.listen(4333, '127.0.0.1', () => console.log('Local catalog service: http://127.0.0.1:4333/health'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.close(); server.closeAllConnections(); });
