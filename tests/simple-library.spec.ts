import { test, expect, type Page } from '@playwright/test';

async function picture(page: Page) {
  return page.evaluate(() => { const c = document.createElement('canvas'); c.width = 240; c.height = 360; const ctx = c.getContext('2d')!; ctx.fillStyle = '#d6e1da'; ctx.fillRect(0, 0, 240, 360); ctx.fillStyle = '#205b49'; ctx.font = '28px sans-serif'; ctx.fillText('SYNTHETIC', 25, 170); return c.toDataURL('image/png').split(',')[1]; });
}
test('phone: direct add, cover, title fallback, search, edit and shelf membership without advanced controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 360, height: 800 }); await page.goto('');
  await expect(page.getByRole('region', { name: 'היכרות קצרה עם הספרייה' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'השאלות', exact: true })).toHaveCount(0);
  await expect(page.getByText('סטטיסטיקה', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'מדפים', exact: true }).click();
  await page.getByRole('button', { name: 'הוספת מדף', exact: true }).click();
  await page.getByLabel('שם המדף', { exact: true }).fill('מדף בדיקה');
  await page.getByRole('button', { name: 'שמירת המדף', exact: true }).click();
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  const png = await picture(page);
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await expect(page.getByLabel('שם הספר', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'הוספה ידנית', exact: true })).toHaveCount(0);
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר עם כריכה');
  await page.getByLabel('מחבר', { exact: true }).fill('מחבר בדיקה');
  await page.getByLabel('מדף', { exact: true }).selectOption({ label: 'מדף בדיקה' });
  await page.getByLabel('תמונת כריכה').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר ללא תמונה');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.locator('.jacket-title').filter({ hasText: 'ספר ללא תמונה' })).toBeVisible();
  await expect(page.locator('.book-jacket img')).toBeVisible();
  await page.getByLabel('חיפוש ספר', { exact: true }).fill('מחבר בדיקה'); await expect(page.locator('.book-list li')).toHaveCount(1);
  await page.getByRole('button', { name: /ספר עם כריכה מחבר בדיקה/ }).click();
  await expect(page.getByLabel('מדף', { exact: true })).not.toHaveValue('');
  await expect(page.getByRole('heading', { name: /עותקים/ })).toHaveCount(0);
  await page.getByLabel('שם הספר', { exact: true }).fill('שם מעודכן');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await page.getByLabel('חיפוש ספר', { exact: true }).fill(''); await page.reload();
  await expect(page.getByRole('heading', { name: 'שם מעודכן', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/simple-library-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: 'test-results/simple-library-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('simplified catalog: scanned identifier searches automatically and applies language, edition and local cover', async ({ page }) => {
  await page.goto(''); const png = await picture(page); let searches = 0;
  await page.route('https://openlibrary.org/**', route => {
    const path = new URL(route.request().url()).pathname; if (path === '/search.json') searches++;
    return route.fulfill({ json: path === '/search.json' ? { docs: [{ key: '/works/OL88W', title: 'ספר סריקה', editions: { docs: [{ key: '/books/OL88M', title: 'ספר סריקה' }] } }] } : { title: 'ספר סריקה', publish_date: '2020', publishers: ['הוצאה בדיקה'], languages: [{ key: '/languages/heb' }], isbn_13: ['9780140328721'], covers: [88] } });
  });
  await page.route('https://covers.openlibrary.org/**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }));
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByText('מילוי אוטומטי מסריקה או תמונה', { exact: true }).click();
  await page.getByRole('button', { name: 'סריקת ברקוד או הקלדת מזהה', exact: true }).click();
  await page.getByLabel('מזהה שנקרא או הוקלד', { exact: true }).fill('9780140328721');
  await page.getByRole('button', { name: 'שימוש במזהה ובדיקת הספר', exact: true }).click();
  await page.getByRole('button', { name: 'בחירת מועמד ספר סריקה', exact: true }).click();
  await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('ספר סריקה');
  await expect(page.getByRole('dialog').getByRole('img', { name: 'כריכת הספר' })).toBeVisible();
  expect(searches).toBe(1); await expect(page.locator('.catalog-panel input[type=checkbox]')).toHaveCount(0);
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  const saved = await page.evaluate(async () => { const path = '/library/src/data/database.ts'; const { db } = await import(/* @vite-ignore */ path); return (await db.books.toArray())[0]; });
  expect(saved.language).toBe('heb'); expect(saved.publicationYear).toBe(2020); expect(saved.publisher).toBe('הוצאה בדיקה'); expect(saved.primaryImageId).toBeTruthy();
});

test('editing the simple form preserves hidden classification, notes, multiple shelf memberships and copies', async ({ page }) => {
  await page.goto('');
  const before = await page.evaluate(async () => {
    const dp = '/library/src/data/database.ts', bp = '/library/src/data/books.ts', cp = '/library/src/data/collections.ts', rp = '/library/src/data/backup.ts';
    const { db } = await import(dp), { emptyInput, saveBook } = await import(bp), { saveNamedItem, saveShelf } = await import(cp), { readCore } = await import(rp);
    const tag = await saveNamedItem(db, 'tags', 'תגית קיימת'), genre = await saveNamedItem(db, 'genres', 'ז׳אנר קיים'), series = await saveNamedItem(db, 'series', 'סדרה קיימת');
    const a = await saveShelf(db, { name: 'ראשון', parentId: null }), b = await saveShelf(db, { name: 'שני', parentId: null });
    await saveBook(db, { ...emptyInput, title: 'ספר קיים', authors: ['מחבר ראשון', 'מחבר שני'], tagIds: [tag.id], genreIds: [genre.id], seriesId: series.id, seriesNumber: '2', shelfIds: [a.id, b.id], readStatus: 'read', personalNotes: 'הערה שמורה', language: 'עברית', publisher: 'הוצאה קיימת' });
    return readCore(db);
  });
  await page.getByRole('button', { name: /ספר קיים מחבר ראשון/ }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('רק השם השתנה'); await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = await page.evaluate(async () => { const dp = '/library/src/data/database.ts', rp = '/library/src/data/backup.ts'; const { db } = await import(dp), { readCore } = await import(rp); return readCore(db); });
  expect(after.books[0]).toMatchObject({ ...before.books[0], title: 'רק השם השתנה', titleSortKey: 'רק השם השתנה', revision: before.books[0].revision + 1, updatedAt: after.books[0].updatedAt });
  for (const key of Object.keys(before).filter(key => key !== 'books')) expect(after[key as keyof typeof after], key).toEqual(before[key as keyof typeof before]);
});

test('photo recognition uses all available details with one apply action and no crop controls', async ({ page }) => {
  await page.goto(''); const png = await picture(page);
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByText('זיהוי ספר מתמונה · Gemini', { exact: true }).click();
  await page.getByLabel('מפתח Gemini אישי', { exact: true }).fill('synthetic-key-without-live-provider');
  await page.getByLabel('בדקתי שהפרויקט של המפתח הוא Free, ללא חיוב פעיל', { exact: true }).check();
  await page.getByLabel('אני מסכים לשליחת התמונה המוכנה ל־Google Gemini', { exact: true }).check();
  await page.getByRole('button', { name: 'שמירת מפתח Gemini', exact: true }).click();
  await expect(page.getByText('מפתח אישי מוגדר בדפדפן הזה.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  await page.route('https://generativelanguage.googleapis.com/**', route => route.fulfill({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ items: [{ title: 'ספר מתמונה', authors: ['מחבר מתמונה'], isbn: null, danacode: null, publisher: null, visibleText: 'ספר מתמונה מחבר מתמונה', evidenceByField: { title: ['ספר מתמונה'], authors: ['מחבר מתמונה'], isbn: [], danacode: [], publisher: [] }, imageIndex: 0, bbox: [0, 0, 1, 1], uncertaintyReasons: [] }] }) }] } }] } }));
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByText('מילוי אוטומטי מסריקה או תמונה', { exact: true }).click();
  await page.getByRole('button', { name: 'זיהוי ספר מתמונה', exact: true }).click();
  await page.getByLabel('בחירת תמונת ספר', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('heading', { name: 'פרטי הספר שזוהה' })).toBeVisible();
  await expect(page.getByLabel('גבול שמאל', { exact: true })).toHaveCount(0);
  await expect(page.locator('.catalog-choice input')).toHaveCount(0);
  await page.getByRole('button', { name: 'שימוש בפרטי הספר', exact: true }).click();
  await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('ספר מתמונה'); await expect(page.getByLabel('מחבר', { exact: true })).toHaveValue('מחבר מתמונה');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
});
