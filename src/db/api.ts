import {callDbApi} from '@/client/cloudbase'
import type {
  Announcement,
  AnalyticsData,
  AnalyticsGranularity,
  Conversation,
  CsMessage,
  FinanceReport,
  GenerationJob,
  Material,
  MembershipLevel,
  Message,
  Order,
  Profile,
  RechargeSummary,
  SocialAccount,
  TransferOrder,
  UsageRecord,
  UsageSummary,
} from './types'

async function safeCall<T>(action: string, payload: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return await callDbApi<T>(action, payload)
  } catch (error) {
    console.warn(`CloudBase dbApi ${action} failed:`, error)
    return fallback
  }
}

export async function getProfile(userId: string): Promise<Profile | null> {
  return safeCall<Profile | null>('getProfile', {userId}, null)
}

export async function updateProfile(userId: string, updates: Partial<Profile>): Promise<boolean> {
  return safeCall<boolean>('updateProfile', {userId, updates}, false)
}

export async function getConversations(userId: string, limit = 20): Promise<Conversation[]> {
  return safeCall<Conversation[]>('getConversations', {userId, limit}, [])
}

export async function createConversation(userId: string, title = '新对话'): Promise<Conversation | null> {
  return safeCall<Conversation | null>('createConversation', {userId, title}, null)
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  return safeCall<boolean>('deleteConversation', {conversationId}, false)
}

export async function getMessages(conversationId: string, limit = 50): Promise<Message[]> {
  return safeCall<Message[]>('getMessages', {conversationId, limit}, [])
}

export async function saveMessage(
  conversationId: string,
  userId: string,
  role: 'user' | 'assistant',
  content: string,
  tokensUsed = 0,
): Promise<Message | null> {
  return safeCall<Message | null>('saveMessage', {conversationId, userId, role, content, tokensUsed}, null)
}

export async function getCsMessages(userId: string, limit = 50): Promise<CsMessage[]> {
  return safeCall<CsMessage[]>('getCsMessages', {userId, limit}, [])
}

export async function saveCsMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<CsMessage | null> {
  return safeCall<CsMessage | null>('saveCsMessage', {userId, role, content}, null)
}

export async function getOrders(userId: string, limit = 20): Promise<Order[]> {
  return safeCall<Order[]>('getOrders', {userId, limit}, [])
}

export async function createOrder(
  userId: string,
  openid: string,
  planName: string,
  planLevel: MembershipLevel,
  amount: number,
  orderNo: string,
): Promise<Order | null> {
  return safeCall<Order | null>('createOrder', {userId, openid, planName, planLevel, amount, orderNo}, null)
}

export async function getMaterials(userId: string, limit = 30): Promise<Material[]> {
  return safeCall<Material[]>('getMaterials', {userId, limit}, [])
}

export async function getMaterialPackages(userId: string, limit = 20): Promise<Material[]> {
  return safeCall<Material[]>('getMaterialPackages', {userId, limit}, [])
}

export async function getGenerationJobs(userId: string, limit = 20): Promise<GenerationJob[]> {
  return safeCall<GenerationJob[]>('getGenerationJobs', {userId, limit}, [])
}

export async function getMaterialById(materialId: string): Promise<Material | null> {
  return safeCall<Material | null>('getMaterialById', {materialId}, null)
}

export async function getMaterialChildren(materialId: string, limit = 100): Promise<Material[]> {
  return safeCall<Material[]>('getMaterialChildren', {materialId, limit}, [])
}

export async function deleteMaterial(materialId: string): Promise<boolean> {
  return safeCall<boolean>('deleteMaterial', {materialId}, false)
}

export async function getAnalytics(
  userId: string,
  granularity: AnalyticsGranularity = 'day',
  limit = 7,
): Promise<AnalyticsData[]> {
  return safeCall<AnalyticsData[]>('getAnalytics', {userId, granularity, limit}, [])
}

export async function upsertAnalytics(
  userId: string,
  date: string,
  stats: Record<string, unknown>,
): Promise<boolean> {
  return safeCall<boolean>('upsertAnalytics', {userId, date, stats}, false)
}

export async function getSocialAccounts(userId: string): Promise<SocialAccount[]> {
  return safeCall<SocialAccount[]>('getSocialAccounts', {userId}, [])
}

export async function createSocialAccount(
  userId: string,
  platform: string,
  accountName: string,
  accountId?: string,
): Promise<SocialAccount | null> {
  return safeCall<SocialAccount | null>('createSocialAccount', {userId, platform, accountName, accountId}, null)
}

export async function deleteSocialAccount(accountId: string): Promise<boolean> {
  return safeCall<boolean>('deleteSocialAccount', {accountId}, false)
}

export async function getAnnouncements(): Promise<Announcement[]> {
  return safeCall<Announcement[]>('getAnnouncements', {}, [])
}

export async function getFinanceReports(limit = 30): Promise<FinanceReport[]> {
  return safeCall<FinanceReport[]>('getFinanceReports', {limit}, [])
}

export async function getLatestFinanceReport(): Promise<FinanceReport | null> {
  return safeCall<FinanceReport | null>('getLatestFinanceReport', {}, null)
}

export async function getTransferOrderByReport(reportId: string): Promise<TransferOrder | null> {
  return safeCall<TransferOrder | null>('getTransferOrderByReport', {reportId}, null)
}

export async function confirmTransferOrder(
  orderId: string,
  actualAmount: number,
  confirmedBy: string,
  notes?: string,
): Promise<boolean> {
  return safeCall<boolean>('confirmTransferOrder', {orderId, actualAmount, confirmedBy, notes}, false)
}

export async function skipTransferOrder(orderId: string, notes?: string): Promise<boolean> {
  return safeCall<boolean>('skipTransferOrder', {orderId, notes}, false)
}

export async function writeUsageRecord(
  userId: string,
  type: UsageRecord['type'],
  model: string,
  quantity: number,
  unit: string,
  amountDeducted: number,
  balanceBefore?: number,
  balanceAfter?: number,
  fromPlan = true,
  rawResponse?: unknown,
): Promise<void> {
  await safeCall<boolean>('writeUsageRecord', {
    userId,
    type,
    model,
    quantity,
    unit,
    amountDeducted,
    balanceBefore,
    balanceAfter,
    fromPlan,
    rawResponse,
  }, false)
}

export async function getUserUsageRecords(userId: string, limit = 50, offset = 0): Promise<UsageRecord[]> {
  return safeCall<UsageRecord[]>('getUserUsageRecords', {userId, limit, offset}, [])
}

export async function getUsageSummaryByDay(days = 7): Promise<UsageSummary[]> {
  return safeCall<UsageSummary[]>('getUsageSummaryByDay', {days}, [])
}

export async function getRechargeSummary(): Promise<RechargeSummary> {
  return safeCall<RechargeSummary>('getRechargeSummary', {}, {
    total_amount: 0,
    total_count: 0,
    this_month_amount: 0,
  })
}
