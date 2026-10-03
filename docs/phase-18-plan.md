# שלב 18 — אבטחה, פרטיות ונגישות

לפי WORK_PLAN v1.2, T24 כולל קלט לא מהימן/XSS/URL/SSRF/secret canary/מפתחות ב־URL, logs וגיבויים, quota/מקבילות/הרשאה ושגיאות gateway; T25 ניגודיות, focus, הגדלת טקסט ו־RTL ו־VoiceOver; T26 restart ובידוד אם gateway ב־Oracle פעיל. שינוי שרתי n8n אינו מורשה במסגרת העבודה, ואינו מתבצע. בדיקה חסרה לא מסומנת PASS; כשל מסוכן מונע candidate.

היקף מאושר: סקירת הממשק הקיים והקשחה ממוקדת, בלי עיצוב מחדש, חשבונות משתמש או תשלום. מתחילים ב־npm audit לקריאה בלבד וביקורת זרימות קיימות. הוחלט על CSP מחייב בבניית production שמכסה את יעדי הרשת בפועל, ללא inline scripts/eval, עם style inline נדרש לטפסים/crop; מדיניות dev נפרדת בגלל HMR. מפתח Google Books יועבר לכותרת X-Goog-Api-Key לפי תיעוד מערכת Google, ללא fallback סודי ב־URL. קישור מקור יידחה אם מכיל fragment או פרמטר סוד.

NLI Search API מתעד api_key כפרמטר חובה ב־HTTPS URL ליעד קבוע. אין להמציא תמיכה ב־header מהתיעוד של api2 או לשבור את החיבור בשינוי לא מאומת. המפתח נשאר בשרת; אין URL מלא ב־response/log/browser/history/backup. סיכון upstream URL יתועד במפורש במקום טענת ״אין מפתח באף URL״. אימות חי נשאר פתוח.

נגישות: משתמשים ב־impeccable audit כסקירה על incumbent, עם ביקור מדוד במחשב וב־360px/הגדלת טקסט, ובדיקה מכנית אחת; רק ממצאים מוכחים יתוקנו. התקציב הניסויי חצוי: אין benchmark חוזר/ספרייה חלופית/התקנת Office או כלי בתשלום. הוכחות browser/fixture אינן מחליפות VoiceOver ומכשיר אמיתי. בדיקת משתמש תישלח כשהמסך מוכן; העבודה הבלתי תלויה ממשיכה ללא תשובה.

מקורות: [Google system parameters](https://docs.cloud.google.com/apis/docs/system-parameters), [API key best practices](https://docs.cloud.google.com/docs/authentication/api-keys-best-practices), [NLI Search API](https://www.nli.org.il/he/research-and-teach/open-library/search-api). אין תשלום, הוספת קרדיטים, billing או שינוי Pages בשלב הזה.
