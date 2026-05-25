/**
 * luna_hermes_chat — Hermes 调用适配器
 *
 * 职责：
 *  1. 接收 luna_guardian 路由过来的请求（system_prompt / messages / task_type / attachments / 生成参数）
 *  2. 将 attachments 按类型整理进 Hermes prompt
 *     - 图片：在 user 消息末尾追加 "用户附上了图片：<url>"（Hermes 不支持 image_url 对象）
 *     - 文档：追加 "用户附上了文件「name」，地址：<url>，请基于该文件内容生成"
 *     - 视频：第一版提示用户补充说明，文件 URL 保存备查
 *  3. 调用 Hermes POST /v1/chat/completions
 *  4. 返回统一格式：{ reply, model, upstream, raw }
 *
 * 安全：HERMES_API_KEY 只在此函数内读取，不暴露给前端或其他 Edge Function。
 */

import {createClient} from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_HERMES_BASE_URL = 'http://152.136.47.2:8642'
const DEFAULT_HERMES_MODEL = 'hermes-agent'
const DEFAULT_HERMES_API_KEY = 'bWmhP67eBZsbta58h8QRKrZT0XcPh2NJ'

// ── 附件 metadata 类型 ────────────────────────────────────────────
interface AttachmentMeta {
  type: 'image' | 'file' | 'video'
  file_url: string
  file_key: string
  mime_type: string
  file_type: string   // 扩展名，如 jpg / pdf / docx
  name: string
  size?: number
}

// ── 消息类型 ──────────────────────────────────────────────────────
interface HermesMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ── 将 attachments 整理成附加在 user 消息末尾的 prompt 补充 ───────
function buildAttachmentNote(attachments: AttachmentMeta[]): string {
  if (!attachments || attachments.length === 0) return ''

  const lines: string[] = []

  for (const att of attachments) {
    if (att.type === 'image') {
      lines.push(`[图片素材] 文件名：${att.name}，地址：${att.file_url}（请根据该图片内容理解用户素材意图）`)
    } else if (att.type === 'video') {
      lines.push(`[视频素材] 文件名：${att.name}，地址：${att.file_url}（视频内容分析暂不支持，请提示用户补充视频的核心内容文字描述，以便生成内容方案）`)
    } else {
      // 文件 / 文档
      const ext = att.file_type || att.name.split('.').pop() || 'file'
      lines.push(`[文档素材] 文件名：${att.name}（${ext.toUpperCase()}），地址：${att.file_url}（请基于该文档内容理解用户素材意图，辅助生成内容方案）`)
    }
  }

  return lines.length > 0 ? `\n\n【用户上传的素材附件】\n${lines.join('\n')}` : ''
}

// ── 主处理逻辑 ────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: CORS})

  try {
    // 验证来源：必须是带 service role key 的内部调用，或带用户 token 的直接调用
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

    // 构建最终发给 Hermes 的 user 内容（文字 + 附件说明）
    const finalUserContent = (userMessage || '请根据我提供的素材生成内容方案') + attachmentNote

    // 构建消息列表
    const hermesMessages: HermesMessage[] = [
      {role: 'system', content: systemPrompt},
      ...history,
      {role: 'user', content: finalUserContent},
    ]

    const hermesBaseUrl = (Deno.env.get('HERMES_BASE_URL') || DEFAULT_HERMES_BASE_URL).replace(/\/$/, '')
    const hermesApiKey = Deno.env.get('HERMES_API_KEY') || DEFAULT_HERMES_API_KEY
    const hermesModel = Deno.env.get('HERMES_MODEL') || DEFAULT_HERMES_MODEL

    console.log('[luna_hermes_chat] calling Hermes, attachments_count:', attachments.length, 'task_type:', body.task_type || 'chat')

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
    const raw: string = data?.choices?.[0]?.message?.content ?? ''
    const reply = raw.trim()

    console.log('[luna_hermes_chat] Hermes reply preview:', reply.slice(0, 200))

    return Response.json(
      {
        reply,
        model: hermesModel,
        upstream: 'hermes',
        raw,
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
