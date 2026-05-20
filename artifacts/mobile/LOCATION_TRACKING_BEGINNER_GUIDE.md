# Location Tracking Guide (Extreme Beginner)

This guide explains location tracking in this app in very simple terms.

App: `Neelgund Developers`  
Folder: `artifacts/mobile`

---

## 1) What is location tracking here?

In this app, location is used for 3 things:

1. **Entry gate**: user must allow location to continue.
2. **Attendance GPS**: check-in/check-out can store coordinates.
3. **Auto tracking**: app sends location every few minutes while logged in.

So yes, this app does not use location only once. It uses it continuously while app is active (native app).

---

## 2) Super simple flow

When user opens app:

1. App asks for location permission.
2. If user taps **Allow**, app opens dashboard.
3. If user taps **Don't allow**, app shows blocked screen and asks to open Settings.
4. After login + permission, tracker starts and sends points to Supabase.

---

## 3) Where it is in code (for non-coders too)

- Permission screen: `app/location-gate.tsx`
- Tracker start point: `app/_layout.tsx`
- Tracker logic: `hooks/useLocationTracker.ts`
- API call that saves points: `lib/api.ts` -> `trackLocation(...)`
- Database table: `location_points`

You do not need to edit code to test. This is just for reference.

---

## 4) Exactly how auto tracking works

Current behavior:

1. Tracking runs only on **Android/iOS** (not on web).
2. Tracker starts when user is logged in.
3. Sends one location immediately.
4. Then sends again every **3 minutes**.
5. Tracker runs as a background service after permission is granted.
6. It can continue even if app is minimized or closed (phone battery rules may still limit it on some devices).

---

## 5) Beginner testing steps (real phone)

Use a physical phone (not simulator if possible).

1. Install app build.
2. Login.
3. When location popup appears, tap **Allow while using app**.
4. Keep app open for at least 4-5 minutes.
5. Move a little (optional but useful).
6. Check Supabase table `location_points`.
7. You should see rows with:
   - `employee_id`
   - `latitude`
   - `longitude`
   - `recorded_at`

If you see rows, tracking is working.

---

## 6) Attendance location test

1. Go to Attendance tab.
2. Tap **Check In**.
3. Tap **Check Out** later.
4. Verify attendance row has check-in/check-out coordinates.

This is separate from periodic tracker. Both can work together.

---

## 7) If tracking is not working (easy checklist)

Check in this exact order:

1. Phone location service is ON.
2. App permission is allowed:
   - Android: "Allow only while using the app"
   - iPhone: "While Using the App"
3. User is logged in.
4. App is running on mobile app, not web browser.
5. Internet is available.
6. Supabase URL/key are correct in env.
7. Confirm inserts in `location_points` are not blocked by policies.

---

## 8) Quick troubleshooting actions

If blocked at permission screen:

1. Open phone Settings.
2. Open app permissions.
3. Enable Location.
4. Return to app.

If still no rows in DB:

1. Logout and login again.
2. Keep app open 5 minutes.
3. Check Supabase table again.
4. Check mobile logs for API errors.

---

## 9) Privacy and policy (important for stores)

Because app tracks location:

1. Add clear privacy policy on website.
2. Explain:
   - what is collected (lat/lng/time),
   - why (attendance + field tracking),
   - retention/deletion policy.
3. In Play Store and App Store forms, declare location data usage correctly.

If this is missing, store review may reject the app.

---

## 10) One-line summary

If user is logged in, permission is granted, and app is on mobile, this app sends GPS points to `location_points` every ~3 minutes.
