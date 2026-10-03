import { createSnapshot, type Snapshot } from './backup';
import type { LibraryDatabase } from './database';

export async function createFullSnapshot(database: LibraryDatabase): Promise<Snapshot> {
  return createSnapshot(database, true);
}

export async function recordBackupProduced(database: LibraryDatabase, at: string) {
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) throw new Error('מועד הגיבוי אינו תקין.');
  await database.settings.put({ key: 'lastBackupAt', value: at });
}

export async function confirmBackupChecked(database: LibraryDatabase, expectedAt: string) {
  await database.transaction('rw', database.settings, async () => {
    if ((await database.settings.get('lastBackupAt'))?.value !== expectedAt) throw new Error('הופק גיבוי חדש. בדוק את הקובץ האחרון לפני האישור.');
    await database.settings.put({ key: 'lastBackupCheckedAt', value: expectedAt });
  });
}
