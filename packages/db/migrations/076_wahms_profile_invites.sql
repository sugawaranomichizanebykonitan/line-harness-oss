-- 初回プロフィールアンケートの案内トークン。
--
-- これまで初参加者のプロフィール登録は LIFF (LINEログイン必須) で行い、
-- 回答は Apps Script がスプレッドシートへ書いていた。Worker が申込を
-- 引き取るには、同じ導線を自前で持つ必要がある。
--
-- 講義アンケート (wahms_survey_invites) と同じ考え方で、使い捨ての文字列を
-- 発行して URL にはそれだけを載せる。LINEのユーザーIDをURLに置かない。
--
-- booking_text は保留中の申込文言 (例:「8月27日セールス学校に申し込む」)。
-- 回答が終わった時点でこの申込を確定させる。Apps Script の saveTempBooking と
-- 同じ役目だが、こちらは案内1件ごとに持つので取り違えが起きない。
CREATE TABLE IF NOT EXISTS wahms_profile_invites (
  token           TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  line_user_id    TEXT NOT NULL,
  booking_text    TEXT,
  school_name     TEXT,
  event_date      TEXT,
  used_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_wahms_profile_invites_user
  ON wahms_profile_invites(line_account_id, line_user_id, created_at DESC);
