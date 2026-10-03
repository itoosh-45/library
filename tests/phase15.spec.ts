import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function addBook(page: Page, title: string) {
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
}
async function safety(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await download;
  await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר מיזוג', { exact: true }).check();
}
async function fingerprint(page: Page) {
  return page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', backupPath = '/library/src/data/backup.ts';
    const { db } = await import(/* @vite-ignore */ dbPath), { createSnapshot } = await import(/* @vite-ignore */ backupPath);
    return (await createSnapshot(db)).fingerprint;
  });
}

test('T19 full download dates, explicit separate-book merge and repeat import preserve the local library at 360px', async ({ page }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  await addBook(page, 'מהדורה סינתטית');
  const source = await page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', booksPath = '/library/src/data/books.ts', fullPath = '/library/src/data/fullBackup.ts';
    const { LibraryDatabase, initializeLibrary } = await import(/* @vite-ignore */ dbPath);
    const { saveBook, emptyInput } = await import(/* @vite-ignore */ booksPath), { createFullSnapshot } = await import(/* @vite-ignore */ fullPath);
    const database = new LibraryDatabase('SYNTHETIC-import-' + crypto.randomUUID());
    try { await initializeLibrary(database); await saveBook(database, { ...emptyInput, title: 'מהדורה סינתטית', authors: ['מחבר סינתטי אחר'] }); return (await createFullSnapshot(database)).text; }
    finally { await database.delete(); }
  });
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await expect(page.getByText('גיבוי אחרון שהופק:', { exact: false })).toContainText('טרם הופק');
  const before = await fingerprint(page);
  await page.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'SYNTHETIC-v8.json', mimeType: 'application/json', buffer: Buffer.from(source) });
  await page.getByRole('combobox', { name: 'אופן הייבוא', exact: true }).selectOption('merge');
  await expect(page.getByRole('heading', { name: 'ספרים דומים שיישמרו בנפרד' })).toBeVisible();
  expect(await fingerprint(page)).toBe(before);
  await safety(page); await expect(page.getByRole('button', { name: 'מיזוג הגיבוי לאחר הסקירה' })).toBeDisabled();
  await page.getByLabel('אני מאשר לשמור את הספרים והאוספים הדומים בנפרד').check();
  await page.getByRole('button', { name: 'מיזוג הגיבוי לאחר הסקירה' }).click();
  await expect(page.getByText('הגיבוי מוזג בהצלחה. הנתונים הקיימים נשמרו.')).toBeVisible();
  const merged = await fingerprint(page);
  await page.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'SYNTHETIC-v8-repeat.json', mimeType: 'application/json', buffer: Buffer.from(source) });
  await page.getByRole('combobox', { name: 'אופן הייבוא', exact: true }).selectOption('merge');
  await expect(page.getByText(/יתווספו 0 רשומות/)).toBeVisible(); await safety(page);
  await page.getByRole('button', { name: 'מיזוג הגיבוי לאחר הסקירה' }).click();
  await expect(page.getByText('הגיבוי מוזג בהצלחה. הנתונים הקיימים נשמרו.')).toBeVisible();
  expect(await fingerprint(page)).toBe(merged);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  const root = JSON.parse((await readFile((await (await download).path())!)).toString());
  expect(root).toMatchObject({ format: 'my-library-backup', formatVersion: 8, manifestCounts: { books: 2, copies: 2 } });
  await page.getByRole('button', { name: 'שמרתי ובדקתי את קובץ הגיבוי האחרון' }).click();
  await expect(page.getByText(/קובץ שאישרת שנשמר ונבדק:/)).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/phase15-backup-360.png', fullPage: true });
  await page.reload(); await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(2);
});

test('T19 same-library conflict requires explicit choice and rejects a concurrent edit after safety download', async ({ page }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible(); await addBook(page, 'שם סינתטי קודם');
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  const source = await readFile((await (await download).path())!);
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await page.getByRole('button', { name: /שם סינתטי קודם.*1 עותקים/ }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('שם סינתטי מקומי חדש'); await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'SYNTHETIC-conflict.json', mimeType: 'application/json', buffer: source });
  await page.getByRole('combobox', { name: 'אופן הייבוא' }).selectOption('merge');
  await expect(page.getByText(/1 סתירות דורשות בחירה/)).toBeVisible(); await safety(page);
  await expect(page.getByRole('button', { name: 'מיזוג הגיבוי לאחר הסקירה' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'בחירת גרסה: שם סינתטי קודם' }).selectOption('incoming');
  await page.evaluate(async () => { const path = '/library/src/data/database.ts'; const { db } = await import(/* @vite-ignore */ path); await db.settings.put({ key: 'libraryName', value: 'שינוי בחלון אחר' }); });
  const before = await fingerprint(page);
  await page.getByRole('button', { name: 'מיזוג הגיבוי לאחר הסקירה' }).click(); await expect(page.getByText(/הספרייה השתנתה מאז/)).toBeVisible();
  expect(await fingerprint(page)).toBe(before);
});

test('T19 native transaction abort after book writes leaves all active IndexedDB tables unchanged', async ({ page }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  const result = await page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', booksPath = '/library/src/data/books.ts', backupPath = '/library/src/data/backup.ts', mergePath = '/library/src/data/backupMerge.ts';
    const { db, LibraryDatabase, initializeLibrary } = await import(/* @vite-ignore */ dbPath), { emptyInput, saveBook } = await import(/* @vite-ignore */ booksPath);
    const { createSnapshot, validateBackup } = await import(/* @vite-ignore */ backupPath), { mergeSnapshot } = await import(/* @vite-ignore */ mergePath);
    const source = new LibraryDatabase('SYNTHETIC-abort-' + crypto.randomUUID());
    await saveBook(db, { ...emptyInput, title: 'המקורי נשאר' });
    const capture = () => db.transaction('r', db.tables, async () => JSON.stringify(await Promise.all(db.tables.map(async (table: { name: string; toArray(): Promise<unknown[]> }) => ({ name: table.name, rows: await table.toArray() })))));
    try {
      await initializeLibrary(source); await saveBook(source, { ...emptyInput, title: 'מיזוג שנקטע' });
      const backup = await validateBackup((await createSnapshot(source)).text), before = await capture(), expected = (await createSnapshot(db)).fingerprint;
      const put = IDBObjectStore.prototype.put; let injected = false, failed = false;
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const request = put.apply(this, args);
        if (this.name === 'copies' && !injected) { injected = true; this.transaction.abort(); }
        return request;
      };
      try { await mergeSnapshot(db, backup, expected, {}, true); } catch { failed = true; } finally { IDBObjectStore.prototype.put = put; }
      return { injected, failed, unchanged: before === await capture(), books: await db.books.count() };
    } finally { await source.delete(); }
  });
  expect(result).toEqual({ injected: true, failed: true, unchanged: true, books: 1 });
  await page.reload(); await expect(page.getByRole('button', { name: /המקורי נשאר.*1 עותקים/ })).toBeVisible();
});

test('T19 closing the tab while a native merge transaction is active preserves the library on reopening', async ({ page }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  const setup = await page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', booksPath = '/library/src/data/books.ts', backupPath = '/library/src/data/backup.ts';
    const { db, LibraryDatabase, initializeLibrary } = await import(/* @vite-ignore */ dbPath), { emptyInput, saveBook } = await import(/* @vite-ignore */ booksPath), { createSnapshot } = await import(/* @vite-ignore */ backupPath);
    await saveBook(db, { ...emptyInput, title: 'נשאר אחרי סגירת חלון' });
    const source = new LibraryDatabase('SYNTHETIC-close-' + crypto.randomUUID());
    try { await initializeLibrary(source); await saveBook(source, { ...emptyInput, title: 'ייבוא שנסגר באמצע' }); return { source: (await createSnapshot(source)).text, expected: (await createSnapshot(db)).fingerprint }; }
    finally { await source.delete(); }
  });
  const session = await page.context().newCDPSession(page); await session.send('Debugger.enable');
  let paused = false; session.on('Debugger.paused', () => { paused = true; });
  const attempt = page.evaluate(async ({ source, expected }) => {
    const dbPath = '/library/src/data/database.ts', backupPath = '/library/src/data/backup.ts', mergePath = '/library/src/data/backupMerge.ts';
    const { db } = await import(/* @vite-ignore */ dbPath), { validateBackup } = await import(/* @vite-ignore */ backupPath), { mergeSnapshot } = await import(/* @vite-ignore */ mergePath);
    const put = IDBObjectStore.prototype.put; let injected = false;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'copies' && !injected) {
        injected = true;
        // eslint-disable-next-line no-debugger -- Pause only this synthetic transaction, then close its tab before commit.
        debugger;
      }
      return put.apply(this, args);
    };
    await mergeSnapshot(db, await validateBackup(source), expected, {}, true);
  }, setup).catch(() => undefined);
  await expect.poll(() => paused, { timeout: 15000 }).toBe(true);
  const context = page.context(); await page.close(); await attempt;
  const reopened = await context.newPage(); await reopened.goto('');
  await expect(reopened.getByRole('button', { name: /נשאר אחרי סגירת חלון.*1 עותקים/ })).toBeVisible();
  expect(await fingerprint(reopened)).toBe(setup.expected);
  await expect(reopened.locator('.book-list li:not([hidden])')).toHaveCount(1);
});
