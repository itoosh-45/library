import { test, expect, type Page } from '@playwright/test';
async function seed(page: Page) {
  return page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', booksPath = '/library/src/data/books.ts', collectionsPath = '/library/src/data/collections.ts';
    const { db } = await import(/* @vite-ignore */ dbPath), { saveBook, emptyInput } = await import(/* @vite-ignore */ booksPath), { saveNamedItem, saveShelf } = await import(/* @vite-ignore */ collectionsPath);
    const series = await saveNamedItem(db, 'series', 'סדרת חיפוש'), tag = await saveNamedItem(db, 'tags', 'חוֹרף'), genre = await saveNamedItem(db, 'genres', 'עיון');
    const root = await saveShelf(db, { name: 'ראשי', parentId: null }), child = await saveShelf(db, { name: 'ילד', parentId: root.id });
    const books = [];
    for (const [title, number] of [['אור ראשון', '10'], ['תָּמָר ״סוף״', '2'], ['בית בלי מספר', '']]) books.push(await saveBook(db, { ...emptyInput, title, authors: ['שם עט O’Neil'], seriesId: series.id, seriesNumber: number, tagIds: [tag.id], genreIds: [genre.id], shelfIds: [child.id], publisher: 'הוצאת ניסוי', language: 'עברית', publicationYear: '2020', pages: '100', readStatus: 'read' }));
    for (const title of ['גימל', 'דלת', 'הד', 'וו', 'זית', 'חתול', 'טית', 'כף', 'למד', 'מם', 'נון', 'סמך', 'עין', 'פה', 'צדי', 'קוף', 'ריש', 'שין', 'תות', 'English 10', '123']) books.push(await saveBook(db, { ...emptyInput, title }));
    return { seriesId: series.id, rootId: root.id, genreId: genre.id, tagId: tag.id, targetId: books[1].id };
  });
}
test('T13 global live search, cumulative filters, series in every sort, original text and backup remain intact', async ({ page }) => {
  test.setTimeout(60000); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible(); const ids = await seed(page);
  await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(24);
  for (const [query, count] of [['תמר סוף', 1], ['תָּמָר', 1], ['חורפ', 3], ["O'Neil", 3], ['שם עט', 3], ['english 10', 1], ['123', 1], ['לא נמצא', 0]] as const) {
    await page.getByLabel('חיפוש בכל הספרייה', { exact: true }).fill(query); await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(count);
  }
  await expect(page.getByRole('heading', { name: 'אין ספרים שמתאימים לחיפוש' })).toBeVisible();
  await page.getByRole('button', { name: 'ניקוי החיפוש והמסננים' }).click();
  await page.getByText('מיון וסינון', { exact: true }).click();
  await page.getByText('סינון הספרים', { exact: true }).click();
  await page.getByRole('combobox', { name: 'מדף לסינון', exact: true }).selectOption(ids.rootId); await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(3);
  await page.getByLabel('כולל צאצאי המדף').uncheck(); await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(0); await page.getByLabel('כולל צאצאי המדף').check();
  await page.getByRole('combobox', { name: 'ז׳אנר לסינון', exact: true }).selectOption(ids.genreId); await page.getByRole('group', { name: 'תגיות לסינון — כל הנבחרות' }).getByRole('checkbox').check();
  await page.getByRole('combobox', { name: 'מצב קריאה לסינון', exact: true }).selectOption('read'); await page.getByRole('combobox', { name: 'זמינות', exact: true }).selectOption('available');
  await page.getByRole('combobox', { name: 'הוצאה לסינון', exact: true }).selectOption('הוצאת ניסוי'); await page.getByRole('combobox', { name: 'שפה לסינון', exact: true }).selectOption('עברית'); await page.getByRole('combobox', { name: 'שנה לסינון', exact: true }).selectOption('2020');
  for (const sort of ['added', 'title', 'author', 'year', 'genre', 'pages', 'price']) {
    await page.getByRole('combobox', { name: 'מיון לפי', exact: true }).selectOption(sort);
    for (const direction of ['asc', 'desc']) { await page.getByRole('combobox', { name: 'כיוון המיון', exact: true }).selectOption(direction); await expect(page.locator('.series-group h2')).toHaveText(['תָּמָר ״סוף״', 'אור ראשון', 'בית בלי מספר']); }
  }
  await page.getByLabel('חיפוש בכל הספרייה').fill('תמר'); await expect(page.locator('.series-toggle')).toContainText('1 ספרים'); await expect(page.locator('.result-count')).toContainText('1 ספרים ייחודיים');
  await page.getByText('סטטיסטיקה', { exact: true }).click(); await expect(page.locator('.statistics')).toContainText('נקרא: 1'); await expect(page.locator('.statistics')).toContainText('חוֹרף: 1');
  const backup = await page.evaluate(async () => { const dbPath = '/library/src/data/database.ts', path = '/library/src/data/backup.ts'; const { db } = await import(/* @vite-ignore */ dbPath), { createSnapshot } = await import(/* @vite-ignore */ path); return JSON.parse((await createSnapshot(db)).text); });
  await test.info().attach('synthetic-backup', { body: JSON.stringify(backup), contentType: 'application/json' });
  expect(backup.version).toBe(7); expect(backup.data.books.find((book: { id: string }) => book.id === ids.targetId).title).toBe('תָּמָר ״סוף״'); expect(errors).toEqual([]);
});
test('T13 letter jumps open the first matching series, retain grouping and restore scroll/search after editing at desktop and 360px', async ({ page }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible(); await seed(page);
  const toggle = page.getByRole('button', { name: /סדרת חיפוש.*3 ספרים/ }); await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'קפיצה לאות ת', exact: true }).click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const target = page.getByRole('button', { name: /תָּמָר ״סוף״.*1 עותקים/ }); await expect(target).toBeFocused(); await expect(page.locator('.letter-index')).toContainText('האות הנוכחית: ת');
  await expect(page.locator('.series-group h2')).toHaveText(['תָּמָר ״סוף״', 'אור ראשון', 'בית בלי מספר']);
  const before = await page.evaluate(() => scrollY); await target.click(); await page.getByLabel('שם הספר', { exact: true }).fill('תָּמָר ״סוף״ חדש'); await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  await page.getByLabel('חיפוש בכל הספרייה').fill('שם עט'); await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(3);
  await page.getByRole('button', { name: /תָּמָר ״סוף״ חדש.*1 עותקים/ }).click(); await page.keyboard.press('Escape'); await expect(page.getByLabel('חיפוש בכל הספרייה')).toHaveValue('שם עט');
  await page.getByRole('button', { name: 'ניקוי החיפוש והמסננים' }).click(); await page.setViewportSize({ width: 360, height: 800 });
  await toggle.click(); await page.getByRole('button', { name: 'קפיצה לאות ת', exact: true }).click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /תָּמָר ״סוף״ חדש.*1 עותקים/ })).toBeFocused();
  await expect(page.locator('.letter-index')).toContainText('האות הנוכחית: ת');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/phase06-360.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: 'test-results/phase06-desktop.png', fullPage: true });
});
test('T13 isolated 1000-book baseline: query, sorting, grouped rendering and backup', async ({ page }) => {
  test.setTimeout(60000); await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  const calculation = await page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', bookPath = '/library/src/data/books.ts', searchPath = '/library/src/data/search.ts', collectionsPath = '/library/src/data/collections.ts', backupPath = '/library/src/data/backup.ts';
    const { db } = await import(/* @vite-ignore */ dbPath), { saveBook, emptyInput } = await import(/* @vite-ignore */ bookPath), { filterBooks, emptyFilters, bookComparator } = await import(/* @vite-ignore */ searchPath), { bookGroups } = await import(/* @vite-ignore */ collectionsPath), { createSnapshot } = await import(/* @vite-ignore */ backupPath);
    const template = await saveBook(db, { ...emptyInput, title: 'ספר סינתטי 0000' }), copy = (await db.copies.toArray())[0];
    const books = Array.from({ length: 999 }, (_, i) => ({ ...template, id: crypto.randomUUID(), title: `ספר סינתטי ${String(i + 1).padStart(4, '0')}`, titleSortKey: `ספר סינתטי ${String(i + 1).padStart(4, '0')}` }));
    await db.transaction('rw', db.books, db.copies, async () => { await db.books.bulkAdd(books); await db.copies.bulkAdd(books.map((book: { id: string }) => ({ ...copy, id: crypto.randomUUID(), bookId: book.id }))); });
    const data = { books: await db.books.toArray(), copies: await db.copies.toArray(), authors: [], tags: [], genres: [], shelves: [], bookShelves: [], loans: [] };
    const samples = [];
    for (let i = 0; i < 30; i++) { const start = performance.now(); const matches = filterBooks(data, { ...emptyFilters, query: 'סינתטי' }); bookGroups(matches, [], bookComparator(data, 'title')); samples.push(performance.now() - start); }
    const start = performance.now(), backup = await createSnapshot(db), backupMs = performance.now() - start;
    return { samples, backupMs, backupBooks: backup.counts.books };
  });
  await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(1000); expect(calculation.backupBooks).toBe(1000);
  const retainedRow = await page.locator('.book-list li').first().elementHandle();
  const start = Date.now(); await page.getByLabel('חיפוש בכל הספרייה').fill('0099'); await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(1); const queryRenderMs = Date.now() - start;
  expect(await retainedRow!.evaluate(row => row.isConnected)).toBe(true);
  await expect(page.locator('.book-list li[hidden]')).toHaveCount(999);
  const reset = Date.now(); await page.getByLabel('חיפוש בכל הספרייה').fill('סינתטי'); await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(1000); const fullRenderMs = Date.now() - reset;
  expect(await retainedRow!.evaluate(row => row.isConnected)).toBe(true);
  await page.getByLabel('חיפוש בכל הספרייה').fill('אין תוצאה סינתטית כזאת');
  await expect(page.getByRole('heading', { name: 'אין ספרים שמתאימים לחיפוש' })).toBeVisible();
  await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(0);
  expect(await retainedRow!.evaluate(row => row.isConnected)).toBe(true);
  await page.getByLabel('חיפוש בכל הספרייה').fill('סינתטי');
  await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(1000);
  expect(await retainedRow!.evaluate(row => row.isConnected)).toBe(true);
  await test.info().attach('1000-book-baseline', { body: JSON.stringify({ ...calculation, queryRenderMs, fullRenderMs, browser: await page.evaluate(() => navigator.userAgent) }, null, 2), contentType: 'application/json' });
});
test('renaming across a series boundary restores focus to the current book row and preserves scroll', async ({ page }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible(); await seed(page);
  const target = page.getByRole('button', { name: /תות.*1 עותקים/ });
  await target.click();
  const before = await page.evaluate(() => scrollY);
  await page.getByLabel('שם הספר', { exact: true }).fill('אבוקדו מעבר סינתטי');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /אבוקדו מעבר סינתטי.*1 עותקים/ })).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  await page.getByLabel('חיפוש בכל הספרייה').fill('שם עט');
  await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(3);
  await expect(page.getByLabel('חיפוש בכל הספרייה')).toBeFocused();
});
