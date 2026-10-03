import { test, expect } from '@playwright/test';

test('barcode automatically searches, all edition fields and a local cover survive save/reload; gallery uses title fallback', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('');
  await page.getByRole('button', { name: 'דילוג להמשך', exact: true }).click();
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 300;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#205b49'; ctx.fillRect(0, 0, 200, 300);
    ctx.fillStyle = '#fff'; ctx.font = '24px sans-serif'; ctx.fillText('SYNTHETIC', 20, 150);
    return Array.from(new Uint8Array(await (await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))).arrayBuffer()));
  });
  let queries = 0;
  await page.route('https://openlibrary.org/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/search.json') queries++;
    return route.fulfill({ json: path === '/search.json' ? { docs: [{ key: '/works/OL88W', title: 'ספר בדיקת כריכה', editions: { docs: [{ key: '/books/OL88M', title: 'ספר בדיקת כריכה' }] } }] } : { title: 'ספר בדיקת כריכה', publishers: ['הוצאה סינתטית'], publish_date: '2020', languages: [{ key: '/languages/heb' }], isbn_13: ['9780140328721'], number_of_pages: 123, covers: [88] } });
  });
  await page.route('https://covers.openlibrary.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(bytes) }));
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByRole('button', { name: 'סריקת ברקוד או הקלדת מזהה', exact: true }).click();
  await page.getByLabel('מזהה שנקרא או הוקלד', { exact: true }).fill('9780140328721');
  await page.getByRole('button', { name: 'שימוש במזהה ובדיקת הספר', exact: true }).click();
  await page.getByRole('button', { name: 'בחירת מועמד ספר בדיקת כריכה', exact: true }).click();
  await expect(page.getByRole('img', { name: 'כריכת הספר', exact: true })).toBeVisible();
  expect(queries).toBe(1);
  await expect(page.locator('.catalog-panel input[type=checkbox]')).toHaveCount(0);
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.book-jacket img')).toBeVisible();
  const saved = await page.evaluate(async () => {
    const path = '/library/src/data/database.ts'; const { db } = await import(/* @vite-ignore */ path);
    const book = (await db.books.toArray())[0], image = await db.images.get(book.primaryImageId);
    return { language: book.language, publisher: book.publisher, pages: book.pages, mime: image.mimeType, url: image.sourceUrl };
  });
  expect(saved).toEqual({ language: 'heb', publisher: 'הוצאה סינתטית', pages: 123, mime: 'image/jpeg', url: null });
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByRole('button', { name: 'הוספה ידנית', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר ללא תמונה');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.locator('.jacket-title').filter({ hasText: 'ספר ללא תמונה' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/cover-library-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'test-results/cover-library-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('body *')].map(element => [element, parseFloat(getComputedStyle(element).fontSize)] as const);
    for (const [element, size] of sizes) element.style.fontSize = size * 2 + 'px';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
