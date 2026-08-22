/**
 * WAHMS 受講者向けの中立ドメイン。
 *
 * アンケートURLに frei-career が入っていると、受講者から見て何のサイトか
 * 分からず、怪しいURLに見える。中身は Worker のままで、入口だけ wahms の
 * ドメインにするための薄いプロキシ。
 *
 * 1対1でパスを渡すだけにしている。書き換えを増やすと、フォームが出す
 * 相対リンク (/survey/thanks, /api/public/...) と対応が崩れるため。
 */

const ORIGIN = 'https://frei-career.frei-career-consulting.workers.dev';

/** 受講者に見せる入口。ここ以外は開けない。 */
const ALLOWED = [
  // /survey と /survey/<学校の英字キー>、および /survey/thanks。
  // 学校名を日本語でURLに載せると Zoom のチャットなどでリンクにならないため、
  // 受講者に配るURLは英数字だけにしている。
  /^\/survey(?:\/[A-Za-z0-9_-]+)?$/,
  /^\/api\/public\/wahms-survey$/,
];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 入口を絞る。管理画面や他のAPIまでこのドメインから触れるようにしない。
    if (url.pathname === '/') {
      return Response.redirect(new URL('/survey', url).toString(), 302);
    }
    if (!ALLOWED.some((re) => re.test(url.pathname))) {
      return new Response('Not found', { status: 404 });
    }

    const target = new URL(ORIGIN);
    target.pathname = url.pathname;
    target.search = url.search;

    const upstream = await fetch(new Request(target, request));

    // Worker 側のリダイレクト先が frei-career を指したままだと、せっかく
    // 隠した入口が露出する。念のためこのドメインへ書き戻す。
    const location = upstream.headers.get('location');
    if (location && location.startsWith(ORIGIN)) {
      const fixed = new Headers(upstream.headers);
      fixed.set('location', location.replace(ORIGIN, url.origin));
      return new Response(upstream.body, { status: upstream.status, headers: fixed });
    }
    return upstream;
  },
};
