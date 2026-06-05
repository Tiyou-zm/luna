import {useState, useCallback, useEffect} from 'react'
import Taro, {useDidShow, useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {Image} from '@tarojs/components'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {getMaterials, getMaterialPackages, getGenerationJobs, deleteMaterial} from '@/db/api'
import {selectMediaFiles} from '@/utils/upload'
import {uploadToCos} from '@/utils/cos'
import {withTimeout} from '@/utils/async'
import type {GenerationJob, Material} from '@/db/types'

type AssetItem = Material & {
  key?: string
  url?: string
  sizeStr?: string
}

const FILE_TYPE_ICONS: Record<string, string> = {
  image: 'i-mdi-image-outline',
  video: 'i-mdi-video-outline',
  copywriting: 'i-mdi-text-long',
  script: 'i-mdi-script-text-outline',
  work: 'i-mdi-layers-outline',
  analysis: 'i-mdi-chart-timeline-variant',
  archive: 'i-mdi-archive-outline',
}

type MaterialTab = 'results' | 'copy' | 'video' | 'strategy' | 'assets'

const MATERIAL_TABS: Array<{key: MaterialTab; label: string}> = [
  {key: 'results', label: '完整包'},
  {key: 'copy', label: '文案'},
  {key: 'video', label: '视频脚本'},
  {key: 'strategy', label: '投放分析'},
  {key: 'assets', label: '素材文件'},
]

function getMaterialSection(material: Material): MaterialTab {
  if (material.type === 'work') return 'results'
  if (material.library_section === 'copy') return 'copy'
  if (material.library_section === 'video' || material.type === 'script') return 'video'
  if (material.library_section === 'strategy' || material.type === 'analysis') return 'strategy'
  return 'assets'
}

const VISIBLE_MATERIAL_TABS = MATERIAL_TABS.filter(({key}) => key === 'results' || key === 'assets')

function formatRelativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  return `${Math.floor(diff / 86400)}天前`
}

function getJobStatusText(status: GenerationJob['status']) {
  if (status === 'queued') return '排队中'
  if (status === 'running') return '制作中'
  if (status === 'succeeded') return '已完成'
  if (status === 'failed') return '失败'
  return status
}

function getJobStatusColor(status: GenerationJob['status']) {
  if (status === 'failed') return 'hsl(var(--destructive))'
  if (status === 'succeeded') return 'hsl(var(--accent))'
  return 'hsl(var(--primary))'
}

function MaterialsPage() {
  const {user} = useAuth()
  const [tab, setTab] = useState<MaterialTab>('results')

  // 生成结果列表（type=work）
  const [packages, setPackages] = useState<Material[]>([])
  const [pkgLoading, setPkgLoading] = useState(false)
  const [jobs, setJobs] = useState<GenerationJob[]>([])

  // 素材资产列表（type!=work）
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [assetLoading, setAssetLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  useShareAppMessage(() => ({title: 'Luna AI — 素材资产库'}))
  useShareTimeline(() => ({title: 'Luna AI — 素材资产库'}))

  const loadPackages = useCallback(async () => {
    if (!user) {
      setPackages([])
      setPkgLoading(false)
      return
    }
    setPkgLoading(true)
    try {
      const data = await withTimeout(getMaterialPackages(user.id, 30), 10000, 'material packages timeout')
      setPackages(data)
    } catch (e) {
      console.error('load packages error:', e)
      setPackages([])
    } finally {
      setPkgLoading(false)
    }
  }, [user])

  const loadJobs = useCallback(async () => {
    if (!user) {
      setJobs([])
      return
    }
    try {
      const data = await withTimeout(getGenerationJobs(user.id, 30), 10000, 'generation jobs timeout')
      setJobs(data.filter((job) => job.status !== 'succeeded' || !job.result_material_id))
    } catch (e) {
      console.error('load jobs error:', e)
      setJobs([])
    }
  }, [user])

  const loadAssets = useCallback(async () => {
    if (!user) {
      setAssets([])
      setAssetLoading(false)
      return
    }
    setAssetLoading(true)
    try {
      const fallback = await withTimeout(getMaterials(user.id, 30), 10000, 'material assets timeout')
      setAssets(fallback.filter((m) => m.type !== 'work'))
    } catch (e) {
      console.error('load assets error:', e)
      const fallback = await getMaterials(user.id, 30)
      setAssets(fallback.filter((m) => m.type !== 'work'))
    } finally {
      setAssetLoading(false)
    }
  }, [user])

  useEffect(() => {
    loadJobs()
    loadPackages()
    loadAssets()
  }, [loadJobs, loadPackages, loadAssets])

  useDidShow(() => {
    loadJobs()
    loadPackages()
    loadAssets()
  })

  const handleUploadAsset = async () => {
    if (!user || uploading) return
    try {
      const files = await selectMediaFiles({count: 5, mediaType: ['image', 'video']})
      if (!files || files.length === 0) return
      setUploading(true)
      let successCount = 0
      for (const file of files) {
        const res = await uploadToCos(file)
        if (res.success && res.data) successCount++
      }
      Taro.showToast({title: `已上传 ${successCount} 个素材`, icon: 'success'})
      loadAssets()
    } catch {
      Taro.showToast({title: '上传失败，请重试', icon: 'none'})
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteAsset = (asset: AssetItem) => {
    Taro.showModal({
      title: '删除确认',
      content: '确定删除这个素材吗？',
      confirmText: '删除',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          let ok = false
          ok = await deleteMaterial(asset.id)
          if (ok) {
            setAssets((prev) => prev.filter((a) => a.id !== asset.id))
            Taro.showToast({title: '已删除', icon: 'success'})
          }
        }
      }
    })
  }

  const handleDeletePackage = (id: string) => {
    Taro.showModal({
      title: '删除确认',
      content: '确定删除这个素材包吗？',
      confirmText: '删除',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          const ok = await deleteMaterial(id)
          if (ok) {
            setPackages((prev) => prev.filter((p) => p.id !== id))
            Taro.showToast({title: '已删除', icon: 'success'})
          }
        }
      }
    })
  }

  const visibleAssets = assets.filter((asset) => getMaterialSection(asset) === tab)
  const currentTabLabel = VISIBLE_MATERIAL_TABS.find((item) => item.key === tab)?.label || '素材'
  const canUploadInCurrentTab = tab === 'assets'
  const activeJobCount = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length
  const failedJobCount = jobs.filter((job) => job.status === 'failed').length

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <div className="px-4 pt-5 pb-4">
        <div className="rounded-2xl overflow-hidden shadow-primary" style={{background: 'linear-gradient(135deg, hsl(245 40% 18%) 0%, hsl(246 54% 42%) 52%, hsl(168 54% 42%) 100%)'}}>
          <div className="px-5 pt-5 pb-4" style={{background: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0))'}}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-xl font-bold text-white/70 mb-1">Luna Material Library</p>
                <p className="text-4xl font-bold text-white">素材库</p>
                <p className="text-xl leading-relaxed mt-2" style={{color: 'rgba(255,255,255,0.76)'}}>
                  生成完成的素材包、原始上传素材和后台制作任务都会汇总在这里。
                </p>
              </div>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center border border-white/25" style={{background: 'rgba(255,255,255,0.14)'}}>
                <div className="i-mdi-folder-star-outline text-3xl text-white" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-5">
              {[
                {label: '完整包', value: packages.length},
                {label: '素材文件', value: assets.length},
                {label: activeJobCount > 0 ? '制作中' : '异常任务', value: activeJobCount > 0 ? activeJobCount : failedJobCount},
              ].map((item) => (
                <div key={item.label} className="rounded-xl px-3 py-3 border border-white/15" style={{background: 'rgba(255,255,255,0.12)'}}>
                  <p className="text-3xl font-bold text-white leading-none">{item.value}</p>
                  <p className="text-xl mt-1" style={{color: 'rgba(255,255,255,0.68)'}}>{item.label}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                className="flex-1 rounded-xl py-1 flex items-center justify-center leading-none"
                style={{background: 'rgba(255,255,255,0.96)'}}
                onClick={() => Taro.navigateTo({url: '/pages/package-create/index?mode=material'})}
              >
                <div className="py-3 flex items-center gap-2">
                  <div className="i-mdi-plus text-xl text-primary" />
                  <span className="text-xl font-bold text-primary">新建素材包</span>
                </div>
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl py-1 border border-white/25 flex items-center justify-center leading-none"
                style={{background: 'rgba(255,255,255,0.12)'}}
                onClick={handleUploadAsset}
              >
                <div className="py-3 flex items-center gap-2">
                  <div className={`${uploading ? 'i-mdi-loading animate-spin' : 'i-mdi-upload'} text-xl text-white`} />
                  <span className="text-xl font-bold text-white">{uploading ? '上传中' : '上传素材'}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 顶部 Tab */}
      <div className="px-4 sticky top-0 z-10 pb-2" style={{background: 'hsl(var(--background) / 0.96)'}}>
        <div className="flex rounded-2xl border border-border bg-card p-1 shadow-card">
        {VISIBLE_MATERIAL_TABS.map(({key, label}) => (
          <div
            key={key}
            className="flex-1 flex items-center justify-center py-3 rounded-xl transition"
            style={{
              background: tab === key ? 'hsl(var(--primary))' : 'transparent',
              boxShadow: tab === key ? 'var(--shadow-card)' : 'none',
            }}
            onClick={() => setTab(key)}
          >
            <span
              className="text-xl font-bold"
              style={{color: tab === key ? 'white' : 'hsl(var(--muted-foreground))'}}
            >
              {label}
            </span>
          </div>
        ))}
        </div>
      </div>

      {/* ── 生成结果库 ── */}
      {tab === 'results' && (
        <div className="px-4 pt-4 pb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background: 'hsl(var(--primary) / 0.12)'}}>
                <div className="i-mdi-package-variant-closed text-xl text-primary" />
              </div>
              <span className="text-2xl font-bold text-foreground">素材包记录</span>
              <span className="px-2 py-0 rounded-lg bg-secondary text-xl font-bold text-primary">{packages.length}</span>
            </div>
            <div
              className="flex items-center gap-1 rounded-xl px-3 py-2 bg-primary shadow-card"
              onClick={() => Taro.navigateTo({url: '/pages/package-create/index?mode=material'})}
            >
              <div className="i-mdi-plus text-xl text-white" />
              <span className="text-xl font-bold text-white">新建</span>
            </div>
          </div>

          {jobs.length > 0 && (
            <div className="flex flex-col gap-3 mb-5">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="bg-card border border-border shadow-card rounded-2xl px-4 py-4 overflow-hidden"
                  style={{borderLeft: `4px solid ${getJobStatusColor(job.status)}`}}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-bold text-foreground">{job.title || '素材包生成任务'}</span>
                        <span
                          className="px-2 py-0 text-xl rounded-lg font-bold"
                          style={{color: getJobStatusColor(job.status), background: `${getJobStatusColor(job.status)}18`}}
                        >
                          {getJobStatusText(job.status)}
                        </span>
                      </div>
                      <p className="text-xl text-muted-foreground mt-2">
                        {job.progress_text || 'Hermes 正在后台制作素材包，完成后会自动保存到素材库。'}
                      </p>
                      {job.error_message && (
                        <p className="text-xl mt-2" style={{color: 'hsl(var(--destructive))'}}>{job.error_message}</p>
                      )}
                    </div>
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{background: 'hsl(var(--secondary))'}}>
                      <div className="i-mdi-timer-sand text-2xl text-primary" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/70">
                    <span className="text-xl text-muted-foreground">
                      {(job.platforms || []).slice(0, 4).join(' / ') || (job.mode === 'direction' ? '方向热点' : '已有素材')}
                    </span>
                    <span className="text-xl text-muted-foreground">{formatRelativeTime(job.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pkgLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="i-mdi-loading animate-spin text-4xl text-muted-foreground" />
            </div>
          )}

          {!pkgLoading && packages.length === 0 && (
            <div className="border-2 border-dashed border-border rounded-2xl bg-card flex flex-col items-center gap-3 py-12 px-6 shadow-card">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background: 'hsl(var(--secondary))'}}>
                <div className="i-mdi-package-variant-closed text-4xl text-primary" />
              </div>
              <p className="text-2xl font-bold text-foreground">还没有生成记录</p>
              <p className="text-xl text-muted-foreground text-center leading-relaxed">从工作台发起任务，完成后的完整素材包会自动保存到这里。</p>
              <div
                className="bg-primary rounded-xl px-6 py-3 flex items-center gap-2 shadow-card"
                onClick={() => Taro.navigateTo({url: '/pages/package-create/index?mode=material'})}
              >
                <div className="i-mdi-creation text-xl text-white" />
                <span className="text-xl font-bold text-white">立即生成</span>
              </div>
            </div>
          )}

          {!pkgLoading && packages.length > 0 && (
            <div className="flex flex-col gap-4">
              {packages.map((pkg) => {
                const platforms = pkg.package_result ? Object.keys(pkg.package_result) : []
                const mode = pkg.source_mode || pkg.package_config?.mode
                return (
                  <div
                    key={pkg.id}
                    className="bg-card border border-border shadow-card rounded-2xl overflow-hidden"
                  >
                    {/* 点击进入结果页 */}
                    <div
                      className="px-4 py-4"
                      onClick={() => Taro.navigateTo({url: `/pages/package-result/index?id=${pkg.id}`})}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{background: mode === 'direction' ? 'hsl(168 54% 42% / 0.14)' : 'hsl(var(--primary) / 0.12)'}}>
                          <div className={`${mode === 'direction' ? 'i-mdi-trending-up' : 'i-mdi-layers-triple-outline'} text-2xl`} style={{color: mode === 'direction' ? 'hsl(168 54% 34%)' : 'hsl(var(--primary))'}} />
                        </div>
                        <div className="flex-1">
                          <span className="text-2xl font-bold text-foreground leading-snug">{pkg.title}</span>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {platforms.slice(0, 4).map((p) => (
                              <span key={p} className="px-2 py-0 rounded-lg text-xl bg-secondary text-primary">{p}</span>
                            ))}
                            {platforms.length === 0 && (
                              <span className="px-2 py-0 rounded-lg text-xl bg-secondary text-muted-foreground">待解析</span>
                            )}
                          </div>
                        </div>
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{background: 'hsl(var(--secondary))'}}>
                          <div className="i-mdi-chevron-right text-2xl text-primary" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                        <span className="text-xl font-bold" style={{color: mode === 'direction' ? 'hsl(168 54% 34%)' : 'hsl(var(--muted-foreground))'}}>
                          {mode === 'direction' ? '方向热点' : '已有素材'}
                        </span>
                        <span className="text-xl text-muted-foreground">{formatRelativeTime(pkg.created_at)}</span>
                      </div>
                    </div>
                    {/* 删除按钮 */}
                    <div className="border-t border-border flex bg-muted/30">
                      <div
                        className="flex-1 flex items-center justify-center py-3 gap-1"
                        onClick={() => handleDeletePackage(pkg.id)}
                      >
                        <div className="i-mdi-trash-can-outline text-xl text-destructive" />
                        <span className="text-xl text-destructive">删除</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 素材资产库 ── */}
      {tab !== 'results' && (
        <div className="px-4 pt-4 pb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background: 'hsl(168 54% 42% / 0.14)'}}>
                <div className="i-mdi-folder-image text-xl" style={{color: 'hsl(168 54% 34%)'}} />
              </div>
              <span className="text-2xl font-bold text-foreground">{currentTabLabel}</span>
              <span className="px-2 py-0 rounded-lg bg-secondary text-xl font-bold text-primary">{visibleAssets.length}</span>
            </div>
            {canUploadInCurrentTab && <div
              className="flex items-center gap-1 rounded-xl px-3 py-2 shadow-card"
              style={{background: 'hsl(168 54% 42%)'}}
              onClick={handleUploadAsset}
            >
              {uploading ? (
                <div className="i-mdi-loading animate-spin text-xl text-white" />
              ) : (
                <div className="i-mdi-upload text-xl text-white" />
              )}
              <span className="text-xl font-bold text-white">{uploading ? '上传中' : '上传素材'}</span>
            </div>}
          </div>

          {assetLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="i-mdi-loading animate-spin text-4xl text-muted-foreground" />
            </div>
          )}

          {!assetLoading && visibleAssets.length === 0 && (
            <div className="border-2 border-dashed border-border rounded-2xl bg-card flex flex-col items-center gap-3 py-12 px-6 shadow-card">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background: 'hsl(168 54% 42% / 0.14)'}}>
                <div className="i-mdi-upload text-4xl" style={{color: 'hsl(168 54% 34%)'}} />
              </div>
              <p className="text-2xl font-bold text-foreground">还没有{currentTabLabel}</p>
              <p className="text-xl text-muted-foreground text-center leading-relaxed">{canUploadInCurrentTab ? '上传图片、视频或文档，作为生成素材包的原始素材。' : '素材包完成后会自动归档到这个栏目。'}</p>
              {canUploadInCurrentTab && (
                <div
                  className="rounded-xl px-6 py-3 flex items-center gap-2 shadow-card"
                  style={{background: 'hsl(168 54% 42%)'}}
                  onClick={handleUploadAsset}
                >
                  <div className="i-mdi-upload text-xl text-white" />
                  <span className="text-xl font-bold text-white">上传素材</span>
                </div>
              )}
            </div>
          )}

          {!assetLoading && visibleAssets.length > 0 && (
            <div className="flex flex-col gap-3">
              {visibleAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="bg-card border border-border shadow-card rounded-2xl overflow-hidden"
                >
                  <div className="px-4 py-4 flex items-center gap-3">
                    {/* 图片预览或图标 */}
                    {asset.type === 'image' && asset.content ? (
                      <Image
                        src={asset.content}
                        mode="aspectFill"
                        className="flex-shrink-0 border border-border"
                        style={{width: '56px', height: '56px', borderRadius: '12px'}}
                      />
                    ) : (
                      <div
                        className="w-14 h-14 rounded-xl flex items-center justify-center border border-border flex-shrink-0"
                        style={{background: 'hsl(var(--primary) / 0.12)'}}
                      >
                        <div className={`${FILE_TYPE_ICONS[asset.type] || 'i-mdi-file-outline'} text-2xl text-primary`} />
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="text-2xl font-bold text-foreground leading-snug">{asset.title}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-0 rounded-lg text-xl bg-secondary text-primary">{asset.type}</span>
                        <span className="text-xl text-muted-foreground">{formatRelativeTime(asset.created_at)}</span>
                      </div>
                    </div>
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-xl"
                      style={{background: 'hsl(var(--destructive) / 0.08)'}}
                      onClick={() => handleDeleteAsset(asset)}
                    >
                      <div className="i-mdi-trash-can-outline text-2xl text-destructive" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default withRouteGuard(MaterialsPage)
