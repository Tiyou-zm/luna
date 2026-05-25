/**
 * luna_guardian — Luna AI 主入口：安保层 + 路由层 + 格式修复层
 *
 * 架构：
 *  小程序 chat/index → luna_guardian → [安保判断] → luna_hermes_chat → Hermes
 *
 * 三层安保流水线（白名单优先，LLM兜底灰色地带）：
 *  1. 白名单快通道：平台词 + 创作词/内容对象 → 直接放行，不调 LLM（最快）
 *  2. 黑名单快拦截：明确违禁正则命中 → 直接 safe_redirect，不调 LLM（第二快）
 *  3. LLM 灰色地带（MiniMax）：两边都未命中 → 语义判断意图（最慢但最准）
 *
 * 安保通过后统一路由到 Hermes（通过 luna_hermes_chat）：
 *  allow_chat       → Hermes 对话模式
 *  allow_generate   → Hermes 生成素材包，luna_guardian 做 JSON 修复 + 保存
 *
 * MiniMax 只负责：灰色地带语义判断（llmJudge），不参与正式创作。
 *
 * 五类处理动作：
 *  allow_chat       普通放行，Hermes 对话回复
 *  allow_generate   允许生成素材包/内容方案，Hermes 生成
 *  ask_clarify      追问澄清，意图不明确时
 *  safe_redirect    安全转向，触碰禁止范围
 *  sanitize_output  输出修正，静默修正敏感描述
 *
 * 路由日志格式：
 *  [luna_route] entry = luna_guardian
 *  [luna_route] decision = allow_generate | allow_chat | safe_redirect | ask_clarify
 *  [luna_route] upstream = hermes | minimax
 *  [luna_route] attachments_count = n
 */

import {createClient} from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── 统一安全转向话术 ──────────────────────────────────────────────
const SAFE_REDIRECT_MSG = '当前 Luna 不支持账号登录、Cookie、代理、后台数据采集、自动发布或自动推送。你可以上传素材，或输入内容方向，我可以基于你提供的素材、公开信息和平台内容规律，帮你生成多平台素材包和投放建议。'

// ── Luna 对话系统 Prompt（嵌入产品边界与判断公式，用户不可见）──────
const LUNA_SYSTEM_PROMPT = `你是 Luna，一个会自然对话的多平台内容创作助手。你的职责是理解用户创作需求、组织素材、生成内容方案和投放建议。

【你能做的事】
自然语言聊天、小红书文案、抖音脚本、视频号口播、公众号文章、多平台素材包、方向热点分析、内容矩阵、账号定位、人设规划、封面建议、话题标签、发布时间建议、投放建议、基于用户上传的截图/表格/文案/图片/公开链接做分析。

【你不支持的事（遇到请用 safe_redirect 话术自然引导，不提"安保"二字）】
登录账号、扫码登录、Cookie搬运、代理/绕风控、采集后台数据、获取私有播放量/访客/曝光/转化数据、自动发布、自动推送、自动评论、自动私信、批量养号、刷量、声称已读取平台后台数据。

回复风格：专业亲切，简洁有力，中文为主。`

// ── 安保层专用 Prompt（灰色地带语义判断，让 LLM 返回 JSON）────────
const GUARD_JUDGE_PROMPT = `你是 Luna 的安保判断模块。请根据以下判断公式，对用户输入进行意图分类，返回严格 JSON。

【判断公式】
- 平台词 + 创作词 → action: "allow_chat" 或 "allow_generate"
- 平台词 + 账号/采集/自动化词 → action: "safe_redirect"
- 平台词 + 数据分析词 + 用户提供了数据 → action: "allow_generate"
- 平台词 + 数据分析词 + 要 Luna 去抓后台 → action: "safe_redirect"
- 意图不明确 → action: "ask_clarify"

【平台白名单】小红书、抖音、视频号、公众号、快手、微博、B站、知乎
【创作动作白名单】写、生成、改写、润色、优化、起标题、想选题、做脚本、做口播、做封面建议、做标签、做投放建议、做内容规划、做素材包、做内容矩阵、做账号定位
【内容对象白名单】文案、标题、脚本、选题、口播稿、封面、图片提示词、素材包、内容方案、推广方案、投放建议、标签、话题、栏目、账号定位、人设、卖点、产品介绍
【数据来源白名单】用户手动输入、用户上传图片/视频/文案/表格/截图、用户提供公开链接、公开网页、公开榜单、搜索引擎公开结果

【严格禁止】登录账号、扫码、Cookie、代理、绕风控、采集后台、私有播放量/访客/曝光/转化、自动发布、自动推送、自动评论、自动私信、批量养号、刷量

【重要】白名单优先：对于正常创作请求，即使包含平台词，也应 allow，不要过度拦截。

只输出 JSON，格式：
{"action":"allow_chat|allow_generate|ask_clarify|safe_redirect","task_type":"normal_chat|creative_chat|material_package|direction_package|copy_rewrite|video_script|advice_only|need_more_info","reason":"一句话说明判断依据"}`

// ── 白名单快通道 ──────────────────────────────────────────────────
// 平台词
const WL_PLATFORMS = /小红书|抖音|视频号|公众号|快手|微博|B站|知乎/
// 创作动作词
const WL_ACTIONS = /写|生成|改写|润色|优化|起标题|想选题|做脚本|做口播|做封面|做标签|做投放|做内容|做素材|做矩阵|做账号定位|帮我写|帮我做|帮我生成|帮我想|整理|看看|看一下|分析/
// 内容对象词
const WL_OBJECTS = /文案|标题|脚本|选题|口播稿|封面|图片提示词|素材包|内容方案|推广方案|投放建议|话题标签|账号定位|人设|卖点|产品介绍|内容矩阵|种草|笔记|内容规划|内容|发布时间|最佳时间|内容方向|公开链接/
// 通用创作意图词（不需要平台词也放行）
const WL_GENERIC_CREATE = /(帮我|请|我想|给我).{0,10}(写|生成|做|创作|策划|规划|起|想|整理|看看|分析).{0,15}(文案|脚本|标题|内容|素材|笔记|方案|口播|封面|方向|建议)/

/**
 * 白名单检查：命中返回处理动作，未命中返回 null
 */
function checkWhitelist(text: string): 'allow_chat' | 'allow_generate' | null {
  // 纯咨询/讨论类（含平台词且为疑问/讨论语气，未命中黑名单）→ 直接对话放行
  if (WL_PLATFORMS.test(text) && /[吗？]|怎么样|好不好|值不值|还能不能|能不能|有没有|呢/.test(text) && !checkBlacklist(text)) {
    return 'allow_chat'
  }
  // 明确的创作建议/时间/方案类请求（即使没有平台词）→ 直接放行
  const timeKeywords = ['发布时间', '最佳时间', '发内容时间', '发布时间建议', '最佳发布时间', '发布时间规划']
  if (timeKeywords.some((kw) => text.includes(kw))) return 'allow_chat'
  // 通用创作意图（不含平台词也放行）
  if (WL_GENERIC_CREATE.test(text)) return 'allow_generate'
  // 平台词 + (创作动作词 或 内容对象词) → 放行
  if (WL_PLATFORMS.test(text) && (WL_ACTIONS.test(text) || WL_OBJECTS.test(text))) {
    // 含素材包/方向/脚本/内容关键词 → allow_generate（需要生成结构化内容）
    if (/素材包|内容方案|脚本|口播稿|内容矩阵|内容方向|发布时间|最佳时间/.test(text)) return 'allow_generate'
    return 'allow_chat'
  }
  // 纯创作对象词（不含平台词）→ 放行为对话
  if (WL_OBJECTS.test(text) && WL_ACTIONS.test(text)) return 'allow_chat'
  return null
}

// ── 黑名单快拦截 ──────────────────────────────────────────────────
const BLACKLIST_PATTERNS = [
  // 登录 / 扫码
  /登录.{0,10}(小红书|抖音|微信|微博|视频号|快手|账号|平台)/,
  /扫码.{0,6}(登录|绑定|授权)/,
  /帮(我|助).{0,6}(登录|进入|操控).{0,10}(账号|后台|平台)/,
  // Cookie / 登录态
  /cookie/i,
  /登录.{0,6}(态|token|凭证|session)/i,
  // 代理
  /动态代理|http代理|socks代理|proxy.server|ip.池/i,
  /绕过.{0,6}(风控|检测|审核|封号)/,
  // 后台数据采集
  /采集.{0,10}(后台|私有|账号|私信|粉丝列表)/,
  /爬.{0,6}(后台|账号数据|私有数据)/,
  /获取.{0,6}(后台|私有).{0,6}(数据|播放量|访客|曝光|转化)/,
  /抓取.{0,6}(后台|账号|私有)/,
  // 自动化发布 / 运营
  /自动.{0,6}(发布|推送|评论|私信|点赞|关注|养号)/,
  /批量.{0,6}(养号|发布|私信|评论|注册)/,
  /刷(播放|粉|赞|量|流量)/,
  // 自动化工具
  /selenium|playwright|puppeteer|headless.?browser/i,
  // 声称读取后台
  /已经.{0,6}(读取|获取|拿到).{0,6}(后台|账号|私有)/,
  /帮你.{0,6}(读取|抓取|采集).{0,6}后台/,
]

function checkBlacklist(text: string): boolean {
  const lower = text.toLowerCase()
  return BLACKLIST_PATTERNS.some((p) => p.test(lower))
}

// ── 处理动作类型 ──────────────────────────────────────────────────
type GuardAction = 'allow_chat' | 'allow_generate' | 'ask_clarify' | 'safe_redirect' | 'sanitize_output'

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

// ── 任务类型推断（用于白名单快通道命中后） ───────────────────────
function inferTaskTypeFromText(text: string): TaskType {
  if (/素材包|多平台素材|生成素材/.test(text)) return 'material_package'
  if (/从方向|行业方向|热点方向|趋势分析|帮我分析.{0,6}(行业|赛道|方向)/.test(text)) return 'direction_package'
  if (/改写|优化文案|改得更|改成|改一下这.{0,4}文案|润色/.test(text)) return 'copy_rewrite'
  if (/(短视频|视频).{0,6}脚本|脚本.{0,6}(抖音|视频号|短视频)|帮我.{0,6}脚本/.test(text)) return 'video_script'
  if (/投放建议|广告建议|投放策略|怎么投放/.test(text)) return 'advice_only'
  if (/(小红书|抖音|视频号|公众号|快手|微博|B站|知乎).{0,20}(文案|内容|笔记|种草|脚本|方向|选题|标题|封面|配图|口播)/.test(text)) return 'creative_chat'
  if (/(帮我|生成|写|做|创作).{0,15}(文案|内容|笔记|脚本|标题|方向|选题|口播)/.test(text)) return 'creative_chat'
  if (/账号定位|人设规划|内容矩阵|选题规划/.test(text)) return 'advice_only'
  return 'normal_chat'
}

function inferTaskType(body: Record<string, unknown>): TaskType {
  const mode = body.mode as string | undefined
  if (mode === 'material') {
    const text = (body.material_text as string || '').trim()
    const images = (body.material_images as string[] || [])
    const fileUrl = (body.material_file_url as string || '').trim()
    if (!text && !images.length && !fileUrl) return 'need_more_info'
    return 'material_package'
  }
  if (mode === 'direction') {
    const industry = (body.industry as string || '').trim()
    if (!industry) return 'need_more_info'
    return 'direction_package'
  }
  // 有图片或文件附件时，直接识别为素材包任务（无需依赖 user_message 内容）
  const hasImages = Array.isArray(body.material_images) && (body.material_images as string[]).length > 0
  const hasFile = !!(body.material_file_url as string || '').trim()
  if (hasImages || hasFile) return 'material_package'

  const userMessage = (body.user_message as string || body.material_text as string || '').trim()
  if (!userMessage) return 'normal_chat'
  return inferTaskTypeFromText(userMessage)
}

// ── Prompt 模板 ───────────────────────────────────────────────────
const PLATFORM_OUTPUT_SPEC = `
请严格输出 JSON，结构如下（不要输出任何其他内容）：
{
  "小红书": {
    "titles": ["标题1","标题2","标题3"],
    "body": "正文（≤600字）",
    "cover_suggestion": "封面建议（一句话）",
    "image_prompts": ["提示词1","提示词2"],
    "hashtags": ["话题1","话题2","话题3","话题4","话题5"],
    "best_time": "发布时间建议",
    "ad_advice": "投放建议（一句话）",
    "risk_warning": "合规提醒（一句话）"
  },
  "抖音": { "titles":["..."],"body":"脚本（≤500字）","cover_suggestion":"...","image_prompts":["..."],"hashtags":["..."],"best_time":"...","ad_advice":"...","risk_warning":"..." },
  "视频号": { "titles":["..."],"body":"内容（≤400字）","cover_suggestion":"...","image_prompts":["..."],"hashtags":["..."],"best_time":"...","ad_advice":"...","risk_warning":"..." },
  "公众号": { "titles":["..."],"body":"文章（≤800字）","cover_suggestion":"...","image_prompts":["..."],"hashtags":["..."],"best_time":"...","ad_advice":"...","risk_warning":"..." }
}
只输出 JSON，不要有多余说明。`

function buildPackagePrompt(taskType: TaskType, body: Record<string, unknown>): string {
  const platforms: string[] = (body.platforms as string[]) || ['小红书', '抖音', '视频号', '公众号']
  const goal = (body.goal as string) || '品牌曝光'
  const materialText = (body.material_text as string) || (body.user_message as string) || ''
  const images = (body.material_images as string[]) || []
  const industry = (body.industry as string) || ''
  const platformList = platforms.join('、')

  if (taskType === 'material_package') {
    const imageNote = images.length > 0 ? `\n用户还上传了 ${images.length} 张图片/视频作为素材参考。` : ''
    const fileUrl = (body.material_file_url as string || '').trim()
    const fileNote = fileUrl ? `\n用户上传了文件素材，文件地址：${fileUrl}，请基于该文件内容生成多平台内容方案。` : ''
    return `你是 Luna，专业的多平台内容策略师。\n\n用户提供的素材：\n${materialText || '（用户上传了附件素材）'}${imageNote}${fileNote}\n\n目标平台：${platformList}\n投放目标：${goal}\n\n请为每个目标平台分别生成完整的内容方案。\n${PLATFORM_OUTPUT_SPEC}`
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

// ── 调用 MiniMax API ──────────────────────────────────────────────
// 异常内容检测（只检测明确的客服/系统类非预期回复）
const ABNORMAL_KEYWORDS = ['换绑手机号', '联系客服', '工单号', '联系我们处理', '访问被拒绝', '权限不足', '无效的API']

function looksAbnormal(text: string): boolean {
  if (!text || text.trim().length < 5) return true
  return ABNORMAL_KEYWORDS.some((k) => text.includes(k))
}

// MiniMax M2.7 会在 content 中输出 <thinking>/<think> 思维链，需剥离
function stripThinking(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .trim()
}

async function callMiniMax(
  message: string,
  history: Array<{role: string; content: string}>,
  systemPrompt: string,
): Promise<string> {
  const apiKey = Deno.env.get('MINIMAX_API_KEY')
  const baseUrl = (Deno.env.get('MINIMAX_BASE_URL') || 'https://api.minimaxi.com/v1').replace(/\/$/, '')

  const messages = [
    {role: 'system', content: systemPrompt},
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
  console.log('[MiniMax raw]', rawContent.slice(0, 300))
  console.log('[MiniMax stripped]', content.slice(0, 300))

  if (looksAbnormal(content)) {
    throw new Error(`MiniMax returned abnormal content: ${content.slice(0, 100)}`)
  }

  return content
}

// ── 灰色地带：让 LLM 做语义判断（返回结构化 JSON）────────────────
async function llmJudge(
  userInput: string,
  history: Array<{role: string; content: string}>,
): Promise<{action: GuardAction; task_type: TaskType; reason: string}> {
  let raw = ''
  try {
    raw = await callMiniMax(
      `请判断以下用户输入的意图：\n\n"${userInput}"\n\n只返回 JSON，不要其他内容。`,
      history,
      GUARD_JUDGE_PROMPT,
    )
  } catch (e) {
    console.error('[llmJudge] callMiniMax failed:', e)
    // 调用失败默认放行对话（保护创作体验优先）
    return {action: 'allow_chat', task_type: 'normal_chat', reason: 'LLM call failed, default allow'}
  }

  const parsed = extractJSON(raw)
  if (parsed && typeof parsed.action === 'string') {
    return {
      action: (parsed.action as GuardAction) || 'allow_chat',
      task_type: (parsed.task_type as TaskType) || 'normal_chat',
      reason: (parsed.reason as string) || '',
    }
  }
  // JSON 解析失败 → 默认放行（白名单优先原则）
  console.warn('[llmJudge] JSON parse failed, raw:', raw.slice(0, 200))
  return {action: 'allow_chat', task_type: 'normal_chat', reason: 'JSON parse failed, default allow'}
}

// ── 附件 metadata 类型（与前端 AttachmentMeta 对应）─────────────
interface AttachmentMeta {
  type: 'image' | 'file' | 'video'
  file_url: string
  file_key: string
  mime_type: string
  file_type: string
  name: string
  size?: number
}

// ── 调用 luna_hermes_chat（内部 Edge Function）────────────────────
async function callHermes(params: {
  systemPrompt: string
  userMessage: string
  history: Array<{role: string; content: string}>
  attachments: AttachmentMeta[]
  taskType: TaskType
  platforms: string[]
  goal: string
  materialText: string
  industry: string
  authHeader: string
  supabaseUrl: string
  serviceRoleKey: string
}): Promise<string> {
  const url = `${params.supabaseUrl}/functions/v1/luna_hermes_chat`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.serviceRoleKey}`,
    },
    body: JSON.stringify({
      system_prompt: params.systemPrompt,
      user_message: params.userMessage,
      messages: params.history,
      attachments: params.attachments,
      task_type: params.taskType,
      platforms: params.platforms,
      goal: params.goal,
      material_text: params.materialText,
      industry: params.industry,
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`luna_hermes_chat HTTP ${res.status}: ${errText}`)
  }
  const data = await res.json()
  return data.reply || ''
}

// ── 主处理逻辑 ────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: CORS})

  // 路由日志：入口
  console.log('[luna_route] entry = luna_guardian')

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json() as Record<string, unknown>
    const userId = body.user_id as string | undefined
    const platforms: string[] = (body.platforms as string[]) || ['小红书', '抖音', '视频号', '公众号']
    const history = (body.history as Array<{role: string; content: string}>) || []
    const authHeader = req.headers.get('Authorization') || `Bearer ${serviceRoleKey}`

    // ── 附件 metadata：支持新格式 attachments[] 和旧格式字段两种 ─
    let attachments: AttachmentMeta[] = []
    if (Array.isArray(body.attachments) && (body.attachments as AttachmentMeta[]).length > 0) {
      attachments = body.attachments as AttachmentMeta[]
    } else {
      // 兼容旧格式：material_images / material_file_url
      const legacyImages = Array.isArray(body.material_images) ? (body.material_images as string[]) : []
      const legacyFile = (body.material_file_url as string || '').trim()
      for (const url of legacyImages) {
        attachments.push({type: 'image', file_url: url, file_key: '', mime_type: 'image/*', file_type: 'jpg', name: '图片'})
      }
      if (legacyFile) {
        const ext = legacyFile.split('.').pop() || 'file'
        attachments.push({type: 'file', file_url: legacyFile, file_key: '', mime_type: 'application/octet-stream', file_type: ext, name: `文件.${ext}`})
      }
    }

    // 安保检测仅针对文字输入；文件/图片 URL 不参与安保，只在生成阶段使用
    const userMessage = (body.user_message as string || body.material_text as string || '').trim()
    const allInputText = [body.material_text, body.industry, body.user_message, body.goal]
      .filter(Boolean).map(String).join(' ')

    console.log('[luna_route] attachments_count =', attachments.length)
    console.log('[guard] userMessage:', userMessage.slice(0, 100))

    // ═══════════════════════════════════════════════════════════════
    // 第一层：白名单快通道（不调 LLM，最快）
    // ═══════════════════════════════════════════════════════════════
    const whitelistAction = checkWhitelist(allInputText || userMessage)
    let guardAction: GuardAction
    let guardTaskType: TaskType

    if (whitelistAction) {
      console.log('[guard] whitelist hit →', whitelistAction)
      guardAction = whitelistAction
      guardTaskType = inferTaskType(body)
    } else {
      // ═══════════════════════════════════════════════════════════════
      // 第二层：黑名单快拦截（不调 LLM，第二快）
      // ═══════════════════════════════════════════════════════════════
      const blacklisted = checkBlacklist(allInputText || userMessage)
      if (blacklisted) {
        console.log('[guard] blacklist hit → safe_redirect')
        console.log('[luna_route] decision = safe_redirect')
        return Response.json({
          action: 'safe_redirect',
          task_type: 'normal_chat',
          blocked: true,
          reply: SAFE_REDIRECT_MSG,
          result: null,
          material_id: null,
        }, {headers: CORS})
      }

      // ═══════════════════════════════════════════════════════════════
      // 第三层：MiniMax 灰色地带判断（只做意图分类，不做正式创作）
      // ═══════════════════════════════════════════════════════════════
      console.log('[guard] grey zone → calling MiniMax judge')
      const judged = await llmJudge(userMessage || allInputText, history)
      console.log('[guard] MiniMax judge result:', JSON.stringify(judged))

      if (judged.action === 'safe_redirect') {
        console.log('[luna_route] decision = safe_redirect')
        return Response.json({
          action: 'safe_redirect',
          task_type: 'normal_chat',
          blocked: true,
          reply: SAFE_REDIRECT_MSG,
          result: null,
          material_id: null,
        }, {headers: CORS})
      }

      if (judged.action === 'ask_clarify') {
        console.log('[luna_route] decision = ask_clarify')
        return Response.json({
          action: 'ask_clarify',
          task_type: 'need_more_info',
          blocked: false,
          reply: '请补充一下你的需求，比如产品介绍、活动信息，或者你想做的行业领域，Luna 就能为你生成内容方案了。',
          result: null,
          material_id: null,
        }, {headers: CORS})
      }

      guardAction = judged.action as GuardAction
      guardTaskType = judged.task_type || inferTaskType(body)
    }

    // 信息不足：追问
    if (guardTaskType === 'need_more_info') {
      console.log('[luna_route] decision = ask_clarify')
      return Response.json({
        action: 'ask_clarify',
        task_type: 'need_more_info',
        blocked: false,
        reply: '请补充一下素材内容或行业方向，比如产品介绍、活动信息，或者你想做的行业领域，Luna 就能为你生成内容方案了。',
        result: null,
        material_id: null,
      }, {headers: CORS})
    }

    const materialText = (body.material_text as string) || userMessage
    const industry = (body.industry as string) || ''
    const goal = (body.goal as string) || '品牌曝光'

    // ─── 对话类 & 创作类 → Hermes 对话 ─────────────────────────────
    if (guardAction === 'allow_chat' || guardTaskType === 'normal_chat' || guardTaskType === 'creative_chat' || guardTaskType === 'advice_only') {
      console.log('[luna_route] decision = allow_chat')
      console.log('[luna_route] upstream = hermes')
      let reply = ''
      try {
        reply = await callHermes({
          systemPrompt: LUNA_SYSTEM_PROMPT,
          userMessage,
          history,
          attachments,
          taskType: guardTaskType,
          platforms,
          goal,
          materialText,
          industry,
          authHeader,
          supabaseUrl,
          serviceRoleKey,
        })
      } catch (e) {
        console.error('[guard] callHermes chat failed:', e)
        reply = '抱歉，我暂时无法回复，请稍后再试。'
      }
      return Response.json({
        action: guardAction,
        task_type: guardTaskType,
        blocked: false,
        reply,
        result: null,
        material_id: null,
      }, {headers: CORS})
    }

    // ─── 素材包/内容生成任务 → 构建 Prompt → Hermes 生成 → 修复 JSON → 保存 ──
    console.log('[luna_route] decision = allow_generate')
    console.log('[luna_route] upstream = hermes')

    const prompt = buildPackagePrompt(guardTaskType, body)
    let rawReply = ''
    try {
      rawReply = await callHermes({
        systemPrompt: LUNA_SYSTEM_PROMPT,
        userMessage: prompt,
        history: [],
        attachments,
        taskType: guardTaskType,
        platforms,
        goal,
        materialText,
        industry,
        authHeader,
        supabaseUrl,
        serviceRoleKey,
      })
    } catch (e) {
      console.error('[guard] callHermes package failed:', e)
    }

    const parsed = rawReply ? extractJSON(rawReply) : null
    const result = repairPlatformResult(parsed || {}, platforms)

    // 保存到 materials 表
    let materialId: string | null = null
    if (userId) {
      const title = guardTaskType === 'direction_package'
        ? `${industry} 素材包`
        : materialText.slice(0, 30) || '素材包'

      const {data: saved, error: saveErr} = await supabase
        .from('materials')
        .insert({
          user_id: userId,
          type: 'work',
          title,
          content: JSON.stringify(result).slice(0, 500),
          package_config: {mode: body.mode, platforms, goal, industry, task_type: guardTaskType},
          package_result: result,
          source_mode: (body.mode as string) || 'chat',
        })
        .select('id')
        .maybeSingle()

      if (saveErr) console.error('[guard] 保存 material 失败:', saveErr)
      else materialId = saved?.id || null
    }

    // 生成摘要回复
    const firstPlatform = platforms[0] || '小红书'
    const firstResult = result[firstPlatform] || {}
    const summaryTitle = Array.isArray(firstResult.titles) ? (firstResult.titles as string[])[0] : ''
    const summaryReply = `已为你生成多平台素材包！\n${summaryTitle ? `${firstPlatform}参考标题：「${summaryTitle}」` : ''}\n\n点击下方卡片查看完整内容，也可以继续告诉我你想调整的方向。`

    return Response.json({
      action: 'allow_generate',
      task_type: guardTaskType,
      blocked: false,
      reply: summaryReply,
      result,
      material_id: materialId,
    }, {headers: CORS})

  } catch (err) {
    console.error('[guard] 异常:', err)
    return Response.json({
      error: '服务异常，请稍后重试',
      action: 'allow_chat',
      task_type: 'normal_chat',
      blocked: false,
      reply: '服务暂时繁忙，请稍后重试。',
      result: null,
      material_id: null,
    }, {status: 500, headers: CORS})
  }
})

