import { expect, it, vi } from 'vitest';
import { VisionSession, visionModels } from './vision';
import { saveBookSelections } from './catalogSave';
import { emptyInput } from './books';
import { LibraryDatabase, initializeLibrary } from './database';
import { createFullSnapshot } from './fullBackup';
import { validateBackup } from './backup';
const item = { title: 'ספר בדיקה', authors: [], isbn: null, danacode: null, publisher: null, visibleText: 'ספר בדיקה', evidenceByField: { title: ['ספר בדיקה'], authors: [], isbn: [], danacode: [], publisher: [] }, imageIndex: 0 as const, bbox: null, uncertaintyReasons: [] };
it('service failure tries each approved model once in order and stops after success', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValue(Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ items: [item] }) }] } }] }));
  const session = new VisionSession(fetcher); session.configure('SYNTHETIC-NEVER-LIVE-KEY', true, true); const notice = vi.fn();
  const result = await session.recognize(new Blob([new Uint8Array([255,216,255,217])], { type: 'image/jpeg' }), notice);
  expect(result.model).toBe(visionModels.backup2); expect(result.usedBackup).toBe(true); expect(fetcher.mock.calls.map(([url]) => String(url).split('/models/')[1].split(':')[0])).toEqual([visionModels.primary, visionModels.backup, visionModels.backup2]); expect(notice).toHaveBeenCalledTimes(2);
});
it('released 3.8 evidence and new 3.5/3.6 evidence remain valid in the same backup', async () => {
  const db = new LibraryDatabase('model-history-' + crypto.randomUUID());
  try {
    await initializeLibrary(db);
    for (const model of [visionModels.legacy, visionModels.primary, visionModels.backup2]) await saveBookSelections(db, { ...emptyInput, title: item.title }, [], [{ item: { ...item, bbox: null }, selected: ['title'], model, imageHash: 'a'.repeat(64), fetchedAt: new Date().toISOString() }]);
    expect((await validateBackup((await createFullSnapshot(db)).text)).data.metadataSources.map(source => source.recognition?.model).sort()).toEqual([visionModels.legacy, visionModels.primary, visionModels.backup2].sort());
  } finally { await db.delete(); }
});
