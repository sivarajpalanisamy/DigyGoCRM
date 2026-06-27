# DigyGo Dialer — Callyzer-style Mobile Call App + CRM Integration

## Context

DigyGo CRM customers (field/tele-sales teams) need a mobile app — modeled on
[callyzer.co](https://callyzer.co/) — that their staff use to call leads (incoming + outgoing).
After every call the app sends the **phone number, call metadata, and recording** to the CRM, where it
attaches to the matching lead and surfaces on that client's dashboard. The goal is a **full Callyzer
clone**: in-app dialer + automatic call logging + recording sync + lead management + follow-ups +
dispositions + team performance.

**The CRM already has most of the server side built** for a different call source (Superfone PBX):
a `call_logs` table, a read-only calls dashboard/API, recording storage + streaming, phone→lead
matching, `call_answered`/`call_missed` workflow triggers, and Socket.io live updates. The mobile app
becomes a **new authenticated call source** that mirrors the existing Superfone ingest pattern, so the
backend work is mostly additive and reuses proven code.

---

## ⚠️ Critical technical constraint — read first

**Android 10+ blocks any third-party app (even the default dialer) from recording the call's voice
channel** at the OS level. This is why real Callyzer's recording "works on some phones, not others" — it
depends on the **device's built-in OEM recorder** (Samsung/Xiaomi/Oppo/etc.). There is **no** universal,
Play-Store-compliant way for our app to record every call.

Consequences baked into this plan:
- **Android only.** iOS forbids call-log and recording access entirely — an iOS build of this product is
  not possible. (A separate VoIP product could run on iOS, but that was explicitly not chosen.)
- **Call *logging* is 100% reliable** via an in-app dialer (`InCallService`) / call-log read.
- **Call *recording* is best-effort with a two-tier strategy**, documented per device:
  1. In-app dialer attempts `MediaRecorder` with the `VOICE_CALL`/`VOICE_COMMUNICATION` audio source —
     works on a subset of devices/Android builds.
  2. **Fallback:** harvest the OEM recorder's saved files (scan known recording folders, match by
     timestamp + number) — the actual Callyzer mechanism.
- Distribute via **direct APK / MDM / enterprise**, not necessarily the public Play Store (Google
  restricts the Accessibility API for call recording). This avoids policy friction but does **not** lift
  the OS audio restriction.

This must be set with the customer as a known limitation, not a bug.

---

## Architecture overview

```
┌─────────────────────────────┐        Bearer <deviceToken>         ┌──────────────────────────┐
│  Flutter Android app         │  ───────────────────────────────▶  │  Express backend          │
│  - InCallService dialer (Kotlin platform channel)                  │  /api/mobile/* (device   │
│  - Call-log + recording capture                                    │     token auth)          │
│  - Offline queue (sqflite) → sync engine                           │  /api/devices/* (owner   │
│  - Lead list / follow-ups / dispositions / agent stats             │     JWT auth)            │
└─────────────────────────────┘                                     └─────────┬────────────────┘
        ▲ device pairing code                                                  │ reuse existing
        │ (entered once)                                                       ▼
┌─────────────────────────────┐                                     call_logs · leads · lead_activities
│  CRM web (owner)             │  generates pairing code,            triggerWorkflows · emitToTenant
│  Settings → Devices          │  lists/revokes devices              recordings on disk (RECORDINGS_DIR)
└─────────────────────────────┘
```

Auth model (chosen): **device pairing code → long-lived device token**. Owner generates a one-time code
in the CRM; staff enters it on the phone; the device binds to that staff user and receives a long-lived
token (no 15-minute logout). All call/recording posts are attributed to the bound user.

---

## Part A — Backend changes (Node/Express/Postgres)

All paths under `backend/`. Highest migration on disk is `migration_094_login_pin.sql` → new migrations
start at **095**.

### A1. New migration `src/db/migration_095_mobile_devices.sql`
- `mobile_devices` — `id, tenant_id, user_id, device_label, device_token_hash, device_token_prefix(16),
  platform, app_version, push_token, last_seen_at, revoked, created_at`. Unique index on
  `device_token_prefix`. Store **bcrypt hash + 16-char prefix only** (reuse the refresh-token model in
  `auth.ts:102-105,196-208`).
- `device_pairing_codes` — `id, tenant_id, user_id, code_hash, code_prefix(8), created_by, expires_at
  (now()+15min), used, used_at, created_at`. Partial index on `code_prefix WHERE used=FALSE`.
- Extend `call_logs`: `ADD COLUMN disposition VARCHAR(80)`, `notes TEXT`, `source VARCHAR(20) DEFAULT
  'superfone'`, `device_id UUID REFERENCES mobile_devices`, `client_call_id VARCHAR(80)`. Drop
  `cdr_id NOT NULL` (mobile rows have no carrier CDR), add partial unique index
  `(tenant_id, client_call_id) WHERE client_call_id IS NOT NULL` for offline-safe dedup.
- Migration gotcha (CLAUDE.md): never put `;` inside a `--` comment — the splitter in `db/migrate.ts`
  breaks on it.

### A2. New permission keys `devices:view` / `devices:manage`
Follow CLAUDE.md convention: add to `FULL_PERMISSIONS` + `CUSTOM_DEFAULT_PERMISSIONS` (`routes/settings.ts`,
default `false`), guard the owner routes, add to `PERM_GROUPS` in `frontend/src/pages/StaffPage.tsx`, and
ship idempotent backfill `migration_096_devices_perm_backfill.sql`
(`UPDATE user_permissions SET permissions = permissions || '{"devices:view":false,"devices:manage":false}'::jsonb
WHERE NOT (permissions ? 'devices:manage')` — mirrors migrations 087–092).

### A3. Device-auth middleware `src/middleware/deviceAuth.ts`
Mirror `requireAuth` (`middleware/auth.ts:72-103`): read `Bearer` token → `prefix=token[:16]` → single
JOIN lookup `mobile_devices ⋈ users ⋈ tenants`; reject if missing/`revoked`/inactive user/inactive
tenant; `bcrypt.compare`; fire-and-forget `last_seen_at`/`app_version` update; set
`req.user = {userId, tenantId, role, plan}` (identical shape to JWT payload, so `hasPermission`,
`emitToTenant`, `triggerWorkflows`, and all SQL helpers work unchanged) plus `req.deviceId`.

### A4. Owner routes `src/routes/devices.ts` (mounted `/api/devices`, JWT `requireAuth`+`requireTenant`)
- `POST /pairing-code` (`checkPermission('devices:manage')`) — body `{ userId, deviceLabel? }`; validate
  user in tenant; generate 6-digit/hex code (`crypto.randomInt`, reuse `generateOtp` style), store
  `bcrypt` hash + prefix + 15-min expiry; return `{ code, expiresAt }` shown **once**.
- `GET /` (`devices:view`) — list bound devices JOIN users, `WHERE d.tenant_id=$1::uuid`.
- `DELETE /:id` (`devices:manage`) — `UPDATE mobile_devices SET revoked=TRUE …`; instant kill because
  `deviceAuth` re-checks `revoked` every request (no cache).

### A5. Mobile routes `src/routes/mobile.ts` (mounted `/api/mobile`)
`POST /pair` is **public** (no device auth); everything else uses `router.use(requireDevice)`. Add a
pair-endpoint rate limiter mirroring `authLimiter` (`index.ts:173-179`).

- **`POST /pair`** `{ code, deviceLabel?, platform?, appVersion? }` → prefix-lookup + `bcrypt.compare` +
  **atomic** `UPDATE … SET used=TRUE WHERE id=$1 AND used=FALSE RETURNING id` (race-safe, same pattern as
  refresh rotation `auth.ts:369-426`), then INSERT `mobile_devices` with a fresh
  `crypto.randomBytes(40)` token. Return `{ deviceToken, user, tenant, permissions }` (perms via the
  `/me/permissions` query `auth.ts:457-463`) so the app can gate its own UI.
- **`POST /calls`** — single object **or array** (offline batch, cap ~200). Reuse the Superfone insert
  block (`webhooks.ts:386-481`) with `tenantId`/`staffUserId` from `req.user`; lead match via
  `normalizePhone()` (`utils/phone.ts:6`) exact match (improve on Superfone's raw match); insert with new
  columns; `ON CONFLICT (tenant_id, client_call_id) DO NOTHING RETURNING id, lead_id`. After insert (skip
  on duplicate): `emitToTenant('call:logged', …)` with the **exact field set** from `webhooks.ts:439-449`
  (so the existing web listener works), `triggerWorkflows('call_answered'|'call_missed', …)`
  (`webhooks.ts:466-480`), `sendCallLoggedNotification` (`utils/notifications.ts:252`), and a **new**
  `lead_activities` row `type='call'` (mirror `leads.ts:449` / `tags.ts:102`) when `lead_id` is set.
  Return `{ inserted, duplicates, results:[{clientCallId, id|null, status}] }`; one bad row ⇒
  `status:'error'`, never fails the batch.
- **`POST /calls/:callId/recording`** — multer `memoryStorage`, **50 MB** limit (reuse
  `conversations.ts:22-23,349-378`). Verify call belongs to tenant; write to
  `RECORDINGS_DIR/{tenantId}/{callId}{ext}` using the exact convention in
  `recordingDownloader.ts:54-62` (ext from mimetype: wav/m4a/mp3); set `recording_path` +
  `recording_downloaded=TRUE`. Existing `GET /api/calls/:callId/recording` Range-streams from that same
  path — extend its content-type map (`calls.ts:221`) to add `.m4a`/`.aac`. (If long calls common, switch
  to disk streaming to avoid buffering 50 MB.)
- **`PATCH /calls/:callId`** `{ disposition?, notes? }` — device auth + ownership.
- **Thin mobile reads** that reuse existing handler SQL/scoping but behind device auth (recommended over a
  `requireAuthOrDevice` combinator that would touch many routers):
  `GET /leads`, `/leads/:id`, `POST/PATCH /leads`, `GET /leads/:id/timeline`, `GET /followups`,
  follow-up CRUD, `GET /tags`, `GET /calls`, `GET /agents`. **Every** lead/call/followup read must apply
  the two-layer `leads:only_assigned` / owner / `view_all` scoping and `AND is_deleted=FALSE`.

### A6. New mobile-only endpoints (no existing equivalent)
- **`GET /api/mobile/me/stats?date_from&date_to`** — agent home screen: total / connected / missed /
  talk-time / unique-leads over `call_logs WHERE tenant_id=$1::uuid AND staff_user_id=$2::uuid`.
- **`GET /api/mobile/team/stats`** (`calls:view_all`) — per-agent leaderboard.
- **Push (FCM)** — no push infra exists today (only Socket.io + `notifications` table). Add `push_token`
  to `mobile_devices`, `POST /api/mobile/push-token`, and an FCM sender (mirror `utils/notifications.ts`)
  fired on follow-up due reminders and `call_missed`.

### A7. Wire-up `src/index.ts`
Mount after the existing `app.use('/api/...')` list: `app.use('/api/devices', devicesRoutes)` and
`app.use('/api/mobile', mobileRoutes)`. `/api/mobile/*` must **not** sit under the global `requireTenant`
(it sets its own auth). Confirm CORS allows no-origin requests (it already does — `index.ts:107`) and the
JSON/body limits suit batch posts.

### Backend reuse anchors (do not re-invent)
`auth.ts:102-105,196-208,369-426` (token hash/prefix + atomic rotation) · `middleware/auth.ts:72-103`
(auth middleware to mirror) · `webhooks.ts:344-486` (Superfone ingest block to clone) ·
`conversations.ts:22-23,349-378` (multer upload) · `recordingDownloader.ts:54-62` + `calls.ts:147-244`
(recording path + Range streaming) · `leads.ts:449`, `tags.ts:102` (lead_activities insert) ·
`utils/phone.ts:6` (`normalizePhone`) · `migration_087..092` (idempotent perm backfill precedent).

---

## Part B — Flutter Android app (greenfield)

New folder `mobile/` (Flutter 3.x, Dart). Android-only `minSdk 24+`. State: Riverpod (or Bloc).
HTTP: `dio`. Local DB/queue: `sqflite`. Secure token store: `flutter_secure_storage` (Android Keystore).

### Dev environment (verified ready on this machine — 2026-06-13)
`flutter doctor` is green for Android: Flutter 3.38.5, Dart 3.10.4, Java 21 (Temurin), Android SDK 36.1.0
(licenses accepted), Android Studio + emulator. The only ❌ is Visual Studio C++ — irrelevant (Android-only).
**Nothing to install to build.** Caveat for *this* app: the emulator has no telephony radio and cannot make
real calls or record — all call features (`InCallService`, default-dialer role, call-log/recording capture)
**must be tested on a physical Android phone (Android 10+) with USB debugging**. The emulator is fine for
non-call UI (pairing, onboarding, lead lists, stats).

### Branding / logo
Source logos live in repo `logo/`. Use:
- **`logo/2.png`** (square "DigyGo CRM" mark, orange paper-plane on white) → **Android launcher icon** +
  adaptive icon, generated via `flutter_launcher_icons`.
- **`logo/DigyGo Logo (1).png`** (horizontal wordmark) → **splash screen** (`flutter_native_splash`) and the
  pairing/onboarding header.
- Brand colours match the CRM: primary `#c2410c`, accent `#ea580c`/`#f97316`, on white. App theme seeds from
  `#ea580c`.

### B1. Native layer (Kotlin platform channels / plugin)
The dialer + call/recording capture cannot be pure Dart — implement a Kotlin module exposed via
`MethodChannel`/`EventChannel`:
- **In-app dialer:** `InCallService` + `ConnectionService` + `Call.Callback` (and optional
  `CallScreeningService` for block-list), request the **default-dialer role** (`RoleManager.ROLE_DIALER`).
  Full custom in-call UI driven by native call-state events — see **B2b** for the complete dialer feature
  spec (recents/contacts/keypad tabs, incoming/outgoing/in-call/conference screens, caller-ID overlay,
  DTMF/mute/speaker/Bluetooth routing, emergency-call bypass, post-call disposition).
- **Call detection & logging:** `BroadcastReceiver` for phone state + read `CallLog.Calls` (number,
  type=incoming/outgoing/missed/rejected, duration, timestamps). 100% reliable.
- **Recording (best-effort, two-tier per the constraint above):** attempt `MediaRecorder`
  (`VOICE_CALL`); fallback to scanning OEM recording dirs and matching the file by time+number.
- **Reliability:** foreground `Service` + `WorkManager` for background/boot-persistent capture and retry.
- **Permissions:** `CALL_PHONE`, `READ_PHONE_STATE`, `READ_PHONE_NUMBERS`, `READ_CALL_LOG`,
  `READ_CONTACTS` (+ `WRITE_CONTACTS` if lead→contact sync), `RECORD_AUDIO`,
  `READ_MEDIA_AUDIO` (Android 13+) / `READ_EXTERNAL_STORAGE` (≤12, scoped), `POST_NOTIFICATIONS`
  (Android 13+), `FOREGROUND_SERVICE`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, plus the default-dialer
  **role** (`RoleManager.ROLE_DIALER`). All gathered through the blocking onboarding gate (B2a), which
  explains each before prompting and forces grant before app access.

### B2a. App startup & permission-gate flow (mandatory, Callyzer-style)

Exactly like Callyzer: on first launch the app walks the user through a **blocking onboarding gate**. Each
step must be satisfied before "Next/Continue" unlocks — the user **cannot skip into the app** until every
required permission and role is granted. The app re-checks this gate on **every cold start** and routes
back to the first unsatisfied step (so if a user later revokes a permission in Android Settings, they are
forced back through the gate before any call feature works).

```
App launch
   │
   ▼
[Gate check] ── all satisfied? ──▶ Home dashboard
   │ no
   ▼
Step 0 · Welcome / value + "what we'll ask for and why" (one screen, transparency before prompts)
   ▼
Step 1 · Pair device
        - Enter 6-digit pairing code  → POST /api/mobile/pair
        - On success: store device token (flutter_secure_storage), show bound staff name + tenant
        - Blocked until a valid token is stored
   ▼
Step 2 · Runtime permissions (each its own card with rationale + "Grant" button; Next stays disabled
         until granted; "Why we need this" expander on each)
        2.1 Phone / Call  → CALL_PHONE, READ_PHONE_STATE, READ_PHONE_NUMBERS   (place + detect calls)
        2.2 Call log      → READ_CALL_LOG                                       (auto-log every call)
        2.3 Contacts      → READ_CONTACTS (+ WRITE_CONTACTS if syncing leads→contacts)
        2.4 Microphone    → RECORD_AUDIO                                        (recording attempt)
        2.5 Storage/media → READ_MEDIA_AUDIO (Android 13+) / READ_EXTERNAL_STORAGE (≤12, scoped)
                                                                                (harvest OEM recordings)
        2.6 Notifications → POST_NOTIFICATIONS (Android 13+)                    (follow-up + sync alerts)
   ▼
Step 3 · Set as default dialer (special role, not a runtime permission)
        - RoleManager.ROLE_DIALER request → system dialog
        - Blocked until app holds the role (re-query isRoleHeld on resume)
   ▼
Step 4 · Battery optimisation exemption (recommended, esp. Xiaomi/Oppo/Vivo)
        - REQUEST_IGNORE_BATTERY_OPTIMIZATIONS + deep-link to OEM autostart settings
        - Soft gate: strongly nudged, "Skip for now" allowed but warns reliability will suffer
   ▼
Step 5 · Recording capability self-test (optional, informational)
        - Probe MediaRecorder(VOICE_CALL); detect known OEM recorder folders
        - Show the user their device's recording tier (in-app / OEM-fallback / unsupported) honestly
   ▼
Gate passed → Home dashboard
```

**Implementation notes**
- **Gate logic lives in a single `OnboardingGate` controller** (Riverpod) that exposes a list of steps,
  each with `isSatisfied()` (queries native via `MethodChannel`) and an `request()` action. The router
  redirects to the gate whenever any required step is unsatisfied — checked on app resume, not just first
  run, so revoking a permission in OS Settings sends the user back automatically.
- **Required vs soft:** Steps 1–3 + permissions 2.1, 2.2 are **hard-required** (no app access without
  them). 2.3–2.6, Step 4, Step 5 are **strongly recommended** but may allow "Continue with limited
  features" so the app still logs calls if a user denies, e.g., recording — matching Callyzer's graceful
  degradation rather than a hard wall on every single item. (Confirm with product which items are truly
  mandatory; default above marks call placement + call-log as the non-negotiable core.)
- **Android version branching:** request the storage/media + notification permissions conditionally by
  `Build.VERSION.SDK_INT` (scoped media on 13+, legacy storage on ≤12, runtime notifications only 13+).
- **"Permanently denied" handling:** if a runtime permission is denied-with-"don't ask again", the card
  switches its button to **"Open Settings"** (`openAppSettings`) instead of re-prompting, with copy
  explaining the manual grant — Android won't show the system dialog again.
- **Re-entrancy:** because `deviceAuth` re-checks `revoked` server-side, a revoked device returns 401 →
  app clears the token and drops the user back to Step 1 (re-pair) automatically.

### B2b. Dialer spec — a complete phone replacement (default-dialer app)

Because the app **takes over the default-dialer role**, it must behave like a full phone dialer — Android
routes *all* calls (incoming and outgoing, from anywhere) through our `InCallService`, so a half-built
dialer would break the user's phone. The dialer therefore implements the complete surface a stock dialer
has, plus CRM lead context. Native call control lives in Kotlin (`InCallService` + `ConnectionService` +
`Call.Callback`); the UI is Flutter driven by `EventChannel` call-state streams.

**Bottom-tab layout (stock-dialer parity):**
1. **Recents** — unified call history (incoming/outgoing/missed/rejected) with type icons, time, duration,
   per-number grouping with count (e.g. "Ravi (3)"); tap a row → call detail (all calls with that number,
   lead link, disposition, recording playback); swipe/long-press → call / message / lead / block.
2. **Contacts** — device contacts (`READ_CONTACTS`) **merged with CRM leads** (from `GET /leads`),
   alphabetical with fast-scroll index, search; each entry shows whether it's a known lead (badge + stage).
3. **Keypad (dialpad)** — large T9 keypad with DTMF tone playback, long-press 0 = "+", paste, backspace;
   **live T9 search** over contacts + leads as digits are typed; "Add to contacts / Create lead" when the
   number is unknown; the green call button places the call.
4. **Favorites / Speed-dial** (optional, stock parity) — pinned frequent contacts/leads.

**Call screens (full `InCallService` lifecycle):**
- **Incoming call (full-screen):** ringer + full-screen intent (works over lockscreen), **caller ID
  overlay** — resolve the number against CRM leads/contacts and show name + stage + last disposition so the
  agent knows who's calling before answering; Accept / Decline / **Decline-with-SMS** (quick replies).
- **Outgoing / dialing:** shows callee name (lead-matched), call state (dialing → ringing → active).
- **In-call (active) controls:** mute, speaker (+ Bluetooth/headset audio-route picker), hold, keypad
  (send DTMF), **add call / merge → conference**, swap calls, live duration timer, and **End**. All wired
  to `Call.hold()/unhold()/playDtmfTone()/disconnect()` and `CallAudioState`.
- **Call waiting / multi-call:** second incoming call while on a call — show both, swap/merge/end-and-answer.
- **Post-call screen (disposition prompt):** immediately after disconnect, prompt disposition + notes →
  `PATCH /api/mobile/calls/:id` (see B2 flow), with the call already auto-logged and queued for sync.

**Behaviours a real dialer must not get wrong:**
- **Emergency calls** (112/911/100/etc.) must always connect — never gate behind onboarding, pairing, or
  permission state; detect emergency numbers and bypass all app logic.
- **Number formatting** via `libphonenumber` (display + E.164 normalisation, matching backend
  `normalizePhone()` so lead-matching is consistent).
- **DTMF, mute, speaker, Bluetooth routing** must actually work (it's now the user's only dialer).
- **Missed-call notifications** with one-tap call-back and "log/lead" deep-link.
- **Block list** (optional) — reject blocked numbers via `CallScreeningService`.
- **Graceful default-dialer loss:** if the user revokes the default-dialer role, the onboarding gate (B2a,
  Step 3) catches it on resume and re-requests; in-app calling is disabled until restored.

> Scope note: this is the **default-dialer** path (full control, best logging + in-app UI, required for the
> Callyzer-parity experience). The fallback "not-default-dialer" mode (place calls via `ACTION_CALL`, only
> *read* `CallLog.Calls` after the fact, no custom in-call UI) is a degraded path — useful if a user won't
> grant the dialer role, but recording/in-call features are lost. Default to requiring the dialer role.

### B2. App features (full Callyzer clone)
- **Onboarding/pairing:** the blocking permission-gate flow above (B2a) — pair code → runtime permissions
  → default-dialer role → battery exemption → recording self-test, re-checked on every cold start.
- **Dialer & call screen:** keypad, contact/lead search, click-to-call from a lead, native in-call UI.
- **Auto call log + recording capture:** every call queued locally then synced (see B3).
- **Disposition prompt:** after each call, prompt for disposition + notes → `PATCH /api/mobile/calls/:id`.
- **Leads:** list (search/filter, only-assigned aware), detail with timeline, create/edit, click-to-call.
- **Follow-ups/reminders:** list of due follow-ups, create/complete, **local + push notifications**.
- **Call history:** per-agent list with playback (stream from CRM), filters, disposition display.
- **Home dashboard:** agent stats from `GET /api/mobile/me/stats`; managers see `team/stats`.
- **Offline-first:** works without network; queues and reconciles.

### B3. Sync engine
- Local `sqflite` outbox: pending calls (with `clientCallId` UUID) + pending recordings.
- Background worker drains outbox: `POST /api/mobile/calls` (batch) → on success upload each recording to
  `/calls/:id/recording` → mark synced. Idempotent via `clientCallId` (server dedups), so retries are
  safe. Exponential backoff; surface a sync-status indicator.

---

## Part C — CRM web frontend (small additions)

`frontend/src/pages/`:
- **Settings → Devices** (new tab/section): "Generate pairing code" (pick staff user) showing the code +
  countdown; table of bound devices (staff, label, last seen) with **Revoke**. Gated by
  `devices:view`/`devices:manage`.
- **StaffPage `PERM_GROUPS`:** add the two new device permission keys.
- **CallsPage:** show the new `disposition`/`notes` columns; everything else (list, recording playback,
  `call:logged` socket updates) already works since mobile calls land in the same `call_logs`.

---

## Execution — first milestone (start here)

Goal of the first build pass: **a phone can pair to the CRM and the onboarding gate runs end-to-end.**
This is the smallest slice that proves the architecture and is demoable.

1. **Backend foundation (Phase 1)** — migrations 095/096, `deviceAuth.ts`, `routes/devices.ts`,
   `routes/mobile.ts` (`POST /pair` + `POST /calls` + recording upload + `PATCH`), wire-up in `index.ts`,
   permission keys. Finish with `npx tsc --noEmit` clean and a curl smoke test (pairing-code → pair →
   token → post a call → row in `call_logs`).
2. **Flutter scaffold (`mobile/`)** — `flutter create`, brand theme (`#ea580c`), launcher icon from
   `logo/2.png` (`flutter_launcher_icons`), splash from `logo/DigyGo Logo (1).png`
   (`flutter_native_splash`), dependencies (`dio`, `riverpod`, `sqflite`, `flutter_secure_storage`,
   `permission_handler`), Android manifest with the B1 permissions.
3. **Pairing + onboarding gate (B2a)** — pairing-code screen → `POST /api/mobile/pair` → store token; the
   blocking permission-gate wizard (runtime permissions + default-dialer role request); land on a
   placeholder Home once the gate passes.

After this milestone: native dialer (B2b), call-log capture + sync (B3), recording, then full clone — per
the phased roadmap below.

## Delivery roadmap (phased)

1. **Phase 1 — Backend foundation:** migrations 095/096, `deviceAuth.ts`, `routes/devices.ts`,
   `routes/mobile.ts` (pair + `POST /calls` + recording upload + `PATCH`), wire-up, permission keys.
   *Shippable & testable via curl before any Flutter code exists.*
2. **Phase 2 — CRM web:** Settings → Devices UI, CallsPage disposition columns.
3. **Phase 3 — Flutter MVP:** pairing, permissions, in-app dialer, auto call-log capture, offline sync of
   call metadata (recording optional), agent home stats. *Core value: calls appear on the dashboard.*
4. **Phase 4 — Recording:** two-tier capture + upload; document device support matrix.
5. **Phase 5 — Full clone:** leads, follow-ups/reminders, dispositions UX, team stats, FCM push.

---

## Verification

- **Backend (no app needed):**
  - Run migrations: `npx ts-node src/db/migrate.ts`; confirm `mobile_devices` + new `call_logs` columns
    exist (psql `\d call_logs`).
  - Owner flow: login as `saral@demo.com`/`demo123` → `POST /api/devices/pairing-code` → get code.
  - Pair: `POST /api/mobile/pair {code}` → receive `deviceToken`.
  - Ingest: `POST /api/mobile/calls` with `Bearer <deviceToken>` and a payload whose `phone` matches a
    seeded lead → assert: row in `call_logs` (correct `staff_user_id`, `lead_id`), a `lead_activities`
    `type='call'` row, a `call:logged` socket emit, and `call_answered` workflow fires (mirror the
    WABA proof harness — drive `triggerWorkflows` and read `workflow_execution_logs`).
  - Recording: `POST …/:callId/recording` with an audio file → file on disk at
    `RECORDINGS_DIR/{tenantId}/{callId}.*`, `recording_downloaded=TRUE`, plays via
    `GET /api/calls/:callId/recording`.
  - Negatives: expired/used pairing code → 401; revoked device → 401; cross-tenant `callId` → 404;
    duplicate `clientCallId` → counted as duplicate, not inserted twice.
  - `npx tsc --noEmit` clean in `backend/`.
- **Flutter:** on a physical Android device (emulators lack telephony) — pair, place an outbound call,
  confirm it auto-logs and appears on the CRM dashboard live; verify offline (airplane mode) queues and
  later syncs; verify recording on at least one OEM-recorder device.

---

## Open risks / decisions to revisit
- **Recording coverage** is inherently device-dependent (the core constraint). Agree a target device list.
- **Play Store vs sideload/MDM** distribution — recording/Accessibility policy makes direct distribution
  safer.
- **Number ↔ recording file matching** for the OEM-fallback path is heuristic (time + number); needs
  per-OEM folder tuning.
- **Battery/background reliability** across OEM aggressive task-killers (Xiaomi/Oppo) — foreground service
  + user-guided battery-optimization exemption.
- iOS is out of scope by platform limitation; if cross-platform is later required it must be a different
  (VoIP) product.
