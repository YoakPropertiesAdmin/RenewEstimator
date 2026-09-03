import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// upload-pdf: PDF library / template-PDF upload path.
// Storage rejects this project's ES256 user tokens on direct object writes, so
// uploads go through here: verify the caller via the auth service (which DOES
// accept ES256, same trick as invite-user), then perform the storage write +
// pdf_library insert with the service-role key (bypasses storage RLS entirely).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const SUPA_URL  = Deno.env.get('SUPABASE_URL')!;
    const SUPA_SRK  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const SUPA_ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify caller (accepts ES256 tokens)
    const userResp = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { 'Authorization': authHeader, 'apikey': SUPA_ANON },
    });
    if (!userResp.ok) return json({ error: 'Unauthorized' }, 401);
    const userData = await userResp.json();
    const callerId = userData?.id;
    if (!callerId) return json({ error: 'Unauthorized' }, 401);

    // Caller's tenant/role via service role (bypasses RLS)
    const profResp = await fetch(
      `${SUPA_URL}/rest/v1/users?select=role,tenant_id&id=eq.${callerId}&limit=1`,
      { headers: { apikey: SUPA_SRK, Authorization: `Bearer ${SUPA_SRK}` } }
    );
    const profs = profResp.ok ? await profResp.json() : [];
    const prof  = profs[0] || null;
    if (!prof?.tenant_id) return json({ error: 'No tenant for caller' }, 403);

    // Parse upload
    const form = await req.formData();
    const file = form.get('file');
    const mode = String(form.get('mode') || 'library');      // 'library' | 'template'
    const label = String(form.get('label') || '').trim();
    const category = String(form.get('category') || 'general');
    if (!(file instanceof File)) return json({ error: 'No file provided' }, 400);
    if (mode === 'library' && !label) return json({ error: 'Label is required' }, 400);

    const BUCKET   = 'template-pdfs';
    const safeName = (file.name || 'file.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    const prefix   = mode === 'template' ? 'templates' : `library/${category}`;
    const path     = `${prefix}/${Date.now()}_${safeName}`;
    const bytes    = new Uint8Array(await file.arrayBuffer());

    // Upload with service role (bypasses storage RLS + token issue)
    const upResp = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPA_SRK,
        Authorization: `Bearer ${SUPA_SRK}`,
        'Content-Type': file.type || 'application/pdf',
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!upResp.ok) {
      const t = await upResp.text().catch(() => '');
      return json({ error: `Storage upload failed: ${upResp.status} ${t}` }, 502);
    }
    const publicUrl = `${SUPA_URL}/storage/v1/object/public/${BUCKET}/${path}`;

    // Library mode also records a pdf_library row
    let row = null;
    if (mode === 'library') {
      const insResp = await fetch(`${SUPA_URL}/rest/v1/pdf_library`, {
        method: 'POST',
        headers: {
          apikey: SUPA_SRK,
          Authorization: `Bearer ${SUPA_SRK}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          tenant_id:    prof.tenant_id,
          label,
          filename:     file.name,
          storage_path: path,
          storage_url:  publicUrl,
          file_size:    bytes.length,
          category,
          active:       true,
          uploaded_by:  callerId,
        }),
      });
      if (!insResp.ok) {
        const t = await insResp.text().catch(() => '');
        return json({ error: `DB insert failed: ${insResp.status} ${t}` }, 502);
      }
      const rows = await insResp.json().catch(() => []);
      row = Array.isArray(rows) ? rows[0] : rows;
    }

    return json({ success: true, url: publicUrl, path, row });
  } catch (err) {
    console.error('upload-pdf error:', err);
    return json({ error: String(err) }, 500);
  }
});
