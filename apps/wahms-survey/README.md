# WAHMS 受講者向けの入口 (wahms.pages.dev)

アンケートURLに `frei-career` が入っていると、WAHMSの受講者から見て何のサイトか
分からず、怪しいURLに見える。中身は Worker のまま、入口だけ中立なドメインにする
ための薄いプロキシ。

受講者に渡すURL:

```text
https://wahms.pages.dev/survey?school=マネジメント学校
```

末尾の学校名を変えるだけで各校に対応する。日付は不要 (その日の講義を
サーバ側で判定する)。

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

- `/survey`
- `/survey/thanks`
- `/api/public/wahms-survey`
