// ============================================================
// send-for-signature — Supabase Edge Function
// Creates a UETA signing session and emails both parties.
// POST /functions/v1/send-for-signature
// Auth: Bearer <user_access_token>
// Body: { quote_id?, customer_name, customer_email, document_html,
//          document_summary, tenant_id }
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY          = Deno.env.get('RESEND_API_KEY') || ''
const FROM_EMAIL              = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev'
const COMPANY_NAME            = 'Renew Home Exteriors'
const COMPANY_EMAIL           = 'RHEOhio@gmail.com'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Helper: send one email via Resend ─────────────────────────
async function sendEmail(to: string, subject: string, html: string, replyTo?: string) {
  if (!RESEND_API_KEY) {
    console.warn('[send-for-signature] RESEND_API_KEY not set — email skipped')
    return { skipped: true }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:     `${COMPANY_NAME} <${FROM_EMAIL}>`,
      to:       [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

// ── Helper: customer signing invitation email ─────────────────
function customerEmailHtml(
  customerName: string,
  signingUrl:   string,
  summary:      Record<string, unknown>,
  expiresDate:  string,
) {
  const total = summary.total
    ? `$${Number(summary.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#1e2a38;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4">
<div style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#1a3a5c;padding:24px 30px">
    <div style="color:#fff;font-size:22px;font-weight:900;letter-spacing:-1px">RENEW HOME EXTERIORS</div>
    <div style="color:#93b4d0;font-size:12px;margin-top:3px">Roofing &bull; Siding &bull; Windows &bull; Doors</div>
  </div>
  <div style="padding:30px">
    <p style="font-size:16px">Hello <strong>${customerName}</strong>,</p>
    <p>Your <strong>${summary.type || 'estimate'}</strong> from Renew Home Exteriors is ready for your review and electronic signature.</p>
    ${summary.project_num || summary.template || total ? `
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px;background:#f8f9fb;border-radius:6px;overflow:hidden">
      ${summary.project_num ? `<tr><td style="padding:10px 14px;color:#555;width:130px;border-bottom:1px solid #eee">Project #</td><td style="padding:10px 14px;font-weight:700;border-bottom:1px solid #eee">${summary.project_num}</td></tr>` : ''}
      ${summary.template   ? `<tr><td style="padding:10px 14px;color:#555;border-bottom:1px solid #eee">Product</td><td style="padding:10px 14px;border-bottom:1px solid #eee">${summary.template}</td></tr>` : ''}
      ${total              ? `<tr><td style="padding:10px 14px;color:#555">Total</td><td style="padding:10px 14px;font-weight:800;font-size:18px;color:#1a3a5c">${total}</td></tr>` : ''}
    </table>` : ''}
    <div style="text-align:center;margin:30px 0">
      <a href="${signingUrl}"
         style="background:#2e7d32;color:#fff;padding:16px 36px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:700;display:inline-block;letter-spacing:.3px">
        ✍️ &nbsp;Review &amp; Sign Document
      </a>
    </div>
    <p style="font-size:12px;color:#888;line-height:1.7">
      This signing link is active until <strong>${expiresDate}</strong>.<br>
      By signing electronically you agree to the use of electronic records and signatures
      for this transaction as defined by the Uniform Electronic Transactions Act (UETA)
      and the federal E-SIGN Act.
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="font-size:12px;color:#aaa">
      Questions? Contact us: &nbsp;
      <a href="tel:3302089366" style="color:#1a6bc4">(330) 208-9366</a> &nbsp;|&nbsp;
      <a href="mailto:${COMPANY_EMAIL}" style="color:#1a6bc4">${COMPANY_EMAIL}</a><br>
      1361 Wooster Rd W, Barberton, OH 44203
    </p>
  </div>
</div>
</body></html>`
}

// ── Helper: company notification email ───────────────────────
function companyEmailHtml(
  customerName:  string,
  customerEmail: string,
  signingUrl:    string,
  summary:       Record<string, unknown>,
  expiresDate:   string,
) {
  const total = summary.total
    ? `$${Number(summary.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#1e2a38;max-width:600px;margin:0 auto;padding:20px">
<div style="background:#1a3a5c;padding:18px 24px;border-radius:8px;margin-bottom:20px">
  <div style="color:#fff;font-weight:700;font-size:18px">&#10003; Signing Request Sent</div>
  <div style="color:#93b4d0;font-size:12px">Renew Home Exteriors Estimator</div>
</div>
<p>A signing request has been sent to:</p>
<p style="font-size:16px"><strong>${customerName}</strong><br>
<a href="mailto:${customerEmail}" style="color:#1a6bc4">${customerEmail}</a></p>
<table style="font-size:13px;border-collapse:collapse;width:100%;margin:14px 0">
  ${summary.project_num ? `<tr><td style="padding:5px 0;color:#555;width:120px">Project #</td><td style="padding:5px 0;font-weight:700">${summary.project_num}</td></tr>` : ''}
  ${summary.type        ? `<tr><td style="padding:5px 0;color:#555">Type</td><td style="padding:5px 0">${summary.type}</td></tr>` : ''}
  ${total               ? `<tr><td style="padding:5px 0;color:#555">Total</td><td style="padding:5px 0;font-weight:800;color:#1a3a5c;font-size:16px">${total}</td></tr>` : ''}
</table>
<p style="margin-top:18px">
  <a href="${signingUrl}" style="color:#1a6bc4">View signing page</a>
  &nbsp;(expires ${expiresDate})
</p>
<p style="font-size:11px;color:#aaa;margin-top:24px">
  You will receive another notification when the customer signs.
</p>
</body></html>`
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    // ── Auth: validate Bearer token ───────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const userToken = authHeader.replace('Bearer ', '')

    // Separate auth-check client (anon key) — keeps svcClient session clean
    const authCheckClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error: authErr } = await authCheckClient.auth.getUser(userToken)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Service-role client for all DB operations — bypasses RLS
    const svcClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` } },
    })

    // ── Parse body ────────────────────────────────────────────
    const body = await req.json()
    const {
      quote_id,
      change_order_id,
      customer_name,
      customer_email,
      document_html,
      document_summary = {},
      tenant_id,
      skip_email = false,
    } = body

    if (!customer_name || !customer_email || !document_html) {
      return new Response(JSON.stringify({ error: 'customer_name, customer_email, and document_html are required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // ── 1. Create signing session ─────────────────────────────
    const { data: session, error: sessionErr } = await svcClient
      .from('signing_sessions')
      .insert({
        quote_id:         quote_id ?? null,
        tenant_id:        tenant_id,
        sent_by:          user.id,
        customer_name,
        customer_email,
        company_email:    COMPANY_EMAIL,
        document_html,
        document_summary,
      })
      .select('id, token, expires_at')
      .single()

    if (sessionErr) throw sessionErr

    const signingUrl  = `${SUPABASE_URL}/functions/v1/signing-page?token=${session.token}`
    const expiresDate = new Date(session.expires_at).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })

    // ── 2. Update quote or change order status ────────────────
    if (quote_id && !change_order_id) {
      await svcClient
        .from('quotes')
        .update({ signing_status: 'sent', signing_session_id: session.id, status: 'sent' })
        .eq('id', quote_id)
    }
    if (change_order_id) {
      await svcClient
        .from('change_orders')
        .update({ status: 'sent', signing_session_id: session.id })
        .eq('id', change_order_id)
    }

    // ── 3. Log session_created event ─────────────────────────
    await svcClient.from('signing_events').insert({
      session_id: session.id,
      event_type: 'session_created',
      event_data: { quote_id: quote_id ?? null, sent_by: user.id },
    })

    // ── 4. Send emails (skipped for on-site signing) ─────────
    const summary = document_summary as Record<string, unknown>
    let emails_sent = false

    if (!skip_email && RESEND_API_KEY) {
      const [custResult, coResult] = await Promise.allSettled([
        sendEmail(
          customer_email,
          `Your ${summary.type || 'Estimate'} is Ready to Sign – ${COMPANY_NAME}`,
          customerEmailHtml(customer_name, signingUrl, summary, expiresDate),
          COMPANY_EMAIL,
        ),
        sendEmail(
          COMPANY_EMAIL,
          `[Signing Sent] ${customer_name} – ${summary.type || 'Estimate'}${summary.project_num ? ' #' + summary.project_num : ''}`,
          companyEmailHtml(customer_name, customer_email, signingUrl, summary, expiresDate),
        ),
      ])

      // Log email results
      await svcClient.from('signing_events').insert({
        session_id: session.id,
        event_type: 'email_sent',
        event_data: {
          customer: custResult.status === 'fulfilled' ? custResult.value : { error: String(custResult.reason) },
          company:  coResult.status  === 'fulfilled' ? coResult.value  : { error: String(coResult.reason) },
        },
      })

      emails_sent = true
    }

    return new Response(
      JSON.stringify({
        success:     true,
        session_id:  session.id,
        signing_url: signingUrl,
        emails_sent,
      }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    console.error('[send-for-signature]', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
