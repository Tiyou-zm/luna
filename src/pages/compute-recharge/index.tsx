import {useState, useEffect, useCallback} from 'react'
import Taro from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {supabase} from '@/client/supabase'

interface ModelInfo {
  id: string
  name: string
  inputPrice: number
  outputPrice: number
  desc: string
  inApiList: boolean
}

interface RechargePlan {
  amount: number
  credits: number
  bonus: string
  popular: boolean
}

interface PricingData {
  models: ModelInfo[]
  rechargePlans: RechargePlan[]
  computeRate: string
  lastUpdated: string
  dataSource: string
}

function ComputeRechargePage() {
  const {user, profile, refreshProfile} = useAuth()
  const [pricingData, setPricingData] = useState<PricingData | null>(null)
  const [pricingLoading, setPricingLoading] = useState(true)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState('')
  const [activeTab, setActiveTab] = useState<'recharge' | 'models'>('recharge')
  const [paying, setPaying] = useState(false)

  const loadPricing = useCallback(async () => {
    setPricingLoading(true)
    try {
      const {data, error} = await supabase.functions.invoke('ark_model_pricing')
      if (!error && data) {
        setPricingData(data as PricingData)
      }
    } catch (e) {
      console.error('load pricing error:', e)
    } finally {
      setPricingLoading(false)
    }
  }, [])

  useEffect(() => { loadPricing() }, [loadPricing])

  const finalAmount = selectedAmount !== null ? selectedAmount : (parseFloat(customAmount) || 0)

  const handleRecharge = async () => {
    if (finalAmount <= 0) {
      Taro.showToast({title: '请选择或输入充值金额', icon: 'none'})
      return
    }
    if (finalAmount < 50) {
      Taro.showToast({title: '最低充值金额为¥50', icon: 'none'})
      return
    }
    const isWeapp = Taro.getEnv() === Taro.ENV_TYPE.WEAPP
    if (!isWeapp) {
      Taro.showToast({title: '支付功能仅在微信小程序中可用', icon: 'none', duration: 3000})
      return
    }

    setPaying(true)
    try {
      // 1. 找到当前选中套餐对应的算力额度
      const selectedPlan = pricingData?.rechargePlans.find(p => p.amount === finalAmount)
      const credits = selectedPlan?.credits || Math.round(finalAmount * 1.3)
      const planLabel = selectedPlan ? `¥${finalAmount}（赠${selectedPlan.bonus}）` : `¥${finalAmount}`

      // 2. 获取 openid（优先用 profile 缓存，否则重新 login 获取）
      let openid = profile?.openid as string | null
      if (!openid) {
        try {
          const loginResult = await Taro.login()
          const {data: openidData} = await supabase.functions.invoke('get_wechat_openid', {
            body: {code: loginResult.code}
          })
          openid = openidData?.openid || null
        } catch {
          openid = null
        }
      }
      if (!openid) {
        Taro.showToast({title: '获取用户信息失败，请重新登录', icon: 'none'})
        setPaying(false)
        return
      }

      const {data, error} = await supabase.functions.invoke('create_wechat_payment', {
        body: {
          openid,
          planName: planLabel,
          amount: finalAmount,
          type: 'compute',
          computeCredits: credits
        }
      })

      if (error || !data?.success) {
        const msg = data?.error || '创建订单失败，请重试'
        Taro.showToast({title: msg, icon: 'none', duration: 3000})
        setPaying(false)
        return
      }

      const {orderNo, paymentParams} = data

      // 3. 拉起微信收银台
      await Taro.requestPayment({
        timeStamp: paymentParams.timeStamp,
        nonceStr: paymentParams.nonceStr,
        package: paymentParams.package,
        signType: 'RSA',
        paySign: paymentParams.paySign
      })

      // 4. 轮询 compute_recharges 确认支付结果（最多60秒）
      Taro.showToast({title: '支付确认中...', icon: 'loading', duration: 10000})
      let attempts = 0
      const maxAttempts = 30
      const poll = async () => {
        attempts++
        const {data: rechargeRow} = await supabase
          .from('compute_recharges')
          .select('status, compute_credits')
          .eq('order_no', orderNo)
          .maybeSingle()

        if (rechargeRow?.status === 'paid') {
          Taro.hideToast()
          await refreshProfile()
          Taro.showToast({title: `充值成功！+${rechargeRow.compute_credits} 算力`, icon: 'success', duration: 3000})
          setPaying(false)
        } else if (attempts < maxAttempts) {
          setTimeout(poll, 2000)
        } else {
          Taro.hideToast()
          Taro.showToast({title: '支付结果确认中，请稍后查看余额', icon: 'none', duration: 3000})
          setPaying(false)
        }
      }
      setTimeout(poll, 2000)

    } catch (e: any) {
      // 用户主动取消支付
      if (e?.errMsg?.includes('cancel')) {
        Taro.showToast({title: '已取消支付', icon: 'none'})
      } else {
        console.error('recharge error:', e)
        Taro.showToast({title: '支付出错，请重试', icon: 'none'})
      }
      setPaying(false)
    }
  }

  const getModelDisplayName = (modelId: string) => {
    const parts = modelId.split('-')
    if (modelId.startsWith('doubao')) {
      const version = parts.filter(p => p !== 'doubao').join('-')
      return `豆包 ${version.replace('1-5', '1.5')}`
    }
    return modelId
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Banner */}
      <div className="px-5 pt-8 pb-6 bg-gradient-hero relative overflow-hidden">
        {/* 返回按钮 */}
        <button
          type="button"
          onClick={() => Taro.navigateBack()}
          className="flex items-center gap-1 mb-4 leading-none"
        >
          <div className="i-mdi-chevron-left text-white" style={{fontSize: '26px'}} />
          <span className="text-xl text-white/90">返回</span>
        </button>

        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="i-mdi-lightning-bolt text-white/80" style={{fontSize: '26px'}} />
              <h1 className="text-3xl font-bold text-white">算力充值</h1>
            </div>
            <p className="text-xl text-white/80">充值算力，解锁更多AI生成能力</p>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xl text-white/70 mb-1">当前余额</span>
            <span className="text-3xl font-bold text-white">
              ¥{((profile?.balance as number) || 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* 算力换算说明 */}
        {pricingData && (
          <div className="mt-4 px-3 py-2 bg-white/10 rounded-xl border border-white/20">
            <span className="text-xl text-white/90">{pricingData.computeRate}</span>
          </div>
        )}
      </div>

      {/* Tab切换 */}
      <div className="px-4 pt-4">
        <div className="flex bg-muted p-1 mb-4">
          {[
            {key: 'recharge' as const, label: '充值算力', icon: 'i-mdi-lightning-bolt'},
            {key: 'models' as const, label: '模型价格参考', icon: 'i-mdi-chart-bar'}
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`flex-1 py-1 flex items-center justify-center gap-2 leading-none transition ${activeTab === tab.key ? 'bg-card shadow-card rounded-lg text-foreground' : 'text-muted-foreground'}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <div className={tab.icon} style={{fontSize: '16px'}} />
              <div className="py-2">
                <span className="text-xl font-medium">{tab.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ===充值面板=== */}
      {activeTab === 'recharge' && (
        <div className="px-4 pb-8">
          {pricingLoading ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="i-mdi-loading text-primary animate-spin" style={{fontSize: '40px'}} />
              <p className="text-xl text-muted-foreground mt-3">正在获取最新价格...</p>
            </div>
          ) : (
            <>
              {/* 充值档位 */}
              <p className="text-2xl font-bold text-foreground mb-3">选择充值档位</p>
              <div className="grid gap-3 mb-4" style={{gridTemplateColumns: 'repeat(2, 1fr)'}}>
                {(pricingData?.rechargePlans || []).map((plan) => (
                  <div
                    key={plan.amount}
                    className={`relative p-4 border-2 transition rounded-xl ${selectedAmount === plan.amount ? 'border-primary bg-accent/20' : 'border-border bg-card'}`}
                    onClick={() => { setSelectedAmount(plan.amount); setCustomAmount('') }}
                  >
                    {plan.popular && (
                      <div
                        className="absolute -top-3 left-1/2 px-3 py-1 bg-primary text-white text-xl font-bold rounded-md"
                        style={{transform: 'translateX(-50%)'}}
                      >
                        热门
                      </div>
                    )}
                    <p className="text-3xl font-bold text-foreground mb-1">¥{plan.amount}</p>
                    <p className="text-xl text-foreground mb-1">{plan.credits} 算力积分</p>
                    <div className="flex items-center gap-1 px-2 py-0.5 bg-secondary w-fit">
                      <div className="i-mdi-gift-outline text-foreground" style={{fontSize: '12px'}} />
                      <span className="text-xl text-foreground font-medium">{plan.bonus}</span>
                    </div>
                    {selectedAmount === plan.amount && (
                      <div className="absolute top-2 right-2">
                        <div className="i-mdi-check-circle text-foreground" style={{fontSize: '20px'}} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* 自定义金额 */}
              <p className="text-2xl font-bold text-foreground mb-2">自定义金额（最低¥50）</p>
              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1 flex items-center gap-2 border border-border px-4 py-3 bg-background rounded-xl overflow-hidden">
                  <span className="text-2xl font-bold text-muted-foreground">¥</span>
                  <input
                    className="flex-1 text-2xl text-foreground bg-transparent outline-none"
                    placeholder="输入金额"
                    value={customAmount}
                    onInput={(e) => {
                      const ev = e as any
                      const val = ev.detail?.value ?? ev.target?.value ?? ''
                      setCustomAmount(val)
                      setSelectedAmount(null)
                    }}
                  />
                </div>
              </div>

              {/* 确认信息 */}
              {finalAmount > 0 && (
                <div className="bg-secondary border border-border p-4 mb-4 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xl text-foreground">充值金额</span>
                    <span className="text-2xl font-bold text-foreground">¥{finalAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xl text-foreground">获得算力积分</span>
                    <span className="text-2xl font-bold text-foreground">
                      {pricingData?.rechargePlans?.find(p => p.amount === finalAmount)?.credits ?? Math.floor(finalAmount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-muted-foreground">数据来源</span>
                    <span className="text-xl text-muted-foreground">
                      {pricingData ? `${pricingData.dataSource} · 实时更新` : '参考数据'}
                    </span>
                  </div>
                </div>
              )}

              {/* 充值按钮 */}
              <button
                type="button"
                className={`w-full py-1 flex items-center justify-center gap-2 leading-none shadow-primary transition ${paying || finalAmount <= 0 ? 'bg-secondary' : 'bg-gradient-primary'}`}
                onClick={handleRecharge}
              >
                <div className="i-mdi-lightning-bolt text-white" style={{fontSize: '22px'}} />
                <div className="py-4">
                  <span className="text-2xl font-bold text-white">
                    {paying ? '处理中...' : finalAmount > 0 ? `立即充值 ¥${finalAmount.toFixed(2)}` : '请选择充值金额'}
                  </span>
                </div>
              </button>

              <p className="text-center text-xl text-muted-foreground mt-3">
                充值即视为同意 Luna AI 《算力充值服务条款》
              </p>
            </>
          )}
        </div>
      )}

      {/* ===模型价格参考=== */}
      {activeTab === 'models' && (
        <div className="px-4 pb-8">
          {pricingLoading ? (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="i-mdi-loading text-primary animate-spin" style={{fontSize: '40px'}} />
              <p className="text-xl text-muted-foreground mt-3">正在获取模型价格...</p>
            </div>
          ) : (
            <>
              <div className="bg-secondary p-4 mb-4 rounded-xl">
                <div className="flex items-center gap-2 mb-1">
                  <div className="i-mdi-information-outline text-primary" style={{fontSize: '18px'}} />
                  <span className="text-xl font-bold text-foreground">价格单位：元 / 百万Tokens</span>
                </div>
                <p className="text-xl text-muted-foreground">
                  数据来源：{pricingData?.dataSource || '参考数据'}
                  {pricingData?.lastUpdated && (
                    <span> · 更新于 {new Date(pricingData.lastUpdated).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}</span>
                  )}
                </p>
              </div>

              {/* 表头 */}
              <div className="bg-primary overflow-hidden shadow-primary rounded-t-xl mb-0">
                <div className="flex items-center px-4 py-3">
                  <div className="flex-1">
                    <span className="text-xl font-bold text-white">模型</span>
                  </div>
                  <div className="w-24 text-center">
                    <span className="text-xl font-bold text-white">输入价格</span>
                  </div>
                  <div className="w-24 text-center">
                    <span className="text-xl font-bold text-white">输出价格</span>
                  </div>
                </div>
              </div>

              <div className="bg-card shadow-card border border-border rounded-b-xl overflow-hidden">
                {(pricingData?.models || []).map((model, idx, arr) => (
                  <div
                    key={model.id}
                    className={`px-4 py-4 ${idx < arr.length - 1 ? 'border-b border-border' : ''}`}
                  >
                    <div className="flex items-start">
                      <div className="flex-1 pr-2">
                        <p className="text-xl font-bold text-foreground">{getModelDisplayName(model.id)}</p>
                        {model.desc && (
                          <p className="text-xl text-muted-foreground mt-1">{model.desc}</p>
                        )}
                        {model.inApiList && (
                          <div className="mt-1 flex items-center gap-1">
                            <div className="w-2 h-2 bg-green-500" />
                            <span className="text-xl text-foreground">API可用</span>
                          </div>
                        )}
                      </div>
                      <div className="w-24 text-center flex-shrink-0">
                        <span className="text-xl font-bold text-foreground">
                          {model.inputPrice > 0 ? `¥${model.inputPrice}` : '-'}
                        </span>
                      </div>
                      <div className="w-24 text-center flex-shrink-0">
                        <span className="text-xl font-bold text-foreground">
                          {model.outputPrice > 0 ? `¥${model.outputPrice}` : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  className="w-full py-1 border-2 border-border bg-card flex items-center justify-center gap-2 leading-none"
                  onClick={loadPricing}
                >
                  <div className="i-mdi-refresh text-foreground" style={{fontSize: '18px'}} />
                  <div className="py-3">
                    <span className="text-xl text-foreground font-medium">刷新价格</span>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default withRouteGuard(ComputeRechargePage)
