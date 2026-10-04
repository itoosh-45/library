import { test, expect } from '@playwright/test';

test('production CSP allows a validated catalog cover; a later failed cover preserves it and offline displays it', async ({ page, context }) => {
  await page.goto('./');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 300; c.getContext('2d')!.fillRect(0, 0, 200, 300); return c.toDataURL('image/png').split(',')[1]; });
  await page.route('https://openlibrary.org/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/search.json' ? { docs: [{ key: '/works/OL88W', title: 'ספר כריכה סינתטי', editions: { docs: [{ key: '/books/OL88M', title: 'ספר כריכה סינתטי' }] } }] } : { title: 'ספר כריכה סינתטי', publishers: ['הוצאה סינתטית'], covers: [88] } }));
  let missing = false;
  await page.route('https://covers.openlibrary.org/**', route => missing ? route.fulfill({ status: 404, body: 'missing' }) : route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }));
  await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
  await page.getByText('מילוי אוטומטי מסריקה או תמונה', { exact: true }).click(); await page.getByRole('dialog').locator('summary').filter({ hasText: /^חיפוש ספר$/ }).click(); await page.getByLabel('שם ספר או ISBN', { exact: true }).fill('ספר כריכה סינתטי');
  await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
  await page.locator('.candidate').first().scrollIntoViewIfNeeded();
  await expect(page.getByRole('img', { name: 'כריכת ספר כריכה סינתטי', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'בחירת מועמד ספר כריכה סינתטי', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'כריכת הספר', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await page.getByRole('button', { name: /ספר כריכה סינתטי.*ללא מחבר/ }).click();
  missing = true;
  await page.getByText('מילוי אוטומטי מסריקה או תמונה', { exact: true }).click(); await page.getByRole('dialog').locator('summary').filter({ hasText: /^חיפוש ספר$/ }).click();
  await page.getByRole('button', { name: 'חיפוש בקטלוגים', exact: true }).click();
  await page.getByRole('button', { name: 'בחירת מועמד ספר כריכה סינתטי', exact: true }).click();
  await expect(page.getByText(/הכריכה לא נטענה; אפשר להעלות תמונה ידנית/)).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'כריכת הספר', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.book-jacket img')).toBeVisible();
});


test('production accepts the real Open Library archive cover redirect with local compressed storage',async({page})=>{
  test.setTimeout(60000);
  await page.route('https://openlibrary.org/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path==='/search.json'?{docs:[{key:'/works/OL99W',title:'Synthetic archive cover',editions:{docs:[{key:'/books/OL99M',title:'Synthetic archive cover'}]}}]}:{title:'Synthetic archive cover',covers:[8739161],isbn_13:['9780140328721']}});});
  await page.goto('./');await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();await page.getByLabel('שם הספר',{exact:true}).fill('Synthetic archive cover');
  await page.getByText('מילוי אוטומטי מסריקה או תמונה',{exact:true}).click();await page.locator('summary').filter({hasText:'חיפוש ספר'}).click();await page.getByLabel('שם ספר או ISBN',{exact:true}).fill('Synthetic archive cover');await page.getByRole('button',{name:'חיפוש בקטלוגים',exact:true}).click();await page.getByRole('button',{name:'בחירת מועמד Synthetic archive cover',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('img',{name:'כריכת הספר',exact:true})).toBeVisible({timeout:25000});
  await page.getByRole('button',{name:'שמירת הספר',exact:true}).click();await expect(page.locator('.book-jacket img')).toBeVisible();
});
