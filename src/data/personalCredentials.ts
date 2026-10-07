import Dexie, { type Table } from 'dexie';
export interface Credential { id: string; key?: string; free?: boolean; consent?: boolean; stopped?: boolean; stoppedDay?: string }
class CredentialDatabase extends Dexie {
  credentials!: Table<Credential, string>;
  constructor() { super('itoosh-45.library.credentials.v1'); this.version(1).stores({ credentials: 'id' }); }
}
export const personalCredentials = new CredentialDatabase();
