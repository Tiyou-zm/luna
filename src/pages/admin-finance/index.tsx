// 管理员财务后台 - 每日自动对账与转账计算系统
import {useState, useCallback, useEffect, useMemo} from 'react'
import Taro, {useDidShow} from '@tarojs/taro'
import {withRouteGuard} from '@/components/RouteGuard'
import {useAuth} from '@/contexts/AuthContext'
import {callCloudFunction} from '@/client/cloudbase'
import {withTimeout} from '@/utils/async'
import {
  getFinanceReports,
  getLatestFinanceReport,
  getTransferOrderByReport,
  confirmTransferOrder,
  skipTransferOrder,
  getRechargeSummary,
  getUsageSummaryByDay
} from '@/db/api'
import type {FinanceReport, TransferOrder, RechargeSummary, UsageSummary} from '@/db/types'

// 金额格式化：保留2位小数
function fmtMoney(val: number | null | undefined): string {
  if (val == null) return '¥0.00'
  return `¥${Number(val).toFixed(2)}`
}

// 金额简写：整千/万
function fmtMoneyShort(val: number): string {
  if (val >= 10000) return `¥${(val / 10000).toFixed(1)}万`
  if (val >= 1000) return `¥${(val / 1000).toFixed(1)}k`
  return `¥${val.toFixed(0)}`
}

function AdminFinancePage() {
  const {user, profile, loading: authLoading} = useAuth()
  const [latestReport, setLatestReport] = useState<FinanceReport | null>(null)
  const [latestOrder, setLatestOrder] = useState<TransferOrder | null>(null)
  const [reports, setReports] = useState<FinanceReport[]>([])
  const [rechargeSummary, setRechargeSummary] = useState<RechargeSummary | null>(null)
  const [usageSummary, setUsageSummary] = useState<UsageSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [calcLoading, setCalcLoading] = useState(false)
  // 火山余额预警阈值（元）
  const VOLCANO_WARN_THRESHOLD = 500

  // 确认转账弹窗
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [confirmAmount, setConfirmAmount] = useState('')
  const [confirmNote, setConfirmNote] = useState('')
  const [confirmLoading, setConfirmLoading] = useState(false)

  // 展开历史记录
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 权限检测
  const isAdmin = useMemo(() => profile?.is_admin === true, [profile])

  const loadData = useCallback(async () => {
    if (authLoading) return
    if (!isAdmin) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [latest, allReports, recharge, usage] = await withTimeout(Promise.all([
        getLatestFinanceReport(),
        getFinanceReports(30),
        getRechargeSummary(),
        getUsageSummaryByDay(7)
      ]), 120000, 'finance data timeout')
      setLatestReport(latest)
      setReports(allReports)
      setRechargeSummary(recharge)
      setUsageSummary(usage)
      if (latest) {
        const order = await getTransferOrderByReport(latest.id)
        setLatestOrder(order)
        if (order?.suggested_amount) {
          setConfirmAmount(String(order.suggested_amount))
        }
      }
    } finally {
      setLoading(false)
    }
  }, [authLoading, isAdmin])

  useEffect(() => {loadData()}, [loadData])
  useDidShow(() => {loadData()})

  // 手动触发跑批
  const handleTriggerCalc = async () => {
    setCalcLoading(true)
    try {
      await callCloudFunction('financeDailyCalc', {})
      Taro.showToast({title: '跑批完成', icon: 'success'})
      await loadData()
    } finally {
      setCalcLoading(false)
    }
  }

  // 手动触发指定日期
  const handleTriggerDate = async (dateStr: string) => {
    setCalcLoading(true)
    try {
      await callCloudFunction('financeDailyCalc', {date: dateStr})
      Taro.showToast({title: `${dateStr} 重算完成`, icon: 'success'})
      await loadData()
    } finally {
      setCalcLoading(false)
    }
  }

  // 确认转账
  const handleConfirm = async () => {
    if (!latestOrder || !user) return
    const amt = parseFloat(confirmAmount)
    if (isNaN(amt) || amt <= 0) {
      Taro.showToast({title: '请输入正确的金额', icon: 'none'})
      return
    }
    setConfirmLoading(true)
    const ok = await confirmTransferOrder(latestOrder.id, amt, user.id, confirmNote || undefined)
    setConfirmLoading(false)
    if (ok) {
      Taro.showToast({title: '转账已记录', icon: 'success'})
      setShowConfirmModal(false)
      setConfirmNote('')
      await loadData()
    } else {
      Taro.showToast({title: '记录失败，请重试', icon: 'none'})
    }
  }

  // 跳过转账
  const handleSkip = async () => {
    if (!latestOrder) return
    Taro.showModal({
      title: '跳过今日转账',
      content: '确认本日无需转账？',
      success: async ({confirm}) => {
        if (!confirm) return
        const ok = await skipTransferOrder(latestOrder.id, '管理员标记无需转账')
        if (ok) {
          Taro.showToast({title: '已跳过', icon: 'success'})
          await loadData()
        }
      }
    })
  }

  // 非管理员提示
  if (!loading && !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-8 gap-4">
        <div className="i-mdi-shield-lock-outline text-muted-foreground" style={{fontSize: '56px'}} />
        <p className="text-2xl font-bold text-foreground">无访问权限</p>
        <p className="text-xl text-muted-foreground text-center">仅限管理员访问财务后台</p>
        <button
          type="button"
          className="mt-2 py-1 px-8 bg-primary rounded-xl flex items-center justify-center leading-none"
          onClick={() => Taro.navigateBack()}
        >
          <div className="py-3"><span className="text-xl font-bold text-white">返回</span></div>
        </button>
      </div>
    )
  }

  const report = latestReport
  const order = latestOrder
  const isPending = order?.status === 'pending'
  const isConfirmed = order?.status === 'confirmed'
  const isSkipped = order?.status === 'skipped'
  const noOrder = !order

  return (
    <div className="min-h-screen bg-background pb-8">
      {/* Hero 区 */}
      <div className="bg-gradient-hero px-5 pt-5 pb-6">
        <p className="text-xl text-white/80 mb-1">Luna 自动对账系统</p>
        <p className="text-3xl font-bold text-white">财务管理中心</p>
        {report && (
          <p className="text-xl text-white/70 mt-1">最新报告：{report.report_date}</p>
        )}
      </div>

      {/* 操作栏 */}
      <div className="px-4 -mt-3">
        <div className="bg-card shadow-card border border-border rounded-2xl p-4 flex flex-row gap-3">
          <button
            type="button"
            className={`flex-1 py-1 flex items-center justify-center leading-none gap-2 rounded-xl ${calcLoading ? 'bg-primary/40' : 'bg-gradient-primary'}`}
            onClick={handleTriggerCalc}
          >
            <div className="py-3 flex items-center gap-2">
              <div className={`i-mdi-calculator-variant text-white ${calcLoading ? 'animate-spin' : ''}`} style={{fontSize: '20px'}} />
              <span className="text-xl font-bold text-white">{calcLoading ? '计算中...' : '立即跑批'}</span>
            </div>
          </button>
          <button
            type="button"
            className="flex-1 py-1 border border-border rounded-xl flex items-center justify-center leading-none gap-2"
            onClick={() => Taro.navigateBack()}
          >
            <div className="py-3 flex items-center gap-2">
              <div className="i-mdi-arrow-left text-foreground" style={{fontSize: '20px'}} />
              <span className="text-xl font-bold text-foreground">返回</span>
            </div>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center pt-16 gap-3">
          <div className="i-mdi-loading animate-spin text-foreground" style={{fontSize: '40px'}} />
          <p className="text-xl text-muted-foreground">加载财务数据...</p>
        </div>
      ) : (
        <div className="px-4 mt-4 flex flex-col gap-4">

          {/* 火山余额预警横幅 */}
          {report && report.volcano_balance < VOLCANO_WARN_THRESHOLD && (
            <div className="bg-secondary border-2 border-destructive px-5 py-4 flex flex-row items-center gap-3">
              <div className="i-mdi-alert text-destructive flex-shrink-0" style={{fontSize: '28px'}} />
              <div className="flex flex-col gap-1">
                <span className="text-xl font-bold text-destructive">火山引擎余额预警</span>
                <span className="text-xl text-destructive">
                  当前余额 {fmtMoney(report.volcano_balance)}，低于安全阈值 {fmtMoney(VOLCANO_WARN_THRESHOLD)}，请及时充值火山账户！
                </span>
              </div>
            </div>
          )}

          {/* 会员收入总览 */}
          {rechargeSummary && (
            <div className="bg-card border border-border p-5">
              <div className="flex flex-row items-center gap-2 mb-4">
                <div className="i-mdi-cash-multiple text-foreground" style={{fontSize: '22px'}} />
                <span className="text-2xl font-bold text-foreground">会员订单收入总览</span>
              </div>
              <div className="flex flex-row gap-3">
                <div className="flex-1 bg-gradient-subtle p-4 flex flex-col gap-1">
                  <span className="text-xl text-muted-foreground">累计会员收入</span>
                  <span className="text-2xl font-bold text-foreground">{fmtMoney(rechargeSummary.total_amount)}</span>
                  <span className="text-xl text-muted-foreground">{rechargeSummary.total_count} 笔</span>
                </div>
                <div className="flex-1 bg-gradient-subtle p-4 flex flex-col gap-1">
                  <span className="text-xl text-muted-foreground">本月会员收入</span>
                  <span className="text-2xl font-bold text-foreground">{fmtMoney(rechargeSummary.this_month_amount)}</span>
                  <span className="text-xl text-muted-foreground">当月新增</span>
                </div>
              </div>
              <p className="text-xl text-muted-foreground mt-3">
                参考：会员订单收入用于评估模型成本覆盖能力
              </p>
            </div>
          )}

          {/* 近7日用量明细 */}
          {usageSummary.length > 0 && (
            <div className="bg-card border border-border p-5">
              <div className="flex flex-row items-center gap-2 mb-4">
                <div className="i-mdi-chart-bar text-foreground" style={{fontSize: '22px'}} />
                <span className="text-2xl font-bold text-foreground">近7日生成用量</span>
              </div>
              <div className="flex flex-col gap-2">
                {usageSummary.map((row) => (
                  <div key={row.date} className="flex flex-row items-center gap-2 py-2 border-b border-border">
                    <span className="text-xl text-muted-foreground w-28">{row.date.slice(5)}</span>
                    <div className="flex-1 flex flex-row gap-3">
                      <span className="text-xl text-foreground">视频 <span className="font-bold text-foreground">{row.video_seconds}s</span></span>
                      <span className="text-xl text-foreground">图片 <span className="font-bold text-foreground">{row.graphic_count}张</span></span>
                    </div>
                    <span className="text-xl font-bold text-orange-500">{fmtMoney(row.total_deducted)}</span>
                  </div>
                ))}
              </div>
              {report && (
                <div className="mt-3 flex flex-row gap-3">
                  <div className="flex-1 bg-orange-50 p-3 flex flex-col gap-1">
                    <span className="text-xl text-muted-foreground">昨日视频</span>
                    <span className="text-2xl font-bold text-orange-500">{(report.video_seconds_total || 0).toFixed(0)}秒</span>
                  </div>
                  <div className="flex-1 bg-orange-50 p-3 flex flex-col gap-1">
                    <span className="text-xl text-muted-foreground">昨日图片</span>
                    <span className="text-2xl font-bold text-orange-500">{(report.graphic_count_total || 0)}张</span>
                  </div>
                  <div className="flex-1 bg-orange-50 p-3 flex flex-col gap-1">
                    <span className="text-xl text-muted-foreground">昨日扣费</span>
                    <span className="text-2xl font-bold text-orange-500">{fmtMoney(report.usage_deducted_total || 0)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* 今日转账指令卡片（仿微信推送格式） */}
          {report ? (
            <div className="bg-card shadow-card border border-border rounded-2xl overflow-hidden">
              {/* 卡片顶部标题 */}
              <div className="bg-gradient-primary px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="i-mdi-bell-ring text-white" style={{fontSize: '20px'}} />
                  <span className="text-xl font-bold text-white">每日转账指令</span>
                </div>
                <span className="text-xl text-white/80">{report.report_date}</span>
              </div>

              {/* 状态徽标 */}
              <div className="px-5 pt-4 flex items-center gap-2">
                {isPending && <span className="px-3 py-1 bg-secondary text-foreground border border-border text-xl font-bold">待确认</span>}
                {isConfirmed && <span className="px-3 py-1 bg-primary text-white rounded-md text-xl font-bold">已转账</span>}
                {isSkipped && <span className="px-3 py-1 bg-muted text-muted-foreground border border-border text-xl font-bold">已跳过</span>}
                {noOrder && <span className="px-3 py-1 bg-secondary text-foreground border border-border text-xl font-bold">无需转账</span>}
              </div>

              {/* 昨日数据 */}
              <div className="px-5 py-3 border-b border-border">
                <p className="text-xl font-bold text-muted-foreground mb-2">昨日数据</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-foreground">用户充值</span>
                    <span className="text-xl font-bold text-foreground">{fmtMoney(report.yesterday_recharge)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-foreground">用户消耗（估算）</span>
                    <span className="text-xl font-bold text-destructive">{fmtMoney(report.yesterday_consumption)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-muted-foreground">Token 总量</span>
                    <span className="text-xl text-foreground">{report.total_tokens_used.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-foreground">新增用户</span>
                    <span className="text-xl font-bold text-foreground">{report.new_users_count} 人</span>
                  </div>
                </div>
              </div>

              {/* 火山账户状态 */}
              <div className="px-5 py-3 border-b border-border">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-xl font-bold text-muted-foreground">火山引擎账户</p>
                  {report.volcano_api_error && (
                    <span className="text-xl text-accent flex items-center gap-1">
                      <div className="i-mdi-alert-outline" style={{fontSize: '16px'}} />
                      余额查询失败
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-foreground">当前现金余额</span>
                    <span className="text-xl font-bold text-foreground">{fmtMoney(report.volcano_balance)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-foreground">未来3天预测消耗</span>
                    <span className="text-xl font-bold text-orange-500">{fmtMoney(report.predicted_3day_consumption)}</span>
                  </div>
                </div>
              </div>

              {/* 转账计算 */}
              <div className="px-5 py-3 border-b border-border">
                <p className="text-xl font-bold text-muted-foreground mb-2">转账计算</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-foreground">安全线缺口</span>
                    <span className="text-xl font-bold text-foreground">{fmtMoney(report.safety_gap)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xl text-foreground">今日到账充值</span>
                    <span className="text-xl font-bold text-foreground">- {fmtMoney(report.yesterday_recharge)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                    <span className="text-2xl font-bold text-foreground">建议转账</span>
                    <span className="text-2xl font-bold text-foreground">{fmtMoney(report.suggested_transfer_rounded)}</span>
                  </div>
                  {isConfirmed && order?.actual_amount != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xl text-foreground font-bold">实际已转</span>
                      <span className="text-xl font-bold text-foreground">{fmtMoney(order.actual_amount)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              {isPending && order && (
                <div className="px-5 py-4 flex flex-row gap-3">
                  <button
                    type="button"
                    className="flex-1 py-1 bg-gradient-primary rounded-xl flex items-center justify-center leading-none"
                    onClick={() => setShowConfirmModal(true)}
                  >
                    <div className="py-3 flex items-center gap-2">
                      <div className="i-mdi-check-circle text-white" style={{fontSize: '20px'}} />
                      <span className="text-xl font-bold text-white">确认转账</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="py-1 px-4 border-2 border-border flex items-center justify-center leading-none"
                    onClick={handleSkip}
                  >
                    <div className="py-3">
                      <span className="text-xl text-muted-foreground">跳过</span>
                    </div>
                  </button>
                </div>
              )}

              {/* 确认时间 */}
              {(isConfirmed || isSkipped) && order?.confirmed_at && (
                <div className="px-5 py-3 flex items-center gap-2">
                  <div className="i-mdi-clock-check-outline text-muted-foreground" style={{fontSize: '18px'}} />
                  <span className="text-xl text-muted-foreground">
                    {isConfirmed ? '确认时间：' : '跳过时间：'}
                    {new Date(order.confirmed_at).toLocaleString('zh-CN')}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-card shadow-card border border-border p-6 flex flex-col items-center gap-3">
              <div className="i-mdi-chart-box-outline text-muted-foreground" style={{fontSize: '48px'}} />
              <p className="text-2xl font-bold text-foreground">暂无财务报告</p>
              <p className="text-xl text-muted-foreground text-center">点击「立即跑批」生成今日财务报告</p>
            </div>
          )}

          {/* 数据概览卡片（4格） */}
          {report && (
            <div className="grid grid-cols-2 gap-3">
              {[
                {label: '昨日充值', value: fmtMoneyShort(report.yesterday_recharge), icon: 'i-mdi-cash-plus', color: 'text-foreground'},
                {label: '昨日消耗', value: fmtMoneyShort(report.yesterday_consumption), icon: 'i-mdi-fire', color: 'text-destructive'},
                {label: '火山余额', value: fmtMoneyShort(report.volcano_balance), icon: 'i-mdi-bank-outline', color: 'text-foreground'},
                {label: '建议转账', value: fmtMoneyShort(report.suggested_transfer_rounded), icon: 'i-mdi-bank-transfer', color: 'text-foreground'},
              ].map(item => (
                <div key={item.label} className="bg-card shadow-card border border-border p-4 flex flex-col gap-2">
                  <div className={`${item.icon} ${item.color}`} style={{fontSize: '28px'}} />
                  <p className="text-2xl font-bold text-foreground">{item.value}</p>
                  <p className="text-xl text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* 历史报表 */}
          <div className="bg-card shadow-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <p className="text-2xl font-bold text-foreground">历史报表（近30日）</p>
              <span className="text-xl text-muted-foreground">{reports.length} 条</span>
            </div>
            {reports.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-xl text-muted-foreground">暂无历史记录</p>
              </div>
            ) : (
              <div>
                {reports.map((r, idx) => (
                  <div key={r.id} className={idx < reports.length - 1 ? 'border-b border-border' : ''}>
                    {/* 列表行 */}
                    <div
                      className="px-5 py-4 flex items-center gap-3"
                      onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                    >
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xl font-bold text-foreground">{r.report_date}</span>
                          {r.id === latestReport?.id && (
                            <span className="px-2 py-0.5 bg-secondary text-foreground text-xl">最新</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xl text-foreground">+{fmtMoneyShort(r.yesterday_recharge)}</span>
                          <span className="text-xl text-destructive">-{fmtMoneyShort(r.yesterday_consumption)}</span>
                          <span className="text-xl text-foreground font-bold">→{fmtMoneyShort(r.suggested_transfer_rounded)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="p-2 bg-muted/50 flex items-center justify-center"
                          onClick={(e) => {e.stopPropagation(); handleTriggerDate(r.report_date)}}
                        >
                          <div className="i-mdi-refresh text-muted-foreground" style={{fontSize: '18px'}} />
                        </button>
                        <div
                          className={`i-mdi-chevron-down text-muted-foreground transition ${expandedId === r.id ? 'rotate-180' : ''}`}
                          style={{fontSize: '20px'}}
                        />
                      </div>
                    </div>

                    {/* 展开详情 */}
                    {expandedId === r.id && (
                      <div className="px-5 pb-4 bg-muted/20">
                        <div className="flex flex-col gap-2 pt-2">
                          {[
                            ['Token 消耗量', r.total_tokens_used.toLocaleString()],
                            ['新增用户', `${r.new_users_count} 人`],
                            ['火山余额', fmtMoney(r.volcano_balance)],
                            ['3日预测消耗', fmtMoney(r.predicted_3day_consumption)],
                            ['安全线缺口', fmtMoney(r.safety_gap)],
                            ['精确建议转账', fmtMoney(r.recommended_transfer)],
                            ['取整建议转账', fmtMoney(r.suggested_transfer_rounded)],
                            ...(r.volcano_api_error ? [['余额查询状态', `失败: ${r.volcano_api_error}`]] : [['余额查询状态', '正常']]),
                          ].map(([label, val]) => (
                            <div key={String(label)} className="flex items-center justify-between">
                              <span className="text-xl text-muted-foreground">{label}</span>
                              <span className="text-xl text-foreground font-medium">{val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 说明卡 */}
          <div className="bg-card border border-border px-5 py-4">
            <p className="text-xl font-bold text-foreground mb-2">计算说明</p>
            <div className="flex flex-col gap-2">
              {[
                '建议转账 = 3日预测消耗 - 火山余额 - 今日充值',
                '3日预测 = 昨日消耗 × 1.2 + 1.44 + 1.728（20%增长）',
                'Token 单价 ≈ ¥0.0008/千 token（Doubao Pro 估算）',
                '每日 23:00 系统自动跑批，也可手动触发',
                '火山余额查询失败时保守按 0 计算',
              ].map((tip, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="i-mdi-information-outline text-foreground mt-0.5" style={{fontSize: '18px'}} />
                  <span className="text-xl text-muted-foreground flex-1">{tip}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 确认转账弹窗 */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-end justify-center"
          style={{zIndex: 100}}
          onClick={(e) => {if (e.target === e.currentTarget) setShowConfirmModal(false)}}
        >
          <div className="bg-card rounded-t-2xl w-full px-6 py-6" style={{paddingBottom: '40px'}}>
            <p className="text-2xl font-bold text-foreground mb-1">确认转账</p>
            <p className="text-xl text-muted-foreground mb-4">建议转账：{fmtMoney(order?.suggested_amount)}</p>

            <p className="text-xl font-medium text-foreground mb-2">实际转账金额（元）</p>
            <div className="border border-border rounded-xl px-4 py-2 bg-background overflow-hidden mb-3">
              <input
                className="w-full text-2xl text-foreground bg-transparent outline-none"
                type="text"
                placeholder={`建议 ${order?.suggested_amount || 0}`}
                value={confirmAmount}
                onInput={(e) => {
                  const ev = e as any
                  setConfirmAmount(ev.detail?.value ?? ev.target?.value ?? '')
                }}
              />
            </div>

            <p className="text-xl font-medium text-foreground mb-2">备注（选填）</p>
            <div className="border border-border rounded-xl px-4 py-2 bg-background overflow-hidden mb-4">
              <input
                className="w-full text-xl text-foreground bg-transparent outline-none"
                type="text"
                placeholder="例：已转账至民生银行火山账户"
                value={confirmNote}
                onInput={(e) => {
                  const ev = e as any
                  setConfirmNote(ev.detail?.value ?? ev.target?.value ?? '')
                }}
              />
            </div>

            <div className="flex flex-row gap-3">
              <button
                type="button"
                className="flex-1 py-1 border-2 border-border flex items-center justify-center leading-none"
                onClick={() => setShowConfirmModal(false)}
              >
                <div className="py-3"><span className="text-xl text-foreground">取消</span></div>
              </button>
              <button
                type="button"
                className={`flex-1 py-1 flex items-center justify-center leading-none rounded-xl ${confirmLoading ? 'bg-primary/50' : 'bg-gradient-primary'}`}
                onClick={handleConfirm}
              >
                <div className="py-3">
                  <span className="text-xl font-bold text-white">{confirmLoading ? '记录中...' : '确认已转账'}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default withRouteGuard(AdminFinancePage)
