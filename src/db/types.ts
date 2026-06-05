// 数据库类型定义

export type MembershipLevel = 'trial' | 'free' | 'graphic' | 'video_starter' | 'video_pro' | 'professional' | 'enterprise'
export type UserRole = 'user' | 'admin'
export type OrderStatus = 'pending' | 'paid' | 'completed' | 'cancelled' | 'refunded'
export type MaterialType = 'copywriting' | 'script' | 'work' | 'image' | 'analysis' | 'archive'
export type AnalyticsGranularity = 'day' | 'week'
export type TransferStatus = 'pending' | 'confirmed' | 'skipped'

export interface TopContent {
  title: string
  plays: number
  rank: number
  // 公开数据口径
  likes?: number
  comments?: number
  collects?: number
  engagement?: number  // likes + comments + collects 合计
}

export interface AnalyticsData {
  id: string
  user_id: string
  date: string
  granularity: AnalyticsGranularity
  // 旧字段（兼容保留）
  visitors: number
  new_followers: number
  plays: number
  interactions: number
  publish_count: number
  call_count: number
  top_contents: TopContent[]
  raw_data: Record<string, unknown>
  source: string
  // 公开数据口径新字段
  fans_count: number
  fans_delta: number
  follows_count: number
  likes_collects_count: number
  likes_collects_delta: number
  note_count: number
  public_interactions: number
  public_interactions_delta: number
  data_mode: string  // 'public' | 'authorized'
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  username: string | null
  nickname: string | null
  avatar_url: string | null
  openid: string | null
  role: UserRole
  membership_level: MembershipLevel
  membership_expires: string | null
  balance: number
  ai_count: number
  video_seconds_used: number
  graphic_count_used: number
  usage_period_start: string | null
  bound_accounts: number
  phone: string | null
  is_admin: boolean
  cos_space_initialized: boolean
  cos_initialized_at: string | null
  created_at: string
  updated_at: string
}

export interface Conversation {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  conversation_id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  tokens_used: number
  created_at: string
}

export interface CsMessage {
  id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  image_url?: string | null
  message_type: 'text' | 'image' | 'mixed'
  is_read: boolean
  created_at: string
}

export interface Order {
  id: string
  order_no: string
  user_id: string
  openid: string
  plan_name: string
  plan_level: MembershipLevel
  status: OrderStatus
  amount: number
  wechat_transaction_id: string | null
  version: number
  paid_at: string | null
  created_at: string
  updated_at: string
}

export interface PackagePlatformResult {
  titles: string[]
  body: string
  cover_suggestion: string
  image_prompts: string[]
  hashtags: string[]
  best_time: string
  ad_advice: string
  risk_warning: string
  fact_check_notes?: string
  delivery_logic?: string
  push_advice?: string
  duration?: number | string
  hook?: string
  sections?: Array<Record<string, unknown>>
}

export interface PackageConfig {
  mode: 'material' | 'direction'
  platforms: string[]
  goal: string
  industry?: string
  task_type: string
  version?: string
  delivery_mode?: string | null
  provider?: string
  generation_job_id?: string
  repair_used?: boolean
}

export interface Material {
  id: string
  user_id: string
  type: MaterialType
  title: string
  content: string | null
  package_config: PackageConfig | null
  package_result: Record<string, PackagePlatformResult> | null
  source_mode: 'material' | 'direction' | null
  library_section?: 'copy' | 'video' | 'strategy' | 'asset' | 'archive'
  parent_material_id?: string
  platform_label?: string
  metadata?: Record<string, unknown>
  url?: string
  key?: string
  sizeStr?: string
  workflow?: Record<string, unknown> | null
  trending_research?: Record<string, unknown> | null
  content_strategy?: Record<string, unknown> | null
  assets?: Record<string, unknown> | null
  package_archive?: Record<string, unknown> | null
  qa?: Record<string, unknown> | null
  final_checks?: Record<string, unknown> | null
  created_at: string
}

// 套餐定义
export interface GenerationJob {
  id: string
  user_id: string
  openid?: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  title: string
  mode: 'material' | 'direction'
  user_message: string
  material_text?: string | null
  industry?: string | null
  goal: string
  platforms: string[]
  attachments?: Array<Record<string, unknown>>
  progress_text?: string | null
  result_material_id?: string | null
  error_message?: string | null
  created_at: string
  updated_at: string
  started_at?: string | null
  finished_at?: string | null
}

export interface SocialAccount {
  id: string
  user_id: string
  platform: string
  account_name: string
  account_id: string | null
  avatar_url: string | null
  follower_count: number
  is_active: boolean
  // 小红书公开数据字段
  profile_url: string | null
  red_id: string | null
  xhs_user_id: string | null
  last_sync_at: string | null
  raw_profile: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface Announcement {
  id: string
  title: string
  content: string
  type: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ComputeRecharge {
  id: string
  user_id: string
  order_no: string
  amount: number
  compute_credits: number
  status: string
  wechat_transaction_id: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
}

export interface TosFile {
  key: string
  name: string
  size: number
  sizeStr: string
  category: 'image' | 'video' | 'audio' | 'document' | 'data' | 'other'
  lastModified: string
  url: string
}

// ===== 腾讯云COS文件 =====
export interface CosFile {
  key: string
  name: string
  size: number
  sizeStr: string
  category: 'image' | 'video' | 'audio' | 'document' | 'data' | 'other'
  lastModified: string
  type: 'upload' | 'output' | 'other'  // uploads/ 或 outputs/ 目录
  url: string
}

// ===== 财务系统 =====
export interface FinanceReport {
  id: string
  report_date: string
  yesterday_recharge: number
  yesterday_consumption: number
  total_tokens_used: number
  video_seconds_total: number
  graphic_count_total: number
  usage_deducted_total: number
  volcano_balance: number
  volcano_api_error: string | null
  predicted_3day_consumption: number
  safety_gap: number
  recommended_transfer: number
  suggested_transfer_rounded: number
  new_users_count: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface TransferOrder {
  id: string
  report_id: string
  suggested_amount: number
  actual_amount: number | null
  status: TransferStatus
  confirmed_at: string | null
  confirmed_by: string | null
  notes: string | null
  created_at: string
}

export interface PlanOption {
  id: MembershipLevel
  name: string
  price: number
  packageCount: number       // 素材包生成次数
  trendCount: number | null  // 趋势研究次数
  imageCount: number         // 图片生成额度
  videoSeconds: number | null
  videoCount: number | null
  graphicCount: number       // 保留旧字段兼容
  highlight: string
  icon: string
}

export const PLANS: PlanOption[] = [
  {
    id: 'trial',
    name: '试用版',
    price: 6.66,
    packageCount: 999999,
    trendCount: 999999,
    imageCount: 999999,
    graphicCount: 999999,
    videoSeconds: 999999,
    videoCount: null,
    highlight: '一次完整素材包试用，含文案、脚本、投放建议与素材库归档',
    icon: 'i-mdi-rocket-launch-outline'
  },
  {
    id: 'free',
    name: '免费版',
    price: 0,
    packageCount: 5,
    trendCount: null,
    imageCount: 10,
    graphicCount: 8,
    videoSeconds: null,
    videoCount: null,
    highlight: '5次素材包免费体验',
    icon: 'i-mdi-gift-outline'
  },
  {
    id: 'graphic',
    name: '图文版',
    price: 299,
    packageCount: 50,
    trendCount: 5,
    imageCount: 100,
    graphicCount: 50,
    videoSeconds: null,
    videoCount: null,
    highlight: '图文内容全平台覆盖',
    icon: 'i-mdi-image-text'
  },
  {
    id: 'video_starter',
    name: '视频新手',
    price: 399,
    packageCount: 40,
    trendCount: 10,
    imageCount: 80,
    graphicCount: 40,
    videoSeconds: 120,
    videoCount: 4,
    highlight: '入门视频创作，含趋势分析',
    icon: 'i-mdi-video-outline'
  },
  {
    id: 'video_pro',
    name: '视频达人',
    price: 599,
    packageCount: 80,
    trendCount: 20,
    imageCount: 150,
    graphicCount: 30,
    videoSeconds: 280,
    videoCount: 9,
    highlight: '高频视频产出，趋势深度研究',
    icon: 'i-mdi-diamond-outline'
  },
  {
    id: 'professional',
    name: '专业版',
    price: 1599,
    packageCount: 200,
    trendCount: 60,
    imageCount: 400,
    graphicCount: 60,
    videoSeconds: 800,
    videoCount: 26,
    highlight: '全能专业，多账号运营首选',
    icon: 'i-mdi-crown-outline'
  },
  {
    id: 'enterprise',
    name: '企业版',
    price: 2999,
    packageCount: 500,
    trendCount: 150,
    imageCount: 1000,
    graphicCount: 100,
    videoSeconds: 1200,
    videoCount: 40,
    highlight: '团队协作，批量素材生产',
    icon: 'i-mdi-office-building-outline'
  }
]

export const MEMBERSHIP_LABELS: Record<MembershipLevel, string> = {
  trial: '试用版',
  free: '免费版',
  graphic: '图文版',
  video_starter: '视频新手版',
  video_pro: '视频达人版',
  professional: '专业版',
  enterprise: '企业版'
}

export const ACTIVE_PLANS: PlanOption[] = PLANS.filter((plan) => plan.id === 'trial')

export interface UsageRecord {
  id: string
  user_id: string
  type: 'video' | 'image' | 'audio' | 'text'
  model: string | null
  quantity: number
  unit: string
  amount_deducted: number
  balance_before: number | null
  balance_after: number | null
  from_plan: boolean
  raw_response: string | null
  created_at: string
}

// 用量统计汇总（按日聚合）
export interface UsageSummary {
  date: string
  video_seconds: number
  graphic_count: number
  total_deducted: number
  record_count: number
}

// 充值总额统计
export interface RechargeSummary {
  total_amount: number
  total_count: number
  this_month_amount: number
}
