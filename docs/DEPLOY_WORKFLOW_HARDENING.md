# 自動公開を有効化する前に必ず適用する2つの修正

作成日: 2026-08-21  
状態: **未適用**。GitHubの `workflow` scope が必要なため、このリポジトリへ
push できていない。

## なぜ必要か

`.github/workflows/deploy-cloudflare-worker.yml` と
`deploy-cloudflare-admin.yml` には、本番を壊し得る問題が2つある。
**この2つを直すまで、GitHub Actionsによる自動公開を有効化してはいけない。**

## 問題1: deployで本番の環境変数が消える

本番Workerを実測した結果、次の2つは **secret ではなく plain text の
Environment Variable** として手動設定されている。

```text
env.WAHMS_LEGACY_LINE_ACCOUNT_ID   Environment Variable
env.WAHMS_LEGACY_WEBHOOK_URL       Environment Variable
```

`wrangler deploy` は secret を保持するが、**plain text vars は保持しない**。
現在の deploy コマンドには `--keep-vars` が無いため、自動公開を有効にすると
初回のdeployでこの2つが消える。

消えると `apps/worker/src/routes/webhook.ts` の legacy forwarding 条件が
成立しなくなり、**WAHMSのリッチメニューを押しても返事が来なくなる**。

### 暫定運用（修正が入るまで）

手動deployでは必ず `--keep-vars` を付ける。

```bash
npx wrangler deploy --config <built-config> --name frei-career --keep-vars
```

## 問題2: 設定漏れで別のリソースが新規作成される

`WORKER_NAME` / `PAGES_PROJECT_NAME` が未設定のとき、
`your-worker-name` / `your-admin-name` という**別のWorker・別のPagesプロジェクト**を
作ってしまうフォールバックが入っている。本番とは無関係な環境が静かに生えるため、
気づくのが遅れる。

### 暫定運用（修正が入るまで）

GitHub Variables に `WORKER_NAME=frei-career` と
`PAGES_PROJECT_NAME=frei-career-admin` を**先に**登録し、登録済みであることを
確認してから `LINE_HARNESS_CLOUDFLARE_DEPLOY=true` にする。

## 問題3: ビルド出力先のパスが合っておらず、そもそもdeployが失敗する

workflowは `dist/line_harness/wrangler.json` を参照しているが、実際のビルド
出力は **`dist/frei_career/wrangler.json`** に生成される。

出力ディレクトリ名は `wrangler.toml` の `name` から決まる。本家は
`line-harness` だが、このforkは `frei-career` へリネームしているため、
`line_harness` というディレクトリは存在しない。

```bash
$ ls apps/worker/dist/
client  frei_career        # line_harness は無い
```

結果として `Patch wrangler config` の `sed` が失敗し、deployにも到達しない。
**問題1・2を直しても、これを直さない限り自動公開は動かない。**
自動公開の実行履歴が0件なのは、これが理由である可能性が高い。

修正はパス指定をWorker名から導出するか、`frei_career` を直接指定する。

## 問題4: 本番の実値がテンプレートの値で上書きされる

ビルドされた `wrangler.json` の `vars` は次のようになっている。

```text
CF_ACCOUNT_ID       = YOUR_DEV_ACCOUNT_ID          ← プレースホルダのまま
D1_DATABASE_ID      = YOUR_DEV_D1_DATABASE_ID      ← プレースホルダのまま
LIFF_PAGES_PROJECT  = frei-career-liff             ← 本番の実値は line-harness-liff
WORKER_PUBLIC_URL   = https://frei-career.workers.dev
                                                   ← 本番の実値は
                                                     https://frei-career.frei-career-consulting.workers.dev
WAHMS_LEGACY_*      = （記載なし）                  ← 本番には手動設定あり
```

workflowの `sed` はD1バインディングの `account_id` / `database_id` は
差し替えるが、`vars` 側の `CF_ACCOUNT_ID` / `D1_DATABASE_ID` は差し替えない。

`--keep-vars` を付ければ本番の実値が保持されるため、当面の実害は避けられる。
恒久対応としては、`wrangler.toml` の `[vars]` を本番の実態に合わせるか、
workflow側でこれらも差し替えるかを決める必要がある。

## 適用するパッチ

`workflow` scope を付与したうえで、次を適用して push する。

```bash
gh auth refresh -h github.com -s workflow
git switch backup/deploy-workflow-hardening   # ローカルに退避済みの場合
```

ローカルの退避ブランチが無い場合は、次の差分を手で当てる。

### deploy-cloudflare-worker.yml

```diff
-          WORKER_NAME: ${{ vars.WORKER_NAME || 'your-worker-name' }}
+          WORKER_NAME: ${{ vars.WORKER_NAME }}
```

```diff
         run: |
           test -n "$D1_DATABASE_ID"
+          # WORKER_NAME が未設定のまま deploy すると "your-worker-name" という
+          # 別の Worker を新規作成してしまい、本番と無関係な環境が生える。
+          # 気づきにくい事故なので、ここで明示的に落とす。
+          test -n "$WORKER_NAME"
           cd apps/worker
```

```diff
-          command: deploy --config dist/line_harness/wrangler.json --name ${{ vars.WORKER_NAME || 'your-worker-name' }}
+          command: deploy --config dist/line_harness/wrangler.json --name ${{ vars.WORKER_NAME }} --keep-vars
```

### deploy-cloudflare-admin.yml

```diff
-          PAGES_PROJECT_NAME: ${{ vars.PAGES_PROJECT_NAME || 'your-admin-name' }}
         run: |
           test -n "$CLOUDFLARE_API_TOKEN"
           test -n "$CLOUDFLARE_ACCOUNT_ID"
           test -n "$NEXT_PUBLIC_API_URL"
+          # 未設定のまま deploy すると "your-admin-name" という別 Pages プロジェクトが
+          # 生えて、本番URLとは違う場所に公開されるので明示的に落とす。
+          test -n "$PAGES_PROJECT_NAME"
```
（`PAGES_PROJECT_NAME` の行は `${{ vars.PAGES_PROJECT_NAME }}` へ変更する）

## 参考: 本番Workerの実際のvarsとwrangler.tomlの不一致

`apps/worker/wrangler.toml` の `[vars]` は本番の実態と一致していない。

| 変数 | wrangler.toml | 本番の実値 |
| --- | --- | --- |
| `WORKER_PUBLIC_URL` | `https://frei-career.workers.dev` | `https://frei-career.frei-career-consulting.workers.dev` |
| `LIFF_PAGES_PROJECT` | `frei-career-liff` | `line-harness-liff` |
| `WAHMS_LEGACY_*` | 記載なし | 手動設定あり |

つまり本番は、このwrangler.tomlからではなく手動の一時configからdeployされている。
**このwrangler.tomlのまま `--keep-vars` 無しでdeployすると、本番のvarsが
上書き・欠落する。** どちらを正とするか整理するまで、必ず `--keep-vars` を使うこと。
