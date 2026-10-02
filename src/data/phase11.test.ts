import { afterEach, expect, it, vi } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import { appendDraftImage, createDraft, overlapSuggestions, pauseDraft, removeDraftSource, retryDraftImage, ShelfQueue, validateDraft } from './shelfDraft';
import { validateShelfRecognition, recognitionModels } from './recognition';
import { VisionError, VisionSession } from './vision';
import { createSnapshot, restoreSnapshot, validateBackup } from './backup';
import { hashBytes } from './images';
import { deleteShelf, saveShelf } from './collections';
import type { StoredImage } from './models';
import { prepareVisionImage, type PreparedVisionImage } from './visionImage';

vi.mock('./visionImage', () => ({
  loadVisionImage: vi.fn(async () => ({ dispose: vi.fn() })),
  prepareVisionImage: vi.fn(async () => ({ blob: new Blob([new Uint8Array([255,216,255,192,0,17,8,8,0,8,0,3,1,17,0,2,17,0,3,17,0,255,217])], { type: 'image/jpeg' }), width: 2048, height: 2048 })),
}));
const databases: LibraryDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const database of databases.splice(0)) await database.delete(); });
async function library() { const database = new LibraryDatabase('phase11-' + crypto.randomUUID()); databases.push(database); await initializeLibrary(database); return database; }
const example = (title = 'ספר מדף') => ({ title, authors: [], isbn: null, danacode: null, publisher: null, visibleText: title, evidenceByField: { title: [title], authors: [], isbn: [], danacode: [], publisher: [] }, imageIndex: 0, bbox: [0,0,0.5,1], uncertaintyReasons: ['מחבר אינו נראה'] });
const result = (titles = ['ספר מדף']) => ({ result: validateShelfRecognition({ items: titles.map(title => example(title)) }), model: recognitionModels.primary, usedBackup: false });
const file = (name = 'synthetic.jpg') => new File([new Uint8Array([255,216,255,217])], name, { type: 'image/jpeg' });
async function source(): Promise<StoredImage> {
  const blob = new Blob([new Uint8Array([255,216,255,192,0,17,8,8,0,8,0,3,1,17,0,2,17,0,3,17,0,255,217])], { type: 'image/jpeg' });
  return { id: crypto.randomUUID(), blob, mimeType: 'image/jpeg', width: 2048, height: 2048, byteLength: blob.size, sha256: await hashBytes(await blob.arrayBuffer()), sourceUrl: null, createdAt: new Date().toISOString() };
}
it('T18 extracts separate copies and volumes without inventing an author; rejects partial or extra output', () => {
  const items = validateShelfRecognition({ items: [example(), example(), example('ספר מדף כרך ב')] }).items; expect(items).toHaveLength(3); expect(items[0].authors).toEqual([]);
  expect(() => validateShelfRecognition({ items: [{ ...example(), isbn: '9780140328721' }] })).toThrow();
  expect(() => validateShelfRecognition({ items: [example()], action: 'leak-key' })).toThrow();
  expect(() => validateShelfRecognition({ items: Array.from({ length: 41 }, () => example()) })).toThrow();
});
it('T18 stores each image before the next serial call, stable IDs and overlaps remain suggestions only', async () => {
  const database = await library(), draft = await createDraft(database, null), observations: number[] = [];
  const recognize = vi.fn(async () => { observations.push((await database.recognitionDrafts.get(draft.id))!.items.length); return result(['ספר מדף', 'ספר מדף כרך ב']); });
  const queue = new ShelfQueue(database, new VisionSession(), recognize);
  await queue.addFile(draft.id, file('first.jpg'), false); await queue.addFile(draft.id, file('second.jpg'), false); await queue.start(draft.id);
  const saved = validateDraft(await database.recognitionDrafts.get(draft.id)); expect(saved.status).toBe('complete'); expect(observations).toEqual([0,2]); expect(saved.items).toHaveLength(4); expect(new Set(saved.items.map(item => item.id)).size).toBe(4); expect(overlapSuggestions(saved)).toHaveLength(2); expect(saved.items.every(item => item.status === 'detected')).toBe(true); expect(await database.books.count()).toBe(0); expect(await database.images.count()).toBe(0);
});
it('T18 pause ignores late results and requires explicit retry of the interrupted request', async () => {
  const database = await library(), draft = await createDraft(database, null); let finish!: (value: ReturnType<typeof result>) => void;
  const recognize = vi.fn(() => new Promise<ReturnType<typeof result>>(resolve => { finish = resolve; })), queue = new ShelfQueue(database, new VisionSession(), recognize);
  const image = await queue.addFile(draft.id, file(), false); const running = queue.start(draft.id); await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1)); await queue.pause(draft.id); finish(result()); await running;
  const saved = (await database.recognitionDrafts.get(draft.id))!; expect(saved.items).toHaveLength(0); expect(saved.images[0].status).toBe('interrupted'); await queue.start(draft.id); expect(recognize).toHaveBeenCalledTimes(1); await retryDraftImage(database, draft.id, image.id); expect((await database.recognitionDrafts.get(draft.id))!.images[0].status).toBe('pending');
});
it('T18 quota and network failure preserve prior results and stop before another image', async () => {
  for (const state of ['quota', 'network'] as const) {
    const database = await library(), draft = await createDraft(database, null);
    const recognize = vi.fn().mockResolvedValueOnce(result()).mockRejectedValueOnce(new VisionError(state, 'synthetic')), queue = new ShelfQueue(database, new VisionSession(), recognize);
    for (let i = 0; i < 3; i++) await queue.addFile(draft.id, file(i + '.jpg'), false); await queue.start(draft.id);
    const saved = (await database.recognitionDrafts.get(draft.id))!; expect(saved.items).toHaveLength(1); expect(saved.images.map(image => image.status)).toEqual(['recognized','error','pending']); expect(saved.status).toBe(state === 'quota' ? 'quota' : 'paused'); expect(recognize).toHaveBeenCalledTimes(2);
    if (state === 'quota') { await expect(queue.start(draft.id)).rejects.toThrow(); await expect(retryDraftImage(database, draft.id, saved.images[1].id)).rejects.toThrow(); expect(recognize).toHaveBeenCalledTimes(2); }
  }
});
it('T18 reload without retained sources requests matching files without replaying completed images', async () => {
  const database = await library(), draft = await createDraft(database, null), first = new ShelfQueue(database, new VisionSession(), async () => result());
  const image = await first.addFile(draft.id, file(), false); first.dispose(); const recognize = vi.fn(async () => result()), second = new ShelfQueue(database, new VisionSession(), recognize);
  await second.start(draft.id); expect(recognize).not.toHaveBeenCalled(); expect((await database.recognitionDrafts.get(draft.id))!.images[0].message).toContain('בחר שוב');
  await expect(second.attachFile(draft.id, image.id, new File(['wrong'], 'wrong.jpg'))).rejects.toThrow(); await second.attachFile(draft.id, image.id, file()); await second.start(draft.id); await second.start(draft.id); expect(recognize).toHaveBeenCalledTimes(1); expect((await database.recognitionDrafts.get(draft.id))!.items).toHaveLength(1);
});
it('T18 durable run ownership blocks a second window and stale output after manual recovery', async () => {
  const database = await library(), draft = await createDraft(database, null); let finish!: (value: ReturnType<typeof result>) => void;
  const recognize = vi.fn(() => new Promise<ReturnType<typeof result>>(resolve => { finish = resolve; })), first = new ShelfQueue(database, new VisionSession(), recognize), second = new ShelfQueue(database, new VisionSession(), async () => result());
  await first.addFile(draft.id, file(), false); const running = first.start(draft.id); await vi.waitFor(() => expect(recognize).toHaveBeenCalledTimes(1)); await expect(second.start(draft.id)).rejects.toThrow('חלון אחר'); await pauseDraft(database, draft.id); finish(result()); await expect(running).rejects.toThrow('מאוחרת'); expect((await database.recognitionDrafts.get(draft.id))!.items).toHaveLength(0);
});
it('T18 protected draft backup restores source, stable IDs and prior results; rejects forged references', async () => {
  const database = await library(), shelf = await saveShelf(database, { name: 'מדף דמה', parentId: null }), draft = await createDraft(database, shelf.id), savedSource = await source();
  await appendDraftImage(database, draft.id, 'synthetic.jpg', 'a'.repeat(64), savedSource);
  const queue = new ShelfQueue(database, new VisionSession(), async () => result()); await queue.start(draft.id);
  const snapshot = await createSnapshot(database), backup = await validateBackup(snapshot.text); expect(JSON.parse(snapshot.text).version).toBe(6); expect(backup.counts.recognitionDrafts).toBe(1); expect(backup.data.recognitionDrafts[0].items).toHaveLength(1);
  await restoreSnapshot(database, backup, snapshot.fingerprint); expect((await database.recognitionDrafts.get(draft.id))!.items[0].id).toBe(backup.data.recognitionDrafts[0].items[0].id); expect((await database.images.get(savedSource.id))!.blob.size).toBe(savedSource.blob.size);
  await removeDraftSource(database, draft.id, backup.data.recognitionDrafts[0].images[0].id); expect(await database.images.count()).toBe(0); expect((await database.recognitionDrafts.get(draft.id))!.items).toHaveLength(1);
  await deleteShelf(database, shelf); expect((await database.recognitionDrafts.get(draft.id))!.shelfId).toBeNull(); await createSnapshot(database);
  const forged = JSON.parse(snapshot.text); forged.data.recognitionDrafts[0].images[0].storedImageId = crypto.randomUUID(); forged.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(forged.data)).buffer); await expect(validateBackup(JSON.stringify(forged))).rejects.toThrow();
});
it('T18 source and draft are atomic on append failure; source retention is explicit', async () => {
  const database = await library(), draft = await createDraft(database, null), write = vi.spyOn(database.recognitionDrafts, 'put').mockRejectedValueOnce(new Error('synthetic-write'));
  await expect(appendDraftImage(database, draft.id, 'synthetic.jpg', 'a'.repeat(64), await source())).rejects.toThrow('synthetic-write'); write.mockRestore(); expect(await database.images.count()).toBe(0); expect((await database.recognitionDrafts.get(draft.id))!.images).toHaveLength(0);
});
it('T18 accepts v5 catalog backup with an explicit empty draft set', async () => {
  const database = await library(), snapshot = await createSnapshot(database), root = JSON.parse(snapshot.text); root.version = 5; delete root.data.recognitionDrafts; delete root.counts.recognitionDrafts; root.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(root.data)).buffer);
  const incoming = await validateBackup(JSON.stringify(root)); expect(incoming.data.recognitionDrafts).toEqual([]); expect(incoming.counts.recognitionDrafts).toBe(0);
});
it('T18 closing during source preparation prevents late image persistence', async () => {
  const database = await library(), draft = await createDraft(database, null), prepared = await source();
  let release!: (image: PreparedVisionImage) => void;
  vi.mocked(prepareVisionImage).mockClear().mockImplementationOnce(() => new Promise<PreparedVisionImage>(resolve => { release = resolve; }));
  const queue = new ShelfQueue(database, new VisionSession()), adding = queue.addFile(draft.id, file(), true);
  await vi.waitFor(() => expect(prepareVisionImage).toHaveBeenCalledTimes(1)); queue.dispose(); release({ blob: prepared.blob, width: prepared.width, height: prepared.height });
  await expect(adding).rejects.toThrow('בוטלה'); expect(await database.images.count()).toBe(0); expect((await database.recognitionDrafts.get(draft.id))!.images).toHaveLength(0);
  await expect(queue.addFile(draft.id, file(), false)).rejects.toThrow('נסגר');
});
