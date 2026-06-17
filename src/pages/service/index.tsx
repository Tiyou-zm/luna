// @title 客服
import {useState, useCallback, useEffect, useMemo} from 'react'
import Taro, {useDidShow, useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {Image, ScrollView, Textarea} from '@tarojs/components'
import {callCloudFunction} from '@/client/cloudbase'
import {LunaAvatar} from '@/components/LunaAvatar'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {getCsMessages} from '@/db/api'
import {selectMediaFiles, uploadToSupabase} from '@/utils/upload'
import {getMiniWindowMetrics} from '@/utils/system'
import type {CsMessage} from '@/db/types'

const WELCOME_MSG: CsMessage = {
  id: 'welcome',
  user_id: '',
  role: 'assistant',
  content: '您好！我是 Luna 的专属客服 LUNA，很高兴为您服务。\n\n如果您需要更精细化的内容生成、行业素材拆解、账号诊断或长期陪跑，我们也可以为您对接定制化个人服务。您可以直接描述需求、预算和目标平台，我会帮您整理给工作人员跟进。',
  message_type: 'text',
  is_read: true,
  created_at: new Date().toISOString()
}

function ServicePage() {
  const {user} = useAuth()
  const isWeb = Taro.getEnv() === Taro.ENV_TYPE.WEB
  const [messages, setMessages] = useState<CsMessage[]>([WELCOME_MSG])
  const [inputText, setInputText] = useState('')
  const [pendingImage, setPendingImage] = useState<{tempPath: string; publicUrl: string} | null>(null)
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [windowMetrics, setWindowMetrics] = useState(() => (
    isWeb ? {windowHeight: 812, screenHeight: 812, safeBottom: 0} : getMiniWindowMetrics()
  ))
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useShareAppMessage(() => ({title: 'Luna AI 在线客服'}))
  useShareTimeline(() => ({title: 'Luna AI 在线客服'}))

  const lastMsgId = useMemo(() => {
    const last = messages[messages.length - 1]
    return last ? `anchor_${last.id.replace(/[^a-zA-Z0-9]/g, '_')}` : ''
  }, [messages])

  const loadMessages = useCallback(async () => {
    if (!user) return
    const msgs = await getCsMessages(user.id)
    setMessages([WELCOME_MSG, ...msgs])
  }, [user])

  useEffect(() => { loadMessages() }, [loadMessages])
  useDidShow(() => { loadMessages() })

  useEffect(() => {
    if (isWeb) return
    const taroApi = Taro as typeof Taro & {
      onWindowResize?: (callback: () => void) => void
      offWindowResize?: (callback: () => void) => void
      onKeyboardHeightChange?: (callback: (res: {height?: number}) => void) => void
      offKeyboardHeightChange?: (callback: (res: {height?: number}) => void) => void
    }
    const refreshMetrics = () => setWindowMetrics(getMiniWindowMetrics())
    const handleResize = () => refreshMetrics()
    const handleKeyboard = (res: {height?: number}) => {
      setKeyboardHeight(Number(res?.height || 0))
      setTimeout(refreshMetrics, 30)
    }

    refreshMetrics()
    taroApi.onWindowResize?.(handleResize)
    taroApi.onKeyboardHeightChange?.(handleKeyboard)

    return () => {
      taroApi.offWindowResize?.(handleResize)
      taroApi.offKeyboardHeightChange?.(handleKeyboard)
    }
  }, [isWeb])

  const handlePickImage = async () => {
    if (uploading || sending) return
    try {
      const files = await selectMediaFiles({count: 1, mediaType: ['image']})
      if (!files || files.length === 0) return
      setUploading(true)
      const file = files[0]
      const result = await uploadToSupabase(file, {bucket: 'cs-images', userId: user?.id || 'guest'})
      if (!result.success || !result.data) {
        Taro.showToast({title: '图片上传失败，请重试', icon: 'none'})
        return
      }
      const publicUrl = result.data.publicUrl || result.data.fileID
      const tempPath = (file as {tempFilePath?: string}).tempFilePath || ''
      setPendingImage({tempPath, publicUrl})
    } catch {
      Taro.showToast({title: '选择图片失败', icon: 'none'})
    } finally {
      setUploading(false)
    }
  }

  const handleSend = async (quickText?: string) => {
    const text = (quickText ?? inputText).trim()
    const imageUrl = pendingImage?.publicUrl || ''
    if (!text && !imageUrl) return
    if (sending || !user) return

    setInputText('')
    setPendingImage(null)
    setSending(true)

    const tmpId = `tmp_${Date.now()}`
    const tmpMsg: CsMessage = {
      id: tmpId,
      user_id: user.id,
      role: 'user',
      content: text || '[图片]',
      image_url: imageUrl || null,
      message_type: imageUrl ? (text ? 'mixed' : 'image') : 'text',
      is_read: false,
      created_at: new Date().toISOString()
    }
    setMessages((prev) => [...prev, tmpMsg])

    try {
      const data = await callCloudFunction<any>('customerService', {message: text, imageUrl: imageUrl || undefined})
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== tmpId)
        const userSaved = data?.userMessage ?? {...tmpMsg, id: `user_${Date.now()}`}
        const aiMsg = data?.message as CsMessage | null
        return aiMsg ? [...filtered, userSaved, aiMsg] : [...filtered, userSaved]
      })
    } catch {
      Taro.showToast({title: '发送失败，请重试', icon: 'none'})
      setMessages((prev) => prev.filter((m) => m.id !== tmpId))
    } finally {
      setSending(false)
    }
  }

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  const canSend = (inputText.trim() || !!pendingImage) && !sending && !uploading

  const windowHeight = Math.max(360, windowMetrics.windowHeight)
  const containerHeight = isWeb
    ? 'calc(100vh - 50px)'
    : `${windowHeight}px`
  const composerPaddingBottom = keyboardHeight > 0 ? 6 : Math.max(4, Math.min(8, windowMetrics.safeBottom || 4))

  return (
    <div style={{height: containerHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'hsl(252 30% 97%)'}}>
      {/* ===顶部LUNA介绍卡=== */}
      <div
        className="flex-shrink-0 mx-4 mt-4 mb-2 rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, hsl(243 67% 57%) 0%, hsl(263 60% 64%) 100%)',
          boxShadow: '0 6px 24px hsl(243 67% 57% / 0.35)'
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="relative flex-shrink-0">
            <div className="rounded-full overflow-hidden border-2 border-white/40" style={{width: '44px', height: '44px', background: 'hsl(252 60% 80%)'}}>
              <LunaAvatar size={44} />
            </div>
            <div className="absolute bottom-0 right-0 rounded-full border-2 border-white" style={{width: '10px', height: '10px', background: '#22c55e'}} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-white">Hi，我是LUNA</span>
            </div>
            <p className="text-xl text-white/80">咨询产品使用、生成问题或定制化个人服务</p>
          </div>
        </div>
      </div>

      {/* ===消息区域（ScrollView 必须放在有明确高度的容器里）=== */}
      <div style={{flex: 1, minHeight: 0, overflow: 'hidden'}}>
        <ScrollView scrollY scrollIntoView={lastMsgId} scrollWithAnimation style={{height: '100%'}}>
          <div className="px-4 py-2 flex flex-col gap-4">
          {messages.map((msg, idx) => {
            const isUser = msg.role === 'user'
            const showTime = idx === 0 || new Date(msg.created_at).getTime() - new Date(messages[idx - 1].created_at).getTime() > 5 * 60 * 1000

            return (
              <div key={msg.id} id={`anchor_${msg.id.replace(/[^a-zA-Z0-9]/g, '_')}`}>
                {showTime && idx > 0 && (
                  <div className="flex items-center justify-center my-2">
                    <span className="text-xl text-muted-foreground px-3 py-1 rounded-full" style={{background: 'hsl(252 20% 92%)'}}>
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                )}
                <div className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                  {!isUser ? (
                    <div
                      className="rounded-full overflow-hidden flex-shrink-0 border border-white"
                      style={{width: '38px', height: '38px', background: 'linear-gradient(135deg, hsl(243 67% 57%), hsl(263 60% 64%))', boxShadow: '0 2px 8px hsl(243 67% 57% / 0.3)'}}
                    >
                      <LunaAvatar size={38} />
                    </div>
                  ) : (
                    <div className="rounded-full flex items-center justify-center flex-shrink-0" style={{width: '38px', height: '38px', background: 'hsl(252 40% 88%)'}}>
                      <div className="i-mdi-account text-primary" style={{fontSize: '22px'}} />
                    </div>
                  )}
                  <div className="flex flex-col gap-1" style={{maxWidth: '62%'}}>
                    {msg.image_url && (
                      <div
                        className="overflow-hidden"
                        style={{
                          borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                          boxShadow: isUser ? '0 4px 16px hsl(243 67% 57% / 0.3)' : '0 2px 8px hsl(252 20% 80% / 0.4)'
                        }}
                      >
                        <Image src={msg.image_url} mode="widthFix" style={{width: '100%', display: 'block'}} />
                      </div>
                    )}
                    {msg.content && msg.content !== '[图片]' && (
                      <div
                        className="px-4 py-3"
                        style={{
                          background: isUser ? 'linear-gradient(135deg, hsl(243 67% 57%), hsl(263 60% 62%))' : 'white',
                          borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                          boxShadow: isUser ? '0 4px 16px hsl(243 67% 57% / 0.3)' : '0 2px 8px hsl(252 20% 80% / 0.25)',
                          border: isUser ? 'none' : '1px solid hsl(252 20% 91%)'
                        }}
                      >
                        <p className="text-xl leading-relaxed whitespace-pre-wrap" style={{color: isUser ? 'white' : 'hsl(252 30% 20%)'}}>
                          {msg.content}
                        </p>
                      </div>
                    )}
                    {isUser && <span className="text-right text-xl" style={{color: 'hsl(252 20% 65%)'}}>已读</span>}
                  </div>
                </div>
              </div>
            )
          })}

          {sending && (
            <div className="flex items-end gap-2">
              <div
                className="rounded-full overflow-hidden flex-shrink-0 border border-white"
                style={{width: '38px', height: '38px', background: 'linear-gradient(135deg, hsl(243 67% 57%), hsl(263 60% 64%))', boxShadow: '0 2px 8px hsl(243 67% 57% / 0.3)'}}
              >
                <LunaAvatar size={38} />
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
      </div>

      {/* ===输入区（flex-shrink-0，贴在 ScrollView 下方）=== */}
      <div
        className="flex-shrink-0"
        style={{
          background: 'white',
          borderTop: '1px solid hsl(252 20% 91%)',
        }}
      >
        {(pendingImage || uploading) && (
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            {uploading ? (
              <div className="rounded-xl flex items-center justify-center" style={{width: '60px', height: '60px', background: 'hsl(252 30% 94%)'}}>
                <div className="i-mdi-loading text-primary animate-spin" style={{fontSize: '24px'}} />
              </div>
            ) : pendingImage ? (
              <div className="relative flex-shrink-0">
                <div className="rounded-xl overflow-hidden" style={{width: '60px', height: '60px'}}>
                  <Image src={pendingImage.tempPath || pendingImage.publicUrl} mode="aspectFill" style={{width: '60px', height: '60px'}} />
                </div>
                <button
                  type="button"
                  onClick={() => setPendingImage(null)}
                  className="absolute flex items-center justify-center rounded-full"
                  style={{top: '-4px', right: '-4px', width: '18px', height: '18px', background: 'hsl(243 67% 57%)', border: '1.5px solid white'}}
                >
                  <div className="i-mdi-close text-white" style={{fontSize: '12px'}} />
                </button>
              </div>
            ) : null}
            <span className="text-xl" style={{color: 'hsl(252 20% 55%)'}}>{uploading ? '上传中...' : '图片已选择'}</span>
          </div>
        )}
        <div className="flex items-end gap-2 px-4" style={{paddingTop: '10px', paddingBottom: `${composerPaddingBottom}px`}}>
          <button
            type="button"
            onClick={handlePickImage}
            className="flex items-center justify-center leading-none rounded-xl flex-shrink-0"
            style={{width: '44px', height: '44px', background: uploading ? 'hsl(252 20% 94%)' : 'hsl(243 67% 57% / 0.1)', border: '1.5px solid hsl(243 67% 57% / 0.3)', flexShrink: 0}}
          >
            <div className={`${uploading ? 'i-mdi-loading animate-spin' : 'i-mdi-image-plus-outline'} text-primary`} style={{fontSize: '22px'}} />
          </button>
          <div className="flex-1" style={{background: 'hsl(252 20% 97%)', border: '1.5px solid hsl(243 67% 57% / 0.2)', borderRadius: '22px', padding: '8px 14px', minHeight: '44px', maxHeight: '116px', overflow: 'hidden'}}>
            <Textarea
              className="w-full text-xl bg-transparent outline-none"
              style={{color: 'hsl(252 30% 20%)', display: 'block', lineHeight: '22px', minHeight: '26px', maxHeight: '96px'}}
              placeholder="请输入您的问题..."
              value={inputText}
              autoHeight
              cursorSpacing={8}
              showConfirmBar={false}
              adjustPosition
              onInput={(e) => { const ev = e as any; setInputText(ev.detail?.value ?? ev.target?.value ?? '') }}
            />
          </div>
          <button
            type="button"
            onClick={() => handleSend()}
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

export default withRouteGuard(ServicePage)
