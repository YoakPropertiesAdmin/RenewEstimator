# E-Signature Setup Guide
## Renew Home Exteriors — UETA-Compliant Electronic Signing

This guide walks you through activating the **📧 Send for Signature** button so documents
are emailed to customers with a legally binding, UETA-compliant signing link.

---

## How It Works (Overview)

1. Rep fills out quote → clicks **📧 Send for Signature**
2. The complete document package is emailed to the **customer** and to **RHEOhio@gmail.com**
3. Customer clicks the secure link → reviews the full document → draws signature → submits
4. Both parties receive a **signed confirmation email** with the audit record
5. The quote's signing status updates to ✅ **Signed** in the My Quotes list

---

## Step 1 — Run the Database Migration

In your **Supabase Dashboard** → SQL Editor, paste and run the contents of:
```
supabase/migrations/20260612_signing.sql
```

This adds:
- `signing_sessions` table (frozen document + UETA evidence package)
- `signing_events` table (append-only audit log)
- `signing_status` / `signing_session_id` / `signed_at` columns on `quotes`

---

## Step 2 — Set Up Resend (Free Email Service)

1. Go to **https://resend.com** and create a free account
   - Free tier: 3,000 emails/month, no credit card required

2. In Resend → **API Keys** → Create API Key → copy it (starts with `re_`)

3. In Resend → **Domains** → Add your domain (`renewhomeexteriorsohio.com`)
   - Add the DNS records Resend shows you (takes 5–30 min to verify)
   - Once verified, your **FROM email** will be `estimates@renewhomeexteriorsohio.com`
   
   > **Testing without a domain:** Use `onboarding@resend.dev` as the FROM address.
   > It works but can only send to your own verified Resend email address during testing.

---

## Step 3 — Install Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# Windows (PowerShell)
winget install Supabase.CLI

# Or download from: https://github.com/supabase/cli/releases
```

Log in:
```bash
supabase login
```

---

## Step 4 — Link Your Project

In the `Pricingestimator` folder:
```bash
supabase link --project-ref chnkkcdstxtfnoqelwgz
```

---

## Step 5 — Set Secrets

```bash
# Required: your Resend API key
supabase secrets set RESEND_API_KEY=re_YOUR_KEY_HERE

# Required: the FROM email address (must be verified in Resend)
supabase secrets set RESEND_FROM_EMAIL=estimates@renewhomeexteriorsohio.com

# Note: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set automatically
```

---

## Step 6 — Deploy the Edge Functions

```bash
supabase functions deploy send-for-signature  --no-verify-jwt
supabase functions deploy signing-page        --no-verify-jwt
supabase functions deploy complete-signing    --no-verify-jwt
```

> `--no-verify-jwt` is needed for `signing-page` and `complete-signing` because
> customers access them via token (no Supabase session). `send-for-signature` still
> validates the rep's Bearer token internally.

---

## Step 7 — Test It

1. Open `PricingEstimator.html` and log in
2. Build a quote with a customer name + email
3. Click **📧 Send for Signature**
4. Enter a real email you can check and click **Send Now**
5. Open the signing link from the email → review the document → sign
6. Check both email inboxes for the signed confirmation
7. Open **My Quotes** — the quote should show **✅ Signed**

---

## UETA Compliance Details

Each signing session records:

| Evidence | Where Stored |
|---|---|
| Frozen document HTML (at time of send) | `signing_sessions.document_html` |
| Customer email (identity) | `signing_sessions.customer_email` |
| Typed legal name (attribution) | `signing_sessions.signer_name_typed` |
| Drawn/typed signature (PNG) | `signing_sessions.signature_data` |
| Explicit UETA consent checkbox + timestamp | `signing_sessions.ueta_consent_given / ueta_consent_at` |
| IP address at time of signing | `signing_sessions.signer_ip` |
| Browser/device fingerprint | `signing_sessions.signer_user_agent` |
| Signing timestamp | `signing_sessions.signed_at` |
| Full audit log | `signing_events` table |

Signing links expire after **30 days**. Documents are retained indefinitely in the database.

---

## Edge Function URLs (after deployment)

| Function | URL |
|---|---|
| Send for signature | `https://chnkkcdstxtfnoqelwgz.supabase.co/functions/v1/send-for-signature` |
| Customer signing page | `https://chnkkcdstxtfnoqelwgz.supabase.co/functions/v1/signing-page?token=XXX` |
| Complete signing | `https://chnkkcdstxtfnoqelwgz.supabase.co/functions/v1/complete-signing` |

---

## Troubleshooting

**"Email not configured" message in modal**
→ Run `supabase secrets set RESEND_API_KEY=re_...` and redeploy the functions.
→ The signing link is still created and shown so you can share it manually.

**"Popup blocked" when clicking Full PDF Package**
→ Allow popups for your estimator URL in your browser settings.

**Customer can't find the email**
→ Check spam folder. For delivery issues, verify your domain in Resend.

**Signing link expired**
→ Click 📧 Send for Signature again — a new session is created automatically.

**Functions not found (404)**
→ Re-run `supabase functions deploy ...` — make sure you're linked to the right project.

---

## File Structure Created

```
supabase/
  migrations/
    20260612_signing.sql           ← Run this in Supabase SQL Editor
  functions/
    send-for-signature/index.ts    ← Creates session + sends Resend emails
    signing-page/index.ts          ← Renders the customer signing page
    complete-signing/index.ts      ← Records signature + sends confirmations
SIGNING_SETUP.md                   ← This file
```
