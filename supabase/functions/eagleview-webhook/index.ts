// ============================================================
// eagleview-webhook — Supabase Edge Function (PUBLIC: verify_jwt = false)
// Receives EagleView Measurement Orders webhooks (OrderStatusUpdate, FileDelivery, etc.),
// verifies EagleView's signed JWT, then pulls the EV Measurement JSON and updates the
// matching public.eagleview_reports record.
//
// Register this function's URL in the EagleView portal app's webhook settings:
//   https://<project>.supabase.co/functions/v1/eagleview-webhook
// EagleView appends /OrderStatusUpdate?ReportId=...&StatusId=... etc.
//
// Secrets: EAGLEVIEW_CLIENT_ID, EAGLEVIEW_CLIENT_SECRET, EAGLEVIEW_ENV, (SUPABASE_SERVICE_ROLE_KEY auto)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const EV_CLIENT_ID     = Deno.env.get('EAGLEVIEW_CLIENT_ID') || ''
const EV_CLIENT_SECRET = Deno.env.get('EAGLEVIEW_CLIENT_SECRET') || ''
const EV_ENV           = (Deno.env.get('EAGLEVIEW_ENV') || 'sandbox').toLowerCase()

const TOKEN_URL  = 'https://apicenter.eagleview.com/oauth2/v1/token'
const ORDER_BASE = EV_ENV === 'production' ? 'https://apicenter.eagleview.com' : 'https://sandbox.apicenter.eagleview.com'
const JWKS = createRemoteJWKSet(new URL('https://evkeys.eagleview.com/auth/jwks.json'))

function svcClient() { return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) }

let _token = ''
let _tokenExp = 0
async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExp - 60_000) return _token
  const basic = btoa(`${EV_CLIENT_ID}:${EV_CLIENT_SECRET}`)
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.access_token) throw new Error(`token failed ${r.status}`)
  _token = d.access_token
  _tokenExp = Date.now() + (Number(d.expires_in || 3600) * 1000)
  return _token
}

function extractSummary(data: any) {
  const exp = data?.EAGLEVIEW_EXPORT
  if (!exp) return null
  const os = exp?.OVERALL_SUMMARY?.ATTRIBUTE
  const arr = Array.isArray(os) ? os : (os ? [os] : [])
  const summary: Record<string, unknown> = {}
  for (const a of arr) { const n = a?.['@name']; const v = a?.['@value']; if (n != null) summary[String(n)] = v }
  const structs = exp?.STRUCTURES
  return { reportId: exp?.REPORT?.['@reportId'] ?? null, location: exp?.LOCATION ?? null, structureCount: Array.isArray(structs) ? structs.length : (structs ? 1 : 0), summary }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  // Verify EagleView's signed JWT (proves authenticity; also checks exp + issuer).
  const auth = req.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  try {
    if (!token) throw new Error('missing token')
    await jwtVerify(token, JWKS, { issuer: 'https://auth.eagleview.com' })
  } catch (_e) {
    return new Response('unauthorized', { status: 401 })
  }

  const reportId = url.searchParams.get('ReportId') || url.searchParams.get('reportId')
  const statusId = url.searchParams.get('StatusId')
  const subStatusId = url.searchParams.get('SubStatusId')

  if (reportId) {
    let summary: any = null
    let complete = false
    try {
      const tkn = await getToken()
      const mres = await fetch(`${ORDER_BASE}/v1/File/GetReportFileAnyFormat?fileType=107&reportId=${encodeURIComponent(reportId)}`, {
        headers: { 'Authorization': `Bearer ${tkn}` },
      })
      const mtext = await mres.text()
      let md: any = mtext; try { md = JSON.parse(mtext) } catch { /* text */ }
      summary = extractSummary(md)
      complete = mres.ok && summary?.summary && Object.keys(summary.summary).length > 0
    } catch { /* ignore */ }
    try {
      const svc = svcClient()
      const patch = complete
        ? { status: 'complete', measurements: summary, delivered_at: new Date().toISOString() }
        : { status: 'processing' }
      await svc.from('eagleview_reports').update(patch).eq('ev_report_id', String(reportId))
    } catch { /* best effort */ }
  }

  // EagleView expects a 2xx acknowledgement.
  return new Response(JSON.stringify({ ok: true, reportId, statusId, subStatusId }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
