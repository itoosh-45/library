import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function mockCatalog(page: Page) {
  const requests: string[] = [];
  await page.route('https://openlibrary.org/**', async route => {
    requests.push(route.request().url()); const path = new URL(route.request().url()).pathname;
    const value = path === '/search.json' ? { docs: [{ key: '/works/OL88W', title: 'יצירה כללית', first_publish_year: 1900, isbn: ['9780140328721'], editions: { docs: [{ key: '/books/OL88M', title: 'ספר קטלוג סינתטי' }] } }] } : path === '/books/OL88M.json' ? { title: 'ספר קטלוג סינתטי', publish_date: '2014', publishers: ['הוצאה סינתטית'], number_of_pages: 200, isbn_13: ['9780140328721'], authors: [{ key: '/authors/OL88A' }] } : { name: 'מחבר קטלוג סינתטי' };
    await route.fulfill({ json: value });
  });
  return requests;
}
test('T15 candidate field choice is explicit, overrides survive save/reload, provenance is protected by v4 backup and restore', async ({ page }) => {
  const requests = await mockCatalog(page), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(''); await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByLabel('שם הספר', { exact: true }).fill('שם ידני לפני חיפוש');
  await page.getByText('חיפוש והשלמה מקטלוגים', { exact: true }).click(); await page.getByLabel('שם לחיפוש', { exact: true }).fill('ספר קטלוג סינתטי'); await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
  await expect(page.getByText('החיבור לקטלוג זה ממתין לשירות ולמפתח מורשה.', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'בחירת מועמד ספר קטלוג סינתטי', exact: true }).click(); await expect(page.getByRole('heading', { name: 'בחירת שדות: ספר קטלוג סינתטי', exact: true })).toBeVisible();
  await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('שם ידני לפני חיפוש'); await expect(page.getByRole('button', { name: 'החלת השדות שנבחרו', exact: true })).toBeDisabled();
  const choice = page.locator('.catalog-choice'); await choice.filter({ hasText: 'שם הספר:' }).getByRole('checkbox').check(); await choice.filter({ hasText: 'מחברים:' }).getByRole('checkbox').check(); await choice.filter({ hasText: 'שנת הוצאה:' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'החלת השדות שנבחרו', exact: true }).click(); await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('ספר קטלוג סינתטי'); await page.getByLabel('שם הספר', { exact: true }).fill('עריכה ידנית נשמרת');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await page.reload();
  await page.getByRole('button', { name: /עריכה ידנית נשמרת.*1 עותקים/ }).click(); await page.getByText('מקורות המידע (1)', { exact: true }).click(); await expect(page.getByText('נערך ידנית: שם הספר', { exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click(); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click(); const buffer = await readFile((await (await downloading).path())!); const backup = JSON.parse(buffer.toString()); expect(backup.version).toBe(5); expect(backup.counts.metadataSources).toBe(1); expect(backup.data.metadataSources[0].userOverriddenFields).toEqual(['title']); expect(backup.data.books[0].isbn13).toBeNull();
  await page.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'synthetic-v4.json', mimeType: 'application/json', buffer }); await expect(page.getByText(/1 מקורות מידע/)).toBeVisible(); await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה').check(); await page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click(); await expect(page.getByText('הספרייה שוחזרה בהצלחה.')).toBeVisible();
  await test.info().attach('synthetic-catalog-backup', { body: buffer, contentType: 'application/json' });
  expect(requests).toHaveLength(3); expect(requests.every(url => !/שם ידני|עריכה ידנית/.test(decodeURIComponent(url)))).toBe(true); expect(errors).toEqual([]);
});
test('T15 selecting catalog ISBN preserves duplicate copy choice and does not overwrite the existing book', async ({ page }) => {
  await mockCatalog(page); await page.goto(''); await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByLabel('שם הספר', { exact: true }).fill('ספר קיים'); await page.getByText('פרטים נוספים', { exact: true }).click(); await page.getByLabel('ISBN', { exact: true }).fill('9780140328721'); await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByText('חיפוש והשלמה מקטלוגים', { exact: true }).click(); await page.getByLabel('ISBN לחיפוש', { exact: true }).fill('9780140328721'); await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click(); await page.getByRole('button', { name: 'בחירת מועמד ספר קטלוג סינתטי', exact: true }).click();
  await page.locator('.catalog-choice').filter({ hasText: 'ISBN-13:' }).getByRole('checkbox').check(); await page.getByRole('button', { name: 'החלת השדות שנבחרו', exact: true }).click(); await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('heading', { name: 'ISBN זה כבר נמצא בספרייה', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'הוספת עותק לספר הקיים', exact: true }).click(); await expect(page.getByRole('button', { name: /ספר קיים.*2 עותקים/ })).toBeVisible();
  const sources = await page.evaluate(async () => { const path = '/library/src/data/database.ts'; const { db } = await import(/* @vite-ignore */ path); return db.metadataSources.count(); }); expect(sources).toBe(0);
});
test('T15 provider failure, XSS text and narrow field selection remain safe without automatic writes', async ({ page }) => {
  await page.route('https://openlibrary.org/search.json?**', route => route.fulfill({ json: { docs: [{ key: '/works/OL99W', title: '<img src=x onerror=alert(1)>', first_publish_year: 1900, isbn: ['9780140328721'] }] } }));
  await page.goto(''); await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByText('חיפוש והשלמה מקטלוגים', { exact: true }).click(); await page.getByLabel('שם לחיפוש', { exact: true }).fill('בדיקה סינתטית'); await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click(); await page.getByRole('button', { name: 'בחירת מועמד <img src=x onerror=alert(1)>', exact: true }).click();
  await expect(page.locator('.catalog-choice')).toHaveCount(1); await expect(page.locator('.catalog-panel img')).toHaveCount(0); await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue(''); await page.setViewportSize({ width: 360, height: 800 }); await page.locator('.notice').scrollIntoViewIfNeeded(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'test-results/phase08-360-candidate.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(page.locator('.book-list li')).toHaveCount(0);
});
