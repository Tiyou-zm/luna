// 套餐到期自动降级定时任务
// 支持两种触发方式：
//   1. Supabase Cron（每天凌晨 00:00 自动触发）
//   2. 手动 POST（管理员可随时触发）
import {createClient} from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {headers: CORS})
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const now = new Date().toISOString()

    // 查找所有已到期且尚未降级的用户
    const {data: expiredUsers, error: queryError} = await supabase
      .from('profiles')
      .select('id, membership_level, membership_expires')
      .lt('membership_expires', now)
      .neq('membership_level', 'free')

    if (queryError) {
      console.error('[membership_downgrade] 查询失败:', queryError.message)
      return Response.json({success: false, error: queryError.message}, {headers: CORS, status: 500})
    }

    if (!expiredUsers || expiredUsers.length === 0) {
      console.log('[membership_downgrade] 无需降级的用户')
      return Response.json({success: true, downgraded: 0}, {headers: CORS})
    }

    const ids = expiredUsers.map((u) => u.id)

    // 批量降级（同时重置用量计数器，避免新套餐配额虚假耗尽）
    const {error: updateError} = await supabase
      .from('profiles')
      .update({
        membership_level: 'free',
        membership_expires: null,
        video_seconds_used: 0,
        graphic_count_used: 0,
        updated_at: now,
      })
      .in('id', ids)

    if (updateError) {
      console.error('[membership_downgrade] 降级失败:', updateError.message)
      return Response.json({success: false, error: updateError.message}, {headers: CORS, status: 500})
    }

    console.log(`[membership_downgrade] 成功降级 ${ids.length} 名用户:`, ids)

    return Response.json(
      {success: true, downgraded: ids.length, user_ids: ids},
      {headers: CORS}
    )
  } catch (err: any) {
    console.error('[membership_downgrade] 异常:', err?.message)
    return Response.json({success: false, error: err?.message}, {headers: CORS, status: 500})
  }
})
