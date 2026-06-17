import {useState, useCallback, useEffect, useMemo, useRef} from 'react'
import Taro, {useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {Image} from '@tarojs/components'
import {withRouteGuard} from '@/components/RouteGuard'
import {AIGeneratedBadge} from '@/components/AIGeneratedBadge'
import {getCloudTempUrl} from '@/client/cloudbase'
import {getMaterialById, getMaterialChildren} from '@/db/api'
import {withTimeout} from '@/utils/async'
import type {Material, PackagePlatformResult} from '@/db/types'

// ── 平台顺序 ────────────────────────────────────────────────────
const PLATFORMS = ['小红书', '抖音', '视频号', '朋友圈', '公众号']

const PLATFORM_ICONS: Record<string, string> = {
  '小红书': 'i-mdi-flower-outline',
  '抖音':   'i-mdi-music-note-outline',
  '视频号': 'i-mdi-wechat',
  '朋友圈': 'i-mdi-account-group-outline',
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
  {key: 'push_advice',      label: '推送建议',     icon: 'i-mdi-send-clock-outline'},
  {key: 'delivery_logic',   label: '投放逻辑',     icon: 'i-mdi-chart-timeline-variant'},
  {key: 'fact_check_notes', label: '质检说明',     icon: 'i-mdi-check-decagram-outline'},
  {key: 'risk_warning',     label: '风险提醒',     icon: 'i-mdi-shield-outline'},
] as Array<{key: keyof PackagePlatformResult; label: string; icon: string}>

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function renderValue(key: keyof PackagePlatformResult, value: unknown): string {
  if (Array.isArray(value)) {
    if (key === 'hashtags') return value.map((t) => `#${displayValue(t).replace(/^#/, '')}`).join('  ')
    return value.map((v, i) => `${i + 1}. ${displayValue(v)}`).join('\n')
  }
  return displayValue(value)
}

type RawRecord = Record<string, any>

type PackageAssetPreview = {
  title: string
  url: string
  fileID?: string
  type: 'image' | 'archive' | 'file'
  source: string
  platformLabel?: string
}

const INTERNAL_ASSET_FILE_RE = /(?:^|\/)(?:material_package|content|trending_research|content_strategy|qa_result|image_prompts)\.json(?:[?#].*)?$/i
const IMAGE_PREVIEW_LIMIT = 12

const RESULT_ASSET_URL_FIELDS = [
  'url',
  'asset_url',
  'assetUrl',
  'file_url',
  'fileUrl',
  'file_path',
  'filePath',
  'download_url',
  'downloadUrl',
  'download_path',
  'downloadPath',
  'download_link',
  'downloadLink',
  'public_url',
  'publicUrl',
  'cos_url',
  'cosUrl',
  'cdn_url',
  'cdnUrl',
  'zip_url',
  'zipUrl',
  'archive_url',
  'archiveUrl',
  'package_url',
  'packageUrl',
  'image_url',
  'imageUrl',
  'image',
  'src',
  'path',
  'local_path',
  'localPath',
  'cover_url',
  'cover_image',
  'thumbnail_url',
]

const RESULT_ASSET_ARRAY_FIELDS = [
  'generated',
  'generated_assets',
  'generatedAssets',
  'placeholder',
  'images',
  'image_assets',
  'imageAssets',
  'image_urls',
  'image_files',
  'asset_urls',
  'assetUrls',
  'download_urls',
  'downloadUrls',
  'generated_images',
  'generatedImages',
  'files',
  'file_assets',
  'fileAssets',
  'material_files',
  'package_files',
  'packageFiles',
  'attachments',
  'outputs',
  'deliverables',
  'resources',
  'archives',
]

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function looksLikeAssetUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const text = value.trim()
  return Boolean(text && /^(https?:\/\/|cloud:\/\/|wxfile:\/\/|\/|[A-Za-z0-9_-]+\/)/.test(text))
}

function isCloudFileID(value: unknown): value is string {
  return typeof value === 'string' && /^cloud:\/\//i.test(value.trim())
}

function normalizePreviewUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  let text = value.trim()
  if (!text) return ''
  if (/^MEDIA:/i.test(text)) text = text.replace(/^MEDIA:/i, '').trim()
  if (text.startsWith('/var/www/images/')) {
    const filename = text.split('/').filter(Boolean).pop() || ''
    return filename ? `http://152.136.47.2:8080/${filename}` : text
  }
  return text
}

function getPreviewFileID(asset: unknown): string {
  if (isCloudFileID(asset)) return asset.trim()
  if (!isRecord(asset)) return ''
  const candidates = [
    asset.fileID,
    asset.fileId,
    asset.fileid,
    asset.cloud_file_id,
    asset.cloudFileId,
    asset.key,
  ]
  return String(candidates.find(isCloudFileID) || '').trim()
}

function isDownloadablePreviewUrl(url: string): boolean {
  return /^(https?:\/\/|cloud:\/\/)/i.test(url)
}

function getPreviewUrl(asset: unknown): string {
  const directUrl = normalizePreviewUrl(asset)
  if (looksLikeAssetUrl(directUrl)) return directUrl
  if (!isRecord(asset)) return ''
  for (const field of RESULT_ASSET_URL_FIELDS) {
    const url = normalizePreviewUrl(asset[field])
    if (looksLikeAssetUrl(url)) return url
  }
  return ''
}

function isImagePreview(asset: unknown, url: string): boolean {
  const typeText = isRecord(asset) ? String(asset.type || asset.file_type || asset.media_type || asset.mime || '').toLowerCase() : ''
  return typeText.includes('image') || /\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(url)
}

function isArchivePreview(asset: unknown, url: string): boolean {
  const typeText = isRecord(asset) ? String(asset.type || asset.file_type || asset.media_type || asset.mime || asset.asset_kind || '').toLowerCase() : ''
  return typeText.includes('archive') || /\.(zip|rar|7z|tar|gz)(\?|#|$)/i.test(url)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function isVisiblePackageAsset(asset: PackageAssetPreview): boolean {
  if (asset.type === 'image' || asset.type === 'archive') return true
  return false
}

function getPreviewTitle(asset: unknown, fallback: string): string {
  if (!isRecord(asset)) return fallback
  return asset.name || asset.title || asset.filename || asset.file_name || asset.label || fallback
}

function pushPreviewAsset(list: PackageAssetPreview[], seen: Set<string>, asset: unknown, source: string, platformLabel?: string) {
  const fileID = getPreviewFileID(asset)
  const url = fileID || getPreviewUrl(asset)
  if (!url) return
  if (!isDownloadablePreviewUrl(url)) return
  const key = (fileID || url).replace(/\?.*$/, '')
  if (seen.has(key)) return
  seen.add(key)
  const type = isImagePreview(asset, url) ? 'image' : isArchivePreview(asset, url) ? 'archive' : 'file'
  if (INTERNAL_ASSET_FILE_RE.test(getPreviewTitle(asset, url)) || INTERNAL_ASSET_FILE_RE.test(url)) return
  list.push({
    title: getPreviewTitle(asset, type === 'image' ? `包内图片 ${list.length + 1}` : `包内文件 ${list.length + 1}`),
    url,
    fileID: fileID || undefined,
    type,
    source,
    platformLabel,
  })
}

function collectPreviewFields(list: PackageAssetPreview[], seen: Set<string>, container: unknown, source: string, platformLabel?: string) {
  if (!isRecord(container)) return
  RESULT_ASSET_ARRAY_FIELDS.forEach((field) => {
    const value = container[field]
    if (Array.isArray(value)) {
      value.forEach((item) => pushPreviewAsset(list, seen, item, `${source}.${field}`, platformLabel))
    } else {
      pushPreviewAsset(list, seen, value, `${source}.${field}`, platformLabel)
    }
  })
  RESULT_ASSET_URL_FIELDS.forEach((field) => {
    if (field === 'path') return
    if (looksLikeAssetUrl(container[field])) pushPreviewAsset(list, seen, container, `${source}.${field}`, platformLabel)
  })
}

function collectPackageAssetPreviews(material: Material | null, childAssets: Material[] = []): PackageAssetPreview[] {
  if (!material) return []
  const list: PackageAssetPreview[] = []
  const seen = new Set<string>()
  const raw = (material as Material & {hermes_raw?: RawRecord}).hermes_raw
  const rawPackage = raw?.type === 'material_package' ? raw : raw?.material_package || raw

  collectPreviewFields(list, seen, material.assets, 'assets')
  pushPreviewAsset(list, seen, material.package_archive, 'package_archive')

  if (isRecord(rawPackage)) {
    collectPreviewFields(list, seen, rawPackage.assets, 'hermes_raw.assets')
    pushPreviewAsset(list, seen, rawPackage.package_archive, 'hermes_raw.package_archive')
    const platforms = rawPackage.content?.platforms || rawPackage.platforms
    if (isRecord(platforms)) {
      Object.entries(platforms).forEach(([platformKey, platformValue]) => {
        const buckets: unknown[] = [platformValue]
        if (isRecord(platformValue)) {
          Object.values(platformValue).forEach((value) => {
            if (Array.isArray(value)) buckets.push(...value)
            else buckets.push(value)
          })
        }
        buckets.forEach((bucket, index) => collectPreviewFields(list, seen, bucket, `hermes_raw.platforms.${platformKey}.${index}`, platformKey))
      })
    }
  }

  childAssets.forEach((asset, index) => {
    const kind = String(asset.metadata?.asset_kind || '')
    const label = kind === 'reference_image'
      ? '参考图'
      : kind === 'prompt_file'
        ? '提示词文件'
        : asset.platform_label || asset.library_section || ''
    pushPreviewAsset(
      list,
      seen,
      {
        type: asset.type,
        title: asset.title || `文件资产 ${index + 1}`,
        url: asset.url || asset.content || asset.key || '',
        fileID: asset.key,
        key: asset.key,
      },
      'materials.children',
      label,
    )
  })

  return list
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
  const lines: string[] = [`【${platform}】完整素材包`, '标记：人工智能生成', '']
  for (const {key, label} of SECTION_LABELS) {
    lines.push(`▌ ${label}`)
    lines.push(renderValue(key, data[key]))
    lines.push('')
  }
  lines.push('---\nLuna 基于用户提供信息、公开信息和平台内容规律生成建议。')
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
        <div className="flex items-center gap-2">
          <AIGeneratedBadge tone="dark" />
          <div
            className="flex items-center gap-1 px-2 py-1 border border-white"
            onClick={() => copyText(text, label)}
          >
            <div className="i-mdi-content-copy text-xl text-white" />
            <span className="text-xl text-white">复制</span>
          </div>
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
            {value.map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className="text-xl font-bold flex-shrink-0"
                  style={{color: 'hsl(var(--primary))'}}
                >
                  {i + 1}.
                </span>
                <span className="text-xl text-foreground leading-relaxed" style={{whiteSpace: 'pre-wrap'}}>{displayValue(item)}</span>
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
  const [childAssets, setChildAssets] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [activePlatform, setActivePlatform] = useState(0)
  const [saving, setSaving] = useState(false)
  const aliveRef = useRef(true)
  const loadSeqRef = useRef(0)

  useShareAppMessage(() => ({title: 'Luna AI 多平台素材包'}))
  useShareTimeline(() => ({title: 'Luna AI 多平台素材包'}))

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      loadSeqRef.current += 1
    }
  }, [])

  const loadMaterial = useCallback(async () => {
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq
    if (!materialId) {
      if (aliveRef.current && loadSeqRef.current === seq) setLoading(false)
      return
    }
    if (aliveRef.current && loadSeqRef.current === seq) setLoading(true)
    try {
      const [data, children] = await Promise.all([
        withTimeout(getMaterialById(materialId), 120000, 'material result timeout'),
        withTimeout(getMaterialChildren(materialId, 100), 120000, 'material children timeout').catch(() => []),
      ])
      if (!aliveRef.current || loadSeqRef.current !== seq) return
      setMaterial(data)
      setChildAssets(children)
    } catch (e) {
      if (!aliveRef.current || loadSeqRef.current !== seq) return
      console.error('load material result error:', e)
      setMaterial(null)
      setChildAssets([])
    } finally {
      if (aliveRef.current && loadSeqRef.current === seq) setLoading(false)
    }
  }, [materialId])

  useEffect(() => { loadMaterial() }, [loadMaterial])

  const result = material?.package_result || null
  const availablePlatforms = result ? PLATFORMS.filter((p) => p in result) : []
  const currentPlatform = availablePlatforms[activePlatform] || availablePlatforms[0] || ''
  const currentData = result ? result[currentPlatform] : null
  const packageAssets = useMemo(() => collectPackageAssetPreviews(material, childAssets), [material, childAssets])
  const visiblePackageAssets = useMemo(() => {
    let imageCount = 0
    return packageAssets.filter((asset) => {
      if (!isVisiblePackageAsset(asset)) return false
      if (asset.type !== 'image') return true
      imageCount += 1
      return imageCount <= IMAGE_PREVIEW_LIMIT
    })
  }, [packageAssets])
  const [resolvedAssetUrls, setResolvedAssetUrls] = useState<Record<string, string>>({})
  const expectsPackageAssets = Boolean(
    (material as any)?.asset_warning ||
    material?.package_config?.asset_warning ||
    material?.package_config?.delivery_mode === 'asset_generation' ||
    material?.workflow?.delivery_mode === 'asset_generation',
  )

  useEffect(() => {
    const fileIDs = Array.from(new Set(
      visiblePackageAssets
        .filter((asset) => asset.fileID)
        .map((asset) => asset.fileID)
        .filter(isCloudFileID),
    ))
    if (fileIDs.length === 0) return
    let alive = true
    Promise.all(fileIDs.map(async (fileID) => {
      try {
        return [fileID, await getCloudTempUrl(fileID)] as const
      } catch {
        return [fileID, ''] as const
      }
    })).then((entries) => {
      if (!alive || !aliveRef.current) return
      setResolvedAssetUrls((prev) => {
        const next = {...prev}
        entries.forEach(([fileID, url]) => {
          if (url && !isCloudFileID(url)) next[fileID] = url
        })
        return next
      })
    })
    return () => { alive = false }
  }, [visiblePackageAssets])

  const getAssetRenderUrl = useCallback((asset: PackageAssetPreview) => {
    if (asset.type !== 'image') return ''
    if (asset.fileID) return resolvedAssetUrls[asset.fileID] || ''
    if (isHttpUrl(asset.url)) return asset.url
    return ''
  }, [resolvedAssetUrls])

  const getAssetCopyUrl = useCallback((asset: PackageAssetPreview) => {
    if (asset.fileID && resolvedAssetUrls[asset.fileID]) return resolvedAssetUrls[asset.fileID]
    if (isHttpUrl(asset.url)) return asset.url
    return asset.url
  }, [resolvedAssetUrls])

  const previewAssetImage = useCallback((asset: PackageAssetPreview) => {
    const current = getAssetRenderUrl(asset)
    if (!current) return
    const urls = visiblePackageAssets
      .filter((item) => item.type === 'image')
      .map(getAssetRenderUrl)
      .filter(Boolean)
    Taro.previewImage({current, urls: urls.length > 0 ? urls : [current]})
  }, [getAssetRenderUrl, visiblePackageAssets])

  const handleCopyAssetLink = useCallback((asset: PackageAssetPreview) => {
    copyText(getAssetCopyUrl(asset), asset.type === 'archive' ? '压缩包下载链接' : '图片链接')
  }, [getAssetCopyUrl])

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
            style={{background: 'hsl(var(--primary))'}}
          >
            {availablePlatforms.length} 平台
          </span>
          <AIGeneratedBadge tone="dark" />
          <span className="text-xl" style={{color: 'rgba(255,255,255,0.6)'}}>
            {material.source_mode === 'direction' ? '方向生成' : '用户提供'}
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
            className="flex items-center gap-2 justify-center border rounded-xl py-3 mb-5 btn-secondary"
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
      {(visiblePackageAssets.length > 0 || expectsPackageAssets) && (
        <div className="px-4 pt-2 pb-5">
          <div className="border border-border bg-card rounded-xl overflow-hidden shadow-card">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border" style={{background: 'hsl(168 54% 42%)'}}>
              <div className="flex items-center gap-2">
                <div className="i-mdi-folder-image text-xl text-white" />
                <span className="text-xl font-bold text-white">图片与下载</span>
              </div>
              <AIGeneratedBadge tone="dark" />
            </div>
            <div className="px-3 py-3 flex flex-col gap-3">
              {visiblePackageAssets.length === 0 ? (
                <div className="rounded-xl border border-border bg-background px-3 py-4">
                  <p className="text-xl font-bold text-foreground">文件资产未随包返回</p>
                  <p className="text-xl text-muted-foreground mt-1 leading-relaxed">Hermes 本次声明需要生成文件资产，但没有返回可下载的图片或压缩包 URL。</p>
                </div>
              ) : visiblePackageAssets.map((asset) => {
                const renderUrl = getAssetRenderUrl(asset)
                const isImage = asset.type === 'image'
                return (
                  <div key={`${asset.source}-${asset.url}`} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-3">
                    {isImage && renderUrl ? (
                      <Image
                        src={renderUrl}
                        mode="aspectFill"
                        className="flex-shrink-0 border border-border"
                        style={{width: '104px', height: '104px', borderRadius: '12px'}}
                        onClick={() => previewAssetImage(asset)}
                      />
                    ) : (
                      <div
                        className="w-20 h-20 rounded-xl flex items-center justify-center border border-border flex-shrink-0"
                        style={{background: 'hsl(var(--secondary))'}}
                        onClick={() => handleCopyAssetLink(asset)}
                      >
                        <div className={`${isImage ? 'i-mdi-image-outline' : 'i-mdi-archive-outline'} text-4xl text-primary`} />
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xl font-bold text-foreground leading-snug">{asset.type === 'archive' ? '完整内容包' : asset.title}</p>
                        <span className="px-2 py-0 rounded-lg text-xl bg-secondary text-primary">{isImage ? '图片' : '压缩包'}</span>
                      </div>
                      <p className="text-xl text-muted-foreground mt-1">{asset.platformLabel || (isImage ? '点击查看大图' : '点击复制下载链接')}</p>
                      <div
                        className="inline-flex items-center gap-1 mt-2 rounded-lg px-3 py-2 bg-secondary"
                        onClick={() => handleCopyAssetLink(asset)}
                      >
                        <div className="i-mdi-content-copy text-xl text-primary" />
                        <span className="text-xl font-bold text-primary">{isImage ? '复制图片链接' : '复制下载链接'}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-background border-t-2 border-border px-4 py-4">
        <div className="flex gap-3">
          <button
            type="button"
            className="flex-1 border rounded-xl flex items-center justify-center leading-none text-xl font-bold btn-secondary"
            style={{padding: 0}}
            onClick={handleCopyAllPlatforms}
          >
            <div className="py-4 flex items-center gap-2">
              <div className="i-mdi-content-copy text-xl text-foreground" />
              <span>全平台复制</span>
            </div>
          </button>
          <button
            type="button"
            className={`flex-1 border rounded-xl flex items-center justify-center leading-none text-xl font-bold ${saving ? 'btn-disabled' : 'btn-primary'}`}
            style={{padding: 0}}
            onClick={handleSaveToLibrary}
          >
            <div className="py-4 flex items-center gap-2">
              <div className="i-mdi-bookmark-outline text-xl text-white" />
              <span>{saving ? '已保存' : '保存到库'}</span>
            </div>
          </button>
        </div>
        <p className="text-xl text-muted-foreground text-center mt-2">
          Luna 基于用户提供信息、公开信息和平台内容规律生成建议
        </p>
      </div>
    </div>
  )
}

export default withRouteGuard(PackageResultPage)
