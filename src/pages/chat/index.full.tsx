// @title 工作台
import {useState, useCallback, useMemo, useRef} from 'react'
import Taro, {useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {Image, ScrollView} from '@tarojs/components'
import {callCloudFunction} from '@/client/cloudbase'
import {STORAGE_KEY_REDIRECT_PATH, withRouteGuard} from '@/components/RouteGuard'
import {LunaAvatar} from '@/components/LunaAvatar'
import {useAuth} from '@/contexts/AuthContext'
import {selectMediaFiles, selectMessageFile, getMimeType} from '@/utils/upload'
import type {MiniProgramFileInput} from '@/utils/upload'
import {uploadToCos} from '@/utils/cos'
import {getMiniWindowHeight} from '@/utils/system'

async function callLunaGuardian(
  body: Record<string, unknown>,
): Promise<{data: Record<string, unknown> | null; error: string | null}> {
  try {
    const data = await callCloudFunction<Record<string, unknown>>('lunaGuardian', body)
    return {data, error: null}
  } catch (e) {
    return {data: null, error: String(e)}
  }
}

// ── 消息类型定义 ───────────────────────────────────────────────────
type TaskType =
  | 'normal_chat' | 'creative_chat' | 'material_package' | 'direction_package'
  | 'copy_rewrite' | 'video_script' | 'advice_only' | 'need_more_info' | 'blocked_collection'

interface TaskCard {
  platform: string[]
  goal: string
  source: string
  output: string
  taskType: TaskType
  rawBody: Record<string, unknown>
}

interface ResultCard {
  materialId: string
  title: string
  platforms: string[]
  summary: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  image_url?: string | null
  taskCard?: TaskCard | null
  resultCard?: ResultCard | null
  /** 上传预览气泡：true 表示待发送，仅在消息流中占位展示 */
  isPending?: boolean
  /** 文件附件名称（文件类型时显示） */
  attachName?: string
  created_at: string
}

// ── 附件 metadata（上传成功后存储，发送时携带给后端，不传 wxfile://）
interface AttachmentMeta {
  type: 'image' | 'file' | 'video'
  file_url: string      // Supabase Storage public URL
  file_key: string      // Storage path（用于管理）
  mime_type: string
  file_type: string     // 文件扩展名
  name: string
  size?: number
  /** 仅用于本地预览，不发送给后端 */
  tempPath?: string
}
// ── 快捷入口提示 ───────────────────────────────────────────────────
const QUICK_PROMPTS = [
  '帮我做一个小红书种草文案',
  '帮我把产品包装成抖音脚本',
  '本地探店内容，帮我想方向',
  '帮我改写这段文案，更像小红书',
]

// ── 欢迎消息 ───────────────────────────────────────────────────────
const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '你好！我是 Luna，你的多平台内容创作助手。\n\n可以直接告诉我你想做什么，比如：\n• 帮我做一个小红书种草内容\n• 把这个产品包装成抖音脚本\n• 帮我分析母婴行业的内容方向\n• 把这段文案改得更口语化\n\n也可以上传图片或素材，我来帮你生成多平台内容包。',
  created_at: new Date().toISOString(),
}

// ── 任务卡片组件 ───────────────────────────────────────────────────
function TaskCardView({card, onGenerate, onEdit, onAskMore}: {
  card: TaskCard
  onGenerate: () => void
  onEdit: () => void
  onAskMore: () => void
}) {
  return (
    <div className="rounded-2xl overflow-hidden border" style={{background: 'white', borderColor: 'hsl(243 67% 57% / 0.2)', boxShadow: '0 4px 16px hsl(243 67% 57% / 0.12)'}}>
      {/* 卡片头部 */}
      <div className="px-4 py-3 flex items-center gap-2" style={{background: 'linear-gradient(135deg, hsl(243 67% 57%) 0%, hsl(263 60% 64%) 100%)'}}>
        <div className="i-mdi-lightning-bolt text-white" style={{fontSize: '18px'}} />
        <span className="text-xl font-bold text-white">Luna 已理解你的任务</span>
      </div>
      {/* 任务详情 */}
      <div className="px-4 py-3 flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <span className="text-xl font-medium flex-shrink-0" style={{color: 'hsl(252 20% 55%)', minWidth: '64px'}}>目标平台</span>
          <div className="flex flex-wrap gap-1">
            {card.platform.map((p) => (
              <span key={p} className="px-2 py-0.5 rounded-full text-xl font-medium" style={{background: 'hsl(243 67% 57% / 0.1)', color: 'hsl(243 67% 57%)'}}>{p}</span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-medium flex-shrink-0" style={{color: 'hsl(252 20% 55%)', minWidth: '64px'}}>目标</span>
          <span className="text-xl text-foreground">{card.goal}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-medium flex-shrink-0" style={{color: 'hsl(252 20% 55%)', minWidth: '64px'}}>素材来源</span>
          <span className="text-xl text-foreground">{card.source}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xl font-medium flex-shrink-0" style={{color: 'hsl(252 20% 55%)', minWidth: '64px'}}>输出内容</span>
          <span className="text-xl text-foreground">{card.output}</span>
        </div>
      </div>
      {/* 操作按钮 */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          type="button"
          onClick={onGenerate}
          className="flex-1 flex items-center justify-center leading-none rounded-xl"
          style={{background: 'linear-gradient(135deg, hsl(243 67% 57%), hsl(263 60% 64%))', boxShadow: '0 4px 12px hsl(243 67% 57% / 0.3)'}}
        >
          <div style={{padding: '10px 0'}}>
            <span className="text-xl font-bold text-white">直接生成</span>
          </div>
        </button>
        <button
          type="button"
          onClick={onAskMore}
          className="flex items-center justify-center leading-none rounded-xl border"
          style={{padding: '10px 14px', background: 'white', borderColor: 'hsl(243 67% 57% / 0.3)', color: 'hsl(243 67% 57%)'}}
        >
          <span className="text-xl font-medium">补充信息</span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center justify-center leading-none rounded-xl border"
          style={{padding: '10px 14px', background: 'white', borderColor: 'hsl(252 20% 80%)', color: 'hsl(252 30% 40%)'}}
        >
          <span className="text-xl font-medium">编辑任务</span>
        </button>
      </div>
    </div>
  )
}

// ── 结果摘要卡片组件 ──────────────────────────────────────────────
function ResultCardView({card}: {card: ResultCard}) {
  const handleView = () => {
    Taro.navigateTo({url: `/pages/package-result/index?id=${encodeURIComponent(card.materialId)}`})
  }
  return (
    <div className="rounded-2xl overflow-hidden border" style={{background: 'white', borderColor: 'hsl(141 60% 45% / 0.25)', boxShadow: '0 4px 16px hsl(141 60% 45% / 0.1)'}}>
      <div className="px-4 py-3 flex items-center gap-2" style={{background: 'linear-gradient(135deg, hsl(141 60% 40%), hsl(160 55% 48%))'}}>
        <div className="i-mdi-check-circle text-white" style={{fontSize: '18px'}} />
        <span className="text-xl font-bold text-white">内容包已生成完成</span>
      </div>
      <div className="px-4 py-3 flex flex-col gap-2">
        <span className="text-xl font-bold text-foreground">{card.title}</span>
        <div className="flex flex-wrap gap-1">
          {card.platforms.map((p) => (
            <span key={p} className="px-2 py-0.5 rounded-full text-xl" style={{background: 'hsl(141 60% 45% / 0.1)', color: 'hsl(141 60% 32%)'}}>{p}</span>
          ))}
        </div>
        <p className="text-xl leading-relaxed" style={{color: 'hsl(252 20% 50%)'}}>{card.summary}</p>
      </div>
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={handleView}
          className="w-full flex items-center justify-center leading-none rounded-xl"
          style={{background: 'linear-gradient(135deg, hsl(141 60% 40%), hsl(160 55% 48%))', boxShadow: '0 4px 12px hsl(141 60% 40% / 0.25)'}}
        >
          <div className="flex items-center gap-2" style={{padding: '10px 0'}}>
            <div className="i-mdi-eye-outline text-white" style={{fontSize: '18px'}} />
            <span className="text-xl font-bold text-white">查看完整结果</span>
          </div>
        </button>
      </div>
    </div>
  )
}

// ── 主页面 ────────────────────────────────────────────────────────
function WorkbenchPage() {
  const {user, profile} = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
  const [inputText, setInputText] = useState('')
  // pendingAttachment: 上传完成的附件 metadata，发送时携带给后端
  const [pendingAttachment, setPendingAttachment] = useState<AttachmentMeta | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const lastTapAt = useRef(0)

  useShareAppMessage(() => ({title: 'Luna AI — 内容创作工作台'}))
  useShareTimeline(() => ({title: 'Luna AI — 内容创作工作台'}))

  const lastMsgId = useMemo(() => {
    const last = messages[messages.length - 1]
    return last ? `msg_${last.id.replace(/[^a-zA-Z0-9]/g, '_')}` : ''
  }, [messages])

  const runTap = useCallback((action: () => void) => {
    const now = Date.now()
    if (now - lastTapAt.current < 250) return
    lastTapAt.current = now
    action()
  }, [])

  const requireLogin = useCallback(() => {
    if (user) return true
    Taro.showModal({
      title: '需要登录',
      content: '登录后可以生成内容、上传文件，并保存到你的素材库。',
      confirmText: '去登录',
      cancelText: '先看看',
      success: ({confirm}) => {
        if (confirm) {
          Taro.setStorageSync(STORAGE_KEY_REDIRECT_PATH, '/pages/chat/index')
          Taro.navigateTo({url: '/pages/login/index'})
        }
      },
    })
    return false
  }, [user])

  // ── 发送消息 ────────────────────────────────────────────────────
  const handleSend = useCallback(async (quickText?: string) => {
    if (!requireLogin()) return
    const text = (quickText ?? inputText).trim()
    const attachment = pendingAttachment
    const isImageAttach = attachment?.type === 'image'
    if (!text && !attachment) return
    if (sending) return

    // 只有附件没有文字时，自动补充描述让 Luna 知道有素材要处理
    const effectiveText = text || (isImageAttach
      ? `请根据这张图片帮我生成多平台内容`
      : `请根据上传的文件「${attachment?.name ?? '文件资产'}」帮我生成多平台内容`)

    setInputText('')
    setPendingAttachment(null)
    setSending(true)

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: text || (isImageAttach ? '[图片]' : `[文件] ${attachment?.name ?? ''}`),
      image_url: isImageAttach ? (attachment?.file_url ?? null) : null,
      attachName: !isImageAttach && attachment ? (attachment.name ?? undefined) : undefined,
      created_at: new Date().toISOString(),
    }
    // 用正式消息替换上传预览气泡
    setMessages((prev) => [...prev.filter((m) => m.id !== 'upload_preview'), userMsg])

    try {
      const history = messages
        .filter((m) => !m.isPending && (m.role === 'user' || (m.role === 'assistant' && !m.taskCard && !m.resultCard)))
        .filter((m) => m.content && m.content.trim())
        .slice(-10)
        .map((m) => ({role: m.role, content: m.content}))

      // 构建 attachments metadata（不传 wxfile:// 或本地临时路径）
      const attachments = attachment ? [{
        type: attachment.type,
        file_url: attachment.file_url,
        file_key: attachment.file_key,
        mime_type: attachment.mime_type,
        file_type: attachment.file_type,
        name: attachment.name,
        ...(attachment.size !== undefined ? {size: attachment.size} : {}),
      }] : []

      const body: Record<string, unknown> = {
        user_id: user?.id || 'wechat_session',
        user_message: effectiveText,
        attachments,
        history,
        platforms: ['小红书', '抖音', '视频号', '公众号'],
      }

      const {data, error} = await callLunaGuardian(body)

      if (error) throw new Error(error)

      const taskType: TaskType = (data?.task_type as TaskType) || 'normal_chat'
      const reply: string = (data?.reply as string) || ''
      const result = (data?.result as Record<string, unknown>) || null
      const materialId: string | null = (data?.material_id as string) || null

      if ((taskType === 'material_package' || taskType === 'direction_package'
        || taskType === 'copy_rewrite' || taskType === 'video_script' || taskType === 'advice_only')
        && !result) {
        const platforms = ['小红书', '抖音', '视频号', '公众号']
        const taskCard: TaskCard = {
          platform: platforms,
          goal: '品牌曝光与内容传播',
          source: attachment
            ? (isImageAttach ? '用户上传图片 + 文字描述' : `上传文件「${attachment.name}」`)
            : (text ? `"${text.slice(0, 30)}"` : '用户描述'),
          output: taskType === 'video_script' ? '短视频脚本' : taskType === 'copy_rewrite' ? '多平台改写文案' : '多平台素材包（标题 / 正文 / 话题标签 / 投放建议）',
          taskType,
          rawBody: body,
        }
        setMessages((prev) => [...prev, {
          id: `t_${Date.now()}`,
          role: 'assistant',
          content: reply || '我已理解你的任务，请确认以下方案后开始生成：',
          taskCard,
          created_at: new Date().toISOString(),
        }])
      } else if (result && materialId) {
        const platforms = Object.keys(result)
        const firstPlatform = platforms[0] || '小红书'
        const firstResult = (result[firstPlatform] || {}) as Record<string, unknown>
        const summaryTitle = Array.isArray(firstResult.titles) ? (firstResult.titles as string[])[0] : '素材包已生成'
        setMessages((prev) => [...prev, {
          id: `r_${Date.now()}`,
          role: 'assistant' as const,
          content: reply,
          resultCard: {materialId, title: summaryTitle, platforms, summary: reply},
          created_at: new Date().toISOString(),
        }])
      } else {
        setMessages((prev) => [...prev, {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: reply || '抱歉，暂时无法回复，请稍后再试。',
          created_at: new Date().toISOString(),
        }])
      }
    } catch (error) {
      console.error('Luna send failed:', error)
      Taro.showToast({title: '发送失败，请重试', icon: 'none'})
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id))
    } finally {
      setSending(false)
    }
  }, [inputText, pendingAttachment, requireLogin, sending, user, messages])

  // ── 任务卡：直接生成 ────────────────────────────────────────────
  const handleDirectGenerate = useCallback(async (taskCard: TaskCard) => {
    if (sending) return
    if (!requireLogin()) return
    setSending(true)
    Taro.showToast({title: '生成中，请稍候…', icon: 'none', duration: 3000})
    try {
      const body: Record<string, unknown> = {
        ...taskCard.rawBody,
        user_id: user?.id || 'wechat_session',
        mode: taskCard.taskType === 'direction_package' ? 'direction' : 'material',
        platforms: taskCard.platform,
      }
      const {data, error} = await callLunaGuardian(body)
      if (error) throw new Error(error)
      const result = (data?.result as Record<string, unknown>) || null
      const materialId: string | null = (data?.material_id as string) || null
      const reply: string = (data?.reply as string) || '已生成完成'
      if (result && materialId) {
        const platforms = Object.keys(result)
        const firstPlatform = platforms[0] || '小红书'
        const firstResult = (result[firstPlatform] || {}) as Record<string, unknown>
        const summaryTitle = Array.isArray(firstResult.titles) ? (firstResult.titles as string[])[0] : '素材包已生成'
        setMessages((prev) => [...prev, {
          id: `r_${Date.now()}`,
          role: 'assistant' as const,
          content: reply,
          resultCard: {materialId, title: summaryTitle, platforms, summary: reply},
          created_at: new Date().toISOString(),
        }])
      } else {
        setMessages((prev) => [...prev, {
          id: `a_${Date.now()}`,
          role: 'assistant' as const,
          content: (data?.reply as string) || '生成完成，但未能获取结果，请重试。',
          created_at: new Date().toISOString(),
        }])
      }
    } catch (error) {
      console.error('Luna direct generate failed:', error)
      Taro.showToast({title: '生成失败，请重试', icon: 'none'})
    } finally {
      setSending(false)
    }
  }, [requireLogin, sending, user])

  // ── 任务卡：编辑任务（跳转高级编辑）───────────────────────────
  const handleEditTask = (taskCard: TaskCard) => {
    const mode = taskCard.taskType === 'direction_package' ? 'direction' : 'material'
    Taro.navigateTo({url: `/pages/package-create/index?mode=${mode}`})
  }

  // ── 任务卡：补充信息 ────────────────────────────────────────────
  const handleAskMore = useCallback(() => {
    setMessages((prev) => [...prev, {
      id: `a_${Date.now()}`,
      role: 'assistant',
      content: '好的，请告诉我更多信息：\n• 目标平台（小红书/抖音/公众号…）\n• 投放目标（涨粉/促销/品牌曝光…）\n• 产品/服务的核心亮点或活动信息\n\n你也可以直接上传图片、文档或视频截图作为素材。',
      created_at: new Date().toISOString(),
    }])
  }, [])

  // ── 素材附件上传（任意格式）────────────────────────────────────
  const handlePickAttachment = async () => {
    if (uploading || sending) return
    if (!requireLogin()) return
    try {
      const idx = await new Promise<number>((resolve) => {
        Taro.showActionSheet({
          itemList: ['图片 / 视频', '文档 / 文件'],
          success: (res) => resolve(res.tapIndex),
          fail: () => resolve(-1),
        })
      })
      if (idx === -1) return

      setUploading(true)
      if (idx === 0) {
        // 图片 / 视频
        const files = await selectMediaFiles({count: 1, mediaType: ['image', 'video']})
        if (!files || files.length === 0) {
          setUploading(false)
          return
        }
        Taro.showToast({title: '上传中…', icon: 'none'})
        const file = files[0]
        const result = await uploadToCos(file)
        if (!result.success || !result.data) {
          Taro.showToast({title: '上传失败，请重试', icon: 'none'})
          setUploading(false)
          return
        }
        const fileKey = result.data.key
        const publicUrl = result.data.url
        const tempPath = (file as MiniProgramFileInput).tempFilePath || ''
        const fileName = (file as MiniProgramFileInput).name || '图片'
        const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg'
        const isVideo = ['mp4', 'mov', 'avi', 'webm'].includes(ext)
        const meta: AttachmentMeta = {
          type: isVideo ? 'video' : 'image',
          file_url: publicUrl,
          file_key: fileKey,
          mime_type: getMimeType(ext),
          file_type: ext,
          name: fileName,
          size: (file as MiniProgramFileInput).size,
          tempPath,
        }
        setPendingAttachment(meta)
        // 在消息流中插入待发送预览气泡
        const previewMsg: ChatMessage = {
          id: 'upload_preview',
          role: 'user',
          isPending: true,
          content: '',
          image_url: tempPath || publicUrl,
          attachName: fileName,
          created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev.filter((m) => m.id !== 'upload_preview'), previewMsg])
        Taro.showToast({title: isVideo ? '视频已上传' : '图片已上传', icon: 'none'})
      } else {
        // 文档 / 文件
        const file = await selectMessageFile({
          count: 1,
          type: 'file',
          extension: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'zip', 'rar'],
        })
        if (!file) {
          setUploading(false)
          return
        }
        Taro.showToast({title: '上传中…', icon: 'none'})
        const result = await uploadToCos(file)
        if (!result.success || !result.data) {
          Taro.showToast({title: '上传失败，请重试', icon: 'none'})
          setUploading(false)
          return
        }
        const fileKey = result.data.key
        const publicUrl = result.data.url
        const fileName = (file as MiniProgramFileInput).name || '文件资产'
        const ext = fileName.split('.').pop()?.toLowerCase() || 'file'
        const meta: AttachmentMeta = {
          type: 'file',
          file_url: publicUrl,
          file_key: fileKey,
          mime_type: getMimeType(ext),
          file_type: ext,
          name: fileName,
          size: (file as MiniProgramFileInput).size,
        }
        setPendingAttachment(meta)
        // 在消息流中插入待发送预览气泡
        const previewMsg: ChatMessage = {
          id: 'upload_preview',
          role: 'user',
          isPending: true,
          content: '',
          image_url: null,
          attachName: fileName,
          created_at: new Date().toISOString(),
        }
        setMessages((prev) => [...prev.filter((m) => m.id !== 'upload_preview'), previewMsg])
        Taro.showToast({title: '文件已上传', icon: 'none'})
      }
    } catch {
      Taro.showToast({title: '选择素材失败', icon: 'none'})
    } finally {
      setUploading(false)
    }
  }

  const canSend = (inputText.trim() || !!pendingAttachment) && !sending && !uploading
  const planLabel = profile?.membership_level === 'free' ? '免费版' : (profile?.membership_level || '免费版')

  const isWeb = Taro.getEnv() === Taro.ENV_TYPE.WEB
  const windowHeight = isWeb ? 812 : getMiniWindowHeight()
  const tabBarReserve = isWeb ? 0 : 6
  const usableHeight = Math.max(360, windowHeight - tabBarReserve)
  const containerHeight = isWeb ? 'calc(100vh - 50px)' : `${usableHeight}px`
  // WeChat scroll-view does not always resolve height: 100% inside flex children.
  const messageListHeight = isWeb
    ? 'calc(100vh - 50px - 58px - 45px - 66px)'
    : `${Math.max(180, usableHeight - 58 - 45 - 66)}px`

  return (
    <div style={{height: containerHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'hsl(252 30% 97%)'}}>
      {/* ── 顶部 Hero 条 ── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3" style={{background: 'linear-gradient(135deg, hsl(243 67% 57%) 0%, hsl(263 60% 64%) 100%)'}}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-full overflow-hidden border-2 border-white/40" style={{width: '36px', height: '36px', background: 'hsl(252 60% 80%)'}}>
              <LunaAvatar size={36} />
            </div>
            <div>
              <span className="text-xl font-bold text-white">Luna AI 工作台</span>
              <p className="text-xl" style={{color: 'rgba(255,255,255,0.7)'}}>自由对话 · 多平台内容生成</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-full"
              style={{background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)'}}
              onClick={() => runTap(() => Taro.switchTab({url: '/pages/profile/index'}))}
              onTouchEnd={() => runTap(() => Taro.switchTab({url: '/pages/profile/index'}))}
            >
              <div className="i-mdi-crown-outline text-white" style={{fontSize: '14px'}} />
              <span className="text-xl text-white">{planLabel}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 快捷提示词（横向滚动）── */}
      <ScrollView scrollX className="flex-shrink-0" style={{whiteSpace: 'nowrap', background: 'white', borderBottom: '1px solid hsl(252 20% 92%)'}}>
        <div style={{display: 'inline-flex', gap: '8px', padding: '8px 16px'}}>
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              onClick={() => runTap(() => handleSend(q))}
              onTouchEnd={() => runTap(() => handleSend(q))}
              className="flex-shrink-0 flex items-center justify-center leading-none rounded-full"
              style={{padding: '5px 12px', background: 'hsl(243 67% 57% / 0.08)', border: '1.5px solid hsl(243 67% 57% / 0.25)', color: 'hsl(243 67% 57%)', whiteSpace: 'nowrap'}}
            >
              <span className="text-xl font-medium">{q}</span>
            </button>
          ))}
        </div>
      </ScrollView>

      {/* ── 消息列表（微信小程序必须给 scroll-view 明确高度）── */}
      <ScrollView
        scrollY
        scrollIntoView={lastMsgId}
        scrollWithAnimation
        style={{height: messageListHeight, background: 'hsl(252 30% 97%)'}}
      >
          <div className="px-4 py-3 flex flex-col gap-4">
          {messages.map((msg) => {
            const isUser = msg.role === 'user'
            const anchorId = `msg_${msg.id.replace(/[^a-zA-Z0-9]/g, '_')}`
            return (
              <div key={msg.id} id={anchorId}>
                {isUser ? (
                  /* 用户消息（含待发送预览气泡） */
                  <div className="flex items-end gap-2 flex-row-reverse">
                    <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{width: '36px', height: '36px', background: 'hsl(252 40% 88%)'}}>
                      <div className="i-mdi-account text-primary" style={{fontSize: '20px'}} />
                    </div>
                    <div className="flex flex-col gap-1 items-end" style={{maxWidth: '68%'}}>
                      {/* 待发送预览气泡（isPending） */}
                      {msg.isPending && (
                        <div className="rounded-2xl overflow-hidden" style={{borderRadius: '16px 4px 16px 16px', background: 'hsl(252 30% 97%)', border: '2px dashed hsl(243 67% 57% / 0.4)', padding: '10px 14px', minWidth: '100px'}}>
                          {msg.image_url ? (
                            <div className="flex flex-col gap-2 items-end">
                              <div className="rounded-xl overflow-hidden" style={{width: '120px', height: '120px', opacity: 0.85}}>
                                <Image src={msg.image_url} mode="aspectFill" style={{width: '120px', height: '120px'}} />
                              </div>
                              <div className="flex items-center gap-1">
                                <div className="i-mdi-clock-outline" style={{fontSize: '14px', color: 'hsl(243 67% 57%)'}} />
                                <span className="text-xl" style={{color: 'hsl(243 67% 57%)'}}>已上传，输入描述后发送</span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2 items-end">
                              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{background: 'hsl(243 67% 57% / 0.08)', border: '1.5px solid hsl(243 67% 57% / 0.2)'}}>
                                <div className="i-mdi-file-document-outline text-primary" style={{fontSize: '20px'}} />
                                <span className="text-xl font-medium" style={{color: 'hsl(243 67% 57%)', maxWidth: '140px'}}>{msg.attachName || '文件'}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <div className="i-mdi-clock-outline" style={{fontSize: '14px', color: 'hsl(243 67% 57%)'}} />
                                <span className="text-xl" style={{color: 'hsl(243 67% 57%)'}}>已上传，输入描述后发送</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {/* 正式消息内容 */}
                      {!msg.isPending && msg.image_url && (
                        <div className="rounded-2xl overflow-hidden" style={{borderRadius: '16px 4px 16px 16px', boxShadow: '0 4px 16px hsl(243 67% 57% / 0.25)'}}>
                          <Image src={msg.image_url} mode="widthFix" style={{width: '100%', display: 'block'}} />
                        </div>
                      )}
                      {!msg.isPending && msg.content && msg.content !== '[图片]' && (
                        <div className="px-4 py-3" style={{background: 'linear-gradient(135deg, hsl(243 67% 57%), hsl(263 60% 62%))', borderRadius: '16px 4px 16px 16px', boxShadow: '0 4px 16px hsl(243 67% 57% / 0.25)'}}>
                          <p className="text-xl leading-relaxed" style={{color: 'white'}}>{msg.content}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Luna 消息 */
                  <div className="flex items-end gap-2">
                    <div className="rounded-full overflow-hidden flex-shrink-0 border-2 border-white" style={{width: '36px', height: '36px', background: 'linear-gradient(135deg, hsl(243 67% 57%), hsl(263 60% 64%))', boxShadow: '0 2px 8px hsl(243 67% 57% / 0.3)', flexShrink: 0}}>
                       <LunaAvatar size={36} />
                    </div>
                    <div className="flex flex-col gap-2" style={{maxWidth: '82%'}}>
                      {/* 文字内容 */}
                      {msg.content && (
                        <div className="px-4 py-3" style={{background: 'white', borderRadius: '4px 16px 16px 16px', boxShadow: '0 2px 8px hsl(252 20% 80% / 0.25)', border: '1px solid hsl(252 20% 91%)'}}>
                          <p className="text-xl leading-relaxed whitespace-pre-wrap" style={{color: 'hsl(252 30% 20%)'}}>{msg.content}</p>
                        </div>
                      )}
                      {/* 任务卡片 */}
                      {msg.taskCard && (
                        <TaskCardView
                          card={msg.taskCard}
                          onGenerate={() => handleDirectGenerate(msg.taskCard!)}
                          onEdit={() => handleEditTask(msg.taskCard!)}
                          onAskMore={handleAskMore}
                        />
                      )}
                      {/* 结果摘要卡片 */}
                      {msg.resultCard && (
                        <ResultCardView card={msg.resultCard} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* 发送中动画 */}
          {sending && (
            <div className="flex items-end gap-2">
              <div className="rounded-full overflow-hidden flex-shrink-0 border-2 border-white" style={{width: '36px', height: '36px', background: 'linear-gradient(135deg, hsl(243 67% 57%), hsl(263 60% 64%))', boxShadow: '0 2px 8px hsl(243 67% 57% / 0.3)'}}>
                 <LunaAvatar size={36} />
              </div>
              <div className="px-4 py-4" style={{background: 'white', borderRadius: '4px 16px 16px 16px', boxShadow: '0 2px 8px hsl(252 20% 80% / 0.25)', border: '1px solid hsl(252 20% 91%)'}}>
                <div className="flex items-center gap-1.5">
                  {[0, 0.15, 0.3].map((delay, i) => (
                    <div key={i} className="rounded-full animate-bounce" style={{width: '8px', height: '8px', background: 'hsl(243 67% 57%)', animationDelay: `${delay}s`}} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div id="anchor_bottom" style={{height: '8px'}} />
        </div>
      </ScrollView>

      {/* ── 输入区（flex-shrink-0，贴在 ScrollView 下方）── */}
      <div
        className="flex-shrink-0"
        style={{
          background: 'white',
          borderTop: '1px solid hsl(252 20% 91%)',
        }}
      >
        {/* 附件预览行 */}
        {(pendingAttachment || uploading) && (
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            {uploading ? (
              <>
                <div className="rounded-xl flex items-center justify-center" style={{width: '52px', height: '52px', background: 'hsl(252 30% 94%)'}}>
                  <div className="i-mdi-loading text-primary animate-spin" style={{fontSize: '22px'}} />
                </div>
                <span className="text-xl" style={{color: 'hsl(252 20% 55%)'}}>上传中...</span>
              </>
            ) : (pendingAttachment?.type === 'image' || pendingAttachment?.type === 'video') ? (
              <>
                <span className="text-xl font-medium flex-shrink-0" style={{color: 'hsl(243 67% 57%)'}}>
                  {pendingAttachment.type === 'video' ? '已选视频' : '已选图片'}
                </span>
                <div className="relative flex-shrink-0">
                  <div className="rounded-xl overflow-hidden border-2" style={{width: '64px', height: '64px', borderColor: 'hsl(243 67% 57% / 0.3)'}}>
                    <Image src={pendingAttachment.tempPath || pendingAttachment.file_url} mode="aspectFill" style={{width: '64px', height: '64px'}} />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingAttachment(null)
                      setMessages((prev) => prev.filter((m) => m.id !== 'upload_preview'))
                    }}
                    className="absolute flex items-center justify-center rounded-full"
                    style={{top: '-6px', right: '-6px', width: '20px', height: '20px', background: 'hsl(243 67% 57%)', border: '2px solid white'}}
                  >
                    <div className="i-mdi-close text-white" style={{fontSize: '12px'}} />
                  </button>
                </div>
                <span className="text-xl" style={{color: 'hsl(252 20% 55%)'}}>{pendingAttachment.name}</span>
              </>
            ) : pendingAttachment?.type === 'file' ? (
              <>
                <span className="text-xl font-medium flex-shrink-0" style={{color: 'hsl(243 67% 57%)'}}>已选文件</span>
                <div className="relative flex-shrink-0 flex items-center gap-2 rounded-xl px-3" style={{height: '44px', background: 'hsl(243 67% 57% / 0.08)', border: '1.5px solid hsl(243 67% 57% / 0.25)'}}>
                  <div className="i-mdi-file-document-outline text-primary" style={{fontSize: '20px'}} />
                  <span className="text-xl font-medium" style={{color: 'hsl(243 67% 57%)', maxWidth: '160px'}}>{pendingAttachment.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingAttachment(null)
                      setMessages((prev) => prev.filter((m) => m.id !== 'upload_preview'))
                    }}
                    className="flex items-center justify-center rounded-full ml-1"
                    style={{width: '18px', height: '18px', background: 'hsl(243 67% 57%)', border: '1.5px solid white', flexShrink: 0}}
                  >
                    <div className="i-mdi-close text-white" style={{fontSize: '11px'}} />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
        {/* 输入行 */}
        <div className="flex items-center gap-2 px-4" style={{paddingTop: '10px', paddingBottom: '4px'}}>
          <button
            onClick={() => runTap(handlePickAttachment)}
            onTouchEnd={() => runTap(handlePickAttachment)}
            className="flex items-center justify-center leading-none rounded-xl flex-shrink-0"
            style={{width: '44px', height: '44px', background: uploading ? 'hsl(252 20% 94%)' : 'hsl(243 67% 57% / 0.1)', border: '1.5px solid hsl(243 67% 57% / 0.3)', flexShrink: 0}}
          >
            <div className={`${uploading ? 'i-mdi-loading animate-spin' : 'i-mdi-plus-circle-outline'} text-primary`} style={{fontSize: '22px'}} />
          </button>
          <div className="flex-1" style={{background: 'hsl(252 20% 97%)', border: '1.5px solid hsl(243 67% 57% / 0.2)', borderRadius: '22px', padding: '10px 16px', minHeight: '44px'}}>
            <input
              className="w-full text-xl bg-transparent outline-none"
              style={{color: 'hsl(252 30% 20%)', display: 'block', lineHeight: '1.4'}}
              placeholder="告诉 Luna 你想创作什么内容…"
              value={inputText}
              onInput={(e) => { const ev = e as any; setInputText(ev.detail?.value ?? ev.target?.value ?? '') }}
            />
          </div>
          <button
            onClick={() => runTap(() => handleSend())}
            onTouchEnd={() => runTap(() => handleSend())}
            className="flex items-center justify-center leading-none rounded-xl flex-shrink-0"
            style={{
              width: '44px', height: '44px',
              background: canSend ? 'linear-gradient(135deg, hsl(243 67% 57%), hsl(263 60% 62%))' : 'hsl(252 20% 90%)',
              boxShadow: canSend ? '0 4px 12px hsl(243 67% 57% / 0.35)' : 'none',
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            <div className="i-mdi-send" style={{fontSize: '20px', color: canSend ? 'white' : 'hsl(252 20% 60%)'}} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default withRouteGuard(WorkbenchPage)
