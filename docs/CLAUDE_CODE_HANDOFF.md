# Claude Code 完全引き継ぎ書

最終更新: 2026-08-21  
対象リポジトリ: `sugawaranomichizanebykonitan/line-harness-oss`  
現在の正本ブランチ: `codex/career-consulting-booking`  
引き継ぎ時点の先頭commit: `f40f269`（この引き継ぎ書のcommitはその次に追加される）

## 1. このシステムは何か

1つの管理画面から、複数のLINE公式アカウントを切り替えて運用するCRMです。現在は主に次の2事業を扱います。

| 事業 | 主な用途 |
| --- | --- |
| 株式会社Frei キャリアコンサル管理 | 無料個別相談、スタッフ選択、Google Calendar空き枠、Google Meet付き予約、予約通知・リマインド |
| オンライン学校「WAHMS」 | 参加者・申込者管理、講義アンケート、質問対応、アーカイブ、Flex配信、既存GAS運用の継続 |

構成は次のとおりです。

```text
LINE利用者
  ├─ リッチメニュー / LIFF
  └─ LINEメッセージ
          ↓
Cloudflare Worker: frei-career
  ├─ API・Webhook・LIFF画面
  ├─ D1データベース
  ├─ R2画像
  ├─ LINE Messaging API
  ├─ Google Calendar / Meet
  └─ WAHMS既存Google Apps Script（移行期間の併用）
          ↑
Cloudflare Pages: frei-career-admin
  └─ 管理画面（アカウント切替、配信、予約、WAHMS専用画面）
```

## 2. まず知っておくべき現在地

### ブランチ

- 最新実装: `origin/codex/career-consulting-booking`
- 最新実装の基準commit: `f40f269`
- 2026-08-21確認時の `origin/main`: `4347e70`
- `main` にはWAHMS管理や直近の予約修正がまだ揃っていない。
- 本番には専用ブランチの内容を手動公開しているため、GitHubの `main` と本番が一致していない。

最初に次を確認してください。

```bash
git status --short
git branch --show-current
git fetch origin upstream
git log --oneline --decorate -15
git log --oneline origin/main..origin/codex/career-consulting-booking
```

作業開始時は原則として次を使います。

```bash
git switch codex/career-consulting-booking
git pull --ff-only origin codex/career-consulting-booking
```

ローカルに利用者の未commit変更がある場合は、勝手に破棄・退避・上書きしないでください。

### 2026-08-21時点の稼働確認

| 対象 | URL | 確認結果 |
| --- | --- | --- |
| Worker | https://frei-career.frei-career-consulting.workers.dev | HTTP 200 |
| 管理画面 | https://frei-career-admin.pages.dev | 稼働中 |
| WAHMS管理 | https://frei-career-admin.pages.dev/wahms | HTTP 200 |
| WAHMSアンケートLIFF | https://liff.line.me/2010052458-oPl4GiQQ | HTTP 200 |

直近の手動本番公開:

- Worker version: `7bf616aa-c385-4cd9-b099-0f1f3516877e`
- Admin Pages deployment: `b78ea052.frei-career-admin.pages.dev`
- 正式な管理画面URLは常に `https://frei-career-admin.pages.dev`

## 3. GitHubと上流の関係

| 名前 | URL | 役割 |
| --- | --- | --- |
| `origin` | https://github.com/sugawaranomichizanebykonitan/line-harness-oss.git | 株式会社Frei向けfork |
| `upstream` | https://github.com/Shudesu/line-harness-oss.git | 公式OSS |

独自変更を守るため、公式更新は直接混ぜず、必ず専用ブランチとPRで差分確認します。詳しくは `docs/FORK_CLOUDFLARE_WORKFLOW.md` を参照してください。

推奨する最初のGitHub作業:

1. `codex/career-consulting-booking` から `main` へのPRを作る。
2. Cloudflare用Secrets/Variablesが揃っているか確認する。
3. WorkerとAdminのCIが成功することを確認する。
4. 本番と同じ内容になることを確認してからmergeする。

## 4. 本番リソース

### Cloudflare

| 種別 | 値 |
| --- | --- |
| Worker名 | `frei-career` |
| Worker URL | `https://frei-career.frei-career-consulting.workers.dev` |
| Admin Pages project | `frei-career-admin` |
| Admin URL | `https://frei-career-admin.pages.dev` |
| D1 database name | `line-harness` |
| D1 database ID | `372d6241-f392-4ac3-a3ac-e3ad2721f8f3` |
| R2 bucket | `line-harness-images` |
| 旧URL転送Worker | `line-harness`（`apps/worker/wrangler.legacy-redirect.toml`） |

Cloudflare account IDは秘密鍵ではありませんが、通常はGitHub Actionsの `CLOUDFLARE_ACCOUNT_ID` から取得してください。本番トークンは文書やチャットに貼らず、Cloudflare / GitHub Secrets内で扱います。

### LINE

| 用途 | Channel / LIFF |
| --- | --- |
| Frei | Channel `2011162043`、LIFF `2011162043-EWObBefu` |
| WAHMS | Channel `2010052458` |
| WAHMS管理対象LIFF | `2010052458-sRBnzFqo` |
| WAHMS講義アンケートLIFF | `2010052458-oPl4GiQQ` |

WAHMSのD1内LINE account UUID:

```text
5d35c116-bc08-4b52-9354-513d64b65a8b
```

Channel access token、Channel secret、Login secret、個人のLINE user IDはGitに保存しません。LINE DevelopersとD1/Worker Secretsの値を、表示せずに照合してください。

### WAHMS Google Apps Script / Sheet

| 種別 | 値 |
| --- | --- |
| Apps Script project ID | `1go5t___9itWSmk4V5BmFObOwIXOvAofjX_4SrDjttnJqJ00RHRtX6t8Q` |
| 2026-08-20時点のdeployment | version 17 |
| Web app | https://script.google.com/macros/s/AKfycbxHeFJobXiPUPEfwGObqPQPXhiMlaSq5aE15_1XsNfrqa-R6kDyR-tolNLrSR4ywZ5c/exec |
| 元データSheet | https://docs.google.com/spreadsheets/d/1C-siR8gSVgeF_ac_cX_Z_tDDuMZC9NWHYjlZYsjNhwU/edit?gid=1897282751#gid=1897282751 |

GASソースにはLINE token等が含まれるため、Gitには置いていません。Apps Script側で管理します。

## 5. 主な実装場所

| 機能 | ファイル |
| --- | --- |
| Workerの入口・環境変数 | `apps/worker/src/index.ts` |
| 管理画面 | `apps/web/src/` |
| LIFF / Worker内画面 | `apps/worker/src/client/` |
| キャリア相談予約API | `apps/worker/src/routes/booking.ts` |
| Meetリマインド登録 | `apps/worker/src/routes/meet-consultations.ts` |
| Google Calendar連携 | `apps/worker/src/services/google-calendar.ts`, `apps/worker/src/services/google-oauth.ts` |
| LINE Proxy | `apps/worker/src/routes/line-proxy.ts` |
| リッチメニュー | `apps/worker/src/routes/rich-menus.ts` |
| WAHMS管理API | `apps/worker/src/routes/wahms.ts` |
| WAHMS管理UI | `apps/web/src/app/wahms/page.tsx` |
| WAHMS API client | `apps/web/src/lib/api.ts` の `wahmsApi` |
| WAHMS DB migration | `packages/db/migrations/071_wahms_operations.sql` |
| 旧URL転送 | `apps/worker/src/legacy-url-redirect.ts` |
| WAHMS運用補足 | `docs/wahms-operations.md` |

## 6. WAHMSの現在の動き

管理画面でLINEアカウントをWAHMSへ切り替えると、サイドバーにWAHMS専用画面が表示されます。

現在できること:

- 登録者マスターと学校別申込履歴の確認
- 学校別・最新順の講義アンケート確認
- 回答数、平均満足度、「無料なのが信じられない」率の表示
- 「青山さんへの質問」の要対応表示と、LINEへの個別返信・対応完了
- 講義アーカイブの登録・削除
- 講義参加者へのアンケート配信
- Flex JSONの一斉配信
- 自分1人だけへのFlex / アンケートの安全なテスト送信

初回移行時のD1件数スナップショット（2026-08-20）:

- 参加者: 139
- 申込: 546
- アンケート: 261
- アーカイブ: 123
- 要対応質問: 14
- 平均満足度: 4.89
- 「無料なのが信じられない」率: 80.5%

これは固定値ではありません。最新値は管理画面かD1で確認してください。

### GASからD1への差分同期

既存GASが次を `POST /api/wahms/sync` へ送ります。

- `participant`: 登録者
- `application`: 申込
- `survey`: 講義アンケート

認証はGASが既に保有するWAHMS Channel access tokenをBearerとして送り、Worker側でD1のWAHMSアカウントと照合します。同期失敗時も、既存GASのLINE返信とSheet書込みは止めない設計です。

### WAHMS配信で直した重要事項

2026-08-20、Workerから同じWorkerのLINE ProxyへHTTP self-requestしてCloudflare `1042` になる問題を修正しました。WAHMS配信はD1に登録された該当アカウントのChannel access tokenを解決し、LINE Messaging APIへ直接送信します。

Flexは次の両方を受け付けます。

- Flex Simulatorの `contents`（bubble / carousel）だけ
- `{ "type": "flex", "altText": "...", "contents": {...} }` のmessage全体

実送信確認では、許可されたテスト用LINE user IDへFlexとアンケートを各1通送り、LINE API成功・配信ログ成功を確認しました。全体配信はテストしていません。

## 7. キャリア相談予約の必須仕様

- 表示枠は原則8:00〜21:00。
- Google Calendarの既存予定と前後30分空ける。
- 手動登録枠を優先する。
- スタッフごとにGoogle Calendarを接続できる。
- 確定時にGoogle Meetを発行し、CalendarとLINEへ案内する。
- 前日と1時間前のLINEリマインドを必ず設定する。

予約を確定・変更したら、Calendarイベント作成だけで終えず、次を実行します。

```text
POST /api/meet-consultations
```

必要情報:

- Google Calendar event ID
- LINE friend ID
- 予約日時
- Google Meet URL

キャンセル時:

```text
DELETE /api/meet-consultations/:externalEventId
```

直近の予約実装では、リマインド登録APIの一時失敗で予約自体を失敗扱いにしない修正が入っています。ただし、FreiアカウントのGoogle Calendar → Meet発行 → LINE案内 → 前日/1時間前リマインドの完全な実機一周テストは、引き継ぎ時点で完了証跡がありません。完了と断言せず、テスト予約で再確認してください。

## 8. 絶対に守る送信ルール

### 1対1の人間返信

L Harness Proxyから担当者が返信する場合:

```http
X-Line-Harness-Source: manual
```

を必ず付けます。WAHMSの質問返信もこの扱いです。

### 自動送信

予約通知、リマインド、アンケート案内、Flex一斉配信にはmanual headerを付けません。

### テスト送信

- broadcast / multicastを試験目的で使わない。
- 管理画面の「安全なテスト送信」を使う。
- テスト対象LINE user IDは本人の許可を得たものだけ使う。
- LINE user IDをコード、commit、ログ共有、引き継ぎ文書へ残さない。
- LINE APIが200でも、利用者のLINE画面で実際に見えたかを最後に確認する。

## 9. ローカル確認

前提:

- Node.js 20以上（CIは22）
- pnpm 9.15.4
- Cloudflare Wrangler 4

```bash
pnpm install --frozen-lockfile

# Worker
pnpm --filter worker typecheck
pnpm --filter worker exec vitest run src/routes/line-proxy.test.ts
pnpm --filter worker build

# Admin
pnpm exec tsc --noEmit -p apps/web/tsconfig.json
pnpm --filter web build
```

本番に関係する変更は、少なくとも型確認、関連テスト、Worker build、Admin buildを通してください。生成物の `tsconfig.tsbuildinfo` などを意図せずcommitしないでください。

## 10. 本番公開

### 推奨: GitHub Actions

本来の公開経路は次です。

```text
feature branch → PR → origin/main → GitHub Actions → Cloudflare
```

Actions:

- `.github/workflows/deploy-cloudflare-worker.yml`
- `.github/workflows/deploy-cloudflare-admin.yml`

GitHub Actionsで最低限確認する設定:

Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `D1_DATABASE_NAME`
- `D1_DATABASE_ID`
- `NEXT_PUBLIC_API_URL`

Variables:

- `LINE_HARNESS_CLOUDFLARE_DEPLOY=true`
- `WORKER_NAME=frei-career`
- `PAGES_PROJECT_NAME=frei-career-admin`
- `ADMIN_ORIGIN=https://frei-career-admin.pages.dev`
- `ADMIN_ALLOW_CROSS_SITE=true`
- `WORKER_URL=https://frei-career.frei-career-consulting.workers.dev`
- `VITE_LIFF_ID`、`VITE_BOT_BASIC_ID`、必要なら `VITE_CALENDAR_CONNECTION_ID`

Worker Secrets / VariablesはCloudflare上で確認:

- `API_KEY`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_ID`
- `LINE_LOGIN_CHANNEL_SECRET`
- `LIFF_URL`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- 必要なら `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- 必要なら `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `WAHMS_LEGACY_WEBHOOK_URL`
- `WAHMS_LEGACY_LINE_ACCOUNT_ID`

値は引き継ぎ書へ追記せず、GitHub Secrets / Cloudflare Secrets / Google Cloud / LINE Developersの管理画面で照合します。

### 手動公開の注意

`apps/worker/wrangler.toml` は公開テンプレートで、本番IDが `YOUR_*` のままです。そのまま本番deployしてはいけません。GitHub Actionsのpatch工程を使うか、Git管理外の一時configで本番bindingを明示し、`--keep-vars` を付けます。

手動公開後は必ず次を確認します。

- Worker `/health` が200
- Admin `/wahms` が200
- ログインできる
- WAHMSの安全なテスト送信が1人にだけ成功
- 予約を変更した場合はMeetとリマインド登録まで成功

## 11. データベース

WAHMS用migration:

```text
packages/db/migrations/071_wahms_operations.sql
```

個人情報はD1にあり、Gitにはありません。D1を変更する前に対象databaseが `line-harness` であることを確認してください。破壊的SQL、広いDELETE、migrationの再実行は避けます。

読取り例:

```bash
npx wrangler d1 execute line-harness --remote \
  --command "SELECT COUNT(*) AS count FROM wahms_participants"
```

本番データのexport、LINE ID、氏名、アンケート自由記述をcommitや公開issueへ貼らないでください。

## 12. 障害対応の入口

### Flex / アンケートが送れない

1. `/health` と管理画面を確認。
2. WAHMSアカウントを選択しているか確認。
3. 安全なテスト送信を1人にだけ行う。
4. `wahms_delivery_logs` の success / failure を確認。
5. D1のWAHMS `line_accounts.channel_access_token` が有効か、値を表示せず確認。
6. Flexはcontentsのみ / message全体のどちらか正しいJSONか確認。
7. 同じWorkerへのself-requestを復活させない。Cloudflare 1042の再発原因になる。

### リッチメニューを押しても返事がない

1. LINE DevelopersのWebhook URLと検証結果を確認。
2. Workerログで署名検証とWAHMS legacy forwardingを確認。
3. `WAHMS_LEGACY_WEBHOOK_URL` と `WAHMS_LEGACY_LINE_ACCOUNT_ID` を確認。
4. GAS Web Appが実行可能か確認。
5. 既存GASの返信と新CRMの処理を二重送信させない。

### Google Calendarが連携できない

1. Google OAuth clientが存在するか確認。
2. Authorized redirect URIが現在のWorker callbackと完全一致するか確認。
3. OAuth consent screenのテストユーザーまたは公開状態を確認。
4. Workerの `GOOGLE_OAUTH_CLIENT_ID/SECRET` を表示せず確認。
5. スタッフのCalendar接続状態とrefresh tokenを確認。

## 13. 未完了・次にやるべきこと

優先順:

1. `codex/career-consulting-booking` → `main` のPRを作り、CIと差分を確認してmergeする。
2. main merge後、GitHub ActionsのWorker/Admin deployが成功することを確認し、本番とGitHubを一致させる。
3. Freiキャリア相談をテスト用LINEとテスト用Calendarで一周確認する。
4. WAHMS管理API専用の自動テストを追加する。現在は実機テストと既存LINE Proxy 29テストが中心。
5. `SURVEY_LIFF_URL` のハードコードを、WAHMSアカウント設定または環境変数へ移すことを検討する。
6. GASとD1の定期的な件数差分監視を追加する。

## 14. Claude Codeへの最初の依頼

`docs/CLAUDE_CODE_FIRST_PROMPT.md` の本文を、そのままClaude Codeへ渡してください。Claude Codeにはこのリポジトリをclone/openさせ、最初は読取りと状態確認だけをさせます。

