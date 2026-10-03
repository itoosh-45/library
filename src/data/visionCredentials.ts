import Dexie, { type Table } from 'dexie';
import { normalizeVisionKey, geminiQuotaDay, geminiVisionSession, groqVisionSession } from './vision';

interface Credential { id: string; key?: string; free?: boolean; consent?: boolean; stopped?: boolean; stoppedDay?: string }
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
export async function forgetVisionKey() { geminiVisionSession.clear(); await credentials.credentials.delete('gemini'); }
export async function restoreVisionKey() {
  geminiVisionSession.onQuotaStop = () => { void credentials.credentials.put({ id: 'quota-stop', stopped: true, stoppedDay: geminiQuotaDay() }).catch(() => {}); };
  try {
    const stopped = await credentials.credentials.get('quota-stop');
    if (stopped?.stopped) geminiVisionSession.stopForQuota(stopped.stoppedDay??geminiQuotaDay());
    const groq = await credentials.credentials.get('groq');
    if (groq?.key && groq.free === true && groq.consent === true) groqVisionSession.configure(groq.key,true,true);
    const saved = await credentials.credentials.get('gemini');
    if (saved?.key && saved.free === true && saved.consent === true) geminiVisionSession.configure(saved.key, true, true);
  } catch { /* Library startup stays available if credential storage is blocked; recognition stays unconfigured. */ }
}

export async function rememberGroqKey(key: string, free: boolean, consent: boolean) {
  key=normalizeVisionKey(key);if(!free||!consent)throw new Error('נדרש מסלול Free והסכמה לשליחת התמונה ל-Groq.');
  await credentials.credentials.put({id:'groq',key,free,consent});
}
export async function forgetGroqKey() { groqVisionSession.clear();await credentials.credentials.delete('groq'); }
