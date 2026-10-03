import { test, expect } from '@playwright/test';

async function libraryFingerprint(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const { db } = await import(resources.filter(name => name.includes('/src/data/database.ts')).at(-1)!) as typeof import('../src/data/database');
    const { createSnapshot } = await import(resources.filter(name => name.includes('/src/data/backup.ts')).at(-1)!) as typeof import('../src/data/backup');
    return (await createSnapshot(db)).fingerprint;
  });
}

test('T23 native version change retains unsaved text, blocks writes and releases without deleting the library', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('טיוטה שלא נשמרה');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/src/data/database.ts')).at(-1)!;
    const { db } = await import(url) as typeof import('../src/data/database');
    const request = indexedDB.open(db.name, 30);
    request.onupgradeneeded = () => request.transaction!.abort();
    request.onerror = event => event.preventDefault();
    (window as unknown as { upgradeRequest: IDBOpenDBRequest }).upgradeRequest = request;
  });
  await expect(page.getByRole('heading', { name: 'שדרוג ממתין בחלון אחר', exact: true })).toBeVisible();
  expect(await page.locator('dialog input').evaluateAll(inputs => inputs.some(input => (input as HTMLInputElement).value === 'טיוטה שלא נשמרה'))).toBe(true);
  expect(await page.locator('.app-shell').evaluate(element => !!element.closest('[inert]'))).toBe(true);
  await page.getByRole('button', { name: 'סגירת החיבור בלי איפוס' }).click();
  await expect(page.getByRole('heading', { name: 'החיבור לספרייה נסגר' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { upgradeRequest: IDBOpenDBRequest }).upgradeRequest.readyState)).toBe('done');
  await page.getByRole('button', { name: 'פתיחה מחדש', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'כל הספרים' })).toBeVisible();
  await expect(page.getByText('טיוטה שלא נשמרה', { exact: true })).toHaveCount(0);
});

test('T23 a native old connection blocks startup; cancellation does not reset it, and release allows migration', async ({ page, context }) => {
  // This Playwright context is isolated from the personal browser. Seed the same released schema in a separate document.
  await page.goto('./'); await expect(page.getByRole('heading', { name: 'כל הספרים' })).toBeVisible();
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/src/data/database.ts')).at(-1)!;
    const { db } = await import(url) as typeof import('../src/data/database');
    const tables = db.tables.map(table => ({ name: table.name, key: table.schema.primKey.keyPath, indexes: table.schema.indexes.map(index => ({ name: index.name, key: index.keyPath, unique: index.unique, multi: index.multi })) }));
    db.close();
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(db.name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(db.name, 10);
      request.onupgradeneeded = () => {
        for (const table of tables) {
          const store = request.result.createObjectStore(table.name, { keyPath: table.key as string });
          for (const index of table.indexes) store.createIndex(index.name, index.key as string | string[], { unique: index.unique, multiEntry: index.multi });
        }
      };
      request.onsuccess = () => { (window as unknown as { oldConnection: IDBDatabase }).oldConnection = request.result; resolve(); };
      request.onerror = () => reject(request.error);
    });
  });
  const target = await context.newPage(); await target.goto('./');
  await expect(target.getByRole('heading', { name: 'חלון אחר חוסם את שדרוג הספרייה' })).toBeVisible();
  await target.getByRole('button', { name: 'סגירת החיבור בלי איפוס' }).click();
  await expect(target.getByRole('heading', { name: 'החיבור לספרייה נסגר' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { oldConnection: IDBDatabase }).oldConnection.close());
  await target.getByRole('button', { name: 'פתיחה מחדש', exact: true }).click();
  await expect(target.getByRole('heading', { name: 'כל הספרים' })).toBeVisible();
  await target.close();
});

test('T23 JSON download/import transfers between native origins, preserves the source and shares a renamed path', async ({ page, context }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר מעבר סינתטי');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  const source = await libraryFingerprint(page), downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  const file = (await downloading).path();
  const target = await context.newPage(); await target.goto('http://localhost:4330/library/#settings');
  await expect(target.getByLabel('שם הספרייה', { exact: true })).toBeVisible();
  expect(await libraryFingerprint(target)).not.toBe(source);
  await target.getByLabel('בחירת גיבוי לשחזור').setInputFiles((await file)!);
  await expect(target.getByRole('heading', { name: /תצוגה מקדימה:/ })).toBeVisible();
  const safety = target.waitForEvent('download');
  await target.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await safety;
  await target.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה', { exact: true }).check();
  await target.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click();
  await expect(target.getByRole('heading', { name: /תצוגה מקדימה:/ })).toHaveCount(0);
  expect(await libraryFingerprint(target)).toBe(source);
  expect(await libraryFingerprint(page)).toBe(source);
  await target.goto('http://localhost:4330/library/renamed/#settings');
  await expect(target.getByLabel('שם הספרייה', { exact: true })).toBeVisible();
  expect(await libraryFingerprint(target)).toBe(source);
  await target.close();
});
