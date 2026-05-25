-- RPC: 增加AI使用次数
CREATE OR REPLACE FUNCTION increment_ai_count(user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  UPDATE profiles SET ai_count = ai_count + 1 WHERE id = user_id;
$$;

-- 确保orders表有正确的RLS策略
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'Users can view own orders'
  ) THEN
    CREATE POLICY "Users can view own orders" ON public.orders
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- 确保materials表有RLS
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'materials' AND policyname = 'Users can manage own materials'
  ) THEN
    CREATE POLICY "Users can manage own materials" ON public.materials
      FOR ALL TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- 确保cs_messages表有RLS
ALTER TABLE public.cs_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cs_messages' AND policyname = 'Users can manage own cs messages'
  ) THEN
    CREATE POLICY "Users can manage own cs messages" ON public.cs_messages
      FOR ALL TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;