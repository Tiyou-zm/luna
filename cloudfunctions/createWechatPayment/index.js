const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()
const cmd = db.command

const MCH_ID = process.env.WECHAT_MCH_ID || process.env.WECHAT_PAY_MCH_ID || ''
const CERT_SERIAL_NO = process.env.WECHAT_PAY_SERIAL_NO || process.env.WECHAT_PAY_CERT_SERIAL_NO || ''
const API_V3_KEY = process.env.WECHAT_PAY_API_V3_KEY || ''
const NOTIFY_URL = process.env.WECHAT_PAY_NOTIFY_URL || ''
const PRIVATE_KEY = normalizePrivateKey(process.env.WECHAT_PAY_PRIVATE_KEY || '')

function now() {
  return new Date().toISOString()
}

function normalizePrivateKey(value) {
  if (!value) return ''
  const trimmed = value.trim()
  if (trimmed.includes('BEGIN PRIVATE KEY')) return trimmed.replace(/\\n/g, '\n')
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim()
    if (decoded.includes('BEGIN PRIVATE KEY')) return decoded
  } catch {}
  return trimmed.replace(/\\n/g, '\n')
}

function nonce(size = 16) {
  return crypto.randomBytes(size).toString('hex')
}

function orderNo(prefix = 'LUNA') {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

function assertPayConfig() {
  const missing = []
  if (!MCH_ID) missing.push('WECHAT_MCH_ID')
  if (!CERT_SERIAL_NO) missing.push('WECHAT_PAY_SERIAL_NO')
  if (!PRIVATE_KEY) missing.push('WECHAT_PAY_PRIVATE_KEY')
  if (!API_V3_KEY) missing.push('WECHAT_PAY_API_V3_KEY')
  if (!NOTIFY_URL) missing.push('WECHAT_PAY_NOTIFY_URL')
  if (missing.length) {
    throw new Error(`微信支付缺少配置：${missing.join(', ')}`)
  }
}

function rsaSign(message) {
  return crypto.createSign('RSA-SHA256').update(message).sign(PRIVATE_KEY, 'base64')
}

function authHeader(method, pathWithQuery, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonceStr = nonce()
  const message = `${method}\n${pathWithQuery}\n${timestamp}\n${nonceStr}\n${body}\n`
  const signature = rsaSign(message)
  return {
    timestamp,
    nonceStr,
    authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${MCH_ID}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${CERT_SERIAL_NO}"`,
  }
}

function requestWechatPay(method, pathWithQuery, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : ''
    const auth = authHeader(method, pathWithQuery, body)
    const req = https.request({
      method,
      hostname: 'api.mch.weixin.qq.com',
      path: pathWithQuery,
      headers: {
        authorization: auth.authorization,
        accept: 'application/json',
        'content-type': 'application/json',
        ...(body ? {'content-length': Buffer.byteLength(body)} : {}),
      },
      timeout: 20000,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = {}
        try { data = text ? JSON.parse(text) : {} } catch { data = {raw: text} }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(data.message || data.raw || `微信支付接口错误 ${res.statusCode}`))
          return
        }
        resolve(data)
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('微信支付接口超时')))
    if (body) req.write(body)
    req.end()
  })
}

function buildPaymentParams(appid, prepayId) {
  const timeStamp = Math.floor(Date.now() / 1000).toString()
  const nonceStr = nonce()
  const pkg = `prepay_id=${prepayId}`
  const paySign = rsaSign(`${appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`)
  return {
    timeStamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign,
  }
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

async function findPaymentRow(collection, openid, outTradeNo) {
  const res = await db.collection(collection).where({order_no: outTradeNo, user_id: openid}).limit(1).get()
  return res.data[0] || null
}

async function applyPaidResult(openid, outTradeNo, transaction) {
  const transactionId = transaction.transaction_id || null
  const paidAt = now()
  const order = await findPaymentRow('orders', openid, outTradeNo)
  if (order) {
    await db.collection('orders').doc(order._id).update({
      data: {
        status: 'paid',
        wechat_transaction_id: transactionId,
        paid_at: paidAt,
        updated_at: paidAt,
      },
    })
    const expires = new Date()
    expires.setDate(expires.getDate() + 30)
    const entitlements = planEntitlements(order.plan_level)
    await db.collection('profiles').doc(openid).update({
      data: {
        membership_level: order.plan_level,
        membership_expires: expires.toISOString(),
        cos_space_initialized: true,
        cos_initialized_at: paidAt,
        package_quota: entitlements.package_count,
        graphic_quota: entitlements.graphic_count,
        image_quota: entitlements.image_count,
        video_seconds_quota: entitlements.video_seconds,
        updated_at: paidAt,
      },
    })
    return {kind: 'plan', row: {...order, status: 'paid', paid_at: paidAt, wechat_transaction_id: transactionId}}
  }

  const recharge = await findPaymentRow('compute_recharges', openid, outTradeNo)
  if (recharge) {
    await db.collection('compute_recharges').doc(recharge._id).update({
      data: {
        status: 'paid',
        wechat_transaction_id: transactionId,
        paid_at: paidAt,
        updated_at: paidAt,
      },
    })
    await db.collection('profiles').doc(openid).update({
      data: {
        balance: cmd.inc(Number(recharge.compute_credits || recharge.amount || 0)),
        updated_at: paidAt,
      },
    })
    return {kind: 'compute', row: {...recharge, status: 'paid', paid_at: paidAt, wechat_transaction_id: transactionId}}
  }

  throw new Error('未找到当前用户的支付订单')
}

async function confirmPayment(openid, appid, outTradeNo) {
  assertPayConfig()
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(MCH_ID)}`
  const transaction = await requestWechatPay('GET', path)
  if (transaction.trade_state !== 'SUCCESS') {
    return {success: false, status: transaction.trade_state || 'UNKNOWN', transaction}
  }
  const applied = await applyPaidResult(openid, outTradeNo, transaction)
  return {success: true, status: 'paid', transaction, ...applied}
}

exports.main = async (event = {}) => {
  const {OPENID, APPID} = cloud.getWXContext()
  if (!OPENID) return {ok: false, error: '未获取到微信 openid'}

  try {
    const action = event.action || 'create'
    const appid = process.env.WECHAT_APPID || APPID

    if (action === 'confirm') {
      const outTradeNo = String(event.orderNo || '').trim()
      if (!outTradeNo) return {ok: false, error: '缺少 orderNo'}
      const data = await confirmPayment(OPENID, appid, outTradeNo)
      return {ok: true, data}
    }

    assertPayConfig()

    const type = event.type === 'compute' ? 'compute' : 'plan'
    const amount = Number(event.amount || 0)
    if (!appid) return {ok: false, error: '缺少小程序 APPID'}
    if (amount <= 0) return {ok: false, error: '支付金额必须大于 0'}
    if (event.openid && event.openid !== OPENID) return {ok: false, error: 'openid 与当前登录用户不一致'}

    const outTradeNo = orderNo(type === 'compute' ? 'LUNAC' : 'LUNAP')
    const total = Math.round(amount * 100)
    const description = String(event.planName || (type === 'compute' ? 'Luna 算力充值' : 'Luna 套餐购买')).slice(0, 120)
    const createdAt = now()

    if (type === 'compute') {
      const credits = Number(event.computeCredits || Math.round(amount * 1.3))
      await db.collection('compute_recharges').add({
        data: {
          user_id: OPENID,
          order_no: outTradeNo,
          amount,
          compute_credits: credits,
          status: 'pending',
          wechat_transaction_id: null,
          paid_at: null,
          created_at: createdAt,
          updated_at: createdAt,
        },
      })
    } else {
      await db.collection('orders').add({
        data: {
          user_id: OPENID,
          openid: OPENID,
          order_no: outTradeNo,
          plan_name: description,
          plan_level: event.planLevel || 'graphic',
          status: 'pending',
          amount,
          wechat_transaction_id: null,
          version: 1,
          paid_at: null,
          created_at: createdAt,
          updated_at: createdAt,
        },
      })
    }

    const transaction = await requestWechatPay('POST', '/v3/pay/transactions/jsapi', {
      appid,
      mchid: MCH_ID,
      description,
      out_trade_no: outTradeNo,
      notify_url: NOTIFY_URL,
      amount: {total, currency: 'CNY'},
      payer: {openid: OPENID},
      attach: JSON.stringify({type}),
    })

    return {
      ok: true,
      data: {
        success: true,
        orderNo: outTradeNo,
        paymentParams: buildPaymentParams(appid, transaction.prepay_id),
      },
    }
  } catch (error) {
    return {ok: true, data: {success: false, error: error.message || '创建微信支付订单失败'}}
  }
}
