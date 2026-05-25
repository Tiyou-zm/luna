
-- profiles 新增用量跟踪字段
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS video_seconds_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS graphic_count_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_period_start TIMESTAMPTZ;

-- usage_records: 每次生成消耗明细
CREATE TABLE IF NOT EXISTS usage_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN ('video', 'image', 'audio', 'text')),
  model           TEXT,
  quantity        NUMERIC NOT NULL DEFAULT 0,   -- 视频:秒数, 图片:张数, 文字:token数
  unit            TEXT NOT NULL DEFAULT 'count', -- 'seconds' | 'count' | 'tokens'
  amount_deducted NUMERIC NOT NULL DEFAULT 0,   -- 实际扣费金额(元)
  balance_before  NUMERIC,
  balance_after   NUMERIC,
  from_plan       BOOLEAN NOT NULL DEFAULT false, -- true=套餐配额扣减, false=balance扣减
  raw_response    TEXT,  -- Hermes原始返回片段(便于核对)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_records_user_id_idx ON usage_records(user_id);
CREATE INDEX IF NOT EXISTS usage_records_created_at_idx ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS usage_records_type_idx ON usage_records(type);

-- finance_reports 新增用量统计字段
ALTER TABLE finance_reports
  ADD COLUMN IF NOT EXISTS video_seconds_total NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS graphic_count_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_deducted_total NUMERIC NOT NULL DEFAULT 0;

-- RLS
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "用户查看自己的用量" ON usage_records
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "仅服务端写入" ON usage_records
  FOR INSERT WITH CHECK (true);
