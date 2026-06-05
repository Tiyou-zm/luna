// @title 我的
import {useCallback, useEffect, useState} from 'react'
import Taro, {useDidShow, useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {Image} from '@tarojs/components'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {MEMBERSHIP_LABELS} from '@/db/types'
import {getAnnouncements, updateProfile} from '@/db/api'
import type {Announcement} from '@/db/types'
import {selectMediaFiles, uploadToSupabase} from '@/utils/upload'

const LEVEL_COLORS: Record<string, string> = {
  free: 'bg-muted text-muted-foreground',
  graphic: 'bg-primary/10 text-primary',
  video_starter: 'bg-accent text-accent-foreground',
  video_pro: 'bg-primary/20 text-primary',
  professional: 'bg-gradient-primary text-primary-foreground',
  enterprise: 'bg-gradient-hero text-white'
}

const ANNOUNCEMENT_TYPE_COLORS: Record<string, string> = {
  product_launch: 'bg-green-50 border-green-200 text-green-700',
  version_update: 'bg-primary/5 border-primary/20 text-primary',
  maintenance: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  info: 'bg-accent border-border text-foreground'
}

const ANNOUNCEMENT_TYPE_LABELS: Record<string, string> = {
  product_launch: '新品上线',
  version_update: '版本更新',
  maintenance: '系统维护',
  info: '通知'
}

function ProfilePage() {
  const {user, profile, refreshProfile, signOut} = useAuth()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [expandAnnounce, setExpandAnnounce] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [editingNickname, setEditingNickname] = useState(false)
  const [nicknameInput, setNicknameInput] = useState('')
  const [savingNickname, setSavingNickname] = useState(false)
  useShareAppMessage(() => ({title: 'Luna AI - 我的账户'}))
  useShareTimeline(() => ({title: 'Luna AI - 我的账户'}))

  const loadProfile = useCallback(async () => {
    await refreshProfile()
    const data = await getAnnouncements()
    setAnnouncements(data)
  }, [refreshProfile])

  useEffect(() => { loadProfile() }, [loadProfile])
  useDidShow(() => { loadProfile() })

  const handleAvatarChange = async () => {
    if (!user) return
    try {
      const files = await selectMediaFiles({count: 1, mediaType: ['image']})
      if (!files || files.length === 0) return
      setUploadingAvatar(true)
      const result = await uploadToSupabase(files[0], {bucket: 'avatars', userId: user.id})
      if (!result.success || !result.data) {
        Taro.showToast({title: '上传失败，请重试', icon: 'none'})
        return
      }
      const publicUrl = result.data.publicUrl || result.data.fileID
      const ok = await updateProfile(user.id, {avatar_url: publicUrl})
      if (ok) {
        await refreshProfile()
        Taro.showToast({title: '头像已更新', icon: 'success'})
      } else {
        Taro.showToast({title: '保存失败', icon: 'none'})
      }
    } catch {
      Taro.showToast({title: '操作失败', icon: 'none'})
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleSignOut = async () => {
    if (!user) {
      Taro.navigateTo({url: '/pages/login/index'})
      return
    }
    Taro.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      success: async ({confirm}) => {
        if (confirm) {
          await signOut()
          Taro.reLaunch({url: '/pages/login/index'})
        }
      }
    })
  }

  const handleEditNickname = () => {
    setNicknameInput(profile?.nickname || profile?.username || '')
    setEditingNickname(true)
  }

  const handleSaveNickname = async () => {
    if (!user || !nicknameInput.trim()) {
      Taro.showToast({title: '昵称不能为空', icon: 'none'})
      return
    }
    setSavingNickname(true)
    const ok = await updateProfile(user.id, {nickname: nicknameInput.trim()})
    if (ok) {
      await refreshProfile()
      Taro.showToast({title: '昵称已保存', icon: 'success'})
      setEditingNickname(false)
    } else {
      Taro.showToast({title: '保存失败，请重试', icon: 'none'})
    }
    setSavingNickname(false)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '永久'
    return new Date(dateStr).toLocaleDateString('zh-CN').replace(/\//g, '-')
  }

  const memberLevel = (profile?.membership_level as string) || 'free'
  const levelLabel = MEMBERSHIP_LABELS[memberLevel as keyof typeof MEMBERSHIP_LABELS] || '免费版'
  const levelColorClass = LEVEL_COLORS[memberLevel] || LEVEL_COLORS.free

  const shortId = profile?.id
    ? `${profile.id.substring(0, 4)}****${profile.id.substring(profile.id.length - 4)}`
    : '未登录'

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* ===用户信息卡=== */}
      <div className="mx-4 mt-4 bg-card rounded-2xl p-5 shadow-card border border-border">
        <div className="flex items-start gap-4 mb-4">
          <div className="relative flex-shrink-0" onClick={handleAvatarChange}>
            <div className="w-20 h-20 rounded-2xl bg-accent flex items-center justify-center border-2 border-primary/20 overflow-hidden">
              {profile?.avatar_url ? (
                <Image src={profile.avatar_url} mode="aspectFill" className="w-full" style={{height: '80px'}} />
              ) : (
                <div className="i-mdi-dice-multiple text-primary" style={{fontSize: '46px'}} />
              )}
            </div>
            <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-accent border-2 border-white flex items-center justify-center">
              {uploadingAvatar ? (
                <div className="i-mdi-loading text-primary animate-spin" style={{fontSize: '12px'}} />
              ) : (
                <div className="i-mdi-pencil-outline text-primary" style={{fontSize: '14px'}} />
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-3xl font-bold text-foreground truncate">
                {profile?.nickname || profile?.username || 'Luna'}
              </span>
              <div className="i-mdi-pencil-outline text-muted-foreground" style={{fontSize: '18px'}} onClick={handleEditNickname} />
            </div>
            {editingNickname && (
              <div className="mt-2 mb-2 flex flex-col gap-2">
                <div className="border-2 border-primary rounded-xl px-3 py-2 bg-background overflow-hidden">
                  <input
                    className="w-full text-xl text-foreground bg-transparent outline-none"
                    placeholder="输入新昵称"
                    value={nicknameInput}
                    onInput={(e) => { const ev = e as any; setNicknameInput(ev.detail?.value ?? ev.target?.value ?? '') }}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 py-1 rounded-xl border border-border flex items-center justify-center leading-none"
                    onClick={() => setEditingNickname(false)}
                  >
                    <div className="py-2"><span className="text-xl text-muted-foreground">取消</span></div>
                  </button>
                  <button
                    type="button"
                    className={`flex-1 py-1 rounded-xl flex items-center justify-center leading-none ${savingNickname ? 'bg-primary/50' : 'bg-gradient-primary'}`}
                    onClick={handleSaveNickname}
                  >
                    <div className="py-2"><span className="text-xl font-bold text-white">{savingNickname ? '保存中...' : '确认'}</span></div>
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl text-muted-foreground">Luna ID：</span>
              <span className="text-xl text-foreground font-medium">{shortId}</span>
              <div
                className="i-mdi-content-copy text-muted-foreground"
                style={{fontSize: '16px'}}
                onClick={() => {
                  if (!profile?.id) return
                  Taro.setClipboardData({data: profile.id, success: () => Taro.showToast({title: 'ID已复制', icon: 'success'})})
                }}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className={`flex items-center gap-1 px-3 py-1 rounded-full border border-primary/30 ${levelColorClass}`}>
                <div className="i-mdi-crown-outline" style={{fontSize: '14px'}} />
                <span className="text-xl font-bold">{levelLabel}</span>
              </div>
              <span className="text-xl text-muted-foreground">
                有效期至 {formatDate(profile?.membership_expires as string | null)}
              </span>
            </div>
          </div>
        </div>

        {/* 数据统计卡 */}
        <div className="rounded-2xl p-4" style={{background: 'hsl(252 55% 88%)'}}>
          <div className="flex items-stretch gap-0">
            <div className="flex-1 flex flex-col items-center gap-1 pr-2">
              <span className="text-xl text-primary/70">可使用创作余额</span>
              <span className="text-3xl font-bold text-primary">¥{((profile?.balance as number) || 0).toFixed(2)}</span>
              <button
                type="button"
                className="mt-1 px-3 py-1 bg-white/60 rounded-lg flex items-center justify-center leading-none gap-1"
                onClick={() => Taro.navigateTo({url: '/pages/compute-recharge/index'})}
              >
                <span className="text-xl text-primary font-medium">去充值</span>
                <div className="i-mdi-chevron-right text-primary" style={{fontSize: '16px'}} />
              </button>
            </div>
            <div className="w-px bg-primary/20 mx-1" />
            <div className="flex-1 flex flex-col items-center gap-1 pl-2">
              <span className="text-xl text-primary/70">已绑定账号</span>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-primary">{(profile?.bound_accounts as number) || 0}</span>
                <span className="text-xl text-primary/70">个</span>
              </div>
              <button
                type="button"
                className="mt-1 px-3 py-1 bg-white/60 rounded-lg flex items-center justify-center leading-none gap-1"
                onClick={() => Taro.navigateTo({url: '/pages/monitor/index'})}
              >
                <span className="text-xl text-primary font-medium">去管理</span>
                <div className="i-mdi-chevron-right text-primary" style={{fontSize: '16px'}} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 套餐升级提示Banner */}
      <div
        className="mx-4 mt-4 bg-card rounded-xl px-4 py-3 flex items-center gap-2 border border-border"
        onClick={() => Taro.navigateTo({url: '/pages/pricing/index'})}
      >
        <div className="i-mdi-lightning-bolt text-primary" style={{fontSize: '22px'}} />
        <span className="flex-1 text-xl text-foreground font-medium">当前权益不足？点击查看套餐升级</span>
        <span className="text-xl text-primary font-medium">→</span>
      </div>

      {/* 快捷功能 2×2 宫格 */}
      <div className="mx-4 mt-4 bg-card rounded-2xl p-4 shadow-card border border-border">
        <div className="flex flex-row flex-wrap gap-3">
          {[
            {icon: 'i-mdi-receipt-text-outline', label: '我的订单', sub: '套餐/充值记录', url: '/pages/orders/index'},
            {icon: 'i-mdi-chart-timeline-variant', label: '消耗记录', sub: '生成扣费明细', url: '/pages/usage-records/index'},
            {icon: 'i-mdi-folder-text-outline', label: '我的素材', sub: '文案/脚本/TOS文件', url: '/pages/materials/index'},
            {icon: 'i-mdi-monitor-dashboard', label: '账号检测', sub: '绑定自媒体账号', url: '/pages/monitor/index'}
          ].map((item) => (
            <div
              key={item.label}
              className="flex flex-col items-center gap-2 bg-accent/30 rounded-2xl py-4"
              style={{width: 'calc(50% - 6px)'}}
              onClick={() => Taro.navigateTo({url: item.url})}
            >
              <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center">
                <div className={`${item.icon} text-primary`} style={{fontSize: '26px'}} />
              </div>
              <span className="text-xl font-bold text-foreground">{item.label}</span>
              <span className="text-xl text-muted-foreground text-center px-2">{item.sub}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 系统公告 */}
      {announcements.length > 0 && (
        <div className="mx-4 mt-4 bg-card rounded-2xl shadow-card border border-border overflow-hidden">
          <div
            className="flex items-center gap-3 px-5 py-4 border-b border-border"
            onClick={() => setExpandAnnounce(!expandAnnounce)}
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <div className="i-mdi-bullhorn-outline text-primary" style={{fontSize: '22px'}} />
            </div>
            <div className="flex-1">
              <p className="text-2xl font-medium text-foreground">系统公告</p>
              <p className="text-xl text-muted-foreground">{announcements.length} 条公告</p>
            </div>
            <div className={`i-mdi-chevron-down text-muted-foreground transition-transform ${expandAnnounce ? 'rotate-180' : ''}`} style={{fontSize: '20px'}} />
          </div>
          {expandAnnounce && (
            <div className="flex flex-col">
              {announcements.map((ann, idx) => {
                const typeColor = ANNOUNCEMENT_TYPE_COLORS[ann.type] || ANNOUNCEMENT_TYPE_COLORS.info
                const typeLabel = ANNOUNCEMENT_TYPE_LABELS[ann.type] || '通知'
                return (
                  <div key={ann.id} className={`px-5 py-4 ${idx < announcements.length - 1 ? 'border-b border-border' : ''}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xl font-bold px-2 py-0.5 rounded-md border ${typeColor}`}>{typeLabel}</span>
                      <span className="text-xl font-medium text-foreground flex-1">{ann.title}</span>
                    </div>
                    <p className="text-xl text-muted-foreground leading-relaxed">{ann.content}</p>
                    <p className="text-xl text-muted-foreground mt-1">{new Date(ann.created_at).toLocaleDateString('zh-CN')}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 设置列表 */}
      <div className="mx-4 mt-4 bg-card rounded-2xl shadow-card border border-border overflow-hidden">
        {[
          {icon: 'i-mdi-lock-outline', label: '账号安全', sub: user ? '修改密码、退出登录' : '登录后管理账号安全', url: '/pages/account-security/index'},
          {icon: 'i-mdi-cog-outline', label: '系统设置', sub: '通知、缓存、个性化', url: '/pages/settings/index'},
          {icon: 'i-mdi-information-outline', label: '关于我们', sub: '服务协议、版本信息', url: '/pages/about/index'}
        ].map((item, idx, arr) => (
          <div
            key={item.label}
            className={`flex items-center gap-4 px-5 py-4 ${idx < arr.length - 1 ? 'border-b border-border' : ''}`}
            onClick={() => Taro.navigateTo({url: !user && item.url === '/pages/account-security/index' ? '/pages/login/index' : item.url})}
          >
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
              <div className={`${item.icon} text-primary`} style={{fontSize: '22px'}} />
            </div>
            <div className="flex-1">
              <p className="text-2xl font-medium text-foreground">{item.label}</p>
              <p className="text-xl text-muted-foreground">{item.sub}</p>
            </div>
            <div className="i-mdi-chevron-right text-muted-foreground" style={{fontSize: '20px'}} />
          </div>
        ))}
      </div>

      {/* 管理员入口 */}
      {profile?.is_admin && (
        <div className="mx-4 mt-4">
          <div
            className="bg-gradient-primary rounded-2xl px-5 py-4 flex items-center gap-4"
            onClick={() => Taro.navigateTo({url: '/pages/admin-finance/index'})}
          >
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <div className="i-mdi-shield-crown-outline text-white" style={{fontSize: '22px'}} />
            </div>
            <div className="flex-1">
              <p className="text-2xl font-bold text-white">财务管理中心</p>
              <p className="text-xl text-white/80">自动对账 · 转账指令 · 资金监控</p>
            </div>
            <div className="i-mdi-chevron-right text-white/80" style={{fontSize: '20px'}} />
          </div>
        </div>
      )}

      {/* 退出登录 */}
      <div className="mx-4 mt-4">
        <button
          type="button"
          className="w-full py-1 rounded-2xl border-2 border-destructive flex items-center justify-center leading-none"
          onClick={handleSignOut}
        >
          <div className="py-4">
            <span className="text-2xl font-medium text-destructive">{user ? '退出登录' : '登录 / 注册'}</span>
          </div>
        </button>
      </div>
    </div>
  )
}

export default withRouteGuard(ProfilePage)
