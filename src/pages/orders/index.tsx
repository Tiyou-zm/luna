import {useState, useCallback, useEffect} from 'react'
import Taro, {useDidShow} from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {getOrders, getComputeRecharges} from '@/db/api'
import {MEMBERSHIP_LABELS, PLANS} from '@/db/types'
import type {Order, ComputeRecharge} from '@/db/types'

const STATUS_LABELS: Record<string, {label: string; color: string}> = {
  pending: {label: '待支付', color: 'text-foreground bg-secondary border border-border'},
  paid: {label: '已支付', color: 'text-foreground bg-secondary'},
  completed: {label: '已完成', color: 'text-foreground bg-secondary border border-border'},
  cancelled: {label: '已取消', color: 'text-muted-foreground bg-muted'},
  refunded: {label: '已退款', color: 'text-destructive bg-destructive/10'}
}

const RECHARGE_STATUS_LABELS: Record<string, {label: string; color: string}> = {
  pending: {label: '待支付', color: 'text-foreground bg-secondary border border-border'},
  paid: {label: '已到账', color: 'text-foreground bg-secondary border border-border'},
  completed: {label: '已完成', color: 'text-foreground bg-secondary border border-border'},
  failed: {label: '失败', color: 'text-destructive bg-destructive/10'}
}

type TabKey = 'plan' | 'compute'

function OrdersPage() {
  const {user, profile} = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [recharges, setRecharges] = useState<ComputeRecharge[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('plan')

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [ordersData, rechargesData] = await Promise.all([
      getOrders(user.id),
      getComputeRecharges(user.id)
    ])
    setOrders(ordersData)
    setRecharges(rechargesData)
    setLoading(false)
  }, [user])

  useEffect(() => { loadData() }, [loadData])
  useDidShow(() => { loadData() })

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    })

  const memberLevel = (profile?.membership_level as string) || 'free'
  const currentPlan = PLANS.find(p => p.id === memberLevel) || PLANS[0]
  const levelLabel = MEMBERSHIP_LABELS[memberLevel as keyof typeof MEMBERSHIP_LABELS] || '免费版'

  return (
    <div className="min-h-screen bg-background">
      <div className="px-4 pt-4 pb-8">
        {/* 当前套餐卡片 */}
        <div
          className="mb-4 p-5 shadow-primary rounded-2xl relative overflow-hidden"
          style={{background: 'var(--gradient-hero)'}}
        >
          {/* 背景装饰 */}
          <div
            className="absolute inset-0 opacity-10"
            style={{backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 12px, rgba(255,255,255,0.3) 12px, rgba(255,255,255,0.3) 24px)'}}
          />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="i-mdi-crown-outline text-accent" style={{fontSize: '22px'}} />
              <span className="text-xl text-white/80">当前套餐</span>
            </div>
            <div className="flex items-end gap-3 mb-3">
              <span className="font-bold text-white" style={{fontSize: '32px'}}>{levelLabel}</span>
              <span className="text-xl text-white/70 mb-1">
                {memberLevel === 'free' ? '永久有效' : `有效期至 ${profile?.membership_expires ? formatDate(profile.membership_expires as string) : '永久'}`}
              </span>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1 px-3 py-1 bg-white/20 ">
                <div className="i-mdi-image-text text-white" style={{fontSize: '14px'}} />
                <span className="text-xl text-white">图文 {currentPlan.graphicCount} 条/月</span>
              </div>
              {currentPlan.videoSeconds && (
                <div className="flex items-center gap-1 px-3 py-1 bg-white/20 ">
                  <div className="i-mdi-video-outline text-white" style={{fontSize: '14px'}} />
                  <span className="text-xl text-white">视频 {currentPlan.videoSeconds}秒/月</span>
                </div>
              )}
              <div
                className="flex items-center gap-1 px-3 py-1 bg-white/30 "
                onClick={() => Taro.navigateTo({url: '/pages/pricing/index'})}
              >
                <div className="i-mdi-arrow-up-circle-outline text-white" style={{fontSize: '14px'}} />
                <span className="text-xl font-bold text-white">升级套餐</span>
              </div>
            </div>
          </div>
        </div>

        {/* 余额 + 算力 信息行 */}
        <div className="flex gap-3 mb-4">
          <div className="flex-1 bg-card p-4 shadow-card border border-border rounded-xl flex flex-col gap-1">
            <span className="text-xl text-muted-foreground">创作余额</span>
            <span className="text-2xl font-bold text-foreground">¥{((profile?.balance as number) || 0).toFixed(2)}</span>
          </div>
          <div
            className="flex-1 bg-card p-4 shadow-card border border-border rounded-xl flex flex-col gap-1"
            onClick={() => Taro.navigateTo({url: '/pages/compute-recharge/index'})}
          >
            <span className="text-xl text-muted-foreground">算力充值</span>
            <div className="flex items-center gap-1">
              <span className="text-2xl font-bold text-foreground">去充值</span>
              <div className="i-mdi-chevron-right text-foreground" style={{fontSize: '16px'}} />
            </div>
          </div>
        </div>

        {/* Tab切换 */}
        <div className="flex bg-muted p-1 mb-4">
          {[
            {key: 'plan' as TabKey, label: '套餐订单', icon: 'i-mdi-receipt-text-outline'},
            {key: 'compute' as TabKey, label: '算力充值记录', icon: 'i-mdi-lightning-bolt'}
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`flex-1 py-1 flex items-center justify-center gap-2 leading-none transition ${activeTab === tab.key ? 'bg-card shadow-card text-foreground rounded-lg' : 'text-muted-foreground'}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <div className={`${tab.icon}`} style={{fontSize: '16px'}} />
              <div className="py-2">
                <span className="text-xl font-medium">{tab.label}</span>
              </div>
            </button>
          ))}
        </div>

        {/* 内容区 */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="i-mdi-loading text-foreground animate-spin" style={{fontSize: '40px'}} />
            <p className="text-xl text-muted-foreground mt-4">加载中...</p>
          </div>
        ) : activeTab === 'plan' ? (
          orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="i-mdi-receipt-text-outline text-muted-foreground" style={{fontSize: '60px'}} />
              <p className="text-2xl font-bold text-foreground">暂无套餐订单</p>
              <p className="text-xl text-muted-foreground">购买套餐后，订单记录将显示在这里</p>
              <button
                type="button"
                className="mt-4 px-8 py-1 bg-primary shadow-primary rounded-xl"
                onClick={() => Taro.navigateTo({url: '/pages/pricing/index'})}
              >
                <div className="py-3">
                  <span className="text-xl font-bold text-white">去购买套餐</span>
                </div>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {orders.map((order) => {
                const statusInfo = STATUS_LABELS[order.status] || STATUS_LABELS.pending
                return (
                  <div key={order.id} className="bg-card p-5 shadow-card border border-border rounded-xl">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-2xl font-bold text-foreground truncate">{order.plan_name}</p>
                        <p className="text-xl text-muted-foreground mt-1 truncate">订单号：{order.order_no}</p>
                      </div>
                      <div className={`px-3 py-1 border ${statusInfo.color}`}>
                        <span className="text-xl font-medium">{statusInfo.label}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <span className="text-xl text-muted-foreground">{formatDate(order.created_at)}</span>
                      <span className="text-2xl font-bold text-foreground">¥{order.amount}</span>
                    </div>
                    {order.paid_at && (
                      <p className="text-xl text-muted-foreground mt-2">支付时间：{formatDate(order.paid_at)}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : (
          recharges.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="i-mdi-lightning-bolt-circle text-muted-foreground" style={{fontSize: '60px'}} />
              <p className="text-2xl font-bold text-foreground">暂无算力充值记录</p>
              <p className="text-xl text-muted-foreground">充值算力后，记录将显示在这里</p>
              <button
                type="button"
                className="mt-4 px-8 py-1 bg-primary shadow-primary rounded-xl"
                onClick={() => Taro.navigateTo({url: '/pages/compute-recharge/index'})}
              >
                <div className="py-3">
                  <span className="text-xl font-bold text-white">去充值算力</span>
                </div>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {recharges.map((r) => {
                const statusInfo = RECHARGE_STATUS_LABELS[r.status] || RECHARGE_STATUS_LABELS.pending
                return (
                  <div key={r.id} className="bg-card p-5 shadow-card border border-border rounded-xl">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="i-mdi-lightning-bolt text-foreground" style={{fontSize: '18px'}} />
                          <p className="text-2xl font-bold text-foreground">算力充值</p>
                        </div>
                        <p className="text-xl text-muted-foreground">+{r.compute_credits} 算力积分</p>
                        <p className="text-xl text-muted-foreground mt-1 truncate">订单号：{r.order_no}</p>
                      </div>
                      <div className={`px-3 py-1 border ${statusInfo.color}`}>
                        <span className="text-xl font-medium">{statusInfo.label}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <span className="text-xl text-muted-foreground">{formatDate(r.created_at)}</span>
                      <span className="text-2xl font-bold text-foreground">¥{r.amount}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* 底部横向快捷导航 */}
      <div className="px-4 pb-8 flex gap-3">
        <button
          type="button"
          className="flex-1 py-1 bg-gradient-primary shadow-primary rounded-xl flex items-center justify-center gap-2 leading-none"
          onClick={() => Taro.navigateTo({url: '/pages/pricing/index'})}
        >
          <div className="i-mdi-crown-outline text-white" style={{fontSize: '18px'}} />
          <div className="py-3"><span className="text-xl font-bold text-white">升级套餐</span></div>
        </button>
        <button
          type="button"
          className="flex-1 py-1 border-2 border-border flex items-center justify-center gap-2 leading-none"
          onClick={() => Taro.navigateTo({url: '/pages/usage-records/index'})}
        >
          <div className="i-mdi-chart-bar text-muted-foreground" style={{fontSize: '18px'}} />
          <div className="py-3"><span className="text-xl font-medium text-muted-foreground">消耗记录</span></div>
        </button>
      </div>
    </div>
  )
}

export default withRouteGuard(OrdersPage)
