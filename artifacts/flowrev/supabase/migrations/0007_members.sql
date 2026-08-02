-- ========================================
-- 0007_members.sql
-- コース・レッスン・受講進捗テーブル + RLS
-- ========================================

-- ⑪ コース
CREATE TABLE IF NOT EXISTS courses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
  product_id     UUID REFERENCES products(id),
  title          TEXT NOT NULL,
  description    TEXT,
  thumbnail_url  TEXT,
  status         TEXT NOT NULL DEFAULT 'draft',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⑫ レッスン
CREATE TABLE IF NOT EXISTS lessons (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id   UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  client_id        UUID REFERENCES clients(id) ON DELETE CASCADE,
  course_id        UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  content_type     TEXT NOT NULL DEFAULT 'video',
  video_url        TEXT,
  text_content     TEXT,
  file_url         TEXT,
  duration_seconds INTEGER,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'published',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⑬ 受講進捗（MVP: テーブルのみ。UIは Phase3）
CREATE TABLE IF NOT EXISTS lesson_progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  white_label_id UUID REFERENCES white_labels(id) ON DELETE CASCADE,
  customer_id    UUID REFERENCES customers(id) ON DELETE CASCADE,
  lesson_id      UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  completed      BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at   TIMESTAMPTZ,
  watch_seconds  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(customer_id, lesson_id)
);

-- RLS 有効化
ALTER TABLE courses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;

-- コース：client_owner 全操作
DROP POLICY IF EXISTS "client_owner：コース操作" ON courses;
CREATE POLICY "client_owner：コース操作" ON courses
  FOR ALL
  USING (client_id = get_user_client_id())
  WITH CHECK (
    client_id      = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
  );

-- レッスン：client_owner 全操作
DROP POLICY IF EXISTS "client_owner：レッスン操作" ON lessons;
CREATE POLICY "client_owner：レッスン操作" ON lessons
  FOR ALL
  USING (client_id = get_user_client_id())
  WITH CHECK (
    client_id      = get_user_client_id()
    AND white_label_id = get_user_white_label_id()
  );

-- 受講進捗：client_owner 参照のみ
DROP POLICY IF EXISTS "client_owner：進捗参照" ON lesson_progress;
CREATE POLICY "client_owner：進捗参照" ON lesson_progress
  FOR SELECT
  USING (white_label_id = get_user_white_label_id());

-- インデックス
CREATE INDEX IF NOT EXISTS idx_courses_client_id    ON courses(client_id);
CREATE INDEX IF NOT EXISTS idx_courses_sort_order   ON courses(client_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lessons_course_id    ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_sort_order   ON lessons(course_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_customer ON lesson_progress(customer_id);
CREATE INDEX IF NOT EXISTS idx_lesson_progress_course   ON lesson_progress(course_id);
