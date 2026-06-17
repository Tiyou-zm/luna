const cloud = require('wx-server-sdk')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()

function now() {
  return new Date().toISOString()
}

function dayRange(dateText) {
  const base = dateText ? new Date(`${dateText}T00:00:00+08:00`) : new Date()
  const report = new Date(base)
  const yesterday = new Date(report)
  yesterday.setDate(report.getDate() - 1)
  const start = new Date(yesterday)
  start.setHours(0, 0, 0, 0)
  const end = new Date(yesterday)
  end.setHours(23, 59, 59, 999)
  return {
    reportDate: report.toISOString().slice(0, 10),
    targetDate: yesterday.toISOString().slice(0, 10),
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function inRange(row, start, end, field = 'created_at') {
  const value = row[field] || row.created_at
  return value >= start && value <= end
}

async function list(collection, limit = 1000) {
  try {
    const res = await db.collection(collection).limit(limit).get()
    return res.data || []
  } catch {
    return []
  }
}

async function upsertByKey(collection, keyField, keyValue, data) {
  const existing = await db.collection(collection).where({[keyField]: keyValue}).limit(1).get()
  if (existing.data.length) {
    const id = existing.data[0]._id
    await db.collection(collection).doc(id).update({data: {...data, updated_at: now()}})
    return {...existing.data[0], ...data, id, _id: id}
  }
  const res = await db.collection(collection).add({data: {...data, created_at: now(), updated_at: now()}})
  return {...data, id: res._id, _id: res._id}
}

function sum(rows, selector) {
  return rows.reduce((total, row) => total + Number(selector(row) || 0), 0)
}

function roundTransfer(value) {
  if (value <= 0) return 0
  return Math.ceil(value / 100) * 100
}

exports.main = async (event = {}) => {
  const {OPENID} = cloud.getWXContext()
  if (!OPENID) return {ok: false, error: '未获取到微信 openid'}

  const profile = await db.collection('profiles').doc(OPENID).get().then((res) => res.data).catch(() => null)
  if (!profile?.is_admin && profile?.role !== 'admin') {
    return {ok: false, error: '仅管理员可以执行财务跑批'}
  }

  const {reportDate, targetDate, start, end} = dayRange(event.date)
  const [orders, usageRecords, profiles] = await Promise.all([
    list('orders'),
    list('usage_records'),
    list('profiles'),
  ])

  const paidOrders = orders.filter((row) => ['paid', 'completed'].includes(row.status))
  const yesterdayOrders = paidOrders.filter((row) => inRange(row, start, end, 'paid_at'))
  const yesterdayUsage = usageRecords.filter((row) => inRange(row, start, end))
  const last7Start = new Date(start)
  last7Start.setDate(last7Start.getDate() - 6)
  const last7Usage = usageRecords.filter((row) => row.created_at >= last7Start.toISOString() && row.created_at <= end)

  const yesterdayRecharge = sum(yesterdayOrders, (row) => row.amount)
  const yesterdayConsumption = sum(yesterdayUsage, (row) => row.amount_deducted)
  const avgDailyConsumption = sum(last7Usage, (row) => row.amount_deducted) / 7
  const predicted3day = avgDailyConsumption * 3
  const volcanoBalance = Number(process.env.VOLCANO_BALANCE || process.env.ARK_BALANCE || 0)
  const safetyThreshold = Number(process.env.FINANCE_SAFETY_THRESHOLD || 300)
  const safetyGap = Math.max(0, predicted3day + safetyThreshold - volcanoBalance)
  const suggestedTransfer = Math.max(0, safetyGap - yesterdayRecharge)

  const report = await upsertByKey('finance_reports', 'report_date', reportDate, {
    report_date: reportDate,
    target_date: targetDate,
    yesterday_recharge: Number(yesterdayRecharge.toFixed(2)),
    yesterday_consumption: Number(yesterdayConsumption.toFixed(2)),
    total_tokens_used: sum(yesterdayUsage, (row) => row.unit === 'tokens' ? row.quantity : 0),
    video_seconds_total: sum(yesterdayUsage, (row) => row.type === 'video' ? row.quantity : 0),
    graphic_count_total: sum(yesterdayUsage, (row) => row.type === 'image' ? row.quantity : 0),
    usage_deducted_total: Number(sum(yesterdayUsage, (row) => row.amount_deducted).toFixed(2)),
    volcano_balance: volcanoBalance,
    volcano_api_error: volcanoBalance ? null : '未配置 VOLCANO_BALANCE/ARK_BALANCE，暂用 0',
    predicted_3day_consumption: Number(predicted3day.toFixed(2)),
    safety_gap: Number(safetyGap.toFixed(2)),
    recommended_transfer: Number(suggestedTransfer.toFixed(2)),
    suggested_transfer_rounded: roundTransfer(suggestedTransfer),
    new_users_count: profiles.filter((row) => inRange(row, start, end)).length,
    notes: `基于 ${targetDate} 实际订单、充值和 usage_records 汇总`,
  })

  if (report.suggested_transfer_rounded > 0) {
    await upsertByKey('transfer_orders', 'report_id', report.id || report._id, {
      report_id: report.id || report._id,
      suggested_amount: report.suggested_transfer_rounded,
      actual_amount: null,
      status: 'pending',
      confirmed_at: null,
      confirmed_by: null,
      notes: '系统根据安全缺口自动生成',
    })
  }

  return {ok: true, data: {success: true, report}}
}
