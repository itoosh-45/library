import { test, expect } from '@playwright/test';

test('T23 renamed repository base has correct manifest/assets/worker, shares origin data and preserves both offline shells', async ({ page, context }) => {
  await page.goto('http://127.0.0.1:4337/library/');
  await expect(page.getByRole('heading', { name: 'כל הספרים' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר משותף לשינוי נתיב');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const renamed = await context.newPage(); await renamed.goto('./');
  await expect(renamed.getByRole('heading', { name: 'ספר משותף לשינוי נתיב', exact: true })).toBeVisible();
  await expect.poll(() => renamed.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const shell = await renamed.evaluate(async () => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!;
    const manifest = await (await fetch(link.href)).json();
    const names = await caches.keys();
    const cache = await caches.open(names.find(name => name.startsWith('itoosh-library-path-shell-'))!);
    return { manifest: { start: new URL(manifest.start_url, link.href).pathname, scope: new URL(manifest.scope, link.href).pathname, icons: manifest.icons.map((icon: { src: string }) => new URL(icon.src, link.href).pathname) }, scope: (await navigator.serviceWorker.ready).scope, names, urls: (await cache.keys()).map(request => new URL(request.url).pathname) };
  });
  expect(shell.scope).toBe('http://127.0.0.1:4337/renamed/');
  expect(shell.manifest.start).toBe('/renamed/'); expect(shell.manifest.scope).toBe('/renamed/');
  expect(shell.manifest.icons.every((path: string) => path.startsWith('/renamed/icons/'))).toBe(true);
  expect(shell.urls.every(path => path.startsWith('/renamed/'))).toBe(true);
  expect(shell.urls.some(path => path.includes('ExcelPanel-'))).toBe(true);
  expect(shell.names.some(name => name.startsWith('itoosh-library-shell-'))).toBe(true);
  await context.setOffline(true); await renamed.reload(); await page.reload();
  await expect(renamed.getByRole('heading', { name: 'ספר משותף לשינוי נתיב', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ספר משותף לשינוי נתיב', exact: true })).toBeVisible();
});
