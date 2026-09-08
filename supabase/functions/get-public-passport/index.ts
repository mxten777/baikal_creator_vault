import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function response(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response({ error: 'Passport not available' }, 404)

  let publicId: unknown
  try {
    const body = await request.json()
    publicId = body?.publicId
  } catch {
    return response({ error: 'Passport not available' }, 404)
  }

  if (typeof publicId !== 'string' || !uuidPattern.test(publicId)) {
    return response({ error: 'Passport not available' }, 404)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: passport } = await supabase
    .from('passports')
    .select('public_id, asset_id, data')
    .eq('public_id', publicId)
    .eq('is_public', true)
    .maybeSingle()

  if (!passport) return response({ error: 'Passport not available' }, 404)

  const { data: asset } = await supabase
    .from('assets')
    .select('id, name, asset_type, created_at')
    .eq('id', passport.asset_id)
    .maybeSingle()

  if (!asset) return response({ error: 'Passport not available' }, 404)

  const { data: relation } = await supabase
    .from('asset_relations')
    .select('relation_type, to_asset_id')
    .eq('from_asset_id', asset.id)
    .eq('relation_type', 'derived_from')
    .limit(1)
    .maybeSingle()

  let provenance: { relation_type: string; source: { public_id: string; name: string } | { visibility: 'private' } } | null = null
  if (relation) {
    const { data: sourceAsset } = await supabase
      .from('assets')
      .select('id, name')
      .eq('id', relation.to_asset_id)
      .maybeSingle()

    const { data: sourcePassport } = await supabase
      .from('passports')
      .select('public_id')
      .eq('asset_id', relation.to_asset_id)
      .eq('is_public', true)
      .maybeSingle()

    provenance = sourceAsset && sourcePassport
      ? { relation_type: relation.relation_type, source: { public_id: sourcePassport.public_id, name: sourceAsset.name } }
      : { relation_type: relation.relation_type, source: { visibility: 'private' } }
  }

  const passportData = passport.data && typeof passport.data === 'object' ? passport.data : {}
  return response({
    passport: {
      statement: typeof passportData.statement === 'string' ? passportData.statement : null,
      license: typeof passportData.license === 'string' ? passportData.license : null,
    },
    asset: { name: asset.name, type: asset.asset_type, created_at: asset.created_at },
    provenance,
  }, 200)
})