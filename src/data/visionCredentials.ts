import Dexie, { type Table } from 'dexie';
import { normalizeVisionKey, personalVisionSession } from './vision';

interface Credential { id: string; key?: string; free?: boolean; consent?: boolean; stopped?: boolean }
class CredentialDatabase extends Dexie {
  credentials!: Table<Credential, string>;
  constructor() { super('itoosh-45.library.credentials.v1'); this.version(1).stores({ credentials: 'id' }); }
}
const credentials = new CredentialDatabase();
export async function rememberVisionKey(key: string, free: boolean, consent: boolean) {
  key = normalizeVisionKey(key);
  if (!free || !consent) throw new Error('נדרש אישור Free והסכמה לשליחת תמונה.');
  await credentials.credentials.put({ id: 'gemini', key, free, consent });
}
export async function forgetVisionKey() { personalVisionSession.clear(); await credentials.credentials.delete('gemini'); }
export async function restoreVisionKey() {
  personalVisionSession.onQuotaStop = () => { void credentials.credentials.put({ id: 'quota-stop', stopped: true }).catch(() => {}); };
  try {
    const stopped = await credentials.credentials.get('quota-stop');
    if (stopped?.stopped) personalVisionSession.stopForQuota();
    const saved = await credentials.credentials.get('gemini');
    if (saved?.key && saved.free === true && saved.consent === true) personalVisionSession.configure(saved.key, true, true);
  } catch { /* Library startup stays available if credential storage is blocked; recognition stays unconfigured. */ }
}
