import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function shelf(page: Page, name: string, parent?: string) {
  await page.getByRole('button', { name: 'הוספת מדף', exact: true }).click();
  await page.getByLabel('שם המדף', { exact: true }).fill(name);
  if (parent) await page.getByRole('combobox', { name: 'בתוך מדף', exact: true }).selectOption({ label: parent });
  await page.getByRole('button', { name: 'שמירת המדף', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function seedSeries(page: Page) {
  await page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', collectionPath = '/library/src/data/collections.ts', bookPath = '/library/src/data/books.ts';
    const { db } = await import(/* @vite-ignore */ dbPath), { saveNamedItem } = await import(/* @vite-ignore */ collectionPath), { saveBook, emptyInput } = await import(/* @vite-ignore */ bookPath);
    const series = await saveNamedItem(db, 'series', 'סדרת ניסוי');
    for (const [title, number] of [['כרך עשר', '10'], ['כרך שני', '2'], ['כרך ראשון', '1'], ['כרך ללא מספר', '']]) await saveBook(db, { ...emptyInput, title, seriesId: series.id, seriesNumber: number });
  });
}
test('T11 shelf creation, multiple memberships, unique descendant counts, moves and deletion preserve books at 360px', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(''); await page.getByRole('link', { name: 'מדפים', exact: true }).click();
  await shelf(page, 'ראשי'); await shelf(page, 'ילד', 'ראשי'); await shelf(page, 'עלה', 'רמה 2: ילד');
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר בשלושה מדפים');
  await page.getByText('מדפים, תגיות וסדרה', { exact: true }).click();
  const choices = page.getByRole('group', { name: 'שיוך למדפים', exact: true });
  await choices.getByRole('checkbox').nth(0).check(); await choices.getByRole('checkbox').nth(1).check(); await choices.getByRole('checkbox').nth(2).check();
  await page.getByRole('combobox', { name: 'ז׳אנרים מוכנים', exact: true }).selectOption('עיון');
  await expect(page.getByRole('group', { name: 'ז׳אנרים', exact: true }).getByRole('checkbox', { name: 'עיון', exact: true })).toBeChecked();
  await page.getByLabel('תגית חדשה', { exact: true }).fill('דוגמה'); await page.getByRole('button', { name: 'יצירת תגית', exact: true }).click();
  await expect(page.getByRole('group', { name: 'תגיות', exact: true }).getByRole('checkbox', { name: 'דוגמה', exact: true })).toBeChecked();
  await page.getByLabel('תגית חדשה', { exact: true }).fill('נוסף'); await page.getByRole('button', { name: 'יצירת תגית', exact: true }).click();
  await expect(page.getByRole('group', { name: 'תגיות', exact: true }).getByRole('checkbox', { name: 'נוסף', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.shelf-count')).toHaveText(['1 ספרים', '1 ספרים', '1 ספרים']);
  await page.screenshot({ path: 'test-results/stage05-desktop-shelves.png', fullPage: true });
  await page.locator('.shelf-select').first().click(); await expect(page.locator('.shelf-books .book-list li')).toHaveCount(1);
  await page.getByLabel('כולל תתי־מדפים', { exact: true }).uncheck(); await expect(page.locator('.shelf-books .book-list li')).toHaveCount(1);
  await page.getByRole('button', { name: 'עריכת מדף ראשי', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'בתוך מדף', exact: true }).locator('option')).toHaveCount(1); // itself and every descendant excluded
  await page.getByRole('button', { name: 'סגירה', exact: true }).click();
  await page.getByRole('button', { name: 'עריכת מדף ילד', exact: true }).click();
  await page.getByRole('combobox', { name: 'בתוך מדף', exact: true }).selectOption(''); await page.getByRole('button', { name: 'שמירת המדף', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'עריכת מדף ילד', exact: true }).click();
  await page.getByText('מחיקת המדף', { exact: true }).click(); await page.getByLabel('אני מאשר מחיקת המדף והסרת השיוך אליו').check();
  await page.getByRole('button', { name: 'מחיקת המדף בלבד', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.shelf-tree li')).toHaveCount(2);
  await page.reload(); await expect(page.locator('.shelf-tree li')).toHaveCount(2);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.screenshot({ path: 'test-results/stage05-mobile-shelves.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  await expect(page.locator('.book-list li')).toHaveCount(1);
  await page.getByRole('button', { name: /ספר בשלושה מדפים.*1 עותקים/ }).click();
  await page.getByText('מדפים, תגיות וסדרה', { exact: true }).click();
  await expect(page.getByRole('group', { name: 'תגיות', exact: true }).getByRole('checkbox', { name: 'דוגמה', exact: true })).toBeChecked();
  await expect(page.getByRole('group', { name: 'שיוך למדפים', exact: true }).getByRole('checkbox')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/stage05-mobile-book-editor.png' });
  await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  expect(await page.evaluate(() => document.querySelector('dialog')!.scrollWidth <= document.querySelector('dialog')!.clientWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); expect(errors).toEqual([]);
});
test('T12 numeric series order, explicit missing number, collapse persistence, editing and collection deletion', async ({ page }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible(); await seedSeries(page);
  await expect(page.locator('.series-group h2')).toHaveText(['כרך ראשון', 'כרך שני', 'כרך עשר', 'כרך ללא מספר']);
  await expect(page.getByText('ללא מספר בסדרה', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/stage05-desktop-series.png', fullPage: true });
  const toggle = page.getByRole('button', { name: /סדרת ניסוי.*4 ספרים/ });
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.reload(); await expect(toggle).toHaveAttribute('aria-expanded', 'false'); await expect(page.locator('.series-group ul')).toBeHidden();
  await toggle.click(); await page.getByRole('button', { name: /כרך עשר.*1 עותקים/ }).click();
  await page.getByText('מדפים, תגיות וסדרה', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'סדרה', exact: true })).toHaveValue(/.+/); await page.getByLabel('מספר בסדרה', { exact: true }).fill('0.5');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.locator('.series-group h2')).toHaveText(['כרך עשר', 'כרך ראשון', 'כרך שני', 'כרך ללא מספר']);
  await page.getByRole('link', { name: 'תגיות וסדרות', exact: true }).click(); await page.getByRole('button', { name: 'סדרות', exact: true }).click();
  await page.getByRole('button', { name: 'עריכת אוסף סדרת ניסוי', exact: true }).click();
  await page.getByLabel('שם האוסף', { exact: true }).fill('סדרה עם שם חדש'); await page.getByRole('button', { name: 'שמירת האוסף', exact: true }).click();
  await page.getByRole('button', { name: 'עריכת אוסף סדרה עם שם חדש', exact: true }).click();
  await page.getByText('מחיקת האוסף', { exact: true }).click(); await page.getByLabel('אני מאשר הסרת האוסף והשיוכים אליו').check();
  await page.getByRole('button', { name: 'מחיקת האוסף בלבד', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await expect(page.locator('.book-list li')).toHaveCount(4); await expect(page.locator('.series-group')).toHaveCount(0);
});
test('deep shelf tree and real competing IndexedDB moves remain valid in independent windows', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  const ids = await page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', path = '/library/src/data/collections.ts', bookPath = '/library/src/data/books.ts';
    const { db } = await import(/* @vite-ignore */ dbPath), { saveShelf } = await import(/* @vite-ignore */ path), { saveBook, emptyInput } = await import(/* @vite-ignore */ bookPath);
    let parentId: string | null = null, root = '';
    for (let i = 0; i < 100; i++) { const item: { id: string } = await saveShelf(db, { name: `עומק ${i + 1}`, parentId }); parentId = item.id; if (!i) root = item.id; }
    await saveBook(db, { ...emptyInput, title: 'ספר בעומק 100', shelfIds: [parentId] });
    const first = await saveShelf(db, { name: 'מרוץ א', parentId: null }), second = await saveShelf(db, { name: 'מרוץ ב', parentId: null });
    return { root, leaf: parentId, first, second };
  });
  await page.getByRole('link', { name: 'מדפים', exact: true }).click(); await expect(page.locator('.shelf-tree li')).toHaveCount(102);
  await page.locator('.shelf-select').filter({ hasText: 'עומק 100' }).click(); await expect(page.getByRole('heading', { name: 'ספר בעומק 100', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const next = await context.newPage(); await next.goto(''); await expect(next.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  const move = (target: Page, item: typeof ids.first, parentId: string) => target.evaluate(async ({ item, parentId }) => {
    const dbPath = '/library/src/data/database.ts', path = '/library/src/data/collections.ts'; const { db } = await import(/* @vite-ignore */ dbPath), { saveShelf } = await import(/* @vite-ignore */ path);
    try { await saveShelf(db, { name: item.name, parentId }, item); return true; } catch { return false; }
  }, { item, parentId });
  const outcomes = await Promise.all([move(page, ids.first, ids.second.id), move(next, ids.second, ids.first.id)]); expect(outcomes.filter(Boolean)).toHaveLength(1);
  await expect(page.locator('.shelf-tree li')).toHaveCount(102); await page.reload(); await expect(page.locator('.shelf-tree li')).toHaveCount(102); expect(errors).toEqual([]);
});
test('stage 5 backup protects shelf image, all memberships and folded series through preview and atomic restore', async ({ page }) => {
  await page.goto(''); await page.getByRole('link', { name: 'מדפים', exact: true }).click();
  await page.getByRole('button', { name: 'הוספת מדף', exact: true }).click(); await page.getByLabel('שם המדף', { exact: true }).fill('מדף עם תמונה');
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 1200; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#1f4d57'; ctx.fillRect(0, 0, 1800, 1200);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png')); return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.getByLabel('תמונת מדף', { exact: true }).setInputFiles({ name: 'synthetic-shelf.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
  await expect(page.getByRole('img', { name: 'תמונת המדף', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'שמירת המדף', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await seedSeries(page);
  await page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', path = '/library/src/data/collections.ts', bookPath = '/library/src/data/books.ts';
    const { db } = await import(/* @vite-ignore */ dbPath), { saveNamedItem, setSeriesCollapsed } = await import(/* @vite-ignore */ path), { saveBook, emptyInput } = await import(/* @vite-ignore */ bookPath);
    const tag = await saveNamedItem(db, 'tags', 'סינתטית'), genre = await saveNamedItem(db, 'genres', 'עיון'), book = (await db.books.toArray())[0];
    await saveBook(db, { ...emptyInput, title: book.title, tagIds: [tag.id], genreIds: [genre.id], shelfIds: [(await db.shelves.toArray())[0].id] }, book); await setSeriesCollapsed(db, book.seriesId, true);
  });
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  const download = await downloading, buffer = await readFile((await download.path())!); const backup = JSON.parse(buffer.toString());
  expect(backup.version).toBe(5); expect(backup.counts).toMatchObject({ shelves: 1, bookShelves: 1, tags: 1, genres: 1, series: 1, images: 1 }); expect(backup.data.series[0].collapsed).toBe(true);
  await page.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'stage5.json', mimeType: 'application/json', buffer });
  await expect(page.getByText(/4 ספרים.*1 מדפים.*1 שיוכים למדפים/)).toBeVisible();
  await page.getByRole('button', { name: 'ביטול השחזור', exact: true }).click();
  await page.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'stage5.json', mimeType: 'application/json', buffer });
  await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click();
  await expect(page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true })).toBeDisabled();
  await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה').check();
  await page.evaluate(async () => { const dbPath = '/library/src/data/database.ts', path = '/library/src/data/collections.ts'; const { db } = await import(/* @vite-ignore */ dbPath), { setSeriesCollapsed } = await import(/* @vite-ignore */ path); await setSeriesCollapsed(db, (await db.series.toArray())[0].id, false); });
  await page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click(); await expect(page.getByText(/הספרייה השתנתה מאז הגיבוי המגן/)).toBeVisible();
  await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה').check();
  await page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click(); await expect(page.getByText('הספרייה שוחזרה בהצלחה.')).toBeVisible();
  await page.reload(); await page.getByRole('link', { name: 'מדפים', exact: true }).click(); await expect(page.getByRole('img', { name: 'תמונת המדף מדף עם תמונה', exact: true })).toBeVisible(); await expect(page.locator('.shelf-count')).toHaveText('1 ספרים');
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await expect(page.getByRole('button', { name: /סדרת ניסוי.*4 ספרים/ })).toHaveAttribute('aria-expanded', 'false');
  const sharedImages = await page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', collectionPath = '/library/src/data/collections.ts', bookPath = '/library/src/data/books.ts', backupPath = '/library/src/data/backup.ts';
    const { db } = await import(/* @vite-ignore */ dbPath), { saveShelf } = await import(/* @vite-ignore */ collectionPath), { saveBook, emptyInput } = await import(/* @vite-ignore */ bookPath), { createSnapshot, deleteBook } = await import(/* @vite-ignore */ backupPath);
    const image = (await db.images.toArray())[0], shelf = (await db.shelves.toArray())[0], book = (await db.books.toArray())[0];
    await saveBook(db, { ...emptyInput, title: book.title }, book, image);
    await deleteBook(db, book.id, (await createSnapshot(db)).fingerprint);
    const afterBookDelete = await db.images.count();
    const remaining = (await db.books.toArray())[0], attached = await saveBook(db, { ...emptyInput, title: remaining.title }, remaining, image);
    await saveShelf(db, { name: shelf.name, parentId: shelf.parentId }, shelf, null);
    const afterShelfRemove = await db.images.count();
    await saveBook(db, { ...emptyInput, title: attached.title }, attached, null);
    return { afterBookDelete, afterShelfRemove, afterLastReference: await db.images.count() };
  });
  expect(sharedImages).toEqual({ afterBookDelete: 1, afterShelfRemove: 1, afterLastReference: 0 });
});
