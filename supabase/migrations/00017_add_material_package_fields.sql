
-- materials 表新增素材包生成相关字段
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS package_config  JSONB,
  ADD COLUMN IF NOT EXISTS package_result  JSONB,
  ADD COLUMN IF NOT EXISTS source_mode     TEXT CHECK (source_mode IN ('material','direction'));

-- 为素材包结果加索引，方便按 type=work 快速查询
CREATE INDEX IF NOT EXISTS idx_materials_type_user ON materials(user_id, type, created_at DESC);
