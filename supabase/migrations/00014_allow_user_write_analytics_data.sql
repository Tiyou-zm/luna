-- 允许已登录用户向 analytics_data 插入/更新自己的数据
CREATE POLICY "用户可写入自己的分析数据"
ON analytics_data
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户可更新自己的分析数据"
ON analytics_data
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);