# Meta Setup Guide — WhatsApp Cloud API + Facebook Lead Ads

This guide walks through creating the Meta app(s) DigyGo CRM needs and filling in the
matching `backend/.env` values. It covers **two products**:

1. **WhatsApp Cloud API** — send automated WhatsApp messages to leads (Integrations → WhatsApp).
2. **Facebook Lead Ads** — pull Facebook/Instagram lead-form submissions into the CRM (Lead Generation → Meta Forms).

> **One app or two?** You can host *both* products inside a **single Meta app** (recommended — fewer
> credentials to manage; they share `META_APP_ID` / `META_APP_SECRET`). If you prefer, you can split
> them into two apps, but then the WhatsApp app and the Lead-Ads app each need their own App ID/Secret
> and you'd have to track which secret signs which webhook. **This guide assumes one app, two products.**

> ⚠️ Meta changes this onboarding flow often. Menu names below are a guide as of early 2026 — follow the
> live prompts in the dashboard if something has moved.

---

## ✅ The full checklist — everything you need to do (in order)

Tick these top to bottom. Each step links to the detailed section below. **Phase A + B alone get
WhatsApp automations working; Phase C adds Facebook lead ingestion.** Steps marked _(prod)_ are only
needed to go live for real customers — you can skip them while testing.

### Phase A — One-time shared setup
- [ ] **A1.** Create a **Meta Business account** + **Facebook Developer account** → _[Part 0]_
- [ ] **A2.** Create the **Meta app** (type: Business) → copy **App ID** + **App Secret** into `backend/.env` → _[Part 1]_
- [ ] **A3.** Set a **public HTTPS URL** Meta can reach (`ngrok http 5173` in dev, real domain in prod) →
      put it in `WEBHOOK_BASE_URL` **and** `FRONTEND_URL` in `.env`, and `allowedHosts` in `vite.config.ts` → _[Part 0]_
- [ ] **A4.** Confirm `META_WEBHOOK_VERIFY_TOKEN` is set (already is: `d7dde81a60c0867e0866cdb073538ce8`) → _[Part 1]_
- [ ] **A5.** Restart the backend after editing `.env`.

### Phase B — WhatsApp (send messages from automations)
- [ ] **B1.** App → **Add product → WhatsApp** → Meta gives you a free **test number** → _[2.1]_
- [ ] **B2.** Copy **Phone number ID**, **WABA ID**, **token**, number → `.env` (`WABA_*`) → _[2.2]_
- [ ] **B3.** Add up to **5 test recipient numbers** (the test number can only message these) → _[2.2]_
- [ ] **B4.** Restart backend → CRM shows **Connected** under Integrations → WhatsApp → _[2.2]_
- [ ] **B5.** Create a **message template** in WhatsApp Manager → wait for **APPROVED** → _[2.3]_
- [ ] **B6.** **Test it:** build a `lead_created → WhatsApp Message` workflow, pick the template, create a
      lead → message sends. ✅ This is the whole goal working, no approvals needed yet.
- [ ] **B7.** _(prod)_ **Business Verification** → _[2.7]_
- [ ] **B8.** _(prod)_ Add your **real phone number** + set **display name** → _[2.7]_
- [ ] **B9.** _(prod)_ Generate a **permanent System User token** → `WABA_ACCESS_TOKEN` → _[2.4]_
- [ ] **B10.** _(optional)_ Add the **inbound webhook** if you want replies in the Inbox → _[2.5]_
- [ ] **B11.** _(SaaS only)_ Enable **Embedded Signup** so customers self-connect: set `META_CONFIG_ID`,
      become a Tech Provider, pass App Review → _[2.6]_

### Phase C — Facebook Lead Ads (pull lead-form submissions into the CRM)
- [ ] **C1.** App → **Add products → Facebook Login** + **Webhooks** → _[3.1]_
- [ ] **C2.** Add the **OAuth redirect URI** `…/api/integrations/meta/callback` → _[3.2]_
- [ ] **C3.** Configure the **`leadgen` webhook** (callback URL + verify token) → _[3.3]_
- [ ] **C4.** In the CRM: **Lead Generation → Meta Forms → Connect**, finish Facebook login, toggle forms
      **Active**, map fields → _[3.4]_
- [ ] **C5.** **Test it:** submit one of your lead forms → lead appears in the CRM.
- [ ] **C6.** _(prod)_ **App Review** for `leads_retrieval` + pages permissions, and **Business Verification** → _[3.5]_

> **Fastest path to a working demo:** A1–A5 → B1–B6. That's WhatsApp automation firing on new leads with
> zero Meta approvals (test number + approved template). Everything else is hardening for production/SaaS.

---

## Part 0 — Prerequisites

- [ ] A **Meta Business account** — <https://business.facebook.com> (create one if you don't have it).
- [ ] A **Facebook Developer account** — <https://developers.facebook.com>.
- [ ] For **local dev**: a public HTTPS tunnel, because Meta must reach your webhook. Meta will **not**
      call `http://localhost`. Use ngrok:
      ```bash
      ngrok http 5173
      ```
      Copy the `https://<random>.ngrok-free.app` URL — this becomes `WEBHOOK_BASE_URL` and `FRONTEND_URL`
      in `backend/.env`, and `allowedHosts` in `frontend/vite.config.ts`.
- [ ] For **production**: your real domain over HTTPS (e.g. `https://app.yourdomain.com`).

---

## Part 1 — Create the Meta App (shared by both products)

1. Go to <https://developers.facebook.com/apps> → **Create App**.
2. App type: **Business**.
3. Name it (e.g. "DigyGo CRM"), attach it to your Meta Business account.
4. Once created, open **App settings → Basic** and copy:
   - **App ID**            → `META_APP_ID`
   - **App Secret**        → `META_APP_SECRET`  (click *Show*)
5. Paste both into `backend/.env`.

```env
META_APP_ID=<your-app-id>
META_APP_SECRET=<your-app-secret>
```

Leave `META_WEBHOOK_VERIFY_TOKEN` as the value already in `.env`
(`d7dde81a60c0867e0866cdb073538ce8`) — you'll paste this exact string into Meta's webhook config later.

---

## Part 2 — WhatsApp Cloud API

Goal: fill `WABA_PHONE_NUMBER_ID`, `WABA_ID`, `WABA_ACCESS_TOKEN`, `WABA_PHONE_NUMBER` so the CRM can
send template messages from automations.

### 2.1 Add the WhatsApp product
1. In your app → **Add products** → **WhatsApp** → *Set up*.
2. Link it to your Meta Business account. Meta auto-creates a **WhatsApp Business Account (WABA)** and a
   **free test number**.

### 2.2 Grab test credentials (no approval — for testing today)
On **WhatsApp → API Setup** you'll see:
- **Phone number ID**          → `WABA_PHONE_NUMBER_ID`
- **WhatsApp Business Account ID** → `WABA_ID`
- A temporary **24-hour access token** → `WABA_ACCESS_TOKEN` (fine for first tests; replace with a
  permanent token in 2.4)
- The test "From" number → `WABA_PHONE_NUMBER` (display only)

Add up to **5 recipient test numbers** in the same screen (the test number can only message those).

```env
WABA_PHONE_NUMBER_ID=<phone-number-id>
WABA_ID=<whatsapp-business-account-id>
WABA_ACCESS_TOKEN=<token>
WABA_PHONE_NUMBER=+15550000000
```

> ✅ With these four values set, restart the backend and the CRM shows **Connected** under
> Integrations → WhatsApp (`source: env`), and the automation `WhatsApp Message` action will send.

### 2.3 Create + get a message template approved
Business-initiated messages (messaging a brand-new lead) **require an approved template**.
1. Go to **WhatsApp Manager → Account tools → Message templates → Create template**
   (or **Meta Business Suite**).
2. Category: **Marketing** or **Utility**. Example body:
   ```
   Hi {{1}}, thanks for your interest in {{2}}! Our team will reach out shortly. 🙌
   ```
3. Submit. Approval is usually **minutes to a few hours**.
4. Once **APPROVED**, it appears automatically in the CRM's workflow editor
   (WhatsApp Message action → template dropdown, served by `GET /api/integrations/waba/templates`).

### 2.4 Permanent token (for production)
The 24h token expires. For a stable token tied to *your own* business:
1. **Business settings → Users → System users** → *Add* a system user (role: Admin).
2. **Add assets** → assign your app + WABA to the system user.
3. **Generate new token** → select the app → scopes:
   `whatsapp_business_messaging`, `whatsapp_business_management`.
4. Choose **no expiry** (System User tokens can be permanent). Copy it → `WABA_ACCESS_TOKEN`.

### 2.5 (Optional) WhatsApp inbound webhook
Only needed if you want to **receive** WhatsApp replies in the Inbox (sending doesn't need it).
- In **WhatsApp → Configuration → Webhook**:
  - **Callback URL:** `https://<your-domain-or-ngrok>/api/webhooks/whatsapp`
  - **Verify token:** `d7dde81a60c0867e0866cdb073538ce8`  (your `META_WEBHOOK_VERIFY_TOKEN`)
  - Subscribe to the **`messages`** field.

### 2.6 Embedded Signup (let *customers* self-connect their own number)

This is the multi-tenant path: a business owner using your CRM clicks **Connect with Facebook**
(Integrations → WhatsApp), Meta walks them through selecting/creating their WABA + number in a popup,
and the CRM stores *their* credentials — no token copy-pasting. This is already built end-to-end
(`POST /api/integrations/waba/embedded-signup`); it only needs configuration:

1. **Become a Tech Provider** — Meta Business settings → register your business as a WhatsApp Tech Provider.
2. **Create an Embedded Signup configuration** — App → **WhatsApp → Embedded Signup** → create a config.
   Copy its **Configuration ID** → `META_CONFIG_ID` in `.env`.
3. Ensure `META_APP_ID` + `META_APP_SECRET` are set (Part 1).
4. **App Review / Advanced Access** for `whatsapp_business_messaging` + `whatsapp_business_management`
   so the flow works for businesses other than your app's own testers.
5. Add your domain to **Facebook Login → Allowed Domains** / the app's domain list.

Once `META_APP_ID` + `META_CONFIG_ID` are set, the **Connect with Facebook** button appears
automatically in the CRM (the manual token form stays available as a fallback). Until then the button
is hidden and only the manual form shows.

> The frontend uses the Facebook JS SDK with `config_id`, captures the `WA_EMBEDDED_SIGNUP` session info
> (`waba_id` + `phone_number_id`) plus an auth `code`; the backend exchanges the code for a business
> token, subscribes the app to the customer's WABA, and stores the encrypted token for that tenant.

### 2.7 Going live with WhatsApp
- [ ] **Business Verification** (Business settings → Security Center) — required to message real
      customers beyond the test tier. Takes a few days.
- [ ] Register a **real phone number** (must NOT be active on the WhatsApp / WhatsApp Business *app* —
      remove it there first), set its **display name** (light review).
- [ ] Keep at least one **approved template**.

---

## Part 3 — Facebook Lead Ads

Goal: connect a Facebook Page so lead-form submissions flow into the CRM via OAuth + webhook + a 5-min
poll fallback.

### 3.1 Add the products
In your app → **Add products**:
- **Facebook Login** (for the OAuth connect button), and
- **Webhooks**.

### 3.2 Configure Facebook Login / OAuth redirect
1. **Facebook Login → Settings → Valid OAuth Redirect URIs**, add:
   ```
   https://<your-domain-or-ngrok>/api/integrations/meta/callback
   ```
   (must exactly match `WEBHOOK_BASE_URL` + `/api/integrations/meta/callback`).
2. The CRM requests these scopes (already coded in `integrations.ts`):
   `leads_retrieval, pages_manage_ads, pages_read_engagement, pages_show_list, ads_read,
   ads_management, business_management`.

### 3.3 Configure the Lead Ads webhook
1. **Webhooks → Page** (or via **Lead Ads** product) → *Subscribe to this object*.
2. **Callback URL:** `https://<your-domain-or-ngrok>/api/integrations/meta/webhook`
3. **Verify token:** `d7dde81a60c0867e0866cdb073538ce8`  (your `META_WEBHOOK_VERIFY_TOKEN`)
4. Subscribe to the **`leadgen`** field.

> The CRM verifies the `GET` challenge and validates every `POST` with `X-Hub-Signature-256` using
> `META_APP_SECRET` — so that secret **must** be set or inbound leads are rejected.

### 3.4 Connect a Page in the CRM
1. In the app, set `WEBHOOK_BASE_URL` and `FRONTEND_URL` to your public URL, restart the backend.
2. In the CRM: **Lead Generation → Meta Forms → Connect** → complete the Facebook OAuth.
   - The CRM stores the long-lived token (encrypted) in `meta_integrations`, subscribes your Pages to
     `leadgen`, and syncs your lead forms into `meta_forms`.
3. Toggle each form **Active**, assign a pipeline/stage, and map fields (Map Fields modal).

### 3.5 Going live with Lead Ads
- [ ] **App Review / Advanced Access** for `leads_retrieval` + the pages permissions, so Pages you don't
      own can be connected and the app works outside Dev mode. (In Dev mode it only works for admins/testers
      of the app.)
- [ ] **Business Verification** (same one as WhatsApp).

---

## Part 4 — `backend/.env` summary

```env
# Shared Meta app
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=d7dde81a60c0867e0866cdb073538ce8   # already set — paste this into Meta
META_API_VERSION=v21.0

# Public URL Meta calls back to (ngrok in dev, real domain in prod)
WEBHOOK_BASE_URL=https://<your-domain-or-ngrok>
FRONTEND_URL=https://<your-domain-or-ngrok>

# WhatsApp Cloud API (Part 2)
WABA_PHONE_NUMBER_ID=
WABA_ID=
WABA_ACCESS_TOKEN=
WABA_PHONE_NUMBER=
```

| Webhook | URL (append to your public base) | Field | Used for |
|---|---|---|---|
| Lead Ads     | `/api/integrations/meta/webhook` | `leadgen`  | Facebook/IG lead forms → CRM |
| WhatsApp     | `/api/webhooks/whatsapp`         | `messages` | Inbound WhatsApp → Inbox (optional) |
| OAuth return | `/api/integrations/meta/callback`| —          | Facebook Page connect |

---

## Part 5 — Two business models (what needs approval)

| Use case | What you need | Approval effort |
|---|---|---|
| **Your own number/page** (Social Eagle) | Business Verification + per-template approval. Use a **System User token** pasted into `.env`. | Days |
| **Customers connect their own** (multi-tenant SaaS) | App Review + Advanced Access on the WhatsApp/Pages permissions, **Embedded Signup** (built — see 2.6; needs `META_CONFIG_ID` + Tech Provider status). | Weeks |

| Item | Approval? | Time |
|---|---|---|
| Create app + WhatsApp test number | ❌ | Instant |
| Business Verification | ✅ (production) | ~Days |
| Each WhatsApp template | ✅ (per template) | Minutes–hours |
| WhatsApp display name | ✅ (light) | ~Hours |
| App Review (only for multi-tenant SaaS) | ✅ | ~Weeks |

**Recommended order:** create the app → use the **free WhatsApp test number** to verify the automation
end-to-end now (no approval) → in parallel do Business Verification + create your first template →
go live for your own leads. Multi-tenant **Embedded Signup is already built** — enable it by setting
`META_CONFIG_ID` and completing App Review + Tech Provider registration (see 2.6).

---

## Troubleshooting

- **Webhook verify fails:** the **Verify token** in Meta must exactly equal `META_WEBHOOK_VERIFY_TOKEN`
  in `.env`, and `WEBHOOK_BASE_URL` must be the *current* ngrok URL (it changes each restart unless you
  have a reserved domain).
- **Leads not arriving:** confirm the Page is subscribed to `leadgen`, the form is toggled **Active** in
  the CRM, and `META_APP_SECRET` is set (unset secret = webhook rejected). The 5-min poll worker is a
  backup if a webhook is missed.
- **WhatsApp template won't send:** it must be **APPROVED** and you must pass the right number of `{{n}}`
  variables. Free-form text only delivers inside the 24h customer-service window.
- **"Number already registered":** the phone number is still active on the WhatsApp app — delete it
  there before registering it on the Cloud API.
- **Dev mode limits:** before App Review, the app only works for users who are **admins/developers/testers**
  of the app. Add testers under **App roles**.
