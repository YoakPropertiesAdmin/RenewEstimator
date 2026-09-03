// ============================================================
// eagleview-measurement — Supabase Edge Function
// EagleView Measurement Orders API (roof + walls/siding), with property-level storage.
//
// Actions (POST { action, ... }):
//   "products"                                   -> GetAvailableProducts
//   "price"        { report, address }           -> PriceOrder (no charge)
//   "place"        { report, address, price?, quoteId? } -> PlaceOrder (PAID) + store pending record
//   "status"       { reportId }                  -> GetReport
//   "measurements" { reportId, schema?, full? }  -> EV Measurement JSON (default: flattened summary)
//   "refresh"      { reportId }                  -> fetch status+measurements, update stored record
//
//   report: "roof" | "siding";  address: { Address, City, State, Zip, Country?, Latitude?, Longitude? }
//
// Auth: valid Supabase USER access token (Bearer).
// Secrets: EAGLEVIEW_CLIENT_ID, EAGLEVIEW_CLIENT_SECRET, EAGLEVIEW_ENV ("sandbox"|"production")
//          (SUPABASE_SERVICE_ROLE_KEY is provided automatically)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const EV_CLIENT_ID     = Deno.env.get('EAGLEVIEW_CLIENT_ID') || ''
const EV_CLIENT_SECRET = Deno.env.get('EAGLEVIEW_CLIENT_SECRET') || ''
const EV_ENV           = (Deno.env.get('EAGLEVIEW_ENV') || 'sandbox').toLowerCase()

const TOKEN_URL  = 'https://apicenter.eagleview.com/oauth2/v1/token'
const ORDER_BASE = EV_ENV === 'production' ? 'https://apicenter.eagleview.com' : 'https://sandbox.apicenter.eagleview.com'

// EagleView products the team orders. sandbox IDs must be ones with sandbox mock reports
// (106/107/108/111); production can use the account's preferred (cheaper legacy) equivalents.
const PRODUCTS: Record<string, { sandbox: number; production: number }> = {
  full:       { sandbox: 111, production: 111 },  // Full House — roof + siding (+ soffit data)
  wallsdoors: { sandbox: 107, production: 85 },   // Walls, Windows & Doors
  roof:       { sandbox: 106, production: 1 },     // Roof / Premium - Residential (roof-only)
  siding:     { sandbox: 107, production: 85 },    // back-compat alias for existing "siding" callers
}
const DELIVERY_PRODUCT_ID = 8
const MEASUREMENT_INSTRUCTION = 3
const MEASUREMENT_JSON_FILETYPE = 107
const DEFAULT_TENANT = '5249f9c0-9fca-46c8-896c-4e35be437024'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

function svcClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

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
  if (!r.ok || !d.access_token) throw new Error(`EagleView token failed (${r.status}): ${JSON.stringify(d)}`)
  _token = d.access_token
  _tokenExp = Date.now() + (Number(d.expires_in || 3600) * 1000)
  return _token
}

async function evFetch(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const token = await getToken()
  const res = await fetch(ORDER_BASE + path, { ...init, headers: { ...(init.headers || {}), 'Authorization': `Bearer ${token}` } })
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt) + Math.random() * 300))
    return evFetch(path, init, attempt + 1)
  }
  return res
}

function summarizeProducts(d: any) {
  const arr = Array.isArray(d) ? d : (Array.isArray(d?.products) ? d.products : [])
  return arr.map((p: any) => ({
    productID: p?.productID ?? p?.ProductID ?? null,
    name: p?.name ?? p?.Name ?? null,
    isRoofProduct: p?.IsRoofProduct ?? p?.isRoofProduct ?? null,
    priceMin: p?.priceMin ?? p?.PriceMin ?? null,
    priceMax: p?.priceMax ?? p?.PriceMax ?? null,
  }))
}

function schemaPreview(o: any, depth = 0, maxDepth = 5): any {
  if (Array.isArray(o)) return o.length ? [schemaPreview(o[0], depth, maxDepth)] : []
  if (o && typeof o === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o)) {
      const v = o[k]
      if (v && typeof v === 'object') out[k] = depth < maxDepth ? schemaPreview(v, depth + 1, maxDepth) : (Array.isArray(v) ? '[…]' : '{…}')
      else out[k] = typeof v === 'number' ? v : (v === null ? null : typeof v)
    }
    return out
  }
  return typeof o
}

function extractSummary(data: any) {
  const exp = data?.EAGLEVIEW_EXPORT
  if (!exp) return null
  const os = exp?.OVERALL_SUMMARY?.ATTRIBUTE
  const arr = Array.isArray(os) ? os : (os ? [os] : [])
  const summary: Record<string, unknown> = {}
  for (const a of arr) {
    const n = a?.['@name']; const v = a?.['@value']
    if (n != null) summary[String(n)] = v
  }
  const structs = exp?.STRUCTURES
  return {
    reportId: exp?.REPORT?.['@reportId'] ?? null,
    location: exp?.LOCATION ?? null,
    structureCount: Array.isArray(structs) ? structs.length : (structs ? 1 : 0),
    summary,
  }
}

function addrKey(a: any) {
  return [a?.Address, a?.City, a?.State, a?.Zip].map((x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|')
}

function extractReportId(d: any): string | null {
  if (!d) return null
  // PlaceOrder returns { OrderId, ReportIds: [<reportId>] }. Measurements are keyed by ReportId,
  // NOT OrderId — so prefer ReportIds. OrderId is only a last-resort fallback.
  const cands = [
    Array.isArray(d?.ReportIds) ? d.ReportIds[0] : null,
    Array.isArray(d?.reportIds) ? d.reportIds[0] : null,
    d?.reportId, d?.ReportId,
    Array.isArray(d?.reports) ? d.reports[0]?.reportId : null,
    Array.isArray(d?.OrderReports) ? (d.OrderReports[0]?.ReportId ?? d.OrderReports[0]?.reportId) : null,
    Array.isArray(d?.Reports) ? (d.Reports[0]?.ReportId ?? d.Reports[0]?.reportId) : null,
    d?.orderId, d?.OrderId,
  ]
  for (const c of cands) if (c != null && c !== '') return String(c)
  return null
}

function buildOrderPayload(report: string, a: any) {
  const map = PRODUCTS[report]
  if (!map) throw new Error(`Unknown report type: ${report} (use "roof" or "siding")`)
  const pid = EV_ENV === 'production' ? map.production : map.sandbox
  return {
    OrderReports: [{
      ReportAddresses: [{
        Address: a?.Address ?? null, City: a?.City ?? null, State: a?.State ?? null,
        Zip: a?.Zip ?? null, Country: a?.Country ?? 'US',
        Latitude: a?.Latitude ?? null, Longitude: a?.Longitude ?? null, AddressType: 1,
      }],
      ReportAttributes: null, BuildingId: null,
      PrimaryProductId: pid, DeliveryProductId: DELIVERY_PRODUCT_ID, AddOnProductIds: null,
      MeasurementInstructionType: MEASUREMENT_INSTRUCTION,
      ClaimNumber: null, ClaimInfo: null, BatchId: null, CatId: null,
      ChangesInLast4Years: false, PONumber: null, Comments: null, ReferenceID: null,
      InsuredName: null, UpgradeFromReportId: null, PolicyNumber: null,
    }],
    PromoCode: null, PlaceOrderUser: null, CreditCardData: null,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: { user }, error: aerr } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
    if (aerr || !user) return json({ error: 'Invalid token' }, 401)
    if (!EV_CLIENT_ID || !EV_CLIENT_SECRET) return json({ error: 'EagleView credentials not configured' }, 500)

    const body = await req.json().catch(() => ({} as any))
    const action = String(body.action || 'products').toLowerCase()

    if (action === 'products') {
      const r = await evFetch('/v2/Product/GetAvailableProducts', { method: 'GET' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) return json({ error: `GetAvailableProducts failed (${r.status})`, detail: d }, r.status)
      return json({ ok: true, env: EV_ENV, products: summarizeProducts(d), raw: d })
    }

    if (action === 'price' || action === 'place') {
      const report = String(body.report || 'roof').toLowerCase()
      const payload = buildOrderPayload(report, body.address || {})
      const path = action === 'price' ? '/v2/Order/PriceOrder' : '/v2/Order/PlaceOrder'
      const r = await evFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) return json({ error: `${action} failed (${r.status})`, detail: d, sent: payload }, r.status)

      if (action === 'price') {
        return json({ ok: true, action, env: EV_ENV, report, productId: payload.OrderReports[0].PrimaryProductId, result: d })
      }

      // PLACE: store a pending property-level record (service role)
      const evId = extractReportId(d)
      let insertError: string | null = null
      let record: unknown = null
      try {
        const svc = svcClient()
        let tenant = DEFAULT_TENANT
        const { data: urow } = await svc.from('users').select('tenant_id').eq('id', user.id).maybeSingle()
        if (urow?.tenant_id) tenant = urow.tenant_id
        const a = body.address || {}
        const rec = {
          tenant_id: tenant, report_type: report, ev_report_id: evId ? String(evId) : null,
          product_id: payload.OrderReports[0].PrimaryProductId, delivery_product_id: DELIVERY_PRODUCT_ID,
          status: 'ordered', address: a.Address ?? null, city: a.City ?? null, state: a.State ?? null, zip: a.Zip ?? null,
          address_key: addrKey(a), price: body.price ?? null, quote_id: body.quoteId ?? null,
          ordered_by: user.id, raw: d,
        }
        const { data: ins, error: ierr } = await svc.from('eagleview_reports').insert(rec).select().single()
        record = ins; insertError = ierr ? ierr.message : null
      } catch (e) { insertError = String((e as Error).message || e) }

      return json({ ok: true, action: 'place', env: EV_ENV, report, productId: payload.OrderReports[0].PrimaryProductId, evReportId: evId, record, insertError, result: d })
    }

    if (action === 'status') {
      const reportId = body.reportId
      if (!reportId) return json({ error: 'reportId is required' }, 400)
      const r = await evFetch(`/v2/Report/GetReport?reportId=${encodeURIComponent(reportId)}`, { method: 'GET' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) return json({ error: `GetReport failed (${r.status})`, detail: d }, r.status)
      return json({ ok: true, env: EV_ENV, report: d })
    }

    if (action === 'measurements') {
      const reportId = body.reportId
      if (!reportId) return json({ error: 'reportId is required' }, 400)
      const fileType = body.fileType || MEASUREMENT_JSON_FILETYPE
      const r = await evFetch(`/v1/File/GetReportFileAnyFormat?fileType=${fileType}&reportId=${encodeURIComponent(reportId)}`, { method: 'GET' })
      const text = await r.text()
      if (!r.ok) return json({ error: `GetReportFileAnyFormat failed (${r.status})`, detail: text.slice(0, 500) }, r.status)
      let data: unknown = text
      try { data = JSON.parse(text) } catch { /* text */ }
      if (body.full) return json({ ok: true, env: EV_ENV, reportId, fileType, measurements: data })
      if (body.schema && data && typeof data === 'object') return json({ ok: true, env: EV_ENV, reportId, fileType, schema: schemaPreview(data) })
      return json({ ok: true, env: EV_ENV, reportId, fileType, summary: extractSummary(data) })
    }

    // refresh: pull latest status + measurements and update the stored record
    if (action === 'refresh') {
      const evId = body.reportId
      if (!evId) return json({ error: 'reportId is required' }, 400)
      const mres = await evFetch(`/v1/File/GetReportFileAnyFormat?fileType=${MEASUREMENT_JSON_FILETYPE}&reportId=${encodeURIComponent(evId)}`, { method: 'GET' })
      const mtext = await mres.text()
      let mdata: any = mtext; try { mdata = JSON.parse(mtext) } catch { /* text */ }
      const summary = extractSummary(mdata)
      const complete = mres.ok && summary && summary.summary && Object.keys(summary.summary).length > 0
      try {
        const svc = svcClient()
        const patch = complete
          ? { status: 'complete', measurements: summary, delivered_at: new Date().toISOString() }
          : { status: 'processing' }
        await svc.from('eagleview_reports').update(patch).eq('ev_report_id', String(evId))
      } catch { /* best effort */ }
      return json({ ok: true, env: EV_ENV, reportId: evId, status: complete ? 'complete' : 'processing', summary })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})
