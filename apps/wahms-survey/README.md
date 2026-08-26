# WAHMS 受講者向けの入口 (wahms.pages.dev)

アンケートURLに `frei-career` が入っていると、WAHMSの受講者から見て何のサイトか
分からず、怪しいURLに見える。中身は Worker のまま、入口だけ中立なドメインにする
ための薄いプロキシ。

受講者に渡すURL:

```text
https://wahms.pages.dev/survey/management
```

| 学校 | URL末尾 |
| --- | --- |
| マーケティング学校 | `marketing` |
| 青山塾 | `aoyama` |
| WEB学校 | `web` |
| セールス学校 | `sales` |
| マネジメント学校 | `management` |
| 人間力学校 | `human` |

日付は不要 (その日の講義をサーバ側で判定する)。

URLに日本語を入れないのは、Zoomのチャットなどに貼ったとき日本語部分が
URLと認識されず、リンクが途中で切れてしまうため。
旧形式の `?school=マネジメント学校` も引き続き開ける。

## 公開方法

```bash
pnpm exec wrangler pages deploy apps/wahms-survey/public \
  --project-name=wahms --branch main
```

`--branch main` を忘れると Preview になり、本番へ反映されない。

## 設計

`public/_worker.js` が Cloudflare Pages の Advanced Mode で動き、
`frei-career` の Worker へ1対1でパスを渡す。

書き換えを増やさないのは、フォームが出す相対リンク (`/survey/thanks`,
`/api/public/wahms-survey`) と対応が崩れるため。

入口は次の3つだけに絞っている。この中立ドメインから管理APIや他の機能へ
到達できてはいけない。

- `/survey` と `/survey/<学校の英字キー>`
- `/survey/thanks`
- `/api/public/wahms-survey`
