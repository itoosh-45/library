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


test('Groq key is remembered separately and Gemini failures use mocked Groq automatically',async({page})=>{
  const calls:string[]=[];await page.route('https://openlibrary.org/**',route=>route.fulfill({json:{docs:[{key:'/works/OL77W',title:'ספר גיבוי Groq',cover_i:77}]}}));
  const item={title:'ספר גיבוי Groq',authors:[],isbn:null,danacode:null,publisher:null,visibleText:'ספר גיבוי Groq',evidenceByField:{title:['ספר גיבוי Groq'],authors:[],isbn:[],danacode:[],publisher:[]},imageIndex:0,bbox:[0,0,1,1],uncertaintyReasons:[]};
  await page.route('https://generativelanguage.googleapis.com/**',route=>{calls.push('gemini');return route.fulfill({status:429,body:''});});
  await page.route('https://api.groq.com/**',route=>{calls.push('groq');expect(route.request().headers().authorization).toBe('Bearer SYNTHETIC-GROQ-KEY-NEVER-LIVE');return route.fulfill({json:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[item]})}}]}});});
  await page.goto('#settings');await page.getByText('זיהוי ספר מתמונה · Gemini',{exact:true}).click();
  await page.getByLabel('מפתח Gemini אישי',{exact:true}).fill('SYNTHETIC-GEMINI-KEY-NEVER-LIVE');
  await page.getByLabel('בדקתי שהפרויקט של המפתח הוא Free, ללא חיוב פעיל',{exact:true}).check();await page.getByLabel('אני מסכים לשליחת התמונה המוכנה ל־Google Gemini',{exact:true}).check();await page.getByRole('button',{name:'שמירת מפתח Gemini',exact:true}).click();
  await page.getByText('Groq · גיבוי לזיהוי תמונות',{exact:true}).click();
  await page.getByLabel('מפתח Groq אישי',{exact:true}).fill('SYNTHETIC-GROQ-KEY-NEVER-LIVE');await page.getByLabel('בדקתי שחשבון Groq במסלול Free ללא חיוב פעיל',{exact:true}).check();await page.getByLabel('אני מסכים לשליחת תמונות ל-Groq כגיבוי ל-Gemini',{exact:true}).check();await page.getByRole('button',{name:'שמירת מפתח Groq',exact:true}).click();
  await expect(page.getByText('מפתח Groq אישי מוגדר בדפדפן הזה.',{exact:true})).toBeVisible();expect(calls).toEqual([]);
  await page.reload();await page.getByText('Groq · גיבוי לזיהוי תמונות',{exact:true}).click();await expect(page.getByText('מפתח Groq אישי מוגדר בדפדפן הזה.',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'כל הספרים',exact:true}).click();const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=360;c.getContext('2d')!.fillRect(0,0,240,360);return c.toDataURL('image/png').split(',')[1];});
  await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();await page.getByRole('button',{name:'סריקת תמונה',exact:true}).click();
  await page.route('https://covers.openlibrary.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')}));
  await page.getByLabel('בחירת תמונת ספר',{exact:true}).setInputFiles({name:'SYNTHETIC.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.getByRole('heading',{name:'פרטי הספר שזוהה',exact:true})).toBeVisible();expect(calls).toEqual(['gemini','groq']);
  await expect(page.getByRole('region',{name:'אבחון הזיהוי'})).toContainText('הזיהוי בוצע באמצעות Groq.');
  await expect(page.getByRole('region',{name:'אבחון הזיהוי'})).toContainText('HTTP 429');
  await page.getByRole('button',{name:'שימוש בפרטים ללא חיפוש',exact:true}).click();await page.getByRole('button',{name:'חיפוש כריכה',exact:true}).click();await expect(page.getByRole('dialog').getByRole('img',{name:'כריכת הספר',exact:true})).toBeVisible();await page.getByRole('button',{name:'שמירת הספר',exact:true}).click();await expect(page.getByRole('heading',{name:'ספר גיבוי Groq',exact:true})).toBeVisible();await expect(page.locator('.book-jacket img')).toBeVisible();
  await page.getByRole('link',{name:'הגדרות',exact:true}).click();await page.getByText('Groq · גיבוי לזיהוי תמונות',{exact:true}).click();await page.getByRole('button',{name:'מחיקת מפתח Groq מהמכשיר',exact:true}).click();await page.reload();await page.getByText('Groq · גיבוי לזיהוי תמונות',{exact:true}).click();await expect(page.getByLabel('מפתח Groq אישי',{exact:true})).toHaveValue('');
});

test('Gemini rejection remains visible after local OCR completes instead of being overwritten by progress', async ({ page }) => {
  let calls=0;
  await page.route('https://generativelanguage.googleapis.com/**',route=>{calls++;return route.fulfill({status:401,body:'SYNTHETIC-PROVIDER-SECRET-NEVER-DISPLAY'});});
  await page.goto(process.env.KEY_TEST_PUBLIC === '1' ? 'https://itoosh-45.github.io/library/#settings' : '#settings'); await page.getByText('זיהוי ספר מתמונה · Gemini',{exact:true}).click();
  await page.getByLabel('מפתח Gemini אישי',{exact:true}).fill('SYNTHETIC-GEMINI-KEY-NEVER-LIVE');
  await page.getByLabel('בדקתי שהפרויקט של המפתח הוא Free, ללא חיוב פעיל',{exact:true}).check();await page.getByLabel('אני מסכים לשליחת התמונה המוכנה ל־Google Gemini',{exact:true}).check();await page.getByRole('button',{name:'שמירת מפתח Gemini',exact:true}).click();
  await page.getByRole('link',{name:'כל הספרים',exact:true}).click();
  const png=await page.evaluate(async()=>{await document.fonts.ready;const c=document.createElement('canvas');c.width=700;c.height=900;const ctx=c.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#000';ctx.direction='rtl';ctx.textAlign='center';ctx.font='bold 68px Heebo';ctx.fillText('ספר לבדיקה',350,250);return c.toDataURL('image/png').split(',')[1];});
  await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();await page.getByRole('button',{name:'סריקת תמונה',exact:true}).click();
  await page.getByLabel('דרך הזיהוי',{exact:true}).selectOption('auto');
  await page.getByLabel('בחירת תמונת ספר',{exact:true}).setInputFiles({name:'SYNTHETIC.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  const diagnostic=page.getByRole('region',{name:'אבחון הזיהוי'});
  await expect(diagnostic).toContainText('הזיהוי בוצע באמצעות OCR מקומי.',{timeout:25000});
  await expect(diagnostic).toContainText('המפתח או הרשאת הגישה נדחו (HTTP 401)');expect(calls).toBe(1);
  await expect(page.locator('body')).not.toContainText('SYNTHETIC-PROVIDER-SECRET-NEVER-DISPLAY');
});
