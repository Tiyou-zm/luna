// 供 Webhook 调用，写入用户趋势数据（公开数据口径）
// 请求必须携带 Authorization: Bearer {ANALYTICS_WRITE_SECRET}
import {createClient} from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: corsHeaders})
  }

  try {
    // 验证写入密钥
    const authHeader = req.headers.get('Authorization') || ''
    const writeSecret = Deno.env.get('ANALYTICS_WRITE_SECRET') || 'claw-mcp-default-secret-2026'

    if (authHeader !== `Bearer ${writeSecret}`) {
      return Response.json({error: '未授权写入'}, {status: 401, headers: corsHeaders})
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 请求格式（公开数据口径）：
    // {user_id, date, granularity,
    //  fans_count, fans_delta, follows_count,
    //  likes_collects_count, likes_collects_delta,
    //  note_count, public_interactions, public_interactions_delta,
    //  data_mode, top_contents, raw_data,
    //  -- 兼容旧字段 --
    //  visitors, new_followers, plays, interactions, publish_count, call_count}
    const body = await req.json()
    const {
      user_id,
      date,
      granularity = 'day',
      // 公开数据口径字段
      fans_count = 0,
      fans_delta = 0,
      follows_count = 0,
      likes_collects_count = 0,
      likes_collects_delta = 0,
      note_count = 0,
      public_interactions = 0,
      public_interactions_delta = 0,
      data_mode = 'public',
      // 兼容旧字段
      visitors = 0,
      new_followers = 0,
      plays = 0,
      interactions = 0,
      publish_count = 0,
      call_count = 0,
      top_contents = [],
      raw_data = {}
    } = body

    if (!user_id || !date) {
      return Response.json({error: '缺少 user_id 或 date 字段'}, {status: 400, headers: corsHeaders})
    }

    const {error} = await supabase
      .from('analytics_data')
      .upsert(
        {
          user_id,
          date,
          granularity,
          // 公开数据口径
          fans_count,
          fans_delta,
          follows_count,
          likes_collects_count,
          likes_collects_delta,
          note_count,
          public_interactions,
          public_interactions_delta,
          data_mode,
          // 兼容旧字段
          visitors,
          new_followers,
          plays,
          interactions,
          publish_count,
          call_count,
          top_contents,
          raw_data,
          source: 'xiaohongshu',
          updated_at: new Date().toISOString()
        },
        {onConflict: 'user_id,date,granularity'}
      )

    if (error) {
      console.error('upsert analytics error:', error)
      return Response.json({error: error.message}, {status: 500, headers: corsHeaders})
    }

    // 异步触发 Hermes 生成今日运营简报（不阻塞响应）
    triggerHermesBrief(supabase, user_id, {
      fans_count, fans_delta, likes_collects_count,
      public_interactions, note_count, top_contents, date, raw_data
    }).catch((e) => console.warn('Hermes brief generation failed (non-fatal):', e))

    return Response.json({success: true, message: '数据写入成功'}, {headers: corsHeaders})
  } catch (err) {
    console.error('update_analytics error:', err)
    return Response.json({error: String(err)}, {status: 500, headers: corsHeaders})
  }
})

// 根据最新公开数据，调用 Hermes 生成运营简报并缓存到 analytics_briefs 表
async function triggerHermesBrief(
  supabase: ReturnType<typeof import('jsr:@supabase/supabase-js@2').createClient>,
  user_id: string,
  stats: {
    fans_count: number
    fans_delta: number
    likes_collects_count: number
    public_interactions: number
    note_count: number
    top_contents: Array<{title?: string; engagement?: number; likes?: number; comments?: number; collects?: number}>
    date: string
    raw_data: Record<string, unknown>
  }
) {
  const hermesBaseUrl = Deno.env.get('HERMES_BASE_URL') || 'http://152.136.47.2:8642'
  const hermesApiKey = Deno.env.get('HERMES_API_KEY') || ''
  const hermesModel = Deno.env.get('HERMES_MODEL') || 'hermes-agent'

  // Top3 内容概览（按互动合计排序）
  const top3 = [...stats.top_contents]
    .sort((a, b) => {
      const ea = (a.engagement ?? (a.likes || 0) + (a.comments || 0) + (a.collects || 0))
      const eb = (b.engagement ?? (b.likes || 0) + (b.comments || 0) + (b.collects || 0))
      return eb - ea
    })
    .slice(0, 3)
    .map((c, i) => `第${i + 1}名：${c.title || '（无标题）'}，互动 ${c.engagement ?? ((c.likes || 0) + (c.comments || 0) + (c.collects || 0))}`)
    .join('；')

  // 判断是否存在后台授权数据（如后台截图数据）
  const hasPrivateData = stats.raw_data && Object.keys(stats.raw_data).some(
    k => ['impressions', 'exposure', 'plays', 'views', 'profile_visits'].includes(k)
  )

  const prompt = [
    `日期：${stats.date}`,
    `数据口径：公开主页数据`,
    `粉丝数：${stats.fans_count}，粉丝净增：${stats.fans_delta > 0 ? '+' : ''}${stats.fans_delta}`,
    `获赞收藏：${stats.likes_collects_count}`,
    `公开互动：${stats.public_interactions}`,
    `笔记数：${stats.note_count}`,
    top3 ? `内容表现 Top3（按点赞+评论+收藏合计排序）：${top3}` : '',
    hasPrivateData ? `（注：raw_data 中包含后台授权数据，可参考使用）` : `（注：本次数据仅为公开主页数据，请勿提及访客数、播放量、曝光量等后台私有指标）`,
    '',
    '请用2-3句话给出今日运营表现点评和明日重点建议。语言简洁，聚焦可执行动作。'
  ].filter(Boolean).join('\n')

  const res = await fetch(`${hermesBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {'Authorization': `Bearer ${hermesApiKey}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: hermesModel,
      messages: [{role: 'user', content: prompt}],
      max_tokens: 256,
      stream: false
    })
  })

  if (!res.ok) return

  const json = await res.json()
  const brief = json?.choices?.[0]?.message?.content
  if (!brief) return

  await supabase.from('analytics_briefs').upsert(
    {user_id, date: stats.date, brief, generated_at: new Date().toISOString()},
    {onConflict: 'user_id,date'}
  )
}
