import {useState, useMemo, useCallback} from 'react'
import Taro from '@tarojs/taro'
import {Picker} from '@tarojs/components'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {selectMediaFiles, uploadToSupabase} from '@/utils/upload'
import {supabase} from '@/client/supabase'

// ── 常量 ─────────────────────────────────────────────────────────
const PLATFORM_OPTIONS = ['小红书', '抖音', '视频号', '公众号']
const GOAL_OPTIONS = ['品牌曝光', '产品推广', '活动引流', '粉丝增长', '销售转化', '内容种草']

const INDUSTRY_PRESETS = [
  '母婴育儿', '美妆护肤', '餐饮美食', '本地生活',
  '民宿旅游', '健身运动', 'AI工具', '服装穿搭',
  '家居装修', '数码科技', '宠物', '教育培训',
]

// ── 组件 ─────────────────────────────────────────────────────────
function PackageCreatePage() {
  const {user, profile} = useAuth()

  // 从路由参数读取模式
  const mode = useMemo(() => {
    const params = Taro.getCurrentInstance().router?.params
    return (params?.mode as 'material' | 'direction') || 'material'
  }, [])

  const [tab, setTab] = useState<'material' | 'direction'>(mode)

  // ── 通用状态
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['小红书', '抖音', '视频号', '公众号'])
  const [goalIndex, setGoalIndex] = useState(0)
  const [generating, setGenerating] = useState(false)

  // ── 素材模式状态
  const [materialText, setMaterialText] = useState('')
  const [uploadedFiles, setUploadedFiles] = useState<Array<{name: string; url: string}>>([])
  const [uploading, setUploading] = useState(false)

  // ── 方向模式状态
  const [industryInput, setIndustryInput] = useState('')
  const [selectedPreset, setSelectedPreset] = useState('')

  const togglePlatform = (p: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((x) => x !== p) : prev) : [...prev, p]
    )
  }

  const handlePickFile = useCallback(async () => {
    if (!user || uploading) return
    try {
      const files = await selectMediaFiles({count: 3, mediaType: ['image', 'video']})
      if (!files || files.length === 0) return
      setUploading(true)
      const results: Array<{name: string; url: string}> = []
      for (const file of files) {
        const res = await uploadToSupabase(file, {bucket: 'chat-attachments', userId: user.id})
        if (res.success && res.data) {
          const {data: urlData} = supabase.storage.from('chat-attachments').getPublicUrl(res.data.path)
          results.push({name: file.name || `文件_${Date.now()}`, url: urlData.publicUrl})
        }
      }
      setUploadedFiles((prev) => [...prev, ...results])
      Taro.showToast({title: `已上传 ${results.length} 个文件`, icon: 'success'})
    } catch {
      Taro.showToast({title: '上传失败，请重试', icon: 'none'})
    } finally {
      setUploading(false)
    }
  }, [user, uploading])

  const handleSelectPreset = (preset: string) => {
    setSelectedPreset(preset)
    setIndustryInput(preset)
  }

  const handleGenerate = async () => {
    if (generating || !user) return

    // 免费版额度检查
    if (profile?.membership_level === 'free' && (profile?.ai_count || 0) >= 5) {
      Taro.showToast({title: '免费额度已用完，请升级套餐', icon: 'none', duration: 3000})
      return
    }

    if (tab === 'material' && !materialText.trim() && uploadedFiles.length === 0) {
      Taro.showToast({title: '请输入素材内容或上传文件', icon: 'none'})
      return
    }
    if (tab === 'direction' && !industryInput.trim()) {
      Taro.showToast({title: '请输入行业方向', icon: 'none'})
      return
    }

    setGenerating(true)
    Taro.showLoading({title: 'Luna 正在创作…'})

    try {
      const body: Record<string, unknown> = {
        user_id: user.id,
        mode: tab,
        platforms: selectedPlatforms,
        goal: GOAL_OPTIONS[goalIndex],
      }

      if (tab === 'material') {
        body.material_text = materialText
        body.material_images = uploadedFiles.map((f) => f.url)
      } else {
        body.industry = industryInput
      }

      const {data, error} = await supabase.functions.invoke('luna_guardian', {body})

      if (error) {
        const errMsg = await error?.context?.text?.()
        throw new Error(errMsg || error.message)
      }

      if (data?.blocked) {
        Taro.hideLoading()
        Taro.showModal({
          title: '请求被拦截',
          content: data.block_reason || 'Luna 不支持该类型的操作，请调整后重试。',
          showCancel: false,
          confirmText: '知道了',
        })
        return
      }

      if (data?.task_type === 'need_more_info') {
        Taro.hideLoading()
        Taro.showToast({title: data.message || '请补充更多信息', icon: 'none', duration: 3000})
        return
      }

      Taro.hideLoading()

      if (data?.material_id) {
        Taro.navigateTo({url: `/pages/package-result/index?id=${data.material_id}`})
      } else {
        Taro.showToast({title: '生成失败，请重试', icon: 'none'})
      }
    } catch (e: unknown) {
      Taro.hideLoading()
      const msg = e instanceof Error ? e.message : '生成失败，请重试'
      Taro.showToast({title: msg.slice(0, 20), icon: 'none'})
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* 模式切换 Tab */}
      <div className="flex border-b border-border bg-card sticky top-0 z-10">
        {([['material', '用已有素材'], ['direction', '从方向热点']] as const).map(([key, label]) => (
          <div
            key={key}
            className="flex-1 flex items-center justify-center py-4"
            style={{
              background: tab === key ? 'hsl(var(--primary))' : 'hsl(var(--card))',
              borderRight: key === 'material' ? '1px solid hsl(var(--border))' : undefined,
            }}
            onClick={() => setTab(key)}
          >
            <span
              className="text-2xl font-bold"
              style={{color: tab === key ? 'white' : 'hsl(var(--foreground))'}}
            >
              {label}
            </span>
          </div>
        ))}
      </div>

      <div className="px-4 pt-6 flex flex-col gap-6">
        {/* 目标平台 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
            <span className="text-2xl font-bold text-foreground">目标平台</span>
            <span className="text-xl text-muted-foreground">（可多选）</span>
          </div>
          <div className="flex gap-2">
            {PLATFORM_OPTIONS.map((p) => {
              const selected = selectedPlatforms.includes(p)
              return (
                <div
                  key={p}
                  className="flex-1 border border-border rounded-lg flex items-center justify-center py-3"
                  style={{background: selected ? 'hsl(var(--accent))' : 'hsl(var(--card))'}}
                  onClick={() => togglePlatform(p)}
                >
                  <span
                    className="text-xl font-bold"
                    style={{color: selected ? 'white' : 'hsl(var(--foreground))'}}
                  >
                    {p}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 投放目标 */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
            <span className="text-2xl font-bold text-foreground">投放目标</span>
          </div>
          <div className="border border-border bg-card shadow-card overflow-hidden">
            <Picker
              mode="selector"
              range={GOAL_OPTIONS}
              value={goalIndex}
              onChange={(e) => setGoalIndex(Number((e as {detail: {value: number}}).detail.value))}
            >
              <div className="flex items-center justify-between px-4 py-4">
                <span className="text-2xl text-foreground font-bold">{GOAL_OPTIONS[goalIndex]}</span>
                <div className="i-mdi-chevron-down text-2xl text-muted-foreground" />
              </div>
            </Picker>
          </div>
        </div>

        {/* ── 素材模式 ── */}
        {tab === 'material' && (
          <>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
                <span className="text-2xl font-bold text-foreground">素材内容</span>
              </div>
              <div className="border border-border bg-card shadow-card overflow-hidden">
                <textarea
                  className="w-full text-xl text-foreground bg-transparent outline-none"
                  style={{height: '28vw', padding: '12px 16px', display: 'block'}}
                  placeholder="输入产品介绍、活动信息、品牌故事、文案草稿等…"
                  value={materialText}
                  onInput={(e) => {
                    const ev = e as unknown as {detail?: {value: string}; target?: {value: string}}
                    setMaterialText(ev.detail?.value ?? ev.target?.value ?? '')
                  }}
                />
              </div>
            </div>

            {/* 上传文件 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
                <span className="text-2xl font-bold text-foreground">上传素材</span>
                <span className="text-xl text-muted-foreground">（图片/视频，可选）</span>
              </div>
              <div
                className="border-2 border-dashed border-border bg-card flex flex-col items-center justify-center py-6 gap-2"
                onClick={handlePickFile}
              >
                {uploading ? (
                  <div className="i-mdi-loading animate-spin text-3xl text-muted-foreground" />
                ) : (
                  <>
                    <div className="i-mdi-upload text-3xl text-muted-foreground" />
                    <span className="text-xl text-muted-foreground">点击选择图片或视频</span>
                  </>
                )}
              </div>
              {uploadedFiles.length > 0 && (
                <div className="flex flex-col gap-2 mt-3">
                  {uploadedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 border border-border bg-card px-3 py-2">
                      <div className="i-mdi-paperclip text-xl text-muted-foreground" />
                      <span className="flex-1 text-xl text-foreground">{f.name}</span>
                      <div
                        className="i-mdi-close text-xl text-muted-foreground"
                        onClick={() => setUploadedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 方向模式 ── */}
        {tab === 'direction' && (
          <>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
                <span className="text-2xl font-bold text-foreground">行业方向</span>
              </div>
              <div className="border border-border bg-card shadow-card overflow-hidden">
                <input
                  className="w-full text-2xl text-foreground bg-transparent outline-none"
                  style={{padding: '12px 16px', display: 'block'}}
                  placeholder="例如：母婴、美妆、本地餐饮…"
                  value={industryInput}
                  onInput={(e) => {
                    const ev = e as unknown as {detail?: {value: string}; target?: {value: string}}
                    const val = ev.detail?.value ?? ev.target?.value ?? ''
                    setIndustryInput(val)
                    setSelectedPreset(val)
                  }}
                />
              </div>
            </div>

            {/* 行业预设 */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl text-muted-foreground">快速选择</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {INDUSTRY_PRESETS.map((preset) => (
                  <div
                    key={preset}
                    className="border border-border rounded-lg px-3 py-2"
                    style={{background: selectedPreset === preset ? 'hsl(var(--accent))' : 'hsl(var(--card))'}}
                    onClick={() => handleSelectPreset(preset)}
                  >
                    <span
                      className="text-xl font-bold"
                      style={{color: selectedPreset === preset ? 'white' : 'hsl(var(--foreground))'}}
                    >
                      {preset}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 说明 */}
            <div className="border border-border bg-accent rounded-xl px-4 py-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="i-mdi-information-outline text-xl text-white" />
                <span className="text-xl font-bold text-white">热点分析说明</span>
              </div>
              <p className="text-xl leading-relaxed" style={{color: 'rgba(255,255,255,0.7)'}}>
                Luna 将基于该行业的公开信息和平台内容规律，分析当前热点方向，为您生成多平台内容方案。
              </p>
              <p className="text-xl mt-2" style={{color: 'hsl(var(--accent))'}}>
                Luna 基于用户提供素材、公开信息和平台内容规律生成建议。
              </p>
            </div>
          </>
        )}
      </div>

      {/* 底部生成按钮 */}
      <div
        className="fixed bottom-0 left-0 right-0 px-4 py-4 bg-background border-t border-border"
      >
        <button
          type="button"
          className="w-full border border-border flex items-center justify-center leading-none text-2xl font-bold shadow-primary"
          style={{
            background: generating ? 'hsl(var(--muted))' : 'hsl(var(--accent))',
            color: 'white',
            padding: 0,
          }}
          onClick={handleGenerate}
        >
          <div className="py-4 flex items-center justify-center gap-2">
            {generating ? (
              <>
                <div className="i-mdi-loading animate-spin text-2xl text-white" />
                <span>Luna 正在创作…</span>
              </>
            ) : (
              <>
                <div className="i-mdi-creation text-2xl text-white" />
                <span>生成多平台素材包</span>
              </>
            )}
          </div>
        </button>
      </div>
    </div>
  )
}

export default withRouteGuard(PackageCreatePage)
