-- 创建 qrcodes 存储桶（公开读取）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'qrcodes',
  'qrcodes',
  true,
  1048576,  -- 1MB
  ARRAY['image/png']
)
ON CONFLICT (id) DO NOTHING;

-- 公开读取策略
CREATE POLICY "Public read qrcodes"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'qrcodes');

-- 认证用户写入策略（Edge Function 用 service role，无需此策略，但加上方便测试）
CREATE POLICY "Service role write qrcodes"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'qrcodes');
