
CREATE TABLE IF NOT EXISTS analytics_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  brief text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

ALTER TABLE analytics_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "briefs_own" ON analytics_briefs FOR ALL TO authenticated USING (user_id = auth.uid());
