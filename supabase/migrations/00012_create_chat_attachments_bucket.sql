
-- chat 对话附件存储桶
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- 已登录用户可上传自己的文件
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_attachments_insert'
  ) THEN
    EXECUTE 'CREATE POLICY "chat_attachments_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''chat-attachments'' AND (storage.foldername(name))[1] = auth.uid()::text)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'chat_attachments_select'
  ) THEN
    EXECUTE 'CREATE POLICY "chat_attachments_select" ON storage.objects FOR SELECT TO public USING (bucket_id = ''chat-attachments'')';
  END IF;
END $$;
