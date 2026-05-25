
-- profiles 表新增 is_admin 字段
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- finance_reports 每日财务报告表
CREATE TABLE finance_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_date DATE NOT NULL UNIQUE,
  yesterday_recharge DECIMAL(14,2) DEFAULT 0,       -- 昨日用户充值总额
  yesterday_consumption DECIMAL(14,2) DEFAULT 0,    -- 昨日消耗估算
  total_tokens_used BIGINT DEFAULT 0,               -- 昨日总 Token 消耗
  volcano_balance DECIMAL(14,2) DEFAULT 0,          -- 火山账户当前余额
  volcano_api_error TEXT,                           -- 火山 API 错误信息
  predicted_3day_consumption DECIMAL(14,2) DEFAULT 0, -- 未来3天预测消耗
  safety_gap DECIMAL(14,2) DEFAULT 0,               -- 安全线缺口
  recommended_transfer DECIMAL(14,2) DEFAULT 0,     -- 精确建议转账额
  suggested_transfer_rounded DECIMAL(14,2) DEFAULT 0, -- 取整后建议转账额
  new_users_count INT DEFAULT 0,                    -- 昨日新增用户数
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- transfer_orders 转账指令与确认表
CREATE TABLE transfer_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id UUID REFERENCES finance_reports(id) ON DELETE CASCADE,
  suggested_amount DECIMAL(14,2) NOT NULL,         -- 建议转账额（取整）
  actual_amount DECIMAL(14,2),                     -- 实际转账额
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'skipped')),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_finance_reports_date ON finance_reports(report_date DESC);
CREATE INDEX idx_transfer_orders_report ON transfer_orders(report_id);
CREATE INDEX idx_transfer_orders_status ON transfer_orders(status);

-- RLS
ALTER TABLE finance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_orders ENABLE ROW LEVEL SECURITY;

-- 仅管理员可访问财务表
CREATE POLICY "admin_finance_reports_all" ON finance_reports
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "admin_transfer_orders_all" ON transfer_orders
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Service role 也需要写入权限（Edge Function 使用 service_role）
CREATE POLICY "service_finance_reports_insert" ON finance_reports
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "service_transfer_orders_insert" ON transfer_orders
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
