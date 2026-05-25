-- 社交账号绑定表
CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'xiaohongshu',
  account_name TEXT NOT NULL,
  account_id TEXT,
  avatar_url TEXT,
  follower_count INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own social accounts"
  ON social_accounts FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 系统公告表
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active announcements"
  ON announcements FOR SELECT TO authenticated
  USING (is_active = true);

-- 算力充值记录表
CREATE TABLE IF NOT EXISTS compute_recharges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_no TEXT NOT NULL UNIQUE DEFAULT 'CR' || to_char(NOW(), 'YYYYMMDDHH24MISS') || floor(random() * 10000)::TEXT,
  amount NUMERIC(10,2) NOT NULL,
  compute_credits NUMERIC(10,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  wechat_transaction_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE compute_recharges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own compute recharges"
  ON compute_recharges FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own compute recharges"
  ON compute_recharges FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 添加到 realtime 发布
ALTER PUBLICATION supabase_realtime ADD TABLE social_accounts;