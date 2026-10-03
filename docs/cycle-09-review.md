# מחזור 9 — שדרוגים, אבטחה ונגישות

שלבים 17–18, App 0.16.0, schema 2/JSON 8. המצב הוא PARTIAL, לא PASS. הוראת האוטונומיה מאפשרת התקדמות עצמאית ולא משנה את הראיות.

| דרישה | ראיה / מצב |
|---|---|
| migration, rollback וגרסה עתידית | phase17.test.ts, בדיקות versionchange/blocked, קוד stage16 אמיתי ונתיב /renamed/; ראיות ב־phase-17-progress.md |
| שדרוג offline וגיבוי/שחזור | PWA update+schema1 ו־JSON 1–8, כל הטבלאות/Blobs/קשרים; כיבוי טלפון פיזי NOT RUN |
| XSS, יעד רשת ופרטיות | CSP production, canary בכותרת/מחבר/הערות, backup/storage/cache/URL, Gemini מדומה; phase-18-progress.md |
| gateway ותקציב | מקור/Host/body/timeout/rate/quota/concurrency מקומיים; תיקון SQLite ובדיקות תהליכים נפרדים משמרים מכסה/Retry-After אחרי restart באותו דיסק. authentication ציבורי ואימות infrastructure עדיין חסרים ומונעים פרסום gateway; ראו gateway-quota-runbook.md |
| נגישות | RTL/keyboard/labels/ניגודיות מוצקה והגדלת טקסט סינתטית במחשב; VoiceOver/iPhone וסקירה מלאה NOT RUN |
| סודות upstream | Google key header; NLI query key נדרש ומתועד, חיבור חי מלא NOT RUN |
| תלויות | npm audit אפס advisories; כיסוי advisory של URL SheetJS מוגבל |
| Oracle/n8n | T26 NOT RUN; אין גישה/פריסה מאומתת ואין שינויים ב־n8n |
| מועמד release | אין טענה לשער מלא; להכין staging נפרד ובטוח, לשמר מגבלות וסימון חיבורים לא מאומתים |

אין תשלום, מנוי/קרדיטים/חיוב, שינוי Pages או נתונים אישיים. ניסויים חצויים; נשמרו בדיקות שלמות ואבטחה.
