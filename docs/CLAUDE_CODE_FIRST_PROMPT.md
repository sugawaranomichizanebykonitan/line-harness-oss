# Claude Codeへ最初に渡す依頼文

以下の文章を、Claude Codeでこのリポジトリを開いた後にそのまま送ってください。

---

このリポジトリの今後の開発・保守・LINE運用を引き継いでください。

GitHub:
https://github.com/sugawaranomichizanebykonitan/line-harness-oss

最初に `codex/career-consulting-booking` ブランチを取得してください。2026-08-21時点では、このブランチが最新で、`main` は古い状態です。

作業を変更せず、まず次をすべて読んでください。

1. `CLAUDE.md`
2. `AGENTS.md`
3. `docs/CLAUDE_CODE_HANDOFF.md`
4. `docs/wahms-operations.md`
5. `docs/FORK_CLOUDFLARE_WORKFLOW.md`

その後、次を読取りだけで確認してください。

- 現在のbranch、git status、origin/upstream、直近commit
- `origin/main` と `origin/codex/career-consulting-booking` の差分
- Worker、Admin、WAHMS管理画面の稼働
- GitHub Actionsの公開設定が、引き継ぎ書に書かれた本番構成と一致するか
- 秘密情報がGitに入っていないか

確認が終わったら、コード変更・deploy・LINE送信・DB更新はまだ行わず、次の形式で日本語報告してください。

1. 理解したシステムの全体像
2. 現在の本番状態
3. GitHubと本番の差
4. 見つかった危険や不足
5. `codex/career-consulting-booking` を `main` へ安全に統合する手順
6. 私の承認が必要な作業
7. 今の進捗を全体像から整理するとこれ
8. 次のタスクはこれ

運用上の絶対条件:

- 私は技術者ではないので、専門用語をかみ砕いて説明すること。
- 勝手な一斉配信、予約確定、削除、本番deploy、DB更新をしないこと。
- LINE配信テストは許可された1人だけに行い、対象と内容を直前に確認すること。
- 個人情報、LINE user ID、APIキー、トークン、Google秘密鍵を会話やGitへ貼らないこと。
- 担当者として1対1返信するときは `X-Line-Harness-Source: manual` を必ず付けること。
- Google Meet相談を確定・変更したら、Calendar更新だけで終わらず `POST /api/meet-consultations` に登録し、前日・1時間前のLINEリマインドを必須にすること。キャンセル時は `DELETE /api/meet-consultations/:externalEventId` も実行すること。
- 公式OSSの更新は `upstream` から専用ブランチとPRで取り込み、Frei/WAHMS独自機能を消さないこと。

---

## Claude Codeに渡すもの

- 上記GitHub URL
- この依頼文
- Cloudflare、GitHub、LINE Developers、Google Cloud、Apps Scriptへのログイン権限（必要になった時だけ、各サービスの正規ログイン画面で付与）

APIキーやトークンをこの依頼文へ追記しないでください。
