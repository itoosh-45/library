import { test, expect, type Page } from '@playwright/test';

test('reference navigation and split author details survive reload on a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('');
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('link')).toHaveText(['מדפים', 'כל הספרים', 'השאלות', 'תגיות']);
  await expect(page.getByRole('link', { name: 'כל הספרים', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר לבדיקת פרטים');
  await page.getByLabel('שם פרטי של המחבר', { exact: true }).fill('שם פרטי');
  await page.getByLabel('שם משפחה של המחבר', { exact: true }).fill('משפחה כפולה');
  await page.getByLabel('תאריך פרסום', { exact: true }).fill('2024-02-29');
  await page.getByLabel('סוג כריכה', { exact: true }).fill('כריכה קשה');
  await expect(page.getByLabel('הערות אישיות', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/reference-book-form.png', fullPage: true });
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: /ספר לבדיקת פרטים שם פרטי משפחה כפולה/ }).click();
  await expect(page.getByLabel('שם פרטי של המחבר', { exact: true })).toHaveValue('שם פרטי');
  await expect(page.getByLabel('שם משפחה של המחבר', { exact: true })).toHaveValue('משפחה כפולה');
  await expect(page.getByLabel('תאריך פרסום', { exact: true })).toHaveValue('2024-02-29');
  await expect(page.getByLabel('סוג כריכה', { exact: true })).toHaveValue('כריכה קשה');
  expect(await page.evaluate(() => document.querySelector('dialog')!.scrollWidth <= document.querySelector('dialog')!.clientWidth)).toBe(true);
});

test('tag page creates collections and opens the books assigned to them', async ({ page }) => {
  await page.goto('');
  await page.getByRole('link', { name: 'תגיות', exact: true }).click();
  await page.getByText('ניהול תגיות', { exact: true }).click();
  await page.getByRole('button', { name: 'הוספת תגית', exact: true }).click();
  await page.getByLabel('שם האוסף', { exact: true }).fill('תגית בדיקה');
  await page.getByRole('button', { name: 'שמירת האוסף', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByLabel('שם הספר', { exact: true }).fill('ספר מתויג');
  await page.locator('summary').filter({ hasText: /^תגיות$/ }).click();
  await page.getByLabel('תגית בדיקה', { exact: true }).check();
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'תגיות', exact: true }).click();
  await page.getByRole('button', { name: 'תגית בדיקה 1 ספרים', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ספר מתויג', exact: true })).toBeVisible();
});

test.use({ viewport: { width: 390, height: 844 } });

async function barcodeImage(page: Page, code: string, rotate = false) {
  return page.evaluate(({ code, rotate }) => {
    const left = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
    const parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'][+code[0]];
    const invert = (bits: string) => [...bits].map(bit => bit === '1' ? '0' : '1').join('');
    let bits = '101';
    for (let i = 1; i < 7; i++) bits += parity[i-1] === 'L' ? left[+code[i]] : invert(left[+code[i]]).split('').reverse().join('');
    bits += '01010'; for (let i = 7; i < 13; i++) bits += invert(left[+code[i]]); bits += '101';
    const c = document.createElement('canvas'); c.width = rotate ? 600 : 1500; c.height = rotate ? 1500 : 600;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
    if (rotate) { ctx.translate(c.width,0); ctx.rotate(Math.PI/2); }
    ctx.fillStyle = '#000'; [...bits].forEach((bit,i) => { if (bit === '1') ctx.fillRect(250+i*10,150,10,300); });
    return c.toDataURL('image/png').split(',')[1];
  }, { code, rotate });
}

test('uploaded rotated barcode uses ZXing after native detector finds nothing and stays open for review', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: class {
      static async getSupportedFormats() { return ['ean_13']; }
      async detect() { return []; }
    } });
  });
  await page.goto(''); const png = await barcodeImage(page, '9780140328721', true);
  await page.getByRole('button',{name:'הוספת ספר',exact:true}).click(); await page.getByRole('button',{name:'סריקת ברקוד',exact:true}).click();
  await expect(page.getByLabel('סוג המזהה',{exact:true})).toHaveValue('danacode');
  await page.getByLabel('תמונת ברקוד',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.getByLabel('מזהה שנקרא או הוקלד',{exact:true})).toHaveValue('9780140328721');
  await expect(page.getByLabel('סוג המזהה',{exact:true})).toHaveValue('isbn');
  await expect(page.getByRole('button',{name:'חיפוש לפי המזהה',exact:true})).toBeEnabled();
  await expect(page.getByRole('dialog',{name:'סריקת ברקוד',exact:true})).toBeVisible();
  await page.screenshot({ path: 'test-results/barcode-review-mobile.png', fullPage: true });
});

test('non-ISBN barcode retains its raw digits as danacode; unreadable upload stays open and can retry', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window,'BarcodeDetector',{value:undefined,configurable:true}); });
  await page.goto(''); const png = await barcodeImage(page,'4006381333931');
  const blank = await page.evaluate(() => { const c=document.createElement('canvas');c.width=300;c.height=300;const ctx=c.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,300,300);return c.toDataURL('image/png').split(',')[1]; });
  await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();await page.getByRole('button',{name:'סריקת ברקוד',exact:true}).click();
  await page.getByLabel('תמונת ברקוד',{exact:true}).setInputFiles({name:'blank.png',mimeType:'image/png',buffer:Buffer.from(blank,'base64')});
  await expect(page.getByRole('status').filter({hasText:'לא נקרא ברקוד'})).toBeVisible();
  await expect(page.getByLabel('תמונת ברקוד',{exact:true})).toBeEnabled();
  await page.getByLabel('תמונת ברקוד',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.getByLabel('מזהה שנקרא או הוקלד',{exact:true})).toHaveValue('4006381333931');
  await expect(page.getByLabel('סוג המזהה',{exact:true})).toHaveValue('danacode');
  await page.getByRole('button',{name:'חיפוש לפי המזהה',exact:true}).click();
  await expect(page.getByLabel('שם ספר, דאנאקוד או ISBN',{exact:true})).toHaveValue('4006381333931');
  await expect(page.getByRole('link',{name:'פתיחת חיפוש ידני בספרייה הלאומית',exact:true})).toBeVisible();
});

test('series and numbers persist, order numerically and are searchable; price lives inside extra details', async ({ page }) => {
  await page.goto('');await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();
  await expect(page.getByLabel('מחיר הספר בש״ח',{exact:true})).toBeHidden();
  await page.getByLabel('שם הספר',{exact:true}).fill('ספר עשירי');await page.getByLabel('סדרה חדשה',{exact:true}).fill('סדרת בדיקה');
  await page.getByRole('button',{name:'יצירת סדרה',exact:true}).click();await expect(page.getByLabel('מספר בסדרה',{exact:true})).toBeEnabled();
  await page.getByLabel('מספר בסדרה',{exact:true}).fill('10');await page.getByText('פרטים נוספים',{exact:true}).click();
  await page.getByLabel('מחיר הספר בש״ח',{exact:true}).fill('45.50');await page.getByRole('button',{name:'שמירת הספר',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();
  await page.getByLabel('שם הספר',{exact:true}).fill('ספר שני');await page.getByLabel('סדרה',{exact:true}).selectOption({label:'סדרת בדיקה'});
  await page.getByLabel('מספר בסדרה',{exact:true}).fill('2');await page.getByRole('button',{name:'שמירת הספר',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();await expect(page.locator('.book-info h2')).toHaveText(['ספר שני','ספר עשירי']);
  await page.getByLabel('חיפוש ספר',{exact:true}).fill('סדרת בדיקה');await expect(page.locator('.book-info h2')).toHaveCount(2);
  await page.getByRole('button',{name:/ספר עשירי ללא מחבר/}).click();await expect(page.getByLabel('מספר בסדרה',{exact:true})).toHaveValue('10');
  await expect(page.getByLabel('מחיר הספר בש״ח',{exact:true})).toBeHidden();await page.getByText('פרטים נוספים',{exact:true}).click();await expect(page.getByLabel('מחיר הספר בש״ח',{exact:true})).toHaveValue('45.5');
  await page.screenshot({ path: 'test-results/book-details-mobile.png', fullPage: true });
});

test('reset requires confirmation, cancellation retains books and settings stay after reset', async ({ page }) => {
  await page.goto('');await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();await page.getByLabel('שם הספר',{exact:true}).fill('ספר לאיפוס');
  await page.getByRole('button',{name:'שמירת הספר',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link',{name:'הגדרות',exact:true}).click();await page.getByLabel('שם הספרייה',{exact:true}).fill('שם שנשמר');await page.getByRole('button',{name:'שמירת השם',exact:true}).click();
  await page.getByRole('button',{name:'איפוס מידע',exact:true}).click();await expect(page.getByRole('button',{name:'מחיקה סופית ואיפוס',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'ביטול',exact:true}).click();await page.getByRole('link',{name:'כל הספרים',exact:true}).click();await expect(page.getByRole('heading',{name:'ספר לאיפוס',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'הגדרות',exact:true}).click();await page.getByRole('button',{name:'איפוס מידע',exact:true}).click();
  await page.getByLabel('אני מאשר מחיקת כל הספרים והתמונות והמידע המשויך להם',{exact:true}).check();await page.getByRole('button',{name:'מחיקה סופית ואיפוס',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'הספרים והתמונות נמחקו'})).toBeVisible();await page.reload();
  await expect(page.getByLabel('שם הספרייה',{exact:true})).toHaveValue('שם שנשמר');await page.getByRole('link',{name:'כל הספרים',exact:true}).click();await expect(page.locator('.book-info h2')).toHaveCount(0);
});

test('local Hebrew OCR reads a rotated spine and upside-down cover and asks for review before search', async ({ page }) => {
  test.setTimeout(120000);
  const requests: string[] = [];
  await page.route(/https:\/\/(?:openlibrary.org|generativelanguage.googleapis.com|api.groq.com)\//, route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('');
  await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();await page.getByRole('button',{name:'סריקת תמונה',exact:true}).click();
  for (const rotation of [90,180]) {
  const png = await page.evaluate(rotation => {
    const c = document.createElement('canvas'); c.width = rotation === 90 ? 1200 : 900; c.height = rotation === 90 ? 900 : 1200;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0,0,1200,900);
    ctx.translate(c.width,rotation === 180 ? c.height : 0); ctx.rotate(rotation*Math.PI/180); ctx.fillStyle = '#111'; ctx.textAlign = 'right';
    ctx.font = 'bold 76px Arial'; ctx.fillText('ספר לדוגמה',800,350);
    ctx.font = '40px Arial'; ctx.fillText('מאת מחבר בדיקה',750,900);
    return c.toDataURL('image/png').split(',')[1];
  }, rotation);
  await page.getByLabel('בחירת תמונת ספר',{exact:true}).setInputFiles({name:'spine.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.getByLabel('שם הספר שזוהה',{exact:true})).toHaveValue('ספר לדוגמה',{timeout:95000});
  await expect(page.getByLabel('מחבר שזוהה',{exact:true})).toHaveValue('מחבר בדיקה');
  await expect(page.getByRole('button',{name:'חפש לפי הפרטים',exact:true})).toBeEnabled(); expect(requests).toEqual([]);
  }
});
