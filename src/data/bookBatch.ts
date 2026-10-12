import { personalCredentials } from './personalCredentials';
import { goodreadsEndpoint } from './goodreads';
import { db } from './database';
import { createDraft, appendDraftImage, validateDraft } from './shelfDraft';
import { loadVisionImage, prepareVisionImage } from './visionImage';
import { hashBytes } from './images';
import { groqNamesToRecognition } from './groqNames';
import { recognitionModels, recognitionFields, recognitionInput, recognitionMetadataFields } from './recognition';
import { validateCandidate, type Candidate } from './metadata';
import { applyCatalogCandidate } from './catalogSave';
import { emptyReview } from './draftReviewValues';
import type { StoredImage } from './models';
const credentialId = (id: string) => 'batch:' + id;
export interface RemoteBatchImage {
    id: string;
    name: string;
    sha: string;
    status: 'pending' | 'processing' | 'recognized' | 'error';
    message: string | null;
    names?: {
        title: string | null;
        authors: string[];
    };
    model?: string;
    fetchedAt?: string;
    candidates?: Candidate[];
}
export interface RemoteBatch {
    id: string;
    status: 'paused' | 'running' | 'waiting' | 'complete';
    nextAt: number;
    expiresAt: string;
    images: RemoteBatchImage[];
}
export async function batchIds() { return (await personalCredentials.credentials.toArray()).filter(row => row.id.startsWith('batch:')).map(row => row.id.slice(6)); }
export async function batchRequest(id: string, route: 'create' | 'upload' | 'status' | 'action', body: object = {}, signal?: AbortSignal): Promise<RemoteBatch> {
    const [service, capability] = await Promise.all([personalCredentials.credentials.get('goodreads'), personalCredentials.credentials.get(credentialId(id))]);
    if (!service?.key || !capability?.key)
        throw new Error('הגדר מפתח שירות קטלוג ופתח תור לפני ההעלאה.');
    let response: Response;
    for (let attempt = 0;; attempt++) {
        response = await fetch(goodreadsEndpoint + '/v1/batch/' + route, { method: 'POST', signal: signal ?? AbortSignal.timeout(60000), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + service.key, 'X-Batch-Token': capability.key }, body: JSON.stringify({ id, ...body }) });
        if (response.status !== 429 || route !== 'upload' || attempt >= 2) break;
        const wait = Math.max(1000, Math.min(120000, Number(response.headers.get('Retry-After') || '60') * 1000));
        await response.body?.cancel();
        await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
            const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
            const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, Number.isFinite(wait) ? wait : 60000);
            signal?.addEventListener('abort', abort, {once:true});
        });
    }
    if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error(response.status === 429 ? 'השרת ביקש להמתין דקה. התוצאות נשמרו; אפשר לחדש את הפעולה.' : response.status === 404 ? 'התור אינו קיים בשרת או שפג תוקפו. התמונות והטיוטות המקומיות נשמרו.' : 'הפעולה בתור לא הושלמה. בדוק את החיבור ואת מפתח שירות הקטלוג.'),{name:response.status===404?'BatchMissing':'Error'});
    }
    const raw: unknown = await response.json();
    if (route === 'action' && body && 'action' in body && body.action === 'delete')
        return raw as RemoteBatch;
    if (!raw || typeof raw !== 'object')
        throw new Error('תשובת התור אינה תקינה.');
    const result = raw as RemoteBatch;
    if (result.id !== id || !['paused', 'running', 'waiting', 'complete'].includes(result.status) || !Number.isFinite(result.nextAt) || !Number.isFinite(Date.parse(result.expiresAt)) || !Array.isArray(result.images) || result.images.length > 500)
        throw new Error('תשובת התור אינה תקינה.');
    const seen = new Set<string>();
    for (const item of result.images) {
        if (!/^[a-f\d-]{36}$/.test(item.id) || seen.has(item.id) || !/^[a-f0-9]{64}$/.test(item.sha) || typeof item.name !== 'string' || item.name.length > 300 || !['pending', 'processing', 'recognized', 'error'].includes(item.status) || item.message !== null && (typeof item.message !== 'string' || item.message.length > 500))
            throw new Error('פרטי התמונות בתור אינם תקינים.');
        seen.add(item.id);
        if (item.status === 'recognized') {
            if (!item.names || !Object.values(recognitionModels).includes(item.model as never) || !item.fetchedAt || new Date(item.fetchedAt).toISOString() !== item.fetchedAt || !Array.isArray(item.candidates) || item.candidates.length > 20)
                throw new Error('תוצאת הזיהוי בתור אינה תקינה.');
            groqNamesToRecognition(item.names, false);
            item.candidates = item.candidates.flatMap(value => { try {
                return [validateCandidate(value)];
            }
            catch {
                return [];
            } });
        }
    }
    return result;
}
async function approvedBatchKeys() {
    const keys = await personalCredentials.credentials.toArray();
    const providers = Object.fromEntries(['gemini', 'groq'].flatMap(id => { const row = keys.find(row => row.id === id); return row?.key && row.free && row.consent ? [[id, row.key]] : []; }));
    if (!Object.keys(providers).length)
        throw new Error('הגדר מפתח Gemini או Groq אישי במסלול חינמי בהגדרות.');
    return providers;
}
export async function updateBookBatchKeys(id:string) {return batchRequest(id,'action',{action:'credentials',...await approvedBatchKeys(),free:true,consent:true});}
export async function openBookBatch(shelfId: string | null, consent: boolean) {
    if (!consent)
        throw new Error('אשר העלאת התמונות והמפתחות לשרת.');
    const providers=await approvedBatchKeys();
    const draft = await createDraft(db, shelfId), capability = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
    await personalCredentials.credentials.put({ id: credentialId(draft.id), key: capability });
    try {
        await batchRequest(draft.id, 'create', { capability, ...providers, free: true, consent: true });
    }
    catch (error) {
        await personalCredentials.credentials.delete(credentialId(draft.id));
        await db.recognitionDrafts.delete(draft.id);
        throw error;
    }
    return draft;
}
export async function addBookPhoto(id: string, file: File) { if (!file.size || file.size > 20 * 1024 * 1024)
    throw new Error('בחר תמונה עד 20 מגה־בייט.'); const inputHash = await hashBytes(await file.arrayBuffer()), source = await loadVisionImage(file); try {
    const prepared = await prepareVisionImage(source, [0, 0, 1, 1], 0);
    const stored: StoredImage = { id: crypto.randomUUID(), blob: prepared.blob, mimeType: 'image/jpeg', width: prepared.width, height: prepared.height, byteLength: prepared.blob.size, sha256: await hashBytes(await prepared.blob.arrayBuffer()), sourceUrl: null, createdAt: new Date().toISOString() };
    await appendDraftImage(db, id, file.name, inputHash, stored);
}
finally {
    source.dispose();
} }
export async function uploadBookPhotos(id: string, progress: (n: number, total: number) => void, signal: AbortSignal) {
    let remote = await batchRequest(id, 'status', {}, signal);
    if (remote.status !== 'paused')
        throw new Error('השהה את התור לפני הוספת תמונות.');
    const draft = await db.recognitionDrafts.get(id);
    if (!draft)
        throw new Error('הטיוטה אינה קיימת.');
    const uploaded = new Set(remote.images.map(row => row.id));
    let n = 0;
    for (const image of draft.images) {
        if (signal.aborted)
            throw new DOMException('Cancelled', 'AbortError');
        if (!uploaded.has(image.id)) {
            const stored = image.storedImageId ? await db.images.get(image.storedImageId) : undefined;
            if (!stored)
                throw new Error('מקור התמונה אינו זמין.');
            const bytes = new Uint8Array(await stored.blob.arrayBuffer());
            let binary = '';
            for (let at = 0; at < bytes.length; at += 8192)
                binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
            remote = await batchRequest(id, 'upload', { itemId: image.id, name: image.name, sha: stored.sha256, data: btoa(binary) }, signal);
        }
        progress(++n, draft.images.length);
    }
    return remote;
}
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
export function clearBookMatch(names: {
    title: string | null;
    authors: string[];
}, candidates: Candidate[]) {
    if (!names.title || !names.authors.length)
        return undefined;
    const matches = candidates.filter(row => typeof row.fields.title === 'string' && normalize(row.fields.title) === normalize(names.title!) && Array.isArray(row.fields.authors) && row.fields.authors.length && names.authors.every(author => (row.fields.authors as string[]).some(name => normalize(name) === normalize(author))));
    if (matches.length === 1)
        return matches[0];
    const identifiers = new Set(matches.map(row => row.fields.isbn13 ?? row.fields.isbn10 ?? ''));
    if (matches.length > 1 && identifiers.size === 1 && ![...identifiers].includes(''))
        return matches.find(row => row.kind === 'edition') ?? matches[0];
    return undefined;
}
export async function syncBookBatch(remote: RemoteBatch, database = db) {
    return database.transaction('rw', database.recognitionDrafts, async () => {
        const raw = await database.recognitionDrafts.get(remote.id);
        if (!raw)
            throw new Error('הטיוטה המקומית אינה קיימת.');
        const draft = validateDraft(raw);
        let changed = false;
        for (const row of remote.images) {
            const image = draft.images.find(image => image.id === row.id);
            if (!image || image.preparedHash !== row.sha)
                throw new Error('תוצאת השרת אינה תואמת לתמונה המקומית.');
            const existing = draft.items.find(item => item.imageId === row.id && item.status !== 'removed');
            if (row.status === 'recognized' && row.names && row.model && row.fetchedAt && row.candidates) {
                if (existing?.fetchedAt === row.fetchedAt || existing?.status === 'saved')
                    continue;
                const item = groqNamesToRecognition(row.names, false).items[0];
                if (existing)
                    existing.status = 'removed';
                image.status = 'recognized';
                image.message = row.message;
                changed = true;
                if (!item)
                    continue;
                const selected = recognitionFields.filter(field => field === 'authors' ? item.authors.length : !!item[field]), review = emptyReview();
                review.input = recognitionInput(review.input, item, selected);
                review.decision = 'new';
                const candidate = clearBookMatch(row.names, row.candidates);
                const choice = candidate ? applyCatalogCandidate(review.input, candidate) : undefined;
                if (choice && candidate) {
                    review.input = choice.draft;
                    review.catalogs = [{ candidate, selected: choice.fields }];
                }
                draft.items.push({ id: crypto.randomUUID(), imageId: image.id, item, model: row.model, fetchedAt: row.fetchedAt, status: 'reviewed', selectedFields: choice ? selected.filter(field => !recognitionMetadataFields(item, [field]).some(value => choice.fields.includes(value))) : selected, review, bookId: null, copyId: null });
            }
            else if (!existing) {
                const status = row.status === 'error' ? 'error' : row.status === 'processing' ? 'processing' : 'pending';
                if (image.status !== status || image.message !== row.message) {
                    image.status = status;
                    image.message = row.message;
                    changed = true;
                }
            }
        }
        // Remote queues keep running independently; local drafts remain reviewable snapshots.
        if (changed) {
            for (const image of draft.images.filter(image => image.status === 'processing').slice(1))
                image.status = 'pending';
            draft.status = 'paused';
            draft.runId = null;
            draft.revision++;
            draft.updatedAt = new Date().toISOString();
            await database.recognitionDrafts.put(validateDraft(draft));
        }
        return draft;
    });
}
