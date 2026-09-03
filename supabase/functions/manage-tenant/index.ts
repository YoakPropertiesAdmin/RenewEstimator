import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const SUPA_URL  = Deno.env.get('SUPABASE_URL')!;
    const SUPA_SRK  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const SUPA_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify caller via auth service (handles ES256 tokens)
    const userResp = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { 'Authorization': authHeader, 'apikey': SUPA_ANON },
    });
    if (!userResp.ok) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    const userData = await userResp.json();
    const callerId = userData?.id;
    if (!callerId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    // Lookup role via service role key (bypasses RLS, works regardless of JWT algorithm)
    const profileResp = await fetch(
      `${SUPA_URL}/rest/v1/users?select=role&id=eq.${callerId}&limit=1`,
      { headers: { 'apikey': SUPA_SRK, 'Authorization': `Bearer ${SUPA_SRK}` } }
    );
    const profiles = profileResp.ok ? await profileResp.json() : [];
    const callerRole = profiles[0]?.role;

    if (!['platform_owner', 'super_admin'].includes(callerRole)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403, headers: corsHeaders });
    }

    const body = await req.json();
    const { operation, id, data } = body;

    const db = createClient(SUPA_URL, SUPA_SRK);

    // ── READS ────────────────────────────────────────────────────────

    if (operation === 'list_tenants') {
      const { data: rows, error } = await db.from('tenants').select('*').order('name');
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
      return new Response(JSON.stringify(rows), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'list_all_users') {
      const { data: rows, error } = await db.from('users').select('*').order('name');
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
      return new Response(JSON.stringify(rows), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'list_org_users') {
      if (!id) return new Response(JSON.stringify({ error: 'tenant id required' }), { status: 400, headers: corsHeaders });
      const { data: rows, error } = await db.from('users').select('*').eq('tenant_id', id).order('name');
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
      return new Response(JSON.stringify(rows), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'tenant_stats') {
      // Per-tenant quote counts (service role bypasses RLS so we can count across all tenants).
      // Pull only the tenant_id column to keep the payload light, then tally in memory.
      const { data: rows, error } = await db.from('quotes').select('tenant_id');
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
      const quotes: Record<string, number> = {};
      let total = 0;
      for (const r of rows || []) {
        if (!r.tenant_id) continue;
        quotes[r.tenant_id] = (quotes[r.tenant_id] || 0) + 1;
        total++;
      }
      return new Response(JSON.stringify({ quotes, total }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── TENANT WRITES ─────────────────────────────────────────────────

    if (operation === 'create') {
      const { data: tenant, error } = await db.from('tenants').insert(data).select().single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
      return new Response(JSON.stringify(tenant), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (operation === 'update') {
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
      const { error } = await db.from('tenants').update(data).eq('id', id);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── USER WRITES ───────────────────────────────────────────────────

    if (operation === 'update_user') {
      if (!id) return new Response(JSON.stringify({ error: 'user id required' }), { status: 400, headers: corsHeaders });
      const { data: updated, error } = await db.from('users').update(data).eq('id', id).select().single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
      return new Response(JSON.stringify(updated), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown operation' }), { status: 400, headers: corsHeaders });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
