# DigyGo CRM — Complete Developer Guide

## Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + Zustand (`frontend/`)
- **Backend**: Node.js + Express + TypeScript + PostgreSQL (`backend/`)
- **Auth**: JWT (15 min access token) + httpOnly refresh cookie (30 days)
- **Realtime**: Socket.io (tenant-scoped events)
- **Icons**: Lucide React
- **Drag & drop**: @dnd-kit

---

## Running Locally

```bash
# Backend (port 4000)
cd backend && npm run dev

# Frontend (port 5173)
cd frontend && npm run dev

# ngrok (webhooks + Meta OAuth)
ngrok http 5173
```

## Environment — `backend/.env`
| Key | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Token signing |
| `WEBHOOK_BASE_URL` | Ngrok URL |
| `FRONTEND_URL` | Same ngrok URL |
| `META_APP_ID` / `META_APP_SECRET` | Facebook app credentials |
| `META_WEBHOOK_VERIFY_TOKEN` | `d7dde81a60c0867e0866cdb073538ce8` |

## Database
- Local PostgreSQL: `digygocrm` database, user `digygo_user`, password `digygo123`
- Run migrations: `cd backend && npx ts-node src/db/migrate.ts`
- Seed demo data: `cd backend && npx ts-node src/db/seed.ts`
- Super admin: `admin@digygocrm.com` / `admin123`

## Vite Proxy
`/api` and `/socket.io` → `http://127.0.0.1:4000`. Update `allowedHosts` in `vite.config.ts` when ngrok URL changes.

## Deployment
- Production server: SSH deploy via `python deploy_ssh.py` from project root
- Two git remotes: `origin` (broken/old), `digygo` (working production) — always push to `digygo`
- PM2 process name: `digygocrm`
- Migrations run automatically on every deploy

---

## Role Hierarchy — UNDERSTAND THIS FIRST

```
super_admin  →  Bypasses ALL checks. No tenantId. Must impersonate to access tenant data.
owner        →  Bypasses ALL permission checks via SUPER_ROLES. Is in users table (is_owner=true).
staff        →  All access resolved from user_permissions table (JSONB column).
```

- `SUPER_ROLES = { 'super_admin', 'owner' }` — these skip `checkPermission` entirely
- `owner` has `is_owner=true` in DB. Owner is excluded from `GET /api/settings/staff` list (management only)
- Staff with no `user_permissions` row → every permission check returns false → they see nothing
- `permAll = true` on frontend for super_admin and owner → all UI gates open

---

## Permission System — How It Works

### Backend
```typescript
checkPermission('leads:view_all')  // Express middleware — blocks route if not allowed
hasPermission(userId, 'leads:only_assigned', tenantId)  // Async fn — use inside route for data filtering
```

**Flow for staff:**
1. `checkPermission` → checks `SUPER_ROLES` first (bypass if owner/super_admin)
2. Calls `resolvePermission` → queries `user_permissions.permissions->>'permKey'` as boolean
3. Result cached 60s per `tenantId:userId:permKey` key
4. `clearUserPermCache(userId, tenantId)` must be called after any permission update

**Critical SQL in resolvePermission:**
```sql
WHERE u.id = $1 AND ($3::uuid IS NULL OR u.tenant_id = $3::uuid)
```
The `::uuid` cast is mandatory — PostgreSQL will throw `operator does not exist: uuid = text` without it.

### Frontend
```typescript
const canEdit = usePermission('leads:edit')         // returns boolean
const permFn  = usePermissions()                    // returns checker fn
permFn('leads:view_all')                            // use when calling in loops/callbacks
```
`permAll=true` for owner and super_admin — all UI permission gates auto-open.

### Manager Detection on Frontend
There is NO `'manager'` JWT role. Manager is detected as:
```typescript
const isManager = !isPrivileged && usePermission('staff:manage');
```
Never check `role === 'manager'` — it will never be true.

### Full Permission Key List
Canonical source of truth: `FULL_PERMISSIONS` in `backend/src/routes/settings.ts`. The staff modal renders these via `PERM_GROUPS` in `frontend/src/pages/StaffPage.tsx`. Adding a key requires: FULL_PERMISSIONS + CUSTOM_DEFAULT_PERMISSIONS + route `checkPermission` + PERM_GROUPS + an idempotent backfill migration (see [Permission System Conventions] below).
```
dashboard:total_leads, dashboard:active_staff, dashboard:conversations, dashboard:appointments
meta_forms:read/create/edit/delete
custom_forms:read/create/edit/delete
landing_pages:read/create/edit/delete
whatsapp_setup:read/manage
whatsapp_automation:read/manage
leads:view_all, leads:view_own, leads:create, leads:edit, leads:delete, leads:export
leads:only_assigned   ← ABSOLUTE restriction (default false — if true, user only sees their assigned leads)
leads:mask_phone      ← Hide phone numbers (default false)
followups:view
pipeline:view, pipeline:manage   ← pipeline:view gates the board read (was leads:view_own)
contacts:read/create/edit/delete, contacts:export
contact_groups:read/manage
opportunities:read/create/edit/delete
tags:view/manage   ← tag DEFINITIONS only; assigning a tag to a lead uses leads:edit
automation:view/manage
automation_templates:read/manage
assignment_rules:view/manage
routing:view/manage   ← Pincode + Field routing
whatsapp_flows:view/manage
inbox:view_all/send/assign   ← view_all OR send gates conversation read; assign OR send gates assignment
calendar:view, calendar:manage
calls:view_all, calls:view_own, calls:recordings   ← recordings gates recording/download endpoints
fields:view/manage
staff:view/manage
settings:manage   ← master; OR'd with the sub-keys below via checkAnyPermission
settings:company, settings:branding, settings:security
integrations:view/manage
```

### Permission System Conventions
- **Access type is explicit:** a reserved `_access_type: 'full' | 'custom'` key is stored inside the `user_permissions.permissions` JSONB (`ACCESS_KEY` in settings.ts). GET `/staff/:id/permissions` returns `access_type` (the marker, else server-side `isFullPerms()` vs FULL_PERMISSIONS). The frontend toggle reads `access_type` directly — never re-derive from values. The resolver reads `permissions->>$key`, so the marker is ignored by access checks.
- **Granular splits use `checkAnyPermission(masterKey, subKey)`** (middleware/permissions.ts) — a master OR a sub-key both grant access (backward compatible). Used for `settings:manage` and inbox view/assign.
- **Adding a key:** FULL_PERMISSIONS + CUSTOM_DEFAULT_PERMISSIONS + route `checkPermission` + PERM_GROUPS + a **backfill migration** (`WHERE NOT (permissions ? 'key')`, idempotent) granting it to existing rows so no staff loses access. Mirror the value of whatever key it used to borrow.
- **Migration gotcha:** NEVER put a `;` inside a `--` comment in a migration — the splitter in `db/migrate.ts` splits on `;` even in comments (broke migration 087; same class as 030/082).

---

## User-Scoped Data Access — THE MOST CRITICAL RULE

Every endpoint that returns **tenant data** MUST apply user-level access control. This is not optional.

### The Two-Layer Check Pattern

**Layer 1 — Can the user call this endpoint at all?**
```typescript
router.get('/leads', checkPermission('leads:view_own'), async ...)
```

**Layer 2 — What data can they see?**
```typescript
const isSuperAdmin = role === 'super_admin';
let viewAll = false;

if (isSuperAdmin) {
  viewAll = true;
} else {
  const isOwner = (await query('SELECT is_owner FROM users WHERE id=$1', [userId])).rows[0]?.is_owner === true;
  if (!isOwner) {
    const onlyAssigned = await hasPermission(userId, 'leads:only_assigned', tenantId);
    if (onlyAssigned) {
      viewAll = false;
    } else {
      viewAll = await hasPermission(userId, 'leads:view_all', tenantId);
    }
  } else {
    viewAll = true;
  }
}

if (!viewAll) {
  sql += ` AND l.assigned_to = $${params.push(userId)}`;
}
```

### Every Feature That Returns Lead-Related Data Needs This Pattern
- `GET /api/leads` ✓
- `GET /api/leads/followups` — must filter by assigned lead or assigned_to on follow-up
- `GET /api/contacts` — must filter by assigned_to
- `GET /api/calendar` — must filter by assigned event or assigned lead
- `GET /api/conversations` — must filter by assigned_to
- `GET /api/pipelines` — must restrict to pipelines with user's assigned leads
- `GET /api/workflows/:id/logs` — must filter by assigned leads
- `GET /api/dashboard/stats` — must scope counts to assigned leads

**Rule: If an endpoint returns data that belongs to a lead, it must respect `leads:only_assigned`.**

---

## Systemwide Audit Rule — ALWAYS DO THIS

When fixing or building ANY endpoint or page, before closing the task:

1. **Check every related endpoint in the same route file** for the same class of bug
2. **Check adjacent route files** — if leads.ts has a filter bug, check contacts.ts, followups, calendar, conversations
3. **Check the frontend page** — does it apply any client-side filter? Does it show data to the right users?
4. **Think from each role's perspective:**
   - As `super_admin`: Can I see everything? (should be yes)
   - As `owner`: Can I see everything? (should be yes)
   - As `staff with view_all`: Can I see all leads? (should be yes)
   - As `staff with only_assigned`: Can I see ONLY my leads? (should be yes)
   - As `staff with no permissions row`: What do I see? (should be gracefully limited, not 500)

---

## New Endpoint Checklist

Before any new backend route is considered complete, verify:

- [ ] `requireAuth` + `requireTenant` applied (via `router.use()` at top of file)
- [ ] `checkPermission('appropriate:key')` on the route
- [ ] `WHERE tenant_id = $X` on every SQL query
- [ ] User-scoping applied if returning lead/contact/calendar/conversation data
- [ ] Parameterized SQL — never string interpolation
- [ ] `::uuid` cast on any UUID comparison from a text parameter: `$N::uuid`
- [ ] Soft-delete filter: `AND is_deleted = FALSE` on leads/calendar queries
- [ ] Socket emission includes JOIN'd fields (e.g., `assigned_name`) not just `RETURNING *`
- [ ] Plan check (`checkPlan`) if feature is plan-gated
- [ ] Usage check (`checkUsage`) if resource has a limit

---

## New Frontend Page/Feature Checklist

Before any new page or feature is considered complete, verify:

- [ ] `usePermission('key')` gates every action button (create, edit, delete)
- [ ] API errors show toast notification
- [ ] Loading state shown while fetching
- [ ] Empty state shown when no data
- [ ] Staff array lookup for assignee names uses `assigned_name` from API as fallback (not just `staff.find()`)
- [ ] Socket listeners registered for real-time updates, cleaned up on unmount
- [ ] `initFromApi()` or direct API call loads fresh data on mount
- [ ] Works correctly when `staff` array is empty (no crash, graceful fallback)

---

## Database Patterns

### Multi-tenancy — Every Query Must Scope to Tenant
```sql
WHERE tenant_id = $1            -- Always first param
AND is_deleted = FALSE          -- For leads, calendar events
AND ($N::uuid IS NULL OR u.tenant_id = $N::uuid)  -- When joining users with optional tenantId
```

### Parameterized Queries — Always
```typescript
await query('SELECT * FROM leads WHERE id=$1 AND tenant_id=$2', [id, tenantId])
// NEVER: `SELECT * FROM leads WHERE id='${id}'`
```

### UUID Comparisons — Always Cast
```sql
WHERE u.tenant_id = $3::uuid    -- NOT: WHERE u.tenant_id = $3
($3::uuid IS NULL OR ...)       -- For nullable UUID params
```

### Socket Emissions — Include JOIN'd Fields
```typescript
// WRONG — RETURNING * doesn't include assigned_name
emitToTenant(tenantId, 'lead:updated', result.rows[0]);

// RIGHT — re-fetch with JOIN to include display fields
const withJoin = await query(
  'SELECT l.*, u.name AS assigned_name FROM leads l LEFT JOIN users u ON u.id = l.assigned_to WHERE l.id=$1',
  [result.rows[0].id]
);
emitToTenant(tenantId, 'lead:updated', withJoin.rows[0]);
```

### Soft Deletes
- Leads: `is_deleted = TRUE` (never hard delete)
- Calendar events: `is_deleted = TRUE`
- Hard delete only: tags, pipeline stages (after moving leads off)

---

## Frontend Data Flow

```
App boots → AuthGuard.bootstrapFromRefresh()
         → crmStore.initFromApi()
         → Fetches: leads, staff, pipelines, calendar, tags, conversations, notifications, followups, customFields
         → All .catch(() => []) — silent failures, don't crash app
         → AppLayout polls initFromApi() every 30s for freshness
```

### crmStore — Key Rules
- `staff` array contains ONLY non-owner users (from `GET /api/settings/staff`)
- `assigned_name` from API response is the fallback for owner-assigned leads
- All lead mappings must include: `assignedTo: l.assigned_to ?? ''` AND `assignedName: l.assigned_name ?? ''`
- Socket events (`lead:created`, `lead:updated`) must also map `assignedName`
- Permissions stored in `authStore`, not `crmStore`

### Lead Display — Assignee Name
```typescript
// Always use this pattern — staff.find() alone fails for owner-assigned leads
const assignedStaff = staff.find((s) => s.id === lead.assignedTo);
const displayName = assignedStaff?.name || lead.assignedName || '';
// Show: displayName ? `Assigned to ${displayName}` : 'Unassigned'
```

---

## AppLayout — Height Chain (Critical)

```tsx
// AppLayout.tsx — correct structure
<div className="h-[100dvh] flex w-full overflow-hidden">        // root: full viewport, no overflow
  <AppSidebar />
  <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
    <AppHeader />
    <main className="flex-1 overflow-hidden flex flex-col min-h-0">  // overflow-hidden NOT overflow-y-auto
      <div className="px-6 py-5 flex flex-col flex-1 min-h-0 pb-10 overflow-y-auto">  // scroll lives HERE
        <Outlet />                                                   // pages render here
      </div>
    </main>
  </div>
</div>
```

**Why this matters:** If `overflow-y-auto` is on `<main>`, flex children's `flex-1` becomes unbounded — the board never gets a proper height cap and leaves empty space at the bottom. The scroll container must be the content `div` (inside a height-bounded `<main>`), not `<main>` itself.

**Pages that fill the viewport** (like the kanban board) use `flex-1 min-h-0` on their root div and the board wrapper. This works correctly only when the height chain above is intact.

---

## Authentication Patterns

### Token Storage
- Access token: in-memory only (`_accessToken` in api.ts) + localStorage `dg_tok`
- Refresh token: httpOnly cookie only (never accessible to JS)
- Impersonation CEO token: in-memory only — page refresh ends impersonation (by design, secure)

### 401 Handling in api.ts
```
Request fails with 401
  → Try POST /api/auth/refresh (once, deduplicated)
  → Success: update token, retry original request
  → Failure with 401/403: logout() + redirect /login
  → Other failure: throw 'Session expired'
```

### Refresh Token Rotation
- Only first 16 hex chars (prefix) stored indexed for O(1) lookup
- Atomic UPDATE WHERE prefix = $X to prevent race condition reuse
- Failed login: increment `failed_login_attempts`, lock after 5 × 15 min

---

## Plan & Usage System

```
Plans: starter → growth → pro → enterprise

checkPlan('feature'):    Reads from JWT (no DB hit) — fast gate
checkUsage('resource'):  Queries tenant_usage table — checks count vs. plan limit
incrementUsage():        Call after successful resource creation
decrementUsage():        Call after resource deletion
```

**Plan limits (starter):** 500 leads, 500 contacts, 5 staff, 5 forms, 5 workflows
**Enterprise:** unlimited everything

---

## Key Backend Routes (24 route files)
| File | Prefix | Notes |
|---|---|---|
| `routes/auth.ts` | `/api/auth` | Login, refresh, super admin tenant management |
| `routes/leads.ts` | `/api/leads` | Lead CRUD + followups |
| `routes/contacts.ts` | `/api/contacts` | Contact CRUD |
| `routes/pipelines.ts` | `/api/pipelines` | Pipeline + stage management |
| `routes/workflows.ts` | `/api/workflows` | Automation workflows |
| `routes/settings.ts` | `/api/settings` | Company settings + staff management |
| `routes/forms.ts` | `/api/forms` | Custom forms (public submit has no auth) |
| `routes/calendar.ts` | `/api/calendar` | Events + public booking |
| `routes/conversations.ts` | `/api/conversations` | Inbox/WhatsApp threads |
| `routes/fields.ts` | `/api/fields` | Custom lead fields |
| `routes/integrations.ts` | `/api/integrations` | Meta/WhatsApp/Razorpay |
| `routes/webhooks.ts` | `/api/webhooks` | Inbound Meta webhooks |
| `routes/tags.ts` | `/api/tags` | Tag CRUD and assignment |
| `routes/templates.ts` | `/api/templates` | Message templates (WhatsApp/email/SMS) |
| `routes/landing_pages.ts` | `/api/landing-pages` | Page builder, publishing |
| `routes/opportunities.ts` | `/api/opportunities` | Deal/opportunity management |
| `routes/assignment_rules.ts` | `/api/assignment-rules` | Rule CRUD and evaluation |
| `routes/notifications.ts` | `/api/notifications` | Notification feed and preferences |
| `routes/whatsapp_flows.ts` | `/api/whatsapp-flows` | WhatsApp flow builder |
| `routes/pincode_routing.ts` | `/api/pincode-routing` | Pincode-based lead routing |
| `routes/field_routing.ts` | `/api/field-routing` | Custom field-based routing |
| `routes/leadGeneration.ts` | `/api/lead-generation` | Lead generation analytics |
| `routes/dashboard.ts` | `/api/dashboard` | Stats + analytics (role-scoped) |
| `routes/public.ts` | `/api/public` | Public form/booking (no auth) |

---

## Key Frontend Pages (40 pages)
| Page | Path | Key Permissions |
|---|---|---|
| `DashboardPage.tsx` | `/dashboard` | Role-split: owner/super_admin → ManagementDashboard; staff:manage → ManagerDashboard; else → StaffDashboard |
| `LeadsPage.tsx` | `/leads` | leads:view_all/own, leads:only_assigned |
| `LeadManagementOverviewPage.tsx` | `/lead-management` | Pipeline overview; clicking a card navigates to `/leads?pipeline=<id>` |
| `ContactsPage.tsx` | `/lead-management/contacts` | contacts:read/create (edit + export are UI stubs) |
| `ContactGroupPage.tsx` | `/lead-management/contact-groups` | contact_groups:read/manage |
| `FollowUpsPage.tsx` | `/lead-management/followups` | respects leads:only_assigned |
| `LeadGenerationPage.tsx` | `/lead-generation` | Overview with sparkline bar charts (LabelList for visible count labels) |
| `MetaFormsPage.tsx` | `/lead-generation/meta-forms` | meta_forms:* |
| `CustomFormsPage.tsx` | `/lead-generation/custom-forms` | custom_forms:* |
| `LandingPagesPage.tsx` | `/lead-generation/landing-pages` | landing_pages:* |
| `AutomationPage.tsx` | `/automation/workflows` | automation:view/manage |
| `WorkflowEditorPage.tsx` | `/automation/editor/:id` | automation:manage |
| `AutomationTemplatesPage.tsx` | `/automation/templates` | automation_templates:* |
| `CalendarPage.tsx` | `/calendar` | calendar:manage |
| `InboxPage.tsx` | `/inbox` | inbox:view_all/send |
| `StaffPage.tsx` | `/staff` | staff:view/manage |
| `FieldsPage.tsx` | `/fields` | fields:view/manage |
| `SettingsPage.tsx` | `/settings` | settings:manage |
| `IntegrationsPage.tsx` | `/integrations` | integrations:view/manage |
| `SuperAdminPage.tsx` | `/admin` | role === 'super_admin' only |
| `AssignmentRulesPage.tsx` | `/assignment-rules` | staff:manage |
| `PincodeRoutingPage.tsx` | `/pincode-routing` | staff:manage |

---

## Dashboard Architecture — Three Role Views

`DashboardPage.tsx` renders one of three sub-dashboards based on role:

```typescript
const isPrivileged = currentUser?.role === 'super_admin' || currentUser?.role === 'owner';
const canManageStaff = usePermission('staff:manage');
const isManager = !isPrivileged && canManageStaff;

if (isPrivileged)  → <ManagementDashboard />   // owner / super_admin
else if (isManager) → <ManagerDashboard />      // staff with staff:manage permission
else               → <StaffDashboard />         // regular staff
```

### ManagementDashboard (owner/super_admin)
- 4 aggregate KPIs: Total Leads, Active Staff, Conversations, Appointments
- Business Growth Trend line chart
- Pipeline Funnel + Source Intelligence
- Source ROI ComposedChart
- Team Health bars per staff member

### ManagerDashboard (staff with staff:manage)
- 4 operational KPIs + Staff Performance table
- Untouched-by-Staff horizontal bar chart
- Pipeline Health, Team follow-ups list, Lead inflow chart

### StaffDashboard (regular staff)
- 4 personal KPIs: My Leads, My Overdue Follow-ups, My Conversations, My Appointments
- My Follow-ups list
- My Numbers panel

---

## Kanban Board Architecture (LeadsPage.tsx)

### Layout structure
```
Page root: flex flex-col flex-1 min-h-0
  ├── Sticky toolbar: sticky top-0 z-20 bg-[#faf8f6]
  │     ├── Pipeline selector (dropdown)
  │     ├── Search input
  │     ├── View toggle: Board | List (labeled, not icon-only)
  │     ├── Filter button (labeled "Filter")
  │     ├── More menu (···)
  │     └── Add Lead button
  └── Board wrapper: flex-1 flex flex-col min-h-0 overflow-hidden
        └── DndContext
              └── Kanban row: flex gap-4 overflow-x-auto overflow-y-hidden flex-1 min-h-0 items-stretch
                    └── StageColumn × N
```

### StageColumn structure
```
Column outer: min-w-[280px] w-[280px] self-stretch flex flex-col rounded-2xl overflow-hidden border
  ├── Accent strip: h-[3px] (color from STAGE_ACCENT_COLORS[stageIndex])
  ├── Header: px-4 pt-3 pb-2.5 — stage name (left) + colored count badge pill (right)
  │   → This header is always visible (outside the scroll area) — effectively sticky
  └── Cards area: flex-1 min-h-0 overflow-y-auto — PER-COLUMN scroll
        → Thin visible scrollbar via [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-black/20
        → Empty state: dashed border icon + "No leads" + "Drag here to move"
```

### Stage accent colors
```typescript
const STAGE_ACCENT_COLORS = [
  '#ea580c', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
  '#f43f5e', '#06b6d4', '#84cc16', '#ec4899', '#0ea5e9',
];
// Used as: STAGE_ACCENT_COLORS[stageIndex % STAGE_ACCENT_COLORS.length]
```

### Key behaviors
- Board fills viewport height — no whole-page vertical scroll
- Each column scrolls independently (per-column `overflow-y-auto`)
- Scrollbar is VISIBLE (thin, 4px) — never use `scrollbar-hide` on columns (it hides cards from users)
- Stage header does NOT scroll away — it sits above the cards scroll area
- Board scrolls horizontally for many stages (`overflow-x-auto` on kanban row)
- Drag-and-drop via @dnd-kit between stages

---

## AppSidebar — Navigation Rules

### Lead Management active state
The sidebar highlights "Lead Management" for both `/leads` AND `/lead-management/*`:
```typescript
if (p === '/leads') {
  return location.pathname === '/leads'
    || location.pathname === '/lead-management'
    || location.pathname.startsWith('/lead-management/');
}
```

### Default navigation
- "Lead Management" in sidebar navigates to `/leads` (Pipeline view by default)
- Overview tab is accessible from the tab bar at the top of the page
- Clicking a pipeline card on the Overview page navigates to `/leads?pipeline=<id>`

### Tab bar (AppHeader.tsx)
When on `/leads` or `/lead-management/*`, the header shows tabs:
Overview | Pipeline | Follow-ups | Contacts | Contact Group

---

## Design Conventions
- Brand colors: `#c2410c` (primary), `#ea580c`, `#f97316`
- Muted text: `#7a6b5c`, Primary text: `#1c1410`
- Card background: `#faf8f6`
- Rounded cards: `rounded-xl` or `rounded-2xl` with `border border-black/5`
- Stage names: `text-[#c2410c]`
- Buttons: orange gradient for primary actions, white/border for secondary
- All modals/panels: `z-50` or higher, backdrop `bg-black/50`
- Kanban columns: rounded-2xl with 3px colored accent strip at top, count badge pill in header

---

## Known Bugs Fixed — Do Not Reintroduce

1. **`resolvePermission` uuid cast** — `$3::uuid IS NULL OR u.tenant_id = $3::uuid` — without `::uuid` PostgreSQL throws type mismatch and ALL staff routes return 500

2. **`GET /api/settings/staff` permission guard** — removed `checkPermission('staff:view')` so all staff can load the team list for name display

3. **Owner excluded from staff list** — `assigned_name` stored on Lead object as fallback for owner-assigned leads

4. **Socket `lead:created/updated` missing `assigned_name`** — `RETURNING *` doesn't include JOIN fields; re-fetch with JOIN before emitting

5. **AutomationPage blank** — `AlertTriangle` imported from lucide-react was missing, causing render crash

6. **`GET /api/leads/followups` no user scoping** — endpoint returned all tenant follow-ups with no `only_assigned` filter

7. **Form trigger blank = any form** — `opt_in_form`, `meta_form`, `product_enquired` with no form selected used to fire for every form submission. Fixed: blank form config = workflow never fires. Backend SQL no longer has `trigger_forms = '{}'` bypass. Frontend blocks activation with a toast error and shows an amber warning banner in the trigger config panel.

8. **AppLayout overflow-y-auto on `<main>`** — Caused `flex-1` on board wrapper to be unbounded, leaving empty space at the bottom of the kanban board. Fix: `<main>` must be `overflow-hidden`; `overflow-y-auto` belongs on the inner content `div` so the height chain is properly bounded.

9. **Kanban `scrollbar-hide` hiding leads** — Columns with many leads appeared to have only 3 cards because the scrollbar was hidden, giving no visual cue that more cards existed below. Fix: removed `scrollbar-hide`, added thin visible webkit scrollbar (`[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-black/20`).

10. **Manager detection using `role === 'manager'`** — No `'manager'` role exists in the JWT. Manager is detected via `usePermission('staff:manage')` on the frontend.

11. **Lead Generation sparkline bar count labels invisible** — Bar chart labels on the Lead Generation overview page were not visible because `LabelList` was missing. Fix: add `<LabelList dataKey="count" position="top">` inside the `<Bar>` component.

---

## Project Completion Status (~92%)

### Complete ✅
- Authentication & permissions (JWT, roles, 35+ granular permissions)
- Dashboard (owner / manager / staff role-split views)
- Lead Management (kanban board, list view, bulk actions, import/export)
- Follow-ups, contacts, contact groups
- Lead Generation (Meta Forms, Custom Forms, Landing Pages)
- Automation workflows (50+ triggers/actions, folders, logs, delay queue)
- Calendar & booking (availability, public booking, appointment triggers)
- Inbox / WhatsApp (two-way messaging, assignment, real-time)
- Staff management (CRUD, permissions matrix)
- Custom fields (field groups, routing)
- Settings (SMTP, webhooks, branding)
- Super Admin panel (tenant management, plans, impersonation)
- Meta + WhatsApp integrations
- Notifications (in-app, real-time WebSocket)
- Permission-scoped data filtering (only_assigned, view_all)

### Partial 🟡
- Contacts page — edit and export are UI stubs (backend fully supports it)
- Integrations page — Gmail, Slack, Zapier, n8n listed but OAuth not wired
- Automation — SMS / Instagram DM / Facebook post actions throw "not implemented"

### Not Built ❌
- Stripe integration (marked "coming soon")
- Outlook integration (marked "coming soon")
- SMS sending in workflows (needs Twilio/MSG91)
- Instagram DM action (needs Meta Messenger API)
- Facebook post/comment action (needs Meta Graph API)

---

## Thinking Framework — Apply Before Every Task

### Before writing any code, ask:
1. **Who can call this?** → Does it need `checkPermission`? Which key?
2. **What data can they see?** → Does it need `only_assigned` / `view_all` filtering?
3. **Is it scoped to the tenant?** → Is `tenant_id` in the WHERE clause?
4. **What happens for each role?** → Test mentally: super_admin, owner, staff with all perms, staff with restricted perms, staff with no perms row
5. **What breaks if the API call fails?** → Frontend must not crash; show empty state gracefully
6. **Are there related endpoints with the same gap?** → Fix them all, not just the one reported

### After writing any code, verify:
1. Does a staff user with `only_assigned=true` see ONLY their data?
2. Does the owner see everything (even though they're not in the staff array)?
3. Does a user with no `user_permissions` row get a graceful experience (not 500)?
4. Do socket events carry all necessary display fields (not just raw DB row)?
5. Does the frontend have fallbacks when arrays are empty or API calls fail?

---

## Automation System — Triggers & Actions

### How Workflows Execute
- `triggerWorkflows(triggerType, lead, tenantId, userId)` in `routes/workflows.ts` is called after relevant CRM events
- SQL fetches only `active` workflows whose `trigger_key` matches AND form filter passes
- Per-lead filters (pipeline, stage, source, tag) are checked in-memory after the SQL fetch
- Each action node logs `completed / failed / skipped` status to `workflow_execution_logs`
- Variable interpolation: `{first_name}`, `{last_name}`, `{full_name}`, `{email}`, `{phone}`, `{stage}`, `{pipeline}`, `{assigned_staff}`, `{source}`, `{today}`, `{date}`, `{time}`, custom fields

### Trigger Types

#### Forms
| Key | Label | Fires when | Config |
|---|---|---|---|
| `opt_in_form` | Custom Form Submitted | A lead submits an embedded/hosted custom form | Must select ≥1 form. Blank = workflow stays inactive, never fires |
| `meta_form` | Meta Form Submitted | A lead comes in via Facebook/Instagram lead ad | Must select ≥1 form. Blank = workflow stays inactive, never fires |
| `product_enquired` | Product Enquired | A product enquiry form is submitted | Must select ≥1 form. Blank = workflow stays inactive, never fires |

#### CRM
| Key | Label | Fires when | Config |
|---|---|---|---|
| `lead_created` | Added to Pipeline | A lead is **first created** and placed into a specific pipeline — NOT on stage moves within same pipeline | Select pipeline + stage (both optional; blank = any). Backend filters by `pipeline_id` and `stage_id` on the lead at creation time |
| `stage_changed` | Stage Changed | A lead is moved from one pipeline stage to another | Select pipeline + stage to match destination |
| `follow_up` | Follow Up | A follow-up task is created for a lead | Filter by type and assigned staff |
| `notes_added` | Notes Added | A note is added to any lead — no filter needed | — |

> **`lead_created` rule**: fires only at creation time (POST /api/leads). Stage moves use `stage_changed`. Backend skips the workflow if configured pipeline/stage doesn't match the lead's pipeline/stage at creation.

#### Contact
| Key | Label | Fires when |
|---|---|---|
| `contact_created` | Contact Source | A new contact is created; filter by source (Meta Form, WhatsApp, Manual, etc.) |
| `contact_updated` | Contact Updated | Any field on a contact is edited; filter by which field changed |
| `contact_tagged` | Contact Tagged | A specific tag is applied to a contact |

#### Calendar
| Key | Label | Fires when |
|---|---|---|
| `calendar_form_submitted` | Calendar Form Submitted | Someone fills the booking form; must select at least one calendar (blank = never fires) |
| `appointment_booked` | Appointment Booked | Appointment confirmed |
| `appointment_cancelled` | Appointment Cancelled | Appointment cancelled |
| `appointment_rescheduled` | Appointment Rescheduled | Appointment moved to new time |
| `appointment_noshow` | No-Show | Lead didn't attend |
| `appointment_showup` | Show Up | Lead attended |

#### Schedule
| Key | Label | Fires when |
|---|---|---|
| `specific_date` | Specific Date | Once on a configured date |
| `weekly_recurring` | Weekly Recurring | Every week on a chosen day |
| `monthly_recurring` | Monthly Recurring | Every month on a chosen date |
| `event_date` | Event Date | Relative to an event date stored on the lead |

#### Inbox / Social / Other
| Key | Label | Fires when |
|---|---|---|
| `inbox_message` | New Message | WhatsApp/inbox message received |
| `comment_received` | Comment Received | Comment on Facebook/Instagram post |
| `dm_received` | DM Received | Instagram direct message received |
| `webhook_inbound` | API 1.0 | External system POSTs to your inbound webhook URL |
| `payment_received` | Payment Received | Payment recorded for a lead |
| `course_enrolled` | Course Enrolled | Lead enrolls in a course (LMS) |

---

### Action Types

#### CRM Operations
| Key | What it does |
|---|---|
| `add_to_crm` | Creates or updates lead in a configured pipeline + stage; verifies write persisted |
| `change_stage` | Moves lead to a different stage; also fires `stage_changed` trigger after move |
| `change_lead_quality` | Sets lead quality: Hot / Warm / Cold / Unqualified |
| `update_attributes` | Updates name, email, phone, or source on the lead record |

#### People
| Key | What it does |
|---|---|
| `assign_staff` | Assigns lead to a staff member; if multiple configured → round-robin |
| `remove_staff` | Clears the assigned_to field on the lead |
| `assign_ai` | Assigns an AI agent ID to `custom_fields.ai_agent_id` |

#### Tags
| Key | What it does |
|---|---|
| `add_tag` / `tag_contact` | Adds one or more tags to the lead |
| `remove_tag` | Removes a specific tag from the lead |

#### Communication
| Key | What it does |
|---|---|
| `send_email` | Sends automated email via SMTP; supports `{variable}` interpolation in subject + body |
| `send_whatsapp` | Sends WhatsApp message via connected WABA number |
| `internal_notify` | Sends in-CRM notification to: all staff / assigned staff / specific person |
| `send_sms` | ⚠️ NOT IMPLEMENTED — throws error if reached |

#### Follow-up & Calendar
| Key | What it does |
|---|---|
| `create_followup` | Schedules a follow-up task; configure due time in hours/days from now |
| `change_appointment` | Updates appointment status to Booked / Cancelled / Completed / No Show / Rescheduled |

#### Notes
| Key | What it does |
|---|---|
| `create_note` | Adds a note to lead timeline; supports `{variable}` interpolation |

#### Contact Lists
| Key | What it does |
|---|---|
| `contact_group` | Copies/moves contact into a contact group (uses tag with "group:" prefix) |
| `contact_group_access` | Grants group access to contact (uses tag with "access:" prefix) |
| `remove_contact` | Removes contact from a specific list |
| `remove_from_crm` | Soft-deletes the lead from CRM (sets `is_deleted = TRUE`) |

#### Workflow Control
| Key | What it does |
|---|---|
| `if_else` | Branches based on condition — evaluates fields, tags, stage, custom fields with AND/OR logic; operators: equals, not equals, contains, starts/ends with, is empty, greater/less than |
| `delay` | Waits X minutes / hours / days before next action |
| `execute_automation` | Runs another workflow as a sub-process |
| `exit_workflow` | Stops this workflow immediately for this lead |
| `remove_workflow` | Removes lead from the current running workflow |

#### External
| Key | What it does |
|---|---|
| `webhook_call` | POSTs lead data to an external URL |
| `api_call` | Makes GET/POST/PUT/PATCH to any external API (15s timeout); can save response to a custom field |
| `post_instagram` | ⚠️ NOT IMPLEMENTED |
| `facebook_post` | ⚠️ NOT IMPLEMENTED |

---

## Meta Integration URLs
| Purpose | URL |
|---|---|
| OAuth callback | `{WEBHOOK_BASE_URL}/api/integrations/meta/callback` |
| Webhook (leadgen) | `{WEBHOOK_BASE_URL}/api/integrations/meta/webhook` |
| WhatsApp webhook | `{WEBHOOK_BASE_URL}/api/webhooks/whatsapp` |
