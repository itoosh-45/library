import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

test('T23 previous stage-16 production code exports all current schema-2 data and edits without breaking references', async ({ page, context }) => {
  if (!process.env.PREVIOUS_APP_DIST) throw new Error('Build the documented previous commit and set PREVIOUS_APP_DIST; do not claim compatibility without it.');
  const previousDist = resolve(process.env.PREVIOUS_APP_DIST);
  await page.goto('./'); await expect(page.getByRole('heading', { name: 'כל הספרים' })).toBeVisible();
  const original = await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const { db } = await import(resources.filter(name => name.includes('/src/data/database.ts')).at(-1)!) as typeof import('../../src/data/database');
    const booksUrl = '/library/src/data/books.ts', collectionsUrl = '/library/src/data/collections.ts', loansUrl = '/library/src/data/loans.ts', imagesUrl = '/library/src/data/images.ts', draftsUrl = '/library/src/data/shelfDraft.ts', snapshotUrl = '/library/src/data/fullBackup.ts';
    const { saveBook, emptyInput } = await import(booksUrl) as typeof import('../../src/data/books');
    const { saveNamedItem, saveShelf } = await import(collectionsUrl) as typeof import('../../src/data/collections');
    const { lendCopy, localDay } = await import(loansUrl) as typeof import('../../src/data/loans');
    const { hashBytes } = await import(imagesUrl) as typeof import('../../src/data/images');
    const { createDraft, appendDraftImage } = await import(draftsUrl) as typeof import('../../src/data/shelfDraft');
    const { createFullSnapshot } = await import(snapshotUrl) as typeof import('../../src/data/fullBackup');
    const series = await saveNamedItem(db, 'series', 'סדרת תאימות'); await db.series.update(series.id, { collapsed: true });
    const shelf = await saveShelf(db, { name: 'מדף תאימות', parentId: null });
    const book = await saveBook(db, { ...emptyInput, title: 'ספר תאימות', authors: ['מחבר'], seriesId: series.id, shelfIds: [shelf.id], isbn: '0306406152' });
    await lendCopy(db, { copyId: (await db.copies.toArray())[0].id, newPersonName: 'שואל תאימות', borrowedOn: localDay(), expectedReturnOn: '' });
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
    canvas.getContext('2d')!.fillRect(0, 0, 32, 16);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(result => resolve(result!), 'image/jpeg'));
    const image = { id: crypto.randomUUID(), blob, mimeType: 'image/jpeg', width: 32, height: 16, byteLength: blob.size, sha256: await hashBytes(await blob.arrayBuffer()), sourceUrl: null, createdAt: new Date().toISOString() };
    await db.images.add(image); await db.books.update(book.id, { primaryImageId: image.id });
    const draft = await createDraft(db, shelf.id);
    await appendDraftImage(db, draft.id, 'SYNTHETIC.jpg', image.sha256, { ...image, id: crypto.randomUUID() });
    return (await createFullSnapshot(db)).text;
  });
  const old = await context.newPage();
  await old.route('**/library/**', async route => {
    const name = new URL(route.request().url()).pathname.slice('/library/'.length) || 'index.html';
    const path = resolve(previousDist, name);
    if (!path.startsWith(previousDist + sep)) { await route.abort(); return; }
    await route.fulfill({ path });
  });
  await old.goto('./');
  await expect(old.getByRole('button', { name: /סדרת תאימות/ })).toHaveAttribute('aria-expanded', 'false');
  await old.getByRole('link', { name: 'הגדרות', exact: true }).click();
  const downloading = old.waitForEvent('download'); await old.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  const exported = JSON.parse(await readFile((await (await downloading).path())!, 'utf8'));
  expect(exported.dbSchemaVersion).toBe(2); expect(exported.formatVersion).toBe(8);
  expect(exported.tables).toEqual(JSON.parse(original).tables);
  await old.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  await old.getByRole('button', { name: /סדרת תאימות/ }).click();
  await old.getByRole('heading', { name: 'ספר תאימות', exact: true }).click();
  await old.getByLabel('שם הספר', { exact: true }).fill('ספר אחרי קוד קודם');
  await old.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(old.getByRole('dialog')).toHaveCount(0); await old.close();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'ספר אחרי קוד קודם', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'השאלות', exact: true }).click();
  await expect(page.getByText('שואל תאימות', { exact: true })).toBeVisible();
});
