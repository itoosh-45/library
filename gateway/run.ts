import { createCatalogServer, googleBooksServerAdapter } from './catalog-server';
import { nliServerAdapter } from './nli';

const key = process.env.GOOGLE_BOOKS_API_KEY, dailyLimit = Number(process.env.GOOGLE_BOOKS_DAILY_LIMIT);
const enabled = key && Number.isInteger(dailyLimit) && dailyLimit > 0;
const nliKey = process.env.NLI_API_KEY, nliDailyLimit = Number(process.env.NLI_DAILY_LIMIT);
const nliEnabled = nliKey && Number.isInteger(nliDailyLimit) && nliDailyLimit > 0 && process.env.NLI_MAPPING_VERIFIED === 'true';
const providers = {
  ...(enabled ? { googlebooks: { adapter: googleBooksServerAdapter(key), dailyLimit } } : {}),
  ...(nliEnabled ? { nli: { adapter: nliServerAdapter(nliKey), dailyLimit: nliDailyLimit } } : {}),
};
// NLI stays disabled by default until normalized live results and approved quota are verified.
createCatalogServer({ providers }).listen(4333, '127.0.0.1', () => console.log('Local catalog service: http://127.0.0.1:4333/health'));
