// ============================================================
// eagleview-roof — Supabase Edge Function
// OAuth2 client-credentials -> EagleView Property Data API (roof measurements).
//
// POST { address: "123 Main St, City, ST 00000" }  -> start request (+ short inline poll)
// POST { id: "<request-id>" }                       -> poll for results
//
// Auth: caller must present a valid Supabase USER access token (Bearer).
// Secrets (set in Supabase dashboard, never in code):
//   EAGLEVIEW_CLIENT_ID, EAGLEVIEW_CLIENT_SECRET, EAGLEVIEW_ENV ("sandbox" | "production")
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY')!

const EV_CLIENT_ID     = Deno.env.get('EAGLEVIEW_CLIENT_ID') || ''
const EV_CLIENT_SECRET = Deno.env.get('EAGLEVIEW_CLIENT_SECRET') || ''
const EV_ENV           = (Deno.env.get('EAGLEVIEW_ENV') || 'sandbox').toLowerCase()

const TOKEN_URL = 'https://apicenter.eagleview.com/oauth2/v1/token'
const API_BASE  = EV_ENV === 'production'
  ? 'https://apis.eagleview.com'
  : 'https://sandbox.apis.eagleview.com'

// Roof data packs: 001 = Roof Area + Square Count, 002 = Roof Pitch + Eave Height
const ROOF_PRODUCT_IDS = ['property_data_id_001', 'property_data_id_002']

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

// ── Token cache (persists across warm invocations; respects the 4 rps auth limit) ──
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

// Fetch with token + backoff-retry on 429 / 5xx (per EagleView rate-limit guidance).
async function evFetch(path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const token = await getToken()
  const res = await fetch(API_BASE + path, {
    ...init,
    headers: { ...(init.headers || {}), 'Authorization': `Bearer ${token}` },
  })
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt) + Math.random() * 300))
    return evFetch(path, init, attempt + 1)
  }
  return res
}

// Map EagleView Property Data (packs 001 + 002) to the estimator's roof fields.
function parseRoof(d: any) {
  const structures = Array.isArray(d?.structures) ? d.structures : []
  const roofs = structures.map((s: any) => ({
    area:        s?.roof?.structure_roof_area?.value ?? null,
    squares:     s?.roof?.structure_roof_area_squares?.value ?? null,
    pitch:       s?.roof?.structure_roof_predominant_pitch?.value ?? null, // "x over 12"
    eave_height: s?.structure_eave_height?.value ?? null,
  }))
  if (!roofs.length) return { _mapped: false }

  const withArea = roofs.filter((r: any) => typeof r.area === 'number')
  const totalArea = withArea.reduce((a: number, r: any) => a + r.area, 0)
  const totalSquares = roofs.reduce((a: number, r: any) => a + (typeof r.squares === 'number' ? r.squares : 0), 0)
  const primary = withArea.slice().sort((a: any, b: any) => b.area - a.area)[0] || roofs[0]

  return {
    _mapped: true,
    structure_count: structures.length,
    total_roof_area_sqft: Math.round(totalArea * 100) / 100,
    total_roof_squares: totalSquares,
    primary_pitch: primary?.pitch ?? null,
    primary_roof_area_sqft: primary?.area ?? null,
    address: d?.response_address?.full_address ?? null,
    coordinates: d?.response_coordinates ?? null,
    structures: roofs,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // ── Require a valid Supabase user (protects EagleView usage/credits) ──
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: { user }, error: aerr } = await sb.auth.getUser(authHeader.replace('Bearer ', ''))
    if (aerr || !user) return json({ error: 'Invalid token' }, 401)

    if (!EV_CLIENT_ID || !EV_CLIENT_SECRET) {
      return json({ error: 'EagleView credentials not configured (set EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET)' }, 500)
    }

    const body = await req.json().catch(() => ({} as any))

    // ── Poll mode ──────────────────────────────────────────
    if (body.id) {
      const r = await evFetch(`/property/v2/result/${encodeURIComponent(body.id)}`, { method: 'GET' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) return json({ error: `Result fetch failed (${r.status})`, detail: d }, r.status)
      const status = d?.request?.status || d?.status || 'Unknown'
      return json({ status: String(status).toLowerCase() === 'complete' ? 'complete' : status, id: body.id, env: EV_ENV, roof: parseRoof(d), raw: d })
    }

    // ── Request mode ───────────────────────────────────────
    const address = String(body.address || '').trim()
    if (!address) return json({ error: 'address is required' }, 400)

    const r = await evFetch('/property/v2/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: { completeAddress: address }, productIds: ROOF_PRODUCT_IDS }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return json({ error: `Request failed (${r.status})`, detail: d }, r.status)

    const id = d?.request?.id
    let last = d
    // Short inline poll (~35s). If still processing, client re-polls with { id }.
    for (let i = 0; i < 10 && id; i++) {
      const st = String(last?.request?.status || last?.status || '').toLowerCase()
      if (st === 'complete') break
      await new Promise((res) => setTimeout(res, 3500))
      const pr = await evFetch(`/property/v2/result/${id}`, { method: 'GET' })
      last = await pr.json().catch(() => last)
    }

    const status = String(last?.request?.status || last?.status || 'In Progress')
    if (status.toLowerCase() === 'complete') {
      return json({ status: 'complete', id, env: EV_ENV, roof: parseRoof(last), raw: last })
    }
    return json({ status: 'in_progress', id, env: EV_ENV })

  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})
