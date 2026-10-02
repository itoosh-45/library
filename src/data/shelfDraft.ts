import type { LibraryDatabase } from './database';
import type { DraftImage, DraftItem, RecognitionDraft, StoredImage } from './models';
import { LibraryValidationError, normalizeText } from './library';
import { recognitionFields, recognitionModels, shelfRecognitionVersion, validateRecognition, validateShelfRecognition } from './recognition';
import { hashBytes, jpegDimensions } from './images';
import { loadVisionImage, prepareVisionImage } from './visionImage';
import { VisionError, VisionSession, type VisionOutcome } from './vision';

const fail = (message = 'טיוטת המדף אינה תקינה.'): never => { throw new LibraryValidationError(message); };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) return fail();
  return row;
}
export function validateDraft(value: unknown): RecognitionDraft {
  const row = exact(value, ['id', 'batchId', 'version', 'shelfId', 'images', 'items', 'status', 'runId', 'updatedAt', 'revision']);
  if (!uuid(row.id) || row.batchId !== row.id || row.version !== shelfRecognitionVersion || (row.shelfId !== null && !uuid(row.shelfId)) || !['paused', 'running', 'quota', 'complete'].includes(row.status as string) || (row.runId !== null && !uuid(row.runId)) || (row.status === 'running') !== (row.runId !== null) || !date(row.updatedAt) || !Number.isSafeInteger(row.revision) || (row.revision as number) < 1 || !Array.isArray(row.images) || !Array.isArray(row.items)) return fail();
  const imageIds = new Set<string>(), itemIds = new Set<string>();
  for (const value of row.images) {
    const image = exact(value, ['id', 'name', 'inputHash', 'storedImageId', 'preparedHash', 'status', 'message']);
    if (!uuid(image.id) || imageIds.has(image.id) || typeof image.name !== 'string' || !image.name.trim() || image.name.length > 300 || !hash(image.inputHash) || (image.storedImageId !== null && !uuid(image.storedImageId)) || (image.preparedHash !== null && !hash(image.preparedHash)) || !['pending', 'processing', 'recognized', 'error', 'interrupted'].includes(image.status as string) || (image.message !== null && (typeof image.message !== 'string' || image.message.length > 500))) return fail();
    if (image.status === 'recognized' && !image.preparedHash) return fail();
    imageIds.add(image.id);
  }
  if ((row.images as DraftImage[]).filter(image => image.status === 'processing').length > 1) return fail();
  for (const value of row.items) {
    const item = exact(value, ['id', 'imageId', 'item', 'model', 'fetchedAt', 'status', 'selectedFields', 'bookId', 'copyId']);
    if (!uuid(item.id) || itemIds.has(item.id) || !imageIds.has(item.imageId as string) || !(row.images as DraftImage[]).some(image => image.id === item.imageId && image.status === 'recognized') || !Object.values(recognitionModels).includes(item.model as never) || !date(item.fetchedAt) || !['detected', 'reviewed', 'approved', 'saved', 'removed'].includes(item.status as string) || !Array.isArray(item.selectedFields) || new Set(item.selectedFields).size !== item.selectedFields.length || item.selectedFields.some(field => !recognitionFields.includes(field)) || (item.bookId !== null && !uuid(item.bookId)) || (item.copyId !== null && !uuid(item.copyId)) || (item.status === 'saved' ? !item.bookId || !item.copyId : item.bookId !== null || item.copyId !== null)) return fail();
    const checked = validateRecognition({ items: [item.item] }).items[0];
    if (JSON.stringify(checked) !== JSON.stringify(item.item)) return fail();
    if (item.selectedFields.some(field => field === 'authors' ? !checked.authors.length : !checked[field as keyof typeof checked])) return fail();
    itemIds.add(item.id);
  }
  return structuredClone(row) as unknown as RecognitionDraft;
}
function touch(draft: RecognitionDraft) { draft.updatedAt = new Date().toISOString(); draft.revision++; return validateDraft(draft); }
async function checkStoredSource(image: StoredImage) {
  exact(image, ['id', 'blob', 'mimeType', 'width', 'height', 'byteLength', 'sha256', 'sourceUrl', 'createdAt']);
  if (!uuid(image.id) || !hash(image.sha256) || !date(image.createdAt) || image.sourceUrl !== null || image.mimeType !== 'image/jpeg' || !(image.blob instanceof Blob) || image.blob.type !== 'image/jpeg' || image.byteLength !== image.blob.size || !image.byteLength || image.byteLength > 1.5 * 1024 * 1024 || !Number.isInteger(image.width) || !Number.isInteger(image.height) || Math.min(image.width, image.height) < 1 || Math.max(image.width, image.height) > 2048) return fail('מקור התמונה אינו תקין.');
  const bytes = await image.blob.arrayBuffer(), dimensions = jpegDimensions(new Uint8Array(bytes));
  if (dimensions?.width !== image.width || dimensions.height !== image.height || await hashBytes(bytes) !== image.sha256) return fail('מקור התמונה נפגם.');
}
export async function createDraft(database: LibraryDatabase, shelfId: string | null): Promise<RecognitionDraft> {
  const id = crypto.randomUUID(), draft: RecognitionDraft = { id, batchId: id, version: shelfRecognitionVersion, shelfId, images: [], items: [], status: 'paused', runId: null, updatedAt: new Date().toISOString(), revision: 1 };
  return database.transaction('rw', database.recognitionDrafts, database.shelves, async () => {
    if (shelfId !== null && !await database.shelves.get(shelfId)) return fail('המדף אינו קיים.');
    await database.recognitionDrafts.add(validateDraft(draft)); return draft;
  });
}
async function mutate(database: LibraryDatabase, id: string, action: (draft: RecognitionDraft) => void, runId?: string): Promise<RecognitionDraft> {
  return database.transaction('rw', database.recognitionDrafts, async () => {
    const row = await database.recognitionDrafts.get(id); if (!row) return fail('הטיוטה אינה קיימת.');
    const draft = validateDraft(row); if (runId && draft.runId !== runId) return fail('התור השתנה. התוצאה המאוחרת לא נשמרה.');
    action(draft); const next = touch(draft); await database.recognitionDrafts.put(next); return next;
  });
}
export async function appendDraftImage(database: LibraryDatabase, id: string, name: string, inputHash: string, stored?: StoredImage): Promise<DraftImage> {
  if (stored) await checkStoredSource(stored);
  const image: DraftImage = { id: crypto.randomUUID(), name: name.slice(0, 300) || 'תמונת מדף', inputHash, storedImageId: stored?.id ?? null, preparedHash: stored?.sha256 ?? null, status: 'pending', message: null };
  await database.transaction('rw', database.recognitionDrafts, database.images, async () => {
    if (stored) await database.images.add(stored);
    await mutate(database, id, draft => { if (draft.status === 'running') return fail('השהה את התור לפני הוספת תמונות.'); draft.images.push(image); if (draft.status === 'complete') draft.status = 'paused'; });
  }); return image;
}
export async function pauseDraft(database: LibraryDatabase, id: string): Promise<RecognitionDraft> {
  return mutate(database, id, draft => { draft.runId = null; if (draft.status !== 'quota') draft.status = 'paused'; for (const image of draft.images) if (image.status === 'processing') { image.status = 'interrupted'; image.message = 'הבקשה נקטעה; אין שליחה חוזרת אוטומטית.'; } });
}
export async function retryDraftImage(database: LibraryDatabase, id: string, imageId: string): Promise<void> {
  await mutate(database, id, draft => { if (draft.status === 'running' || draft.status === 'quota') return fail('התור פעיל או נעצר בגלל מכסה.'); const image = draft.images.find(image => image.id === imageId); if (!image || !['error', 'interrupted'].includes(image.status)) return fail(); image.status = 'pending'; image.message = null; });
}
export async function removeDraftSource(database: LibraryDatabase, id: string, imageId: string): Promise<void> {
  await database.transaction('rw', database.recognitionDrafts, database.images, database.books, database.shelves, async () => {
    let sourceId: string | null = null;
    await mutate(database, id, draft => { if (draft.status === 'running') return fail('השהה את התור לפני מחיקת מקור.'); const image = draft.images.find(image => image.id === imageId); if (!image) return fail(); sourceId = image.storedImageId; image.storedImageId = null; });
    if (sourceId && !await database.recognitionDrafts.filter(draft => draft.images.some(image => image.storedImageId === sourceId)).count() && !await database.books.filter(book => book.primaryImageId === sourceId).count() && !await database.shelves.filter(shelf => shelf.imageId === sourceId).count()) await database.images.delete(sourceId);
  });
}
export function overlapSuggestions(draft: RecognitionDraft): { firstId: string; secondId: string; reason: string }[] {
  const suggestions: { firstId: string; secondId: string; reason: string }[] = [], active = draft.items.filter(item => item.status !== 'removed');
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j]; if (a.imageId === b.imageId) continue;
    const sameIdentifier = (a.item.isbn && a.item.isbn === b.item.isbn) || (a.item.danacode && a.item.danacode === b.item.danacode);
    const sameTitle = a.item.title && b.item.title && normalizeText(a.item.title) === normalizeText(b.item.title) && a.item.authors.map(normalizeText).sort().join('|') === b.item.authors.map(normalizeText).sort().join('|');
    if (sameIdentifier || sameTitle) suggestions.push({ firstId: a.id, secondId: b.id, reason: sameIdentifier ? 'מזהה זהה; ייתכן עוד עותק או חפיפה.' : 'שם ומחברים דומים; בדוק כרכים ועותקים.' });
  } return suggestions;
}
export class ShelfQueue {
  #files = new Map<string, File>(); #active = false; #generation = 0; #disposed = false;
  constructor(private database: LibraryDatabase, private session: VisionSession, private recognize?: (blob: Blob) => Promise<VisionOutcome>) {}
  get active() { return this.#active; }
  activate() { this.#disposed = false; }
  hasFile(id: string) { return this.#files.has(id); }
  file(id: string) { return this.#files.get(id); }
  async addFile(id: string, file: File, keepSource: boolean): Promise<DraftImage> {
    const generation = this.#generation;
    if (this.#disposed) return fail('המסך נסגר; התמונה לא נוספה.');
    if (this.#active) return fail('השהה את התור לפני הוספת תמונות.');
    if (!file.size || file.size > 20 * 1024 * 1024) return fail('בחר תמונה עד 20 מגה־בייט.');
    const inputHash = await hashBytes(await file.arrayBuffer()); let stored: StoredImage | undefined;
    if (keepSource) {
      const source = await loadVisionImage(file);
      try { const image = await prepareVisionImage(source, [0, 0, 1, 1], 0); stored = { id: crypto.randomUUID(), blob: image.blob, mimeType: 'image/jpeg', width: image.width, height: image.height, byteLength: image.blob.size, sha256: await hashBytes(await image.blob.arrayBuffer()), sourceUrl: null, createdAt: new Date().toISOString() }; }
      finally { source.dispose(); }
    }
    if (this.#disposed || generation !== this.#generation) return fail('הפעולה בוטלה; התמונה לא נוספה.');
    const image = await appendDraftImage(this.database, id, file.name, inputHash, stored); if (!stored && !this.#disposed) this.#files.set(image.id, file); return image;
  }
  async attachFile(draftId: string, imageId: string, file: File) {
    if (this.#disposed || this.#active || file.size > 20 * 1024 * 1024) return fail();
    const draft = await this.database.recognitionDrafts.get(draftId), image = draft?.images.find(image => image.id === imageId);
    if (!image || await hashBytes(await file.arrayBuffer()) !== image.inputHash) return fail('זו אינה התמונה המקורית. בחר את אותו קובץ או הוסף תמונה חדשה.');
    this.#files.set(imageId, file);
  }
  async pause(id: string) { this.#generation++; this.session.cancel(); await pauseDraft(this.database, id); }
  dispose() { this.#disposed = true; this.#generation++; if (this.#active) this.session.cancel(); this.#files.clear(); }
  async start(id: string, onBackup: () => void = () => {}) {
    if (this.#disposed || this.#active) return fail('התור כבר פעיל או נסגר.');
    const runId = crypto.randomUUID(), generation = ++this.#generation; this.#active = true;
    try {
      await mutate(this.database, id, draft => { if (draft.status === 'running' || draft.status === 'quota') return fail('התור פעיל בחלון אחר או נעצר בגלל מכסה.'); draft.runId = runId; draft.status = 'running'; });
      for (;;) {
        if (generation !== this.#generation) return;
        const draft = await this.database.recognitionDrafts.get(id); if (!draft || draft.runId !== runId) return;
        const image = draft.images.find(image => image.status === 'pending');
        if (!image) { await mutate(this.database, id, draft => { draft.runId = null; draft.status = draft.images.every(image => image.status === 'recognized') ? 'complete' : 'paused'; }, runId); return; }
        const saved = image.storedImageId ? await this.database.images.get(image.storedImageId) : undefined, file = this.#files.get(image.id);
        if (!saved && !file) { await mutate(this.database, id, draft => { draft.runId = null; draft.status = 'paused'; const current = draft.images.find(row => row.id === image.id)!; current.message = 'בחר שוב את התמונה כדי להמשיך; המקור לא נשמר.'; }, runId); return; }
        await mutate(this.database, id, draft => { draft.images.find(row => row.id === image.id)!.status = 'processing'; }, runId);
        try {
          if (saved) { await checkStoredSource(saved); if (saved.sha256 !== image.preparedHash) return fail('מקור התמונה השתנה.'); }
          let blob = saved?.blob;
          if (!blob) { const source = await loadVisionImage(file!); try { blob = (await prepareVisionImage(source, [0, 0, 1, 1], 0)).blob; } finally { source.dispose(); } }
          if (generation !== this.#generation) return;
          const preparedHash = await hashBytes(await blob.arrayBuffer()), outcome = await (this.recognize ? this.recognize(blob) : this.session.recognize(blob, onBackup, 'shelf'));
          const result = validateShelfRecognition(outcome.result); if (generation !== this.#generation) return;
          await mutate(this.database, id, draft => {
            const current = draft.images.find(row => row.id === image.id)!; current.status = 'recognized'; current.preparedHash = preparedHash; current.message = result.items.length ? null : 'לא זוהו ספרים קריאים בתמונה.';
            draft.items.push(...result.items.map(item => ({ id: crypto.randomUUID(), imageId: image.id, item, model: outcome.model, fetchedAt: new Date().toISOString(), status: 'detected' as const, selectedFields: [], bookId: null, copyId: null } satisfies DraftItem)));
          }, runId);
        } catch (cause) {
          if (generation !== this.#generation) return;
          const quota = cause instanceof VisionError && cause.state === 'quota';
          await mutate(this.database, id, draft => { const current = draft.images.find(row => row.id === image.id)!; current.status = 'error'; current.message = quota ? 'המכסה הסתיימה; התור נעצר ללא תשלום או ניסיון נוסף.' : 'הזיהוי או שמירת התוצאה נכשלו. לא בוצע ניסיון נוסף.'; draft.runId = null; draft.status = quota ? 'quota' : 'paused'; }, runId);
          return;
        }
      }
    } finally { this.#active = false; }
  }
}
