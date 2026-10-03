import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('T28 authorized publication: exact HTTPS snapshot, hash route, protected restore and offline data', async ({ page, context, browser, request }) => {
  const origin = 'https://itoosh-45.github.io/library/';
  const snapshot = JSON.parse(await readFile(process.env.PRODUCTION_MANIFEST ?? 'private/phase19-staging-manifest.json', 'utf8')) as { files: { path: string; sha256: string }[] };
  for (const file of snapshot.files) {
    const response = await request.get(new URL(file.path, origin).href);
    expect(response.status(), file.path).toBe(200);
    expect(createHash('sha256').update(await response.body()).digest('hex'), file.path).toBe(file.sha256.toLowerCase());
  }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin ? route.continue() : route.abort());
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toBe(origin);
  expect(await page.evaluate(async () => (await (await fetch('manifest.webmanifest')).json()) as unknown)).toMatchObject({ id: './', scope: './', start_url: './', lang: 'he', dir: 'rtl' });
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'הוספה ידנית', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר smoke סינתטי');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  const hashUrl = page.url(); expect(hashUrl).toContain('#');
  await page.reload(); expect(page.url()).toBe(hashUrl);
  await expect(page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  const backup = await readFile((await (await downloading).path())!);
  const original = JSON.parse(backup.toString()); expect(original.manifestCounts.books).toBe(1);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage(); await other.goto(origin);
    await expect(other.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
    await expect(other.locator('.book-list li')).toHaveCount(0);
    await other.getByRole('link', { name: 'הגדרות', exact: true }).click();
    await other.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'synthetic-production.json', mimeType: 'application/json', buffer: backup });
    await expect(other.getByRole('heading', { name: /תצוגה מקדימה/ })).toBeVisible();
    const safety = other.waitForEvent('download');
    await other.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await safety;
    await expect(other.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true })).toBeDisabled();
    await other.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה').check();
    await other.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click();
    await expect(other.getByText('הספרייה שוחזרה בהצלחה.')).toBeVisible();
    const restoredDownload = other.waitForEvent('download');
    await other.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
    const restored = JSON.parse((await readFile((await (await restoredDownload).path())!)).toString());
    expect(restored.tables).toEqual(original.tables);
  } finally { await otherContext.close(); }
  await context.setOffline(true); await page.reload();
  await expect(page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true })).toBeVisible();
  const offlineDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click();
  const offline = JSON.parse((await readFile((await (await offlineDownload).path())!)).toString());
  expect(offline.tables.settings.find((row: { key: string }) => row.key === 'lastBackupAt').value).toBe(original.exportedAt);
  offline.tables.settings = offline.tables.settings.filter((row: { key: string }) => row.key !== 'lastBackupAt');
  original.tables.settings = original.tables.settings.filter((row: { key: string }) => row.key !== 'lastBackupAt');
  expect(offline.tables).toEqual(original.tables); expect(errors).toEqual([]);
});
