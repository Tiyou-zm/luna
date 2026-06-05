import {createClient} from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function cleanUsername(value: unknown, fallback: string) {
  const raw = String(value || fallback || '').trim()
  const safe = raw.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '')
  return safe || fallback
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: corsHeaders})
  }

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) {
      return Response.json({message: 'Unauthorized'}, {status: 401, headers: corsHeaders})
    }

    const {data: {user}, error: userError} = await supabaseAdmin.auth.getUser(token)
    if (userError || !user) {
      return Response.json({message: 'Unauthorized'}, {status: 401, headers: corsHeaders})
    }

    const body = await req.json().catch(() => ({}))
    const metadata = user.user_metadata || {}
    const emailPrefix = user.email?.split('@')[0] || `user_${user.id.slice(0, 8)}`
    const username = cleanUsername(body.username || metadata.username || emailPrefix, `user_${user.id.slice(0, 8)}`)
    const nickname = String(body.nickname || metadata.nickname || username)
    const openid = body.openid || metadata.openid || null

    const {data: existing, error: existingError} = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

    if (existingError) throw existingError

    if (existing) {
      const {data: profile, error: updateError} = await supabaseAdmin
        .from('profiles')
        .update({
          username: existing.username || username,
          nickname: existing.nickname || nickname,
          openid: openid || existing.openid,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
        .select('*')
        .single()

      if (updateError) throw updateError
      return Response.json({profile}, {headers: corsHeaders})
    }

    const {count, error: countError} = await supabaseAdmin
      .from('profiles')
      .select('id', {count: 'exact', head: true})

    if (countError) throw countError
    const isFirstUser = (count || 0) === 0

    const {data: profile, error: insertError} = await supabaseAdmin
      .from('profiles')
      .insert({
        id: user.id,
        username,
        nickname,
        openid,
        role: isFirstUser ? 'admin' : 'user',
        is_admin: isFirstUser,
      })
      .select('*')
      .single()

    if (insertError) throw insertError
    return Response.json({profile}, {headers: corsHeaders})
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to ensure profile'
    return Response.json({message}, {status: 500, headers: corsHeaders})
  }
})
