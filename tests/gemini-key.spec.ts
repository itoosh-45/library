import { test, expect } from '@playwright/test';

test('key setup accepts a long dotted token, makes no provider request and remembers it on reload and deletes it explicitly', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(process.env.KEY_TEST_PUBLIC === '1' ? 'https://itoosh-45.github.io/library/' : '');
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByText('זיהוי ספר מתמונה · Gemini', { exact: true }).click();
  const key = '\u200fSYNTHETIC.auth.token.' + 'x'.repeat(300) + '\u200b';
  await page.getByLabel('מפתח Gemini אישי', { exact: true }).fill(key);
  await expect(page.getByLabel('מפתח Gemini אישי', { exact: true })).toHaveValue(key);
  await page.getByLabel('בדקתי שהפרויקט של המפתח הוא Free, ללא חיוב פעיל', { exact: true }).check();
  await page.getByLabel('אני מסכים לשליחת התמונה המוכנה ל־Google Gemini', { exact: true }).check();
  await page.getByRole('button', { name: 'שמירת מפתח Gemini', exact: true }).click();
  await expect(page.getByText('מפתח אישי מוגדר בדפדפן הזה.', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.reload();
  await page.getByText('זיהוי ספר מתמונה · Gemini', { exact: true }).click();
  await expect(page.getByText('מפתח אישי מוגדר בדפדפן הזה.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'מחיקת המפתח מהמכשיר', exact: true }).click();
  await page.reload();
  await page.getByText('זיהוי ספר מתמונה · Gemini', { exact: true }).click();
  await expect(page.getByLabel('מפתח Gemini אישי', { exact: true })).toHaveValue('');
  expect(requests).toEqual([]);
});
