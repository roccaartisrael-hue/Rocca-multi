# חיבור Meta (Facebook + Instagram) לדומיין boolai.co.il

## כתובות להדבקה ב-Meta for Developers
| שדה ב-Meta | ערך |
|---|---|
| App Domains | `boolai.co.il` |
| Privacy Policy URL | `https://boolai.co.il/privacy` |
| Terms of Service URL | `https://boolai.co.il/terms` |
| User Data Deletion (Data deletion instructions URL) | `https://boolai.co.il/data-deletion` |
| User Data Deletion (Data deletion callback URL, חלופה) | `https://boolai.co.il/auth/facebook/data-deletion` |
| Facebook Login > Valid OAuth Redirect URIs | `https://boolai.co.il/auth/facebook/callback` |
| Webhooks > Callback URL | `https://boolai.co.il/webhooks/meta` |
| Webhooks > Verify token | הערך של `META_WEBHOOK_VERIFY_TOKEN` (בוחרים בעצמכם מחרוזת ארוכה) |

הנתיבים `/privacy`, `/terms`, `/data-deletion` זמינים גם ב-`www`, `app` ו-`api` של boolai.co.il. הנתיבים הישנים `/legal/...` ממשיכים לעבוד.

## משתני סביבה ב-Render (Environment)
את הערכים מזינים רק בלוח של Render, לא בצ'אט ולא בקוד.

| משתנה | חובה | תיאור |
|---|---|---|
| `APP_URL` (או `PUBLIC_URL`) | מומלץ | `https://boolai.co.il`. ברירת המחדל כשלא מוגדר: `https://<BRAND_DOMAIN>` |
| `BRAND_DOMAIN` | לא | ברירת מחדל `boolai.co.il` |
| `DASHBOARD_TOKEN` | כן | קוד הגישה למסך הכניסה |
| `META_APP_ID` | כן | מזהה האפליקציה ב-Meta |
| `META_APP_SECRET` | כן | סוד האפליקציה. משמש להחלפת code ל-token, לאימות חתימת ה-Webhook ולבקשות מחיקה |
| `META_WEBHOOK_VERIFY_TOKEN` | כן | מחרוזת לאימות GET של ה-Webhook |
| `META_LOGIN_CONFIG_ID` | רק ב-Facebook Login for Business | מזהה ה-Configuration |
| `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID` | רק לחיבור ידני | לא נדרשים כשמתחברים דרך כפתור ההתחברות באפליקציה |
| `OPERATOR_NAME` | כן | שם המפעיל כפי שיופיע בעמודי המשפט |
| `CONTACT_EMAIL` | כן | אימייל ליצירת קשר בעמודי המשפט (ללא זה מוצג `support@example.com`) |
| `LEGAL_DATE` | לא | תאריך עדכון בעמודי המשפט |
| `DATABASE_URL` | מומלץ | מסד נתונים קבוע, אחרת הנתונים נמחקים באתחול |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | לפי המודל | יצירת תוכן |
| `CORS_ORIGINS` | לא | מקורות נוספים מופרדים בפסיק |

## זרימת ה-OAuth
1. `POST /api/connection/start` (מחובר) מחזיר כתובת הסכמה של Meta עם `state` חתום שפג אחרי 10 דקות.
2. Meta מחזירה ל-`/auth/facebook/callback?code=...`.
3. השרת מאמת את ה-state, מחליף code ב-User Token קצר, ואז ב-Long-Lived User Token, וקורא את `/me/accounts`. ה-Page Token שמתקבל מ-Long-Lived User Token אינו פג.
4. הטוקן נשמר בצד השרת בלבד ולא מוחזר לדפדפן.

## Webhook
- `GET /webhooks/meta` מאמת `hub.mode`, `hub.verify_token` ומחזיר `hub.challenge`.
- `POST /webhooks/meta` דורש חתימת `X-Hub-Signature-256` תקפה (HMAC-SHA256 של גוף הבקשה עם `META_APP_SECRET`). בקשה עם חתימה שגויה נדחית ב-403.
- ב-Meta מסמנים את השדות: Page: `feed`, `messages`. Instagram: `comments`.
