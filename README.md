# הספרייה שלי — שלב 3 מקומי

בסיס האפליקציה בעברית וב־RTL, עם ניווט, ספרייה ריקה, הגדרות שם ומסד Dexie מקומי. אין חיבורי קטלוג, Gemini, קליטת OCR או עריכת ספרים בממשק בשלב זה. הוספה ועריכת ספרים, עותקים ושחזור בסיסי הם שלב 4.

## הפעלה במחשב

דרוש Node.js 24. הגרסאות נעולות ב־package-lock.json.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

פותחים http://127.0.0.1:4330/library/ . השרת מקומי למחשב בלבד. שם הספרייה נשמר בהגדרות ונשאר אחרי רענון. אין יצירת ספרים אישיים או נתוני דוגמה אוטומטית. המסד ייחודי לאפליקציה בשם itoosh-45.library.personal.v1; מעבר לכתובת או לדפדפן אחר יוצר הקשר אחסון אחר.

## בדיקות

```sh
npm run check
```

כולל TypeScript, ESLint, שמונה בדיקות כתיבה ואטומיות ו־build. בדיקות Vitest משתמשות ב־fake-indexeddb ומסדי בדיקה נפרדים; אין לראות בהן בלבד הוכחת שמירה בדפדפן.

```sh
npx playwright install chromium
npm run test:browser
```

בדיקות הדפדפן משתמשות בהקשר מבודד ומאמתות IndexedDB אמיתי, שמירה אחרי רענון, rollback, שני חלונות, ניווט, רוחב 360px ושגיאת אחסון. על מחשב עם Chrome מותקן אפשר להריץ בלי הורדת דפדפן נוסף באמצעות משתנה הסביבה PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH המצביע לקובץ ההפעלה. הבדיקות אינן מוסיפות ספרים להקשר הדפדפן הרגיל של המשתמש.

```sh
npm run preview
```

תצוגת ה־build ב־http://127.0.0.1:4331/library/ . origin זה נפרד משרת הפיתוח ולכן נתוניו נפרדים.

## מצב התוכנית

המשתמש אישר להתקדם לבנייה ולדחות את בדיקות ההיתכנות שנותרו. הן נשארות פתוחות ושער 1 אינו מסומן PASS. האפליקציה עצמה עדיין לא פורסמה. [תוכנית השלב](docs/phase-03-plan.md).

המאגר הקבוע לפיתוח הוא https://github.com/itoosh-45/library , בענף main. לפי בקשת המשתמש, קובצי ניסוי המצלמה הוחלפו בקובצי האפליקציה. ניסוי המצלמה נשמר בהיסטוריה ובענף camera-demo-archive, שממנו GitHub Pages ממשיך להגיש אותו. אין כאן היסטוריית היתכנות פרטית או תמונות וספרים אישיים. CI ב־.github/workflows/check.yml בודק את הפרויקט, ללא פרסום; תוצאות הריצה מופיעות ב־GitHub Actions.

## רישיונות ותשתית

React/Vite/ESLint/Vitest/Playwright ברישיונות MIT/Apache-2.0 כפי שמופיע ב־docs/package-selection.json וב־lockfile; Dexie ו־TypeScript ברישיון Apache-2.0. Heebo מוגש מקומית עם רישיון SIL OFL המצורף ב־public/fonts/Heebo-OFL.txt.

מקורות התשתית: [React](https://react.dev/learn/build-a-react-app-from-scratch), [Vite](https://vite.dev/guide/), [Dexie](https://dexie.org/docs/Tutorial/React), [Vitest](https://vitest.dev/guide/).
