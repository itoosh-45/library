# שלב 8 — קטלוגים ובחירת מועמדים

המשך התוכנית שאושרה, באותו מאגר ובעיצוב הקיים. ההיתכנות בחרה Open Library ישיר; NLI ו־Google Books דרך gateway מבודד. אין שינוי n8n או פרסום מוצר. מפתחות, מכסות ו־mapping חי של NLI/Books עדיין חסרים; אין שימוש במפתח אורח או עקיפת 429.

1. הרחבת גיבוי v4 ל־metadataSources לפני שמירת מקור: whitelist לשדות ספר בלבד, provider/record/source, selectedFields ו־userOverriddenFields, קשרי ספר, fingerprint, rollback ו־delete. שחזור v1–v3 מוסיף רשימת מקורות ריקה עם אזהרה; cache אינו גיבוי.
2. חוזה query/candidate/provider result, אימות קלט ופלט לא מהימן. Work נשאר רמז ללא שנת מהדורה/ISBN מה־Work; Edition/Volume מוצגים בנפרד. אין מיזוג לפי כותרת ואין השלמה של מזהה סותר. עריכה ידנית ובחירת שדות גוברות על הצעה.
3. חיפוש בפעולה מפורשת בלבד, תוצאות חלקיות לפי ספק, תור וקצב Open Library עד בקשה בשנייה, timeout 12 שניות, ביטול ומספר בקשה נגד תשובות ישנות. cache metadata לשבעה ימים, ריק ל־15 דקות, ומחיקה מפורשת. 429 מפסיק עד Retry-After; אין סבב ספק/מפתח לעקיפה.
4. מסך מועמדים מתוך הוספה או השלמת ספר: פרטי החיפוש בלבד יוצאים לספק, מקור והבדל בין יצירה למהדורה, בחירה מפורשת לשדות, עריכה לפני אישור ושמירה אטומית עם provenance. כפילות ISBN מציעה עותק או ספר נפרד; השלמה אינה דורסת ערכים בלי בחירה ואינה דורסת עריכה חדשה.
5. gateway מקומי/מבודד עם יעדים קבועים, allowlist לשדות, מגבלת גוף/קצב/זמן, סודות בשרת בלבד ושגיאות בטוחות. פריסה תיעשה רק אחרי מסלול קונקרטי ובדיקות T07/T24/T26 החלות, עם המפתחות והמכסות המאושרים. אין להמציא schema של NLI מתוצאה שלא נשמרה; schema שאינו מאומת יוצג כחיבור שדורש השלמה.
6. T15/T19/T24: סתירות שנה/מחבר/ISBN, Work/Edition, שדות זרים ו־XSS, 429/timeout/ביטול/תוצאה ישנה, cache, בחירה ועריכה, כפילות, stale window, rollback ומקורות בגיבוי. npm run check ו־Chrome מבודד, build ו־360px. ניסוי חי לכל ספק חובה ועשר תוצאות המשתמש מתועדים בנפרד; שער מחזור 4 אינו PASS עד ראיות אלה.

מקורות: [Open Library Search](https://openlibrary.org/dev/docs/api/search), [כללי API](https://openlibrary.org/developers/api), [Google Books](https://developers.google.com/books/docs/v1/using), [NLI Search](https://www.nli.org.il/en/research-and-teach/open-library/search-api). ב־2.10 התיעוד הרשמי מאשר ש־Open Library search מחזיר Works כברירת מחדל וש־lang מעדיף ולא מסנן שפה; אין הסקת מהדורה ממנו. תיעוד NLI מאונדקס, אך הדף לא נטען בכלי הגלישה; אין בכך ראיית תגובת ספק חיה.
