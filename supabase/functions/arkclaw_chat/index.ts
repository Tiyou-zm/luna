// ClawSolo 对话中转 - 接入 Hermes Agent（Luna 2.0）
// Endpoint：http://152.136.47.2:8642/v1/chat/completions
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  两阶段扣费架构                                                         │
// │  阶段一（调用 Hermes 之前）：从用户输入判断意图 → 预检配额/余额/权限 │
// │  阶段二（收到 Hermes 回复）：从回复读实际秒数/张数 → 按实际消耗扣费  │
// └─────────────────────────────────────────────────────────────────────────┘
import {createClient} from 'jsr:@supabase/supabase-js@2'

// ===== 套餐配额配置（与前端 PLANS 保持同步）=====
const PLAN_QUOTAS: Record<string, {videoSeconds: number; graphicCount: number}> = {
  free:          {videoSeconds: 0,    graphicCount: 8},
  graphic:       {videoSeconds: 0,    graphicCount: 50},
  video_starter: {videoSeconds: 120,  graphicCount: 40},
  video_pro:     {videoSeconds: 280,  graphicCount: 30},
  professional:  {videoSeconds: 800,  graphicCount: 60},
  enterprise:    {videoSeconds: 1200, graphicCount: 100}
}

// ===== 火山 ARK 扣费单价（元）=====
const PRICE_VIDEO_PER_SECOND = 0.8  // Seedance 系列视频生成
const PRICE_IMAGE_PER_COUNT  = 0.06 // 文生图每张

// ===== 阶段一：从用户输入判断意图类型 =====
// 目的：在调用 Hermes 之前就知道这是什么类型的请求，做配额预检
function detectIntentFromMessage(message: string): 'video' | 'image' | 'text' {
  const msg = message.toLowerCase()
  // 视频意图：包含"视频"且含有生成类动词，或含有 video 关键词
  const isVideoIntent =
    (/视频/.test(msg) && /生成|制作|创建|创作|做|拍|录|剪/.test(msg)) ||
    /生成.*视频|视频.*生成/.test(msg) ||
    /generate.*video|video.*generate|create.*video/.test(msg)
  if (isVideoIntent) return 'video'

  // 图片意图：包含"图片/图像/海报/封面/配图"且含有生成类动词
  const isImageIntent =
    (/图片|图像|海报|封面|配图|插图|贴图/.test(msg) && /生成|制作|创建|创作|做|画|绘|设计/.test(msg)) ||
    /生成.*图|图.*生成/.test(msg) ||
    /generate.*image|image.*generate|create.*image/.test(msg)
  if (isImageIntent) return 'image'

  return 'text'
}

// ===== 阶段一：预检——在调用 Hermes 前做配额/权限/余额检查 =====
// 视频/图片预检使用保守估算量（视频5秒，图片1张）
// 目的：拦截明显不满足条件的请求，避免白白消耗 Hermes TokenPlan 次数
interface PreflightResult {
  blocked: boolean
  reason?: string
  intent: 'video' | 'image' | 'text'
  estimatedCost: number
}

function preflightCheck(
  intent: 'video' | 'image' | 'text',
  profile: {membership_level?: string; ai_count?: number; balance?: number; video_seconds_used?: number; graphic_count_used?: number} | null
): PreflightResult {
  const membershipLevel = profile?.membership_level || 'free'
  const quota = PLAN_QUOTAS[membershipLevel] || PLAN_QUOTAS['free']
  const currentBalance = Number(profile?.balance || 0)
  const videoUsed = Number(profile?.video_seconds_used || 0)
  const graphicUsed = Number(profile?.graphic_count_used || 0)

  // 文字对话：仅检查免费次数
  if (intent === 'text') {
    if (membershipLevel === 'free' && (profile?.ai_count || 0) >= 8) {
      return {blocked: true, reason: '免费对话额度已用完，请升级套餐后继续使用。', intent, estimatedCost: 0}
    }
    return {blocked: false, intent, estimatedCost: 0}
  }

  // 视频预检：默认估算 5 秒
  // 规则（PRD 4.21）：配额足够 → 直接通过，不检查余额；配额不足 → 超出部分检查算力
  if (intent === 'video') {
    const estimatedSeconds = 5
    if (quota.videoSeconds === 0) {
      return {blocked: true, reason: `您的${membershipLevel === 'free' ? '免费版' : '当前套餐'}不支持视频生成，请升级套餐。`, intent, estimatedCost: 0}
    }
    const quotaRemaining = Math.max(0, quota.videoSeconds - videoUsed)
    if (quotaRemaining >= estimatedSeconds) {
      // 配额充裕，直接放行，不消耗算力余额
      return {blocked: false, intent, estimatedCost: 0}
    }
    // 配额不足：超出部分需要算力支付
    const paidSeconds = estimatedSeconds - quotaRemaining
    const estimatedCost = paidSeconds * PRICE_VIDEO_PER_SECOND
    if (currentBalance < estimatedCost) {
      return {
        blocked: true,
        reason: quotaRemaining > 0
          ? `套餐视频配额仅剩 ${quotaRemaining} 秒，算力余额不足（还需约¥${estimatedCost.toFixed(2)}，余额¥${currentBalance.toFixed(2)}），请充值后再试。`
          : `套餐视频时长已用尽（配额${quota.videoSeconds}秒），算力余额不足（预估需¥${estimatedCost.toFixed(2)}，余额¥${currentBalance.toFixed(2)}），请充值或升级套餐。`,
        intent, estimatedCost
      }
    }
    return {blocked: false, intent, estimatedCost}
  }

  // 图片预检：默认估算 1 张
  // 规则（PRD 4.21）：配额足够 → 直接通过，不检查余额；配额不足 → 超出部分检查算力
  if (intent === 'image') {
    const estimatedCount = 1
    const quotaRemaining = Math.max(0, quota.graphicCount - graphicUsed)
    if (quotaRemaining >= estimatedCount) {
      // 配额充裕，直接放行
      return {blocked: false, intent, estimatedCost: 0}
    }
    // 配额不足：超出部分需要算力支付
    const paidCount = estimatedCount - quotaRemaining
    const estimatedCost = paidCount * PRICE_IMAGE_PER_COUNT
    if (currentBalance < estimatedCost) {
      return {
        blocked: true,
        reason: quotaRemaining > 0
          ? `套餐图片配额仅剩 ${quotaRemaining} 张，算力余额不足（还需约¥${estimatedCost.toFixed(2)}，余额¥${currentBalance.toFixed(2)}），请充值后再试。`
          : `套餐图片配额已用尽（配额${quota.graphicCount}张），算力余额不足（预估需¥${estimatedCost.toFixed(2)}，余额¥${currentBalance.toFixed(2)}），请充值或升级套餐。`,
        intent, estimatedCost
      }
    }
    return {blocked: false, intent, estimatedCost}
  }

  return {blocked: false, intent, estimatedCost: 0}
}

// ===== 阶段二：从 Hermes 回复读取实际消耗量 =====
// 有了阶段一的 intent 辅助，只需要确认实际秒数/张数，不需要再猜类型
interface ActualUsage {
  type: 'video' | 'image' | 'text'
  quantity: number   // 视频:秒数, 图片:张数, 文字:tokens
  model: string
}

// ===== 约定标记格式（嵌入回复末尾，不展示给用户）=====
// Hermes 生成完视频/图片后必须追加：
//   <!--LUNA_META:{"type":"video","duration_seconds":8,"model":"seedance"}-->
//   <!--LUNA_META:{"type":"image","count":2,"model":"seedream"}-->
const LUNA_META_RE = /<!--LUNA_META:([\s\S]*?)-->/

// 从回复文本中提取 LUNA_META 标记，并返回 {meta, cleanReply}
function parseLunaMeta(reply: string): {meta: Record<string, unknown> | null; cleanReply: string} {
  const match = reply.match(LUNA_META_RE)
  if (!match) return {meta: null, cleanReply: reply}
  try {
    const meta = JSON.parse(match[1].trim()) as Record<string, unknown>
    const cleanReply = reply.replace(LUNA_META_RE, '').trim()
    return {meta, cleanReply}
  } catch {
    return {meta: null, cleanReply: reply}
  }
}

function extractActualUsage(
  reply: string,
  hermesData: Record<string, unknown>,
  intent: 'video' | 'image' | 'text'
): ActualUsage {
  const tokens = Number((hermesData?.usage as Record<string, unknown>)?.total_tokens || 0)

  // 优先级1：回复末尾的 <!--LUNA_META:{...}--> 约定标记（最准确，Hermes 主动上报）
  const {meta: lunaMeta} = parseLunaMeta(reply)
  if (lunaMeta) {
    if (lunaMeta.type === 'video') {
      return {type: 'video', quantity: Number(lunaMeta.duration_seconds || lunaMeta.seconds || 5), model: String(lunaMeta.model || 'seedance')}
    }
    if (lunaMeta.type === 'image') {
      return {type: 'image', quantity: Number(lunaMeta.count || 1), model: String(lunaMeta.model || 'seedream')}
    }
  }

  // 优先级2：hermesData.metadata 结构化字段（Hermes API 层透传）
  const apiMeta = (hermesData?.metadata || hermesData?.generation_info || {}) as Record<string, unknown>
  if (apiMeta?.type === 'video') {
    return {type: 'video', quantity: Number(apiMeta.duration_seconds || apiMeta.seconds || 5), model: String(apiMeta.model || 'seedance')}
  }
  if (apiMeta?.type === 'image') {
    return {type: 'image', quantity: Number(apiMeta.count || 1), model: String(apiMeta.model || 'seedream')}
  }

  // 优先级3：从回复文字中提取数字（辅助匹配）
  if (intent === 'video') {
    const durationMatch = reply.match(
      /(?:已生成|生成了?|完成了?).*?(\d+(?:\.\d+)?)\s*秒.*?视频|视频.*?(\d+(?:\.\d+)?)\s*秒|duration[：:]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*s\s*video/i
    )
    if (durationMatch) {
      const secs = parseFloat(durationMatch[1] || durationMatch[2] || durationMatch[3] || durationMatch[4] || '5')
      return {type: 'video', quantity: secs, model: String(apiMeta.model || 'seedance')}
    }
    // 回复里出现视频 URL：确认已生成，按5秒默认
    if (/\.(mp4|mov|webm)(\?|$|\s|")/i.test(reply)) {
      return {type: 'video', quantity: 5, model: 'seedance'}
    }
    // 无法确认实际已生成 → 降级为文字，不扣视频配额
    return {type: 'text', quantity: tokens, model: 'hunyuan'}
  }

  if (intent === 'image') {
    const countMatch = reply.match(/(?:已生成|生成了?).*?(\d+)\s*张.*?图|(\d+)\s*张图片|图片数量[：:]\s*(\d+)/i)
    if (countMatch) {
      const count = parseInt(countMatch[1] || countMatch[2] || countMatch[3] || '1', 10)
      return {type: 'image', quantity: count, model: String(apiMeta.model || 'seedream')}
    }
    // 回复里出现图片 URL：确认已生成，按1张默认
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$|\s|")/i.test(reply)) {
      return {type: 'image', quantity: 1, model: 'seedream'}
    }
    // 无法确认实际已生成 → 降级为文字，不扣图片配额
    return {type: 'text', quantity: tokens, model: 'hunyuan'}
  }

  return {type: 'text', quantity: tokens, model: 'hunyuan'}
}

// ===== 阶段二：实际扣费（按 Hermes 回复确认的真实用量）=====
interface ProfileSnapshot {
  membership_level?: string
  ai_count?: number
  balance?: number
  video_seconds_used?: number
  graphic_count_used?: number
}

interface DeductResult {
  blocked: boolean
  reason?: string
  type: string
  quantity: number
  amountDeducted: number
  fromPlan: boolean
}

async function processDeduct(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  profile: ProfileSnapshot | null,
  usage: ActualUsage,
  replySnippet: string
): Promise<DeductResult> {
  const membershipLevel = profile?.membership_level || 'free'
  const quota = PLAN_QUOTAS[membershipLevel] || PLAN_QUOTAS['free']
  const currentBalance = Number(profile?.balance || 0)
  const videoUsed = Number(profile?.video_seconds_used || 0)
  const graphicUsed = Number(profile?.graphic_count_used || 0)

  // 文字对话：仅 free 用户计次
  if (usage.type === 'text') {
    if (membershipLevel === 'free') {
      await supabase.from('profiles')
        .update({ai_count: (profile?.ai_count || 0) + 1})
        .eq('id', userId)
    }
    await supabase.from('usage_records').insert({
      user_id: userId, type: 'text', model: usage.model,
      quantity: usage.quantity, unit: 'tokens',
      amount_deducted: 0, from_plan: true,
      balance_before: currentBalance, balance_after: currentBalance
    })
    return {blocked: false, type: 'text', quantity: usage.quantity, amountDeducted: 0, fromPlan: true}
  }

  // 视频扣费（按实际秒数，PRD 4.21：配额优先，超出才扣算力余额）
  if (usage.type === 'video') {
    const quotaRemaining = Math.max(0, quota.videoSeconds - videoUsed)

    // 【情况1】配额足够覆盖本次消耗 → 只扣配额，不动 balance
    if (quotaRemaining >= usage.quantity) {
      await supabase.from('profiles').update({
        video_seconds_used: videoUsed + usage.quantity
      }).eq('id', userId)
      await supabase.from('usage_records').insert({
        user_id: userId, type: 'video', model: usage.model,
        quantity: usage.quantity, unit: 'seconds',
        amount_deducted: 0, from_plan: true,
        balance_before: currentBalance, balance_after: currentBalance,
        raw_response: `[套餐配额] ${usage.quantity}秒 | ${replySnippet.slice(0, 400)}`
      })
      console.log(`[扣费] 用户${userId} 视频${usage.quantity}秒 套餐配额内 不扣余额（剩余配额${quotaRemaining}秒）`)
      return {blocked: false, type: 'video', quantity: usage.quantity, amountDeducted: 0, fromPlan: true}
    }

    // 【情况2】配额不足（部分或全部需算力）→ 超出部分按实际价格扣算力余额
    const paidSeconds = usage.quantity - quotaRemaining  // 需要从余额扣的秒数
    const cost = paidSeconds * PRICE_VIDEO_PER_SECOND

    if (currentBalance < cost) {
      // 竞态欠账：内容已生成但余额仍不足，写入欠账记录
      await supabase.from('usage_records').insert({
        user_id: userId, type: 'video', model: usage.model,
        quantity: usage.quantity, unit: 'seconds',
        amount_deducted: 0, from_plan: false,
        balance_before: currentBalance, balance_after: currentBalance,
        raw_response: `[竞态欠账] 配额剩${quotaRemaining}秒 需扣算力${paidSeconds}秒=¥${cost.toFixed(2)} 余¥${currentBalance.toFixed(2)} | ${replySnippet.slice(0, 280)}`
      })
      return {
        blocked: true,
        reason: `算力余额不足（套餐配额剩余${quotaRemaining}秒，本次超出${paidSeconds}秒需¥${cost.toFixed(2)}，余额¥${currentBalance.toFixed(2)}），请充值。`,
        type: 'video', quantity: usage.quantity, amountDeducted: 0, fromPlan: false
      }
    }

    // 正常扣费：先用尽配额，超出部分扣算力
    const newBalance = currentBalance - cost
    const profileUpdate: Record<string, unknown> = {video_seconds_used: videoUsed + usage.quantity}
    if (cost > 0) profileUpdate.balance = newBalance
    await supabase.from('profiles').update(profileUpdate).eq('id', userId)
    await supabase.from('usage_records').insert({
      user_id: userId, type: 'video', model: usage.model,
      quantity: usage.quantity, unit: 'seconds',
      amount_deducted: cost, from_plan: false,
      balance_before: currentBalance, balance_after: newBalance,
      raw_response: quotaRemaining > 0
        ? `[混合扣费] 配额${quotaRemaining}秒免费+超出${paidSeconds}秒×0.8=¥${cost.toFixed(2)} | ${replySnippet.slice(0, 380)}`
        : `[算力扣费] 配额已用尽，${paidSeconds}秒×0.8=¥${cost.toFixed(2)} | ${replySnippet.slice(0, 380)}`
    })
    console.log(`[扣费] 用户${userId} 视频${usage.quantity}秒 配额${quotaRemaining}秒免费+算力${paidSeconds}秒扣¥${cost.toFixed(2)} 余额${newBalance.toFixed(2)}`)
    return {blocked: false, type: 'video', quantity: usage.quantity, amountDeducted: cost, fromPlan: false}
  }

  // 图片扣费（按实际张数，PRD 4.21：配额优先，超出才扣算力余额）
  if (usage.type === 'image') {
    const quotaRemaining = Math.max(0, quota.graphicCount - graphicUsed)

    // 【情况1】配额足够覆盖本次消耗 → 只扣配额，不动 balance
    if (quotaRemaining >= usage.quantity) {
      await supabase.from('profiles').update({
        graphic_count_used: graphicUsed + usage.quantity
      }).eq('id', userId)
      await supabase.from('usage_records').insert({
        user_id: userId, type: 'image', model: usage.model,
        quantity: usage.quantity, unit: 'count',
        amount_deducted: 0, from_plan: true,
        balance_before: currentBalance, balance_after: currentBalance,
        raw_response: `[套餐配额] ${usage.quantity}张 | ${replySnippet.slice(0, 400)}`
      })
      console.log(`[扣费] 用户${userId} 图片${usage.quantity}张 套餐配额内 不扣余额（剩余配额${quotaRemaining}张）`)
      return {blocked: false, type: 'image', quantity: usage.quantity, amountDeducted: 0, fromPlan: true}
    }

    // 【情况2】配额不足（部分或全部需算力）→ 超出部分按实际价格扣算力余额
    const paidCount = usage.quantity - quotaRemaining  // 需要从余额扣的张数
    const cost = paidCount * PRICE_IMAGE_PER_COUNT

    if (currentBalance < cost) {
      // 竞态欠账：内容已生成但余额仍不足，写入欠账记录
      await supabase.from('usage_records').insert({
        user_id: userId, type: 'image', model: usage.model,
        quantity: usage.quantity, unit: 'count',
        amount_deducted: 0, from_plan: false,
        balance_before: currentBalance, balance_after: currentBalance,
        raw_response: `[竞态欠账] 配额剩${quotaRemaining}张 需扣算力${paidCount}张=¥${cost.toFixed(2)} 余¥${currentBalance.toFixed(2)} | ${replySnippet.slice(0, 280)}`
      })
      return {
        blocked: true,
        reason: `算力余额不足（套餐配额剩余${quotaRemaining}张，本次超出${paidCount}张需¥${cost.toFixed(2)}，余额¥${currentBalance.toFixed(2)}），请充值。`,
        type: 'image', quantity: usage.quantity, amountDeducted: 0, fromPlan: false
      }
    }

    // 正常扣费：先用尽配额，超出部分扣算力
    const newBalance = currentBalance - cost
    const profileUpdate: Record<string, unknown> = {graphic_count_used: graphicUsed + usage.quantity}
    if (cost > 0) profileUpdate.balance = newBalance
    await supabase.from('profiles').update(profileUpdate).eq('id', userId)
    await supabase.from('usage_records').insert({
      user_id: userId, type: 'image', model: usage.model,
      quantity: usage.quantity, unit: 'count',
      amount_deducted: cost, from_plan: false,
      balance_before: currentBalance, balance_after: newBalance,
      raw_response: quotaRemaining > 0
        ? `[混合扣费] 配额${quotaRemaining}张免费+超出${paidCount}张×0.06=¥${cost.toFixed(2)} | ${replySnippet.slice(0, 380)}`
        : `[算力扣费] 配额已用尽，${paidCount}张×0.06=¥${cost.toFixed(2)} | ${replySnippet.slice(0, 380)}`
    })
    console.log(`[扣费] 用户${userId} 图片${usage.quantity}张 配额${quotaRemaining}张免费+算力${paidCount}张扣¥${cost.toFixed(2)} 余额${newBalance.toFixed(2)}`)
    return {blocked: false, type: 'image', quantity: usage.quantity, amountDeducted: cost, fromPlan: false}
  }

  return {blocked: false, type: usage.type, quantity: 0, amountDeducted: 0, fromPlan: false}
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// ClawSolo 系统人格 - Luna AI 自媒体创作工站核心 Agent
const SYSTEM_PROMPT = `你是 ClawSolo，Luna AI 内容生成平台的核心智能创作助手，由 Hermes Agent（Luna 2.0）驱动。

你的专长：
- 自媒体内容创作：小红书笔记、抖音脚本、公众号文章、视频标题等
- 账号运营策略：粉丝增长方法、发布时间优化、爆款选题挖掘
- 数据分析解读：播放量、互动率、粉丝画像分析与建议
- AI工作流指导：帮助创作者高效使用 Luna AI 平台各项功能

回答风格：简洁专业、逻辑清晰、给出可直接执行的具体建议，避免空洞的套话。

【重要：生成结果上报约定】
每次成功完成视频或图片生成后，必须在回复的最末尾（正文之后）追加以下格式的标记，
不要在标记前后加任何解释文字，用户界面会自动隐藏该标记，不会展示给用户：

视频生成完成时追加：
<!--LUNA_META:{"type":"video","duration_seconds":<实际秒数>,"model":"<模型名称>"}-->

图片生成完成时追加：
<!--LUNA_META:{"type":"image","count":<实际张数>,"model":"<模型名称>"}-->

示例（生成了一段8秒视频，模型为seedance）：
视频已为您生成完毕，请查看上方链接。
<!--LUNA_META:{"type":"video","duration_seconds":8,"model":"seedance"}-->

示例（生成了2张图片，模型为seedream）：
图片已生成，共2张，请查看上方内容。
<!--LUNA_META:{"type":"image","count":2,"model":"seedream"}-->

若本次对话不涉及视频或图片生成，则不追加任何标记。`

// ===== 调用 Hermes Agent（OpenAI 兼容接口） =====
async function callHermes(
  messages: Array<{role: string; content: string}>,
  apiKey: string
): Promise<{fullContent: string; tokens: number}> {
  const hermesBaseUrl = Deno.env.get('HERMES_BASE_URL') || 'http://152.136.47.2:8642'

  const upstream = await fetch(
    `${hermesBaseUrl}/v1/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'hermes-agent',
        messages,
        stream: false,
        max_tokens: 512,
      }),
    }
  )

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '')
    throw new Error(`Hermes API 错误 ${upstream.status}: ${text}`)
  }

  const data = await upstream.json()
  const fullContent = data.choices?.[0]?.message?.content ?? ''
  const tokens = data.usage?.total_tokens ?? 0

  return {fullContent, tokens}
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: corsHeaders})
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 验证用户 JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return Response.json({error: '未登录'}, {status: 401, headers: corsHeaders})
    }
    const {data: {user}, error: authError} = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) {
      return Response.json({error: '认证失败'}, {status: 401, headers: corsHeaders})
    }

    const {message, history = []} = await req.json()
    if (!message?.trim()) {
      return Response.json({error: '消息不能为空'}, {status: 400, headers: corsHeaders})
    }

    // 拉取用户档案（配额/余额/等级）
    const {data: profile} = await supabase
      .from('profiles')
      .select('membership_level, ai_count, balance, video_seconds_used, graphic_count_used')
      .eq('id', user.id)
      .maybeSingle()

    // ════════════════════════════════════
    // 阶段一：意图识别 + 预检拦截
    // 在调用 Hermes 之前完成，不浪费计费额度
    // ════════════════════════════════════
    const intent = detectIntentFromMessage(message)
    const preflight = preflightCheck(intent, profile)
    if (preflight.blocked) {
      console.log(`[预检拦截] 用户${user.id} intent=${intent} reason=${preflight.reason}`)
      return Response.json(
        {error: preflight.reason, reply: preflight.reason},
        {status: 200, headers: corsHeaders}
      )
    }

    // ════════════════════════════════════
    // 调用 Hermes Agent
    // ════════════════════════════════════
    const hermesApiKey = Deno.env.get('HERMES_API_KEY') || ''

    const messages = [
      {role: 'system', content: SYSTEM_PROMPT},
      ...history
        .slice(-10)
        .map((h: {role: string; content: string}) => ({
          role: h.role === 'assistant' ? 'assistant' : 'user',
          content: h.content
        })),
      {role: 'user', content: message}
    ]

    let rawReply = ''
    let tokens = 0
    try {
      const result = await callHermes(messages, hermesApiKey)
      rawReply = result.fullContent || '抱歉，暂时无法回答，请稍后再试。'
      tokens = result.tokens
    } catch (hermesErr) {
      console.error('Hermes API 调用失败:', hermesErr)
      return Response.json(
        {error: 'Hermes API 调用失败', reply: '暂时无法连接 Hermes，请稍后再试。'},
        {status: 200, headers: corsHeaders}
      )
    }

    // 清洗 LUNA_META 标记，得到展示给用户的干净回复
    const {cleanReply: reply} = parseLunaMeta(rawReply)

    // ════════════════════════════════════
    // 阶段二：从回复中读实际用量 → 按实际扣费
    // ════════════════════════════════════
    const hermesData = {usage: {total_tokens: tokens}}
    const actualUsage = extractActualUsage(rawReply, hermesData, intent)
    const deductResult = await processDeduct(supabase, user.id, profile, actualUsage, rawReply)

    // 若扣费阶段发现余额/配额竞态不足（内容已生成，欠账记录已在 processDeduct 内写入）
    if (deductResult?.blocked) {
      console.warn(`[扣费竞态] 用户${user.id} 原因：${deductResult.reason}（内容已生成，欠账已记录）`)
      const warningNote = `\n\n提示：本次生成内容已完成，但扣费未成功（${deductResult.reason}）。请补足余额或套餐配额，否则后续请求将被拦截。`
      return Response.json({reply: reply + warningNote, tokens, model: 'hermes-agent', usage: deductResult}, {headers: corsHeaders})
    }

    return Response.json({reply, tokens, model: 'hermes-agent', usage: deductResult}, {headers: corsHeaders})

  } catch (err) {
    console.error('arkclaw_chat (hermes) error:', err)
    return Response.json(
      {error: String(err), reply: '服务异常，请稍后再试。'},
      {status: 200, headers: corsHeaders}
    )
  }
})

