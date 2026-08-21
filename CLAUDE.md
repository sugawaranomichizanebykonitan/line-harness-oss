# Claude Code project instructions

このリポジトリは、株式会社Freiのキャリア相談とオンライン学校「WAHMS」を運用する、複数LINE公式アカウント対応のCRMです。

作業を始める前に、必ず次の順で読んでください。

1. `AGENTS.md` — 絶対に守る運用ルール
2. `docs/CLAUDE_CODE_HANDOFF.md` — 本番構成、現状、公開手順、障害対応
3. `docs/wahms-operations.md` — WAHMS固有のデータ連携
4. `docs/FORK_CLOUDFLARE_WORKFLOW.md` — forkと公式更新の取り込み方

## 最重要ルール

- 現在の正本ブランチは `codex/career-consulting-booking`。2026-08-21時点で `main` は古い。差分を確認せず `main` へ切り替えたり上書きしたりしない。
- 本番へ影響する操作、LINE配信、予約確定、削除は、対象・件数・環境を先に確認する。
- 一斉配信を動作確認に使わない。WAHMSの配信テストは管理画面の「安全なテスト送信」で、許可された1つのLINE user IDだけに送る。
- トークン、APIキー、Google秘密鍵、個人のLINE user ID、スプレッドシートの個人情報はGitへ保存しない。
- 担当者による1対1返信には `X-Line-Harness-Source: manual` を付ける。予約通知などの自動送信には付けない。
- Google Meet相談の確定・変更時は、Calendar更新後に `POST /api/meet-consultations` へ登録する。キャンセル時は `DELETE /api/meet-consultations/:externalEventId` を実行する。
- 変更は専用ブランチ、テスト、commit、push、PRの順で管理する。上流 `Shudesu/line-harness-oss` の更新もPRで取り込む。
- **Workerをdeployするときは必ず `--keep-vars` を付ける。** 本番の `WAHMS_LEGACY_WEBHOOK_URL` と `WAHMS_LEGACY_LINE_ACCOUNT_ID` はsecretではなく手動設定のplain text varsで、付け忘れると消えてWAHMSのリッチメニュー応答が止まる。詳細は `docs/DEPLOY_WORKFLOW_HARDENING.md`。
- **GitHub Actionsの自動公開はまだ有効化しない。** `docs/DEPLOY_WORKFLOW_HARDENING.md` の2つの修正を適用してから。
- 本番D1の `_migrations` は2026-08-21に整備済み（76件記録）。既存migrationの記録を消して再実行しないこと。経緯は `docs/D1_MIGRATION_RECONCILIATION.md`。

## 現在の本番入口

- 管理画面: https://frei-career-admin.pages.dev
- WAHMS管理: https://frei-career-admin.pages.dev/wahms
- Worker API / LIFF配信元: https://frei-career.frei-career-consulting.workers.dev
- GitHub fork: https://github.com/sugawaranomichizanebykonitan/line-harness-oss

## 作業完了時の報告

技術に詳しくない運用者にも分かる日本語で、次を必ず報告してください。

- 何が完了したか
- 実際に何をテストし、結果がどうだったか
- 本番へ公開したか、コードだけ変更したか
- 影響範囲と、残っている注意点
- 「今の進捗を全体像から整理するとこれ」
- 「次のタスクはこれ」

