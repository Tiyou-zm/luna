// hermes-get-binding-qrcode
// 让 Hermes Agent 生成小红书（或其他平台）的账号授权绑定二维码
// Hermes 持有平台的 MCP 工具权限，由它来调用平台 OAuth 流程并返回二维码
import {createClient} from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 从 Hermes 回复中提取二维码 URL
// Hermes 约定格式：<!--QR_URL:https://...-->
// 或者直接是图片 URL（jpg/png/gif）
const QR_URL_RE = /<!--QR_URL:(https?:\/\/[^\s>]+)-->/
const IMG_URL_RE = /https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp)(?:\?\S*)?/i

function extractQrUrl(reply: string): string | null {
  // 优先使用约定标记
  const tagged = reply.match(QR_URL_RE)
  if (tagged?.[1]) return tagged[1]
  // 其次提取回复中任意图片链接
  const img = reply.match(IMG_URL_RE)
  if (img?.[0]) return img[0]
  return null
}

// 从 Hermes 回复中提取 session_id（用于轮询授权状态）
// 约定格式：<!--SESSION_ID:xxxxxxxx-->
const SESSION_ID_RE = /<!--SESSION_ID:([a-zA-Z0-9_\-]+)-->/
function extractSessionId(reply: string): string | null {
  const m = reply.match(SESSION_ID_RE)
  return m?.[1] ?? null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: corsHeaders})
  }

  try {
    // 验证用户身份
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return Response.json({error: '未登录'}, {status: 401, headers: corsHeaders})
    }
    const {data: {user}, error: authErr} = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) {
      return Response.json({error: '认证失败'}, {status: 401, headers: corsHeaders})
    }

    const {platform, account_name} = await req.json()
    if (!platform || !account_name) {
      return Response.json({error: '缺少 platform 或 account_name'}, {status: 400, headers: corsHeaders})
    }

    // 平台名称映射（给 Hermes 更自然的中文名）
    const platformNames: Record<string, string> = {
      xiaohongshu: '小红书',
      douyin: '抖音',
      bilibili: 'B站',
      weibo: '微博',
      wechat: '微信公众号',
      kuaishou: '快手',
      other: '其他平台',
    }
    const platformLabel = platformNames[platform] ?? platform

    const hermesBaseUrl = Deno.env.get('HERMES_BASE_URL') || 'http://152.136.47.2:8642'
    const hermesApiKey = Deno.env.get('HERMES_API_KEY') || 'bWmhP67eBZsbta58h8QRKrZT0XcPh2NJ'

    // 请求 Hermes 生成平台授权二维码
    // 约定回复格式：
    //   <!--QR_URL:https://...--> 二维码图片地址
    //   <!--SESSION_ID:xxxxxxxx--> 会话 ID，用于后续轮询授权状态
    const prompt = `请为用户生成${platformLabel}账号「${account_name}」的授权绑定二维码。
用户将使用该二维码在${platformLabel}客户端完成扫码授权，授权后系统将自动同步该账号数据。

请在回复末尾追加以下格式的标记（不要省略）：
<!--QR_URL:二维码图片的完整URL-->
<!--SESSION_ID:授权会话ID-->

如果暂时无法生成，请说明原因。`

    const upstream = await fetch(`${hermesBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hermesApiKey}`,
      },
      body: JSON.stringify({
        model: 'hermes-agent',
        messages: [
          {
            role: 'system',
            content: '你是 Luna AI 平台的 Hermes Agent，负责处理自媒体账号授权绑定。当用户请求生成授权二维码时，调用相应平台的 MCP 工具创建授权会话，并按约定格式返回二维码 URL 和 Session ID。'
          },
          {role: 'user', content: prompt}
        ],
        stream: false,
        max_tokens: 1024,
      }),
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '')
      console.error('Hermes API 错误:', upstream.status, errText)
      return Response.json(
        {error: `Hermes 服务异常 (${upstream.status})`, hermesError: errText},
        {status: 502, headers: corsHeaders}
      )
    }

    const data = await upstream.json()
    const reply: string = data.choices?.[0]?.message?.content ?? ''
    console.log('Hermes 回复:', reply.slice(0, 500))

    const qrUrl = extractQrUrl(reply)
    const sessionId = extractSessionId(reply)

    // 清洗掉约定标记，得到展示给用户的说明文字
    const displayText = reply
      .replace(QR_URL_RE, '')
      .replace(SESSION_ID_RE, '')
      .trim()

    if (!qrUrl) {
      // Hermes 未返回二维码，将原始回复透传给前端展示
      return Response.json(
        {
          success: false,
          qrUrl: null,
          sessionId: null,
          message: displayText || 'Hermes 暂时无法生成二维码，请稍后重试。',
          rawReply: reply,
        },
        {headers: corsHeaders}
      )
    }

    return Response.json(
      {
        success: true,
        qrUrl,
        sessionId,
        message: displayText,
      },
      {headers: corsHeaders}
    )
  } catch (err) {
    console.error('hermes-get-binding-qrcode 错误:', err)
    return Response.json(
      {error: String(err)},
      {status: 500, headers: corsHeaders}
    )
  }
})
