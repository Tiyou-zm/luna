
-- 删除 cs-images 旧的开放策略（任何人都能查看/上传）
DROP POLICY IF EXISTS "Anyone can view cs images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload cs images" ON storage.objects;

-- 新增：用户只能 SELECT 自己 user_id 路径下的文件
CREATE POLICY "cs_images_user_select"
ON storage.objects
FOR SELECT
TO public
USING (
  bucket_id = 'cs-images'
  AND (storage.foldername(name))[1] = (uid())::text
);

-- 新增：用户只能 INSERT 到自己 user_id 路径下
CREATE POLICY "cs_images_user_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'cs-images'
  AND (storage.foldername(name))[1] = (uid())::text
);

-- 新增：用户只能 DELETE 自己 user_id 路径下的文件
CREATE POLICY "cs_images_user_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'cs-images'
  AND (storage.foldername(name))[1] = (uid())::text
);

-- 清理 materials 表重复的 RLS 策略
DROP POLICY IF EXISTS "Users can manage own materials" ON public.materials;
