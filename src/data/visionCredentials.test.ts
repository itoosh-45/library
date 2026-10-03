import { expect, it } from 'vitest';
import { forgetVisionKey, rememberVisionKey, restoreVisionKey } from './visionCredentials';
import { personalVisionSession } from './vision';
import { LibraryDatabase, initializeLibrary } from './database';
import { createFullSnapshot } from './fullBackup';

it('explicit Free/consent credentials survive a new memory session, stay out of JSON and are deleted explicitly', async () => {
  const key = 'synthetic-remembered-gemini-key';
  await expect(rememberVisionKey(key, false, true)).rejects.toThrow();
  await rememberVisionKey(key, true, true); personalVisionSession.clear();
  await restoreVisionKey(); expect(personalVisionSession.ready).toBe(true);
  const db = new LibraryDatabase('synthetic-key-backup-' + crypto.randomUUID());
  try { await initializeLibrary(db); const snapshot = await createFullSnapshot(db); expect(snapshot.text).not.toContain(key); }
  finally { await db.delete(); }
  await forgetVisionKey(); personalVisionSession.clear(); await restoreVisionKey(); expect(personalVisionSession.hasKey).toBe(false);
});
