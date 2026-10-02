import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function seed(page: Page) {
  return page.evaluate(async () => {
    const dbPath = '/library/src/data/database.ts', booksPath = '/library/src/data/books.ts';
    const { db } = await import(/* @vite-ignore */ dbPath), { emptyInput, saveBook, changeCopy } = await import(/* @vite-ignore */ booksPath);
    const book = await saveBook(db, { ...emptyInput, title: 'ספר השאלות סינתטי' });
    const first = (await db.copies.toArray())[0];
    await changeCopy(db, book.id, 1, { id: first.id, label: 'עותק ראשון' }); await changeCopy(db, book.id, 2, { label: 'עותק שני' }); await changeCopy(db, book.id, 3, { label: 'עותק שלישי' });
    return { bookId: book.id, copies: await db.copies.toArray() };
  });
}
async function lend(page: Page, label: string, name: string) {
  await page.getByRole('combobox', { name: 'עותק להשאלה', exact: true }).selectOption({ label });
  await page.getByRole('combobox', { name: 'למי להשאיל', exact: true }).selectOption('');
  await page.getByLabel('שם האדם להשאלה', { exact: true }).fill(name);
  await page.getByLabel('תאריך ההשאלה', { exact: true }).fill('2026-01-01');
  await page.getByLabel('תאריך החזרה צפוי (רשות)', { exact: true }).fill('2026-01-02');
  await page.getByRole('button', { name: 'שמירת ההשאלה', exact: true }).click();
}
test('T14 UI: three copies to two people, live badge/availability, overdue, return, copy/person archives preserve history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible(); await seed(page);
  await page.getByRole('button', { name: /ספר השאלות סינתטי.*3 עותקים/ }).click(); await page.getByText('השאלת עותק', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'עותק להשאלה', exact: true })).toHaveValue('');
  await lend(page, 'עותק ראשון', 'אדם א'); await expect(page.locator('.book-loans .loan-entry')).toHaveCount(1); await expect(page.getByText('מושאל · באיחור', { exact: true })).toBeVisible();
  await lend(page, 'עותק שני', 'אדם ב'); await expect(page.locator('.book-loans .loan-entry')).toHaveCount(2);
  await page.getByRole('combobox', { name: 'למי להשאיל', exact: true }).selectOption({ label: 'אדם א' }); await page.getByRole('button', { name: 'שמירת ההשאלה', exact: true }).click();
  await expect(page.locator('.book-loans .loan-entry')).toHaveCount(3); await page.keyboard.press('Escape');
  await expect(page.locator('.book-list .loan-badge')).toHaveText('מושאל · 3'); await expect(page.locator('.book-list .availability')).toHaveText('0 זמינים');
  await page.getByText('סינון הספרים', { exact: true }).click(); await page.getByRole('combobox', { name: 'זמינות', exact: true }).selectOption('available'); await expect(page.locator('.book-list li')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'זמינות', exact: true }).selectOption('unavailable'); await expect(page.locator('.book-list li')).toHaveCount(1);
  await page.getByRole('button', { name: /ספר השאלות סינתטי.*3 עותקים/ }).click();
  const firstCard = page.locator('.copy-card').filter({ has: page.locator('input[value="עותק ראשון"]') });
  await firstCard.getByRole('button', { name: 'ארכוב העותק', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'העותק מושאל כעת' })).toBeVisible();
  await page.locator('.book-loans .loan-entry').filter({ hasText: 'עותק ראשון' }).getByRole('button', { name: 'רישום החזרה', exact: true }).click(); await expect(page.locator('.book-loans .loan-entry').filter({ hasText: 'מושאל' })).toHaveCount(2);
  await firstCard.getByRole('button', { name: 'ארכוב העותק', exact: true }).click(); await expect(page.getByText('עותק בארכיון', { exact: true })).toBeVisible();
  await page.getByText('היסטוריית השאלות הספר', { exact: true }).click(); await expect(page.locator('.book-loans')).toContainText('הוחזר ב־'); await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'השאלות', exact: true }).click(); await expect(page.locator('.person-group')).toHaveCount(2);
  await page.getByRole('button', { name: 'עריכת אדם אדם א', exact: true }).click(); await page.getByRole('button', { name: 'ארכוב האדם', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'פתוחות' })).toBeVisible(); await page.keyboard.press('Escape');
  await page.locator('.person-group').filter({ has: page.getByRole('heading', { name: 'אדם א', exact: true }) }).getByRole('button', { name: 'רישום החזרה', exact: true }).click();
  await page.getByRole('button', { name: 'עריכת אדם אדם א', exact: true }).click(); await page.getByRole('button', { name: 'ארכוב האדם', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload(); const archived = page.locator('.person-group').filter({ has: page.getByRole('heading', { name: 'אדם א · בארכיון', exact: true }) }); await archived.getByText('היסטוריית השאלות (2)', { exact: true }).click(); await expect(archived.getByText(/הוחזר ב־/)).toHaveCount(2);
  await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'test-results/phase07-360-loans.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: 'test-results/phase07-desktop-loans.png', fullPage: true }); expect(errors).toEqual([]);
});
test('T14 real competing windows lend/return once and update the other window immediately', async ({ page, context }) => {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible(); const seeded = await seed(page);
  const personId = await page.evaluate(async () => { const dbPath = '/library/src/data/database.ts', path = '/library/src/data/loans.ts'; const { db } = await import(/* @vite-ignore */ dbPath), { savePerson } = await import(/* @vite-ignore */ path); return (await savePerson(db, 'אדם מרוץ')).id; });
  const next = await context.newPage(); await next.goto(''); await expect(next.locator('.book-list li')).toHaveCount(1);
  const lendFrom = (target: Page) => target.evaluate(async ({ copyId, personId }) => { const dbPath = '/library/src/data/database.ts', path = '/library/src/data/loans.ts'; const { db } = await import(/* @vite-ignore */ dbPath), { lendCopy, localDay } = await import(/* @vite-ignore */ path); try { return (await lendCopy(db, { copyId, personId, borrowedOn: localDay(), expectedReturnOn: '' })).id; } catch { return null; } }, { copyId: seeded.copies[0].id, personId });
  const outcomes = await Promise.all([lendFrom(page), lendFrom(next)]); expect(outcomes.filter(Boolean)).toHaveLength(1); const loanId = outcomes.find(Boolean)!;
  for (const target of [page, next]) { await expect(target.locator('.book-list .loan-badge')).toHaveText('מושאל · 1'); await expect(target.locator('.availability')).toHaveText('2 זמינים'); }
  const returnFrom = (target: Page) => target.evaluate(async id => { const dbPath = '/library/src/data/database.ts', path = '/library/src/data/loans.ts'; const { db } = await import(/* @vite-ignore */ dbPath), { returnCopy } = await import(/* @vite-ignore */ path); try { await returnCopy(db, id); return true; } catch { return false; } }, loanId);
  expect((await Promise.all([returnFrom(page), returnFrom(next)])).filter(Boolean)).toHaveLength(1);
  for (const target of [page, next]) { await expect(target.locator('.book-list .loan-badge')).toHaveCount(0); await expect(target.locator('.availability')).toHaveText('3 זמינים'); }
});
test('T14 duplicate people UI requires explicit choice, does not merge, and unsaved book disables lending', async ({ page }) => {
  await page.goto(''); await seed(page); await page.getByRole('link', { name: 'השאלות', exact: true }).click();
  for (const separate of [false, true]) {
    await page.getByRole('button', { name: 'הוספת אדם', exact: true }).click(); await page.getByLabel('שם האדם', { exact: true }).fill('שם זהה');
    if (separate) { await page.getByRole('button', { name: 'שמירת האדם', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'קיים אדם בשם הזה' })).toBeVisible(); await page.getByRole('checkbox', { name: 'זהו אדם נוסף, גם אם קיים אדם באותו שם', exact: true }).check(); }
    await page.getByRole('button', { name: 'שמירת האדם', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.locator('.person-group h2')).toHaveText(['שם זהה — אדם 1', 'שם זהה — אדם 2']);
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await page.getByRole('button', { name: /ספר השאלות סינתטי.*3 עותקים/ }).click(); await page.getByText('השאלת עותק', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'למי להשאיל', exact: true }).locator('option')).toHaveText(['אדם חדש', 'שם זהה — אדם 1', 'שם זהה — אדם 2']);
  await page.getByLabel('שם הספר', { exact: true }).fill('שינוי לא שמור'); await expect(page.getByRole('button', { name: 'שמירת ההשאלה', exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'ויתור על השינויים', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ספר השאלות סינתטי', exact: true })).toBeVisible();
});
test('T19 v3 UI backup protects open and returned loans, preview counts, concurrent changes and atomic restore', async ({ page }) => {
  await page.goto(''); const seeded = await seed(page);
  const loanId = await page.evaluate(async copyId => { const dbPath = '/library/src/data/database.ts', path = '/library/src/data/loans.ts'; const { db } = await import(/* @vite-ignore */ dbPath), { lendCopy, localDay } = await import(/* @vite-ignore */ path); return (await lendCopy(db, { copyId, newPersonName: 'אדם גיבוי', borrowedOn: localDay(), expectedReturnOn: '' })).id; }, seeded.copies[0].id);
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click(); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click(); const buffer = await readFile((await (await downloading).path())!); const backup = JSON.parse(buffer.toString()); expect(backup.version).toBe(6); expect(backup.counts).toMatchObject({ people: 1, loans: 1 });
  await test.info().attach('synthetic-loan-backup', { body: buffer, contentType: 'application/json' });
  await page.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'synthetic-v3.json', mimeType: 'application/json', buffer }); await expect(page.getByText(/1 אנשים.*1 השאלות, כולל היסטוריה/)).toBeVisible();
  await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await expect(page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true })).toBeDisabled(); await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה').check();
  await page.evaluate(async id => { const dbPath = '/library/src/data/database.ts', path = '/library/src/data/loans.ts'; const { db } = await import(/* @vite-ignore */ dbPath), { returnCopy } = await import(/* @vite-ignore */ path); await returnCopy(db, id); }, loanId);
  await page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click(); await expect(page.getByText(/הספרייה השתנתה מאז הגיבוי המגן/)).toBeVisible();
  await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה').check(); await page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click(); await expect(page.getByText('הספרייה שוחזרה בהצלחה.')).toBeVisible();
  await page.reload(); await page.getByRole('link', { name: 'השאלות', exact: true }).click(); await expect(page.getByRole('button', { name: 'רישום החזרה', exact: true })).toBeVisible();
});
