-- ========================================
-- 0005_scenarios.sql
-- フォローシナリオ・ステップ・実行ログ
-- ========================================

-- ⑭ フォローシナリオ
CREATE TABLE IF NOT EXISTS follow_scenarios (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id  UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  trigger_type    TEXT NOT NULL DEFAULT 'manual',
  trigger_config  JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active',
  ai_generated    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⑮ シナリオステップ
CREATE TABLE IF NOT EXISTS scenario_steps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  scenario_id    UUID NOT NULL REFERENCES follow_scenarios(id) ON DELETE CASCADE,
  step_number    INTEGER NOT NULL,
  delay_days     INTEGER NOT NULL DEFAULT 0,
  channel        TEXT NOT NULL DEFAULT 'email',
  subject        TEXT,
  body           TEXT NOT NULL,
  ai_generated   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scenario_id, step_number)
);

-- ⑯ シナリオ実行ログ（MVP: テーブルのみ）
CREATE TABLE IF NOT EXISTS scenario_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  scenario_id    UUID REFERENCES follow_scenarios(id),
  step_id        UUID REFERENCES scenario_steps(id),
  customer_id    UUID REFERENCES customers(id),
  status         TEXT NOT NULL DEFAULT 'pending',
  sent_at        TIMESTAMPTZ,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS 有効化
ALTER TABLE follow_scenarios  ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_steps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_logs     ENABLE ROW LEVEL SECURITY;

-- follow_scenarios ポリシー
DROP POLICY IF EXISTS "client_owner：シナリオ操作" ON follow_scenarios;
CREATE POLICY "client_owner：シナリオ操作" ON follow_scenarios
  FOR ALL
  USING (client_id = get_user_client_id())
  WITH CHECK (
    client_id      = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
  );

-- scenario_steps ポリシー
DROP POLICY IF EXISTS "client_owner：ステップ操作" ON scenario_steps;
CREATE POLICY "client_owner：ステップ操作" ON scenario_steps
  FOR ALL
  USING (white_label_id = get_user_white_label_id())
  WITH CHECK (white_label_id = get_user_white_label_id());

-- scenario_logs ポリシー（MVP: 参照のみ）
DROP POLICY IF EXISTS "client_owner：ログ参照" ON scenario_logs;
CREATE POLICY "client_owner：ログ参照" ON scenario_logs
  FOR SELECT
  USING (white_label_id = get_user_white_label_id());

-- インデックス
CREATE INDEX IF NOT EXISTS idx_follow_scenarios_client_id    ON follow_scenarios(client_id);
CREATE INDEX IF NOT EXISTS idx_follow_scenarios_status       ON follow_scenarios(status);
CREATE INDEX IF NOT EXISTS idx_scenario_steps_scenario_id   ON scenario_steps(scenario_id);
CREATE INDEX IF NOT EXISTS idx_scenario_steps_step_number   ON scenario_steps(scenario_id, step_number);
CREATE INDEX IF NOT EXISTS idx_scenario_logs_customer_id    ON scenario_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_scenario_logs_status         ON scenario_logs(status);
CREATE INDEX IF NOT EXISTS idx_scenario_logs_created_at     ON scenario_logs(created_at);
