// xhs_public_collect
// 接收小红书主页分享链接 / 小红书号 / 昵称，调用 Hermes 公开数据采集接口，
// 保存 social_accounts 记录并写入 analytics_data。
import {createClient} from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 本地解析小红书主页链接，提取 xhs_user_id（不依赖 Hermes）
// 支持格式：
//   https://www.xiaohongshu.com/user/profile/<userId>
//   https://www.xiaohongshu.com/user/profile/<userId>?xsec_token=xxx
function parseXhsUserIdFromUrl(url: string): string | null {
  try {
    const match = url.match(/xiaohongshu\.com\/user\/profile\/([a-zA-Z0-9]+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// 本地尝试将短链重定向到真实 URL（xhslink.com 短链）
// 注意：必须用 GET，不能用 HEAD——很多短链服务会拒绝 HEAD 请求
async function resolveShortLink(url: string): Promise<{resolvedUrl: string; status?: number; error?: string}> {
  if (!url.includes('xhslink.com')) return {resolvedUrl: url}
  try {
    console.log('[resolveShortLink] 开始展开短链:', url)
    const res = await fetch(url, {method: 'GET', redirect: 'follow'})
    console.log('[resolveShortLink] 短链展开结果 status:', res.status, 'final url:', res.url)
    return {resolvedUrl: res.url || url, status: res.status}
  } catch (e) {
    console.error('[resolveShortLink] 短链展开失败:', String(e))
    return {resolvedUrl: url, error: String(e)}
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: corsHeaders})
  }

  try {
    // 验证小程序用户身份
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return Response.json({error: '未登录'}, {status: 401, headers: corsHeaders})
    }
    const {data: {user}, error: authErr} = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authErr || !user) {
      return Response.json({error: '认证失败'}, {status: 401, headers: corsHeaders})
    }

    const {profile_url, red_id, nickname} = await req.json()
    if (!profile_url && !red_id && !nickname) {
      return Response.json(
        {error: '请提供小红书主页链接、小红书号或昵称'},
        {status: 400, headers: corsHeaders}
      )
    }

    const hermesBaseUrl = Deno.env.get('HERMES_BASE_URL') || 'http://152.136.47.2:8642'
    const hermesApiKey = Deno.env.get('HERMES_API_KEY') || ''

    // ── Step 1：本地解析 profile_url，提取 xhs_user_id ──────────────────
    // 先在本地处理，不依赖 Hermes，减少失败点
    let xhsUserId: string | null = null
    let resolvedRedId: string | null = red_id || null
    let resolvedProfileUrl: string | null = profile_url || null
    let shortLinkStatus: number | undefined
    let shortLinkError: string | undefined

    if (profile_url) {
      // 短链先展开（必须用 GET，不能用 HEAD）
      const resolveResult = await resolveShortLink(profile_url)
      resolvedProfileUrl = resolveResult.resolvedUrl
      shortLinkStatus = resolveResult.status
      shortLinkError = resolveResult.error
      xhsUserId = parseXhsUserIdFromUrl(resolveResult.resolvedUrl)
      console.log('[Step1] 本地解析: profile_url=', profile_url, '→ expanded=', resolveResult.resolvedUrl,
                   'status=', shortLinkStatus, 'parsed_user_id=', xhsUserId, 'error=', shortLinkError)
    } else {
      console.log('[Step1] 无 profile_url，跳过本地解析')
    }

    // ── Step 2：调用 Hermes resolve（补充 red_id 等信息，失败不影响主流程）──
    let hermesResolveStatus = 0
    let hermesResolveBody: Record<string, unknown> = {}
    try {
      console.log('[Step2] 调用 Hermes resolve:', `${hermesBaseUrl}/xhs/public/resolve`, 'body=', {profile_url: resolvedProfileUrl, red_id, nickname, xhs_user_id: xhsUserId})
      const resolveRes = await fetch(`${hermesBaseUrl}/xhs/public/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hermesApiKey}`,
        },
        body: JSON.stringify({profile_url: resolvedProfileUrl, red_id, nickname, xhs_user_id: xhsUserId}),
        signal: AbortSignal.timeout(8000),
      })
      hermesResolveStatus = resolveRes.status
      if (resolveRes.ok) {
        hermesResolveBody = await resolveRes.json()
        xhsUserId = (hermesResolveBody?.xhs_user_id as string) || xhsUserId
        resolvedRedId = (hermesResolveBody?.red_id as string) || resolvedRedId
        resolvedProfileUrl = (hermesResolveBody?.profile_url as string) || resolvedProfileUrl
        console.log('[Step2] Hermes resolve 成功: status=', hermesResolveStatus, 'data=', hermesResolveBody)
      } else {
        const errText = await resolveRes.text().catch(() => '')
        console.warn('[Step2] Hermes resolve 非 2xx:', hermesResolveStatus, errText)
      }
    } catch (e) {
      console.warn('[Step2] Hermes resolve 请求失败（跳过，使用本地解析结果）:', String(e))
    }

    // ── Step 3：调用 Hermes collect 采集公开主页数据 ──────────────────────
    let collectData: Record<string, unknown> = {}
    let collectSuccess = false
    let collectErrMsg = ''
    let collectStatus = 0
    try {
      console.log('[Step3] 调用 Hermes collect:', `${hermesBaseUrl}/xhs/public/collect`, 'body=', {xhs_user_id: xhsUserId, red_id: resolvedRedId, profile_url: resolvedProfileUrl, nickname})
      const collectRes = await fetch(`${hermesBaseUrl}/xhs/public/collect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hermesApiKey}`,
        },
        body: JSON.stringify({
          xhs_user_id: xhsUserId,
          red_id: resolvedRedId,
          profile_url: resolvedProfileUrl,
          nickname,
        }),
        signal: AbortSignal.timeout(15000),
      })
      collectStatus = collectRes.status
      if (collectRes.ok) {
        collectData = await collectRes.json()
        collectSuccess = true
        console.log('[Step3] Hermes collect 成功: status=', collectStatus, 'data_keys=', Object.keys(collectData), 'data_preview=', JSON.stringify(collectData).slice(0, 300))
      } else {
        collectErrMsg = await collectRes.text().catch(() => '')
        console.error('[Step3] Hermes collect 非 2xx:', collectStatus, collectErrMsg)
      }
    } catch (e) {
      collectErrMsg = String(e)
      console.error('[Step3] Hermes collect 请求失败:', collectErrMsg)
    }

    // ── 关键修复：collect 失败时直接返回错误，不保存空数据 ────────────────
    if (!collectSuccess) {
      const hint = collectErrMsg.includes('timed out') || collectErrMsg.includes('AbortError')
        ? '数据采集超时，请稍后重试'
        : '无法获取该账号的公开数据，请确认链接/小红书号是否正确后重试'
      return Response.json(
        {
          error: hint,
          detail: collectErrMsg || '未知错误',
          // 详细的调试信息供分析
          debug: {
            input: {profile_url, red_id, nickname},
            short_link: {original_url: profile_url, resolved_url: resolvedProfileUrl, status: shortLinkStatus, error: shortLinkError},
            local_parsed: {xhs_user_id: xhsUserId, red_id: resolvedRedId},
            hermes_resolve: {status: hermesResolveStatus, body: hermesResolveBody},
            hermes_collect: {status: collectStatus, error: collectErrMsg},
            hermes_base_url: hermesBaseUrl,
          },
        },
        {status: 502, headers: corsHeaders}
      )
    }

    // ── Step 4：从 collectData 提取字段 ──────────────────────────────────
    const resolvedNickname: string = (collectData?.nickname as string) || nickname || '小红书用户'
    const avatarUrl: string | null = (collectData?.avatar as string) || null
    const finalRedId: string | null = (collectData?.red_id as string) || resolvedRedId
    const fansCount: number = Number(collectData?.fans_count) || 0
    const followsCount: number = Number(collectData?.follows_count) || 0
    const likesCollectsCount: number = Number(collectData?.likes_collects_count) || 0
    const noteCount: number = Number(collectData?.note_count) || 0
    const publicInteractions: number = Number(collectData?.public_interactions) || 0
    const topContents: unknown[] = (collectData?.top_contents as unknown[]) || []

    // ── Step 5：保存 / 更新 social_accounts ──────────────────────────────
    const {data: existingAccounts} = await supabase
      .from('social_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('platform', 'xiaohongshu')
      .limit(1)

    const now = new Date().toISOString()
    const accountPayload = {
      user_id: user.id,
      platform: 'xiaohongshu',
      account_name: resolvedNickname,
      account_id: finalRedId,
      avatar_url: avatarUrl,
      follower_count: fansCount,
      is_active: true,
      profile_url: resolvedProfileUrl,
      red_id: finalRedId,
      xhs_user_id: xhsUserId,
      last_sync_at: now,
      raw_profile: collectData,
      updated_at: now,
    }

    let accountId: string | null = null
    if (existingAccounts && existingAccounts.length > 0) {
      const {data: updated} = await supabase
        .from('social_accounts')
        .update(accountPayload)
        .eq('id', existingAccounts[0].id)
        .select('id')
        .maybeSingle()
      accountId = updated?.id || existingAccounts[0].id
    } else {
      const {data: inserted} = await supabase
        .from('social_accounts')
        .insert({...accountPayload, created_at: now})
        .select('id')
        .maybeSingle()
      accountId = inserted?.id || null

      // 同步更新 profile.bound_accounts
      const {data: countData} = await supabase
        .from('social_accounts')
        .select('id', {count: 'exact'})
        .eq('user_id', user.id)
      const boundCount = countData?.length ?? 1
      await supabase.from('profiles').update({bound_accounts: boundCount}).eq('id', user.id)
    }

    // ── Step 6：写入 analytics_data（今日） ──────────────────────────────
    const today = new Date().toISOString().slice(0, 10)
    const {data: lastRow} = await supabase
      .from('analytics_data')
      .select('fans_count, likes_collects_count, public_interactions')
      .eq('user_id', user.id)
      .eq('granularity', 'day')
      .order('date', {ascending: false})
      .limit(1)
      .maybeSingle()

    const fansDelta = lastRow ? fansCount - (Number(lastRow.fans_count) || 0) : 0
    const likesCollectsDelta = lastRow ? likesCollectsCount - (Number(lastRow.likes_collects_count) || 0) : 0
    const publicInteractionsDelta = lastRow ? publicInteractions - (Number(lastRow.public_interactions) || 0) : 0

    // 按 engagement 降序排列 top_contents
    const sortedTopContents = [...topContents].sort((a, b) => {
      const calcEng = (item: unknown) => {
        const i = item as Record<string, number>
        return (i.engagement ?? ((i.likes || 0) + (i.comments || 0) + (i.collects || 0))) || i.plays || 0
      }
      return calcEng(b) - calcEng(a)
    }).slice(0, 10).map((item, i) => {
      const it = item as Record<string, unknown>
      return {
        ...it,
        rank: i + 1,
        engagement: (it.engagement as number) ?? (((it.likes as number) || 0) + ((it.comments as number) || 0) + ((it.collects as number) || 0)),
      }
    })

    await supabase.from('analytics_data').upsert(
      {
        user_id: user.id,
        date: today,
        granularity: 'day',
        fans_count: fansCount,
        fans_delta: fansDelta,
        follows_count: followsCount,
        likes_collects_count: likesCollectsCount,
        likes_collects_delta: likesCollectsDelta,
        note_count: noteCount,
        public_interactions: publicInteractions,
        public_interactions_delta: publicInteractionsDelta,
        data_mode: 'public',
        new_followers: fansDelta > 0 ? fansDelta : 0,
        interactions: publicInteractions,
        top_contents: sortedTopContents,
        source: 'xiaohongshu',
        raw_data: collectData,
        updated_at: now,
      },
      {onConflict: 'user_id,date,granularity'}
    )

    return Response.json(
      {
        success: true,
        account_id: accountId,
        nickname: resolvedNickname,
        avatar: avatarUrl,
        red_id: finalRedId,
        xhs_user_id: xhsUserId,
        fans_count: fansCount,
        follows_count: followsCount,
        likes_collects_count: likesCollectsCount,
        note_count: noteCount,
        public_interactions: publicInteractions,
        top_contents: sortedTopContents.slice(0, 3),
        data_mode: 'public',
        collect_success: true,
      },
      {headers: corsHeaders}
    )
  } catch (err) {
    console.error('xhs_public_collect error:', err)
    return Response.json({error: String(err)}, {status: 500, headers: corsHeaders})
  }
})
