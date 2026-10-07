import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('simple production UI backs up/restores all tables and keeps books offline', async ({ page, context, browser }) => {
  await page.goto('./'); await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר אופליין סינתטי');
  await page.getByLabel('שם פרטי של המחבר', { exact: true }).fill('מחבר');
  await page.getByLabel('שם משפחה של המחבר', { exact: true }).fill('בדיקה');
  await page.getByLabel('תאריך פרסום', { exact: true }).fill('2024-02-29');
  await page.getByLabel('סוג כריכה', { exact: true }).fill('כריכה קשה');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click(); await page.getByText('גיבוי ושחזור הספרייה', { exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  const bytes = await readFile((await (await downloading).path())!); const original = JSON.parse(bytes.toString());
  expect(original.formatVersion).toBe(11);
  expect(original.tables.books[0]).toMatchObject({ publicationDate: '2024-02-29', publicationYear: 2024, binding: 'כריכה קשה' });
  expect(original.tables.authors[0]).toMatchObject({ givenName: 'מחבר', familyName: 'בדיקה' });
  const other = await browser.newContext();
  try {
    const peer = await other.newPage(); await peer.goto('./#settings'); await peer.getByText('גיבוי ושחזור הספרייה', { exact: true }).click();
    await peer.getByLabel('בחירת גיבוי לשחזור', { exact: true }).setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: bytes });
    await expect(peer.getByRole('heading', { name: /תצוגה מקדימה:/ })).toBeVisible();
    const protect = peer.waitForEvent('download'); await peer.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await protect;
    await peer.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה', { exact: true }).check();
    await peer.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click(); await expect(peer.getByText('הספרייה שוחזרה בהצלחה.', { exact: true })).toBeVisible();
    const exported = peer.waitForEvent('download'); await peer.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
    const restored = JSON.parse((await readFile((await (await exported).path())!)).toString());
    for (const key of Object.keys(original.tables).filter(key => key !== 'settings')) expect(restored.tables[key], key).toEqual(original.tables[key]);
  } finally { await other.close(); }
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await context.setOffline(true); await page.reload();
  await expect(page.getByRole('heading', { name: 'ספר אופליין סינתטי', exact: true })).toBeVisible();
});

test('waiting worker update protects unsaved settings, restores explicitly and keeps the library', async ({ page, context, request }) => {
  await page.goto('./'); await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByLabel('שם הספר', { exact: true }).fill('ספר לפני עדכון');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click(); await page.getByText('עדכון ואופליין', { exact: true }).click();
  await page.getByLabel('שם הספרייה', { exact: true }).fill('שם לא שמור'); await request.post('http://127.0.0.1:4334/__test/build');
  await page.getByRole('button', { name: 'בדיקת עדכון', exact: true }).click(); await expect(page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true }).click(); await expect(page.getByText('סיים או סגור עריכה ושחזור לפני העדכון.')).toBeVisible();
  await expect(page.getByLabel('שם הספרייה', { exact: true })).toHaveValue('שם לא שמור'); await page.getByRole('button', { name: 'שמירת השם', exact: true }).click(); await expect(page.getByText('שם הספרייה נשמר.', { exact: true })).toBeVisible();
  const peer = await context.newPage(); await peer.goto('./'); await expect.poll(() => peer.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true }).click(); await expect(page.getByText('סגור חלונות נוספים של הספרייה ונסה שוב.')).toBeVisible(); await peer.close();
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByLabel('שם הספר', { exact: true }).fill('טיוטה לא שמורה');
  await page.evaluate(() => { location.hash = 'settings'; });
  await page.evaluate(() => { const details = [...document.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent === 'עדכון ואופליין'); if (details) details.open = true; [...document.querySelectorAll('button')].find(button => button.textContent === 'עדכון ופתיחה מחדש')?.click(); });
  await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('טיוטה לא שמורה');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'ויתור על השינויים', exact: true }).click();
  await page.getByRole('button', { name: 'עדכון ופתיחה מחדש', exact: true }).click();
  await expect(page.getByLabel('שם הספרייה', { exact: true })).toHaveValue('שם לא שמור');
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await expect(page.getByRole('heading', { name: 'ספר לפני עדכון', exact: true })).toBeVisible();
});
