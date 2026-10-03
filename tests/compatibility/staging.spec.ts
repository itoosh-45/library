import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function restoreProtected(page: Page, backup: Buffer) {
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  await page.getByLabel('בחירת גיבוי לשחזור').setInputFiles({ name: 'synthetic-staging.json', mimeType: 'application/json', buffer: backup });
  await expect(page.getByRole('heading', { name: /תצוגה מקדימה/ })).toBeVisible();
  const safety = page.waitForEvent('download');
  await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await safety;
  await expect(page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true })).toBeDisabled();
  await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה').check();
  await page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click();
  await expect(page.getByText('הספרייה שוחזרה בהצלחה.')).toBeVisible();
}

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

test('T27 one frozen production journey: manual, barcode, vision, multi-photo approval, tagging, loan, protected restore and offline', async ({ page, browser, context }) => {
  test.setTimeout(90000);
  const secret = 'DUMMY_phase19_journey_key_0123456789', errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes(secret)) errors.push('key in console'); });
  let visionCalls = 0, catalogCalls = 0;
  await page.route('https://**/*', route => route.abort());
  await page.route('https://openlibrary.org/**', async route => {
    catalogCalls++; const search = new URL(route.request().url()).pathname === '/search.json';
    await route.fulfill({ json: search ? { docs: [{ key: '/works/OL99W', editions: { docs: [{ key: '/books/OL99M', title: 'ספר ברקוד לקבלה' }] } }] } : { title: 'ספר ברקוד לקבלה', isbn_13: ['9780140328721'] } });
  });
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    visionCalls++; expect(route.request().headers()['x-goog-api-key']).toBe(secret);
    expect(route.request().url()).not.toContain(secret); expect(route.request().postData()).not.toContain(secret);
    const title = visionCalls === 1 ? 'ספר תמונה לקבלה' : 'ספר מדף לקבלה ' + (visionCalls - 1);
    const item = { title, authors: [], isbn: null, danacode: null, publisher: null, visibleText: title, evidenceByField: { title: [title], authors: [], isbn: [], danacode: [], publisher: [] }, imageIndex: 0, bbox: [0,0,1,1], uncertaintyReasons: [] };
    await route.fulfill({ json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ items: [item] }) }] } }] } });
  });
  await page.addInitScript(() => Object.defineProperty(globalThis, 'BarcodeDetector', { configurable: true, value: undefined }));
  await page.goto('./');
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר ידני לקבלה');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByRole('button', { name: 'סריקת ברקוד או הקלדת מזהה', exact: true }).click();
  const bars = '101' + ['0111011','0001001','0100111','0011001','0011101','0001101'].join('') + '01010' + ['1000010','1101100','1001000','1000100','1101100','1100110'].join('') + '101';
  const barcode = await page.evaluate(bars => { const canvas = document.createElement('canvas'); canvas.width = bars.length * 4 + 80; canvas.height = 200; const drawing = canvas.getContext('2d')!; drawing.fillStyle = 'white'; drawing.fillRect(0,0,canvas.width,canvas.height); drawing.fillStyle = 'black'; [...bars].forEach((value,index) => { if (value === '1') drawing.fillRect(40+index*4,20,4,160); }); return canvas.toDataURL('image/png').split(',')[1]; }, bars);
  await page.getByLabel('תמונת ברקוד', { exact: true }).setInputFiles({ name: 'synthetic-ean.png', mimeType: 'image/png', buffer: Buffer.from(barcode, 'base64') });
  await expect(page.getByLabel('מזהה שנקרא או הוקלד')).toHaveValue('9780140328721');
  await page.getByRole('button', { name: 'שימוש במזהה ובדיקת הספר', exact: true }).click();
  await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
  await page.getByRole('button', { name: 'בחירת מועמד ספר ברקוד לקבלה' }).click();
  await expect(page.locator('.catalog-choice').filter({ hasText: 'שם הספר:' }).getByRole('checkbox')).toBeVisible();
  for (const checkbox of await page.locator('.catalog-choice').getByRole('checkbox').all()) await checkbox.check();
  await expect(page.getByRole('button', { name: 'החלת השדות שנבחרו', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'החלת השדות שנבחרו', exact: true }).click();
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  const image = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 600; canvas.getContext('2d')!.fillRect(0,0,900,600); return canvas.toDataURL('image/png').split(',')[1]; });
  const file = { name: 'synthetic-picture.png', mimeType: 'image/png', buffer: Buffer.from(image,'base64') };
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'זיהוי ספר מתמונה', exact: true }).click();
  await page.getByLabel('בחירת תמונת ספר', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: 'הכנת התמונה לזיהוי', exact: true }).click();
  await expect(page.getByRole('img', { name: 'תמונה מוכנה לשליחה לזיהוי', exact: true })).toBeVisible();
  await page.getByLabel('מפתח Gemini אישי', { exact: true }).fill(secret);
  await page.getByLabel('בדקתי שהפרויקט של המפתח הוא Free, ללא חיוב פעיל', { exact: true }).check();
  await page.getByLabel('אני מסכים לשליחת התמונה המוכנה ל־Google Gemini', { exact: true }).check();
  await page.getByRole('button', { name: 'הגדרת המפתח לזיכרון בלבד', exact: true }).click();
  await page.getByRole('button', { name: 'שליחת התמונה לזיהוי', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'בחירת שדות מהתמונה', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'החלת השדות מהתמונה על הטיוטה' })).toBeDisabled();
  await page.locator('.catalog-choice').getByRole('checkbox').check(); await page.getByRole('button', { name: 'החלת השדות מהתמונה על הטיוטה' }).click();
  await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('ספר תמונה לקבלה');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'צילום מדף בכמה תמונות', exact: true }).click();
  await page.getByRole('button', { name: 'פתיחת טיוטת מדף חדשה', exact: true }).click();
  await page.getByLabel('שמירת תמונה מוכנה במכשיר לצורך התהליך והגיבוי', { exact: true }).check();
  await page.getByLabel('הוספת תמונות מדף', { exact: true }).setInputFiles([file, { ...file, name: 'synthetic-picture-2.png' }]);
  await expect(page.getByText('התמונות נוספו לתור. שליחה מתחילה רק בלחיצה מפורשת.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'התחלת או חידוש התור', exact: true }).click();
  await expect(page.getByText('2 תמונות · 2 פריטים בטיוטה', { exact: true })).toBeVisible();
  for (const index of [1,2]) {
    await page.getByText(new RegExp('^סקירת פריט ' + index + ' ·')).click();
    await page.getByRole('checkbox', { name: 'שם מהתמונה לפריט ' + index + ': ספר מדף לקבלה ' + index, exact: true }).check();
    await page.getByRole('combobox', { name: 'מה לשמור לפריט ' + index, exact: true }).selectOption('new');
    await page.getByRole('button', { name: 'עדכון טיוטת פריט ' + index, exact: true }).click();
    await expect(page.getByRole('button', { name: 'אישור פריט ' + index, exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'אישור פריט ' + index, exact: true }).click();
    await expect(page.locator('details').filter({ has: page.getByRole('button', { name: 'עדכון טיוטת פריט ' + index, exact: true }) }).getByText('הפריט אושר. הוא יתווסף רק בשמירת המאושרים.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'אישור פריט ' + index, exact: true })).toBeDisabled();
  }
  await page.getByRole('button', { name: 'סיכום לפני שמירת מאושרים', exact: true }).click();
  await expect(page.getByText('2 ספרים חדשים · 0 עותקים נוספים · 0 פריטים לא יישמרו בפעולה זו', { exact: true })).toBeVisible();
  await page.getByLabel('בדקתי את הסיכום ואני מאשר שמירה לספרייה', { exact: true }).check(); await page.getByRole('button', { name: 'שמור מאושרים', exact: true }).click();
  await expect(page.getByText('2 פריטים מאושרים נשמרו בספרייה.', { exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /ספר ידני לקבלה.*1 עותקים/ }).click(); await page.getByText('מדפים, תגיות וסדרה', { exact: true }).click();
  await page.getByLabel('תגית חדשה', { exact: true }).fill('תגית קבלה'); await page.getByRole('button', { name: 'יצירת תגית', exact: true }).click();
  await page.getByRole('combobox', { name: 'ז׳אנרים מוכנים', exact: true }).selectOption('עיון');
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await expect(page.locator('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /ספר ידני לקבלה.*1 עותקים/ }).click(); await page.getByText('השאלת עותק', { exact: true }).click();
  await page.getByRole('combobox', { name: 'עותק להשאלה', exact: true }).selectOption({ index: 1 }); await page.getByLabel('שם האדם להשאלה', { exact: true }).fill('אדם קבלה מלאה');
  await page.getByRole('button', { name: 'שמירת ההשאלה', exact: true }).click(); await expect(page.locator('.book-loans .loan-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'רישום החזרה', exact: true }).click(); await expect(page.getByRole('button', { name: 'רישום החזרה', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'שמירת הספר', exact: true })).toBeEnabled(); await page.keyboard.press('Escape'); await expect(page.locator('dialog')).toHaveCount(0);
  const backup = await downloadBackup(page), original = JSON.parse(backup.toString());
  expect(original.manifestCounts).toMatchObject({ books: 5, copies: 5, tags: 1, people: 1, loans: 1, recognitionDrafts: 1, images: 2, metadataSources: 4 });
  expect(backup.toString()).not.toContain(secret); expect(visionCalls).toBe(3); expect(catalogCalls).toBe(2);
  const otherContext = await browser.newContext(), other = await otherContext.newPage();
  try {
    await other.goto('http://127.0.0.1:4335/library/'); await expect(other.getByRole('heading', { name: /כל הספרים/ })).toBeVisible();
    await restoreProtected(other, backup); const restored = JSON.parse((await downloadBackup(other)).toString()); expect(restored.tables).toEqual(original.tables);
  } finally { await otherContext.close(); }
  await page.reload(); await expect(page.getByLabel('מפתח Gemini אישי', { exact: true })).toHaveValue('');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await page.goto('./#books'); await expect(page.locator('.book-list li')).toHaveCount(5);
  const offlineBackup = JSON.parse((await downloadBackup(page)).toString());
  for (const name of ['books','copies','people','loans','images','recognitionDrafts','metadataSources']) expect(offlineBackup.tables[name]).toEqual(original.tables[name]);
  await context.setOffline(false); expect(errors).toEqual([]);
});
