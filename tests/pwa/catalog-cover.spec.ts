import { test, expect } from '@playwright/test';

test('production CSP allows a validated catalog cover; a later failed cover preserves it and offline displays it', async ({ page, context }) => {
  await page.goto('./');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 300; c.getContext('2d')!.fillRect(0, 0, 200, 300); return c.toDataURL('image/png').split(',')[1]; });
  await page.route('https://openlibrary.org/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/search.json' ? { docs: [{ key: '/works/OL88W', title: 'ספר כריכה סינתטי', editions: { docs: [{ key: '/books/OL88M', title: 'ספר כריכה סינתטי' }] } }] } : { title: 'ספר כריכה סינתטי', publishers: ['הוצאה סינתטית'], covers: [88] } }));
  let missing = false;
  await page.route('https://covers.openlibrary.org/**', route => missing ? route.fulfill({ status: 404, body: 'missing' }) : route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }));
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
  await page.getByLabel('שם לחיפוש', { exact: true }).fill('ספר כריכה סינתטי');
  await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
  await page.getByRole('button', { name: 'בחירת מועמד ספר כריכה סינתטי', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'כריכת הספר', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await page.getByRole('button', { name: /ספר כריכה סינתטי.*1 עותקים/ }).click();
  missing = true;
  await page.getByText('חיפוש והשלמה מקטלוגים', { exact: true }).click();
  await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
  await page.getByRole('button', { name: 'בחירת מועמד ספר כריכה סינתטי', exact: true }).click();
  await expect(page.getByText(/הכריכה לא נטענה; אפשר להעלות תמונה ידנית/)).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'כריכת הספר', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.book-jacket img')).toBeVisible();
});
