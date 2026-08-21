-- 072_staff_account_scope.sql
-- スタッフを1つのLINE公式アカウント専用に限定できるようにする。
--
-- line_account_id が NULL のスタッフは従来どおり全アカウントを操作できる。
-- 値が入っているスタッフは、そのアカウントに紐づくデータしか読み書きできない。
-- 判定は apps/worker/src/middleware/auth.ts の enforceAccountScope で一元化し、
-- 42ファイルに散らばる accountId 受け取り箇所を個別に直さなくて済むようにしている。
--
-- 例: WAHMS だけを担当する作業員アカウント。
--     Frei のキャリア相談データは一覧にも出ず、APIを直接叩いても 403 になる。

ALTER TABLE staff_members ADD COLUMN line_account_id TEXT;
