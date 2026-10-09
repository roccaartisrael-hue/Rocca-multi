# BOOL AI – store app (Capacitor)

A thin native shell around https://app.boolai.co.il. Android first.

## One-time (needs a computer, not a phone)
1. Install Node 20+, Android Studio (for Android) / Xcode on a Mac (for iOS).
2. `cd mobile && npm install`
3. `npm run add:android`   (iOS later: `npm run add:ios`)
4. `npm run assets`        (generates all icon/splash sizes from assets/)
5. `npm run sync && npm run open:android` → Android Studio → Build → Generate Signed Bundle (.aab)
6. Upload the .aab to Google Play Console (developer account, one-time ~$25).

## Store rules to handle before submitting
- **Payments:** Apple/Google require their own billing for digital subscriptions/credits sold inside the app (15–30% fee). Either hide purchase screens in the app (use the web to buy) or integrate store billing. Decide before review.
- **Apple 4.2 (minimum functionality):** a pure website wrapper is often rejected. Add native value (push notifications, share, camera upload) before iOS.
- Privacy policy URL: https://boolai.co.il/privacy · Data deletion: https://boolai.co.il/data-deletion
- Store listing copy (4 languages): see ../server/public/marketing/i18n/campaign-copy.json for tone; full store text pending.
