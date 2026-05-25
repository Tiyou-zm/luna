// 文心大模型 SSE Proxy — 直接透传上游流式响应
// 供 arkclaw_chat 内部调用，不对外暴露
import {createClient} from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, {headers: corsHeaders})
  if (req.method !== 'POST') return new Response('Method Not Allowed', {status: 405, headers: corsHeaders})

  // 验证用户 JWT
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return Response.json({error: '未登录'}, {status: 401, headers: corsHeaders})
  }
  const {data: {user}, error: authError} = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) {
    return Response.json({error: '认证失败'}, {status: 401, headers: corsHeaders})
  }

  // 解析请求体
  let messages: Array<{role: string; content: string}>
  let enableThinking = false
  try {
    const body = await req.json()
    messages = body.messages
    if (!messages || !Array.isArray(messages) || messages.length === 0) throw new Error('messages 不能为空')
    if (body.enable_thinking !== undefined) enableThinking = Boolean(body.enable_thinking)
  } catch (err) {
    return Response.json({error: `请求格式错误: ${(err as Error).message}`}, {status: 400, headers: corsHeaders})
  }

  const apiKey = Deno.env.get('INTEGRATIONS_API_KEY')
  if (!apiKey) {
    return Response.json({error: '服务配置错误：缺少 API 密钥'}, {status: 500, headers: corsHeaders})
  }

  // 调用文心大模型上游 SSE 接口
  const upstream = await fetch(
    'https://app-b9plzy10uj29-api-zYkZz8qovQ1L-gateway.appmiaoda.com/v2/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({messages, enable_thinking: enableThinking}),
    }
  )

  if (upstream.status === 429 || upstream.status === 402) {
    const errText = await upstream.text()
    return new Response(errText, {status: upstream.status, headers: {...corsHeaders, 'Content-Type': 'application/json'}})
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({error: `上游错误: ${upstream.status}`}, {status: 502, headers: corsHeaders})
  }

  // 直接透传 SSE 流
  return new Response(upstream.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
