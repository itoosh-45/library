import {test,expect} from '@playwright/test';
test('shelf opens books immediately below itself in threes and search shows a vertical book grid',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('');
 await page.evaluate(async()=>{
  const dp='/library/src/data/database.ts',bp='/library/src/data/books.ts',cp='/library/src/data/collections.ts';const {db}=await import(dp),{saveBook,emptyInput}=await import(bp),{saveShelf}=await import(cp);
  const first=await saveShelf(db,{name:'א מדף ראשון',parentId:null});await saveShelf(db,{name:'ב מדף שני',parentId:null});const last=await saveShelf(db,{name:'ג מדף אחרון',parentId:null});
  for(let i=1;i<=8;i++)await saveBook(db,{...emptyInput,title:'ספר חיפוש '+i,shelfIds:[i<=6?first.id:last.id]});
 });
 await page.getByRole('link',{name:'מדפים',exact:true}).click();const first=page.getByRole('button',{name:/^א מדף ראשון/});await first.click();
 const books=page.getByRole('region',{name:'ספרים במדף: א מדף ראשון',exact:true});await expect(books).toBeVisible();await expect(books.locator('.book-row:visible')).toHaveCount(6);
 expect(await first.evaluate(el=>el.parentElement?.nextElementSibling?.classList.contains('shelf-inline-books'))).toBe(true);
 expect(await books.locator('.book-list').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
 await page.screenshot({path:'test-results/shelf-inline-phone.png',fullPage:true});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'test-results/shelf-inline-desktop.png',fullPage:true});
 await page.getByRole('searchbox',{name:'חיפוש ספר',exact:true}).fill('ספר חיפוש');const results=page.getByRole('region',{name:'תוצאות חיפוש במדפים',exact:true});await expect(results.locator('.book-row:visible')).toHaveCount(8);await expect(page.getByRole('list',{name:'עץ המדפים',exact:true})).toHaveCount(0);
 expect(await results.locator('.book-list').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
 await page.getByRole('searchbox',{name:'חיפוש ספר',exact:true}).fill('לא קיים');await expect(page.getByText('לא נמצאו ספרים. נסה שם אחר או נקה את החיפוש.',{exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'חיפוש ספר',exact:true}).fill('');await expect(books).toBeVisible();await first.click();await expect(books).toHaveCount(0);
});
