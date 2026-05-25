import {supabase} from '@/client/supabase'
import type {Profile, Conversation, Message, CsMessage, Order, Material, MembershipLevel, AnalyticsData, AnalyticsGranularity, SocialAccount, Announcement, ComputeRecharge, FinanceReport, TransferOrder, TransferStatus, UsageRecord, UsageSummary, RechargeSummary} from './types'

// ===== Profile API =====

export async function getProfile(userId: string): Promise<Profile | null> {
  const {data, error} = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('getProfile error:', error)
    return null
  }
  return data as Profile | null
}

export async function updateProfile(userId: string, updates: Partial<Profile>): Promise<boolean> {
  const {error} = await supabase
    .from('profiles')
    .update({...updates, updated_at: new Date().toISOString()})
    .eq('id', userId)
  if (error) {
    console.error('updateProfile error:', error)
    return false
  }
  return true
}

// ===== Conversations API =====

export async function getConversations(userId: string, limit = 20): Promise<Conversation[]> {
  const {data, error} = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', {ascending: false})
    .limit(limit)
  if (error) {
    console.error('getConversations error:', error)
    return []
  }
  return Array.isArray(data) ? (data as Conversation[]) : []
}

export async function createConversation(userId: string, title = '新对话'): Promise<Conversation | null> {
  const {data, error} = await supabase
    .from('conversations')
    .insert({user_id: userId, title})
    .select()
    .maybeSingle()
  if (error) {
    console.error('createConversation error:', error)
    return null
  }
  return data as Conversation | null
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  const {error} = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
  if (error) {
    console.error('deleteConversation error:', error)
    return false
  }
  return true
}

// ===== Messages API =====

export async function getMessages(conversationId: string, limit = 50): Promise<Message[]> {
  const {data, error} = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', {ascending: true})
    .limit(limit)
  if (error) {
    console.error('getMessages error:', error)
    return []
  }
  return Array.isArray(data) ? (data as Message[]) : []
}

export async function saveMessage(
  conversationId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  tokensUsed = 0
): Promise<Message | null> {
  const {data, error} = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: userId,
      role,
      content,
      tokens_used: tokensUsed
    })
    .select()
    .maybeSingle()
  if (error) {
    console.error('saveMessage error:', error)
    return null
  }
  // Update conversation updated_at
  await supabase
    .from('conversations')
    .update({updated_at: new Date().toISOString()})
    .eq('id', conversationId)
  return data as Message | null
}

// ===== Customer Service API =====

export async function getCsMessages(userId: string, limit = 50): Promise<CsMessage[]> {
  const {data, error} = await supabase
    .from('cs_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {ascending: true})
    .limit(limit)
  if (error) {
    console.error('getCsMessages error:', error)
    return []
  }
  return Array.isArray(data) ? (data as CsMessage[]) : []
}

export async function saveCsMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<CsMessage | null> {
  const {data, error} = await supabase
    .from('cs_messages')
    .insert({user_id: userId, role, content})
    .select()
    .maybeSingle()
  if (error) {
    console.error('saveCsMessage error:', error)
    return null
  }
  return data as CsMessage | null
}

// ===== Orders API =====

export async function getOrders(userId: string, limit = 20): Promise<Order[]> {
  const {data, error} = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .limit(limit)
  if (error) {
    console.error('getOrders error:', error)
    return []
  }
  return Array.isArray(data) ? (data as Order[]) : []
}

export async function createOrder(
  userId: string,
  openid: string,
  planName: string,
  planLevel: MembershipLevel,
  amount: number,
  orderNo: string
): Promise<Order | null> {
  const {data, error} = await supabase
    .from('orders')
    .insert({
      order_no: orderNo,
      user_id: userId,
      openid,
      plan_name: planName,
      plan_level: planLevel,
      amount,
      status: 'pending'
    })
    .select()
    .maybeSingle()
  if (error) {
    console.error('createOrder error:', error)
    return null
  }
  return data as Order | null
}

// ===== Materials API =====

export async function getMaterials(userId: string, limit = 30): Promise<Material[]> {
  const {data, error} = await supabase
    .from('materials')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .limit(limit)
  if (error) {
    console.error('getMaterials error:', error)
    return []
  }
  return Array.isArray(data) ? (data as Material[]) : []
}

export async function getMaterialPackages(userId: string, limit = 20): Promise<Material[]> {
  const {data, error} = await supabase
    .from('materials')
    .select('*')
    .eq('user_id', userId)
    .eq('type', 'work')
    .order('created_at', {ascending: false})
    .limit(limit)
  if (error) {
    console.error('getMaterialPackages error:', error)
    return []
  }
  return Array.isArray(data) ? (data as Material[]) : []
}

export async function getMaterialById(materialId: string): Promise<Material | null> {
  const {data, error} = await supabase
    .from('materials')
    .select('*')
    .eq('id', materialId)
    .maybeSingle()
  if (error) {
    console.error('getMaterialById error:', error)
    return null
  }
  return data as Material | null
}

export async function deleteMaterial(materialId: string): Promise<boolean> {
  const {error} = await supabase
    .from('materials')
    .delete()
    .eq('id', materialId)
  if (error) {
    console.error('deleteMaterial error:', error)
    return false
  }
  return true
}

// ===== Analytics API =====

export async function getAnalytics(userId: string, granularity: AnalyticsGranularity = 'day', limit = 7): Promise<AnalyticsData[]> {
  const {data, error} = await supabase
    .from('analytics_data')
    .select('*')
    .eq('user_id', userId)
    .eq('granularity', granularity)
    .order('date', {ascending: false})
    .limit(limit)
  if (error) {
    console.error('getAnalytics error:', error)
    return []
  }
  const rows = Array.isArray(data) ? (data as AnalyticsData[]) : []
  return rows.reverse()
}

export async function upsertAnalytics(
  userId: string,
  date: string,
  stats: {
    visitors?: number
    new_followers?: number
    plays?: number
    interactions?: number
    publish_count?: number
    call_count?: number
    source?: string
  }
): Promise<boolean> {
  const {error} = await supabase
    .from('analytics_data')
    .upsert(
      {
        user_id: userId,
        date,
        granularity: 'day',
        visitors: stats.visitors ?? 0,
        new_followers: stats.new_followers ?? 0,
        plays: stats.plays ?? 0,
        interactions: stats.interactions ?? 0,
        publish_count: stats.publish_count ?? 0,
        call_count: stats.call_count ?? 0,
        top_contents: [],
        raw_data: {},
        source: stats.source ?? 'manual',
        updated_at: new Date().toISOString()
      },
      {onConflict: 'user_id,date,granularity'}
    )
  if (error) {
    console.error('upsertAnalytics error:', error)
    return false
  }
  return true
}

export async function getLatestAnalytics(userId: string): Promise<AnalyticsData | null> {
  const {data, error} = await supabase
    .from('analytics_data')
    .select('*')
    .eq('user_id', userId)
    .eq('granularity', 'day')
    .order('date', {ascending: false})
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('getLatestAnalytics error:', error)
    return null
  }
  return data as AnalyticsData | null
}

// ===== Social Accounts API =====

export async function getSocialAccounts(userId: string): Promise<SocialAccount[]> {
  const {data, error} = await supabase
    .from('social_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
  if (error) {
    console.error('getSocialAccounts error:', error)
    return []
  }
  return Array.isArray(data) ? (data as SocialAccount[]) : []
}

export async function addSocialAccount(
  userId: string,
  platform: string,
  accountName: string,
  accountId?: string
): Promise<SocialAccount | null> {
  const {data, error} = await supabase
    .from('social_accounts')
    .insert({user_id: userId, platform, account_name: accountName, account_id: accountId || null})
    .select()
    .maybeSingle()
  if (error) {
    console.error('addSocialAccount error:', error)
    return null
  }
  // 同步更新 profile.bound_accounts
  const accounts = await getSocialAccounts(userId)
  await supabase.from('profiles').update({bound_accounts: accounts.length}).eq('id', userId)
  return data as SocialAccount | null
}

export async function removeSocialAccount(id: string, userId: string): Promise<boolean> {
  const {error} = await supabase
    .from('social_accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) {
    console.error('removeSocialAccount error:', error)
    return false
  }
  // 同步更新 profile.bound_accounts
  const accounts = await getSocialAccounts(userId)
  await supabase.from('profiles').update({bound_accounts: accounts.length}).eq('id', userId)
  return true
}

// ===== Announcements API =====

export async function getAnnouncements(): Promise<Announcement[]> {
  const {data, error} = await supabase
    .from('announcements')
    .select('*')
    .eq('is_active', true)
    .order('created_at', {ascending: false})
    .limit(10)
  if (error) {
    console.error('getAnnouncements error:', error)
    return []
  }
  return Array.isArray(data) ? (data as Announcement[]) : []
}

// ===== Compute Recharges API =====

export async function getComputeRecharges(userId: string): Promise<ComputeRecharge[]> {
  const {data, error} = await supabase
    .from('compute_recharges')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .limit(50)
  if (error) {
    console.error('getComputeRecharges error:', error)
    return []
  }
  return Array.isArray(data) ? (data as ComputeRecharge[]) : []
}

// ===== 财务系统 API =====

export async function getFinanceReports(limit = 30): Promise<FinanceReport[]> {
  const {data, error} = await supabase
    .from('finance_reports')
    .select('*')
    .order('report_date', {ascending: false})
    .limit(limit)
  if (error) {
    console.error('getFinanceReports error:', error)
    return []
  }
  return Array.isArray(data) ? (data as FinanceReport[]) : []
}

export async function getLatestFinanceReport(): Promise<FinanceReport | null> {
  const {data, error} = await supabase
    .from('finance_reports')
    .select('*')
    .order('report_date', {ascending: false})
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('getLatestFinanceReport error:', error)
    return null
  }
  return data as FinanceReport | null
}

export async function getTransferOrderByReport(reportId: string): Promise<TransferOrder | null> {
  const {data, error} = await supabase
    .from('transfer_orders')
    .select('*')
    .eq('report_id', reportId)
    .order('created_at', {ascending: false})
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('getTransferOrderByReport error:', error)
    return null
  }
  return data as TransferOrder | null
}

export async function confirmTransferOrder(
  orderId: string,
  actualAmount: number,
  userId: string,
  notes?: string
): Promise<boolean> {
  const {error} = await supabase
    .from('transfer_orders')
    .update({
      actual_amount: actualAmount,
      status: 'confirmed' as TransferStatus,
      confirmed_at: new Date().toISOString(),
      confirmed_by: userId,
      notes: notes || null
    })
    .eq('id', orderId)
  if (error) {
    console.error('confirmTransferOrder error:', error)
    return false
  }
  return true
}

export async function skipTransferOrder(orderId: string, notes?: string): Promise<boolean> {
  const {error} = await supabase
    .from('transfer_orders')
    .update({
      status: 'skipped' as TransferStatus,
      confirmed_at: new Date().toISOString(),
      notes: notes || '已跳过'
    })
    .eq('id', orderId)
  if (error) {
    console.error('skipTransferOrder error:', error)
    return false
  }
  return true
}

// ===== 用量记录 API =====

// 写入一条前端产生的拦截记录（例如前端预检拦截免费额度用尽）
export async function insertFrontendBlockRecord(
  userId: string,
  balance: number,
  reason: string
): Promise<void> {
  await supabase.from('usage_records').insert({
    user_id: userId,
    type: 'text',
    model: 'client-preflight',
    quantity: 0,
    unit: 'tokens',
    amount_deducted: 0,
    from_plan: false,
    balance_before: balance,
    balance_after: balance,
    raw_response: reason,
  })
}

// 查询用户自己的用量明细（最近N条）
export async function getUserUsageRecords(userId: string, limit = 50, offset = 0): Promise<UsageRecord[]> {
  const {data} = await supabase
    .from('usage_records')
    .select('id, user_id, type, model, quantity, unit, amount_deducted, balance_before, balance_after, from_plan, raw_response, created_at')
    .eq('user_id', userId)
    .order('created_at', {ascending: false})
    .range(offset, offset + limit - 1)
  return Array.isArray(data) ? data : []
}

// 管理员：查询所有用量记录（按日期范围，分页）
export async function getAdminUsageRecords(startDate: string, endDate: string, limit = 100): Promise<UsageRecord[]> {
  const {data} = await supabase
    .from('usage_records')
    .select('id, user_id, type, model, quantity, unit, amount_deducted, balance_before, balance_after, from_plan, raw_response, created_at')
    .gte('created_at', `${startDate}T00:00:00.000Z`)
    .lte('created_at', `${endDate}T23:59:59.999Z`)
    .order('created_at', {ascending: false})
    .limit(limit)
  return Array.isArray(data) ? data : []
}

// 管理员：用量按日聚合汇总
export async function getUsageSummaryByDay(days = 7): Promise<UsageSummary[]> {
  const results: UsageSummary[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().substring(0, 10)
    const {data} = await supabase
      .from('usage_records')
      .select('type, quantity, amount_deducted')
      .gte('created_at', `${dateStr}T00:00:00.000Z`)
      .lte('created_at', `${dateStr}T23:59:59.999Z`)
    const rows = data || []
    results.push({
      date: dateStr,
      video_seconds: rows.filter(r => r.type === 'video').reduce((s, r) => s + Number(r.quantity || 0), 0),
      graphic_count: rows.filter(r => r.type === 'image').reduce((s, r) => s + Number(r.quantity || 0), 0),
      total_deducted: rows.reduce((s, r) => s + Number(r.amount_deducted || 0), 0),
      record_count: rows.length
    })
  }
  return results
}

// 管理员：所有用户算力充值总额统计
export async function getRechargeSummary(): Promise<RechargeSummary> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const [{data: allData}, {data: monthData}] = await Promise.all([
    supabase.from('compute_recharges').select('amount').eq('status', 'paid'),
    supabase.from('compute_recharges').select('amount').eq('status', 'paid').gte('paid_at', monthStart)
  ])
  const allRows = Array.isArray(allData) ? allData : []
  const monthRows = Array.isArray(monthData) ? monthData : []
  return {
    total_amount: allRows.reduce((s, r) => s + Number(r.amount || 0), 0),
    total_count: allRows.length,
    this_month_amount: monthRows.reduce((s, r) => s + Number(r.amount || 0), 0)
  }
}
