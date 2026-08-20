# WAHMS 運用メモ

## 管理画面

WAHMS アカウント選択時だけ `/wahms` を表示する。

- 参加者管理: `登録者マスター` と `申込履歴`
- 講義アンケート: 学校別・新着順・要対応/対応完了
- アーカイブ: 学校、回、テーマ、開催日、YouTube URL
- 配信: 当日の申込者へのアンケート配信、Flex JSON 一斉配信

個人情報は Git に保存せず、D1 の WAHMS 専用テーブルへ保存する。

## Google Apps Script 連携

Apps Script project `1go5t___9itWSmk4V5BmFObOwIXOvAofjX_4SrDjttnJqJ00RHRtX6t8Q` の
本番 Web App deployment は、2026-08-20 に version 17 へ更新済み。

シートへの書き込み後、次の3種類を `POST /api/wahms/sync` へ差分同期する。

- `participant`: 友だち追加、初回アンケート更新、申込回数更新
- `application`: 学校への申込確定
- `survey`: 講義アンケート回答

同期リクエストは、非公開の Apps Script が既に保持している WAHMS の
LINE channel access token を Bearer として送る。Worker は D1 の
`line_accounts.channel_access_token` と一致し、かつアカウント名が WAHMS の場合だけ受理する。

同期が失敗しても既存の LINE 応答やシート書き込みは止めない。初回移行はシートを
Excelとして一時エクスポートし、本番D1へ直接投入した。エクスポートと取込SQLは
Gitに保存せず、作業後にゴミ箱へ移動した。

## 返信と配信の扱い

- 青山さんへの質問への返信は `/line-api` proxy を使い、
  `X-Line-Harness-Source: manual` を付ける。
- アンケート案内や Flex 一斉配信は自動配信として扱い、manual header を付けない。
