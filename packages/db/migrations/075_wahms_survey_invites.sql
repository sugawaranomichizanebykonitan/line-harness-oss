-- 講義アンケートの案内トークン。
--
-- 受講者ごとに使い捨ての文字列を発行し、URLにはこれだけを載せる。
-- LINEのユーザーIDを直接URLに置かないため。
--
-- 誰がどの講義に答えたのかが確実に分かるので、回答から「講義名が分からない」
-- が消える (Apps ScriptのLIFFは講義名を取り違えて保存していた)。
-- 回答者が特定できるので、質問への1対1返信もそのまま使える。
CREATE TABLE IF NOT EXISTS wahms_survey_invites (
  token           TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  line_user_id    TEXT NOT NULL,
  school_name     TEXT NOT NULL,
  event_date      TEXT NOT NULL,
  respondent_name TEXT,
  used_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_wahms_survey_invites_lecture
  ON wahms_survey_invites(line_account_id, school_name, event_date);
