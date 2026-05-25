import {useState, useCallback, useEffect, useMemo, useRef} from 'react'
import Taro, {useDidShow, useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {Image} from '@tarojs/components'
import {supabase} from '@/client/supabase'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {selectMediaFiles, uploadToSupabase} from '@/utils/upload'
import {
  getConversations,
  createConversation,
  getMessages,
  saveMessage,
  deleteConversation,
  getAnalytics,
  getSocialAccounts,
  insertFrontendBlockRecord
} from '@/db/api'
import type {Conversation, Message, AnalyticsData, AnalyticsGranularity} from '@/db/types'

// 快捷问题
const QUICK_TIPS = [
  '如何提升内容播放量？',
  '分析我的粉丝画像',
  '推荐爆款选题',
  '优化发布时间'
]

// SVG折线图生成
function buildPolyline(values: number[], max: number, width: number, height: number) {
  if (values.length < 2 || max === 0) return ''
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - (v / max) * height
      return `${x},${y}`
    })
    .join(' ')
}

function formatNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  return n.toLocaleString()
}

function ChatPage() {
  const {user, profile, refreshProfile} = useAuth()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConvId, setCurrentConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  // 流式打字：AI 回复逐字显示
  const [streamingText, setStreamingText] = useState('')
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 文件上传
  const [pendingFile, setPendingFile] = useState<{name: string; url: string} | null>(null)
  const [uploading, setUploading] = useState(false)

  // 趋势数据看板
  const [granularity, setGranularity] = useState<AnalyticsGranularity>('day')
  const [analyticsRows, setAnalyticsRows] = useState<AnalyticsData[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [updateTime, setUpdateTime] = useState('')
  const [hasSocialAccount, setHasSocialAccount] = useState(false)

  useShareAppMessage(() => ({title: 'Luna AI - ClawSolo 对话'}))
  useShareTimeline(() => ({title: 'Luna AI - ClawSolo 对话'}))

  const loadConversations = useCallback(async () => {
    if (!user) return
    const convs = await getConversations(user.id)
    setConversations(convs)
    if (convs.length > 0 && !currentConvId) {
      setCurrentConvId(convs[0].id)
    }
  }, [user, currentConvId])

  const loadMessages = useCallback(async () => {
    if (!currentConvId) return
    const msgs = await getMessages(currentConvId)
    setMessages(msgs)
  }, [currentConvId])

  const loadAnalytics = useCallback(async () => {
    if (!user) return
    setAnalyticsLoading(true)
    // 同时加载趋势数据和账号绑定状态
    const [rows, accounts] = await Promise.all([
      getAnalytics(user.id, granularity, granularity === 'day' ? 7 : 8),
      getSocialAccounts(user.id)
    ])
    setAnalyticsRows(rows)
    setHasSocialAccount(accounts.length > 0)
    const now = new Date()
    setUpdateTime(
      `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    )
    setAnalyticsLoading(false)
  }, [user, granularity])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  useEffect(() => {
    loadAnalytics()
  }, [loadAnalytics])

  useDidShow(() => {
    loadConversations()
    loadAnalytics()
  })

  // 流式打字动效：把 fullText 逐字追加到 streamingText
  const startTyping = useCallback((fullText: string, onDone: (t: string) => void) => {
    if (streamTimerRef.current) clearInterval(streamTimerRef.current)
    let idx = 0
    setStreamingText('')
    streamTimerRef.current = setInterval(() => {
      idx++
      setStreamingText(fullText.slice(0, idx))
      if (idx >= fullText.length) {
        clearInterval(streamTimerRef.current!)
        streamTimerRef.current = null
        onDone(fullText)
      }
    }, 18) // 约 18ms 每字，自然打字速度
  }, [])

  // 选择并上传文件
  const handlePickFile = async () => {
    if (uploading || sending) return
    try {
      const files = await selectMediaFiles({count: 1, mediaType: ['image', 'video']})
      if (!files || files.length === 0) return
      setUploading(true)
      const result = await uploadToSupabase(files[0], {bucket: 'chat-attachments', userId: user!.id})
      if (!result.success || !result.data) {
        Taro.showToast({title: '上传失败，请重试', icon: 'none'})
        return
      }
      const {data: urlData} = supabase.storage.from('chat-attachments').getPublicUrl(result.data.path)
      const fname = files[0].name || `文件_${Date.now()}`
      setPendingFile({name: fname, url: urlData.publicUrl})
      Taro.showToast({title: '文件已准备，点击发送', icon: 'success'})
    } catch {
      Taro.showToast({title: '选择文件失败', icon: 'none'})
    } finally {
      setUploading(false)
    }
  }

  const handleNewConversation = async () => {
    if (!user) return
    const conv = await createConversation(user.id, '新对话')
    if (conv) {
      setConversations((prev) => [conv, ...prev])
      setCurrentConvId(conv.id)
      setMessages([])
      setShowSidebar(false)
    }
  }

  const handleSelectConversation = async (convId: string) => {
    setCurrentConvId(convId)
    setShowSidebar(false)
    const msgs = await getMessages(convId)
    setMessages(msgs)
  }

  const handleDeleteConversation = async (convId: string) => {
    await deleteConversation(convId)
    setConversations((prev) => prev.filter((c) => c.id !== convId))
    if (currentConvId === convId) {
      const remaining = conversations.filter((c) => c.id !== convId)
      setCurrentConvId(remaining.length > 0 ? remaining[0].id : null)
      setMessages([])
    }
  }

  const handleSend = async (text?: string) => {
    const baseText = (text ?? inputText).trim()
    // 如果有待发文件，将文件 URL 附在消息后面发给 Hermes
    const fileExtra = pendingFile ? `\n\n[用户上传了文件：${pendingFile.name}，链接：${pendingFile.url}，请根据文件内容给出建议。]` : ''
    const msgText = baseText + fileExtra
    if (!msgText.trim() || sending || !user) return

    if (profile && profile.membership_level === 'free' && profile.ai_count >= 8) {
      Taro.showToast({title: '免费额度已用完，请升级套餐', icon: 'none', duration: 3000})
      // 写入前端拦截记录，方便管理员核查用户被挡情况
      insertFrontendBlockRecord(
        user.id,
        profile.balance ?? 0,
        '[前端预检拦截] 免费额度已用尽（ai_count >= 8）'
      ).catch(() => {/* 静默失败，不影响用户操作 */})
      return
    }

    let convId = currentConvId
    if (!convId) {
      const conv = await createConversation(user.id, (baseText || pendingFile?.name || '新对话').slice(0, 20))
      if (!conv) return
      convId = conv.id
      setCurrentConvId(convId)
      setConversations((prev) => [conv, ...prev])
    }

    // 用户气泡只显示文字部分（文件附件单独展示）
    const userMsg: Message = {
      id: `tmp_${Date.now()}`,
      conversation_id: convId,
      user_id: user.id,
      role: 'user',
      content: baseText || `[发送了文件：${pendingFile?.name}]`,
      tokens_used: 0,
      created_at: new Date().toISOString()
    }

    setMessages((prev) => [...prev, userMsg])
    setInputText('')
    setPendingFile(null)
    setSending(true)
    setStreamingText('')

    await saveMessage(convId, user.id, 'user', userMsg.content)

    try {
      const {data, error} = await supabase.functions.invoke('arkclaw_chat', {
        body: {
          message: msgText,
          conversationId: convId,
          history: messages.slice(-10).map((m) => ({role: m.role, content: m.content}))
        }
      })

      if (error) {
        const errMsg = await error?.context?.text?.()
        throw new Error(errMsg || error.message)
      }

      const reply = data?.reply || '抱歉，暂时无法回答，请稍后再试。'
      // 先用流式打字展示，打完后写入消息列表
      setSending(false)
      startTyping(reply, async (finalText) => {
        setStreamingText('')
        const saved = await saveMessage(convId!, user.id, 'assistant', finalText, data?.tokens || 0)
        if (saved) {
          setMessages((prev) => [...prev, saved])
        }
        // 同步 profile（free 用户 ai_count、视频/图片用量均在后端更新，需刷新前端状态）
        await refreshProfile()
      })
    } catch {
      setSending(false)
      setStreamingText('')
      Taro.showToast({title: '发送失败，请重试', icon: 'none'})
    }
  }

  const latestMessages = useMemo(() => messages.slice(-6), [messages])

  // 趋势图数据
  const chartW = 200
  const chartH = 60
  const visitors = analyticsRows.map((r) => r.visitors)
  const shares = analyticsRows.map((r) => r.interactions)
  const maxVal = Math.max(1, ...visitors, ...shares)
  const visitorLine = buildPolyline(visitors, maxVal, chartW, chartH)
  const shareLine = buildPolyline(shares, maxVal, chartW, chartH)
  const labels = analyticsRows.map((r) => r.date.slice(5)) // MM-DD
  const latest = analyticsRows[analyticsRows.length - 1]

  // 上一期数据（用于计算涨幅）
  const prev = analyticsRows.length >= 2 ? analyticsRows[analyticsRows.length - 2] : null
  function calcChange(cur: number, pre: number | undefined): string {
    if (!pre || pre === 0) return '--'
    const pct = ((cur - pre) / pre) * 100
    return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'
  }

  const stats = latest
    ? [
        {icon: 'i-mdi-eye-outline', label: '今日访客', value: formatNum(latest.visitors), change: calcChange(latest.visitors, prev?.visitors)},
        {icon: 'i-mdi-heart-outline', label: '新增粉丝', value: formatNum(latest.new_followers), change: calcChange(latest.new_followers, prev?.new_followers)},
        {icon: 'i-mdi-play-circle-outline', label: '播放量', value: formatNum(latest.plays), change: calcChange(latest.plays, prev?.plays)},
        {icon: 'i-mdi-chat-outline', label: '互动数', value: formatNum(latest.interactions), change: calcChange(latest.interactions, prev?.interactions)}
      ]
    : null

  const topContents = latest?.top_contents || []

  // 导出看板数据 - 通过OpenClaw执行（在对话框发送格式化命令）
  const handleExportAnalytics = () => {
    const exportCmd = `[系统指令] 请导出用户小红书账号最近${granularity === 'day' ? '7天' : '8周'}的趋势数据报表，格式为JSON，包含日期、访客数、新增粉丝、播放量、互动数、发布量字段。`
    handleSend(exportCmd)
    Taro.showToast({title: '已发送导出指令', icon: 'success'})
  }

  return (
    <div className="min-h-screen bg-background pb-6">
      {/* ===像素风顶部Banner=== */}
      <div
        className="px-5 pt-6 pb-5 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, hsl(222 90% 14%) 0%, hsl(230 85% 20%) 50%, hsl(215 80% 26%) 100%)',
        }}
      >
        {/* 像素网格底纹 */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'linear-gradient(rgba(100,180,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(100,180,255,0.4) 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }}
        />
        {/* 左上高亮光晕 */}
        <div
          className="absolute"
          style={{
            top: '-30px', left: '-20px',
            width: '200px', height: '160px',
            background: 'radial-gradient(ellipse at center, rgba(80,180,255,0.22) 0%, transparent 70%)',
            pointerEvents: 'none'
          }}
        />
        {/* 右下光晕 */}
        <div
          className="absolute"
          style={{
            bottom: '-20px', right: '-10px',
            width: '160px', height: '120px',
            background: 'radial-gradient(ellipse at center, rgba(30,120,255,0.18) 0%, transparent 70%)',
            pointerEvents: 'none'
          }}
        />
        {/* 扫光横线 */}
        <div
          className="absolute"
          style={{
            top: '38%', left: 0, right: 0,
            height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(120,200,255,0.35) 30%, rgba(200,235,255,0.6) 50%, rgba(120,200,255,0.35) 70%, transparent 100%)',
          }}
        />

        {/* 像素装饰点阵 右上 */}
        <div className="absolute top-3 right-20 opacity-25">
          {[0, 1, 2].map((r) => (
            <div key={r} className="flex gap-2 mb-1">
              {[0, 1, 2, 3].map((c) => (
                <div key={c} style={{width: '4px', height: '4px', background: '#7DD3FC'}} />
              ))}
            </div>
          ))}
        </div>

        {/* ── 主内容区 ── */}
        <div className="flex items-center justify-between relative">
          {/* 左侧：标题区 */}
          <div className="flex-1 flex flex-col gap-2">
            <h1
              className="font-black leading-none"
              style={{
                fontSize: '36px',
                color: '#FFFFFF',
                fontFamily: 'monospace',
                letterSpacing: '3px',
                textShadow: [
                  '2px 2px 0px #38BDF8',
                  '4px 4px 0px #0EA5E9',
                  '6px 6px 0px #0369A1',
                  '8px 8px 0px rgba(0,0,0,0.5)',
                  '0px 0px 18px rgba(56,189,248,0.7)',
                  '0px 0px 40px rgba(14,165,233,0.35)'
                ].join(', '),
                WebkitTextStroke: '0.5px rgba(186,230,255,0.4)'
              }}
            >
              幻核创营家
            </h1>
            <span
              style={{
                fontSize: '14px',
                color: '#93C5FD',
                fontFamily: 'monospace',
                letterSpacing: '2px',
                textShadow: '0 0 8px rgba(56,189,248,0.5)'
              }}
            >
              ClawSolo
            </span>
          </div>

          {/* 右侧：角色头像（点击跳客服） */}
          <button
            type="button"
            className="flex items-center justify-center leading-none transition"
            style={{marginLeft: '12px', flexShrink: 0}}
            onClick={() => Taro.switchTab({url: '/pages/service/index'})}
          >
            <div
              style={{
                width: '64px', height: '64px',
                borderRadius: '16px',
                overflow: 'hidden',
                border: '2px solid rgba(56,189,248,0.7)',
                boxShadow: '0 0 16px rgba(56,189,248,0.4), inset 0 1px 0 rgba(255,255,255,0.2)'
              }}
            >
              <Image
                src="https://miaoda-conversation-file.cdn.bcebos.com/user-b9kbo3bmsirk/app-b9plzy10uj29/20260512/915bc833-71ad-4312-90f0-3e7aba84690e.png"
                mode="aspectFill"
                style={{width: '64px', height: '64px'}}
              />
            </div>
          </button>
        </div>

        {/* 像素风底部装饰线（蓝色像素点） */}
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{
            height: '3px',
            background: 'repeating-linear-gradient(90deg, #38BDF8 0px, #38BDF8 6px, rgba(56,189,248,0.15) 6px, rgba(56,189,248,0.15) 12px)'
          }}
        />
      </div>

      {/* ===OpenClaw Agent对话卡片=== */}
      <div className="mx-4 mt-4 bg-card rounded-2xl shadow-card border border-border overflow-hidden">
        {/* 卡片标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
              <div className="i-mdi-robot-outline text-primary" style={{fontSize: '22px'}} />
            </div>
            <span className="text-2xl font-bold text-foreground">OpenClaw Agent</span>
          </div>
          <div className="flex items-center gap-1 bg-green-50 px-3 py-1 rounded-full border border-green-200">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xl text-green-700 font-medium">智能对话中</span>
          </div>
        </div>

        {/* 对话内容 */}
        <div className="px-4 pt-3 pb-2" style={{minHeight: '100px'}}>
          {latestMessages.length === 0 && !streamingText ? (
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-1">
                <div className="i-mdi-robot-outline text-primary" style={{fontSize: '20px'}} />
              </div>
              <div className="flex-1 bg-accent/40 rounded-2xl rounded-tl-sm px-4 py-3">
                <p className="text-xl text-foreground leading-relaxed">
                  你好！我是 OpenClaw Agent，你的智能运营助手。{'\n'}
                  可以问我内容创作、粉丝增长、账号优化等问题，也可以让我分析你的小红书数据。
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {latestMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} items-end gap-2`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                      <div className="i-mdi-robot-outline text-primary" style={{fontSize: '16px'}} />
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2 ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm'
                        : 'bg-accent/50 text-foreground rounded-bl-sm'
                    }`}
                    style={{maxWidth: '75%'}}
                  >
                    <p className="text-xl leading-relaxed">{msg.content}</p>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <div className="i-mdi-account text-primary" style={{fontSize: '16px'}} />
                    </div>
                  )}
                </div>
              ))}
              {/* 流式打字气泡 */}
              {streamingText ? (
                <div className="flex items-end gap-2">
                  <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <div className="i-mdi-robot-outline text-primary" style={{fontSize: '16px'}} />
                  </div>
                  <div className="bg-accent/50 rounded-2xl rounded-bl-sm px-3 py-2" style={{maxWidth: '75%'}}>
                    <p className="text-xl leading-relaxed text-foreground">{streamingText}<span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5" /></p>
                  </div>
                </div>
              ) : sending && (
                <div className="flex items-end gap-2">
                  <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <div className="i-mdi-robot-outline text-primary" style={{fontSize: '16px'}} />
                  </div>
                  <div className="bg-accent/50 rounded-2xl rounded-bl-sm px-3 py-2">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-primary animate-bounce" />
                      <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{animationDelay: '0.1s'}} />
                      <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{animationDelay: '0.2s'}} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 快捷chips */}
        <div className="px-4 pb-3 flex flex-row gap-2 overflow-x-auto">
          {QUICK_TIPS.map((tip) => (
            <button
              key={tip}
              type="button"
              className="flex-shrink-0 border border-primary/30 rounded-full px-3 py-1 bg-accent/30 flex items-center justify-center leading-none"
              onClick={() => setInputText(tip)}
            >
              <span className="text-xl text-primary font-medium break-keep">{tip}</span>
            </button>
          ))}
        </div>

        {/* 待发文件预览 */}
        {pendingFile && (
          <div className="px-4 pb-2 flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-accent/40 rounded-xl px-3 py-2 border border-primary/20">
              <div className="i-mdi-file-image-outline text-primary" style={{fontSize: '18px'}} />
              <span className="flex-1 text-xl text-foreground truncate">{pendingFile.name}</span>
              <button
                type="button"
                className="flex items-center justify-center leading-none w-6 h-6"
                onClick={() => setPendingFile(null)}
              >
                <div className="i-mdi-close text-muted-foreground" style={{fontSize: '16px'}} />
              </button>
            </div>
          </div>
        )}

        {/* 输入框 */}
        <div className="px-4 pb-4 flex items-center gap-2">
          {/* 上传文件按钮 */}
          <button
            type="button"
            className={`w-11 h-11 rounded-xl flex items-center justify-center leading-none flex-shrink-0 transition ${uploading ? 'bg-muted' : 'bg-accent border border-border'}`}
            onClick={handlePickFile}
          >
            <div
              className={`${uploading ? 'i-mdi-loading animate-spin' : 'i-mdi-paperclip'} text-primary`}
              style={{fontSize: '20px'}}
            />
          </button>
          <div className="flex-1 border border-border rounded-xl px-4 py-2 bg-background overflow-hidden">
            <input
              className="w-full text-xl text-foreground bg-transparent outline-none"
              placeholder="输入你的问题，Enter 发送"
              value={inputText}
              onInput={(e) => {
                const ev = e as any
                setInputText(ev.detail?.value ?? ev.target?.value ?? '')
              }}
            />
          </div>
          <button
            type="button"
            className={`w-11 h-11 rounded-xl flex items-center justify-center leading-none flex-shrink-0 transition ${(inputText.trim() || pendingFile) && !sending && !streamingText ? 'bg-gradient-primary' : 'bg-muted'}`}
            onClick={() => handleSend()}
          >
            <div
              className={`i-mdi-send ${(inputText.trim() || pendingFile) && !sending && !streamingText ? 'text-white' : 'text-muted-foreground'}`}
              style={{fontSize: '20px'}}
            />
          </button>
        </div>

        {/* 历史对话入口 */}
        {conversations.length > 0 && (
          <div className="border-t border-border px-4 py-2 flex items-center justify-between">
            <span className="text-xl text-muted-foreground">共 {conversations.length} 条历史对话</span>
            <button
              type="button"
              className="flex items-center gap-1 text-primary"
              onClick={() => setShowSidebar(true)}
            >
              <span className="text-xl font-medium">查看全部</span>
              <div className="i-mdi-chevron-right" style={{fontSize: '18px'}} />
            </button>
          </div>
        )}
      </div>

      {/* ===趋势数据看板=== */}
      <div className="mx-4 mt-4 bg-card rounded-2xl shadow-card border border-border overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="i-mdi-chart-line text-primary" style={{fontSize: '22px'}} />
            <span className="text-2xl font-bold text-foreground">趋势数据看板</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl text-muted-foreground">更新于 {updateTime || '--:--:--'}</span>
            <button
              type="button"
              className="w-8 h-8 rounded-full bg-accent flex items-center justify-center leading-none"
              onClick={loadAnalytics}
            >
              <div className={`i-mdi-refresh text-primary ${analyticsLoading ? 'animate-spin' : ''}`} style={{fontSize: '18px'}} />
            </button>
          </div>
        </div>

        {/* 日/周切换 */}
        <div className="px-4 pt-3 flex items-center gap-3">
          {(['day', 'week'] as AnalyticsGranularity[]).map((g) => (
            <button
              key={g}
              type="button"
              className={`px-4 py-1 rounded-full text-xl font-medium flex items-center justify-center leading-none transition ${granularity === g ? 'bg-primary text-white' : 'bg-accent text-muted-foreground'}`}
              onClick={() => setGranularity(g)}
            >
              {g === 'day' ? '按日' : '按周'}
            </button>
          ))}
          <div className="flex-1" />
          <button
            type="button"
            className="flex items-center gap-1 px-3 py-1 rounded-full border border-primary/30 flex items-center justify-center leading-none"
            onClick={handleExportAnalytics}
          >
            <div className="i-mdi-download-outline text-primary" style={{fontSize: '16px'}} />
            <span className="text-xl text-primary">导出报表</span>
          </button>
        </div>

        {/* 无数据提示 */}
        {!analyticsLoading && analyticsRows.length === 0 && (
          <div className="px-4 py-8 flex flex-col items-center gap-4">
            {hasSocialAccount ? (
              <>
                <div className="i-mdi-sync-circle text-muted-foreground" style={{fontSize: '44px'}} />
                <p className="text-2xl font-bold text-foreground">数据同步中</p>
                <p className="text-xl text-muted-foreground text-center">Claw MCP 正在同步您的平台数据，首次同步可能需要几分钟</p>
                <button
                  type="button"
                  className="mt-1 px-6 py-1 rounded-2xl border-2 border-border flex items-center gap-2 justify-center leading-none"
                  onClick={() => Taro.navigateTo({url: '/pages/monitor/index'})}
                >
                  <div className="i-mdi-chart-line text-muted-foreground" style={{fontSize: '20px'}} />
                  <div className="py-3">
                    <span className="text-xl font-medium text-muted-foreground">前往账号检测查看进度</span>
                  </div>
                </button>
              </>
            ) : (
              <>
                <div className="i-mdi-link-variant-off text-muted-foreground" style={{fontSize: '44px'}} />
                <p className="text-2xl font-bold text-foreground">未绑定自媒体账号</p>
                <p className="text-xl text-muted-foreground text-center">绑定小红书等平台后，数据将由 Claw MCP 自动同步至此看板</p>
                <button
                  type="button"
                  className="mt-1 px-6 py-1 rounded-2xl bg-gradient-primary shadow-primary flex items-center gap-2 justify-center leading-none"
                  onClick={() => Taro.navigateTo({url: '/pages/monitor/index'})}
                >
                  <div className="i-mdi-plus-circle-outline text-white" style={{fontSize: '20px'}} />
                  <div className="py-3">
                    <span className="text-xl font-bold text-white">立即绑定账号</span>
                  </div>
                </button>
              </>
            )}
          </div>
        )}

        {/* 4统计格 */}
        {stats && (
          <div className="px-4 pt-4 pb-2">
            <div className="flex gap-3">
              {stats.map((stat) => (
                <div key={stat.label} className="flex-1 flex flex-col gap-1">
                  <div className={`${stat.icon} text-primary`} style={{fontSize: '20px'}} />
                  <span className="text-xl text-muted-foreground">{stat.label}</span>
                  <span className="text-2xl font-bold text-foreground">{stat.value}</span>
                  <span className={`text-xl font-medium ${stat.change.startsWith('+') ? 'text-green-500' : stat.change === '--' ? 'text-muted-foreground' : 'text-red-400'}`}>
                    {stat.change}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 内容TOP3 + 趋势图 */}
        {analyticsRows.length > 0 && (
          <div className="flex px-4 pt-3 pb-4 gap-4">
            {/* TOP3 */}
            <div className="flex-1">
              <div className="flex items-center gap-1 mb-2">
                <div className="i-mdi-podium text-primary" style={{fontSize: '16px'}} />
                <span className="text-xl font-bold text-foreground">内容表现 TOP3</span>
              </div>
              {topContents.length === 0 ? (
                <p className="text-xl text-muted-foreground">暂无内容数据</p>
              ) : (
                topContents.slice(0, 3).map((item, i) => (
                  <div key={item.title} className="flex items-center gap-2 mb-2">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${i === 0 ? 'bg-primary text-primary-foreground' : 'bg-accent text-primary'}`}
                    >
                      <span style={{fontSize: '12px', fontWeight: 'bold'}}>{i + 1}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-xl text-foreground">{item.title}</p>
                      <p className="text-xl text-muted-foreground">播放 {formatNum(item.plays)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 趋势SVG */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xl font-bold text-foreground">{granularity === 'day' ? '7日' : '近8周'}趋势</span>
                <div className="flex items-center gap-2">
                  <span className="text-xl text-primary">● 访客</span>
                  <span className="text-xl text-yellow-500">● 互动</span>
                </div>
              </div>
              {visitors.length >= 2 ? (
                <svg width="100%" viewBox={`0 0 ${chartW} ${chartH + 16}`} style={{overflow: 'visible'}} aria-label="趋势数据图表">
                  {[0, 0.5, 1].map((t) => (
                    <line
                      key={t}
                      x1="0"
                      y1={chartH - t * chartH}
                      x2={chartW}
                      y2={chartH - t * chartH}
                      stroke="hsl(248 25% 88%)"
                      strokeWidth="1"
                    />
                  ))}
                  <polyline
                    points={visitorLine}
                    fill="none"
                    stroke="hsl(252 76% 58%)"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <polyline
                    points={shareLine}
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {labels.map((label, i) => (
                    <text
                      key={label}
                      x={(i / (labels.length - 1)) * chartW}
                      y={chartH + 14}
                      textAnchor="middle"
                      fontSize="8"
                      fill="hsl(248 20% 50%)"
                    >
                      {label}
                    </text>
                  ))}
                </svg>
              ) : (
                <p className="text-xl text-muted-foreground">数据不足，无法绘图</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===运营建议 + 爆款案例（去掉工具箱）=== */}
      <div className="mx-4 mt-4 flex gap-3">
        {[
          {
            icon: 'i-mdi-book-open-outline',
            label: '运营指南',
            sub: '每两天更新',
            prompt: '请结合我的历史对话和内容偏好，给我最新的运营建议，帮助我提升小红书账号运营效果。'
          },
          {
            icon: 'i-mdi-star-outline',
            label: '爆款案例',
            sub: '同类博主推荐',
            prompt: '请根据我的账号定位，推荐几位同类型的优秀博主案例，分析他们的爆款内容策略。'
          }
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            className="flex-1 bg-card rounded-2xl border border-border shadow-card px-3 py-4 flex flex-col items-center gap-2 leading-none transition"
            onClick={() => {
              setInputText(item.prompt)
              Taro.showToast({title: '已填入对话框，点击发送', icon: 'none'})
            }}
          >
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
              <div className={`${item.icon} text-primary`} style={{fontSize: '24px'}} />
            </div>
            <span className="text-xl font-bold text-foreground">{item.label}</span>
            <span className="text-xl text-muted-foreground">{item.sub}</span>
          </button>
        ))}
      </div>

      {/* ===对话历史侧边栏=== */}
      {showSidebar && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-72 bg-card h-full flex flex-col shadow-card">
            <div className="flex items-center justify-between px-4 py-4 bg-primary">
              <span className="text-2xl font-bold text-white">对话历史</span>
              <button
                type="button"
                className="flex items-center justify-center leading-none w-8 h-8 rounded-lg bg-white/20"
                onClick={() => setShowSidebar(false)}
              >
                <div className="i-mdi-close text-white" style={{fontSize: '20px'}} />
              </button>
            </div>
            <button
              type="button"
              className="mx-4 mt-4 py-3 rounded-xl bg-gradient-primary text-primary-foreground text-xl font-bold flex items-center justify-center leading-none gap-2"
              onClick={handleNewConversation}
            >
              <div className="i-mdi-plus text-white" style={{fontSize: '20px'}} />
              <span>新对话</span>
            </button>
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`flex items-center gap-2 px-3 py-3 rounded-xl ${conv.id === currentConvId ? 'bg-accent' : 'bg-background'}`}
                  onClick={() => handleSelectConversation(conv.id)}
                >
                  <div className="i-mdi-chat-outline text-muted-foreground" style={{fontSize: '18px'}} />
                  <span className="flex-1 text-xl text-foreground truncate">{conv.title}</span>
                  <button
                    type="button"
                    className="flex items-center justify-center leading-none w-7 h-7"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteConversation(conv.id)
                    }}
                  >
                    <div className="i-mdi-delete-outline text-muted-foreground" style={{fontSize: '16px'}} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1" onClick={() => setShowSidebar(false)} />
        </div>
      )}
    </div>
  )
}

export default withRouteGuard(ChatPage)
