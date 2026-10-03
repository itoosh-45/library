import { test, expect } from '@playwright/test';

test('short welcome supports keyboard, API directions, completion and reopening without changing library data', async ({ page }) => {
  const external: string[] = [], errors: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4330/')) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('');
  const guide = page.getByRole('region', { name: 'היכרות קצרה עם הספרייה' });
  await expect(guide).toBeVisible();
  await guide.getByRole('button', { name: 'הבא', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(guide.getByRole('heading')).toHaveText('הספרייה נשארת אצלך');
  await expect(guide.getByRole('heading')).toBeFocused();
  await expect(guide).toContainText('JSON מלא');
  await guide.getByRole('button', { name: 'הקודם', exact: true }).click();
  await expect(guide.getByRole('heading')).toHaveText('נעים להכיר, הספרייה שלך');
  await guide.getByRole('button', { name: 'הבא', exact: true }).click();
  await guide.getByRole('button', { name: 'הבא', exact: true }).click();
  await expect(guide).toContainText('Free ללא חיוב פעיל');
  await expect(guide).toContainText('המפתח נשמר בדפדפן הזה');
  await expect(guide).toContainText('עדיין אינם פעילים');
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => document.documentElement.style.fontSize = '32px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await guide.screenshot({ path: 'test-results/browser-artifacts/phase21-api-360-200.png' });
  await guide.getByRole('button', { name: 'פתיחת הגדרות הזיהוי', exact: true }).click();
  await expect(guide).toHaveCount(0);
  await expect(page.getByLabel('מפתח Gemini אישי', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'שמירת מפתח Gemini', exact: true })).toBeDisabled();
  await page.reload(); await expect(guide).toHaveCount(0);
  await page.getByRole('button', { name: 'פתיחת ההיכרות הקצרה', exact: true }).click();
  await expect(guide.getByRole('heading')).toBeFocused();
  await guide.getByRole('button', { name: 'הבא', exact: true }).click();
  await guide.getByRole('button', { name: 'הבא', exact: true }).click();
  await guide.getByRole('button', { name: 'מתחילים', exact: true }).click();
  await expect(guide).toHaveCount(0);
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  await expect(page.locator('.book-list li')).toHaveCount(0);
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('skip survives reload and blocked preference storage still allows using the library', async ({ page, context }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'דילוג להמשך', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: 'היכרות קצרה עם הספרייה' })).toHaveCount(0);
  await context.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('synthetic blocked storage', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('synthetic blocked storage', 'SecurityError'); };
  });
  await page.reload();
  await page.getByRole('button', { name: 'דילוג להמשך', exact: true }).click();
  await expect(page.getByRole('region', { name: 'היכרות קצרה עם הספרייה' })).toHaveCount(0);
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'הוספה ידנית', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר בדיקת פתיחה');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ספר בדיקת פתיחה', exact: true })).toBeVisible();
});
