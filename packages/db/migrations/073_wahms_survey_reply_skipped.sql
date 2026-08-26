-- 「返信対応しない」質問に印を付ける。
--
-- response_status に 'skipped' を足すのが素直だが、この列には
-- CHECK(response_status IN ('none','pending','completed')) が付いており、
-- SQLite では CHECK を緩めるのにテーブル再作成が要る。稼働中の本番で
-- アンケート実データを載せ替えるのは割に合わないため、列を1つ足す。
--
-- 列を分ける利点がもう1つある。スプレッドシート同期は response_status を
-- 上書きするが、この列は触らない。外した質問が再取り込みで要対応へ
-- 戻ってしまう事故が起きない。
ALTER TABLE wahms_survey_responses ADD COLUMN reply_skipped INTEGER NOT NULL DEFAULT 0;

-- 要対応の件数を数えるクエリがこの列で絞るため。
CREATE INDEX IF NOT EXISTS idx_wahms_surveys_pending
  ON wahms_survey_responses(line_account_id, response_status, reply_skipped);
