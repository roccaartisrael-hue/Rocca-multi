# boolai.co.il — חיבור הדומיין (LiveDNS ← Render)

הדומיין **BOOLAI.CO.IL** רשום ב-LiveDNS. השרת (שירות Render `rocca-social-bot`) מנתב לפי שם המארח:

| כתובת | מה מוצג |
|---|---|
| `boolai.co.il`, `www.boolai.co.il` | האתר השיווקי + קטלוג חבילות |
| `app.boolai.co.il` | הדשבורד (כניסה, הרשמה, רכישה) |
| `api.boolai.co.il` | API בלבד (webhooks של הסליקה, טפסי לידים, אפליקציה בחנויות) |

האתר של rocca.co.il נשאר ב-Netlify ולא משתנה.

## רשומות DNS להזנה ב-LiveDNS
(מקור: [התיעוד של Render על DNS](https://render.com/docs/configure-other-dns))

| סוג | Host / שם | ערך |
|---|---|---|
| **A** | `@` (הדומיין הראשי) | `216.24.57.1` |
| **CNAME** | `www` | `rocca-social-bot.onrender.com` |
| **CNAME** | `app` | `rocca-social-bot.onrender.com` |
| **CNAME** | `api` | `rocca-social-bot.onrender.com` |

- הכתובת `rocca-social-bot.onrender.com` היא שם השירות לפי `render.yaml`. אם בדשבורד של Render כתובת השירות שונה (למשל עם סיומת), יש להעתיק משם את הכתובת המדויקת.
- **למחוק רשומות AAAA** (IPv6) אם קיימות, ולכבות "הפניית דומיין/Forwarding" ו-Parking ב-LiveDNS על הדומיין, כי הן מתנגשות.
- CNAME לא מותר על הדומיין הראשי (`@`), ולכן שם משתמשים ב-A.

## סדר הפעולות
1. **Render** ← השירות ← Settings ← **Custom Domains** ← מוסיפים: `boolai.co.il`, `www.boolai.co.il`, `app.boolai.co.il`, `api.boolai.co.il`.
2. **LiveDNS**: על שורת BOOLAI.CO.IL לוחצים על סמל ה-DNS ומזינים את הרשומות מהטבלה.
3. מחכים (דקות עד שעות) עד ש-Render מראה "Verified" ומנפיק HTTPS אוטומטי. בדיקה: `https://app.boolai.co.il` נפתח.
4. **Meta for Developers** ← Settings ← Basic: ל-App Domains מוסיפים `boolai.co.il`; Privacy Policy URL: `https://app.boolai.co.il/legal/privacy`; ב-Valid OAuth Redirect URIs מוסיפים `https://app.boolai.co.il/auth/facebook/callback`.
5. **רק אחרי שלב 4**, ב-Render ← Environment: `PUBLIC_URL=https://app.boolai.co.il` (מכאן כתובת החזרה של הכניסה לפייסבוק; לפני כן השאירו את הערך הקיים כדי שהחיבור הנוכחי של ROCCA לא יישבר).
6. כשהדומיין חי: מפרסמים את הקרדיט "Powered by BOOL" באתר של רוקה (ענף `claude/rocca-bool-footer`).
7. מייל התראות על לידים: ב-Resend מוסיפים ומאמתים את `boolai.co.il` (רשומות DNS נוספות שהם נותנים). עד אז התראות יוצאות רק ב-webhook.
8. `BRAND_DOMAIN` (ברירת מחדל `boolai.co.il`) משנה את הדומיין בכל המערכת בלי שינוי קוד.
