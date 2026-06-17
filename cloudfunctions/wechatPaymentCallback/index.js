const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()
const API_V3_KEY = process.env.WECHAT_PAY_API_V3_KEY || ''

function now() {
  return new Date().toISOString()
}

function parseBody(event) {
  if (!event) return {}
  if (typeof event.body === 'object') return event.body
  if (typeof event.body === 'string') {
    try { return JSON.parse(event.body) } catch { return {} }
  }
  if (event.resource) return event
  return {}
}

function decryptResource(resource) {
  if (!API_V3_KEY) throw new Error('缺少 WECHAT_PAY_API_V3_KEY')
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(API_V3_KEY),
    Buffer.from(resource.nonce),
  )
  decipher.setAuthTag(Buffer.from(resource.ciphertext, 'base64').slice(-16))
  decipher.setAAD(Buffer.from(resource.associated_data || ''))
  const ciphertext = Buffer.from(resource.ciphertext, 'base64').slice(0, -16)
  const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(decoded)
}

function planEntitlements(level) {
  const map = {
    trial: {package_count: 999999, graphic_count: 999999, image_count: 999999, video_seconds: 999999},
    graphic: {package_count: 50, graphic_count: 50, image_count: 100, video_seconds: 0},
    video_starter: {package_count: 40, graphic_count: 40, image_count: 80, video_seconds: 120},
    video_pro: {package_count: 80, graphic_count: 30, image_count: 150, video_seconds: 280},
    professional: {package_count: 200, graphic_count: 60, image_count: 400, video_seconds: 800},
    enterprise: {package_count: 500, graphic_count: 100, image_count: 1000, video_seconds: 1200},
  }
  return map[level] || map.trial
}

async function findByOrderNo(collection, outTradeNo) {
  const res = await db.collection(collection).where({order_no: outTradeNo}).limit(1).get()
  return res.data[0] || null
}

async function applyPaid(transaction) {
  const outTradeNo = transaction.out_trade_no
  const transactionId = transaction.transaction_id || null
  const paidAt = transaction.success_time || now()

  const order = await findByOrderNo('orders', outTradeNo)
  if (order) {
    await db.collection('orders').doc(order._id).update({
      data: {status: 'paid', wechat_transaction_id: transactionId, paid_at: paidAt, updated_at: now()},
    })
    const expires = new Date()
    expires.setDate(expires.getDate() + 30)
    const entitlements = planEntitlements(order.plan_level)
    await db.collection('profiles').doc(order.user_id).update({
      data: {
        membership_level: order.plan_level,
        membership_expires: expires.toISOString(),
        cos_space_initialized: true,
        cos_initialized_at: now(),
        package_quota: entitlements.package_count,
        graphic_quota: entitlements.graphic_count,
        image_quota: entitlements.image_count,
        video_seconds_quota: entitlements.video_seconds,
        updated_at: now(),
      },
    })
    return true
  }

  return false
}

exports.main = async (event = {}) => {
  try {
    const body = parseBody(event)
    if (body.event_type && body.event_type !== 'TRANSACTION.SUCCESS') {
      return {code: 'SUCCESS', message: 'ignored'}
    }
    if (!body.resource) return {code: 'FAIL', message: 'missing resource'}
    const transaction = decryptResource(body.resource)
    if (transaction.trade_state !== 'SUCCESS') return {code: 'SUCCESS', message: 'not success'}
    const ok = await applyPaid(transaction)
    return ok ? {code: 'SUCCESS', message: '成功'} : {code: 'FAIL', message: 'order not found'}
  } catch (error) {
    return {code: 'FAIL', message: error.message || 'callback failed'}
  }
}
