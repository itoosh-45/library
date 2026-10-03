import { test, expect, type Page } from '@playwright/test';
import { benchmarkDataset } from './dataset';

async function readLibrary(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('itoosh-45.library.personal.v1');
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const names = [...database.objectStoreNames], transaction = database.transaction(names, 'readonly');
      return await Promise.all(names.map(name => new Promise((resolve, reject) => {
        const read = transaction.objectStore(name).getAll(); read.onsuccess = () => resolve({ name, rows: read.result }); read.onerror = () => reject(read.error);
      })));
    } finally { database.close(); }
  });
}
test('injected native IndexedDB quota during large image restore preserves every prior table after reload', async ({ page }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'הוספה ידנית', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר סינתטי לפני כשל אחסון');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const image = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 320;
    canvas.getContext('2d')!.fillRect(0, 0, 240, 320);
    const base64 = canvas.toDataURL('image/jpeg', .1).split(',')[1], bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return { base64, width: 240, height: 320, byteLength: bytes.length, sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByLabel('בחירת גיבוי לשחזור', { exact: true }).setInputFiles({ name: 'SYNTHETIC-QUOTA.json', mimeType: 'application/json', buffer: Buffer.from(benchmarkDataset(1000, image)) });
  await expect(page.getByRole('heading', { name: /תצוגה מקדימה:/ })).toBeVisible({ timeout: 120000 });
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await downloading;
  await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה', { exact: true }).check();
  const before = await readLibrary(page);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add; let images = 0;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'images' && ++images === 3) throw new DOMException('Synthetic storage quota', 'QuotaExceededError');
      return add.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click();
  await expect(page.getByText(/אין מספיק מקום פנוי לאחסון בדפדפן/)).toBeVisible({ timeout: 120000 });
  expect(await readLibrary(page)).toEqual(before);
  await page.reload(); expect(await readLibrary(page)).toEqual(before);
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  await expect(page.getByRole('button', { name: /ספר סינתטי לפני כשל אחסון.*1 עותקים/ })).toBeVisible();
});
