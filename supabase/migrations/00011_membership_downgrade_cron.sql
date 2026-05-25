
-- 启用 pg_cron 扩展（如已存在则跳过）
create extension if not exists pg_cron;

-- 每天凌晨 00:05 UTC（北京时间 08:05）自动触发套餐到期降级
select cron.schedule(
  'membership-daily-downgrade',
  '5 0 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_URL') || '/functions/v1/membership_downgrade',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_SERVICE_ROLE_KEY')
    ),
    body := '{}'::jsonb
  );
  $$
);
