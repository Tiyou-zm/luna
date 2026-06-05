// 客服智能对话：使用 Hermes Agent（8642 端口），支持文字+图片消息
import {createClient} from 'jsr:@supabase/supabase-js@2'

const HERMES_BASE_URL = 'http://152.136.47.2:8642'
const HERMES_MODEL = 'hermes-agent'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const SYSTEM_PROMPT = `你是 Luna AI 平台的专属智能客服 LUNA，性格友好热情，专注帮助自媒体创作者解答关于 Luna AI 服务的问题。
服务范围：
- 套餐价格与功能介绍（免费版/图文版/视频新手/视频达人/专业版/企业版）
- 视频/图文生成教程
- 账号绑定与管理
- 退款政策（购买7天内未使用可全额退款）
- 1V1远程指导服务
请用中文回复，语气亲切，回答简洁清晰，必要时给出具体操作步骤。如果用户发送图片，根据图片内容给出相关建议。`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: corsHeaders})
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 验证用户
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return Response.json({error: '未授权'}, {status: 401, headers: corsHeaders})
    }
    const {data: {user}, error: authErr} = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) {
      return Response.json({error: '认证失败'}, {status: 401, headers: corsHeaders})
    }

    const body = await req.json()
    const message: string = body.message || ''
    const imageUrl: string = body.imageUrl || ''

    if (!message.trim() && !imageUrl) {
      return Response.json({error: '消息不能为空'}, {status: 400, headers: corsHeaders})
    }

    const messageType = imageUrl ? (message.trim() ? 'mixed' : 'image') : 'text'
    const displayContent = message.trim() || (imageUrl ? '[图片]' : '')

    // 保存用户消息到 DB
    const {data: savedUserMsg} = await supabase
      .from('cs_messages')
      .insert({
        user_id: user.id,
        role: 'user',
        content: displayContent,
        image_url: imageUrl || null,
        message_type: messageType
      })
      .select()
      .maybeSingle()

    // 加载历史对话（最近 14 条，用于 AI 上下文）
    const {data: historyRows} = await supabase
      .from('cs_messages')
      .select('role, content, image_url')
      .eq('user_id', user.id)
      .order('created_at', {ascending: false})
      .limit(14)

    const history = ((historyRows || []) as {role: string; content: string; image_url: string | null}[])
      .reverse()
      .slice(0, -1) // 去掉刚插入的最新一条，避免重复

    // 构建 AI 消息列表
    const aiMessages: {role: string; content: string}[] = [
      {role: 'system', content: SYSTEM_PROMPT},
      ...history.map((h) => ({
        role: h.role,
        content: h.image_url ? `${h.content}（附图：${h.image_url}）` : h.content
      })),
      {
        role: 'user',
        content: imageUrl
          ? (message.trim()
              ? `${message}（用户同时发送了一张图片：${imageUrl}，请根据图片内容给出建议）`
              : `用户发来一张图片：${imageUrl}，请根据图片内容给出建议或回复。`)
          : message
      }
    ]

    const apiKey = Deno.env.get('HERMES_API_KEY') || ''
    const baseUrl = Deno.env.get('HERMES_BASE_URL') || HERMES_BASE_URL
    const model = Deno.env.get('HERMES_MODEL') || HERMES_MODEL

    let reply = '您好！我是LUNA，很高兴为您服务。请告诉我您的问题，我来为您解答！'

    const hermesRes = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: aiMessages,
          stream: false,
          max_tokens: 1024
        })
      })

      if (hermesRes.ok) {
        const hermesData = await hermesRes.json()
        reply = hermesData?.choices?.[0]?.message?.content || reply
      } else {
        const errText = await hermesRes.text()
        console.error('Hermes API error:', hermesRes.status, errText)
      }

    // 保存 AI 回复
    const {data: savedReply} = await supabase
      .from('cs_messages')
      .insert({
        user_id: user.id,
        role: 'assistant',
        content: reply,
        message_type: 'text'
      })
      .select()
      .maybeSingle()

    return Response.json(
      {reply, message: savedReply, userMessage: savedUserMsg},
      {headers: corsHeaders}
    )
  } catch (err) {
    console.error('customer_service error:', err)
    return Response.json({error: String(err)}, {status: 500, headers: corsHeaders})
  }
})
