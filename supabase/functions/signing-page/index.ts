// ============================================================
// signing-page — Supabase Edge Function
// GET  ?token=<64-char hex>           → 302 redirect to static signing page
// GET  ?token=<64-char hex>&data=1    → JSON session data (called by static page)
// No auth required — token IS the authentication.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SIGNING_PAGE_URL      = 'https://sign.renewhomeexteriors.com'  // customer signing page host (hardcoded; overrides old SIGNING_PAGE_URL secret)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  const url   = new URL(req.url)
  const token = url.searchParams.get('token')
  const isData = url.searchParams.get('data') === '1'

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  // ── Validate token ──────────────────────────────────────────
  if (!token || token.length !== 64) {
    if (isData) return json({ error: 'Invalid signing link.' }, 400)
    // For direct browser visits without data=1, redirect to static page so it can show the error UI
    if (SIGNING_PAGE_URL) {
      return new Response(null, { status: 302, headers: { Location: SIGNING_PAGE_URL + '?token=invalid' } })
    }
    return json({ error: 'Signing page not configured. Please contact Renew Home Exteriors.' }, 503)
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}` } },
  })

  // ── Fetch session ───────────────────────────────────────────
  const { data: session, error } = await svc
    .from('signing_sessions')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !session) {
    if (isData) return json({ error: 'This signing link does not exist. Please contact Renew Home Exteriors.' }, 404)
    if (SIGNING_PAGE_URL) return new Response(null, { status: 302, headers: { Location: SIGNING_PAGE_URL + '?token=' + token } })
    return json({ error: 'Session not found.' }, 404)
  }

  // ── Expiry check ────────────────────────────────────────────
  if (new Date(session.expires_at) < new Date() && session.status !== 'signed') {
    await svc.from('signing_sessions').update({ status: 'expired' }).eq('id', session.id)
    const msg = `This signing link expired on ${new Date(session.expires_at).toLocaleDateString('en-US', { dateStyle: 'long' })}. Please contact RHEOhio@gmail.com or call (330) 208-9366 to request a new link.`
    if (isData) return json({ error: msg, expired: true }, 410)
    if (SIGNING_PAGE_URL) return new Response(null, { status: 302, headers: { Location: SIGNING_PAGE_URL + '?token=' + token } })
    return json({ error: msg, expired: true }, 410)
  }

  // ── Redirect (non-data requests go to static page) ─────────
  if (!isData) {
    if (!SIGNING_PAGE_URL) {
      return json({ error: 'Signing page URL not configured. Please contact Renew Home Exteriors.' }, 503)
    }
    return new Response(null, {
      status: 302,
      headers: { Location: SIGNING_PAGE_URL + '?token=' + token },
    })
  }

  // ── DATA MODE: return JSON + mark as viewed ─────────────────
  if (session.status === 'pending') {
    await svc.from('signing_sessions')
      .update({ status: 'viewed', viewed_at: new Date().toISOString() })
      .eq('id', session.id)
    await svc.from('signing_events').insert({
      session_id: session.id,
      event_type: 'page_viewed',
      ip_address: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || null,
      user_agent: req.headers.get('user-agent') || null,
    })
  }

  // Return all fields needed by the static page for both signing and signed-view states
  return json({
    status:             session.status,
    customer_name:      session.customer_name,
    customer_email:     session.customer_email,
    document_html:      session.document_html,
    document_summary:   session.document_summary,
    expires_at:         session.expires_at,
    // Signed-view fields (only populated when status === 'signed')
    signed_at:          session.signed_at,
    signer_name_typed:  session.signer_name_typed,
    signer_ip:          session.signer_ip,
    ueta_consent_given: session.ueta_consent_given,
    ueta_consent_at:    session.ueta_consent_at,
    signature_data:          session.signature_data,
    completed_document_html: session.completed_document_html,
  })
})
