import {useState, useCallback, useEffect, useMemo} from 'react'
import Taro, {useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'
import {getMaterialById} from '@/db/api'
import type {Material, PackagePlatformResult} from '@/db/types'

// ── 平台顺序 ────────────────────────────────────────────────────
const PLATFORMS = ['小红书', '抖音', '视频号', '公众号']

const PLATFORM_ICONS: Record<string, string> = {
  '小红书': 'i-mdi-flower-outline',
  '抖音':   'i-mdi-music-note-outline',
  '视频号': 'i-mdi-wechat',
  '公众号': 'i-mdi-newspaper-variant-outline',
}

const SECTION_LABELS: Array<{key: keyof PackagePlatformResult; label: string; icon: string}> = [
  {key: 'titles',           label: '标题方案',     icon: 'i-mdi-format-title'},
  {key: 'body',             label: '正文 / 脚本',  icon: 'i-mdi-text-long'},
  {key: 'cover_suggestion', label: '封面建议',     icon: 'i-mdi-image-outline'},
  {key: 'image_prompts',    label: '图片提示词',   icon: 'i-mdi-palette-outline'},
  {key: 'hashtags',         label: '话题标签',     icon: 'i-mdi-pound'},
  {key: 'best_time',        label: '发布时间',     icon: 'i-mdi-clock-outline'},
  {key: 'ad_advice',        label: '投放建议',     icon: 'i-mdi-bullseye-arrow'},
  {key: 'risk_warning',     label: '风险提醒',     icon: 'i-mdi-shield-outline'},
]

function renderValue(key: keyof PackagePlatformResult, value: unknown): string {
  if (Array.isArray(value)) {
    if (key === 'hashtags') return (value as string[]).map((t) => `#${t}`).join('  ')
    return (value as string[]).map((v, i) => `${i + 1}. ${v}`).join('\n')
  }
  return String(value || '')
}

function copyText(text: string, label: string) {
  if (Taro.getEnv() === Taro.ENV_TYPE.WEAPP) {
    Taro.setClipboardData({data: text, success: () => Taro.showToast({title: `${label}已复制`, icon: 'success'})})
  } else {
    try {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      Taro.showToast({title: `${label}已复制`, icon: 'success'})
    } catch {
      Taro.showToast({title: '复制失败', icon: 'none'})
    }
  }
}

function buildFullPlatformText(platform: string, data: PackagePlatformResult): string {
  const lines: string[] = [`【${platform}】完整素材包\n`]
  for (const {key, label} of SECTION_LABELS) {
    lines.push(`▌ ${label}`)
    lines.push(renderValue(key, data[key]))
    lines.push('')
  }
  lines.push('---\nLuna 基于用户提供素材、公开信息和平台内容规律生成建议。')
  return lines.join('\n')
}

// ── 单节内容块 ──────────────────────────────────────────────────
function SectionBlock({skey, label, icon, value}: {
  skey: keyof PackagePlatformResult
  label: string
  icon: string
  value: unknown
}) {
  const text = renderValue(skey, value)
  const isRisk = skey === 'risk_warning'

  return (
    <div
      className="border border-border bg-card rounded-xl overflow-hidden mb-4"
      style={{boxShadow: isRisk ? '2px 2px 0px hsl(var(--destructive))' : 'var(--shadow-card)'}}
    >
      {/* 节标题 */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border"
        style={{background: isRisk ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'}}
      >
        <div className="flex items-center gap-2">
          <div className={`${icon} text-xl text-white`} />
          <span className="text-xl font-bold text-white">{label}</span>
        </div>
        <div
          className="flex items-center gap-1 px-2 py-1 border border-white"
          onClick={() => copyText(text, label)}
        >
          <div className="i-mdi-content-copy text-xl text-white" />
          <span className="text-xl text-white">复制</span>
        </div>
      </div>
      {/* 内容 */}
      <div className="px-4 py-4">
        {Array.isArray(value) && skey === 'hashtags' ? (
          <div className="flex flex-wrap gap-2">
            {(value as string[]).map((tag, i) => (
              <span
                key={i}
                className="border border-border px-2 py-1 text-xl font-bold text-foreground"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : Array.isArray(value) ? (
          <div className="flex flex-col gap-2">
            {(value as string[]).map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className="text-xl font-bold flex-shrink-0"
                  style={{color: 'hsl(var(--accent))'}}
                >
                  {i + 1}.
                </span>
                <span className="text-xl text-foreground leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xl text-foreground leading-relaxed" style={{whiteSpace: 'pre-wrap'}}>{text}</p>
        )}
      </div>
    </div>
  )
}

// ── 主页面 ──────────────────────────────────────────────────────
function PackageResultPage() {
  const materialId = useMemo(() => {
    const params = Taro.getCurrentInstance().router?.params
    return params?.id || ''
  }, [])

  const [material, setMaterial] = useState<Material | null>(null)
  const [loading, setLoading] = useState(true)
  const [activePlatform, setActivePlatform] = useState(0)
  const [saving, setSaving] = useState(false)

  useShareAppMessage(() => ({title: 'Luna AI 多平台素材包'}))
  useShareTimeline(() => ({title: 'Luna AI 多平台素材包'}))

  const loadMaterial = useCallback(async () => {
    if (!materialId) { setLoading(false); return }
    setLoading(true)
    const data = await getMaterialById(materialId)
    setMaterial(data)
    setLoading(false)
  }, [materialId])

  useEffect(() => { loadMaterial() }, [loadMaterial])

  const result = material?.package_result || null
  const availablePlatforms = result ? PLATFORMS.filter((p) => p in result) : []
  const currentPlatform = availablePlatforms[activePlatform] || availablePlatforms[0] || ''
  const currentData = result ? result[currentPlatform] : null

  const handleCopyAll = () => {
    if (!currentData) return
    copyText(buildFullPlatformText(currentPlatform, currentData), `${currentPlatform}完整素材包`)
  }

  const handleCopyAllPlatforms = () => {
    if (!result) return
    const allText = availablePlatforms
      .filter((p) => result[p])
      .map((p) => buildFullPlatformText(p, result[p]))
      .join('\n\n================\n\n')
    copyText(allText, '全平台素材包')
  }

  const handleSaveToLibrary = async () => {
    if (!material || saving) return
    setSaving(true)
    Taro.showToast({title: '已保存到素材库', icon: 'success'})
    setSaving(false)
  }

  // ── Loading ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <div className="i-mdi-loading animate-spin text-4xl text-foreground" />
        <p className="text-2xl text-muted-foreground">加载素材包…</p>
      </div>
    )
  }

  if (!material || !result || availablePlatforms.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6">
        <div className="i-mdi-alert-circle-outline text-5xl text-muted-foreground" />
        <p className="text-2xl font-bold text-foreground">素材包加载失败</p>
        <p className="text-xl text-muted-foreground text-center">内容暂时无法显示，请返回重试</p>
        <button
          type="button"
          className="bg-gradient-primary rounded-xl flex items-center justify-center leading-none text-2xl font-bold text-white shadow-primary"
          onClick={() => Taro.navigateBack()}
        >
          <div className="px-8 py-4">返回</div>
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background pb-36">
      {/* 顶部信息 */}
      <div className="bg-gradient-hero px-4 pt-4 pb-5">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="flex items-center justify-center w-10 h-10 rounded-full"
            style={{background: 'rgba(255,255,255,0.2)'}}
            onClick={() => Taro.navigateBack()}
          >
            <div className="i-mdi-arrow-left text-2xl text-white" />
          </div>
          <p className="text-2xl font-bold text-white flex-1">{material.title}</p>
        </div>
        <div className="flex items-center gap-2 pl-1">
          <span
            className="px-2 py-0 text-xl font-bold border border-white"
            style={{background: 'hsl(var(--accent))'}}
          >
            {availablePlatforms.length} 平台
          </span>
          <span className="text-xl" style={{color: 'rgba(255,255,255,0.6)'}}>
            {material.source_mode === 'direction' ? '方向热点生成' : '已有素材生成'}
          </span>
        </div>
      </div>

      {/* 平台 Tab */}
      <div className="flex border-b border-border bg-card sticky top-0" style={{zIndex: 10}}>
        {availablePlatforms.map((p, i) => (
          <div
            key={p}
            className="flex-1 flex flex-col items-center py-3 gap-1"
            style={{
              background: activePlatform === i ? 'hsl(var(--primary))' : 'hsl(var(--card))',
              borderRight: i < availablePlatforms.length - 1 ? '1px solid hsl(var(--border))' : undefined,
            }}
            onClick={() => setActivePlatform(i)}
          >
            <div
              className={`${PLATFORM_ICONS[p] || 'i-mdi-view-grid-outline'} text-2xl`}
              style={{color: activePlatform === i ? 'white' : 'hsl(var(--primary))'}}
            />
            <span
              className="text-xl font-bold"
              style={{color: activePlatform === i ? 'white' : 'hsl(var(--foreground))'}}
            >
              {p}
            </span>
          </div>
        ))}
      </div>

      {/* 当前平台内容 */}
      {currentData && (
        <div className="px-4 pt-5">
          {/* 复制当前平台全文按钮 */}
          <div
            className="flex items-center gap-2 justify-center border border-border rounded-xl py-3 mb-5 bg-card shadow-card"
            onClick={handleCopyAll}
          >
            <div className="i-mdi-content-copy text-2xl text-foreground" />
            <span className="text-xl font-bold text-foreground">复制 {currentPlatform} 完整内容</span>
          </div>

          {/* 各节内容 */}
          {SECTION_LABELS.map(({key, label, icon}) =>
            currentData[key] !== undefined ? (
              <SectionBlock
                key={key}
                skey={key}
                label={label}
                icon={icon}
                value={currentData[key]}
              />
            ) : null
          )}
        </div>
      )}

      {/* 底部操作栏 */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t-2 border-border px-4 py-4">
        <div className="flex gap-3">
          <button
            type="button"
            className="flex-1 border border-border rounded-xl flex items-center justify-center leading-none text-xl font-bold shadow-card"
            style={{background: 'hsl(var(--card))', color: 'hsl(var(--foreground))', padding: 0}}
            onClick={handleCopyAllPlatforms}
          >
            <div className="py-4 flex items-center gap-2">
              <div className="i-mdi-content-copy text-xl text-foreground" />
              <span>全平台复制</span>
            </div>
          </button>
          <button
            type="button"
            className="flex-1 border border-border rounded-xl flex items-center justify-center leading-none text-xl font-bold shadow-primary"
            style={{background: saving ? 'hsl(var(--muted))' : 'hsl(var(--accent))', color: 'white', padding: 0}}
            onClick={handleSaveToLibrary}
          >
            <div className="py-4 flex items-center gap-2">
              <div className="i-mdi-bookmark-outline text-xl text-white" />
              <span>{saving ? '已保存' : '保存到库'}</span>
            </div>
          </button>
        </div>
        <p className="text-xl text-muted-foreground text-center mt-2">
          Luna 基于用户提供素材、公开信息和平台内容规律生成建议
        </p>
      </div>
    </div>
  )
}

export default withRouteGuard(PackageResultPage)
