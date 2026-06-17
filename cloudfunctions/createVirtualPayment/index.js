const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')

cloud.init({env: cloud.DYNAMIC_CURRENT_ENV})

const db = cloud.database()

const FUNCTION_VERSION = 'virtual-pay-20260609-1'
const WECHAT_APPID = process.env.WECHAT_APPID || ''
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || ''
const OFFER_ID = process.env.VIRTUAL_PAY_OFFER_ID || ''
const APP_KEY = process.env.VIRTUAL_PAY_APP_KEY || ''
const SANDBOX_APP_KEY = process.env.VIRTUAL_PAY_SANDBOX_APP_KEY || ''
const ENV = Number(process.env.VIRTUAL_PAY_ENV || 0)
const MODE = process.env.VIRTUAL_PAY_MODE || 'short_series_goods'
const TRIAL_PRODUCT_ID = process.env.VIRTUAL_PAY_TRIAL_PRODUCT_ID || ''
const TRIAL_PRICE_CENTS = Number(process.env.VIRTUAL_PAY_TRIAL_PRICE_CENTS || 1990)
const TRIAL_PLAN_LEVEL = process.env.VIRTUAL_PAY_TRIAL_PLAN_LEVEL || 'trial'

function now() {
  return new Date().toISOString()
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function hmacSha256Hex(key, text) {
  return crypto.createHmac('sha256', key).update(text).digest('hex')
}

function orderNo(prefix = 'LUNAV') {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}${Date.now()}${random}`.slice(0, 32)
}

function getAppKey() {
  return ENV === 1 ? SANDBOX_APP_KEY : APP_KEY
}

function missingConfig() {
  const missing = []
  if (!WECHAT_APPID) missing.push('WECHAT_APPID')
  if (!WECHAT_APP_SECRET) missing.push('WECHAT_APP_SECRET')
  if (!OFFER_ID) missing.push('VIRTUAL_PAY_OFFER_ID')
  if (!getAppKey()) missing.push(ENV === 1 ? 'VIRTUAL_PAY_SANDBOX_APP_KEY' : 'VIRTUAL_PAY_APP_KEY')
  if (!TRIAL_PRODUCT_ID) missing.push('VIRTUAL_PAY_TRIAL_PRODUCT_ID')
  if (!TRIAL_PRICE_CENTS) missing.push('VIRTUAL_PAY_TRIAL_PRICE_CENTS')
  return missing
}

function diagnose(openid) {
  return {
    version: FUNCTION_VERSION,
    hasOpenid: Boolean(openid),
    hasAppid: Boolean(WECHAT_APPID),
    hasAppSecret: Boolean(WECHAT_APP_SECRET),
    hasOfferId: Boolean(OFFER_ID),
    env: ENV,
    mode: MODE,
    hasAppKey: Boolean(APP_KEY),
    hasSandboxAppKey: Boolean(SANDBOX_APP_KEY),
    hasSelectedAppKey: Boolean(getAppKey()),
    hasTrialProductId: Boolean(TRIAL_PRODUCT_ID),
    trialPriceCents: TRIAL_PRICE_CENTS,
    missing: missingConfig(),
  }
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {timeout: 15000}, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = {}
        try { data = text ? JSON.parse(text) : {} } catch { data = {raw: text} }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(data.errmsg || data.raw || `HTTP ${res.statusCode}`))
          return
        }
        resolve(data)
      })
    }).on('error', reject)
  })
}

async function code2Session(loginCode) {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(WECHAT_APPID)}&secret=${encodeURIComponent(WECHAT_APP_SECRET)}&js_code=${encodeURIComponent(loginCode)}&grant_type=authorization_code`
  const data = await requestJson(url)
  if (data.errcode) throw new Error(`jscode2session失败：${data.errmsg || data.errcode}`)
  if (!data.session_key) throw new Error('jscode2session未返回session_key')
  return data
}

async function resolveOwnerId(event, openid) {
  const token = String(event.authToken || '').trim()
  if (!token) return openid
  const res = await db.collection('auth_sessions')
    .where({token_hash: hashToken(token), revoked_at: null})
    .limit(1)
    .get()
    .catch(() => ({data: []}))
  const session = res.data[0]
  if (!session) return openid
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) return openid
  if (session.login_openid && openid && session.login_openid !== openid) return openid
  return session.user_id || openid
}

async function ensureCollection(name) {
  try {
    await db.collection(name).limit(1).get()
  } catch (error) {
    if (!String(error?.message || error).includes('collection not exists')) throw error
    await db.createCollection(name).catch(() => null)
  }
}

function planEntitlements(level) {
  const map = {
    trial: {package_count: 999999, graphic_count: 999999, image_count: 999999, video_seconds: 999999},
  }
  return map[level] || map.trial
}

async function applyPaidResult(userId, outTradeNo) {
  const paidAt = now()
  const orderRes = await db.collection('orders').where({order_no: outTradeNo, user_id: userId}).limit(1).get()
  const order = orderRes.data[0]
  if (!order) throw new Error('未找到当前用户的虚拟支付订单')
  if (order.status === 'paid' || order.status === 'completed') return order

  await db.collection('orders').doc(order._id).update({
    data: {
      status: 'paid',
      paid_at: paidAt,
      updated_at: paidAt,
    },
  })

  const expires = new Date()
  expires.setDate(expires.getDate() + 30)
  const entitlements = planEntitlements(order.plan_level)
  await db.collection('profiles').doc(userId).update({
    data: {
      membership_level: order.plan_level || TRIAL_PLAN_LEVEL,
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

  return {...order, status: 'paid', paid_at: paidAt}
}

async function createPayment(event, openid, userId) {
  const missing = missingConfig()
  if (missing.length) throw new Error(`虚拟支付缺少配置：${missing.join(', ')}`)

  const loginCode = String(event.loginCode || '').trim()
  if (!loginCode) throw new Error('缺少 wx.login code，无法生成用户态签名')
  const session = await code2Session(loginCode)
  if (session.openid && session.openid !== openid) throw new Error('wx.login openid 与当前用户不一致')

  const productId = String(event.productId || TRIAL_PRODUCT_ID)
  const goodsPrice = Number(event.goodsPrice || TRIAL_PRICE_CENTS)
  const planLevel = String(event.planLevel || TRIAL_PLAN_LEVEL)
  const planName = String(event.planName || 'Luna 试用会员').slice(0, 80)
  const outTradeNo = orderNo()
  const attach = JSON.stringify({type: 'membership', planLevel, userId})
  const signPayload = {
    offerId: OFFER_ID,
    buyQuantity: 1,
    env: ENV,
    currencyType: 'CNY',
    productId,
    goodsPrice,
    outTradeNo,
    attach,
  }
  const signData = JSON.stringify(signPayload)
  const paySig = hmacSha256Hex(getAppKey(), `requestVirtualPayment&${signData}`)
  const signature = hmacSha256Hex(session.session_key, signData)
  const createdAt = now()

  await ensureCollection('orders')
  await db.collection('orders').add({
    data: {
      user_id: userId,
      payer_openid: openid,
      openid,
      order_no: outTradeNo,
      plan_name: planName,
      plan_level: planLevel,
      status: 'pending',
      amount: goodsPrice / 100,
      amount_cents: goodsPrice,
      payment_channel: 'wechat_virtual',
      virtual_offer_id: OFFER_ID,
      virtual_product_id: productId,
      virtual_env: ENV,
      virtual_mode: MODE,
      version: 1,
      paid_at: null,
      created_at: createdAt,
      updated_at: createdAt,
    },
  })

  return {
    success: true,
    orderNo: outTradeNo,
    paymentParams: {
      signData,
      paySig,
      signature,
      mode: MODE,
    },
  }
}

exports.main = async (event = {}) => {
  const {OPENID} = cloud.getWXContext()
  try {
    const action = event.action || 'create'
    if (action === 'diagnose' || action === 'ping') {
      return {ok: true, data: diagnose(OPENID)}
    }
    if (!OPENID) return {ok: false, error: '未获取到微信 openid，请在微信开发者工具或真机小程序环境中调用'}
    const USER_ID = await resolveOwnerId(event, OPENID)

    if (action === 'confirm') {
      const outTradeNo = String(event.orderNo || '').trim()
      if (!outTradeNo) return {ok: false, error: '缺少 orderNo'}
      const row = await applyPaidResult(USER_ID, outTradeNo)
      return {ok: true, data: {success: true, status: 'paid', row}}
    }

    const data = await createPayment(event, OPENID, USER_ID)
    return {ok: true, data}
  } catch (error) {
    return {ok: true, data: {success: false, error: error.message || '创建虚拟支付订单失败'}}
  }
}
