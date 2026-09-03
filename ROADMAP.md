# Renew Home Exteriors — Platform Roadmap

**Current State (Completed):** Full quoting estimator, 6 templates, 134 products, Supabase persistence, role-gated admin, combined contract + authorization form, multi-page PDF export, UETA-compliant e-signature system (ready to deploy).

---

## Phase 1 — Change Orders

**Goal:** Allow reps to modify an existing signed contract without voiding it — keeping a clean audit trail of what changed, when, and why.

### What Gets Built
- `change-orders.html` — standalone page linked from the My Quotes list
- Rep opens a saved quote → clicks **+ Add Change Order**
- Fills in: what's changing (add/remove items, price adjustments), reason, new totals
- System creates a change order record in Supabase linked to the original quote
- Change order is sent for e-signature through the same UETA signing flow
- Both parties sign the change order; it attaches to the parent quote's audit trail

### Database
```
change_orders
  id, quote_id, tenant_id, created_by
  change_number (CO-001, CO-002…)
  description, reason
  items_added JSONB, items_removed JSONB
  original_total, new_total, delta
  status (draft | sent | signed | void)
  signing_session_id
  created_at, signed_at
```

### UI Changes to PricingEstimator.html
- My Quotes list: add **📝 Change Order** button per row (for signed quotes)
- Quote detail view: show attached change order history

### Estimated Scope
3–4 sessions to build and wire in.

---

## Phase 2 — Customer Portal

**Goal:** Give customers a self-service page where they can view their documents, track project status, and access signed contracts — without needing a rep to email them.

### What Gets Built
- `portal.html` — public-facing page, no Supabase login required
- Access via a unique token link emailed at signing (same token pattern as signing page)
- Customer sees:
  - Their signed contract (full PDF view)
  - Any change orders on the project
  - Project status timeline (Estimate → Signed → Scheduled → In Progress → Complete)
  - Company contact info and rep name
  - Link to re-download their PDF

### Database Additions
```
project_status (added to quotes table)
  status_stage TEXT  -- estimate|signed|measured|scheduled|in_progress|complete
  status_notes TEXT
  status_updated_at TIMESTAMPTZ
  status_updated_by UUID

customer_portal_tokens
  id, quote_id, token (unique), created_at, expires_at
```

### Key Design Decisions
- Token-only access — no customer account creation required
- Portal token generated at signing and included in the signed confirmation email
- Status updates done by rep or admin through admin.html (new Status tab)
- Mobile-first layout — most customers will open on their phone

### Estimated Scope
4–5 sessions. Portal page is largely display-only; the admin status update UI is the main build effort.

---

## Phase 3 — EagleView API Integration

**Goal:** Pull accurate aerial roof measurements directly into the estimator by entering an address — eliminating the need for a rep to manually enter square footage.

### How EagleView Works
- Rep enters customer address → clicks **📡 Get Measurements**
- The estimator calls EagleView's API (via a Supabase Edge Function to keep the API key server-side)
- EagleView returns: total roof area (squares), pitch, eave length, ridge length, hip/valley lengths, facets
- Data auto-populates the roof SQ and pitch fields in the estimator
- An aerial image of the property is pulled and embedded in the PDF cover page (replacing the photo placeholder)

### Architecture
```
Browser → Edge Function (supabase/functions/eagleview-measure) → EagleView API
```
The Edge Function proxies the request so the EagleView API key never touches the browser.

### EagleView API Requirements
- Account: https://eaiv.com / EagleView Connect
- Credentials needed: API_KEY, USERNAME, PASSWORD (or OAuth2 client credentials)
- Report type to request: **PremiumResidential** or **QuickSquares**
- Cost per report: varies by plan (~$8–$25 per pull — confirm with your EagleView rep)
- Turnaround: QuickSquares = near-instant; PremiumResidential = 24–48 hrs

### Supabase Secrets Needed
```
EAGLEVIEW_CLIENT_ID
EAGLEVIEW_CLIENT_SECRET
EAGLEVIEW_REPORT_TYPE  (default: QuickSquares)
```

### UI Changes
- New **📡 EagleView** button next to the address field in the sidebar
- Loading spinner while report is fetched
- Confirmation modal showing the returned measurements before applying
- Aerial image stored in Supabase Storage and linked to the quote

### Estimated Scope
3–4 sessions once API credentials are in hand. Most complexity is in the EagleView OAuth handshake and report polling (PremiumResidential is async).

---

## Phase 4 — Google Maps / Aerial Fallback

**Goal:** When EagleView is not used (small jobs, quick estimates, no API budget), pull a satellite image of the property via Google Maps for the PDF cover page and provide a basic manual measurement overlay.

### What Gets Built
- **Static Maps embed**: pull a satellite photo of the customer address via Google Maps Static API and embed it in the PDF cover page automatically — no more placeholder box
- **Optional sketch tool**: simple overlay on the map image where reps can trace roof planes and get an approximate square footage (canvas-based, no EagleView needed)

### Google APIs Needed
- **Maps Static API** — satellite photo by address (very low cost, ~$2 per 1,000 requests)
- **Geocoding API** — convert address to lat/lng for the static map call
- **API Key** — restricted to your domain in Google Cloud Console

### Architecture
- Static Maps calls can go directly from the browser (key is domain-restricted)
- Or proxy through a lightweight Edge Function to keep the key server-side

### UI Changes
- Address field: when filled, auto-fetch the satellite image silently
- Image appears in a small preview in the sidebar
- PDF cover page uses the real satellite photo instead of the placeholder box

### Estimated Scope
2–3 sessions. Much simpler than EagleView — no async polling, no per-report cost model.

---

## Further Growth — After Phase 4

### Scheduling & Dispatch
- Calendar view for reps to see all open/signed/scheduled jobs
- Google Calendar integration for rep appointments
- Automated text/email reminders to customers for measurement day and install day

### Mobile Rep App
- Lightweight PWA (installable on iPhone/Android) version of the estimator
- Works offline — syncs when back online
- Photo capture and upload directly from the job site
- On-device signature capture for in-person closings

### Payments Integration
- ACH / credit card collection via Stripe at signing
- Deposit automated: customer signs → system charges the deposit amount
- Balance-due reminders tied to project status stages

### CRM & Lead Pipeline
- Leads table: track prospects before they become quotes
- Pipeline view: Lead → Estimate Sent → Follow-up → Won / Lost
- Rep performance dashboard: close rate, average ticket, revenue by template type

### Supplier Price Sync
- Connect to supplier price lists (CSV import or API if available)
- Alert when a product price changes by more than X%
- One-click price list update across all products

### Reporting & Analytics
- Revenue dashboard: monthly/quarterly bookings, signed vs. unsigned quotes
- Template performance: which products are quoted most, which close best
- Rep leaderboard

### Franchise / Multi-Branch Support
- Multi-tenant expansion: each branch has its own tenant_id, product list, and reps
- Central admin view across all branches
- Royalty/fee tracking if franchising model is pursued

---

## Summary Timeline

| Phase | What | Effort |
|---|---|---|
| **1** | Change Orders | 3–4 sessions |
| **2** | Customer Portal | 4–5 sessions |
| **3** | EagleView Integration | 3–4 sessions (+ API credentials) |
| **4** | Google Maps Fallback | 2–3 sessions |
| **Growth** | Scheduling, Mobile, Payments, CRM… | Ongoing |

---

*Last updated: June 2026*
