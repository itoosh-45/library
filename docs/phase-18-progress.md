# שלב 18 — הקשחה מקומית, App 0.16.0

Schema 2, JSON מלא 8 ו־Excel template 1 נשארים. השלב מספק הקשחה ובדיקות מקומיות; שער מחזור 9 עדיין פתוח. אין חשיפה ציבורית של gateway, שינוי Pages, הפעלת חיוב או קריאות מודל אמיתיות.

## שינויים

- CSP מחייב בבניית production: סקריפטים מאותו origin בלבד, בלי inline/eval; יעדי connect מוגבלים ל־Open Library, Gemini ול־gateway HTTPS שהוגדר ונבדק. Blob/data מותרים לתמונות מקומיות; inline styles נדרשים להכנה ולטפסים. המדיניות אינה מופעלת ב־dev בגלל HMR. frame-ancestors מחייב HTTP header בפריסה עתידית, ולא ניתן לאכפו דרך meta.
- Google Books שולח מפתח ב־X-Goog-Api-Key ליעד קבוע, בלי query key. [תיעוד Google](https://docs.cloud.google.com/apis/docs/system-parameters) תומך בפרמטר המערכת; חיבור חי ל־Books עם מפתח עדיין NOT RUN. אין fallback שמחזיר סוד ל־URL.
- קישורי מקור עם fragment נדחים, לצד דחיית פרמטרי מפתח/token, credentials ויעד זר. כותרות, מחברים והערות נשארים טקסט ולא HTML.
- עטיפת שם הספרייה והכותרת תוקנה אחרי גלישה מוכחת בהגדלת טקסט. המראה הקיים נשמר.

## ראיות והיקף

173 בדיקות Vitest וארבע Node עברו עם טיפוסים, lint ובניית האפליקציה והשירות. 49 בדיקות דפדפן ותשע production PWA עברו בגרסה הסופית, כולל גיבוי/שחזור, offline, Excel ושדרוגים. ספר הפרויקט נשאר byte-identical (SHA256 המקורי).

סריקת dist ו־.gateway-dist לא מצאה את secret canary, תבנית מפתח Google, מפתח פרטי או sk-proj. זו סריקה מוגבלת של דפוסים ולא הוכחה שאין שום סוד אפשרי. ליבת build היא כ־149.62KB gzip: index ‏136.17, runtime ‏9.13, CSS ‏3.71, HTML ‏0.61. Excel נשאר lazy ‏169.51KB gzip עם אזהרת chunk גדולה קיימת; אין הסתרת אזהרה או benchmark חוזר.

בדיקת /renamed/ production נוספת עברה אחרי בניית הנתיב עם CSP החדש: manifest/assets/worker נכונים, נתוני אותו origin נשמרים ושתי מעטפות זמינות offline. אין שינוי כתובת ציבורית.

בדיקות production ייעודיות חוסמות inline script ו־fetch ליעד זר, מציגות XSS canaries בכותרת/מחבר/הערות כטקסט, ומחפשות מפתח סינתטי ב־JSON, local/session storage, בכל 15 stores של IndexedDB ובכל URLs וגופי CacheStorage. המפתח נעלם ברענון. בדיקה נוספת מכינה תמונה מקומית ושולחת רק לבקשת Gemini מדומה, בכותרת ולא ב־URL/body; אין חיוב או בקשה לספק. שתי הבדיקות הממוקדות עברו.

Gateway: בקשות ללא Origin או עם Origin זר, SSRF/query fields זרים, body גדול, provider חסר/פגום/כושל, timeout ללא שיתוף פעולה, 429, מכסה יומית וקצב נבדקו. בדיקה חדשה מחזיקה שתי בקשות פעילות, דוחה שלישית ללא פנייה לספק, ואז מוכיחה שחרור משבצות. Origin ו־Host הם הגנת שירות loopback, ואינם authentication לפריסה ציבורית.

בדיקת prompt injection קיימת ב־phase10.test.ts: הוראות מודפסות בתמונה הן נתונים; שדות פעולה ו־URL זרים נדחים. זו בדיקת parser והגבלת יכולות, לא הוכחת חסינות של מודל חי.

npm audit עבור production ו־dev דיווח אפס advisories בכל החומרות. SheetJS מופץ ב־URL חיצוני; מסד advisories של npm אינו מכסה בהכרח כל חולשה בו. אין טענה לביטחון מוחלט ואין שדרוג גורף של תלויות.

ביקורת מחמשת הצירים: נכונות נבדקה בחסימת תוכן/רשת ובשימור טקסט ונתונים; קריאות — helper מדיניות קטן וזרימות קיימות; ארכיטקטורה — מדיניות בבנייה, מפתחות Google בצד השירות בלבד; אבטחה — צמצום יעדים, סודות וקלט, עם סיכונים פתוחים מפורשים; ביצועים — אין dependency נוספת ואין benchmark חוזר. ניסוי סקירה יחיד הוסיף unsafe-inline ל־script-src: הבדיקה נכשלה, הקוד הוחזר והבדיקה עברה. אין mutation score גורף.

## נגישות

סקירה מדודה לפי impeccable במחשב 1280px וב־360px, RTL, skip link/focus ו־Escape עם החזרת focus בעורך. סריקת הטקסט הגלוי מול רקעים מוצקים בדקה 4.5:1 ו־3:1 לטקסט גדול, בלי עיגול סף; לא נמצאו כשלים בתחום שנמדד או שדות טופס גלויים ללא שם. בדיקת הגדלה הכפילה font sizes מחושבים; אחרי תיקון עטיפה אין גלישה ברכיבים שנבדקו. תמונות הסיום נבדקו. הטופס נשאר בגלילה אנכית. זו אינה בדיקת zoom/VoiceOver ב־Safari או אישור WCAG מלא; placeholders, צבעי alpha וניגודיות לא־טקסט לא כוסו במלואם.

סקירה מוגבלת בחמשת ממדי impeccable (0–4): נגישות 3, היענות 3, ביצועים 3, theming 1 (מראה יחיד קיים), שלמות 3. 13/20 משקף היקף וסיכונים פתוחים, ולא ציון מוצר כולל. Detector יחיד דיווח שלוש אזהרות: broken-image הוא false positive (Blob URL מוקצה לפני תצוגה ויש fallback); side-tab פעמיים מתאר ניווט desktop קיים שאושר ומתאים ל־RTL. אין שינוי עיצוב מכוח אזהרות אלה.

## ממצאים ושער פרסום

1. **גבוה לפני חשיפה ציבורית:** gateway המקומי אינו מאמת משתמש, ומוני המכסה בזיכרון מתאפסים אחרי restart. אין לפרסם אותו כך. פריסה מאומתת, הגבלה עמידה להפעלה מחדש ובידוד מ־n8n עדיין NOT RUN; n8n לא שונה. T26 של Oracle אינו PASS.
2. NLI Search API מחייב api_key ב־URL HTTPS לפי [התיעוד](https://www.nli.org.il/he/research-and-teach/open-library/search-api). הוא נשאר בשרת וליעד קבוע; זהו סיכון upstream URL מתועד, ואין לטעון שאין מפתח באף URL. אין תמיכת header מאומתת. אין URL כזה בדפדפן, בגיבוי או ב־response/log של המוצר.
3. אימות NLI חי מלא, מפתח/מכסה Google Books, דיוק Gemini, iPhone/VoiceOver/Files/offline וכיבוי מכשיר נשארים NOT RUN. המשתמש השיב ״good״ לבדיקת 200%/Tab; נרשם שהבדיקה במחשב תקינה, בלי להסיק מכך VoiceOver או מכשיר אחר.

מחזור 9 אינו PASS וגרסת release סופית אינה מאושרת בראיות. אפשר להמשיך להכנת candidate/staging בטוחה לפי שלב 19, תוך שמירת שערים אלה. ספר הפרויקט המקורי לא שונה.

עדכון לאחר הדוח: [תיקון מכסות עמידות](gateway-quota-runbook.md) פתר את איפוס המונה המקומי על restart, עם 178 Vitest וארבע Node. הכשל הציבורי אינו מוסר כולו: authentication ו־infrastructure/Oracle עוד לא מאומתים. 21 hashes של frontend הושוו להעתק הקפוא ונשארו זהים; אין ריצת browser/PWA חוזרת בלי שינוי frontend.
