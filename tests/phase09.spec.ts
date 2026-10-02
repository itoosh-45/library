import { test, expect, type Page } from '@playwright/test';
// Standard EAN-13 modules for the synthetic 9780140328721 fixture, including guards.
const syntheticBars = '101' + ['0111011', '0001001', '0100111', '0011001', '0011101', '0001101'].join('') + '01010' + ['1000010', '1101100', '1001000', '1000100', '1101100', '1100110'].join('') + '101';

async function openScanner(page: Page) {
  await page.goto(''); await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'סריקת ברקוד או הקלדת מזהה', exact: true }).click(); await expect(page.getByRole('heading', { name: 'סריקת ברקוד', exact: true })).toBeVisible();
}
test('T05/T16 identifier correction, danacode zeros and candidate choice never auto-save', async ({ page }) => {
  let requests = 0;
  await page.route('https://openlibrary.org/**', async route => { requests++; const path = new URL(route.request().url()).pathname; await route.fulfill({ json: path === '/search.json' ? { docs: [{ key: '/works/OL99W', editions: { docs: [{ key: '/books/OL99M', title: 'ספר סריקה סינתטי' }] } }] } : { title: 'ספר סריקה סינתטי', isbn_13: ['9780140328721'] } }); });
  await openScanner(page); await page.getByLabel('מזהה שנקרא או הוקלד').fill('4006381333931'); await page.getByRole('button', { name: 'שימוש במזהה ובדיקת הספר' }).click(); await expect(page.getByRole('heading', { name: 'סריקת ברקוד', exact: true })).toBeVisible(); expect(requests).toBe(0);
  await page.getByLabel('סוג המזהה').selectOption('danacode'); await page.getByLabel('מזהה שנקרא או הוקלד').fill('002001'); await page.getByRole('button', { name: 'שימוש במזהה ובדיקת הספר' }).click(); await expect(page.getByLabel('דאנאקוד לחיפוש', { exact: true })).toHaveValue('002001');
  await page.getByRole('button', { name: 'סריקת ברקוד או הקלדת מזהה' }).click(); await page.getByLabel('מזהה שנקרא או הוקלד').fill('9780140328721'); await page.getByRole('button', { name: 'שימוש במזהה ובדיקת הספר' }).click(); await expect(page.getByLabel('ISBN לחיפוש', { exact: true })).toHaveValue('9780140328721');
  await page.getByLabel('דאנאקוד לחיפוש', { exact: true }).fill(''); await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click(); await page.getByRole('button', { name: 'בחירת מועמד ספר סריקה סינתטי' }).click(); await page.locator('.catalog-choice').filter({ hasText: 'שם הספר:' }).getByRole('checkbox').check(); await page.getByRole('button', { name: 'החלת השדות שנבחרו' }).click();
  const count = await page.evaluate(async () => { const path = '/library/src/data/database.ts'; return (await import(/* @vite-ignore */ path)).db.books.count(); }); expect(count).toBe(0);
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await page.reload(); await expect(page.getByRole('button', { name: /ספר סריקה סינתטי.*1 עותקים/ })).toBeVisible();
});
for (const mode of ['missing', 'runtime-failure'] as const) test(`T16 local ZXing decodes synthetic EAN-13 in both orientations with native ${mode}`, async ({ page }) => {
  await page.addInitScript(mode => { Object.defineProperty(globalThis, 'BarcodeDetector', { value: mode === 'missing' ? undefined : class { static getSupportedFormats() { return Promise.resolve(['ean_13']); } async detect() { throw new Error('synthetic native failure'); } }, configurable: true }); }, mode);
  const external: string[] = [], errors: string[] = []; page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4330') && !request.url().startsWith('blob:')) external.push(request.url()); }); page.on('pageerror', error => errors.push(error.message));
  await openScanner(page);
  const bars = [...syntheticBars].map(bit => bit === '1');
  const data = await page.evaluate(bars => { const canvas = document.createElement('canvas'); canvas.width = bars.length * 4 + 80; canvas.height = 200; const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = 'black'; bars.forEach((bar, i) => { if (bar) ctx.fillRect(40 + i * 4, 20, 4, 160); }); return canvas.toDataURL('image/png').split(',')[1]; }, bars);
  await page.getByLabel('תמונת ברקוד', { exact: true }).setInputFiles({ name: 'synthetic-ean.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }); await expect(page.getByLabel('מזהה שנקרא או הוקלד')).toHaveValue('9780140328721'); await expect(page.getByText('ISBN נקרא. בדוק את הספרות ובחר המשך; הספר עדיין לא נשמר.', { exact: true })).toBeVisible();
  await page.getByLabel('מזהה שנקרא או הוקלד').fill('');
  const rotated = await page.evaluate(async data => { const source = new Image(); source.src = 'data:image/png;base64,' + data; await source.decode(); const canvas = document.createElement('canvas'); canvas.width = source.height; canvas.height = source.width; const context = canvas.getContext('2d')!; context.translate(canvas.width, 0); context.rotate(Math.PI / 2); context.drawImage(source, 0, 0); return canvas.toDataURL('image/png').split(',')[1]; }, data);
  await page.getByLabel('תמונת ברקוד', { exact: true }).setInputFiles({ name: 'synthetic-rotated-ean.png', mimeType: 'image/png', buffer: Buffer.from(rotated, 'base64') }); await expect(page.getByLabel('מזהה שנקרא או הוקלד')).toHaveValue('9780140328721');
  await page.setViewportSize({ width: 360, height: 800 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'test-results/phase09-scanner-360.png', fullPage: true });
  await page.keyboard.press('Escape'); await expect(page.getByRole('heading', { name: 'סריקת ברקוד', exact: true })).toHaveCount(0); await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue(''); expect(external).toEqual([]); expect(errors).toEqual([]);
});
test('T16 closing scanner before camera permission resolves stops the late stream and preserves editor', async ({ page }) => {
  await page.addInitScript(() => {
    const state = globalThis as unknown as { finishCamera?: () => void; stopped: number }; state.stopped = 0;
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(resolve => { state.finishCamera = () => resolve({ getTracks: () => [{ stop: () => { state.stopped++; } }] }); }) } });
  });
  await openScanner(page); await page.getByRole('button', { name: 'פתיחת מצלמה אחורית' }).click(); await page.keyboard.press('Escape'); await expect(page.getByLabel('שם הספר', { exact: true })).toBeVisible();
  await page.evaluate(() => (globalThis as unknown as { finishCamera: () => void }).finishCamera()); await expect.poll(() => page.evaluate(() => (globalThis as unknown as { stopped: number }).stopped)).toBe(1); await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('');
});
test('T16 permission denied leaves manual input available and camera has no unsupported torch', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => { throw new DOMException('test-denied', 'NotAllowedError'); } }, configurable: true }); });
  await openScanner(page); await page.getByRole('button', { name: 'פתיחת מצלמה אחורית' }).click(); await expect(page.getByText('לא ניתנה הרשאה למצלמה. אפשר לבחור תמונה או להקליד.', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'הפעלת פנס', exact: true })).toHaveCount(0); await page.getByLabel('מזהה שנקרא או הוקלד').fill('9780140328721'); await page.getByRole('button', { name: 'שימוש במזהה ובדיקת הספר' }).click(); await expect(page.getByLabel('ISBN לחיפוש', { exact: true })).toHaveValue('9780140328721');
});
