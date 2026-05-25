
-- social_accounts 增加小红书公开数据字段
ALTER TABLE social_accounts
  ADD COLUMN IF NOT EXISTS profile_url       TEXT,
  ADD COLUMN IF NOT EXISTS red_id            TEXT,
  ADD COLUMN IF NOT EXISTS xhs_user_id       TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_profile       JSONB DEFAULT '{}';

-- analytics_data 增加公开数据口径字段
ALTER TABLE analytics_data
  ADD COLUMN IF NOT EXISTS fans_count                 INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fans_delta                 INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS follows_count              INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes_collects_count       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes_collects_delta       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note_count                 INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS public_interactions        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS public_interactions_delta  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_mode                  TEXT DEFAULT 'public';
