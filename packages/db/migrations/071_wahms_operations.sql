-- WAHMS operations dashboard. Personal data is imported directly into D1 and
-- is intentionally never stored in this migration or in Git.

CREATE TABLE IF NOT EXISTS wahms_participants (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  line_user_id TEXT NOT NULL,
  line_display_name TEXT,
  followed_at TEXT,
  name TEXT,
  occupation TEXT,
  gender TEXT,
  age_group TEXT,
  has_website TEXT,
  website_url TEXT,
  interests TEXT,
  survey_completed_at TEXT,
  application_count INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  status TEXT,
  notes TEXT,
  source_row INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(line_account_id, line_user_id)
);

CREATE TABLE IF NOT EXISTS wahms_applications (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  applied_at TEXT,
  line_user_id TEXT NOT NULL,
  school_name TEXT NOT NULL,
  event_date TEXT,
  event_time TEXT,
  theme TEXT,
  lecture_number TEXT,
  morning_reminder_sent INTEGER NOT NULL DEFAULT 0,
  last_reminder_sent INTEGER NOT NULL DEFAULT 0,
  attended INTEGER,
  source_row INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(line_account_id, source_row)
);

CREATE TABLE IF NOT EXISTS wahms_survey_responses (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  responded_at TEXT,
  line_user_id TEXT NOT NULL,
  lecture_label TEXT NOT NULL,
  school_name TEXT NOT NULL,
  satisfaction REAL,
  value_rating TEXT,
  next_intent TEXT,
  question TEXT,
  answer TEXT,
  respondent_name TEXT,
  memo TEXT,
  content_number TEXT,
  response_status TEXT NOT NULL DEFAULT 'none' CHECK(response_status IN ('none','pending','completed')),
  answered_at TEXT,
  answered_by TEXT,
  source_row INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(line_account_id, source_row)
);

CREATE TABLE IF NOT EXISTS wahms_archives (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  school_name TEXT NOT NULL,
  lecture_number TEXT,
  theme TEXT,
  held_on TEXT,
  youtube_url TEXT,
  source_row INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(line_account_id, source_row)
);

CREATE TABLE IF NOT EXISTS wahms_delivery_logs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  delivery_type TEXT NOT NULL CHECK(delivery_type IN ('survey','flex')),
  title TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wahms_participants_account ON wahms_participants(line_account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wahms_applications_school_date ON wahms_applications(line_account_id, school_name, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_wahms_applications_user ON wahms_applications(line_account_id, line_user_id);
CREATE INDEX IF NOT EXISTS idx_wahms_surveys_school_date ON wahms_survey_responses(line_account_id, school_name, responded_at DESC);
CREATE INDEX IF NOT EXISTS idx_wahms_surveys_status ON wahms_survey_responses(line_account_id, response_status, responded_at DESC);
CREATE INDEX IF NOT EXISTS idx_wahms_archives_school_date ON wahms_archives(line_account_id, school_name, held_on DESC);
