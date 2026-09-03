# Platform UI — Future Work

**Scope:** This document covers the *platform console* (`platform.html`) — the platform-owner / super-admin surface used to manage organizations (tenants), users, and per-org branding. It complements the product feature plan in [`ROADMAP.md`](./ROADMAP.md) (Change Orders, Customer Portal, EagleView, Google Maps), which it does **not** duplicate. Where the two overlap, this doc defers to `ROADMAP.md` for the estimator features and focuses on the multi-tenant administration layer.

**Last reviewed against code:** July 7, 2026 (`platform.html` @ 48 KB, `supabase/functions/manage-tenant/index.ts`, `PricingEstimator.html`).

---

## 1. Current State of the Platform Console

`platform.html` today is a working single-page console gated to the platform owner. What exists and works:

- **Google OAuth login gate**, hard-restricted to `PLATFORM_EMAIL` (`eganfamily12@gmail.com`), with a self-managed session in `localStorage` and silent token refresh.
- **Organizations tab** — grid of tenant cards with search, a stats strip (Orgs / Users / Active / Quotes), create-org modal, activate/deactivate, and an "Enter Org" context mode.
- **All Users tab** — table of every user across all tenants, with search plus role and org filters, invite-user modal, edit-role modal, and activate/deactivate.
- **Org context mode** ("Enter Org") — reveals two extra tabs: **Org Design** (branding/colors/license/insurance) and **Org Users** (users scoped to that tenant).
- **Server enforcement** — all tenant/user writes route through the `manage-tenant` edge function, which re-verifies the caller's role (`platform_owner` / `super_admin`) using the service-role key, so security does not depend on the client-side email check.

The console is functional for day-to-day tenant admin, but several pieces are stubbed, cosmetic-only, or not yet wired end-to-end. The rest of this document is the backlog.

---

## 2. Confirmed Gaps (grounded in current code)

Each item below was verified against the current source, not assumed.

### 2.1 Branding is configured but never applied (highest impact)
The Org Design tab saves company name, logo URL, primary/accent colors, tagline, license, and insurance into `tenants.settings`. However, `PricingEstimator.html` still renders **hardcoded** Renew Home Exteriors branding — the header, tagline ("1361 Wooster Rd W… Licensed · Bonded · Insured"), and PDF cover styling are literals, and the estimator does not read `tenants.settings` at all. **Result:** configuring a new org's design in the platform has no visible effect on that org's estimator or PDF output. For a genuinely multi-tenant product this is the single most important gap to close.

### 2.2 "Total Quotes" stat is a placeholder
`statQuotes` is hardcoded to `'—'` in `updateStats()`. There is no query for quote counts, globally or per org. Org cards likewise show no per-org metrics (user count, quote count, last activity).

### 2.3 Logo is URL-only — no upload
The design form takes a logo **URL** (`d_logo`) with a preview, but there is no file upload to Supabase Storage. Onboarding a new org requires the operator to already host a logo somewhere.

### 2.4 No "edit org details" path from the card
Basic org fields (name, phone, address, domain) can only be edited inside the Org Design tab after entering the org. There is a create-org modal but no lightweight edit-details modal, and no way to correct a slug/domain quickly from the grid.

### 2.5 No delete / archive for orgs or users
`manage-tenant` supports `create`, `update`, `update_user` and three list operations only — there is **no** `delete` for tenants and **no** delete for users. The UI can only toggle `active`. There is no archival/soft-delete concept, and deactivated orgs stay in the grid indefinitely.

### 2.6 Invitations have no lifecycle
Invite sends via the `invite-user` function, but there is no pending-invite state, no "resend invite," no expiry indication, and no way to revoke an unaccepted invite. The invite role dropdown also cannot assign `platform_owner` (likely intentional, but undocumented).

### 2.7 Tables do not scale
Both the All Users table and the org grid render every row at once with no pagination, server-side filtering, or column sorting. This is fine at a handful of tenants but degrades as the platform grows.

### 2.8 No audit trail
There is no record of platform actions — who created/deactivated an org, who changed a user's role, when branding changed. For a system that manages contracts and e-signatures, an admin audit log is a meaningful gap.

### 2.9 Mobile / responsive polish
The stats strip is a fixed `repeat(4,1fr)` grid and the design panel is a fixed two-column grid, with no breakpoints; tables rely on horizontal scroll. The console is desktop-only in practice.

### 2.10 Error and confirmation UX
Destructive actions use the native `confirm()` dialog, and failures surface raw edge-function error text directly in toasts (e.g. Postgres messages), which is both unpolished and a minor information leak. There are no loading skeletons — panels show a plain "Loading…".

### 2.11 No billing / plan concept
Tenants have no plan, seat limit, or subscription fields, and the console has no billing view. If this becomes a sold product rather than a single-operator tool, subscription state and seat enforcement will be required.

### 2.12 Accessibility
Modals lack focus trapping, `aria-*` attributes, and Escape-to-close; there is no keyboard navigation story. Worth addressing before external operators use the console.

---

## 3. Prioritized Backlog

| # | Item | Why it matters | Effort | Depends on |
|---|------|----------------|--------|-----------|
| **P0** | Wire `tenants.settings` branding into estimator + PDF (§2.1) | Multi-tenant is not real until each org sees its own brand | 3–4 sessions | — |
| **P0** | Logo upload to Supabase Storage (§2.3) | Required for real org onboarding; feeds the branding above | 1–2 sessions | Storage bucket + RLS |
| **P1** | Live "Total Quotes" + per-org metric counts (§2.2) | Turns the console from a directory into a dashboard | 1–2 sessions | new count op in edge fn |
| **P1** | Edit-org-details modal from card (§2.4) | Everyday admin friction | 1 session | — |
| **P1** | Delete / archive orgs and users (§2.5) | Data hygiene; currently impossible | 1–2 sessions | new delete ops in edge fn |
| **P2** | Invitation lifecycle: pending / resend / revoke (§2.6) | Reduces support load during onboarding | 2 sessions | invite-user changes |
| **P2** | Admin audit log (§2.8) | Accountability for contract-bearing system | 2–3 sessions | new `audit_log` table |
| **P2** | Table pagination + sorting (§2.7) | Scales the console past a few tenants | 1–2 sessions | server-side query params |
| **P3** | Responsive / mobile layout (§2.9) | Operator convenience | 1–2 sessions | — |
| **P3** | Error/confirm/skeleton UX polish (§2.10) | Professionalism; avoids raw error leakage | 1 session | — |
| **P3** | Accessibility pass (§2.12) | Needed before third-party operators | 1 session | — |
| **Later** | Billing / plans / seat limits (§2.11) | Only if sold as SaaS | 4–6 sessions | Stripe + schema |

---

## 4. Technical Notes for the Top Items

### 4.1 Branding pipeline (P0)
The data already exists; the work is on the **read** side.

1. On estimator load, resolve the current tenant (by authenticated user's `tenant_id`, or by `slug`/`domain` for a future public entry point) and fetch its `tenants` row + `settings`.
2. Replace hardcoded header/tagline/address/license literals in `PricingEstimator.html` with values from that row.
3. Drive CSS via variables — set `--primary` / `--accent` from `settings.color_primary` / `settings.color_accent` at runtime instead of the fixed `#1a3a5c` / `#e8500a`.
4. Feed `logo_url`, `license`, and `insurance` into the PDF cover generation (currently a styled literal around line 3804).
5. Apply the same to `admin.html`, `quotes.html`, `reports.html`, `signing.html`, and `change-orders.html` so the whole suite is tenant-aware.

Suggested shared helper: a small `applyTenantBranding(tenant)` function loaded on every page, so branding logic lives in one place.

### 4.2 Logo upload (P0)
Add a Supabase Storage bucket (e.g. `org-logos`, public read). In the design form, add a file input that uploads to `org-logos/{tenant_id}/logo.<ext>` and writes the resulting public URL into `logo_url`. Keep the URL field as a fallback for externally hosted logos.

### 4.3 Edge-function extensions
`manage-tenant` currently handles `list_tenants`, `list_all_users`, `list_org_users`, `create`, `update`, `update_user`. To support the backlog, add:

- `delete_tenant` (soft-delete preferred: set `deleted_at` rather than hard delete) and `delete_user`.
- `tenant_stats` — return per-tenant `{ user_count, quote_count, last_activity }` in one call so the grid and stats strip stop showing `'—'`.
- `resend_invite` / `revoke_invite` for the invitation lifecycle.

Keep the existing pattern: verify caller role with the service-role key before every write.

### 4.4 Audit log
A single `audit_log` table (`id, actor_id, actor_email, action, target_type, target_id, tenant_id, before JSONB, after JSONB, created_at`) written from inside `manage-tenant` on every mutating operation, surfaced as a read-only "Activity" tab in the console.

---

## 5. Security & Operational Notes

- The client-side `PLATFORM_EMAIL` check is **UX only**; real enforcement is the role re-check inside `manage-tenant`. Keep it that way — never move authorization logic that matters into the browser.
- The anon key and Supabase URL are in the client, which is expected for Supabase; the protection is Row-Level Security plus the edge-function role gate. Any new table added for the items above (audit log, billing, invites) must ship with RLS policies, not rely on the console being the only caller.
- Writes deliberately route through the edge function to work around a PostgREST ES256 JWT limitation noted in the code. New write paths should follow the same route rather than hitting PostgREST directly.
- Stop surfacing raw edge-function/Postgres error strings in toasts (§2.10) — map them to user-safe messages.

---

## 6. Open Questions to Resolve Before Building

1. **Is this a single-operator tool or a sold SaaS?** Determines whether §2.11 (billing/seats) and the invitation lifecycle are worth building now.
2. **Tenant resolution for the estimator** — will orgs be reached by authenticated login only, or also by public `slug`/`domain`? This shapes §4.1 step 1.
3. **Should deactivated/deleted orgs be hidden, archived, or hard-deleted?** Affects §2.5 and the audit story.
4. **Who besides the platform owner should reach this console?** Today it is one email; if `super_admin`s per org are expected, the login gate and tab visibility need rework.

---

*This document is a living backlog. Update the priority table as items ship, and cross-link finished platform work back into `ROADMAP.md` where it enables a product phase (e.g. branding unlocks true multi-tenant onboarding).*
