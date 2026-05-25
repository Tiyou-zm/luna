// 每日财务自动计算 Edge Function
// 支持手动触发（POST /finance-daily-calc）和 Supabase Cron 自动调度
import {createClient} from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

// ===== 通用 HMAC-SHA256 工具 =====
async function hmacSHA256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const raw = key instanceof ArrayBuffer ? key : key.buffer as ArrayBuffer
  const cryptoKey = await crypto.subtle.importKey('raw', raw, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ===== 火山引擎 Open API HMAC-V4 签名（billing/iam 通用） =====
async function volcanoSign(
  method: string,
  host: string,
  path: string,
  query: Record<string, string>,
  body: string,
  accessKey: string,
  secretKey: string,
  service: string,
  region: string
): Promise<Record<string, string>> {
  const now = new Date()
  const datetime = now.toISOString().replace(/[:-]/g, '').replace(/\..+/, '') + 'Z'
  const date = datetime.substring(0, 8)
  const payloadHash = await sha256Hex(body)

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'host': host,
    'x-date': datetime,
    'x-content-sha256': payloadHash
  }

  const signedHeaderList = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderList.map(k => `${k}:${headers[k]}`).join('\n') + '\n'
  const signedHeaders = signedHeaderList.join(';')
  const canonicalQuery = Object.keys(query).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&')

  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credentialScope = `${date}/${region}/${service}/request`
  const stringToSign = ['HMAC-SHA256', datetime, credentialScope, await sha256Hex(canonicalRequest)].join('\n')

  const kDate = await hmacSHA256(new TextEncoder().encode(secretKey), date)
  const kRegion = await hmacSHA256(kDate, region)
  const kService = await hmacSHA256(kRegion, service)
  const kSigning = await hmacSHA256(kService, 'request')
  const signature = toHex(await hmacSHA256(kSigning, stringToSign))

  return {
    ...headers,
    'Authorization': `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  }
}

// ===== 查询火山引擎账户余额 =====
async function getVolcanoBalance(accessKey: string, secretKey: string): Promise<number> {
  const host = 'open.volcengineapi.com'
  const path = '/'
  const query = {Action: 'BalanceQuery', Version: '2022-01-01'}
  const body = '{}'

  const signedHeaders = await volcanoSign(
    'POST', host, path, query, body,
    accessKey, secretKey, 'billing', 'cn-beijing'
  )

  const url = `https://${host}/?Action=BalanceQuery&Version=2022-01-01`
  const resp = await fetch(url, {
    method: 'POST',
    headers: signedHeaders,
    body
  })

  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(`Volcano balance API ${resp.status}: ${txt}`)
  }

  const json = await resp.json()
  // 响应结构: { Result: { AvailableBalance: "3500.00", ... } }
  const balance = parseFloat(json?.Result?.AvailableBalance || json?.result?.available_balance || '0')
  return isNaN(balance) ? 0 : balance
}

// ===== 日期工具 =====
function getYesterdayStr(offsetDays = 1): string {
  const d = new Date()
  d.setDate(d.getDate() - offsetDays)
  return d.toISOString().substring(0, 10) // YYYY-MM-DD
}

function dayRange(dateStr: string): {start: string; end: string} {
  return {
    start: `${dateStr}T00:00:00.000Z`,
    end: `${dateStr}T23:59:59.999Z`
  }
}

// ===== 主逻辑 =====
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers: corsHeaders})

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body = await req.json().catch(() => ({}))
    const targetDate: string = body.date || getYesterdayStr()
    const {start, end} = dayRange(targetDate)

    // ====== Step 1: 统计昨日用户充值总额 ======
    const [rechargeRes, orderRes] = await Promise.all([
      supabase.from('compute_recharges').select('amount').gte('paid_at', start).lte('paid_at', end).eq('status', 'paid'),
      supabase.from('orders').select('amount').gte('paid_at', start).lte('paid_at', end).eq('status', 'paid')
    ])
    const rechargeAmt = (rechargeRes.data || []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
    const orderAmt = (orderRes.data || []).reduce((s, o) => s + (Number(o.amount) || 0), 0)
    const yesterdayRecharge = rechargeAmt + orderAmt

    // ====== Step 2: 统计昨日消耗（从 usage_records 真实用量）======
    const usageRes = await supabase
      .from('usage_records')
      .select('type, quantity, amount_deducted')
      .gte('created_at', start)
      .lte('created_at', end)

    const usageRows = usageRes.data || []
    const videoSecondsTotal = usageRows.filter(r => r.type === 'video').reduce((s, r) => s + Number(r.quantity || 0), 0)
    const graphicCountTotal = usageRows.filter(r => r.type === 'image').reduce((s, r) => s + Number(r.quantity || 0), 0)
    const usageDeductedTotal = usageRows.reduce((s, r) => s + Number(r.amount_deducted || 0), 0)

    // 向下兼容：messages.tokens_used 统计文字token消耗（用于估算）
    const PRICE_PER_KTOKEN = 0.0008
    const msgRes = await supabase
      .from('messages')
      .select('tokens_used')
      .gte('created_at', start)
      .lte('created_at', end)
    const totalTokens = (msgRes.data || []).reduce((s, m) => s + (Number(m.tokens_used) || 0), 0)
    const textCostEstimate = totalTokens * PRICE_PER_KTOKEN / 1000
    const yesterdayConsumption = usageDeductedTotal + textCostEstimate

    // ====== Step 3: 查询火山引擎余额（使用 ARK 账号的 IAM 密钥）======
    // 优先使用专用财务密钥，若未配置则尝试 TOS 密钥（兼容旧配置）
    const accessKey = Deno.env.get('VOLCANO_ACCESS_KEY') || Deno.env.get('TOS_ACCESS_KEY_ID') || ''
    const secretKey = Deno.env.get('VOLCANO_SECRET_KEY') || Deno.env.get('TOS_SECRET_ACCESS_KEY') || ''
    let volcanoBalance = 0
    let volcanoApiError: string | null = null
    try {
      volcanoBalance = await getVolcanoBalance(accessKey, secretKey)
    } catch (e: any) {
      volcanoApiError = e?.message || '火山余额查询失败'
      // 余额查询失败时使用 0，保守估算
    }

    // ====== Step 4: 计算3日预测消耗 ======
    const GROWTH_RATE = 1.2
    const day1 = yesterdayConsumption * GROWTH_RATE
    const day2 = day1 * GROWTH_RATE
    const day3 = day2 * GROWTH_RATE
    const predicted3day = day1 + day2 + day3

    // ====== Step 5: 计算建议转账额 ======
    const safetyGap = predicted3day - volcanoBalance
    const recommendedTransfer = safetyGap - yesterdayRecharge
    const actualTransferNeeded = Math.max(0, recommendedTransfer)
    // 取整到千位，多留 120 元缓冲
    const suggestedRounded = Math.max(0, Math.ceil(actualTransferNeeded / 1000) * 1000)

    // ====== Step 6: 统计昨日新增用户 ======
    const profileRes = await supabase
      .from('profiles')
      .select('id', {count: 'exact', head: true})
      .gte('created_at', start)
      .lte('created_at', end)
    const newUsersCount = profileRes.count || 0

    // ====== Step 7: 写入/更新 finance_reports ======
    const reportPayload = {
      report_date: targetDate,
      yesterday_recharge: yesterdayRecharge,
      yesterday_consumption: yesterdayConsumption,
      total_tokens_used: totalTokens,
      volcano_balance: volcanoBalance,
      volcano_api_error: volcanoApiError,
      predicted_3day_consumption: predicted3day,
      safety_gap: safetyGap,
      recommended_transfer: recommendedTransfer,
      suggested_transfer_rounded: suggestedRounded,
      new_users_count: newUsersCount,
      video_seconds_total: videoSecondsTotal,
      graphic_count_total: graphicCountTotal,
      usage_deducted_total: usageDeductedTotal,
      updated_at: new Date().toISOString()
    }

    const {data: existing} = await supabase
      .from('finance_reports')
      .select('id')
      .eq('report_date', targetDate)
      .maybeSingle()

    let reportId: string
    if (existing?.id) {
      await supabase.from('finance_reports').update(reportPayload).eq('id', existing.id)
      reportId = existing.id
    } else {
      const {data: inserted} = await supabase
        .from('finance_reports')
        .insert(reportPayload)
        .select('id')
        .maybeSingle()
      reportId = inserted?.id || ''

      // 仅在新建报告时创建待确认的转账指令
      if (reportId && suggestedRounded > 0) {
        await supabase.from('transfer_orders').insert({
          report_id: reportId,
          suggested_amount: suggestedRounded,
          status: 'pending'
        })
      }
    }

    const result = {
      success: true,
      report_date: targetDate,
      yesterday_recharge: yesterdayRecharge,
      yesterday_consumption: yesterdayConsumption,
      volcano_balance: volcanoBalance,
      volcano_api_error: volcanoApiError,
      predicted_3day: predicted3day,
      safety_gap: safetyGap,
      suggested_transfer: suggestedRounded,
      new_users: newUsersCount,
      video_seconds_total: videoSecondsTotal,
      graphic_count_total: graphicCountTotal,
      usage_deducted_total: usageDeductedTotal
    }

    return new Response(JSON.stringify(result), {
      headers: {...corsHeaders, 'Content-Type': 'application/json'}
    })

  } catch (err: any) {
    return new Response(JSON.stringify({success: false, error: err?.message || '计算失败'}), {
      status: 500,
      headers: {...corsHeaders, 'Content-Type': 'application/json'}
    })
  }
})
