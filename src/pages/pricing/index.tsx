import {useState} from 'react'
import Taro from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {callCloudFunction, callDbApi} from '@/client/cloudbase'
import {ACTIVE_PLANS} from '@/db/types'
import type {PlanOption} from '@/db/types'

const PLAN_BADGES: Record<string, string> = {
  free: 'FREE',
  graphic: '图文',
  video_starter: '视频',
  video_pro: '达人',
  professional: '专业',
  enterprise: '企业'
}

function formatPlanQuota(value: number | null | undefined, unit: string) {
  if (!value || value >= 999999) return '不限量'
  return `${value}${unit}/月`
}

function canUseVirtualPayment() {
  const wxApi = typeof wx !== 'undefined' ? (wx as any) : null
  if (!wxApi?.requestVirtualPayment) return false
  if (wxApi.canIUse) return wxApi.canIUse('requestVirtualPayment')
  return true
}

function requestVirtualPayment(params: Record<string, any>) {
  const wxApi = typeof wx !== 'undefined' ? (wx as any) : null
  return new Promise<void>((resolve, reject) => {
    wxApi.requestVirtualPayment({
      ...params,
      success: () => resolve(),
      fail: (err: any) => reject(err),
    })
  })
}

function PricingPage() {
  const {user, profile, refreshProfile} = useAuth()
  const [selectedPlan, setSelectedPlan] = useState<PlanOption | null>(null)
  const [paying, setPaying] = useState(false)

  const currentLevel = (profile?.membership_level as string) || 'free'

  const handlePurchase = async () => {
    if (!selectedPlan || paying) return
    if (!user) {
      Taro.showModal({
        title: '请先登录',
        content: '开通会员需要先登录账号。',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) Taro.navigateTo({url: '/pages/login/index'})
        },
      })
      return
    }
    if (selectedPlan.id === 'free') {
      Taro.showToast({title: '当前已是免费版', icon: 'none'})
      return
    }

    const isWeapp = Taro.getEnv() === Taro.ENV_TYPE.WEAPP
    if (!isWeapp) {
      Taro.showToast({title: '非微信小程序环境无法发起支付，请在微信中使用', icon: 'none', duration: 3000})
      return
    }

    setPaying(true)
    try {
      if (!canUseVirtualPayment()) {
        Taro.showToast({title: '当前微信版本暂不支持虚拟支付，请升级微信后重试', icon: 'none', duration: 3000})
        return
      }
      const loginRes = await Taro.login()
      if (!loginRes.code) {
        Taro.showToast({title: '获取登录凭证失败，请重试', icon: 'none'})
        return
      }
      const data = await callCloudFunction<any>('createVirtualPayment', {
        planName: selectedPlan.name,
        planLevel: selectedPlan.id,
        goodsPrice: Math.round(selectedPlan.price * 100),
        loginCode: loginRes.code,
      })
      if (!data?.success) {
        Taro.showToast({title: data?.error || '创建订单失败', icon: 'none', duration: 3000})
        return
      }
      const {paymentParams, orderNo} = data
      await requestVirtualPayment({
        signData: paymentParams.signData,
        paySig: paymentParams.paySig,
        signature: paymentParams.signature,
        mode: paymentParams.mode,
      })
      Taro.showToast({title: '支付确认中...', icon: 'loading', duration: 10000})
      await callCloudFunction('createVirtualPayment', {action: 'confirm', orderNo}).catch((error) => {
        console.warn('confirm virtual plan payment failed:', error)
      })
      let attempts = 0
      const poll = async () => {
        attempts++
        const orderRow = await callDbApi<any>('getOrderStatus', {orderNo})
        if (orderRow?.status === 'paid' || orderRow?.status === 'completed') {
          Taro.hideToast(); await refreshProfile()
          Taro.showToast({title: '套餐开通成功！', icon: 'success', duration: 3000})
        } else if (attempts < 30) {
          setTimeout(poll, 2000)
        } else {
          Taro.hideToast(); await refreshProfile()
          Taro.showToast({title: '支付成功，套餐生效中，请稍后刷新', icon: 'none', duration: 3000})
        }
      }
      setTimeout(poll, 2000)
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'errMsg' in err ? String((err as any).errMsg) : (err instanceof Error ? err.message : '操作失败')
      if (message.includes('cancel') || message.includes('-2')) Taro.showToast({title: '已取消支付', icon: 'none'})
      else Taro.showToast({title: message.slice(0, 20), icon: 'none'})
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="min-h-screen bg-background pb-40">
      {/* Hero */}
      <div className="bg-gradient-hero px-5 pt-8 pb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-3xl font-bold text-white">Luna 套餐</span>
          <span className="px-2 py-0 bg-accent text-white text-xl font-bold border border-white">版本对比</span>
        </div>
        <p className="text-xl" style={{color: 'rgba(255,255,255,0.6)'}}>素材包生成 · 趋势研究 · 图片额度</p>
      </div>

      {/* 套餐卡片列表 */}
      <div className="px-4 pt-5 flex flex-col gap-4">
        {ACTIVE_PLANS.map((plan) => {
          const isSelected = selectedPlan?.id === plan.id
          const isCurrent = currentLevel === plan.id
          return (
            <div
              key={plan.id}
              className="border border-border bg-card rounded-2xl overflow-hidden"
              style={{boxShadow: isSelected ? 'var(--shadow-primary)' : 'var(--shadow-card)'}}
              onClick={() => setSelectedPlan(plan)}
            >
              {/* 套餐头部 */}
              <div
                className="flex items-center justify-between px-4 py-4 border-b-2 border-border"
                style={{background: isSelected ? 'hsl(var(--accent))' : 'hsl(var(--foreground))'}}
              >
                <div className="flex items-center gap-3">
                  <div className={`${plan.icon} text-2xl text-white`} />
                  <span className="text-2xl font-bold text-white">{plan.name}</span>
                  {isCurrent && (
                    <span className="px-2 py-0 text-xl font-bold border border-white text-white">当前版本</span>
                  )}
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-bold text-white">
                    {plan.price === 0 ? '免费' : `¥${plan.price}`}
                  </span>
                  {plan.price > 0 && <span className="text-xl text-white pb-1">/月</span>}
                </div>
              </div>

              {/* 权益列表 */}
              <div className="px-4 py-4">
                <p className="text-xl text-foreground leading-relaxed mb-3">{plan.highlight}</p>
                <div className="flex flex-col gap-2">
                  {/* 素材包次数 */}
                  <div className="flex items-center justify-between border border-border rounded-lg px-3 py-2 bg-accent/5">
                    <div className="flex items-center gap-2">
                      <div className="i-mdi-layers-outline text-xl text-foreground" />
                      <span className="text-xl text-foreground">素材包生成</span>
                    </div>
                    <span className="text-xl font-bold" style={{color: isSelected ? 'hsl(var(--accent))' : 'hsl(var(--foreground))'}}>
                      {formatPlanQuota(plan.packageCount, '次')}
                    </span>
                  </div>
                  {/* 趋势研究 */}
                  <div className="flex items-center justify-between border border-border rounded-lg px-3 py-2 bg-accent/5">
                    <div className="flex items-center gap-2">
                      <div className="i-mdi-trending-up text-xl text-foreground" />
                      <span className="text-xl text-foreground">趋势研究</span>
                    </div>
                    <span className="text-xl font-bold" style={{color: isSelected ? 'hsl(var(--accent))' : 'hsl(var(--foreground))'}}>
                      {formatPlanQuota(plan.trendCount, '次')}
                    </span>
                  </div>
                  {/* 图片额度 */}
                  <div className="flex items-center justify-between border border-border rounded-lg px-3 py-2 bg-accent/5">
                    <div className="flex items-center gap-2">
                      <div className="i-mdi-image-outline text-xl text-foreground" />
                      <span className="text-xl text-foreground">图片生成</span>
                    </div>
                    <span className="text-xl font-bold" style={{color: isSelected ? 'hsl(var(--accent))' : 'hsl(var(--foreground))'}}>
                      {formatPlanQuota(plan.imageCount, '张')}
                    </span>
                  </div>
                  {/* 视频额度（有的话显示） */}
                  {plan.videoSeconds && (
                    <div className="flex items-center justify-between border border-border rounded-lg px-3 py-2 bg-accent/5">
                      <div className="flex items-center gap-2">
                        <div className="i-mdi-video-outline text-xl text-foreground" />
                        <span className="text-xl text-foreground">视频生成</span>
                      </div>
                      <span className="text-xl font-bold" style={{color: isSelected ? 'hsl(var(--accent))' : 'hsl(var(--foreground))'}}>
                        {formatPlanQuota(plan.videoSeconds, '秒')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 选中指示 */}
              {isSelected && (
                <div className="border-t-2 border-border px-4 py-3 flex items-center gap-2" style={{background: 'hsl(var(--accent))'}}>
                  <div className="i-mdi-check-circle text-xl text-white" />
                  <span className="text-xl font-bold text-white">已选择 {plan.name}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 底部说明 */}
      <div className="px-4 pt-4">
        <div className="border border-border bg-card px-4 py-4">
          <p className="text-xl text-foreground font-bold mb-2">所有版本均包含</p>
          {['AI 多平台内容生成', '小红书 / 抖音 / 视频号 / 公众号适配', '热点方向分析（开放后）', '7×12 小时在线客服'].map((item) => (
            <div key={item} className="flex items-center gap-2 mt-1">
              <div className="i-mdi-check text-xl" style={{color: 'hsl(var(--accent))'}} />
              <span className="text-xl text-foreground">{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 固定底部购买按钮 */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t-2 border-border px-4 py-4">
        {selectedPlan && selectedPlan.id !== 'free' ? (
          <button
            type="button"
            className="w-full border border-border flex items-center justify-center leading-none text-2xl font-bold shadow-primary rounded-xl"
            style={{background: paying ? 'hsl(var(--muted))' : 'hsl(var(--accent))', color: 'white', padding: 0}}
            onClick={handlePurchase}
          >
            <div className="py-4">
              {paying ? '处理中…' : `立即购买 ${selectedPlan.name} ¥${selectedPlan.price}`}
            </div>
          </button>
        ) : (
          <button
            type="button"
            className="w-full border-2 border-border flex items-center justify-center leading-none bg-muted"
            style={{padding: 0}}
          >
            <div className="py-4">
              <span className="text-2xl text-muted-foreground">请选择套餐版本</span>
            </div>
          </button>
        )}
        <button
          type="button"
          className="w-full mt-2 flex items-center justify-center gap-1 leading-none"
          onClick={() => Taro.navigateTo({url: '/pages/orders/index'})}
        >
          <span className="text-xl text-muted-foreground">查看我的订单</span>
          <div className="i-mdi-chevron-right text-xl text-muted-foreground" />
        </button>
      </div>
    </div>
  )
}

export default withRouteGuard(PricingPage)
