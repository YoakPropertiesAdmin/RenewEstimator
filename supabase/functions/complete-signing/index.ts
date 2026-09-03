// ============================================================
// complete-signing — Supabase Edge Function
// Records signature, updates DB, sends completion emails.
// POST /functions/v1/complete-signing
// No auth — token IS the authentication.
// Body: { token, signer_name, signature_data, ueta_consent,
//          consent_at, typed_name? }
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY') || ''
const FROM_EMAIL            = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev'
const COMPANY_NAME          = 'Renew Home Exteriors'
const COMPANY_EMAIL         = 'RHEOhio@gmail.com'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return { skipped: true }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${COMPANY_NAME} <${FROM_EMAIL}>`, to: [to], subject, html }),
  })
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }
}

// ── Completion email to customer ──────────────────────────────
function customerConfirmHtml(
  signerName:   string,
  signedAt:     string,
  summary:      Record<string, unknown>,
  signedDocUrl: string,
) {
  const total = summary.total
    ? `$${Number(summary.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#1e2a38;max-width:600px;margin:0 auto;padding:20px;background:#f4f4f4">
<div style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#2e7d32;padding:20px 30px">
    <div style="color:#fff;font-size:22px;font-weight:900">✅ Document Signed</div>
    <div style="color:#a5d6a7;font-size:12px;margin-top:3px">${COMPANY_NAME}</div>
  </div>
  <div style="padding:30px">
    <p>Hello <strong>${signerName}</strong>,</p>
    <p>Thank you! Your document has been signed and the record has been saved.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:13px;background:#f8f9fb;border-radius:6px;overflow:hidden">
      <tr><td style="padding:10px 14px;color:#555;width:140px;border-bottom:1px solid #eee">Signed by</td><td style="padding:10px 14px;font-weight:700;border-bottom:1px solid #eee">${signerName}</td></tr>
      <tr><td style="padding:10px 14px;color:#555;border-bottom:1px solid #eee">Date &amp; Time</td><td style="padding:10px 14px;border-bottom:1px solid #eee">${signedAt}</td></tr>
      ${summary.project_num ? `<tr><td style="padding:10px 14px;color:#555;border-bottom:1px solid #eee">Project #</td><td style="padding:10px 14px;border-bottom:1px solid #eee">${summary.project_num}</td></tr>` : ''}
      ${total ? `<tr><td style="padding:10px 14px;color:#555">Contract Total</td><td style="padding:10px 14px;font-weight:800;font-size:16px;color:#1a3a5c">${total}</td></tr>` : ''}
    </table>
    <div style="text-align:center;margin:24px 0">
      <a href="${signedDocUrl}" style="background:#1a3a5c;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:700;display:inline-block">
        📄 View Signed Document
      </a>
    </div>
    <p style="font-size:12px;color:#888;line-height:1.7">
      This signing is compliant with the Uniform Electronic Transactions Act (UETA)
      and the federal E-SIGN Act. A copy of this record is retained by
      ${COMPANY_NAME}.
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
    <p style="font-size:12px;color:#aaa">
      Questions? &nbsp;
      <a href="tel:3302089366" style="color:#1a6bc4">(330) 208-9366</a> &nbsp;|&nbsp;
      <a href="mailto:${COMPANY_EMAIL}" style="color:#1a6bc4">${COMPANY_EMAIL}</a>
    </p>
  </div>
</div>
</body></html>`
}

// ── Completion email to company ───────────────────────────────
function companySignedHtml(
  signerName:    string,
  customerEmail: string,
  signedAt:      string,
  signerIp:      string,
  summary:       Record<string, unknown>,
  signedDocUrl:  string,
  sigData?:      string,
) {
  const total = summary.total
    ? `$${Number(summary.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#1e2a38;max-width:600px;margin:0 auto;padding:20px">
<div style="background:#2e7d32;padding:16px 24px;border-radius:8px;margin-bottom:20px">
  <div style="color:#fff;font-weight:700;font-size:18px">✅ Document Signed by Customer</div>
  <div style="color:#a5d6a7;font-size:12px">${COMPANY_NAME} Estimator</div>
</div>
<p><strong>${signerName}</strong> (<a href="mailto:${customerEmail}" style="color:#1a6bc4">${customerEmail}</a>) has signed the document.</p>
<table style="font-size:13px;border-collapse:collapse;width:100%;margin:14px 0">
  ${summary.project_num ? `<tr><td style="padding:5px 0;color:#555;width:140px">Project #</td><td style="font-weight:700">${summary.project_num}</td></tr>` : ''}
  ${summary.type        ? `<tr><td style="padding:5px 0;color:#555">Document Type</td><td>${summary.type}</td></tr>` : ''}
  ${total               ? `<tr><td style="padding:5px 0;color:#555">Contract Total</td><td style="font-weight:800;color:#1a3a5c;font-size:16px">${total}</td></tr>` : ''}
  <tr><td style="padding:5px 0;color:#555">Signed At</td><td>${signedAt}</td></tr>
  <tr><td style="padding:5px 0;color:#555">IP Address</td><td>${signerIp}</td></tr>
</table>
${sigData ? `<div style="margin:16px 0"><div style="font-size:12px;color:#555;margin-bottom:6px">Electronic Signature:</div><img src="${sigData}" alt="signature" style="border:1px solid #ddd;border-radius:4px;padding:8px;background:#fff;max-width:280px;height:80px"></div>` : ''}
<p><a href="${signedDocUrl}" style="color:#1a6bc4">View full signed document &amp; audit trail →</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:20px 0">
<div style="font-size:11px;color:#aaa">
  <strong>UETA Audit Record</strong><br>
  Session token: recorded in database | IP: ${signerIp} | Timestamp: ${signedAt}
</div>
</body></html>`
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const {
      token,
      signer_name,
      signature_data,
      ueta_consent,
      consent_at,
      typed_name,
      completed_document_html,
    } = body

    if (!token || !signer_name || !signature_data || !ueta_consent) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const svc     = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` } },
    })
    const ipAddr  = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    const ua      = req.headers.get('user-agent') || ''
    const now     = new Date().toISOString()

    // ── Fetch & validate session ──────────────────────────────
    const { data: session, error: fetchErr } = await svc
      .from('signing_sessions')
      .select('*')
      .eq('token', token)
      .single()

    if (fetchErr || !session) {
      return new Response(JSON.stringify({ error: 'Invalid signing link' }), {
        status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (session.status === 'signed') {
      return new Response(JSON.stringify({ error: 'Document already signed', already_signed: true }), {
        status: 409, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    if (session.status === 'expired' || new Date(session.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'Signing link has expired' }), {
        status: 410, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // ── 1. Update signing session ─────────────────────────────
    const { error: updateErr } = await svc
      .from('signing_sessions')
      .update({
        status:                 'signed',
        signed_at:              now,
        signer_ip:              ipAddr,
        signer_user_agent:      ua,
        signer_name_typed:      signer_name,
        ueta_consent_given:     true,
        ueta_consent_at:        consent_at || now,
        signature_data,
        completed_document_html: completed_document_html || null,
      })
      .eq('id', session.id)

    if (updateErr) throw updateErr

    // ── 2. Update quote ───────────────────────────────────────
    if (session.quote_id) {
      await svc.from('quotes')
        .update({ signing_status: 'signed', signed_at: now, status: 'signed' })
        .eq('id', session.quote_id)
    }

    // ── 3. Audit event ────────────────────────────────────────
    await svc.from('signing_events').insert({
      session_id: session.id,
      event_type: 'signed',
      ip_address: ipAddr,
      user_agent: ua,
      event_data: {
        signer_name,
        typed_name: typed_name || null,
        consent_at: consent_at || now,
        signed_at:  now,
      },
    })

    // ── 4. Build signed document URL ─────────────────────────
    const signedDocUrl = `${SUPABASE_URL}/functions/v1/signing-page?token=${token}`

    // ── 5. Send completion emails ─────────────────────────────
    const signedAtFormatted = new Date(now).toLocaleString('en-US', {
      dateStyle: 'long', timeStyle: 'short',
    })
    const summary = (session.document_summary || {}) as Record<string, unknown>

    const [custRes, coRes] = await Promise.allSettled([
      sendEmail(
        session.customer_email,
        `Signed: Your ${summary.type || 'Document'} from ${COMPANY_NAME}`,
        customerConfirmHtml(signer_name, signedAtFormatted, summary, signedDocUrl),
      ),
      sendEmail(
        COMPANY_EMAIL,
        `[SIGNED] ${signer_name} – ${summary.type || 'Document'}${summary.project_num ? ' #' + summary.project_num : ''}`,
        companySignedHtml(
          signer_name, session.customer_email, signedAtFormatted,
          ipAddr, summary, signedDocUrl,
          signature_data.length < 200000 ? signature_data : undefined, // skip huge data in email
        ),
      ),
    ])

    // Log completion email event
    await svc.from('signing_events').insert({
      session_id: session.id,
      event_type: 'completion_email_sent',
      event_data: {
        customer: custRes.status === 'fulfilled' ? custRes.value : { error: String(custRes.reason) },
        company:  coRes.status  === 'fulfilled' ? coRes.value  : { error: String(coRes.reason) },
      },
    })

    return new Response(
      JSON.stringify({ success: true, signed_url: signedDocUrl }),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )

  } catch (err) {
    console.error('[complete-signing]', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
