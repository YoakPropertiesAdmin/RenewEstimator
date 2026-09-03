import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    // Create admin client (service role) for user management
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify caller via auth service (accepts ES256 tokens)
    const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPA_SRK = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const SUPA_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

    const userResp = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { 'Authorization': authHeader, 'apikey': SUPA_ANON },
    });
    if (!userResp.ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }
    const userData = await userResp.json();
    const callerId = userData?.id;
    if (!callerId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    // Lookup caller's role via service role key (bypasses RLS, works regardless of JWT algorithm)
    const profileResp = await fetch(
      `${SUPA_URL}/rest/v1/users?select=role,tenant_id&id=eq.${callerId}&limit=1`,
      { headers: { 'apikey': SUPA_SRK, 'Authorization': `Bearer ${SUPA_SRK}` } }
    );
    const profiles = profileResp.ok ? await profileResp.json() : [];
    const callerProfile = profiles[0] || null;

    const INVITE_ROLES = ['platform_owner', 'super_admin', 'admin'];
    if (!INVITE_ROLES.includes(callerProfile?.role)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions to invite users' }), { status: 403, headers: corsHeaders });
    }

    const { name, email, phone, role, tenant_id: bodyTenantId } = await req.json();
    if (!email) return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400, headers: corsHeaders });

    const VALID_ROLES = ['platform_owner', 'super_admin', 'admin', 'director', 'user', 'rep'];
    const validRole = VALID_ROLES.includes(role) ? role : 'rep';
    // platform.html passes tenant_id in body; admin.html uses caller's own tenant
    const tenantId = bodyTenantId || callerProfile.tenant_id;

    // Production URL — used as redirectTo in invite emails.
    // Override by setting SITE_URL as a Supabase edge-function secret.
    const PRODUCTION_URL = 'https://estimator.renewhomeexteriors.com';
    const SITE_URL = Deno.env.get('SITE_URL') || PRODUCTION_URL;

    // ── Attempt invite (new user path) ──────────────────────────────────
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data:       { full_name: name || email },
      redirectTo: `${SITE_URL}/PricingEstimator.html`,
    });

    let userId          = inviteData?.user?.id;
    let alreadyRegistered = false;

    if (inviteError) {
      const msg = inviteError.message.toLowerCase();

      if (msg.includes('already') || msg.includes('email_exists')) {
        // ── Existing auth user — no invite email sent by Supabase ────────
        alreadyRegistered = true;
        // Look up their ID from public.users (most reliable path)
        const { data: existing } = await adminClient
          .from('users')
          .select('id')
          .eq('email', email)
          .maybeSingle();
        userId = existing?.id;

        // Fallback: scan auth users list for this email
        if (!userId) {
          const { data: { users: authUsers } } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const match = authUsers?.find((u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase());
          userId = match?.id;
        }
      } else {
        return new Response(JSON.stringify({ error: inviteError.message }), { status: 400, headers: corsHeaders });
      }
    }

    // ── Upsert public.users row ──────────────────────────────────────────
    if (userId) {
      await adminClient.from('users').upsert({
        id:        userId,
        tenant_id: tenantId,
        email,
        name:      name || email,
        phone:     phone || null,
        role:      validRole,
        active:    true,
      }, { onConflict: 'id' });
    }

    return new Response(
      JSON.stringify({ success: true, userId, alreadyRegistered }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('invite-user error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
