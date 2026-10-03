import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';

async function openExcel(page: Page) {
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  if (await page.getByRole('button', { name: 'עוד', exact: true }).isVisible()) await page.getByRole('button', { name: 'עוד', exact: true }).click();
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByRole('button', { name: 'פתיחת כלי Excel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'יצוא הספרייה ל־Excel', exact: true })).toBeVisible();
}
async function fingerprint(page: Page) {
  return page.evaluate(async () => {
    const path = '/library/src/data/database.ts', backup = '/library/src/data/backup.ts';
    const { db } = await import(/* @vite-ignore */ path), { createSnapshot } = await import(/* @vite-ignore */ backup);
    return (await createSnapshot(db)).fingerprint;
  });
}
async function safety(page: Page) {
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי JSON מגן לפני ייבוא Excel', exact: true }).click();
  const file = await download; const root = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(root.formatVersion).toBe(8);
  await page.getByLabel('שמרתי את הגיבוי ואני מאשר את ייבוא Excel', { exact: true }).check();
  await page.getByLabel('הבנתי את מגבלת התמונות והטיוטות ובדקתי את הסקירה', { exact: true }).check();
}
test('T22 simple mapping, native atomic merge, repeat import and full export preserve leading zeros at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await openExcel(page); const before = await fingerprint(page);
  await page.getByLabel('בחירת Excel לייבוא').setInputFiles('public/templates/Books-template.xlsx');
  await expect(page.getByRole('heading', { name: /מיפוי עמודות/ })).toBeVisible();
  await page.getByRole('button', { name: 'בדיקת המיפוי ותצוגה מקדימה', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'תצוגה מקדימה של Excel', exact: true })).toBeVisible();
  expect(await fingerprint(page)).toBe(before);
  const commit = page.getByRole('button', { name: 'אישור ושמירת ייבוא Excel', exact: true }); await expect(commit).toBeDisabled();
  await safety(page); await expect(commit).toBeEnabled(); await commit.click();
  await expect(page.getByText('ייבוא Excel הושלם בהצלחה.', { exact: true })).toBeVisible(); const saved = await fingerprint(page);
  await page.reload(); await page.getByRole('button', { name: 'פתיחת כלי Excel', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'יצוא הספרייה ל־Excel', exact: true }).click(); const file = await download;
  const workbook = XLSX.read(await readFile((await file.path())!), { type: 'buffer' });
  expect(workbook.SheetNames).toHaveLength(17); const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Books);
  expect(rows[0]).toMatchObject({ isbn10: '0306406152', danacode: '0000123', personalNotes: '=טקסט לדוגמה, אינו נוסחה' });
  expect(XLSX.utils.sheet_to_json(workbook.Sheets.Copies)).toHaveLength(3);
  await page.getByLabel('בחירת Excel לייבוא').setInputFiles('public/templates/Books-template.xlsx');
  await page.getByRole('button', { name: 'בדיקת המיפוי ותצוגה מקדימה', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'תצוגה מקדימה של Excel', exact: true })).toBeVisible();
  await safety(page); await commit.click(); await expect(page.getByText('ייבוא Excel הושלם בהצלחה.', { exact: true })).toBeVisible();
  expect(await fingerprint(page)).toBe(saved);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('excel-360.png'), fullPage: true });
});
test('T22 full XLSX restore preserves history; concurrent edits and invalid files cannot overwrite the library', async ({ page }) => {
  await openExcel(page); await page.getByLabel('בחירת Excel לייבוא').setInputFiles('public/templates/full-example.xlsx');
  await expect(page.getByRole('heading', { name: 'תצוגה מקדימה של Excel', exact: true })).toBeVisible();
  await page.getByLabel('דרך ייבוא Excel', { exact: true }).selectOption('replace'); await safety(page);
  await page.getByRole('button', { name: 'אישור ושמירת ייבוא Excel', exact: true }).click();
  await expect(page.getByText('ייבוא Excel הושלם בהצלחה.', { exact: true })).toBeVisible();
  const counts = await page.evaluate(async () => { const path = '/library/src/data/database.ts'; const { db } = await import(/* @vite-ignore */ path); return { books: await db.books.count(), loans: await db.loans.count(), links: await db.bookShelves.count() }; });
  expect(counts).toEqual({ books: 1, loans: 2, links: 2 }); const before = await fingerprint(page);
  const workbook = XLSX.read(await readFile('public/templates/Books-template.xlsx'), { type: 'buffer' }); workbook.Sheets.Books.A2 = { t: 'n', f: '1+1', v: 2 };
  await page.getByLabel('בחירת Excel לייבוא').setInputFiles({ name: 'SYNTHETIC-formula.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
  await expect(page.locator('.form-status').filter({ hasText: 'נוסחאות' })).toBeVisible(); expect(await fingerprint(page)).toBe(before);
  await page.getByLabel('בחירת Excel לייבוא').setInputFiles('public/templates/Books-template.xlsx'); await page.getByRole('button', { name: 'בדיקת המיפוי ותצוגה מקדימה', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'תצוגה מקדימה של Excel', exact: true })).toBeVisible();
  await page.getByLabel('אני מאשר לשמור את הספרים והאוספים הדומים בנפרד', { exact: true }).check();
  await page.evaluate(async () => { const path = '/library/src/data/database.ts'; const { db } = await import(/* @vite-ignore */ path); await db.settings.put({ key: 'libraryName', value: 'שינוי במקביל' }); });
  const changed = await fingerprint(page); await safety(page); await page.getByRole('button', { name: 'אישור ושמירת ייבוא Excel', exact: true }).click();
  await expect(page.locator('.form-status').filter({ hasText: 'הספרייה השתנתה' })).toBeVisible(); expect(await fingerprint(page)).toBe(changed);
});
