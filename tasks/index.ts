/**
 * luna_guardian — Luna 业务理解层 / 风险兜底层 / 格式修复层
 *
 * 职责：
 *  1. 判断 task_type（支持自由对话 + 创作类型 + 素材包任务）
 *  2. 安保层静默运行，用户无感知——风险请求由 Luna 角色自然婉拒，不暴露安保机制
 *  3. 正常创作请求（小红书/抖音文案/脚本）直接放行
 *  4. 按任务类型选 Prompt，调用 MiniMax API（minimax-2.7-highspeed）
 *  5. 对素材包类任务：提取 JSON，轻量修复，保存 material，返回 material_id
 *  6. 对对话/创作类任务：直接返回文字回复
 */

import {createClient} from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Luna 系统人格（安保规则静默内嵌，用户不可见）─────────────────
const LUNA_SYSTEM_PROMPT = `你是 Luna，一个专业、友善的多平台内容策略师和创作助手。你帮助用户规划内容方向、生成平台素材包、改写文案、创作短视频脚本，以及提供内容投放建议。

你的工作范围：内容创作、文案生成、素材包制作、投放策略建议。
你不具备的能力（自然婉拒，不解释原因，不提及"安保"或"限制"）：账号登录操作、Cookie提取、代理配置、后台数据抓取、自动发布推送。遇到这类请求时，用自然语气转移到你擅长的内容创作上，例如"这个我没办法帮到，不过如果你需要内容策划方向，我很擅长～"。

回复风格：专业且亲切，简洁有力，不废话。中文回复为主。`

// ── 严格高风险关键词（只拦截明确账号操作，不影响正常创作词汇）──
const BLOCKED_PATTERNS = [
  /登录.{0,8}(小红书|抖音|微信|微博|账号)/,
  /cookie/i,
  /动态代理|http代理|socks代理|proxy server/i,
  /绕过.{0,6}(风控|检测|审核)/,
  /采集.{0,8}(后台|数据|账号|私信)/,
  /自动.{0,6}(发布|推送|评论|私信|点赞|关注)/,
  /selenium|playwright|puppeteer|headless\s*browser/i,
  /爬虫.{0,8}(账号|数据|后台)/,
  /帮我(登录|进入|操控).{0,8}(账号|后台)/,
]

function isBlocked(text: string): boolean {
  const lower = text.toLowerCase()
  return BLOCKED_PATTERNS.some((p) => p.test(lower))
}

// ── 任务类型 ──────────────────────────────────────────────────────
type TaskType =
  | 'normal_chat'
  | 'creative_chat'
  | 'material_package'
  | 'direction_package'
  | 'copy_rewrite'
  | 'video_script'
  | 'advice_only'
  | 'need_more_info'
  | 'blocked_silent'

// ── 意图推断 ──────────────────────────────────────────────────────
function inferTaskTypeFromText(text: string): TaskType {
  const t = text
  if (/素材包|多平台素材|生成素材/.test(t)) return 'material_package'
  if (/从方向|行业方向|热点方向|趋势分析|帮我分析.{0,6}(行业|赛道|方向)/.test(t)) return 'direction_package'
  if (/改写|优化文案|改得更|改成|改一下这.{0,4}文案|润色/.test(t)) return 'copy_rewrite'
  if (/(短视频|视频).{0,6}脚本|脚本.{0,6}(抖音|视频号|短视频)|帮我.{0,6}脚本/.test(t)) return 'video_script'
  if (/投放建议|广告建议|投放策略|怎么投放/.test(t)) return 'advice_only'
  if (/(小红书|抖音|视频号|公众号).{0,15}(文案|内容|笔记|种草|脚本|方向|选题|标题|封面|配图)/.test(t)) return 'creative_chat'
  if (/(帮我|生成|写|做|创作).{0,15}(文案|内容|笔记|脚本|标题|方向|选题)/.test(t)) return 'creative_chat'
  return 'normal_chat'
}

function inferTaskType(body: Record<string, unknown>): TaskType {
  const mode = body.mode as string | undefined
  if (mode === 'material') {
    const text = (body.material_text as string || '').trim()
    const images = (body.material_images as string[] || [])
    if (!text && !images.length) return 'need_more_info'
    return 'material_package'
  }
  if (mode === 'direction') {
    const industry = (body.industry as string || '').trim()
    if (!industry) return 'need_more_info'
    return 'direction_package'
  }
  const userMessage = (body.user_message as string || body.material_text as string || '').trim()
  if (!userMessage) return 'normal_chat'
  return inferTaskTypeFromText(userMessage)
}

// ── Prompt 模板 ───────────────────────────────────────────────────
const PLATFORM_OUTPUT_SPEC = `
请严格输出 JSON，结构如下（不要输出任何其他内容）：
{
  "小红书": {
    "titles": ["标题1", "标题2", "标题3"],
    "body": "正文（≤1000字）",
    "cover_suggestion": "封面建议",
    "image_prompts": ["提示词1（中文）/ Prompt1 (English)", "提示词2（中文）/ Prompt2 (English)", "提示词3（中文）/ Prompt3 (English)"],
    "hashtags": ["话题1","话题2","话题3","话题4","话题5","话题6","话题7","话题8","话题9","话题10"],
    "best_time": "发布时间建议",
    "ad_advice": "投放建议",
    "risk_warning": "平台合规风险提醒"
  },
  "抖音": { "titles":["..."],"body":"视频脚本（≤800字）","cover_suggestion":"...","image_prompts":["..."],"hashtags":["..."],"best_time":"...","ad_advice":"...","risk_warning":"..." },
  "视频号": { "titles":["..."],"body":"内容（≤600字）","cover_suggestion":"...","image_prompts":["..."],"hashtags":["..."],"best_time":"...","ad_advice":"...","risk_warning":"..." },
  "公众号": { "titles":["..."],"body":"文章正文（≤2000字）","cover_suggestion":"...","image_prompts":["..."],"hashtags":["..."],"best_time":"...","ad_advice":"...","risk_warning":"..." }
}
Luna 基于用户提供素材、公开信息和平台内容规律生成建议。只输出 JSON，不要有多余说明。`

function buildPackagePrompt(taskType: TaskType, body: Record<string, unknown>): string {
  const platforms: string[] = (body.platforms as string[]) || ['小红书', '抖音', '视频号', '公众号']
  const goal = (body.goal as string) || '品牌曝光'
  const materialText = (body.material_text as string) || (body.user_message as string) || ''
  const images = (body.material_images as string[]) || []
  const industry = (body.industry as string) || ''
  const platformList = platforms.join('、')

  if (taskType === 'material_package') {
    const imageNote = images.length > 0 ? `\n用户还上传了 ${images.length} 张图片/视频作为素材参考。` : ''
    return `你是 Luna，专业的多平台内容策略师。\n\n用户提供的素材：\n${materialText}${imageNote}\n\n目标平台：${platformList}\n投放目标：${goal}\n\n请为每个目标平台分别生成完整的内容方案。\n${PLATFORM_OUTPUT_SPEC}`
  }
  if (taskType === 'direction_package') {
    return `你是 Luna，专业的多平台内容策略师，擅长热点趋势分析。\n\n用户的行业方向：${industry}\n目标平台：${platformList}\n投放目标：${goal}\n\n请基于该行业公开信息、平台内容规律和当前热点趋势生成多平台内容素材包。\n${PLATFORM_OUTPUT_SPEC}`
  }
  if (taskType === 'copy_rewrite') {
    return `你是 Luna，专业文案优化师。请对以下内容进行多平台文案改写：\n\n${materialText}\n\n目标平台：${platformList}\n\n${PLATFORM_OUTPUT_SPEC}`
  }
  if (taskType === 'video_script') {
    return `你是 Luna，专业短视频脚本创作师。请为以下内容生成短视频脚本：\n\n${materialText || industry}\n\n目标平台：${platformList}\n\n${PLATFORM_OUTPUT_SPEC}`
  }
  if (taskType === 'advice_only') {
    return `你是 Luna，专业投放策略顾问。请针对以下内容给出详细投放建议：\n\n${materialText || industry}\n\n目标平台：${platformList}\n投放目标：${goal}\n\n${PLATFORM_OUTPUT_SPEC}`
  }
  return materialText || industry
}

// ── JSON 提取与轻量修复 ───────────────────────────────────────────
const ALL_PLATFORMS = ['小红书', '抖音', '视频号', '公众号']

function extractJSON(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) } catch { /* noop */ }
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]+?)```/)
  if (codeBlock) { try { return JSON.parse(codeBlock[1]) } catch { /* noop */ } }
  const braceMatch = text.match(/\{[\s\S]+\}/)
  if (braceMatch) { try { return JSON.parse(braceMatch[0]) } catch { /* noop */ } }
  return null
}

function repairPlatformResult(raw: Record<string, unknown>, requestedPlatforms: string[]): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  const targetPlatforms = requestedPlatforms.length > 0 ? requestedPlatforms : ALL_PLATFORMS
  for (const platform of targetPlatforms) {
    const src = (raw[platform] || {}) as Record<string, unknown>
    result[platform] = {
      titles: Array.isArray(src.titles) ? src.titles : ['标题待生成'],
      body: typeof src.body === 'string' ? src.body : '内容待生成，请重试。',
      cover_suggestion: typeof src.cover_suggestion === 'string' ? src.cover_suggestion : '建议使用高质量产品图或人物出镜图',
      image_prompts: Array.isArray(src.image_prompts) ? src.image_prompts : [],
      hashtags: Array.isArray(src.hashtags) ? src.hashtags : [],
      best_time: typeof src.best_time === 'string' ? src.best_time : '工作日晚间 19:00-22:00',
      ad_advice: typeof src.ad_advice === 'string' ? src.ad_advice : '建议从小预算测试，找到最优人群定向后逐步放量。',
      risk_warning: typeof src.risk_warning === 'string' ? src.risk_warning : 'Luna 基于公开信息生成建议，请在发布前自行核实内容合规性。',
    }
  }
  return result
}

// ── 调用 MiniMax API（minimax-2.7-highspeed）────────────────────
// MiniMax M2.7 响应中 content 会包含 <thinking> 思维链标签，需要过滤
const ABNORMAL_KEYWORDS = ['换绑手机号', '换绑', '手机号', '客服', '工单', '联系我们', '系统繁忙', '请稍后', '访问被拒绝', '权限不足', '无效请求']

function looksAbnormal(text: string): boolean {
  if (!text || text.trim().length < 5) return true
  return ABNORMAL_KEYWORDS.some((k) => text.includes(k))
}

// MiniMax M2.7 会在 content 中输出 <thinking> 思维链，需剥离
function stripThinking(text: string): string {
  return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim()
}

async function callMiniMax(
  message: string,
  history: Array<{role: string; content: string}>,
  systemPrompt?: string,
): Promise<string> {
  const apiKey = Deno.env.get('MINIMAX_API_KEY')
  const baseUrl = (Deno.env.get('MINIMAX_BASE_URL') || 'https://api.minimaxi.chat/v1').replace(/\/$/, '')

  const messages = [
    {role: 'system', content: systemPrompt || LUNA_SYSTEM_PROMPT},
    ...history.slice(-10),
    {role: 'user', content: message},
  ]

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'MiniMax-M2.7-highspeed',
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`MiniMax HTTP ${res.status}: ${errText}`)
  }

  const data = await res.json()
  const rawContent = data?.choices?.[0]?.message?.content || ''
  const content = stripThinking(rawContent)
  console.log('[MiniMax raw]', rawContent.slice(0, 200))
  console.log('[MiniMax stripped]', content.slice(0, 200))

  if (looksAbnormal(content)) {
    throw new Error(`MiniMax returned abnormal content: ${content.slice(0, 100)}`)
  }

  return content
}

// ── 主处理逻辑 ────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: CORS})

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body = await req.json() as Record<string, unknown>
    const userId = body.user_id as string | undefined
    const platforms: string[] = (body.platforms as string[]) || ['小红书', '抖音', '视频号', '公众号']
    const history = (body.history as Array<{role: string; content: string}>) || []
    const userMessage = (body.user_message as string || body.material_text as string || '').trim()

    // 1. 风险检测：命中时交给 MiniMax 以 Luna 角色自然婉拒，用户无感知
    const allText = [body.material_text, body.industry, body.user_message, body.goal]
      .filter(Boolean).join(' ')

    if (isBlocked(allText)) {
      let reply = '这个我没办法帮到你，不过如果你有内容创作的需求，我很擅长～比如帮你做小红书文案、抖音脚本或者多平台素材包？'
      try {
        // 让 Luna 用自己的语气自然转移，不提安保
        reply = await callMiniMax(
          userMessage,
          history,
          LUNA_SYSTEM_PROMPT + '\n\n（注意：本次用户请求涉及账号操作或数据采集，请用自然语气婉拒并引导回内容创作，不要提及任何限制规则或安全层）'
        )
      } catch (_e) { /* 降级用默认话术 */ }

      return Response.json({
        task_type: 'blocked_silent',
        blocked: true,
        reply,
        result: null,
        material_id: null,
      }, {headers: CORS})
    }

    // 2. 推断任务类型
    const taskType = inferTaskType(body)

    // 3. 信息不足 → 追问
    if (taskType === 'need_more_info') {
      return Response.json({
        task_type: 'need_more_info',
        blocked: false,
        reply: '请补充一下素材内容或行业方向，比如产品介绍、活动信息，或者你想做的行业领域，Luna 就能为你生成内容方案了。',
        result: null,
        material_id: null,
      }, {headers: CORS})
    }

    // 4. 对话类 & 创作类 → 直接对话回复
    if (taskType === 'normal_chat' || taskType === 'creative_chat') {
      let reply = ''
      try {
        reply = await callMiniMax(userMessage, history)
      } catch (e) {
        console.error('callMiniMax failed:', e)
        reply = '网络繁忙，请稍后重试。'
      }
      return Response.json({
        task_type: taskType,
        blocked: false,
        reply,
        result: null,
        material_id: null,
      }, {headers: CORS})
    }

    // 5. 素材包任务 → 构建 Prompt → 调 MiniMax → 修复 JSON → 保存
    const prompt = buildPackagePrompt(taskType, body)
    let rawReply = ''
    try {
      rawReply = await callMiniMax(prompt, [], LUNA_SYSTEM_PROMPT)
    } catch (e) {
      console.error('callMiniMax package failed:', e)
    }

    const parsed = rawReply ? extractJSON(rawReply) : null
    const result = repairPlatformResult(parsed || {}, platforms)

    // 6. 保存到 materials 表
    let materialId: string | null = null
    if (userId) {
      const industry = (body.industry as string) || ''
      const materialText = (body.material_text as string) || userMessage
      const title = taskType === 'direction_package'
        ? `${industry} 素材包`
        : materialText.slice(0, 30) || '素材包'

      const {data: saved, error: saveErr} = await supabase
        .from('materials')
        .insert({
          user_id: userId,
          type: 'work',
          title,
          content: JSON.stringify(result).slice(0, 500),
          package_config: {mode: body.mode, platforms, goal: body.goal, industry, task_type: taskType},
          package_result: result,
          source_mode: (body.mode as string) || 'chat',
        })
        .select('id')
        .maybeSingle()

      if (saveErr) console.error('保存 material 失败:', saveErr)
      else materialId = saved?.id || null
    }

    // 7. 生成摘要回复
    const firstPlatform = platforms[0] || '小红书'
    const firstResult = result[firstPlatform] || {}
    const summaryTitle = Array.isArray(firstResult.titles) ? (firstResult.titles as string[])[0] : ''
    const summaryReply = `已为你生成多平台素材包！\n${summaryTitle ? `${firstPlatform}参考标题：「${summaryTitle}」` : ''}\n\n点击下方卡片查看完整内容，也可以继续告诉我你想调整的方向。`

    return Response.json({
      task_type: taskType,
      blocked: false,
      reply: summaryReply,
      result,
      material_id: materialId,
    }, {headers: CORS})

  } catch (err) {
    console.error('luna_guardian 异常:', err)
    return Response.json({
      error: '服务异常，请稍后重试',
      task_type: 'normal_chat',
      blocked: false,
      reply: '服务暂时繁忙，请稍后重试。',
      result: null,
      material_id: null,
    }, {status: 500, headers: CORS})
  }
})

