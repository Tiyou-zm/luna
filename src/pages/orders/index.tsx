import {useCallback, useEffect, useState} from 'react'
import Taro, {useDidShow} from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {getOrders} from '@/db/api'
import {withTimeout} from '@/utils/async'
import {MEMBERSHIP_LABELS, PLANS} from '@/db/types'
import type {Order} from '@/db/types'

const STATUS_LABELS: Record<string, {label: string; color: string}> = {
  pending: {label: '待支付', color: 'text-foreground bg-secondary border border-border'},
  paid: {label: '已支付', color: 'text-foreground bg-secondary'},
  completed: {label: '已完成', color: 'text-foreground bg-secondary border border-border'},
  cancelled: {label: '已取消', color: 'text-muted-foreground bg-muted'},
  refunded: {label: '已退款', color: 'text-destructive bg-destructive/10'}
}

function OrdersPage() {
  const {user, profile} = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!user) {
      setOrders([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await withTimeout(getOrders(user.id), 120000, 'orders timeout')
      setOrders(data)
    } catch (e) {
      console.error('load orders error:', e)
      setOrders([])
    } finally {
      setLoading(false)
    }
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
        <div
          className="mb-4 p-5 shadow-primary rounded-2xl relative overflow-hidden"
          style={{background: 'var(--gradient-hero)'}}
        >
          <div
            className="absolute inset-0 opacity-10"
            style={{backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 12px, rgba(255,255,255,0.3) 12px, rgba(255,255,255,0.3) 24px)'}}
          />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="i-mdi-crown-outline text-accent" style={{fontSize: '22px'}} />
              <span className="text-xl text-white/80">当前会员</span>
            </div>
            <div className="flex items-end gap-3 mb-3">
              <span className="font-bold text-white" style={{fontSize: '32px'}}>{levelLabel}</span>
              <span className="text-xl text-white/70 mb-1">
                {memberLevel === 'free' ? '永久有效' : `有效期至 ${profile?.membership_expires ? formatDate(profile.membership_expires as string) : '永久'}`}
              </span>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1 px-3 py-1 bg-white/20">
                <div className="i-mdi-layers-outline text-white" style={{fontSize: '14px'}} />
                <span className="text-xl text-white">素材包 {currentPlan.packageCount >= 999999 ? '不限量' : `${currentPlan.packageCount}次/月`}</span>
              </div>
              <div
                className="flex items-center gap-1 px-3 py-1 bg-white/30"
                onClick={() => Taro.navigateTo({url: '/pages/pricing/index'})}
              >
                <div className="i-mdi-arrow-up-circle-outline text-white" style={{fontSize: '14px'}} />
                <span className="text-xl font-bold text-white">查看会员</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <div className="i-mdi-receipt-text-outline text-primary" style={{fontSize: '24px'}} />
          <span className="text-2xl font-bold text-foreground">会员订单</span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="i-mdi-loading text-foreground animate-spin" style={{fontSize: '40px'}} />
            <p className="text-xl text-muted-foreground mt-4">加载中...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="i-mdi-receipt-text-outline text-muted-foreground" style={{fontSize: '60px'}} />
            <p className="text-2xl font-bold text-foreground">暂无会员订单</p>
            <p className="text-xl text-muted-foreground">购买会员后，订单记录将显示在这里</p>
            <button
              type="button"
              className="mt-4 px-8 py-1 bg-primary shadow-primary rounded-xl"
              onClick={() => Taro.navigateTo({url: '/pages/pricing/index'})}
            >
              <div className="py-3">
                <span className="text-xl font-bold text-white">去购买会员</span>
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
        )}
      </div>

      <div className="px-4 pb-8 flex gap-3">
        <button
          type="button"
          className="flex-1 py-1 bg-gradient-primary shadow-primary rounded-xl flex items-center justify-center gap-2 leading-none"
          onClick={() => Taro.navigateTo({url: '/pages/pricing/index'})}
        >
          <div className="i-mdi-crown-outline text-white" style={{fontSize: '18px'}} />
          <div className="py-3"><span className="text-xl font-bold text-white">查看会员</span></div>
        </button>
        <button
          type="button"
          className="flex-1 py-1 border-2 border-border flex items-center justify-center gap-2 leading-none"
          onClick={() => Taro.navigateTo({url: '/pages/usage-records/index'})}
        >
          <div className="i-mdi-chart-bar text-muted-foreground" style={{fontSize: '18px'}} />
          <div className="py-3"><span className="text-xl font-medium text-muted-foreground">生成记录</span></div>
        </button>
      </div>
    </div>
  )
}

export default withRouteGuard(OrdersPage)
