import { test, expect } from '@playwright/test';

test('Hebrew shell, local-only requests, navigation, rename and reload', async ({ page }) => {
  const external: string[] = []; const errors: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4330/')) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('');
  await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  expect(await page.locator('html').getAttribute('lang')).toBe('he');
  expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByLabel('שם הספרייה', { exact: true }).fill('ספריית בדיקה');
  await page.getByRole('button', { name: 'שמירת השם' }).click();
  await expect(page.getByRole('status')).toHaveText('שם הספרייה נשמר.');
  await page.reload();
  await expect(page.getByLabel('שם הספרייה', { exact: true })).toHaveValue('ספריית בדיקה');
  await page.getByRole('link', { name: 'מדפים', exact: true }).click();
  await expect(page.getByRole('heading', { name: /מדפים/, level: 1 })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByRole('navigation').getByRole('link').count()).toBe(5);
  expect(external).toEqual([]); expect(errors).toEqual([]);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('real IndexedDB atomic writes, rollback, relation checks and cross-window visibility', async ({ page, context }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  const results = await page.evaluate(async () => {
    // These imports address the same modules used by the running app. No test-only endpoint is shipped.
    const modulePath = '/library/src/data/database.ts', servicePath = '/library/src/data/library.ts';
    const { db } = await import(/* @vite-ignore */ modulePath);
    const { createBookWithCopy } = await import(/* @vite-ignore */ servicePath);
    const id = (await db.settings.get('libraryId')).value;
    const { book, copy } = await createBookWithCopy(db, { title: 'ספר בדיקה' });
    await db.copies.add({ ...copy, id: crypto.randomUUID() });
    let relationRejected = false, rollbackRejected = false;
    try { await createBookWithCopy(db, { authorIds: ['missing-author'] }); } catch { relationRejected = true; }
    const fail = () => { throw new Error('intentional test failure'); };
    db.copies.hook('creating', fail);
    try { await createBookWithCopy(db, { title: 'should rollback' }); } catch { rollbackRejected = true; }
    db.copies.hook('creating').unsubscribe(fail);
    return { id, relationRejected, rollbackRejected, books: await db.books.count(), copies: await db.copies.count(), link: copy.bookId === book.id, stores: db.tables.length };
  });
  expect(results).toMatchObject({ relationRejected: true, rollbackRejected: true, books: 1, copies: 2, link: true, stores: 15 });
  await expect(page.getByRole('heading', { name: 'ספר בדיקה', exact: true })).toBeVisible();
  await expect(page.getByText('2 עותקים', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'ספר בדיקה', exact: true })).toBeVisible();
  const next = await context.newPage(); await next.goto('');
  await expect(next.getByRole('heading', { name: 'ספר בדיקה', exact: true })).toBeVisible();
  const id = await next.evaluate(async () => { const path = '/library/src/data/database.ts'; const { db } = await import(/* @vite-ignore */ path); return (await db.settings.get('libraryId')).value; });
  expect(id).toBe(results.id);
});

test('storage denial has a visible error and no database deletion', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', { value: () => { throw new DOMException('denied', 'SecurityError'); } });
    Object.defineProperty(indexedDB, 'deleteDatabase', { value: () => { throw new Error('database deletion must not be attempted'); } });
  });
  await page.goto('');
  await expect(page.getByRole('alert')).toContainText('לא אפשר גישה');
  await expect(page.getByRole('button', { name: 'ניסיון נוסף' })).toBeVisible();
  await expect(page.getByText('לא מחקנו את הספרייה.')).toBeVisible();
});
