import { test, expect } from '@playwright/test';
test('scanned danacode searches immediately and applies only the exact single match without saving', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: class { static async getSupportedFormats() { return ['code_128']; } async detect() { return [{ rawValue: '012300004567' }]; } } }); });
  await page.goto('#settings'); await page.getByText('קטלוגים · דני ספרים, הספרייה הלאומית ו־Goodreads', { exact: true }).click();
  await page.getByLabel('מפתח שירות הקטלוג הפרטי', { exact: true }).fill('b'.repeat(64)); await page.getByRole('button', { name: 'שמירת מפתח שירות הקטלוג', exact: true }).click();
  const calls: string[] = [];
  await page.route('https://maya-n8n.duckdns.org/library-catalog/**', route => {
    if(route.request().url().endsWith('/nli-search')) return route.fulfill({json:{provider:'nli',results:[],cached:true}});
    calls.push(new URL(route.request().url()).pathname); expect(route.request().headers().authorization).toBe('Bearer ' + 'b'.repeat(64));
    const row = { provider: 'danibooks', recordId: '123', sourceUrl: 'https://www.danibooks.co.il/web/?pagetype=9&itemid=123', fetchedAt: '2026-10-08T00:00:00.000Z', fields: { title: 'ספר דאנאקוד לבדיקה', authors: ['מחבר בדיקה'], publisher: 'הוצאה לבדיקה', danacode: '012300004567' }, warnings: [], cached: true };
    return route.fulfill({ json: route.request().url().endsWith('/danacode') ? { provider: 'danibooks', cached: true, results: [{ recordId: row.recordId, sourceUrl: row.sourceUrl }] } : row });
  });
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click(); await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click(); await page.getByRole('button', { name: 'סריקת ברקוד', exact: true }).click();
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 300; return c.toDataURL('image/png').split(',')[1]; });
  await page.getByLabel('תמונת ברקוד', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(page.getByRole('dialog', { name: 'סריקת ברקוד', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('שם הספר', { exact: true })).toHaveValue('ספר דאנאקוד לבדיקה');
  expect(calls).toEqual(['/library-catalog/v1/danacode', '/library-catalog/v1/danibook']);
  await expect(page.getByRole('dialog', { name: 'הוספת ספר', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'פתיחת חיפוש ידני בספרייה הלאומית', exact: true })).toHaveCount(0);
  await expect(page.getByText('דאנאקוד דורש חיפוש ידני בקטלוג מורשה.', {exact:true})).toHaveCount(0);
  await page.screenshot({ path: 'test-results/danacode-warning-phone.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: 'test-results/danacode-warning-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click(); await page.reload(); await expect(page.getByRole('heading', { name: 'ספר דאנאקוד לבדיקה', exact: true })).toBeVisible();
});

for (const scenario of ['wrong identifier', 'multiple results']) {
  test('danacode does not automatically apply ' + scenario, async ({ page }) => {
    await page.goto('#settings'); await page.getByText('קטלוגים · דני ספרים, הספרייה הלאומית ו־Goodreads', {exact:true}).click();
    await page.getByLabel('מפתח שירות הקטלוג הפרטי',{exact:true}).fill('b'.repeat(64)); await page.getByRole('button',{name:'שמירת מפתח שירות הקטלוג',exact:true}).click();
    await page.route('https://maya-n8n.duckdns.org/library-catalog/**', route => {
      if(route.request().url().endsWith('/nli-search')) return route.fulfill({json:{provider:'nli',results:[],cached:true}});
      const candidate = {provider:'danibooks',recordId:'123',sourceUrl:'https://www.danibooks.co.il/web/?pagetype=9&itemid=123',kind:'edition',fetchedAt:'2026-10-08T00:00:00.000Z',fields:{title:'ספר שגוי לבדיקה',danacode:'012300009999'},warnings:[],cached:true};
      return route.fulfill({json:route.request().url().endsWith('/danacode') ? {provider:'danibooks',cached:true,results:scenario==='multiple results' ? [candidate,{...candidate,recordId:'124',sourceUrl:'https://www.danibooks.co.il/web/?pagetype=9&itemid=124'}] : [candidate]} : candidate});
    });
    await page.getByRole('link',{name:'כל הספרים',exact:true}).click(); await page.getByRole('button',{name:'הוספת ספר',exact:true}).click(); await page.getByRole('button',{name:'סריקת ברקוד',exact:true}).click();
    await page.getByLabel('מזהה שנקרא או הוקלד',{exact:true}).fill('012300004567'); await page.getByRole('button',{name:'חיפוש לפי המזהה',exact:true}).click();
    if (scenario==='wrong identifier') { const warning=page.getByRole('alert').filter({hasText:'ללא התאמה מדויקת'}); await expect(warning).toBeVisible(); await expect(warning).toHaveCSS('background-color','rgb(255, 240, 240)'); await expect(warning).toHaveCSS('border-top-width','1px'); }
    else await expect(page.getByRole('button',{name:'בחירת מועמד ספר שגוי לבדיקה',exact:true})).toHaveCount(2);
    await expect(page.getByLabel('שם הספר',{exact:true})).toHaveValue('');
    await page.getByRole('dialog',{name:'הוספת ספר',exact:true}).getByRole('button',{name:'סגירה',exact:true}).click(); await expect(page.getByRole('heading',{name:'ספר שגוי לבדיקה',exact:true})).toHaveCount(0);
  });
}
