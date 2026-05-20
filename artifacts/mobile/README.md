# Neelgund Mobile: Beginner Guide

This app is an Expo + React Native app in `artifacts/mobile`.

It is already wired to Supabase project `neelgund`:

- URL: `https://ncngotyfdeqrziydrsvp.supabase.co`
- Android package: `com.neelgund.employeemonitor`
- iOS bundle id: `com.neelgund.employeemonitor`

---

## 1) First-time setup (local)

From repo root:

```bash
pnpm install
```

From `artifacts/mobile`:

```bash
pnpm dev
```

If app says Supabase env missing, ensure `.env` exists in `artifacts/mobile` with:

```env
EXPO_PUBLIC_SUPABASE_URL=https://ncngotyfdeqrziydrsvp.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

For map tile reliability (Android/iOS native maps), also set:

```env
EXPO_PUBLIC_OSM_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
EXPO_PUBLIC_OSM_TILE_FALLBACKS=https://a.tile.openstreetmap.org/{z}/{x}/{y}.png,https://b.tile.openstreetmap.org/{z}/{x}/{y}.png
```

If the primary tile source fails, app now auto-switches to fallback providers.

---

## 2) Build and push to Play Store (Android)

### Prerequisites

1. Google Play Console account.
2. App created in Play Console with package name `com.neelgund.employeemonitor`.
3. Install tools:

```bash
npm i -g eas-cli
```

4. Login to Expo:

```bash
eas login
```

### Build AAB (production)

Run from `artifacts/mobile`:

```bash
eas build -p android --profile production
```

This generates an `.aab` file for Play Store.

### Submit to Play Console

Option A (manual, beginner-friendly):
1. Download the `.aab` from EAS build page.
2. In Play Console -> your app -> Production (or Internal testing) -> Create release.
3. Upload `.aab`, add release notes, review and roll out.

Option B (EAS submit):

```bash
eas submit -p android --profile production
```

---

## 3) Build and push to App Store (iOS)

### Prerequisites

1. Apple Developer account (paid).
2. App created in App Store Connect with bundle id `com.neelgund.employeemonitor`.
3. Install and login EAS CLI:

```bash
npm i -g eas-cli
eas login
```

### Build IPA (production)

From `artifacts/mobile`:

```bash
eas build -p ios --profile production
```

EAS will guide you through certificates/provisioning if first time.

### Submit to App Store Connect

Manual route (recommended first time):
1. Download IPA or use Transporter/TestFlight flow from EAS link.
2. Open App Store Connect -> your app -> TestFlight / App Store.
3. Complete app metadata (privacy, screenshots, description, category).
4. Submit for review.

Automated route:

```bash
eas submit -p ios --profile production
```

---

## 4) Location tracking in this app (extreme beginner)

Think of location in this app as **3 separate features**:

1. **Permission gate before app use**
   - File: `app/location-gate.tsx`
   - User must allow location. If denied, app blocks progress and asks to open settings.

2. **Attendance check-in/out GPS capture**
   - File: `app/(tabs)/attendance.tsx`
   - On check-in/check-out, app asks foreground location permission and stores coordinates with attendance.

3. **Automatic periodic tracking while logged in**
   - Files:
     - `app/_layout.tsx` (starts tracker after login)
     - `hooks/useLocationTracker.ts` (tracker logic)
   - Behavior:
     - Works on native apps (Android/iOS), not web.
     - Sends one location immediately after tracker starts.
     - Then sends location approximately every 3 minutes.
     - Runs as a background location service after login when permission is granted.
     - Can continue even when app is minimized/closed (subject to OS battery restrictions).
     - If network is temporarily unavailable, points are queued locally and retried automatically when app becomes active again.
     - If location permission is revoked while logged in, tracking service is stopped and status changes to denied/stopped.

### Where location data is stored

- Supabase table: `location_points`
- Write API call: `trackLocation(...)` in `lib/api.ts`

### Why users may not be tracked

1. Location permission denied on phone.
2. User is on web build (tracker skips web).
3. User is logged out.
4. Phone location services are OFF.
5. Device stays offline for a long period (queued points are best-effort with bounded local buffer).

### Quick test checklist

1. Login on physical Android/iPhone.
2. Allow location when prompted.
3. Keep app open for 4-5 minutes.
4. Verify rows appear in Supabase `location_points`.
5. Check map/team views update.
6. Turn off internet for 2-3 minutes, move a bit, turn internet back on, bring app to foreground, verify queued points flush.
7. Test around midnight local time and verify points appear under the correct selected date in trail views.

---

## 5) Common release gotchas

1. Increment version before production release:
   - `expo.version` in `app.json`
   - `expo.android.versionCode` in `app.json` (must always increase)
2. Confirm package/bundle identifiers never change after publishing.
3. Fill store listing assets (icon, screenshots, privacy policy URL) before final submission.
4. Test with internal track/TestFlight first, then publish to public.
5. For production maps, avoid relying only on the public OSM endpoint. Use a dedicated tile provider or self-hosted tiles to reduce blank map incidents.

---

## 6) Production/local reliability runbook

Use this sequence whenever something breaks after deploy or on a fresh setup.

### A) Supabase schema + functions must be in sync first

From repo root:

```bash
supabase migration list
```

Verify all required migrations are applied, especially:
- `0001_option_b_full_backend.sql`
- `0009_tracking_status_table.sql`
- `0010_attendance_employee_date_unique.sql`

Then verify edge functions:

```bash
supabase functions list
```

`admin-users` must exist and be active. If missing, deploy:

```bash
supabase functions deploy admin-users --project-ref ncngotyfdeqrziydrsvp
```

If function returns unauthorized/500, verify project secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### B) Quick health checks (Supabase)

1. Login works (`/auth/v1/token?grant_type=password` -> 200)
2. Profile fetch works (`/rest/v1/profiles?...` -> 200)
3. Admin user create works (`/functions/v1/admin-users` -> 200)
4. Storage upload works (`/storage/v1/object/documents/...` -> 200)

When debugging, fetch recent logs by service:
- `api`
- `edge-function`
- `auth`
- `storage`

### C) Vercel deploy checks

Deploy:

```bash
vercel --prod --yes
```

Check latest status:

```bash
vercel ls
```

If there are recent `Error` deploys, inspect failing deployment logs before retrying.

### D) EAS APK build checks

Build latest installable APK:

```bash
eas build -p android --profile preview --no-wait
```

Check build statuses:

```bash
eas build:list --platform android --limit 5
```

If current build is `canceled`/`errored`, install the latest `finished` APK only.

### E) Final smoke test before sharing build

1. Login as admin.
2. Create a user from Admin panel.
3. Upload a document and open it.
4. Open Map tab and verify no crash.
5. Check attendance check-in/out once.
