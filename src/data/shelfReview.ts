import type { LibraryDatabase } from './database';
import type { DraftItem, DraftReview, MetadataSource, RecognitionDraft } from './models';
import { validateDraft } from './shelfDraft';
import { validateReview } from './draftReviewValues';
import { LibraryValidationError } from './library';
import { changeCopy, duplicateBooks } from './books';
import { inputFieldValue, saveBookSelections } from './catalogSave';
import { recognitionMetadataFields, recognitionValues, shelfRecognitionVersion } from './recognition';
import { validateMetadataSource } from './metadata';

const fail = (message: string): never => { throw new LibraryValidationError(message); };
async function readDraft(database: LibraryDatabase, id: string, revision: number) {
  const row = await database.recognitionDrafts.get(id); if (!row) return fail('הטיוטה אינה קיימת.');
  const draft = validateDraft(row);
  if (draft.status === 'running') return fail('השהה את התור לפני סקירה ושמירה.');
  if (draft.revision !== revision) return fail('הטיוטה השתנתה בחלון אחר. פתח מחדש את הפריט.');
  return draft;
}
async function writeDraft(database: LibraryDatabase, draft: RecognitionDraft) {
  draft.revision++; draft.updatedAt = new Date().toISOString(); await database.recognitionDrafts.put(validateDraft(draft));
  return draft.revision;
}
export async function updateItemReview(database: LibraryDatabase, draftId: string, itemId: string, revision: number, value: DraftReview, selected: DraftItem['selectedFields']): Promise<number> {
  const review = validateReview(value);
  return database.transaction('rw', database.recognitionDrafts, async () => {
    const draft = await readDraft(database, draftId, revision), item = draft.items.find(item => item.id === itemId);
    if (!item || item.status === 'saved' || item.status === 'removed') return fail('הפריט כבר נשמר או הוסר.');
    item.review = review; item.selectedFields = [...selected]; item.status = 'reviewed'; return writeDraft(database, draft);
  });
}
function checkDecision(database: LibraryDatabase, item: DraftItem): Promise<void> | undefined {
  if (!item.review || item.review.decision === null) return fail('בחר ספר חדש או עותק נוסף לפני אישור.');
  const review = validateReview(item.review);
  if (review.decision === 'copy') {
    return database.books.get(review.targetBookId!).then(target => { if (!target || target.revision !== review.targetRevision) return fail('ספר היעד השתנה. בדוק מחדש את בחירת העותק.'); });
  } else if (!review.allowDuplicate && review.input.isbn.trim()) {
    return duplicateBooks(database, review.input).then(duplicates => { if (duplicates.length) return fail('ISBN זה כבר קיים. בחר עותק נוסף או אשר ספר חדש נפרד.'); });
  }
}
export async function setItemStatus(database: LibraryDatabase, draftId: string, itemId: string, revision: number, status: 'approved' | 'reviewed' | 'removed'): Promise<number> {
  if (!['approved', 'reviewed', 'removed'].includes(status)) return fail('מצב הפריט אינו תקין.');
  return database.transaction('rw', database.recognitionDrafts, database.books, async () => {
    const draft = await readDraft(database, draftId, revision), item = draft.items.find(item => item.id === itemId);
    if (!item || item.status === 'saved' || item.status === 'removed') return fail('הפריט כבר נשמר או הוסר.');
    if (status === 'approved') { if (item.status !== 'reviewed') return fail('בדוק ושמור את ערכי הטיוטה לפני אישור.'); const check = checkDecision(database, item); if (check) await check; }
    item.status = status; return writeDraft(database, draft);
  });
}
export interface ApprovedPreview { draftId: string; revision: number; itemIds: string[]; newBooks: number; extraCopies: number; excluded: number }
export async function previewApproved(database: LibraryDatabase, draftId: string): Promise<ApprovedPreview> {
  return database.transaction('r', database.recognitionDrafts, database.books, async () => {
    const raw = await database.recognitionDrafts.get(draftId); if (!raw) return fail('הטיוטה אינה קיימת.');
    const draft = await readDraft(database, draftId, raw.revision), approved = draft.items.filter(item => item.status === 'approved');
    for (const item of approved) { const check = checkDecision(database, item); if (check) await check; }
    return { draftId, revision: draft.revision, itemIds: approved.map(item => item.id), newBooks: approved.filter(item => item.review!.decision === 'new').length, extraCopies: approved.filter(item => item.review!.decision === 'copy').length, excluded: draft.items.length - approved.length };
  });
}
function imageSource(draft: RecognitionDraft, item: DraftItem, bookId: string, applied: boolean): MetadataSource {
  const imageHash = draft.images.find(image => image.id === item.imageId)!.preparedHash!, selected = applied ? recognitionMetadataFields(item.item, item.selectedFields) : [], fields = recognitionValues(item.item);
  const source: MetadataSource = { id: crypto.randomUUID(), bookId, provider: 'gemini', recordId: `${item.model}/${shelfRecognitionVersion}/${imageHash}/${item.id}`, sourceUrl: null, fetchedAt: item.fetchedAt, fieldValues: fields, selectedFields: selected, userOverriddenFields: selected.filter(field => JSON.stringify(inputFieldValue(item.review!.input, field)) !== JSON.stringify(fields[field])), recognition: { version: shelfRecognitionVersion, model: item.model, imageHash, item: item.item, batchId: draft.batchId, itemId: item.id } };
  return validateMetadataSource(source);
}
export async function saveApproved(database: LibraryDatabase, preview: ApprovedPreview): Promise<{ saved: number; bookIds: string[]; copyIds: string[] }> {
  if (!Array.isArray(preview.itemIds) || new Set(preview.itemIds).size !== preview.itemIds.length) return fail('רשימת האישור אינה תקינה.');
  return database.transaction('rw', database.tables, async () => {
    const raw = await database.recognitionDrafts.get(preview.draftId); if (!raw) return fail('הטיוטה אינה קיימת.');
    const current = validateDraft(raw), already = preview.itemIds.map(id => current.items.find(item => item.id === id));
    if (already.length && already.every(item => item?.status === 'saved')) return { saved: 0, bookIds: already.map(item => item!.bookId!), copyIds: already.map(item => item!.copyId!) };
    const draft = await readDraft(database, preview.draftId, preview.revision), approved = draft.items.filter(item => item.status === 'approved');
    if (approved.length !== preview.itemIds.length || approved.some(item => !preview.itemIds.includes(item.id))) return fail('רשימת הפריטים המאושרים השתנתה. בדוק את הסיכום מחדש.');
    if (preview.newBooks !== approved.filter(item => item.review!.decision === 'new').length || preview.extraCopies !== approved.filter(item => item.review!.decision === 'copy').length || preview.excluded !== draft.items.length - approved.length) return fail('סיכום השמירה אינו תואם לפריטים המאושרים.');
    for (const item of approved) { const check = checkDecision(database, item); if (check) await check; }
    const bookIds: string[] = [], copyIds: string[] = [];
    for (const item of approved) {
      const review = item.review!;
      let bookId: string, copyId: string;
      if (review.decision === 'copy') {
        const target = (await database.books.get(review.targetBookId!))!, copy = await changeCopy(database, target.id, target.revision, {});
        bookId = target.id; copyId = copy.id;
        if (draft.shelfId && !await database.bookShelves.where('[bookId+shelfId]').equals([bookId, draft.shelfId]).count()) await database.bookShelves.add({ id: crypto.randomUUID(), bookId, shelfId: draft.shelfId });
      } else {
        const input = { ...review.input, shelfIds: [...new Set([...(review.input.shelfIds ?? []), ...(draft.shelfId ? [draft.shelfId] : [])])] };
        const book = await saveBookSelections(database, input, review.catalogs, [], undefined, undefined, review.allowDuplicate);
        bookId = book.id; const copies = await database.copies.where('bookId').equals(book.id).toArray(); if (copies.length !== 1) return fail('שמירת העותק לא הושלמה.'); copyId = copies[0].id;
      }
      await database.metadataSources.add(imageSource(draft, item, bookId, review.decision === 'new'));
      item.status = 'saved'; item.bookId = bookId; item.copyId = copyId; bookIds.push(bookId); copyIds.push(copyId);
    }
    if (approved.length) await writeDraft(database, draft);
    return { saved: approved.length, bookIds, copyIds };
  });
}
