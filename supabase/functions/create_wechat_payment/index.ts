import Wechatpay, { Formatter, Rsa } from 'npm:wechatpay-axios-plugin@0.9.4'
import ShortUniqueId from 'npm:short-unique-id'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const generateOrderNo = () =>
  `ORD-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${new ShortUniqueId({ length: 8 }).rnd()}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: '未授权' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (!user) {
      return new Response(JSON.stringify({ success: false, error: '用户未登录' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { openid, planName, planLevel, amount, type = 'membership', computeCredits } = await req.json()
    if (!openid || !planName || !amount) {
      return new Response(JSON.stringify({ success: false, error: '参数不完整' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    if (type === 'membership' && !planLevel) {
      return new Response(JSON.stringify({ success: false, error: '套餐类型不能为空' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const MERCHANT_ID = Deno.env.get('MERCHANT_ID')!
    const MERCHANT_APP_ID = Deno.env.get('MERCHANT_APP_ID')!
    const MCH_CERT_SERIAL_NO = Deno.env.get('MCH_CERT_SERIAL_NO')!
    const MCH_PRIVATE_KEY = Deno.env.get('MCH_PRIVATE_KEY')!
    const WECHAT_PAY_PUBLIC_KEY_ID = Deno.env.get('WECHAT_PAY_PUBLIC_KEY_ID')!
    const WECHAT_PAY_PUBLIC_KEY = Deno.env.get('WECHAT_PAY_PUBLIC_KEY')!

    if (!MERCHANT_ID || !MERCHANT_APP_ID || !MCH_CERT_SERIAL_NO || !MCH_PRIVATE_KEY) {
      return new Response(JSON.stringify({
        success: false,
        error: '微信支付配置未完成，请联系管理员配置MERCHANT_ID、MERCHANT_APP_ID等支付参数'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const outTradeNo = generateOrderNo()
    const notifyUrl = `${SUPABASE_URL}/functions/v1/wechat_payment_callback`

    if (type === 'compute') {
      // 算力充值订单写入 compute_recharges
      const credits = computeCredits || Math.round(amount * 1.3) // 默认按30%赠送计算
      await supabase.from('compute_recharges').insert({
        order_no: outTradeNo,
        user_id: user.id,
        amount,
        compute_credits: credits,
        status: 'pending'
      })
    } else {
      // 会员套餐订单写入 orders
      await supabase.from('orders').insert({
        order_no: outTradeNo,
        user_id: user.id,
        openid,
        plan_name: planName,
        plan_level: planLevel,
        amount,
        status: 'pending'
      })
    }

    const wxpay = new Wechatpay({
      mchid: MERCHANT_ID,
      serial: MCH_CERT_SERIAL_NO,
      privateKey: MCH_PRIVATE_KEY,
      certs: { [WECHAT_PAY_PUBLIC_KEY_ID]: WECHAT_PAY_PUBLIC_KEY },
    })

    const description = type === 'compute'
      ? `Luna AI 算力充值 ${planName}`
      : `Luna AI ${planName}套餐`

    const { data: prepayData } = await wxpay.v3.pay.transactions.jsapi.post({
      mchid: MERCHANT_ID,
      appid: MERCHANT_APP_ID,
      description,
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      amount: { total: Math.round(amount * 100), currency: 'CNY' },
      payer: { openid },
    }, { headers: { 'Wechatpay-Serial': WECHAT_PAY_PUBLIC_KEY_ID } })

    if (!prepayData.prepay_id) {
      return new Response(JSON.stringify({ success: false, error: '获取prepay_id失败' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const nonceStr = Formatter.nonce()
    const timeStamp = '' + Formatter.timestamp()
    const packageStr = 'prepay_id=' + prepayData.prepay_id
    const paySign = Rsa.sign(
      Formatter.joinedByLineFeed(MERCHANT_APP_ID, timeStamp, nonceStr, packageStr),
      Rsa.from(MCH_PRIVATE_KEY)
    )

    return new Response(JSON.stringify({
      success: true,
      orderNo: outTradeNo,
      paymentParams: { timeStamp, nonceStr, package: packageStr, signType: 'RSA', paySign }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    console.error('[create_wechat_payment error]', err)
    return new Response(JSON.stringify({ success: false, error: err?.message || '服务器错误' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
