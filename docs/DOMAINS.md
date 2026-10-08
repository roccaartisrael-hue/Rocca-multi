# boolai.co.il — חיבור הדומיין (LiveDNS ← Render)

הדומיין **BOOLAI.CO.IL** רשום ב-LiveDNS. השרת (אותו שירות Render של ROCCA) מנתב לפי שם המארח:

| כתובת | מה מוצג |
|---|---|
| `boolai.co.il`, `www.boolai.co.il` | האתר השיווקי + קטלוג חבילות |
| `app.boolai.co.il` | הדשבורד (כניסה, הרשמה, רכישה) |
| `api.boolai.co.il` | API בלבד (לאפליקציה בחנויות ולטפסי לידים) |

האתר של rocca.co.il נשאר ב-Netlify ולא משתנה.

## שלבים (בסדר הזה)
1. **Render** ← השירות ← Settings ← **Custom Domains** ← מוסיפים את ארבעת השמות מהטבלה. Render מציג לכל אחד איזו רשומה DNS להגדיר.
2. **LiveDNS** ← ברשימת הדומיינים, על שורת BOOLAI.CO.IL לוחצים על סמל ה-DNS ← מוסיפים:
   - `app`, `api`, `www`: רשומת **CNAME** אל כתובת `…onrender.com` של השירות.
   - הדומיין הראשי (`@`): CNAME לא מותר על הדומיין הראשי, ולכן רשומת **A** לכתובת ה-IP ש-Render מציג בשלב 1.
3. מחכים (דקות עד שעות). ב-Render יופיע "Verified" ויונפק אישור HTTPS אוטומטי.
4. **Meta for Developers** (האפליקציה) ← Settings ← Basic: להוסיף ל-App Domains את `boolai.co.il`; Privacy Policy URL: `https://app.boolai.co.il/legal/privacy`; בהגדרות הכניסה לפייסבוק להוסיף ל-Valid OAuth Redirect URIs: `https://app.boolai.co.il/auth/facebook/callback`.
5. **רק אחרי שלב 4**, ב-Render ← Environment: `PUBLIC_URL=https://app.boolai.co.il` (מכאן כתובת החזרה של הכניסה לפייסבוק). לפני כן השארו את הערך הקיים כדי שהחיבור הנוכחי של ROCCA לא יישבר.
6. מייל התראות על לידים: ב-Resend מוסיפים ומאמתים את הדומיין `boolai.co.il` (רשומות DNS נוספות). עד אז התראות יוצאות רק ב-webhook.
7. אופציונלי: `BRAND_DOMAIN` (ברירת מחדל `boolai.co.il`) משנה את הדומיין בכל המערכת בלי שינוי קוד.

## סליקה
כתובות החזרה בעמוד התשלום של הספק: `https://app.boolai.co.il/#checkout=success` ו-`https://app.boolai.co.il/#checkout=cancel`.
