
-- 启用 pg_cron 和 pg_net 扩展（Supabase 默认可用）
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 删除已有的同名 cron 任务（避免重复）
SELECT cron.unschedule('finance-daily-calc') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'finance-daily-calc'
);

-- 每天 UTC 15:00（北京时间 23:00）自动触发财务跑批
SELECT cron.schedule(
  'finance-daily-calc',
  '0 15 * * *',
  $$
    SELECT net.http_post(
      url := (SELECT current_setting('app.settings.supabase_url', true) || '/functions/v1/finance-daily-calc'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := '{}'::jsonb
    )
  $$
);
