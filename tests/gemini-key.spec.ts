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
  await page.getByRole('button',{name:'הוספת ספר',exact:true}).click();await page.getByRole('button',{name:'הוספה מתמונה · ספרים או ברקודים',exact:true}).click();
  await page.route('https://covers.openlibrary.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')}));
  await page.getByLabel('בחירת תמונת ספר',{exact:true}).setInputFiles({name:'SYNTHETIC.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await expect(page.getByRole('heading',{name:'ספרים שזוהו (1)',exact:true})).toBeVisible();expect(calls).toEqual(['gemini','groq']);
  await page.getByRole('button',{name:'הוספת 1 ספרים לספרייה',exact:true}).click();await expect(page.getByRole('heading',{name:'ספר גיבוי Groq',exact:true})).toBeVisible();await expect(page.locator('.book-jacket img')).toBeVisible();
  await page.getByRole('link',{name:'הגדרות',exact:true}).click();await page.getByText('Groq · גיבוי לזיהוי תמונות',{exact:true}).click();await page.getByRole('button',{name:'מחיקת מפתח Groq מהמכשיר',exact:true}).click();await page.reload();await page.getByText('Groq · גיבוי לזיהוי תמונות',{exact:true}).click();await expect(page.getByLabel('מפתח Groq אישי',{exact:true})).toHaveValue('');
});
