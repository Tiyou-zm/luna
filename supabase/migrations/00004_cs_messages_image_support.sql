-- 添加图片支持字段
ALTER TABLE cs_messages
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text';

-- 创建客服图片存储桶
INSERT INTO storage.buckets (id, name, public)
VALUES ('cs-images', 'cs-images', true)
ON CONFLICT (id) DO NOTHING;

-- 存储桶访问策略
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upload cs images'
      AND tablename = 'objects' AND schemaname = 'storage'
  ) THEN
    CREATE POLICY "Authenticated users can upload cs images"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'cs-images');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view cs images'
      AND tablename = 'objects' AND schemaname = 'storage'
  ) THEN
    CREATE POLICY "Anyone can view cs images"
      ON storage.objects FOR SELECT TO public
      USING (bucket_id = 'cs-images');
  END IF;
END $$;