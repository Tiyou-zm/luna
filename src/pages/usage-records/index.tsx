import {useState, useCallback, useEffect} from 'react'
import Taro from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {getUserUsageRecords} from '@/db/api'
import {withTimeout} from '@/utils/async'
import type {UsageRecord} from '@/db/types'

// 类型标签与颜色
const TYPE_CONFIG: Record<string, {label: string; color: string; icon: string}> = {
  video: {label: '视频脚本生成', color: 'text-foreground bg-secondary border border-border', icon: 'i-mdi-video-outline'},
  image: {label: '图片生成', color: 'text-foreground bg-secondary border border-border', icon: 'i-mdi-image-outline'},
  audio: {label: '语音合成', color: 'text-foreground bg-secondary border border-border', icon: 'i-mdi-microphone-outline'},
  text: {label: '文字对话', color: 'text-accent bg-secondary border border-border', icon: 'i-mdi-chat-outline'},
}

// 格式化余额（元）
function fmtMoney(val: number | null | undefined) {
  if (val == null) return '--'
  return `¥${Number(val).toFixed(2)}`
}

// 格式化时间
function fmtTime(iso: string) {
  const d = new Date(iso)
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const ho = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${mo}-${da} ${ho}:${mi}`
}

// 格式化数量
function fmtQuantity(record: UsageRecord) {
  if (record.type === 'video') return `${record.quantity}次`
  if (record.type === 'image') return `${record.quantity}张`
  if (record.type === 'audio') return `${record.quantity}秒`
  return `${record.quantity}次`
}

const PAGE_SIZE = 20

function UsageRecordsPage() {
  const {user} = useAuth()
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(0)

  const loadFirst = useCallback(async () => {
    if (!user) {
      setRecords([])
      setOffset(0)
      setHasMore(false)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await withTimeout(getUserUsageRecords(user.id, PAGE_SIZE, 0), 120000, 'usage records timeout')
      setRecords(data)
      setOffset(data.length)
      setHasMore(data.length === PAGE_SIZE)
    } catch (e) {
      console.error('load usage records error:', e)
      setRecords([])
      setOffset(0)
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [user])

  const loadMore = async () => {
    if (!user || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const data = await withTimeout(getUserUsageRecords(user.id, PAGE_SIZE, offset), 120000, 'more usage records timeout')
      setRecords((prev) => [...prev, ...data])
      setOffset((prev) => prev + data.length)
      setHasMore(data.length === PAGE_SIZE)
    } catch (e) {
      console.error('load more usage records error:', e)
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    loadFirst()
  }, [loadFirst])

  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Hero */}
      <div className="bg-gradient-hero px-5 pt-5 pb-6">
        <button
          type="button"
          onClick={() => Taro.navigateBack()}
          className="flex items-center gap-1 mb-3 leading-none"
        >
          <div className="i-mdi-chevron-left text-white" style={{fontSize: '26px'}} />
          <span className="text-xl text-white/90">返回</span>
        </button>
        <p className="text-3xl font-bold text-white">生成记录</p>
        <p className="text-xl text-white/70 mt-1">每次素材生成与使用明细</p>
      </div>

      {/* 内容区 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center pt-20 gap-3">
          <div className="i-mdi-loading animate-spin text-primary" style={{fontSize: '40px'}} />
          <p className="text-xl text-muted-foreground">加载中...</p>
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center pt-24 gap-3">
          <div className="i-mdi-receipt-text-outline text-muted-foreground" style={{fontSize: '56px'}} />
          <p className="text-2xl font-medium text-foreground">暂无生成记录</p>
          <p className="text-xl text-muted-foreground">开始生成素材包后将在此展示</p>
        </div>
      ) : (
        <div className="px-4 mt-4 flex flex-col gap-3">
          {records.map((record) => {
            const cfg = TYPE_CONFIG[record.type] || TYPE_CONFIG.text
            return (
              <div key={record.id} className="bg-card border border-border rounded-xl px-5 py-4">
                {/* 顶部：类型标签 + 时间 */}
                <div className="flex flex-row items-center justify-between mb-3">
                  <div className={`flex items-center gap-2 px-3 py-1 ${cfg.color}`}>
                    <div className={`${cfg.icon}`} style={{fontSize: '18px'}} />
                    <span className="text-xl font-bold">{cfg.label}</span>
                  </div>
                  <span className="text-xl text-muted-foreground">{fmtTime(record.created_at)}</span>
                </div>

                {/* 模型 + 数量 */}
                <div className="flex flex-row gap-3 mb-3">
                  <div className="flex-1 bg-accent/40 px-4 py-3 rounded-lg flex flex-col gap-1">
                    <span className="text-xl text-muted-foreground">模型</span>
                    <span className="text-xl font-medium text-foreground truncate">{record.model || '默认模型'}</span>
                  </div>
                  <div className="flex-1 bg-accent/40 px-4 py-3 rounded-lg flex flex-col gap-1">
                    <span className="text-xl text-muted-foreground">用量</span>
                    <span className="text-xl font-medium text-foreground">{fmtQuantity(record)}</span>
                  </div>
                </div>

                {/* 扣费 + 余额变化 */}
                <div className="flex flex-row items-center justify-between border-t border-border pt-3">
                  <div className="flex flex-row items-center gap-2">
                    {record.from_plan ? (
                      <span className="text-xl px-2 py-0.5 bg-green-50 text-foreground font-medium">套餐配额</span>
                    ) : record.amount_deducted === 0 ? (
                      <span className="text-xl px-2 py-0.5 bg-secondary text-destructive font-medium">欠账未扣</span>
                    ) : (
                      <span className="text-xl font-bold text-destructive">
                        -{fmtMoney(record.amount_deducted)}
                      </span>
                    )}
                    {!record.from_plan && record.amount_deducted > 0 && (
                      <span className="text-xl px-2 py-0.5 bg-secondary border border-border text-foreground">会员外生成</span>
                    )}
                  </div>
                  {record.balance_before != null && record.balance_after != null && (
                    <div className="flex flex-row items-center gap-1">
                      <span className="text-xl text-muted-foreground">{fmtMoney(record.balance_before)}</span>
                      <div className="i-mdi-arrow-right text-muted-foreground" style={{fontSize: '16px'}} />
                      <span className="text-xl font-medium text-foreground">{fmtMoney(record.balance_after)}</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* 加载更多 */}
          {hasMore && (
            <button
              type="button"
              className="flex items-center justify-center leading-none py-1 border-2 border-border"
              onClick={loadMore}
            >
              <div className="py-4 flex items-center gap-2">
                {loadingMore ? (
                  <div className="i-mdi-loading animate-spin text-muted-foreground" style={{fontSize: '20px'}} />
                ) : (
                  <div className="i-mdi-chevron-down text-muted-foreground" style={{fontSize: '20px'}} />
                )}
                <span className="text-xl text-muted-foreground">{loadingMore ? '加载中...' : '加载更多'}</span>
              </div>
            </button>
          )}

          {!hasMore && records.length > 0 && (
            <p className="text-xl text-muted-foreground text-center py-4">已显示全部记录</p>
          )}

          {/* 底部快捷导航 */}
          {records.length > 0 && (
            <div className="flex gap-3 mt-2">
              <button
                type="button"
                className="flex-1 py-1 border-2 border-border flex items-center justify-center gap-2 leading-none"
                onClick={() => Taro.navigateTo({url: '/pages/orders/index'})}
              >
                <div className="i-mdi-receipt-text-outline text-muted-foreground" style={{fontSize: '18px'}} />
                <div className="py-3"><span className="text-xl font-medium text-muted-foreground">查看订单</span></div>
              </button>
              <button
                type="button"
                className="flex-1 py-1 border border-border flex items-center justify-center gap-2 leading-none"
                onClick={() => Taro.navigateTo({url: '/pages/pricing/index'})}
              >
                <div className="i-mdi-crown-outline text-foreground" style={{fontSize: '18px'}} />
                <div className="py-3"><span className="text-xl font-medium text-foreground">查看会员</span></div>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default withRouteGuard(UsageRecordsPage)
