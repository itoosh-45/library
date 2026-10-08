import {test,expect} from '@playwright/test';
test('NLI catalog applies normalized book details without exposing the server key',async({page})=>{
 await page.route('https://openlibrary.org/**',route=>route.fulfill({json:{docs:[]}}));
 await page.route('https://maya-n8n.duckdns.org/library-catalog/**',route=>{
  if(!route.request().url().endsWith('/nli-search'))return route.fulfill({status:503,json:{state:'blocked'}});
  expect(route.request().postDataJSON().query.title).toBe('ספר לאומי לבדיקה');
  return route.fulfill({json:{provider:'nli',cached:true,results:[{provider:'nli',recordId:'123',kind:'edition',sourceUrl:null,fetchedAt:'2026-10-08T00:00:00.000Z',fields:{title:'ספר לאומי לבדיקה',authors:['מחבר סינתטי'],publicationDate:'2024-02-29',publicationYear:2024,publisher:'הוצאה סינתטית'},warnings:[]}]}});
 });
 await page.goto('#settings');await page.getByText('קטלוגים · דני ספרים, הספרייה הלאומית ו־Goodreads',{exact:true}).click();await page.getByLabel('מפתח שירות הקטלוג הפרטי',{exact:true}).fill('b'.repeat(64));await page.getByRole('button',{name:'שמירת מפתח שירות הקטלוג',exact:true}).click();
 await page.getByRole('link',{name:'כל הספרים',exact:true}).click();await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();await page.getByRole('button',{name:'חיפוש',exact:true}).click();await page.getByLabel('שם ספר, דאנאקוד או ISBN',{exact:true}).fill('ספר לאומי לבדיקה');await page.getByRole('button',{name:'חיפוש בקטלוגים',exact:true}).click();
 await page.getByRole('button',{name:'בחירת מועמד ספר לאומי לבדיקה',exact:true}).click();await expect(page.getByLabel('שם הספר',{exact:true})).toHaveValue('ספר לאומי לבדיקה');await expect(page.getByLabel('תאריך פרסום',{exact:true})).toHaveValue('2024-02-29');
 await page.getByRole('button',{name:'שמירת הספר',exact:true}).click();await page.reload();await expect(page.getByRole('heading',{name:'ספר לאומי לבדיקה',exact:true})).toBeVisible();
});

test('NLI temporary wait shows its deadline and a new user search succeeds after expiry',async({page})=>{
 let nliCalls=0;
 await page.route('https://openlibrary.org/**',route=>route.fulfill({json:{docs:[]}}));
 await page.route('https://maya-n8n.duckdns.org/library-catalog/**',route=>{
  if(!route.request().url().endsWith('/nli-search'))return route.fulfill({status:503,json:{state:'blocked'}});
  if(++nliCalls===1)return route.fulfill({status:429,headers:{'Retry-After':'60'},json:{state:'rate-limited'}});
  return route.fulfill({json:{provider:'nli',cached:true,results:[{provider:'nli',recordId:'123',kind:'edition',sourceUrl:null,fetchedAt:'2026-10-09T00:00:00.000Z',fields:{title:'ספר בדיקה לאחר המתנה'},warnings:[]}]}});
 });
 await page.goto('#settings');await page.getByText('קטלוגים · דני ספרים, הספרייה הלאומית ו־Goodreads',{exact:true}).click();await page.getByLabel('מפתח שירות הקטלוג הפרטי',{exact:true}).fill('b'.repeat(64));await page.getByRole('button',{name:'שמירת מפתח שירות הקטלוג',exact:true}).click();
 await page.getByRole('link',{name:'כל הספרים',exact:true}).click();await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();await page.getByRole('button',{name:'חיפוש',exact:true}).click();await page.getByLabel('שם ספר, דאנאקוד או ISBN',{exact:true}).fill('ספר בדיקה לאחר המתנה');await page.getByRole('button',{name:'חיפוש בקטלוגים',exact:true}).click();
 await expect(page.getByText(/שירות הקטלוג ממתין לפני חיפוש ב־הספרייה הלאומית/)).toContainText(/אפשר לנסות שוב אחרי \d{2}:\d{2}:\d{2}/);
 await page.clock.install();await page.clock.fastForward(61000);expect(nliCalls).toBe(1);
 await page.getByRole('button',{name:'חיפוש בקטלוגים',exact:true}).click();await expect(page.getByRole('button',{name:'בחירת מועמד ספר בדיקה לאחר המתנה',exact:true})).toBeVisible();expect(nliCalls).toBe(2);
});
