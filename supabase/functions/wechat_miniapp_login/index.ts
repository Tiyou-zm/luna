import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code } = await req.json().catch(() => ({}))
    if (!code) {
      return new Response(JSON.stringify({ message: '缺少code' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const APP_ID = Deno.env.get('WECHAT_MINIPROGRAM_LOGIN_APP_ID')
    const APP_SECRET = Deno.env.get('WECHAT_MINIPROGRAM_LOGIN_APP_SECRET')

    const wxRes = await fetch(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${APP_ID}&secret=${APP_SECRET}&js_code=${code}&grant_type=authorization_code`
    )
    const wxData = await wxRes.json()

    if (wxData.errcode) {
      return new Response(JSON.stringify({ message: `微信接口错误: ${wxData.errmsg}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { openid } = wxData
    const email = `${openid}@wechat.login`

    const { data: magicLinkData, error: magicLinkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          data: { from: 'wechat', openid },
        },
      })

    if (magicLinkError) {
      return new Response(JSON.stringify({ message: magicLinkError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const hashedToken = magicLinkData?.properties?.hashed_token ?? ''
    if (!hashedToken) {
      return new Response(JSON.stringify({ message: '无法生成token' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ token: hashedToken, openid }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ message: err?.message || '服务器错误' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
