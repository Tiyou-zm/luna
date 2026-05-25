-- 趋势数据看板表
CREATE TABLE IF NOT EXISTS public.analytics_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  granularity text NOT NULL DEFAULT 'day' CHECK (granularity IN ('day','week')),
  visitors integer NOT NULL DEFAULT 0,
  new_followers integer NOT NULL DEFAULT 0,
  plays integer NOT NULL DEFAULT 0,
  interactions integer NOT NULL DEFAULT 0,
  publish_count integer NOT NULL DEFAULT 0,
  call_count integer NOT NULL DEFAULT 0,
  top_contents jsonb NOT NULL DEFAULT '[]',
  raw_data jsonb NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'xiaohongshu',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date, granularity)
);

-- RLS
ALTER TABLE public.analytics_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "用户只能查看自己的数据" ON public.analytics_data
  FOR SELECT USING (auth.uid() = user_id);

-- 写入由 service_role 负责（Edge Function update_analytics 使用 service_role）
-- 用户不能直接写入
CREATE POLICY "只允许服务角色写入" ON public.analytics_data
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 索引
CREATE INDEX IF NOT EXISTS idx_analytics_user_date ON public.analytics_data (user_id, date DESC, granularity);

-- 添加到 realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.analytics_data;