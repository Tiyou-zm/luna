/**
 * luna_hermes_chat — Hermes 调用适配器
 *
 * 职责：
 *  1. 接收 luna_guardian 路由过来的请求
 *  2. 将 attachments 整理进 Hermes prompt
 *  3. 调用 Hermes POST /v1/chat/completions
 *  4. 检测 Hermes 返回是否为新格式（type: "material_package"）
 *     - 是新格式 → 调用 MiniMax 2.7 做**纯字段搬运**，严禁修改内容
 *     - 旧格式 / 纯文本 → 原样返回
 *  5. 返回统一格式：{ reply, model, upstream, raw, formatted_result? }
 *     formatted_result 有值时 luna_guardian 直接使用，跳过 repairPlatformResult
 *
 * 安全：HERMES_API_KEY 只在此函数内读取，不暴露给前端。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_HERMES_BASE_URL = 'http://152.136.47.2:8642'
const DEFAULT_HERMES_MODEL = 'hermes-agent'
const DEFAULT_HERMES_API_KEY = ''

// ── 类型定义 ──────────────────────────────────────────────────────
interface AttachmentMeta {
  type: 'image' | 'file' | 'video'
  file_url: string
  file_key: string
  mime_type: string
  file_type: string
  name: string
  size?: number
}

interface HermesMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// Hermes 新格式结构
interface HermesNewFormat {
  type: 'material_package'
  platforms: {
    xiaohongshu?: {
      posts?: Array<{scene?: string; title?: string; body?: string; tags?: string[]}>
    }
    douyin?: {
      scripts?: Array<{duration?: number; hook?: string; sections?: Array<{time?: string; type?: string; content?: string}>}>
    }
    moments?: {
      posts?: Array<{style?: string; body?: string}>
    }
    wechat_public?: {
      outline?: {title?: string; sections?: string[]}
    }
  }
}

// luna_guardian 期望的旧格式（平台中文名 → 字段对象）
type StandardResult = Record<string, {
  titles: string[]
  body: string
  cover_suggestion: string
  image_prompts: string[]
  hashtags: string[]
  best_time: string
  ad_advice: string
  risk_warning: string
}>

// ── 工具函数 ──────────────────────────────────────────────────────
function buildAttachmentNote(attachments: AttachmentMeta[]): string {
  if (!attachments || attachments.length === 0) return ''
  const lines: string[] = []
  for (const att of attachments) {
    if (att.type === 'image') {
      lines.push(`[图片素材] 文件名：${att.name}，地址：${att.file_url}（请根据该图片内容理解用户素材意图）`)
    } else if (att.type === 'video') {
      lines.push(`[视频素材] 文件名：${att.name}，地址：${att.file_url}（视频内容分析暂不支持，请提示用户补充视频的核心内容文字描述）`)
    } else {
      const ext = att.file_type || att.name.split('.').pop() || 'file'
      lines.push(`[文档素材] 文件名：${att.name}（${ext.toUpperCase()}），地址：${att.file_url}（请基于该文档内容理解用户素材意图）`)
    }
  }
  return lines.length > 0 ? `\n\n【用户上传的素材附件】\n${lines.join('\n')}` : ''
}

function tryParseJSON(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) } catch { /* noop */ }
  const block = text.match(/```(?:json)?\s*([\s\S]+?)```/)
  if (block) { try { return JSON.parse(block[1]) } catch { /* noop */ } }
  const brace = text.match(/\{[\s\S]+\}/)
  if (brace) { try { return JSON.parse(brace[0]) } catch { /* noop */ } }
  return null
}

function isHermesNewFormat(obj: Record<string, unknown>): obj is HermesNewFormat {
  return obj.type === 'material_package' && typeof obj.platforms === 'object' && obj.platforms !== null
}

// ── 纯代码兜底映射（MiniMax 失败时使用）──────────────────────────
function fallbackMap(src: HermesNewFormat): StandardResult {
  const result: StandardResult = {}
  const p = src.platforms

  if (p.xiaohongshu) {
    const posts = p.xiaohongshu.posts || []
    result['小红书'] = {
      titles: posts.map((post) => post.title || '').filter(Boolean),
      body: posts.map((post) => post.body || '').filter(Boolean).join('\n\n'),
      cover_suggestion: posts[0]?.scene || '',
      image_prompts: [],
      hashtags: posts.flatMap((post) => post.tags || []),
      best_time: '',
      ad_advice: '',
      risk_warning: '',
    }
  }

  if (p.douyin) {
    const scripts = p.douyin.scripts || []
    const s0 = scripts[0] || {}
    const sectionText = (s0.sections || []).map((sec) => `【${sec.time || ''}】${sec.content || ''}`).join('\n')
    result['抖音'] = {
      titles: s0.hook ? [s0.hook] : [],
      body: sectionText || '',
      cover_suggestion: '',
      image_prompts: [],
      hashtags: [],
      best_time: s0.duration ? `建议视频时长 ${s0.duration}s` : '',
      ad_advice: '',
      risk_warning: '',
    }
  }

  if (p.moments) {
    const posts = p.moments.posts || []
    result['视频号'] = {
      titles: [],
      body: posts.map((post) => post.body || '').filter(Boolean).join('\n\n'),
      cover_suggestion: posts[0]?.style || '',
      image_prompts: [],
      hashtags: [],
      best_time: '',
      ad_advice: '',
      risk_warning: '',
    }
  }

  if (p.wechat_public) {
    const outline = p.wechat_public.outline || {}
    result['公众号'] = {
      titles: outline.title ? [outline.title] : [],
      body: (outline.sections || []).join('\n'),
      cover_suggestion: '',
      image_prompts: [],
      hashtags: [],
      best_time: '',
      ad_advice: '',
      risk_warning: '',
    }
  }

  return result
}

// ── MiniMax 严格字段整理（只搬运，不改内容）─────────────────────
const FORMAT_ORGANIZER_SYSTEM = `你是一个严格的格式整理工具。你的唯一职责是把输入 JSON 的字段内容搬运到目标格式中。

【绝对禁止】
- 禁止修改、替换、扩写、缩写任何创作文字内容
- 禁止用同义词或近义词替换原文任何词语
- 禁止添加任何原文没有的内容
- 禁止删除任何原文已有的内容
- 禁止对内容做任何主观判断或优化

【唯一允许的操作】
- 把原始 JSON 的字段值搬运到目标字段（字段名称映射）
- 把数组合并为字符串时，用换行符 \\n 拼接，不增减任何文字
- 用空字符串 "" 填充目标格式中原始数据没有对应值的字段
- 返回纯 JSON，不要任何额外说明

【字段映射规则】
xiaohongshu.posts → 小红书
  posts 每项 title → titles 数组元素
  posts 每项 body → 拼接为 body（多项时 \\n\\n 分隔）
  posts 每项 tags → 合并为 hashtags 数组
  posts[0].scene → cover_suggestion

douyin.scripts[0] → 抖音
  scripts[0].hook → titles[0]
  scripts[0].sections 每项 content 拼接（保留 time 前缀）→ body
  scripts[0].duration → best_time（格式："建议视频时长 Xs"）

moments.posts → 视频号
  posts 每项 body → 拼接为 body
  posts[0].style → cover_suggestion

wechat_public.outline → 公众号
  outline.title → titles[0]
  outline.sections 数组用 \\n 拼接 → body

【目标输出格式】
{
  "小红书": { "titles": [], "body": "", "cover_suggestion": "", "image_prompts": [], "hashtags": [], "best_time": "", "ad_advice": "", "risk_warning": "" },
  "抖音":   { "titles": [], "body": "", "cover_suggestion": "", "image_prompts": [], "hashtags": [], "best_time": "", "ad_advice": "", "risk_warning": "" },
  "视频号": { "titles": [], "body": "", "cover_suggestion": "", "image_prompts": [], "hashtags": [], "best_time": "", "ad_advice": "", "risk_warning": "" },
  "公众号": { "titles": [], "body": "", "cover_suggestion": "", "image_prompts": [], "hashtags": [], "best_time": "", "ad_advice": "", "risk_warning": "" }
}
只输出 JSON，不要任何额外文字。`

async function formatWithMiniMax(hermesJson: HermesNewFormat): Promise<StandardResult | null> {
  const apiKey = Deno.env.get('MINIMAX_API_KEY')
  const baseUrl = (Deno.env.get('MINIMAX_BASE_URL') || 'https://api.minimaxi.com/v1').replace(/\/$/, '')

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7-highspeed',
        messages: [
          {role: 'system', content: FORMAT_ORGANIZER_SYSTEM},
          {role: 'user', content: `请按照字段映射规则，将以下 Hermes 输出整理为目标格式，只做搬运，不修改任何内容文字：\n\n${JSON.stringify(hermesJson, null, 2)}`},
        ],
        temperature: 0.0,
        max_tokens: 3000,
      }),
    })

    if (!res.ok) {
      console.error('[formatWithMiniMax] MiniMax HTTP', res.status)
      return null
    }

    const data = await res.json()
    let raw: string = data?.choices?.[0]?.message?.content ?? ''
    // 剥离思维链
    raw = raw.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()

    console.log('[formatWithMiniMax] MiniMax raw preview:', raw.slice(0, 300))

    const parsed = tryParseJSON(raw)
    if (!parsed) {
      console.error('[formatWithMiniMax] JSON parse failed')
      return null
    }

    // 基础校验：至少有一个中文平台 key
    const hasCN = ['小红书', '抖音', '视频号', '公众号'].some((k) => k in parsed)
    if (!hasCN) {
      console.error('[formatWithMiniMax] no Chinese platform keys in result')
      return null
    }

    return parsed as unknown as StandardResult
  } catch (e) {
    console.error('[formatWithMiniMax] error:', e)
    return null
  }
}

// ── 主处理逻辑 ────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: CORS})

  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) {
      return Response.json({error: '未授权'}, {status: 401, headers: CORS})
    }

    const body = await req.json() as {
      system_prompt?: string
      messages?: HermesMessage[]
      user_message?: string
      attachments?: AttachmentMeta[]
      task_type?: string
      platforms?: string[]
      goal?: string
      material_text?: string
      industry?: string
    }

    const systemPrompt = body.system_prompt || '你是 Luna，一个专业的多平台内容创作助手，帮助自媒体创作者生成内容方案和素材包。'
    const history: HermesMessage[] = (body.messages || []).slice(-10)
    const userMessage = (body.user_message || '').trim()
    const attachments: AttachmentMeta[] = body.attachments || []
    const attachmentNote = buildAttachmentNote(attachments)

    const finalUserContent = (userMessage || '请根据我提供的素材生成内容方案') + attachmentNote

    const hermesMessages: HermesMessage[] = [
      {role: 'system', content: systemPrompt},
      ...history,
      {role: 'user', content: finalUserContent},
    ]

    const hermesBaseUrl = (Deno.env.get('HERMES_BASE_URL') || DEFAULT_HERMES_BASE_URL).replace(/\/$/, '')
    const hermesApiKey = Deno.env.get('HERMES_API_KEY') || DEFAULT_HERMES_API_KEY
    const hermesModel = Deno.env.get('HERMES_MODEL') || DEFAULT_HERMES_MODEL

    console.log('[luna_hermes_chat] calling Hermes, attachments_count:', attachments.length, 'task_type:', body.task_type || 'chat')

    let reply: string

    // _mock_hermes_reply: 调试参数，跳过 Hermes 直接测试格式整理逻辑
    const mockReply = (body as Record<string, unknown>)._mock_hermes_reply as string | undefined

    if (mockReply) {
      console.log('[luna_hermes_chat] DEBUG: using _mock_hermes_reply, skipping Hermes call')
      reply = mockReply
    } else {
      const upstream = await fetch(`${hermesBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hermesApiKey}`,
        },
        body: JSON.stringify({
          model: hermesModel,
          messages: hermesMessages,
          stream: false,
          max_tokens: 3200,
        }),
      })

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => '')
        console.error('[luna_hermes_chat] Hermes error:', upstream.status, errText)
        return Response.json(
          {error: `Hermes 服务异常 (${upstream.status})`, upstream_error: errText},
          {status: 502, headers: CORS},
        )
      }

      const data = await upstream.json()
      const raw2: string = data?.choices?.[0]?.message?.content ?? ''
      reply = raw2.trim()
    }

    console.log('[luna_hermes_chat] Hermes reply preview:', reply.slice(0, 200))
    console.log('[luna_hermes_chat] version=v2-newformat, reply_len:', reply.length)

    // ── 检测 Hermes 新格式，调用 MiniMax 做字段整理 ─────────────
    let formattedResult: StandardResult | null = null
    const parsedHermes = tryParseJSON(reply)

    if (parsedHermes && isHermesNewFormat(parsedHermes)) {
      console.log('[luna_hermes_chat] detected Hermes new format (material_package), calling MiniMax formatter')

      // 优先：MiniMax 字段搬运
      formattedResult = await formatWithMiniMax(parsedHermes)

      if (formattedResult) {
        console.log('[luna_hermes_chat] MiniMax format success, platforms:', Object.keys(formattedResult))
      } else {
        // 降级：纯代码映射（内容 100% 不变）
        console.warn('[luna_hermes_chat] MiniMax format failed, using fallback code mapping')
        formattedResult = fallbackMap(parsedHermes)
      }
    }

    return Response.json(
      {
        reply,
        model: hermesModel,
        upstream: 'hermes',
        raw: reply,
        // 有值时 luna_guardian 直接使用，不再走 extractJSON + repairPlatformResult
        formatted_result: formattedResult,
      },
      {headers: CORS},
    )
  } catch (err) {
    console.error('[luna_hermes_chat] 异常:', err)
    return Response.json(
      {error: String(err)},
      {status: 500, headers: CORS},
    )
  }
})
