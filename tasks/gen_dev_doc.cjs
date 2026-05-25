/**
 * Luna AI 内容生成平台 — 开发文档生成脚本
 * 输出：tasks/Luna-AI-开发文档.docx
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, LevelFormat, WidthType, BorderStyle,
  ShadingType, VerticalAlign, TableOfContents, PageBreak, Header, Footer, PageNumber
} = require('docx')
const fs = require('fs')
const path = require('path')

// ── 颜色 & 工具 ──────────────────────────────────────────────────
const C = {
  PRIMARY:  '4F46E5',  // 深蓝紫
  HEADER_BG:'EEF0FC',  // 表头背景
  ALT_BG:   'F8F8FF',  // 交替行背景
  BORDER:   'C8C8E0',
  MUTED:    '6B7280',
  WHITE:    'FFFFFF',
  BLACK:    '111111',
}
const border = { style: BorderStyle.SINGLE, size: 1, color: C.BORDER }
const cellBorders = { top: border, bottom: border, left: border, right: border }

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  children: [new TextRun({ text, bold: true, color: C.PRIMARY, size: 32 })]
})
const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  children: [new TextRun({ text, bold: true, color: C.BLACK, size: 26 })]
})
const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  children: [new TextRun({ text, bold: true, color: C.BLACK, size: 24 })]
})
const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 100 },
  children: [new TextRun({ text, size: 22, color: C.BLACK, ...opts })]
})
const note = (text) => new Paragraph({
  spacing: { after: 100 },
  indent: { left: 400 },
  children: [new TextRun({ text: '📝 ' + text, size: 20, color: C.MUTED, italics: true })]
})
const blank = () => new Paragraph({ children: [new TextRun('')], spacing: { after: 60 } })
const br = () => new Paragraph({ children: [new PageBreak()] })

// ── 子弹列表 ─────────────────────────────────────────────────────
const BULLET_REF = 'main-bullet'
const NUMBERED = (ref) => `num-${ref}`

const bullet = (text, indent = 0) => new Paragraph({
  numbering: { reference: BULLET_REF, level: indent },
  spacing: { after: 80 },
  children: [new TextRun({ text, size: 22 })]
})

// ── 两列对比表 ────────────────────────────────────────────────────
const twoColTable = (headers, rows) => new Table({
  columnWidths: [4680, 4680],
  margins: { top: 80, bottom: 80, left: 160, right: 160 },
  rows: [
    // 表头
    new TableRow({
      tableHeader: true,
      children: headers.map(h => new TableCell({
        borders: cellBorders,
        width: { size: 4680, type: WidthType.DXA },
        shading: { fill: C.HEADER_BG, type: ShadingType.CLEAR },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: h, bold: true, size: 22, color: C.PRIMARY })]
        })]
      }))
    }),
    ...rows.map((row, i) => new TableRow({
      children: row.map((cell) => new TableCell({
        borders: cellBorders,
        width: { size: 4680, type: WidthType.DXA },
        shading: { fill: i % 2 === 0 ? C.WHITE : C.ALT_BG, type: ShadingType.CLEAR },
        children: [new Paragraph({
          children: [new TextRun({ text: cell, size: 22 })]
        })]
      }))
    }))
  ]
})

// ── 三列宽表 ──────────────────────────────────────────────────────
const threeColTable = (headers, rows, widths = [2520, 3120, 3720]) => new Table({
  columnWidths: widths,
  margins: { top: 80, bottom: 80, left: 160, right: 160 },
  rows: [
    new TableRow({
      tableHeader: true,
      children: headers.map((h, i) => new TableCell({
        borders: cellBorders,
        width: { size: widths[i], type: WidthType.DXA },
        shading: { fill: C.HEADER_BG, type: ShadingType.CLEAR },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: h, bold: true, size: 22, color: C.PRIMARY })]
        })]
      }))
    }),
    ...rows.map((row, ri) => new TableRow({
      children: row.map((cell, ci) => new TableCell({
        borders: cellBorders,
        width: { size: widths[ci], type: WidthType.DXA },
        shading: { fill: ri % 2 === 0 ? C.WHITE : C.ALT_BG, type: ShadingType.CLEAR },
        children: Array.isArray(cell)
          ? cell.map(c => new Paragraph({ children: [new TextRun({ text: c, size: 22 })] }))
          : [new Paragraph({ children: [new TextRun({ text: cell, size: 22 })] })]
      }))
    }))
  ]
})

// ── 环境变量表 ────────────────────────────────────────────────────
const envTable = (rows) => new Table({
  columnWidths: [3120, 2520, 3720],
  margins: { top: 80, bottom: 80, left: 160, right: 160 },
  rows: [
    new TableRow({
      tableHeader: true,
      children: ['环境变量名', '所属模块', '用途说明'].map((h, i) => new TableCell({
        borders: cellBorders,
        width: { size: [3120, 2520, 3720][i], type: WidthType.DXA },
        shading: { fill: C.HEADER_BG, type: ShadingType.CLEAR },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: h, bold: true, size: 22, color: C.PRIMARY })]
        })]
      }))
    }),
    ...rows.map((row, ri) => new TableRow({
      children: row.map((cell, ci) => new TableCell({
        borders: cellBorders,
        width: { size: [3120, 2520, 3720][ci], type: WidthType.DXA },
        shading: { fill: ri % 2 === 0 ? C.WHITE : C.ALT_BG, type: ShadingType.CLEAR },
        children: [new Paragraph({ children: [new TextRun({ text: cell, size: 22, font: ci === 0 ? 'Courier New' : 'Arial' })] })]
      }))
    }))
  ]
})

// ════════════════════════════════════════════════════════════════
// 正文内容
// ════════════════════════════════════════════════════════════════

const coverChildren = [
  blank(), blank(), blank(),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 600, after: 200 },
    children: [new TextRun({ text: 'Luna AI 内容生成平台', bold: true, size: 72, color: C.PRIMARY })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: '开发技术文档', bold: true, size: 48, color: C.BLACK })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'ClawSolo · Hermes Agent · Supabase', size: 26, color: C.MUTED })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: '版本 v34  |  日期 2026-04-28', size: 24, color: C.MUTED })]
  }),
  br(),
]

const section1 = [
  h1('1. 项目概述'),
  p('Luna AI 是面向自媒体创作者的 AI 内容工作站，以微信小程序为主端，后端接入 Hermes Agent（Luna 2.0），实现文案写作、AI 图片、视频生成、语音合成、小红书公开数据采集与自动化运营等全流程能力。'),
  blank(),
  h2('1.1 技术栈'),
  twoColTable(['层级', '技术选型'], [
    ['前端框架', 'Taro 4.1.10 + React 18 + TypeScript'],
    ['UI 样式', 'Tailwind CSS + @egoist/tailwindcss-icons（mdi/lucide）'],
    ['状态管理', 'Zustand 5'],
    ['后端即服务', 'Supabase（PostgreSQL + Edge Functions + Storage + Auth）'],
    ['AI 核心', 'Hermes Agent（Luna 2.0）— http://152.136.47.2:8642'],
    ['对话接口', 'OpenAI 兼容 /v1/chat/completions，model: hermes-agent'],
    ['视频生成', '豆包 Seedance 1.5 Pro（通过 Hermes 调用）'],
    ['图片生成', 'SiliconFlow Kolors（通过 Hermes 调用）'],
    ['语音合成', 'Edge TTS（通过 Hermes 调用）'],
    ['支付', '微信支付 v3'],
    ['对象存储', '腾讯云 COS + 字节火山 TOS'],
    ['包管理器', 'pnpm'],
  ]),
  blank(),
  h2('1.2 应用路由'),
  threeColTable(['路由路径', '页面名称', '功能说明'], [
    ['pages/chat/index', 'ClawSolo 对话', '主聊天页，接入 arkclaw_chat，展示数据看板'],
    ['pages/features/index', '功能介绍', '产品功能展示页（TabBar）'],
    ['pages/service/index', '客服', '在线客服消息（TabBar）'],
    ['pages/profile/index', '我的', '个人中心（TabBar）'],
    ['pages/login/index', '登录', '微信一键登录'],
    ['pages/pricing/index', '定价', '套餐列表与购买'],
    ['pages/orders/index', '订单', '历史订单列表'],
    ['pages/materials/index', '素材库', '用户素材管理'],
    ['pages/monitor/index', '账号监控', '小红书账号绑定与数据看板'],
    ['pages/account-security/index', '账号安全', '密码修改等'],
    ['pages/settings/index', '设置', '通知、隐私等设置'],
    ['pages/about/index', '关于', '版本信息'],
    ['pages/compute-recharge/index', '算力充值', '余额充值入口'],
    ['pages/admin-finance/index', '财务后台', '管理员财务报表（is_admin 限制）'],
    ['pages/usage-records/index', '用量记录', '个人 AI 消耗明细'],
  ]),
  blank(),
]

const section2 = [
  h1('2. 数据库结构'),
  p('数据库使用 Supabase（PostgreSQL 15），所有表均启用 Row Level Security（RLS）。'),
  blank(),
  h2('2.1 枚举类型'),
  twoColTable(['类型名', '可选值'], [
    ['user_role', 'user | admin'],
    ['membership_level', 'free | graphic | video_starter | video_pro | professional | enterprise'],
    ['order_status', 'pending | paid | completed | cancelled | refunded'],
    ['material_type', 'copywriting | script | work | image'],
    ['analytics_granularity', 'day | week'],
    ['transfer_status', 'pending | confirmed | skipped'],
  ]),
  blank(),
  h2('2.2 数据表总览'),
  threeColTable(['表名', '用途', '关键字段'], [
    ['profiles', '用户主表，同步自 auth.users', 'id, role, membership_level, balance, ai_count, is_admin'],
    ['conversations', '对话会话', 'id, user_id, title'],
    ['messages', '对话消息（含 tokens_used）', 'conversation_id, role, content, tokens_used'],
    ['cs_messages', '客服消息（支持图片）', 'role, content, image_url, message_type, is_read'],
    ['orders', '微信支付订单', 'order_no, plan_level, status, amount, wechat_transaction_id'],
    ['materials', '用户素材', 'type(copywriting/script/work/image), title, content'],
    ['analytics_data', '小红书数据看板（日/周粒度）', 'fans_count, fans_delta, likes_collects_count, top_contents, data_mode'],
    ['analytics_briefs', 'AI 运营简报缓存', 'user_id, date, brief'],
    ['social_accounts', '绑定的社交平台账号', 'platform, red_id, xhs_user_id, profile_url, raw_profile'],
    ['announcements', '系统公告', 'title, content, type, is_active'],
    ['compute_recharges', '算力充值记录', 'order_no, amount, compute_credits, status'],
    ['usage_records', 'AI 用量明细（token/视频/图片）', 'type, model, quantity, unit, amount_deducted, from_plan'],
    ['finance_reports', '每日财务快报（管理员）', 'report_date, yesterday_recharge, volcano_balance, recommended_transfer'],
    ['transfer_orders', '转账指令确认', 'suggested_amount, actual_amount, status, confirmed_by'],
  ]),
  blank(),
  h2('2.3 analytics_data 字段说明（新旧口径）'),
  p('v33 版本起切换为"公开数据口径"，旧字段兼容保留：'),
  threeColTable(['字段名', '口径', '说明'], [
    ['fans_count', '公开', '粉丝总数'],
    ['fans_delta', '公开', '当日粉丝净增'],
    ['follows_count', '公开', '关注数'],
    ['likes_collects_count', '公开', '获赞与收藏总计'],
    ['likes_collects_delta', '公开', '当日获赞收藏增量'],
    ['note_count', '公开', '笔记发布总数'],
    ['public_interactions', '公开', '公开互动数（评论+点赞等）'],
    ['public_interactions_delta', '公开', '当日公开互动增量'],
    ['data_mode', '元数据', '"public" | "authorized"，标记数据来源口径'],
    ['visitors / plays', '兼容旧字段', '保留但不再写入（留给授权口径备用）'],
    ['top_contents', '公开', 'JSON 数组，包含 title/likes/comments/collects/engagement/rank'],
  ]),
  blank(),
]

const section3 = [
  h1('3. Edge Functions（后端服务）'),
  p('所有 Edge Function 均部署在 Supabase Deno 运行时，使用 service_role_key 访问数据库。'),
  blank(),
  h2('3.1 函数清单'),
  threeColTable(['函数名', '触发方式', '核心功能'], [
    ['arkclaw_chat', '前端 supabase.functions.invoke', '主对话中转，接入 Hermes /v1/chat/completions，实现意图预检 → 调 Hermes → 按实际用量扣费（LUNA_META 解析）'],
    ['ai_chat', '前端备用', '轻量文本生成，使用文心一言或 Hermes（可配置）'],
    ['xhs_public_collect', '前端 monitor 页 + 定时任务', '采集小红书公开主页数据，调用 Hermes /xhs/public/resolve + /xhs/public/collect，写入 social_accounts & analytics_data'],
    ['update_analytics', 'Webhook / 定时 POST', '供外部写入趋势数据，触发 Hermes 生成运营简报并存入 analytics_briefs'],
    ['hermes-get-binding-qrcode', '前端', '调用 Hermes 获取绑定二维码（旧方案，已被 xhs_public_collect 取代）'],
    ['generate-binding-qrcode', '前端', '生成账号绑定二维码（兼容旧流程）'],
    ['create_wechat_payment', '前端 pricing 页', '创建微信支付订单，写入 orders 表，返回支付参数'],
    ['wechat_payment_callback', '微信支付回调', '验签 → 更新 order status=paid → 升级 membership_level + 设置 expires'],
    ['wechat_miniapp_login', '前端 login 页', '微信授权码换 openid，注册或登录 Supabase Auth 用户'],
    ['get_wechat_openid', '前端', '获取微信 openid（配合自定义登录）'],
    ['cos_credential', '前端素材上传', '签发腾讯云 COS 临时凭证（STS），用于客户端直传'],
    ['cos_list_files', '前端素材库', '列出用户 COS 存储桶下的文件列表'],
    ['tos_list_files', '前端素材库', '列出字节火山 TOS 文件列表'],
    ['ark_model_pricing', '前端定价页', '查询火山方舟模型的最新定价'],
    ['customer_service', '前端客服页', '消息收发（含图片），调用 Hermes 生成客服回复'],
    ['wenxin-text-generation', '前端 / 内部调用', '调用文心一言大模型生成文本，SSE 流式返回'],
    ['finance-daily-calc', 'Supabase Cron 每日触发', '汇总昨日充值/消耗，查询火山余额，生成 finance_reports，创建 transfer_orders'],
    ['membership_downgrade', 'Supabase Cron 每日触发', '检查过期会员，降级至 free'],
  ]),
  blank(),
  h2('3.2 arkclaw_chat — 计费与扣费逻辑'),
  p('该函数是业务核心，分两阶段处理：'),
  h3('阶段一：预检（调用 Hermes 前）'),
  bullet('解析用户输入意图（文案 / 图片 / 视频 / 普通对话）'),
  bullet('检查剩余配额：video_seconds_used / graphicCount / ai_count'),
  bullet('检查余额（balance）是否足以覆盖估算费用'),
  bullet('不满足条件则直接拒绝，不消耗 Hermes Token 额度'),
  blank(),
  h3('阶段二：扣费（收到 Hermes 回复后）'),
  p('Hermes 回复末尾携带 <!--LUNA_META:{...}--> 标记，包含实际消耗量：'),
  bullet('优先级 1：回复末尾 LUNA_META 标记（最准确，Hermes 主动上报）'),
  bullet('优先级 2：hermesData.metadata 结构化字段'),
  bullet('优先级 3：根据意图类型用默认值估算'),
  p('按实际用量写入 usage_records，更新 profiles.balance / video_seconds_used / ai_count。'),
  blank(),
  h2('3.3 xhs_public_collect — 小红书采集流程'),
  p('接收参数：profile_url | red_id | nickname（至少一项）'),
  bullet('Step 1：本地解析 profile_url，提取 xhs_user_id（正则匹配，不依赖 Hermes）'),
  bullet('Step 2：调用 Hermes POST /xhs/public/resolve（失败可降级）'),
  bullet('Step 3：调用 Hermes POST /xhs/public/collect（15 秒超时，失败返回 502）'),
  bullet('Step 4：解析 collectData → fans_count / likes_collects_count / note_count / top_contents 等'),
  bullet('Step 5：upsert social_accounts（按 user_id + platform 判断新增/更新）'),
  bullet('Step 6：计算增量（fans_delta = 新 fans_count - 上一条记录的 fans_count），写入 analytics_data'),
  note('采集失败时直接返回 502 + 具体错误文案，不保存空数据。前端展示可读的中文错误。'),
  blank(),
]

const section4 = [
  h1('4. 套餐与计费体系'),
  blank(),
  h2('4.1 会员套餐'),
  new Table({
    columnWidths: [2000, 1600, 1760, 1760, 2240],
    margins: { top: 80, bottom: 80, left: 160, right: 160 },
    rows: [
      new TableRow({
        tableHeader: true,
        children: ['套餐名', '月价（元）', '图文条数', '视频秒数', '特色'].map((h, i) => new TableCell({
          borders: cellBorders,
          width: { size: [2000,1600,1760,1760,2240][i], type: WidthType.DXA },
          shading: { fill: C.HEADER_BG, type: ShadingType.CLEAR },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, size: 22, color: C.PRIMARY })] })]
        }))
      }),
      ...([
        ['免费版 (free)', '0', '8 条', '—', '先体验再决定'],
        ['图文版 (graphic)', '299', '50 条', '—', '图文创作'],
        ['视频新手 (video_starter)', '399', '40 条', '120 s (≈4 条)', '入门视频'],
        ['视频达人 (video_pro)', '599', '30 条', '280 s (≈9 条)', '高频视频'],
        ['专业版 (professional)', '1599', '60 条', '800 s (≈26 条)', '全能专业'],
        ['企业版 (enterprise)', '2999', '100 条', '1200 s (≈40 条)', '团队/多账号'],
      ]).map((row, ri) => new TableRow({
        children: row.map((cell, ci) => new TableCell({
          borders: cellBorders,
          width: { size: [2000,1600,1760,1760,2240][ci], type: WidthType.DXA },
          shading: { fill: ri % 2 === 0 ? C.WHITE : C.ALT_BG, type: ShadingType.CLEAR },
          children: [new Paragraph({ children: [new TextRun({ text: cell, size: 22 })] })]
        }))
      }))
    ]
  }),
  blank(),
  h2('4.2 计费规则'),
  bullet('视频生成：按秒计费（从 video_seconds_used 扣减），约 30 s/条'),
  bullet('图文生成：按条计费（从 graphicCount 扣减）'),
  bullet('普通对话：按次计费（ai_count），余额不足时从 balance 扣余额'),
  bullet('usage_period_start：每月重置计数，由 membership_downgrade 函数处理'),
  blank(),
]

const section5 = [
  h1('5. 环境变量清单'),
  p('以下变量需在 Supabase Dashboard → Project Settings → Edge Functions → Secrets 中配置：'),
  blank(),
  envTable([
    ['HERMES_BASE_URL', '全局 AI', 'Hermes Agent 地址，默认 http://152.136.47.2:8642'],
    ['HERMES_API_KEY', '全局 AI', 'Hermes Bearer Token（bWmhP67e…）'],
    ['HERMES_MODEL', '全局 AI', '模型名，默认 hermes-agent'],
    ['ANALYTICS_WRITE_SECRET', 'update_analytics', 'Webhook 写入密钥'],
    ['ARKCLAW_API_TOKEN', 'arkclaw_chat', '对话函数鉴权 Token'],
    ['WECHAT_MINIPROGRAM_LOGIN_APP_ID', '微信登录', '小程序 AppID'],
    ['WECHAT_MINIPROGRAM_LOGIN_APP_SECRET', '微信登录', '小程序 AppSecret'],
    ['MERCHANT_APP_ID', '微信支付', '商户 AppID'],
    ['MERCHANT_ID', '微信支付', '商户号（mch_id）'],
    ['MCH_API_V3_KEY', '微信支付', 'V3 API 密钥'],
    ['MCH_CERT_SERIAL_NO', '微信支付', '证书序列号'],
    ['MCH_PRIVATE_KEY', '微信支付', '商户私钥（PEM 格式）'],
    ['WECHAT_PAY_PUBLIC_KEY', '微信支付', '微信支付公钥'],
    ['WECHAT_PAY_PUBLIC_KEY_ID', '微信支付', '公钥 ID'],
    ['TENCENT_SECRET_ID', 'COS', '腾讯云 SecretId（COS STS 签发）'],
    ['TENCENT_SECRET_KEY', 'COS', '腾讯云 SecretKey'],
    ['COS_BUCKET', 'COS', 'Bucket 名称'],
    ['COS_REGION', 'COS', '地域，如 ap-guangzhou'],
    ['TOS_ACCESS_KEY_ID', 'TOS', '火山 TOS AccessKeyId'],
    ['TOS_SECRET_ACCESS_KEY', 'TOS', '火山 TOS SecretAccessKey'],
    ['TOS_BUCKET_NAME', 'TOS', 'TOS Bucket 名称'],
    ['TOS_REGION', 'TOS', 'TOS 地域'],
    ['VOLCANO_ACCESS_KEY', '财务', '火山方舟 AccessKey（查询余额）'],
    ['VOLCANO_SECRET_KEY', '财务', '火山方舟 SecretKey'],
    ['THIRD_PARTY_LOGIN_APP_ID', '登录', '第三方登录 AppID（可选）'],
    ['WX_OPEN_CFC_JWT_TOKEN', '微信开放平台', 'JWT Token'],
    ['SUPABASE_URL', '内置', '自动注入，无需手动配置'],
    ['SUPABASE_SERVICE_ROLE_KEY', '内置', '自动注入，无需手动配置'],
    ['INTEGRATIONS_API_KEY', '平台托管', '平台自动注入，严禁手动注册或暴露给前端'],
  ]),
  blank(),
]

const section6 = [
  h1('6. 前端架构说明'),
  blank(),
  h2('6.1 目录结构'),
  twoColTable(['目录 / 文件', '说明'], [
    ['src/app.tsx', 'Taro 入口，包裹 AuthContext'],
    ['src/app.config.ts', '路由注册、TabBar 配置'],
    ['src/client/supabase.ts', 'Supabase 客户端单例（含 wechat adapter）'],
    ['src/db/types.ts', '全部 TypeScript 类型定义（Profile / Order / AnalyticsData 等）'],
    ['src/db/api.ts', '封装 Supabase CRUD 操作的 TS 函数'],
    ['src/contexts/AuthContext.tsx', '全局认证状态（user / profile / loading）'],
    ['src/pages/chat/', '主聊天页 + 数据看板'],
    ['src/pages/monitor/', '小红书账号绑定与公开数据展示'],
    ['src/pages/pricing/', '套餐购买、微信支付调起'],
    ['src/pages/admin-finance/', '管理员财务报表（仅 is_admin 可见）'],
    ['src/pages/features/', '功能介绍落地页（TabBar）'],
    ['src/components/RouteGuard.tsx', '登录态守卫，未登录跳转 login 页'],
  ]),
  blank(),
  h2('6.2 认证流程'),
  bullet('微信小程序：wx.login() 获取 code → 调 get_wechat_openid → Supabase signInWithPassword（openid 作为 identifier）'),
  bullet('首次登录自动注册，触发 handle_new_user() 触发器写入 profiles'),
  bullet('AuthContext 监听 onAuthStateChange，刷新 profile 状态'),
  bullet('第一个注册用户自动成为 admin（role = \'admin\'）'),
  blank(),
  h2('6.3 chat 页面数据看板'),
  p('chat 页面顶部展示账号监控数据，数据来源 analytics_data 表（granularity=\'day\'，按 date 降序取最近 7 条）：'),
  bullet('趋势折线图：fans_count（粉丝总数）、public_interactions（公开互动）'),
  bullet('四大指标卡：粉丝数 / 粉丝净增（fans_delta）/ 获赞收藏（likes_collects_count）/ 公开互动'),
  bullet('Top3 内容：按 engagement（likes+comments+collects）降序排列'),
  bullet('AI 运营简报：从 analytics_briefs 表读取，若无则展示占位文案'),
  blank(),
  h2('6.4 monitor 页面绑定流程'),
  bullet('用户输入小红书主页链接 / 小红书号 / 昵称'),
  bullet('调用 xhs_public_collect Edge Function，传入 profile_url / red_id / nickname'),
  bullet('成功后展示：昵称、头像、粉丝数、获赞收藏、笔记数、Top3 内容'),
  bullet('同步按钮调用相同 Function，刷新今日数据'),
  blank(),
]

const section7 = [
  h1('7. 设计系统'),
  blank(),
  h2('7.1 主题色'),
  twoColTable(['CSS 变量', '用途'], [
    ['--primary: 243 67% 57%', '深蓝紫，主按钮/强调/图标'],
    ['--background: 240 38% 95%', '淡薰衣草蓝背景'],
    ['--card: 0 0% 100%', '纯白卡片'],
    ['--foreground: 240 30% 15%', '深靛色正文'],
    ['--muted-foreground: 240 18% 48%', '灰蓝辅助文字'],
    ['--border: 240 25% 86%', '边框色'],
  ]),
  blank(),
  h2('7.2 Banner 像素风格规范'),
  p('顶部 Banner 使用统一像素工业风（Pixel-Infused Rationalism）：'),
  bullet('深蓝渐变背景：linear-gradient(135deg, hsl(222 90% 14%), hsl(215 80% 26%))'),
  bullet('像素网格底纹：20px × 20px，rgba(100,180,255,0.4)，opacity 0.20'),
  bullet('扫光横线：从左到右渐隐渐现'),
  bullet('主标题：36px monospace，3px letter-spacing，多层 text-shadow（蓝色 2px/4px/6px/8px offset + glow）'),
  bullet('底部像素点线：repeating-linear-gradient，蓝色虚线，高度 3px'),
  blank(),
  h2('7.3 图标系统'),
  bullet('使用 Iconify MDI 图标集：@iconify-json/mdi'),
  bullet('用法：className="i-mdi-{icon-name}" 配合 text-primary / text-muted-foreground 等颜色类'),
  blank(),
]

const section8 = [
  h1('8. 数据库迁移历史'),
  threeColTable(['迁移文件', '版本', '内容摘要'], [
    ['00001_initial_schema.sql', 'v1', '建立 profiles/conversations/messages/cs_messages/orders/materials 表，RLS 策略，handle_new_user 触发器'],
    ['00002_add_rpc_and_policies.sql', 'v2', 'increment_ai_count RPC，补全 orders/materials/cs_messages RLS'],
    ['00003_create_analytics_data_table.sql', 'v3', '建立 analytics_data 表（旧字段口径：visitors/new_followers/plays）'],
    ['00004_cs_messages_image_support.sql', 'v4', 'cs_messages 增加 image_url / message_type 字段'],
    ['00005_social_accounts_announcements_compute.sql', 'v5', '建立 social_accounts / announcements / compute_recharges 表'],
    ['00006_*.sql', 'v6', '存储桶、COS 字段、用量追踪等（多次迭代）'],
    ['00007_create_finance_system.sql', 'v7', '建立 finance_reports / transfer_orders 表，profiles 增 is_admin'],
    ['00008_setup_finance_cron.sql', 'v8', '设置每日财务计算 Cron（pg_cron）'],
    ['00009_add_cos_fields_to_profiles.sql', 'v9', 'profiles 增 cos_space_initialized / cos_initialized_at'],
    ['00010_add_usage_tracking.sql', 'v10', '建立 usage_records 表（AI 用量明细）'],
    ['00011_membership_downgrade_cron.sql', 'v11', '设置会员降级 Cron'],
    ['00012_create_chat_attachments_bucket.sql', 'v12', '创建 chat-attachments Storage Bucket'],
    ['00013_create_analytics_briefs.sql', 'v13', '建立 analytics_briefs 表（AI 运营简报缓存）'],
    ['00014_allow_user_write_analytics_data.sql', 'v14', '为 analytics_data 添加用户写入 RLS 策略'],
    ['00015_create_qrcodes_bucket.sql', 'v15', '创建 qrcodes Storage Bucket'],
    ['00016_xhs_public_data_fields.sql', 'v16', 'social_accounts 增 profile_url/red_id/xhs_user_id/last_sync_at/raw_profile；analytics_data 增 fans_count/fans_delta/likes_collects_count 等公开口径字段'],
  ]),
  blank(),
]

const section9 = [
  h1('9. 常见问题 & 注意事项'),
  blank(),
  h2('9.1 Hermes 网络连通性'),
  p('Hermes Agent 部署在腾讯云 CVM（152.136.47.2:8642），Deno Deploy 出口 IP 有时被安全组拦截。若 Edge Function 调用 Hermes 超时，需在 CVM 安全组放行 Deno Deploy 出口 IP 段。'),
  blank(),
  h2('9.2 小红书采集限制'),
  p('xhs_public_collect 仅采集公开主页数据（粉丝数、获赞收藏、笔记数、Top 内容）。无法获取访客数、播放量、曝光量等后台私有指标，Hermes AI 运营简报的提示词已作相应约束，避免输出不准确的后台指标。'),
  blank(),
  h2('9.3 INTEGRATIONS_API_KEY 使用规范'),
  p('平台托管 Skill 使用 INTEGRATIONS_API_KEY，该 Key 由平台自动注入，严禁：'),
  bullet('通过 register_secrets 手动注册此 Key'),
  bullet('暴露给前端代码（必须只在 Edge Function 内使用）'),
  blank(),
  h2('9.4 LUNA_META 标记格式'),
  p('Hermes 在生成视频/图片后，在回复末尾追加：'),
  new Paragraph({
    spacing: { after: 100 },
    indent: { left: 400 },
    children: [new TextRun({
      text: '<!--LUNA_META:{"type":"video","seconds":30,"model":"seedance"}-->',
      font: 'Courier New', size: 20, color: C.PRIMARY
    })]
  }),
  p('arkclaw_chat 函数解析此标记确定实际扣费量，确保按真实消耗计费。'),
  blank(),
  h2('9.5 微信支付回调安全'),
  p('wechat_payment_callback 使用微信 V3 公钥验签（RSA-OAEP-256），验签通过后才更新订单状态，并用 version 字段做乐观锁防重复处理。'),
  blank(),
]

// ════════════════════════════════════════════════════════════════
// 组装文档
// ════════════════════════════════════════════════════════════════

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 }
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 }
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 }
      },
    ]
  },
  numbering: {
    config: [
      {
        reference: BULLET_REF,
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 360 } } } },
        ]
      }
    ]
  },
  sections: [
    // ── 封面 ──
    {
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: coverChildren
    },
    // ── 目录 ──
    {
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: '目录', bold: true, size: 36, color: C.PRIMARY })]
        }),
        new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-2' }),
        br(),
      ]
    },
    // ── 正文 ──
    {
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'Luna AI 内容生成平台 — 开发技术文档 v34', size: 18, color: C.MUTED })]
        })] })
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: '第 ', size: 18, color: C.MUTED }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: C.MUTED }),
            new TextRun({ text: ' 页', size: 18, color: C.MUTED }),
          ]
        })] })
      },
      children: [
        ...section1, br(),
        ...section2, br(),
        ...section3, br(),
        ...section4, br(),
        ...section5, br(),
        ...section6, br(),
        ...section7, br(),
        ...section8, br(),
        ...section9,
      ]
    }
  ]
})

Packer.toBuffer(doc).then(buf => {
  const out = path.join(__dirname, 'Luna-AI-开发文档.docx')
  fs.writeFileSync(out, buf)
  console.log('✅ 文档已生成：', out)
})
