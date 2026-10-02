import { afterEach, expect, test, vi } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './data/database';
import { updateBlocked } from './updateSafety';

afterEach(() => vi.unstubAllGlobals());
test('updates wait for a real IndexedDB write and release after commit or abort', async () => {
  vi.stubGlobal('document', { querySelector: () => null });
  const db = new LibraryDatabase('pwa-guard-' + crypto.randomUUID());
  try {
    await initializeLibrary(db);
    expect(updateBlocked()).toBe(false);
    await db.transaction('rw', db.settings, async () => {
      expect(updateBlocked()).toBe(true);
      await db.settings.put({ key: 'libraryName', value: 'synthetic' });
      expect(updateBlocked()).toBe(true);
    });
    expect(updateBlocked()).toBe(false);
    await expect(db.transaction('rw', db.settings, async transaction => {
      expect(updateBlocked()).toBe(true);
      await db.settings.put({ key: 'libraryName', value: 'rollback' });
      transaction.abort();
    })).rejects.toThrow();
    // Dexie's rejected promise precedes the native abort event; keep blocking until IndexedDB finishes.
    await expect.poll(() => updateBlocked()).toBe(false);
    expect((await db.settings.get('libraryName'))?.value).toBe('synthetic');
  } finally { await db.delete(); }
});
