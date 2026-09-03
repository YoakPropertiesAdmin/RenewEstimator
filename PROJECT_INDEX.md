# Project Index — Renew Home Exteriors Estimator (JGQuotes)

> Reference map of the codebase for fast, safe edits. Last indexed: 2026-07-16.
> Supabase project: **JGQuotes** `chnkkcdstxtfnoqelwgz` (region us-east-1, Postgres 17).

---

## 1. What this is

A multi-tenant pricing/estimating + e-signature web app for **Renew Home Exteriors** (roofing, siding, windows, doors — Barberton, OH). Reps build quotes from templates/products, attach photos, generate contracts, and send them for UETA-compliant electronic signature. Admins manage products/templates/financing/users; a platform layer manages tenants (multi-org / white-label via `estimator.renewhomeexteriors.com`).

- **Company constants:** Renew Home Exteriors · RHEOhio@gmail.com · (330) 208-9366 · 1361 Wooster Rd W, Barberton, OH 44203.
- **Default tenant:** slug `renew-home-exteriors`, id `5249f9c0-9fca-46c8-896c-4e35be437024`.
- **Production URL:** https://estimator.renewhomeexteriors.com

## 2. Architecture / stack

- **Front end:** static, multi-page **vanilla HTML/JS** (no framework, no build step). Each page is one big `.html` file with inline `<script>`. Styling is inline CSS.
- **Supabase JS** loaded from CDN (`@supabase/supabase-js@2` UMD). Client is `_supa` (some pages use their own name); used mainly for **Auth** and **Storage**.
- **Data access:** mostly **raw `fetch()` to PostgREST** at `SUPABASE_URL + '/rest/v1/<table>?...'` with headers `apikey: <anon>` and `Authorization: Bearer <user access_token>`. RLS enforces tenant isolation. RPC via `/rest/v1/rpc/<fn>`.
- **Auth:** Supabase Auth, **Google OAuth** (`signInWithOAuth`) primary; sessions via `auth.getSession()` / `onAuthStateChange`.
- **Hosting:** **Netlify** (static, `publish = "."`). Aggressive no-cache headers (`netlify.toml` + `_headers`). PWA: `manifest.json` + `sw.js` (service worker v19 — caches CDN assets only, never HTML or Supabase calls).
- **Email:** **Resend** API (from edge functions), `RESEND_API_KEY` / `RESEND_FROM_EMAIL` secrets.
- **Config in-page:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` are hard-coded near the top of each page's script (e.g. PricingEstimator.html ~line 966).

## 3. Auth & roles

Role is stored in `public.users.role` (text). Known roles, most→least privileged:

`platform_owner` › `super_admin` › `admin` › `director` › `rep` › `user`

- New signups → trigger `handle_new_user` (on `auth.users`) inserts a `public.users` row into the default RHE tenant as `rep`. (`handle_new_auth_user` is an alternate variant keyed off tenant slug.)
- `admin.html` invites within caller's tenant; `platform.html` can target any tenant. Invites go through the `invite-user` edge function (service role).

## 4. Pages (front end)

| File | Purpose | Main tables (REST) | Notable functions |
|---|---|---|---|
| `index.html` | Redirect → `PricingEstimator.html` | — | — |
| `PricingEstimator.html` (~4090 lines) | **Core app** — build quote, pricing, financing, photos, generate & send contract, on-site signing | quotes, quote_photos, products, templates, financing_providers, users | `saveQuote`, `loadQuote`, `renderQuote`, `getGrandTotal`, `runAutoQuote`, `calcRoofSQ`/`calcSidingSQ`, `renderAlsideTiers`, `calcFinancing`, `handlePhotoUpload`, `buildFullPDFHtml`, `generateContract`, `sendForSignature`, `startOnsiteSigning`, `fetchSatellite` |
| `quotes.html` (688) | Quote list / history, filter, assign rep, status | quotes, users | `loadQuotes`, `renderTable`, `applyFilters`, `assignRep`, `updateStatus`, `duplicateQuote`, `openInEstimator` |
| `property.html` (1069) | Per-property/customer hub: quotes, photos, change orders, stats | quotes, quote_photos, signing_sessions, change_orders, users | `loadProperty`, `renderQuotes`, `renderPhotos`, `handlePropPhotoUpload`, `newQuote`, `newCO`, `duplicateQuote`, `updateStatus` |
| `change-orders.html` (984) | Create/edit change orders against a signed contract, send for signature | change_orders, quotes, products, users | `loadChangeOrder`, `computeNewTotal`, `saveDraft`, `sendForSignature`, `buildDocHtml`, `assignChangeNumber` |
| `admin.html` (1760) | Tenant admin: products, templates, financing plans/providers, PDF library, users | products, templates, financing_plans, financing_providers, pdf_library, users, quotes | `loadProducts`/`saveProduct`, `loadTemplates`/`saveTemplate`, `loadFinancing`, `loadPDFLibrary`/`uploadPDF`, `loadUsers`/`updateUserRole`/`sendInvite`, `applyBulkPrice` |
| `platform.html` (1023) | Platform owner: manage tenants (orgs), all users, org design/branding, stats | via `manage-tenant` edge fn | `loadOrgs`, `createOrg`, `enterOrg`/`exitOrg`, `inviteUser`, `saveOrgDesign`, `loadAllUsers`, `deactivateUser` |
| `reports.html` (466) | Reporting: quotes + signing status, grouped/printable | quotes, signing_sessions, users | `loadQuotes`, `renderStats`, `printGroup`, `printUnsignedContract` |
| `signing.html` (822) | **Customer-facing** signing page (no login; token-gated). Renders doc, captures signature, submits | (edge fns only) | `loadSession`, `renderSigning`, `submitSig`, canvas signature pads, `injectIntoIframe` |

**Data-access helpers** appear per-page with different names (`dbFetch`, `sbFetch`, `sb`, `dbFetch`, raw `fetch`). No shared JS module — each page is self-contained.

## 5. Edge functions (`supabase/functions/*`, Deno)

| Function | Auth | Purpose | Key env |
|---|---|---|---|
| `invite-user` | Bearer user token; caller must be `platform_owner`/`super_admin`/`admin` | Invite or upsert a user (service role); `inviteUserByEmail`, handles already-registered | SERVICE_ROLE, ANON, `SITE_URL` |
| `manage-tenant` | Bearer user token; caller must be `platform_owner`/`super_admin` | CRUD tenants + list/update users + tenant stats (all via service role) | SERVICE_ROLE, ANON |
| `send-for-signature` | Bearer user token | Create `signing_sessions` row, update quote/CO status to `sent`, email both parties (Resend), log `signing_events` | SERVICE_ROLE, ANON, RESEND_* |
| `signing-page` | **None — token is auth** (64-char hex) | `GET ?token` → 302 to static signing page; `&data=1` → session JSON, marks `viewed`, logs event; handles expiry | SERVICE_ROLE, `SIGNING_PAGE_URL` |
| `complete-signing` | **None — token is auth** | Record signature on `signing_sessions` (status `signed`, UETA fields, IP/UA), update quote to `signed`, email confirmations, audit event | SERVICE_ROLE, RESEND_* |
| `maps-satellite` | — | Satellite image fetch (called from PricingEstimator `fetchSatellite`). **Source NOT in repo** — deployed only. | (Google/maps key, server-side) |

> Signing flow: `send-for-signature` → email link `/functions/v1/signing-page?token=…` → static `signing.html` loads session via `?data=1` → customer signs → `complete-signing`. Sessions expire 30 days (`signing_sessions.expires_at`).

## 6. Database schema (public) — 13 tables

Every business table has `tenant_id uuid` and is RLS-protected by tenant.

- **tenants** — `id, name, slug, domain, address, phone, logo_url, insurance_info jsonb, settings jsonb, active, created_at`
- **users** — `id (=auth.users.id), tenant_id, email, name, role, phone, active, created_at`
- **products** — `id text, tenant_id, name, unit, price, mat, labor, margin, tax, cat, active, sort_order, created_at, updated_at`
- **templates** — `id text, tenant_id, name, template_data jsonb, active, sort_order, …`
- **quotes** — `id, tenant_id, created_by, assigned_rep_id, customer_* , template_id, items jsonb, color_selections jsonb, totals jsonb, dimension_data jsonb, payment_data jsonb, comparison_tiers jsonb, roof_sqft, siding_sqft, discount_dollar, discount_pct, payment_down, quote_number, quote_date, status ('draft'/'sent'/'signed'), signing_status ('unsigned'/'sent'/'signed'), signing_session_id, signed_at, satellite_image_url, project_notes, notes, created_at, updated_at`
- **quote_photos** — `id, quote_id, tenant_id, url, storage_path, filename, caption, notes, sort_order, uploaded_by, created_at`
- **contracts** — `id, quote_id, tenant_id, customer_sig_data, rep_sig_data, signed_at, pdf_url, created_at`
- **change_orders** — `id, quote_id, tenant_id, co_number, original_contract*, items jsonb, totals jsonb, subtotal, tax_amt, total, customer_sig_data, rep_sig_data, signed_at, status ('draft'/'sent'/'signed'), signing_session_id, assigned_rep_id, customer_*, findings, reason, notes, created_by, created_at, updated_at`
- **signing_sessions** — `id, quote_id, change_order_id, tenant_id, sent_by, token (64-hex, unique), customer_name/email, company_email, document_html, document_summary jsonb, completed_document_html, status ('pending'/'viewed'/'signed'/'expired'), signer_ip/user_agent/name_typed, ueta_consent_given/at, signature_data, sent_at, viewed_at, signed_at, expires_at (now()+30d)`
- **signing_events** — audit log: `id, session_id, event_type, event_data jsonb, ip_address, user_agent, created_at`
- **financing_providers** — `id, tenant_id, name, logo_url, logo_storage_path, notes, active, sort_order, created_at`
- **financing_plans** — `id, provider_id, description, term_years, rate, state, active, sort_order, created_at`
- **pdf_library** — `id, tenant_id, label, filename, storage_path, storage_url, file_size, category, description, active, uploaded_by, created_at`

## 7. RLS model & helper functions

Tenant isolation is enforced by RLS on all business tables via SECURITY DEFINER helpers:

- **`private.get_my_tenant_id()`** → caller's `tenant_id` (from `public.users` by `auth.uid()`).
- **`private.get_my_role()`** → caller's `role`.

> ⚠️ These live in the **`private` schema** (moved 2026-07-16 so PostgREST doesn't expose them). RLS policies reference them by OID and keep working. **Do not call them from the frontend** — they are not on the public API. If a page ever needs the current user's role, read it from `public.users` (as pages already do).

Policy pattern (≈24 policies): `SELECT` gated by `tenant_id = private.get_my_tenant_id()`; writes additionally gated by `private.get_my_role() = ANY(...)`. Reps are further scoped to `created_by = auth.uid()` OR `assigned_rep_id = auth.uid()`. Admin/director/platform roles get tenant-wide access.

Other DB functions: `next_quote_number()` (RPC → `RHE-000001` via `quote_number_seq`), `expire_signing_sessions()`, `set_updated_at()`/`_update_signing_session_ts()`/`update_change_orders_updated_at()` (updated_at triggers), `handle_new_user()`/`handle_new_auth_user()` (auth signup → users row).

## 8. Storage buckets

- **`property-photos`** (public) — quote/property photos. App uses `upload` / `getPublicUrl` / `remove` only (never `list`). Insert/update/delete = authenticated; **no SELECT/listing policy** (removed 2026-07-16). Photo records tracked in `quote_photos`.
- **`template-pdfs`** (public, as of 2026-07-16) — holds PDF Library + template-attachment PDFs (T&Cs, warranty certs, intro letters). Object access via public URL. Insert/update/delete gated to admin role set (`platform_owner/super_admin/admin/director`) via `private.get_my_role()`. No listing policy. App lists files from the `pdf_library` table, not `storage.list()`. Upload code: `admin.html` `uploadPDF` (library) / `uploadTemplatePDF` (template blocks).
- **`contract-attachments`** (private) — authenticated upload/read, admin-role-set delete.

## 9. Security posture (post-remediation 2026-07-16)

Fixed: dropped unused `wrappers` FDW extension (+ its exposed table), pinned `search_path` on all flagged functions, removed trigger functions from the RPC surface, moved RLS helpers to `private`, dropped the broad `property-photos` listing policy.

**Remaining (manual):** enable **Leaked Password Protection** in Auth settings (dashboard toggle).

Migrations recording these: `supabase/migrations/20260716_security_phase{0,1,2}_*.sql`.

> **Sister project (not this repo):** *Job Guzzler* `sjqycxdcndsvexjabbyj` has a parallel set of advisories, including a real bug — `list_auth_users()` returns all users to any authenticated user (fix: gate on platform-admin). Not yet applied.

## 10. Repo layout & gotchas

```
/ (Netlify root)
  index.html                 → redirect to PricingEstimator.html
  PricingEstimator.html      → core app
  quotes.html property.html change-orders.html admin.html platform.html reports.html signing.html
  sw.js manifest.json favicon.ico netlify.toml _headers
  *.pdf                      → static contract/template assets shipped with the site
  supabase/
    functions/               → 5 edge functions (maps-satellite deployed but not here)
    migrations/              → SQL migrations (schema is source-of-truth on remote)
  ConsoleApplication1/       → LEGACY: old PricingEstimator.html + SumoQuotePriceList.xlsx (source data). Not part of the app.
  Pricing Estimator/         → LEGACY DUPLICATES of change-orders/platform/sw (stale — ignore; edit root copies).
```

**Editing conventions / cautions:**
- Each page is standalone — a change to shared behavior must be repeated per page.
- `SUPABASE_URL`/`SUPABASE_ANON_KEY` are inlined per page; keep consistent if changed.
- Bump `CACHE` version in `sw.js` when shipping so clients pick up changes (already `no-cache` at the HTTP layer, but the SW caches CDN shell).
- Don't reference `public.get_my_role`/`get_my_tenant_id` anywhere — they're `private` now.
- Watch the two legacy folders (`ConsoleApplication1/`, `Pricing Estimator/`) — don't accidentally edit those copies.
- Repo is in a **OneDrive** folder → occasional `.git/index.lock` from sync; pause sync if commits get blocked.
- Git remote: `origin` → github.com/eganfamily12-stack/renew-home-exteriors (branch `main`).

## 11. EagleView integration (added 2026-07-16)

Two paths, both via edge functions holding EagleView OAuth creds as Supabase secrets (`EAGLEVIEW_CLIENT_ID`, `EAGLEVIEW_CLIENT_SECRET`, `EAGLEVIEW_ENV`):

- **Quick roof estimate — Property Data API** (`eagleview-roof` edge fn). API key-era; now uses the same client-credentials. Instant-ish, roof only (area/squares/pitch). Button in the Roof Measurements section (`fetchEagleViewRoof`).
- **Full measurement reports — Measurement Orders API** (`eagleview-measurement` edge fn). Paid, async. Report types → products (`PRODUCTS` map, sandbox/production): **full** = Full House `111` (roof + siding), **wallsdoors** = Walls, Windows & Doors (prod `85` / sandbox `107`), **roof** = Roof/Premium-Residential (prod `1` / sandbox `106`); `siding` kept as a back-compat alias. `report_type` CHECK allows `roof|siding|full|wallsdoors`. Actions: `products`, `price`, `place` (stores a record), `status`, `measurements`, `refresh`. Token cached, 429 backoff. Auth = client credentials (all orders bill the one account).
- **Webhook** (`eagleview-webhook` edge fn, `verify_jwt=false`) — verifies EagleView's signed JWT (JWKS `evkeys.eagleview.com`, iss `auth.eagleview.com`), then pulls EV Measurement JSON (fileType 107) and updates the record. **Register its URL in the EagleView portal app:** `https://chnkkcdstxtfnoqelwgz.supabase.co/functions/v1/eagleview-webhook`.
- **Storage:** `public.eagleview_reports` (tenant RLS; service-role writes) — property-level, keyed by `address_key` = lowercased `address|city|state|zip`, so one report serves all quotes/change orders for an address (SumoQuote-style). Holds `report_type`, `ev_report_id`, `status`, `measurements` (flattened OVERALL_SUMMARY), `price`.
- **Estimator UI:** customer form has a **State** field (`custState`, required for orders); an "EagleView Reports" panel (`orderEagleView`, `checkEagleView`, `refreshEV`, `applyEV`) with three order buttons — **Full House (Roof + Siding)**, **Walls, Windows & Doors**, **Roof Only** — each price-confirmed. `applyEV` keys off which measurements are *present* in the report (not the button), so a Full House report fills roof + siding + soffit from one pull; a walls-only report fills siding and pulls soffit from a roof report at the same address if one exists.
- **Measurement field map** — roof: `TotalRoofArea`→roofSqft, `PredominantPitch`→pitch bucket, `TotalHipsandRidgesLength`→ridgeLF, `TotalEavesLength`→eaveLF (+gutterLF), `TotalValleysLength`→valleyLF. Siding: `TotalSidingArea`→sidingSqft, `Fascia`→fasciaLF.
- **Corners & soffit (SumoQuote-style, all editable after insert):** EagleView gives corner *length* not a count, and no soffit in the siding report — so `applyEVSiding` estimates the corner **count** = `TotalOutsideCornersLength ÷ EV_CORNER_HEIGHT_FT` (default 10 ft), and derives **soffit SQ** from the same address's roof report = `(TotalEavesLength + TotalRakesLength) × EV_SOFFIT_OVERHANG_FT ÷ 100` (default 1 ft overhang). Both tunable constants live at the top of the EagleView JS block; both fields stay manually editable. If no roof report exists for the address, soffit is left manual with a prompt.
- **Ready-report inbox (advance ordering):** `eagleview.html` — standalone team dashboard listing every report (tabs: All / Ready / Pending), deduped by `ev_report_id`, with "Open in Estimator →" (passes address via `?evaddr=&evcity=&evstate=&evzip=`) and "Check now" (calls `refresh`). In the estimator, `evAutoCheck` runs on address-field change and on load (incl. from those query params) and shows a one-click **Apply banner** (`#ev-address-banner`) when a completed report matches the address; the panel also has a **📥 All Reports** link to the dashboard.
- **Still `sandbox`** — flip `EAGLEVIEW_ENV` secret to `production` when ready. Sandbox only resolves EagleView's fixed mock addresses.
