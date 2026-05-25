import { Aes } from 'npm:wechatpay-axios-plugin@0.9.4'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ===== COS HMAC-SHA1 签名（用于初始化用户COS空间）=====
async function hmacSHA1Bytes(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const keyData = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const ck = await crypto.subtle.importKey('raw', keyData, {name: 'HMAC', hash: 'SHA-1'}, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data)))
}

async function sha1Hex(data: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function toHexStr(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

// 初始化用户COS空间：写入 users/{openid}/.meta 标记文件
async function initCosUserSpace(openid: string): Promise<void> {
  const secretId = Deno.env.get('TENCENT_SECRET_ID')
  const secretKey = Deno.env.get('TENCENT_SECRET_KEY')
  const bucket = Deno.env.get('COS_BUCKET')
  const region = Deno.env.get('COS_REGION')
  if (!secretId || !secretKey || !bucket || !region) return

  const objectKey = `users/${openid}/.meta`
  const metaContent = JSON.stringify({initialized_at: new Date().toISOString(), openid})
  const host = `${bucket}.cos.${region}.myqcloud.com`
  const path = `/${objectKey}`

  // 生成COS PUT签名
  const now = Math.floor(Date.now() / 1000)
  const endTime = now + 3600
  const keyTime = `${now};${endTime}`
  const signKey = await hmacSHA1Bytes(secretKey, keyTime)
  const contentMd5 = '' // 可省略
  const httpString = `put\n${path}\n\ncontent-type:application/json\nhost:${host}\n`
  const sha1Hash = await sha1Hex(httpString)
  const stringToSign = `sha1\n${keyTime}\n${sha1Hash}\n`
  const signature = toHexStr(await hmacSHA1Bytes(signKey, stringToSign))
  const auth = `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=content-type;host&q-url-param-list=&q-signature=${signature}`

  await fetch(`https://${host}${path}`, {
    method: 'PUT',
    headers: {
      Host: host,
      'Content-Type': 'application/json',
      Authorization: auth,
      'Content-Length': String(new TextEncoder().encode(metaContent).length)
    },
    body: metaContent
  })
  console.log(`[COS] 用户空间初始化完成: users/${openid}/`)
  void contentMd5
}

// 套餐有效期配置（天数）
const PLAN_DURATION_DAYS: Record<string, number> = {
  free: 0,
  graphic: 30,
  video_starter: 30,
  video_pro: 30,
  professional: 30,
  enterprise: 30
}

Deno.serve(async (req) => {
  try {
    const body = await req.json()
    const { resource } = body

    if (!resource) {
      return new Response('ok', { status: 200 })
    }

    const MCH_API_V3_KEY = Deno.env.get('MCH_API_V3_KEY')!
    const { associated_data, nonce, ciphertext } = resource

    const plaintext = await Aes.AesGcm.decrypt(ciphertext, MCH_API_V3_KEY, nonce, associated_data)
    const tradeData = JSON.parse(plaintext)

    if (tradeData.trade_state !== 'SUCCESS') {
      return new Response('ok', { status: 200 })
    }

    const outTradeNo = tradeData.out_trade_no
    const transactionId = tradeData.transaction_id

    // ===== 先判断是算力充值订单还是会员订单 =====

    // 1. 查 compute_recharges
    const { data: computeOrder } = await supabase
      .from('compute_recharges')
      .select('*')
      .eq('order_no', outTradeNo)
      .eq('status', 'pending')
      .maybeSingle()

    if (computeOrder) {
      // 算力充值回调处理
      const { count } = await supabase
        .from('compute_recharges')
        .update({
          status: 'paid',
          wechat_transaction_id: transactionId,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('order_no', outTradeNo)
        .eq('status', 'pending')

      if (count && count > 0) {
        // 给用户余额加算力额度
        const { data: currentProfile } = await supabase
          .from('profiles')
          .select('balance')
          .eq('id', computeOrder.user_id)
          .maybeSingle()

        const newBalance = Number(currentProfile?.balance || 0) + Number(computeOrder.compute_credits)
        await supabase
          .from('profiles')
          .update({ balance: newBalance, updated_at: new Date().toISOString() })
          .eq('id', computeOrder.user_id)

        console.log(`[算力充值] 用户 ${computeOrder.user_id} 充值 ${computeOrder.compute_credits} 算力，新余额 ${newBalance}`)
      }

      return new Response(JSON.stringify({ code: 'SUCCESS', message: '成功' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 2. 查 orders（会员套餐）
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('order_no', outTradeNo)
      .eq('status', 'pending')
      .maybeSingle()

    if (!order) {
      // 订单已处理或不存在，幂等返回
      return new Response(JSON.stringify({ code: 'SUCCESS', message: '成功' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 更新订单状态
    const { count } = await supabase
      .from('orders')
      .update({
        status: 'paid',
        wechat_transaction_id: transactionId,
        paid_at: new Date().toISOString(),
        version: order.version + 1
      })
      .eq('order_no', outTradeNo)
      .eq('version', order.version)

    if (!count || count === 0) {
      // 并发处理，幂等返回
      return new Response(JSON.stringify({ code: 'SUCCESS', message: '成功' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // 更新用户会员
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + (PLAN_DURATION_DAYS[order.plan_level] || 30))

    // 查询用户openid（用于初始化COS空间）
    const {data: profile} = await supabase
      .from('profiles')
      .select('openid, cos_space_initialized')
      .eq('id', order.user_id)
      .maybeSingle()

    await supabase
      .from('profiles')
      .update({
        membership_level: order.plan_level,
        membership_expires: expiresAt.toISOString(),
        // 套餐激活时重置本周期用量配额
        video_seconds_used: 0,
        graphic_count_used: 0,
        usage_period_start: new Date().toISOString()
      })
      .eq('id', order.user_id)

    // 付费成功后初始化COS用户空间（仅首次）
    if (profile && !profile.cos_space_initialized) {
      const cosOpenid = (profile.openid as string) || order.user_id
      try {
        await initCosUserSpace(cosOpenid)
        await supabase
          .from('profiles')
          .update({cos_space_initialized: true, cos_initialized_at: new Date().toISOString()})
          .eq('id', order.user_id)
      } catch (cosErr) {
        console.error('[COS init error]', cosErr)
        // COS初始化失败不影响支付成功流程
      }
    }

    return new Response(JSON.stringify({ code: 'SUCCESS', message: '成功' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('[wechat_payment_callback error]', err)
    return new Response(JSON.stringify({ code: 'FAIL', message: err?.message || '处理失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
