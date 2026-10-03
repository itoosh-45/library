import { test, expect, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('');
  await expect(page.getByRole('heading', { name: /כל הספרים/, level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
async function addBook(page: Page, title: string) {
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('production shell, manifest, all lazy assets and font survive offline; local book and loan persist', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const shell = await page.evaluate(async () => {
    const names = await caches.keys(), cache = await caches.open(names.find(name => name.startsWith('itoosh-library-shell-'))!);
    const urls = (await cache.keys()).map(request => new URL(request.url).pathname);
    const manifest = await (await fetch('/library/manifest.webmanifest')).json();
    return { urls, manifest, scope: (await navigator.serviceWorker.ready).scope };
  });
  expect(shell.scope).toBe('http://127.0.0.1:4334/library/');
  expect(shell.manifest).toMatchObject({ start_url: '/library/', scope: '/library/', lang: 'he', dir: 'rtl', display: 'standalone' });
  expect(shell.urls).toContain('/library/fonts/Heebo.ttf');
  expect(shell.urls.some(url => url.includes('BarcodeScanner-'))).toBe(true);
  expect(shell.urls.some(url => url.includes('SingleBookVision-'))).toBe(true);
  expect(shell.urls.some(url => url.includes('ShelfBatch-'))).toBe(true);
  expect(shell.urls.some(url => url.includes('ExcelPanel-'))).toBe(true);
  expect(shell.urls).toContain('/library/templates/full-example.xlsx');
  expect(shell.manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512', '512x512']);
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('heading', { name: /כל הספרים/, level: 1 })).toBeVisible();
  await expect(page.getByText('אין חיבור לרשת. הספרייה המקומית זמינה; חיפוש בקטלוגים וזיהוי תמונות דורשים רשת.')).toBeVisible();
  await addBook(page, 'ספר אופליין סינתטי');
  await page.locator('.book-list button').first().click();
  await page.getByText('השאלת עותק', { exact: true }).click();
  await page.getByLabel('שם האדם להשאלה', { exact: true }).fill('קורא סינתטי');
  await page.getByRole('button', { name: 'שמירת ההשאלה', exact: true }).click();
  await expect(page.locator('.book-loans .loan-entry')).toHaveCount(1);
  await page.getByText('חיפוש והשלמה מקטלוגים', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'זיהוי ספר מתמונה', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'זיהוי ספר מתמונה', exact: true })).toBeVisible();
  await expect(page.getByText('זיהוי דורש רשת. בחירה וחיתוך תמונה זמינים במכשיר.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'סריקת ברקוד או הקלדת מזהה', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'סריקת ברקוד', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'צילום מדף בכמה תמונות', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1); await page.keyboard.press('Escape');
  await page.reload(); await expect(page.locator('.book-list .loan-badge')).toContainText('מושאל');
  await page.locator('.book-list button').first().click(); await page.getByRole('button', { name: 'רישום החזרה', exact: true }).click();
  await expect(page.locator('.book-loans')).toContainText('1 עותקים זמינים להשאלה');
  await page.keyboard.press('Escape'); await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await expect(page.getByText('קובצי האפליקציה מוכנים לפתיחה ללא רשת.')).toBeVisible();
  await page.getByRole('button', { name: 'פתיחת כלי Excel', exact: true }).click();
  const excelDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'יצוא הספרייה ל־Excel', exact: true }).click();
  expect((await excelDownload).suggestedFilename()).toBe('library-tables.xlsx');
  await page.getByLabel('בחירת Excel לייבוא').setInputFiles('public/templates/Books-template.xlsx');
  await page.getByRole('button', { name: 'בדיקת המיפוי ותצוגה מקדימה', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'תצוגה מקדימה של Excel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ביטול ייבוא Excel', exact: true }).click();
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px Heebo'); })).toBe(true);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const geometry = await page.getByRole('region', { name: 'התקנה ואופליין' }).evaluate(section => {
    const outer = section.getBoundingClientRect();
    return { outer: { left: outer.left, right: outer.right, width: outer.width }, paragraphs: [...section.querySelectorAll('p')].map(p => {
      const range = document.createRange(); range.selectNodeContents(p);
      return { width: p.getBoundingClientRect().width, lines: [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right })) };
    }) };
  });
  expect(geometry.outer.left).toBeGreaterThanOrEqual(0);
  expect(geometry.outer.right).toBeLessThanOrEqual(360);
  for (const paragraph of geometry.paragraphs) for (const line of paragraph.lines) {
    expect(line.left).toBeGreaterThanOrEqual(geometry.outer.left - 1);
    expect(line.right).toBeLessThanOrEqual(geometry.outer.right + 1);
  }
  await page.getByRole('region', { name: 'התקנה ואופליין' }).screenshot({ path: 'test-results/pwa-artifacts/phase13-offline-360.png' });
  expect(errors).toEqual([]);
});

test('worker does not intercept secret query, headers, POST, API or outside scope', async ({ page }) => {
  await open(page);
  for (const [path, options] of [
    ['/library/manifest.webmanifest?private=synthetic', {}],
    ['/library/manifest.webmanifest', { headers: { 'x-goog-api-key': 'synthetic-only' } }],
    ['/library/manifest.webmanifest', { method: 'POST', body: 'synthetic' }],
    ['/library/api/catalog', {}], ['/camera-demo-archive/', {}],
  ] as const) {
    const responsePromise = page.waitForResponse(response => response.url().endsWith(path) && response.request().method() === (options.method ?? 'GET'));
    await page.evaluate(async ({ path, options }) => { await fetch(path, options); }, { path, options });
    expect((await responsePromise).fromServiceWorker()).toBe(false);
  }
  const urls = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat());
  expect(urls.every(url => !url.includes('?') && !url.includes('/api/') && !url.includes('camera-demo'))).toBe(true);
});

test('real v1 to v2 waiting update preserves edits, rejects other windows, reloads only on explicit safe action', async ({ page, context, request }) => {
  await open(page); await addBook(page, 'ספר שנשאר בעדכון');
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByLabel('שם הספרייה', { exact: true }).fill('שם שלא נשמר בעדכון');
  await request.post('http://127.0.0.1:4334/__test/build');
  await page.getByRole('button', { name: 'בדיקת עדכון', exact: true }).click();
  await expect(page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true }).click();
  await expect(page.getByText('סיים או סגור עריכה ושחזור לפני העדכון.')).toBeVisible();
  await expect(page.getByLabel('שם הספרייה', { exact: true })).toHaveValue('שם שלא נשמר בעדכון');
  await page.getByRole('button', { name: 'שמירת השם', exact: true }).click();
  await expect(page.getByText('שם הספרייה נשמר.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('itoosh-library-shell-')).length)).toBe(2);
  await page.getByLabel('מפתח Gemini אישי', { exact: true }).fill('synthetic-unsaved-key');
  await page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true }).click();
  await expect(page.getByText('סיים או סגור עריכה ושחזור לפני העדכון.')).toBeVisible();
  await page.getByLabel('מפתח Gemini אישי', { exact: true }).fill('');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  const download = await downloading;
  await page.getByLabel('בחירת גיבוי לשחזור', { exact: true }).setInputFiles((await download.path())!);
  await expect(page.getByRole('heading', { name: /תצוגה מקדימה:/ })).toBeVisible();
  await page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true }).click();
  await expect(page.getByText('סיים או סגור עריכה ושחזור לפני העדכון.')).toBeVisible();
  await page.getByRole('button', { name: 'ביטול השחזור', exact: true }).click();
  const second = await context.newPage(); await second.goto('');
  await page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true }).click();
  await expect(page.getByText('סגור חלונות נוספים של הספרייה ונסה שוב.')).toBeVisible();
  await second.close();
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('טיוטה שלא נשמרה');
  await page.evaluate(() => { window.location.hash = 'settings'; });
  await expect(page.locator('.notice').filter({ hasText: 'גרסה חדשה ממתינה' })).toHaveCount(1);
  await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === 'עדכון ופתיחה מחדש'); button?.click(); });
  await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('טיוטה שלא נשמרה');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'ויתור על השינויים', exact: true }).click();
  await page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true }).click();
  await expect(page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('שם הספרייה', { exact: true })).toHaveValue('שם שלא נשמר בעדכון');
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('itoosh-library-shell-')).length)).toBe(1);
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ספר שנשאר בעדכון', exact: true })).toBeVisible();
});

for (const result of ['denied', 'unsupported', 'approved'] as const) test(`storage persistence ${result} is explicit and retains backup warning`, async ({ page }) => {
  await page.addInitScript(value => {
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: value === 'unsupported' ? undefined : async () => value === 'approved' });
  }, result);
  await open(page); await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByRole('button', { name: 'בקשת אחסון מתמיד', exact: true }).click();
  await expect(page.getByRole('region', { name: 'התקנה ואופליין' })).toContainText(result === 'approved' ? 'הדפדפן אישר אחסון מתמיד.' : result === 'denied' ? 'הדפדפן לא אישר אחסון מתמיד.' : 'הדפדפן אינו תומך בבקשת אחסון מתמיד.');
  await expect(page.getByRole('region', { name: 'התקנה ואופליין' })).toContainText('גיבוי');
});
