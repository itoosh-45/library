import { test, expect } from '@playwright/test';

test('whole images are prepared and sent automatically without crop or format/quality rejection; corrupt files are not sent', async ({ page }) => {
  const calls: { mimeType: string; data: string }[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    calls.push(JSON.parse(route.request().postData()!).contents[0].parts[0].inlineData);
    await route.fulfill({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ items: [] }) }] } }] } });
  });
  await page.goto(process.env.VISION_TEST_PUBLIC === '1' ? 'https://itoosh-45.github.io/library/' : '');
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'הוספה ידנית', exact: true }).click();
  await page.getByRole('button', { name: 'זיהוי ספר מתמונה', exact: true }).click();
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8; return canvas.toDataURL('image/png').split(',')[1]; });
  await page.getByLabel('בחירת תמונת ספר', { exact: true }).setInputFiles({ name: 'tiny-no-text.png', mimeType: 'application/octet-stream', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('img', { name: 'תמונה מוכנה לשליחה לזיהוי', exact: true })).toBeVisible();
  expect(calls).toHaveLength(0); // No key/consent means no automatic upload.
  await page.getByLabel('מפתח Gemini אישי', { exact: true }).fill('DUMMY_photo_test_memory_key_12345678');
  await page.getByLabel('בדקתי שהפרויקט של המפתח הוא Free, ללא חיוב פעיל', { exact: true }).check();
  await page.getByLabel('אני מסכים לשליחת התמונה המוכנה ל־Google Gemini', { exact: true }).check();
  await page.getByRole('button', { name: 'שמירת מפתח Gemini', exact: true }).click();
  for (const image of [
    { name: 'tiny-no-text.png', mimeType: 'application/octet-stream', buffer: Buffer.from(png, 'base64') },
    { name: 'tiny.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') },
  ]) {
    await page.getByLabel('צילום ספר במצלמה', { exact: true }).setInputFiles(image);
    await expect(page.getByText('לא זוהה ספר קריא. נסה צילום קרוב יותר או הוסף ידנית.', { exact: true })).toBeVisible();
  }
  expect(calls).toHaveLength(2);
  for (const call of calls) { expect(call.mimeType).toBe('image/jpeg'); expect(Buffer.from(call.data, 'base64').subarray(0, 2)).toEqual(Buffer.from([255, 216])); }
  await page.getByLabel('בחירת תמונת ספר', { exact: true }).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByText('התמונה לא נפתחה בדפדפן. צלם או המר ל־JPEG ונסה שוב.', { exact: true })).toBeVisible();
  expect(calls).toHaveLength(2);
});
