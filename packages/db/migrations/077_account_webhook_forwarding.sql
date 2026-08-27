-- 既存ツールと並走するための Webhook 転送設定。
--
-- LINE の Webhook URL はアカウントに1つしか設定できない。すでに Lステップ等の
-- ツールが入っているアカウントを引き受けるとき、こちらを前段に置いて、受け取った
-- 生のリクエストをそのまま既存ツールへ渡す。既存の運用を止めずに、こちらでも
-- 全イベントを記録できる。
--
-- WAHMS で Apps Script に対してやってきたことの一般化。これまでは Worker の
-- 環境変数 (WAHMS_LEGACY_*) にアカウントIDと転送先を直書きしていたので、
-- 2社目を同じやり方で受けられなかった。
--
-- forward_mode:
--   'always'   … 全イベントを転送し、こちらからは一切返信しない (記録のみ)。
--                既存ツールが応答を担当しているアカウント向け。
--   'fallback' … こちらが応答し、返せなかったときだけ転送する。WAHMS 向け。
--   NULL       … 転送しない (単独運用)。
ALTER TABLE line_accounts ADD COLUMN forward_webhook_url TEXT;
ALTER TABLE line_accounts ADD COLUMN forward_mode TEXT;
