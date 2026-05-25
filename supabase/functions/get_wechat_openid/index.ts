const APP_ID = Deno.env.get('THIRD_PARTY_LOGIN_APP_ID') || ''
const AUTHORIZATION = Deno.env.get('WX_OPEN_CFC_JWT_TOKEN') || ''
const URL_ENDPOINT = 'https://ct6gb7rg8n0rf.cfc-execute.bj.baidubce.com/get_openid'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code } = await req.json()

    const res = await fetch(URL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': AUTHORIZATION
      },
      body: JSON.stringify({ appid: APP_ID, jscode: code })
    })

    const data = await res.json()

    if (!data.openid) {
      console.error(`[WeChatLogin FAILED] response=${JSON.stringify(data)}`)
      return new Response(JSON.stringify({ success: false, error: 'Failed to get openid' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log(`[WeChatLogin SUCCESS] openid=${data.openid}`)
    return new Response(JSON.stringify({ success: true, openid: data.openid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error(`[WeChatLogin ERROR] error=${err?.message || String(err)}`)
    return new Response(JSON.stringify({ success: false, error: err?.message || String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
