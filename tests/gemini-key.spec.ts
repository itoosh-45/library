import { test, expect } from '@playwright/test';

test('key setup accepts a long dotted token, makes no provider request and forgets it on reload', async ({ page }) => {
  const requests: string[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto(process.env.KEY_TEST_PUBLIC === '1' ? 'https://itoosh-45.github.io/library/' : '');
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  const key = '\u200fSYNTHETIC.auth.token.' + 'x'.repeat(300) + '\u200b';
  await page.getByLabel('מפתח Gemini אישי', { exact: true }).fill(key);
  await expect(page.getByLabel('מפתח Gemini אישי', { exact: true })).toHaveValue(key);
  await page.getByLabel('בדקתי שהפרויקט של המפתח הוא Free, ללא חיוב פעיל', { exact: true }).check();
  await page.getByLabel('אני מסכים לשליחת התמונה המוכנה ל־Google Gemini', { exact: true }).check();
  await page.getByRole('button', { name: 'הגדרת המפתח לזיכרון בלבד', exact: true }).click();
  await expect(page.getByText('מפתח אישי זמין בזיכרון.', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.reload();
  await expect(page.getByLabel('מפתח Gemini אישי', { exact: true })).toHaveValue('');
  expect(requests).toEqual([]);
});
