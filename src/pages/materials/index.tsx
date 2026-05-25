import {useState, useCallback, useEffect} from 'react'
import Taro, {useDidShow, useShareAppMessage, useShareTimeline} from '@tarojs/taro'
import {Image} from '@tarojs/components'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {getMaterials, getMaterialPackages, deleteMaterial} from '@/db/api'
import {selectMediaFiles, uploadToSupabase} from '@/utils/upload'
import {supabase} from '@/client/supabase'
import type {Material} from '@/db/types'

const FILE_TYPE_ICONS: Record<string, string> = {
  image: 'i-mdi-image-outline',
  video: 'i-mdi-video-outline',
  copywriting: 'i-mdi-text-long',
  script: 'i-mdi-script-text-outline',
  work: 'i-mdi-layers-outline',
}

function formatRelativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  return `${Math.floor(diff / 86400)}天前`
}

function MaterialsPage() {
  const {user} = useAuth()
  const [tab, setTab] = useState<'results' | 'assets'>('results')

  // 生成结果列表（type=work）
  const [packages, setPackages] = useState<Material[]>([])
  const [pkgLoading, setPkgLoading] = useState(false)

  // 素材资产列表（type!=work）
  const [assets, setAssets] = useState<Material[]>([])
  const [assetLoading, setAssetLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  useShareAppMessage(() => ({title: 'Luna AI — 素材资产库'}))
  useShareTimeline(() => ({title: 'Luna AI — 素材资产库'}))

  const loadPackages = useCallback(async () => {
    if (!user) return
    setPkgLoading(true)
    const data = await getMaterialPackages(user.id, 30)
    setPackages(data)
    setPkgLoading(false)
  }, [user])

  const loadAssets = useCallback(async () => {
    if (!user) return
    setAssetLoading(true)
    const data = await getMaterials(user.id, 30)
    setAssets(data.filter((m) => m.type !== 'work'))
    setAssetLoading(false)
  }, [user])

  useEffect(() => {
    loadPackages()
    loadAssets()
  }, [loadPackages, loadAssets])

  useDidShow(() => {
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
        const res = await uploadToSupabase(file, {bucket: 'chat-attachments', userId: user.id})
        if (res.success && res.data) {
          const {data: urlData} = supabase.storage.from('chat-attachments').getPublicUrl(res.data.path)
          const ext = (file.name || '').split('.').pop()?.toLowerCase() || ''
          const mtype = ['mp4', 'mov', 'avi', 'mkv'].includes(ext) ? 'video' : 'image'
          const {error} = await supabase.from('materials').insert({
            user_id: user.id,
            type: mtype,
            title: file.name || `素材_${Date.now()}`,
            content: urlData.publicUrl,
          })
          if (!error) successCount++
        }
      }
      Taro.showToast({title: `已上传 ${successCount} 个素材`, icon: 'success'})
      loadAssets()
    } catch {
      Taro.showToast({title: '上传失败，请重试', icon: 'none'})
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteAsset = (id: string) => {
    Taro.showModal({
      title: '删除确认',
      content: '确定删除这个素材吗？',
      confirmText: '删除',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          const ok = await deleteMaterial(id)
          if (ok) {
            setAssets((prev) => prev.filter((a) => a.id !== id))
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

  return (
    <div className="min-h-screen bg-background">
      {/* 顶部 Tab */}
      <div className="flex border-b border-border bg-card sticky top-0 z-10">
        {([['results', '生成结果库'], ['assets', '素材资产库']] as const).map(([key, label]) => (
          <div
            key={key}
            className="flex-1 flex items-center justify-center py-4"
            style={{
              background: tab === key ? 'hsl(var(--primary))' : 'hsl(var(--card))',
              borderRight: key === 'results' ? '1px solid hsl(var(--border))' : undefined,
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

      {/* ── 生成结果库 ── */}
      {tab === 'results' && (
        <div className="px-4 pt-5 pb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
              <span className="text-2xl font-bold text-foreground">素材包记录</span>
              <span className="px-2 py-0 border border-border text-xl font-bold text-foreground">{packages.length}</span>
            </div>
            <div
              className="flex items-center gap-1 border border-border rounded-lg px-3 py-2 bg-accent shadow-card"
              onClick={() => Taro.navigateTo({url: '/pages/package-create/index?mode=material'})}
            >
              <div className="i-mdi-plus text-xl text-white" />
              <span className="text-xl font-bold text-white">新建</span>
            </div>
          </div>

          {pkgLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="i-mdi-loading animate-spin text-4xl text-muted-foreground" />
            </div>
          )}

          {!pkgLoading && packages.length === 0 && (
            <div className="border-2 border-dashed border-border rounded-xl flex flex-col items-center gap-3 py-10">
              <div className="i-mdi-package-variant-closed text-5xl text-muted-foreground" />
              <p className="text-xl text-muted-foreground">还没有生成记录</p>
              <div
                className="bg-primary rounded-xl px-6 py-3 flex items-center gap-2"
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
                    className="bg-card border border-border shadow-card rounded-xl overflow-hidden"
                  >
                    {/* 点击进入结果页 */}
                    <div
                      className="px-4 py-4"
                      onClick={() => Taro.navigateTo({url: `/pages/package-result/index?id=${pkg.id}`})}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <span className="text-2xl font-bold text-foreground">{pkg.title}</span>
                          <div className="flex items-center gap-2 mt-2">
                            {platforms.slice(0, 4).map((p) => (
                              <span key={p} className="px-2 py-0 text-xl border border-border text-muted-foreground">{p}</span>
                            ))}
                          </div>
                        </div>
                        <div className="i-mdi-chevron-right text-2xl text-muted-foreground flex-shrink-0" />
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                        <span className="text-xl" style={{color: mode === 'direction' ? 'hsl(var(--accent))' : 'hsl(var(--muted-foreground))'}}>
                          {mode === 'direction' ? '方向热点' : '已有素材'}
                        </span>
                        <span className="text-xl text-muted-foreground">{formatRelativeTime(pkg.created_at)}</span>
                      </div>
                    </div>
                    {/* 删除按钮 */}
                    <div className="border-t-2 border-border flex">
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
      {tab === 'assets' && (
        <div className="px-4 pt-5 pb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-1 h-5" style={{background: 'hsl(var(--accent))'}} />
              <span className="text-2xl font-bold text-foreground">上传的素材</span>
              <span className="px-2 py-0 border border-border text-xl font-bold text-foreground">{assets.length}</span>
            </div>
            <div
              className="flex items-center gap-1 border border-border rounded-lg px-3 py-2 bg-accent shadow-card"
              onClick={handleUploadAsset}
            >
              {uploading ? (
                <div className="i-mdi-loading animate-spin text-xl text-white" />
              ) : (
                <div className="i-mdi-upload text-xl text-white" />
              )}
              <span className="text-xl font-bold text-white">{uploading ? '上传中' : '上传素材'}</span>
            </div>
          </div>

          {assetLoading && (
            <div className="flex items-center justify-center py-12">
              <div className="i-mdi-loading animate-spin text-4xl text-muted-foreground" />
            </div>
          )}

          {!assetLoading && assets.length === 0 && (
            <div className="border-2 border-dashed border-border rounded-xl flex flex-col items-center gap-3 py-10">
              <div className="i-mdi-upload text-5xl text-muted-foreground" />
              <p className="text-xl text-muted-foreground">还没有上传的素材</p>
              <p className="text-xl text-muted-foreground text-center">上传图片、视频，作为生成素材包的原始素材</p>
            </div>
          )}

          {!assetLoading && assets.length > 0 && (
            <div className="flex flex-col gap-3">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="bg-card border border-border shadow-card rounded-xl overflow-hidden"
                >
                  <div className="px-4 py-4 flex items-center gap-3">
                    {/* 图片预览或图标 */}
                    {asset.type === 'image' && asset.content ? (
                      <Image
                        src={asset.content}
                        mode="aspectFill"
                        className="flex-shrink-0 border border-border"
                        style={{width: '48px', height: '48px', borderRadius: 0}}
                      />
                    ) : (
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center border border-border flex-shrink-0"
                        style={{background: 'hsl(var(--primary))'}}
                      >
                        <div className={`${FILE_TYPE_ICONS[asset.type] || 'i-mdi-file-outline'} text-2xl text-white`} />
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="text-xl font-bold text-foreground">{asset.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0 text-xl border border-border text-muted-foreground">{asset.type}</span>
                        <span className="text-xl text-muted-foreground">{formatRelativeTime(asset.created_at)}</span>
                      </div>
                    </div>
                    <div
                      className="flex items-center justify-center w-10 h-10"
                      onClick={() => handleDeleteAsset(asset.id)}
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
