import { test, expect, type Page } from '@playwright/test';
const endpoint = 'https://maya-n8n.duckdns.org/library-catalog';
const key = 'a'.repeat(64);
async function enable(page: Page) {
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByText('קטלוגים · הקטלוג הישראלי, דני ספרים, הספרייה הלאומית ו־Goodreads', { exact: true }).click();
  await page.getByLabel('מפתח שירות הקטלוג הפרטי', { exact: true }).fill(key);
  await page.getByRole('button', { name: 'שמירת מפתח שירות הקטלוג', exact: true }).click();
  await expect(page.getByText('שירות הקטלוג הפרטי מוגדר במכשיר הזה.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
}

export function goodreadsTests() {
  test('Goodreads search applies edition and series only after selection, saves a local cover and excludes the key from backup', async ({ page, context }) => {
    test.skip(test.info().project.use.browserName === 'webkit' && process.platform === 'win32', 'Windows WebKit cannot persist even a plain Blob in native IndexedDB; reproduced independently of the app. Real Safari cover persistence remains unverified.');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 360, height: 800 }); await page.goto('');
    const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 300; canvas.getContext('2d')!.fillRect(0, 0, 200, 300); return canvas.toDataURL('image/png').split(',')[1]; });
    await page.route('https://openlibrary.org/**', route => route.fulfill({ json: { docs: [] } }));
    let details = 0;
    await page.route(endpoint + '/**', route => {
    if (route.request().url().endsWith('/icl-search')) return route.fulfill({json:{provider:'icl',results:[],cached:true}});
      expect(route.request().headers().authorization).toBe('Bearer ' + key);
      if (route.request().url().endsWith('/nli-search')) return route.fulfill({ json: { provider: 'nli', results: [], cached: true } });
      const source = { provider: 'goodreads', recordId: '123', sourceUrl: 'https://www.goodreads.com/book/show/123', fetchedAt: '2026-10-07T00:00:00.000Z', cached: true };
      if (route.request().url().endsWith('/v1/search')) { expect(route.request().postDataJSON()).toEqual({ query: 'ספר סינתטי' }); return route.fulfill({ json: { provider: 'goodreads', cached: true, results: [{ ...source, fields: { title: 'ספר סינתטי' } }] } }); }
      details++; expect(route.request().postDataJSON()).toEqual({ id: '123' });
      return route.fulfill({ json: { ...source, fields: { title: 'ספר סינתטי', authors: ['מחבר בדיקה'], publisher: 'הוצאה סינתטית', publicationDate: '2024-02-29', publicationYear: 2024, binding: 'Paperback', series: 'סדרת בדיקה', seriesNumber: 2 }, coverUrl: 'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/example.jpg' } });
    });
    await page.route('https://m.media-amazon.com/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }));
    await enable(page); await page.reload();
    await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
    await page.getByLabel('שם ספר, דאנאקוד או ISBN', { exact: true }).fill('ספר סינתטי');
    await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
    await expect(page.getByRole('button', { name: 'בחירת מועמד ספר סינתטי', exact: true })).toBeVisible();
    expect(details).toBe(0); await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'בחירת מועמד ספר סינתטי', exact: true }).click();
    await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('ספר סינתטי');
    await expect(page.getByLabel('סדרה מהקטלוג', { exact: true })).toHaveValue('סדרת בדיקה');
    await expect(page.getByLabel('מספר בסדרה', { exact: true })).toHaveValue('2');
    await expect(page.getByLabel('תאריך פרסום', { exact: true })).toHaveValue('2024-02-29');
    await expect(page.getByRole('dialog').getByRole('img', { name: 'כריכת הספר', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/goodreads-book-form.png', fullPage: true });
    await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload(); await page.getByRole('button', { name: /ספר סינתטי מחבר בדיקה/ }).click();
    await expect(page.getByLabel('סדרה', { exact: true })).toContainText('סדרת בדיקה');
    await expect(page.getByLabel('מספר בסדרה', { exact: true })).toHaveValue('2');
    await page.getByRole('button', { name: 'סגירה', exact: true }).click();
    await page.getByRole('link', { name: 'הגדרות', exact: true }).click(); await page.getByText('גיבוי ושחזור הספרייה', { exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
    const file = await download, stream = await file.createReadStream(), parts: Buffer[] = []; for await (const part of stream!) parts.push(Buffer.from(part));
    const text = Buffer.concat(parts).toString('utf8'), snapshot = JSON.parse(text);
    expect(text).not.toContain(key); expect(snapshot.formatVersion).toBe(12); expect(snapshot.tables.metadataSources[0]).toMatchObject({ provider: 'goodreads', fieldValues: { seriesName: 'סדרת בדיקה', seriesNumber: 2 } });
    await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
    // Only the production build has a worker; both builds must retain local book data across reload.
    if (new URL(page.url()).port === '4334') { await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true); await context.setOffline(true); }
    await page.reload(); await expect(page.locator('.book-jacket img')).toBeVisible(); expect(errors).toEqual([]);
  });

  test('Goodreads metadata can be edited before saving and a catalog series can be replaced manually', async ({ page }) => {
    await page.goto(''); await enable(page);
    await page.route('https://openlibrary.org/**', route => route.fulfill({ json: { docs: [] } }));
    await page.route(endpoint + '/**', route => route.request().url().endsWith('/nli-search') ? route.fulfill({ json: { provider: 'nli', results: [], cached: true } }) : route.fulfill({ json: route.request().url().endsWith('/v1/search') ? { provider: 'goodreads', cached: true, results: [{ recordId: '123', sourceUrl: 'https://www.goodreads.com/book/show/123', fields: { title: 'ספר סינתטי' } }] } : { provider: 'goodreads', recordId: '123', sourceUrl: 'https://www.goodreads.com/book/show/123', cached: true, fields: { title: 'ספר סינתטי', series: 'סדרה מהמקור', seriesNumber: 3, publicationDate: '2024-02-29', publicationYear: 2024, binding: 'Paperback' } } }));
    await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
    await page.getByLabel('שם ספר, דאנאקוד או ISBN', { exact: true }).fill('ספר סינתטי'); await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
    await page.getByRole('button', { name: 'בחירת מועמד ספר סינתטי', exact: true }).click();
    await expect(page.getByLabel('סדרה מהקטלוג', { exact: true })).toHaveValue('סדרה מהמקור');
    await page.getByLabel('שם הספר', { exact: true }).fill('שם מתוקן');
    await page.getByLabel('סדרה', { exact: true }).selectOption(''); await expect(page.getByLabel('מספר בסדרה', { exact: true })).toBeDisabled();
    await page.getByLabel('סדרה חדשה', { exact: true }).fill('סדרה ידנית'); await page.getByRole('button', { name: 'יצירת סדרה', exact: true }).click();
    await page.getByLabel('מספר בסדרה', { exact: true }).fill('4'); await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); await page.reload(); await page.getByRole('button', { name: /שם מתוקן ללא מחבר/ }).click();
    await expect(page.getByLabel('סדרה', { exact: true })).toContainText('סדרה ידנית'); await expect(page.getByLabel('מספר בסדרה', { exact: true })).toHaveValue('4');
    await expect(page.getByLabel('תאריך פרסום', { exact: true })).toHaveValue('2024-02-29');
  });

  test('blocked Goodreads leaves other catalog results usable and exposes no URL input; key deletion survives reload', async ({ page }) => {
    await page.goto(''); await enable(page);
    await page.route(endpoint + '/**', route => route.request().url().endsWith('/nli-search') ? route.fulfill({ json: { provider: 'nli', results: [], cached: true } }) : route.fulfill({ status: 503, json: { state: 'blocked' } }));
    await page.route('https://openlibrary.org/**', route => route.fulfill({ json: { docs: [{ key: '/works/OL88W', title: 'ספר ממקור אחר' }] } }));
    await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
    await page.getByLabel('שם ספר, דאנאקוד או ISBN', { exact: true }).fill('ספר'); await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
    await expect(page.getByText('Goodreads חוסם כרגע את שליפת המידע. אפשר לנסות ISBN במקום שם, או לבחור מקור אחר.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'בחירת מועמד ספר ממקור אחר', exact: true })).toBeVisible(); await expect(page.locator('input[type="url"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'סגירה', exact: true }).click(); await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
    await page.getByText('קטלוגים · הקטלוג הישראלי, דני ספרים, הספרייה הלאומית ו־Goodreads', { exact: true }).click(); await page.getByRole('button', { name: 'מחיקת מפתח שירות הקטלוג', exact: true }).click();
    await page.reload(); await page.getByText('קטלוגים · הקטלוג הישראלי, דני ספרים, הספרייה הלאומית ו־Goodreads', { exact: true }).click(); await expect(page.getByLabel('מפתח שירות הקטלוג הפרטי', { exact: true })).toHaveValue('');
  });
}
