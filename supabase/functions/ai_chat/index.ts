// ai_chat：对话接口（备用），使用 Hermes Agent（8642 端口）
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// 写入消耗记录（备用接口统一调用）
async function writeUsageRecord(
  userId: string,
  opts: {
    tokens: number
    balance: number
    fromPlan: boolean
    rawResponse?: string
  }
) {
  await supabase.from('usage_records').insert({
    user_id: userId,
    type: 'text',
    model: 'hermes-agent',
    quantity: opts.tokens,
    unit: 'tokens',
    amount_deducted: 0,
    from_plan: opts.fromPlan,
    balance_before: opts.balance,
    balance_after: opts.balance,
    raw_response: opts.rawResponse ?? null,
  })
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) {
      return new Response(JSON.stringify({ error: '用户未登录' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { message, conversationId, history = [] } = await req.json()
    if (!message) {
      return new Response(JSON.stringify({ error: '消息不能为空' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 检查用户额度
    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_level, ai_count, balance')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.membership_level === 'free' && (profile?.ai_count || 0) >= 8) {
      // 后端拦截：写入拒绝记录，方便管理员核查
      await writeUsageRecord(user.id, {
        tokens: 0,
        balance: Number(profile?.balance || 0),
        fromPlan: false,
        rawResponse: '[后端拦截] 免费额度已用尽（ai_count >= 8）',
      })
      return new Response(JSON.stringify({ error: '免费额度已用完，请升级套餐' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 调用 Hermes Agent
    const HERMES_BASE_URL = Deno.env.get('HERMES_BASE_URL') || 'http://152.136.47.2:8642'
    const HERMES_API_KEY = Deno.env.get('HERMES_API_KEY') || ''
    const HERMES_MODEL = Deno.env.get('HERMES_MODEL') || 'hermes-agent'

    let reply = ''

    const messages = [
      {
        role: 'system',
        content: '你是Luna，一个专业的自媒体AI创作助理。你擅长帮助创作者生成小红书笔记、抖音视频脚本、公众号文章等各类内容。请用友好专业的语气回答用户问题，并尽量给出具体可执行的建议。'
      },
      ...history,
      { role: 'user', content: message }
    ]

    const hermesRes = await fetch(`${HERMES_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HERMES_API_KEY}`
      },
      body: JSON.stringify({
        model: HERMES_MODEL,
        messages,
        max_tokens: 2000,
        temperature: 0.7
      })
    })

    if (hermesRes.ok) {
      const hermesData = await hermesRes.json()
      reply = hermesData.choices?.[0]?.message?.content || ''
      // 读取真实 token 用量（优先从 usage 字段，回退到回复字符数估算）
      const realTokens = Number(hermesData?.usage?.total_tokens || reply.length)

      if (!reply) {
        reply = `感谢您的提问！作为Luna AI助理，我已收到您的请求，但暂时无法连接AI服务，请稍后重试。`
      }

      // 更新用户AI使用次数（仅 free 用户需要计数，付费用户不限次）
      if (profile?.membership_level === 'free') {
        await supabase.from('profiles')
          .update({ ai_count: (profile?.ai_count || 0) + 1 })
          .eq('id', user.id)
      }

      // 写入消耗记录（使用真实 token 数）
      await writeUsageRecord(user.id, {
        tokens: realTokens,
        balance: Number(profile?.balance || 0),
        fromPlan: true,
      })

      return new Response(JSON.stringify({ reply, tokens: realTokens }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } else {
      const errText = await hermesRes.text()
      console.error('Hermes API error:', hermesRes.status, errText)
    }

    if (!reply) {
      reply = `感谢您的提问！作为Luna AI助理，我已收到您的请求，但暂时无法连接AI服务，请稍后重试。`
    }

    // Hermes 调用失败时也写一条记录（amount=0，标记失败原因）
    await writeUsageRecord(user.id, {
      tokens: 0,
      balance: Number(profile?.balance || 0),
      fromPlan: false,
      rawResponse: '[备用接口] Hermes 调用失败，返回兜底回复',
    })
  } catch (err: any) {
    console.error('ai_chat error:', err)
    return new Response(JSON.stringify({ error: err?.message || '服务器错误' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
