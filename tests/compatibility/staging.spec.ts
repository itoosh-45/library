import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function downloadBackup(page: Page) {
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  return readFile((await (await downloading).path())!);
}

test('T27 frozen production preparation: separate browser libraries, loan history, protected restore and memory-only key', async ({ page, browser }) => {
  const otherContext = await browser.newContext(), other = await otherContext.newPage();
  try {
    await page.goto('./'); await other.goto('http://127.0.0.1:4335/library/');
    await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
    await expect(other.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
    await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
    await page.getByLabel('שם הספר', { exact: true }).fill('ספר קבלה סינתטי');
    await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(other.locator('.book-list li')).toHaveCount(0);
    await page.getByRole('button', { name: /ספר קבלה סינתטי.*1 עותקים/ }).click();
    await page.getByText('השאלת עותק', { exact: true }).click();
    await page.getByRole('combobox', { name: 'עותק להשאלה', exact: true }).selectOption({ index: 1 });
    await page.getByLabel('שם האדם להשאלה', { exact: true }).fill('אדם קבלה סינתטי');
    await page.getByRole('button', { name: 'שמירת ההשאלה', exact: true }).click();
    await expect(page.locator('.book-loans .loan-entry')).toHaveCount(1);
    await page.getByRole('button', { name: 'רישום החזרה', exact: true }).click();
    await expect(page.getByRole('button', { name: 'רישום החזרה', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'שמירת הספר', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const backup = await downloadBackup(page), original = JSON.parse(backup.toString());
    expect(original.manifestCounts).toMatchObject({ books: 1, copies: 1, people: 1, loans: 1 });
    const secret = 'DUMMY_phase19_memory_key_0123456789';
    await page.getByLabel('מפתח Gemini אישי', { exact: true }).fill(secret);
    await page.getByLabel('בדקתי שהפרויקט של המפתח הוא Free, ללא חיוב פעיל', { exact: true }).check();
    await page.getByLabel('אני מסכים לשליחת התמונה המוכנה ל־Google Gemini', { exact: true }).check();
    await page.getByRole('button', { name: 'הגדרת המפתח לזיכרון בלבד', exact: true }).click();
    await other.getByRole('link', { name: 'הגדרות', exact: true }).click();
    await expect(other.getByLabel('מפתח Gemini אישי', { exact: true })).toHaveValue('');
    const empty = JSON.parse((await downloadBackup(other)).toString());
    expect(empty.libraryId).not.toBe(original.libraryId); expect(empty.manifestCounts.books).toBe(0);
    await other.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'synthetic-acceptance.json', mimeType: 'application/json', buffer: backup });
    await expect(other.getByRole('heading', { name: /תצוגה מקדימה/ })).toBeVisible();
    await expect(other.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true })).toHaveCount(0);
    const safety = other.waitForEvent('download');
    await other.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await safety;
    await expect(other.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true })).toBeDisabled();
    await other.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה').check();
    await other.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click();
    await expect(other.getByText('הספרייה שוחזרה בהצלחה.')).toBeVisible();
    const restored = JSON.parse((await downloadBackup(other)).toString());
    expect(restored.tables).toEqual(original.tables); expect(restored.libraryId).toBe(original.libraryId);
    expect((await downloadBackup(page)).toString()).not.toContain(secret);
    await page.reload(); await expect(page.getByLabel('מפתח Gemini אישי', { exact: true })).toHaveValue('');
    const sourceAfter = JSON.parse((await downloadBackup(page)).toString());
    // Producing a backup updates its acknowledgement timestamp; every other setting and table must stay intact.
    expect(sourceAfter.tables.settings.find((row: { key: string }) => row.key === 'lastBackupAt').value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    sourceAfter.tables.settings = sourceAfter.tables.settings.filter((row: { key: string }) => row.key !== 'lastBackupAt');
    expect(sourceAfter.tables).toEqual(original.tables);
  } finally { await otherContext.close(); }
});
