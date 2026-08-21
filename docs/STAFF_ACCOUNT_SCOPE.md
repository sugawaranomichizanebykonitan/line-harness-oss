# 担当LINEアカウントを限定したスタッフ

作成日: 2026-08-21

複数のLINE公式アカウントを1つの管理画面で扱うため、既定ではログインしたスタッフは
全アカウントを操作できる。特定のアカウントだけを任せたい作業者向けに、
スタッフ単位でアクセス範囲を限定できるようにした。

## 仕組み

`staff_members.line_account_id`

- `NULL` … 従来どおり全アカウントを操作できる（既存スタッフはすべてこれ）
- 値あり … そのLINEアカウント以外へ一切到達できない

判定は `apps/worker/src/middleware/auth.ts` の `enforceAccountScope` に一元化した。
`accountId` を受け取るルートは42ファイルに散らばっており、個別に直すと必ず漏れる。
認証の関門（`c.set('staff', ...)` の直後）で一度だけ判定する。

## 判定ルール（fail-closed）

| リクエスト | 結果 |
| --- | --- |
| `?accountId=` が自分の担当と一致 | 通す |
| `?lineAccountId=` が自分の担当と一致 | 通す |
| `X-Line-Account-Id` ヘッダが一致 | 通す |
| 別のアカウントを指定 | **403** |
| **アカウントを指定していない** | **403** |
| `/api/line-accounts` への変更・個別取得 | **403** |
| `/api/line-accounts` の一覧取得 (GET) | 通す（中身は担当分だけに絞る） |
| `/api/auth/session` / `/api/auth/logout` | 通す |

「指定なしを通さない」のが要点。`/api/friends` のようにアカウント指定を省略すると
全アカウント横断で返すエンドポイントがあるため、省略を許すと他アカウントの
データが漏れる。安全側に倒して拒否する。

その代わり、管理画面のうち `accountId` を付けずに呼ぶ画面は 403 になる。
限定スタッフは担当アカウントの画面（WAHMSなら `/wahms`）を使う前提。

## アカウント一覧の絞り込み

`GET /api/line-accounts` は担当アカウントだけを返す。
管理画面のアカウント切替に、担当外のアカウント名すら表示されない。

## 発行方法

`staff_members` に1行入れるだけ。`api_key` がそのままログイン用の認証情報になる。
管理画面のログインはパスワードではなくAPIキーを貼り付ける方式である点に注意。

```sql
INSERT INTO staff_members (id, name, email, role, api_key, is_active, line_account_id)
VALUES (<uuid>, '担当者名', NULL, 'staff', <api_key>, 1, <line_account_id>);
```

## 失効方法

```sql
UPDATE staff_members SET is_active = 0 WHERE id = '<staff_id>';
```

`getStaffByApiKey` が `is_active = 1` のみを引くため、即座にログインできなくなる。

## テスト

`apps/worker/src/middleware/account-scope.test.ts`

担当アカウントの操作が通ること、別アカウント指定・ヘッダ偽装・指定なしがすべて
403になること、限定されていないスタッフが従来どおり動くことを固定している。
