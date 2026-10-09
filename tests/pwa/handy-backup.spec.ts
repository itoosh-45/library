import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { zipSync, strToU8, unzipSync } from 'fflate';
import schema from '../../src/data/handySchema.json' with { type: 'json' };

async function archive(jpeg: Uint8Array) {
  const SQL = await initSqlJs(), sqlite = new SQL.Database();
  for (const statement of Object.values(schema.tables)) sqlite.run(statement);
  sqlite.run(`PRAGMA user_version=${schema.userVersion}`);
  sqlite.run("INSERT INTO android_metadata VALUES('he_IL')"); sqlite.run('INSERT INTO room_master_table VALUES(42,?)', [schema.identityHash]);
  sqlite.run('INSERT INTO book_library(_id,Title,Author,Location,ISBN,Icon_Path,Photo_Path,Rating) VALUES(1,?,?,?,?,?,?,?)', ['ספר ZIP סינתטי', 'מחבר סינתטי', 'מדף ZIP', '9780140328721', '/Pictures/Icons/כריכה.jpg', '/Pictures/Photos/כריכה.jpg', '4.27']);
  const cells = schema.csvHeaders.map(key => ({ Title: 'ספר ZIP סינתטי', Author: 'מחבר סינתטי', BookShelf: 'מדף ZIP', ISBN: '9780140328721', 'Icon Path': '/Pictures/Icons/כריכה.jpg', 'Photo Path': '/Pictures/Photos/כריכה.jpg', Rating: '4.27' })[key as 'Title'] ?? '');
  const quote = (cells: string[]) => cells.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(',');
  const files = { 'handy_book_library.db': sqlite.export(), 'HandyLib.csv': strToU8(quote(schema.csvHeaders) + '\r\n' + quote(cells) + '\r\n'), 'Icons/כריכה.jpg': jpeg, 'Photos/כריכה.jpg': jpeg };
  sqlite.close(); return Buffer.from(zipSync(files));
}
async function protectAndImport(page: Page, replace = false) {
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await download;
  await page.getByLabel(replace ? 'וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה' : 'וידאתי שהגיבוי ירד למחשב ואני מאשר מיזוג', { exact: true }).check();
  await page.getByRole('button', { name: replace ? 'החלפת הספרייה ושחזור' : 'מיזוג הגיבוי לאחר הסקירה', exact: true }).click();
}

test('production Handy ZIP import/export works offline under CSP, with repeat deduplication, replacement and Hebrew cover', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const jpeg = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 30; canvas.height = 40; canvas.getContext('2d')!.fillRect(0, 0, 30, 40); return canvas.toDataURL('image/jpeg').split(',')[1]; }), 'base64');
  const fixture = await archive(jpeg);
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByLabel('שם הספר', { exact: true }).fill('ספר קיים'); await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await context.setOffline(true); await page.reload();
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click(); await page.getByText('גיבוי ושחזור הספרייה', { exact: true }).click();
  const upload = { name: 'handy.zip', mimeType: 'application/zip', buffer: fixture };
  await page.getByLabel('בחירת גיבוי לשחזור', { exact: true }).setInputFiles(upload);
  await expect(page.getByRole('combobox', { name: 'אופן הייבוא', exact: true })).toHaveValue('merge');
  await expect(page.getByText('1 ספרים יתווספו · 0 כפילויות ידולגו. הנתונים הקיימים נשמרים.', { exact: true })).toBeVisible();
  await protectAndImport(page); await expect(page.getByText('ייבוא Handy Library הושלם: 1 ספרים נוספו, 0 כפילויות דולגו.', { exact: true })).toBeVisible();
  await page.getByLabel('בחירת גיבוי לשחזור', { exact: true }).setInputFiles(upload);
  await expect(page.getByText('0 ספרים יתווספו · 1 כפילויות ידולגו. הנתונים הקיימים נשמרים.', { exact: true })).toBeVisible();
  await protectAndImport(page); await expect(page.getByText('ייבוא Handy Library הושלם: 0 ספרים נוספו, 1 כפילויות דולגו.', { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי Handy Library · ZIP', exact: true }).click();
  const download = await downloading; expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const bytes = await readFile((await download.path())!), files = unzipSync(bytes);
  expect(Object.keys(files)).toHaveLength(4); expect(files).not.toHaveProperty('manifest.json');
  await page.getByLabel('בחירת גיבוי לשחזור', { exact: true }).setInputFiles(upload); await page.getByRole('combobox', { name: 'אופן הייבוא', exact: true }).selectOption('replace');
  await protectAndImport(page, true); await expect(page.getByText('ייבוא Handy Library הושלם: 1 ספרים נוספו, 0 כפילויות דולגו.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await expect(page.locator('.book-list li')).toHaveCount(1); await expect(page.locator('.book-jacket img')).toBeVisible();
  await page.reload(); await expect(page.locator('.book-list li')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
