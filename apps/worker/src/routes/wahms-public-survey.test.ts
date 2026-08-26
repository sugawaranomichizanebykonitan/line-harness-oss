import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { publicSurvey } from './wahms-public-survey.js';

// LINE登録なしで回答できるアンケート。誰でも開けるエンドポイントなので、
// 実在しない講義や想定外の選択肢を保存しないことを固定する。

const LECTURE = {
  schoolName: '📈 マネジメント学校',
  eventDate: '2026-08-21',
  theme: '「教えたのにできない」は、誰の責任か？',
};

type Insert = { sql: string; args: unknown[] };

const INVITE = {
  token: 'tok_abcdefghijklmnop',
  lineUserId: 'U0c545075e7660d98ea5ec20178a9c935',
  schoolName: '📈 マネジメント学校',
  eventDate: '2026-08-21',
  respondentName: null,
};

function fakeDb(inserts: Insert[], { lectureFound = true, invite = false } = {}) {
  return {
    prepare(sql: string) {
      const run = async () => ({ success: true });
      return {
        bind: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO wahms_survey_responses')) inserts.push({ sql, args });
          return {
            first: async () => {
              if (sql.includes('FROM line_accounts')) return { id: 'wahms-account' };
              if (sql.includes('FROM wahms_survey_invites')) return invite ? INVITE : null;
              if (sql.includes('FROM wahms_applications')) return lectureFound ? LECTURE : null;
              return null;
            },
            run,
          };
        },
        first: async () => (sql.includes('FROM line_accounts') ? { id: 'wahms-account' } : null),
      };
    },
  };
}

const app = new Hono();
app.route('/', publicSurvey as never);

function get(path: string, db: unknown) {
  return app.fetch(new Request(`https://w.example.com${path}`), { DB: db } as never);
}

function post(body: unknown, db: unknown) {
  return app.fetch(
    new Request('https://w.example.com/api/public/wahms-survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB: db } as never,
  );
}

const VALID = {
  school: '📈 マネジメント学校',
  eventDate: '2026-08-21',
  name: '山田 太郎',
  satisfaction: '5',
  valueRating: '無料なのが信じられない',
  nextIntent: '必ず参加したい',
  question: '',
};

describe('回答フォームの表示', () => {
  test('学校を指定するとその講義のフォームが出る', async () => {
    const res = await get('/wahms/survey?school=マネジメント学校', fakeDb([]));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('📈 マネジメント学校');
    expect(html).toContain('お名前');
    expect(html).toContain('無料なのが信じられない');
    // LINEログインを要求しない。これが無いと本来の目的を果たせない。
    expect(html).not.toContain('liff');
  });

  test('埋め込んだJavaScriptが構文エラーになっていない', async () => {
    // テンプレートリテラル内でJSを書くとエスケープが壊れやすい。壊れると
    // 送信処理そのものが動かず、利用者からは「押しても何も起きない」に見える。
    // 実際に一度これで送信不能になったので、構文として通ることを固定する。
    const html = await (await get('/wahms/survey?school=マネジメント学校', fakeDb([]))).text();
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const code of scripts) {
      expect(() => new Function(code)).not.toThrow();
    }
  });

  test('学校を英字キーで指定できる', async () => {
    // 日本語のURLはZoomのチャットなどでリンクとして認識されない。
    // 受講者に配るURLは英数字だけで完結する必要がある。
    const res = await get('/survey/management', fakeDb([]));
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('📈 マネジメント学校');
  });

  test('英字キーは大文字でも開ける', async () => {
    expect((await get('/survey/Management', fakeDb([]))).status).toBe(200);
  });

  test('日本語の旧URLも引き続き開ける', async () => {
    // すでに配ったURLを死なせない。
    expect((await get('/survey?school=マネジメント学校', fakeDb([]))).status).toBe(200);
  });

  test('英字キーで開いても送信後はお礼画面へ遷移する', async () => {
    // /survey/management から相対で /thanks を足すと
    // /survey/management/thanks になってしまう。固定パスであることを確かめる。
    const html = await (await get('/survey/management', fakeDb([]))).text();
    expect(html).toContain("location.href='/survey/thanks'");
    const wahms = await (await get('/wahms/survey/management', fakeDb([]))).text();
    expect(wahms).toContain("location.href='/wahms/survey/thanks'");
  });

  test('/survey/thanks は学校名として扱われない', async () => {
    // ルート登録の順番を入れ替えるとお礼画面が「講義が見つかりません」になる。
    const res = await get('/survey/thanks', fakeDb([], { lectureFound: false }));
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('ご回答ありがとうございました');
  });

  test('該当する講義が無ければ404', async () => {
    const res = await get('/wahms/survey?school=存在しない学校', fakeDb([], { lectureFound: false }));
    expect(res.status).toBe(404);
  });

  test('お礼画面に公式LINEへの導線がある', async () => {
    const res = await get('/wahms/survey/thanks', fakeDb([]));
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('line.me/R/ti/p/@393ixqsd');
  });
});

describe('回答の保存', () => {
  test('正しい回答はLINE版と同じテーブルに入る', async () => {
    const inserts: Insert[] = [];
    const res = await post(VALID, fakeDb(inserts));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
    expect(inserts).toHaveLength(1);

    const args = inserts[0].args;
    // line_user_id は 'web-' 始まり。LINE返信できない相手だと後から判別するため。
    expect(String(args[2])).toMatch(/^web-/);
    expect(args[3]).toBe('📈 マネジメント学校_2026-08-21'); // lecture_label
    expect(args[5]).toBe(5); // satisfaction
    expect(args[9]).toBe('山田 太郎'); // respondent_name
    // 質問が空なら要対応にしない。
    expect(args[10]).toBe('none');
    // source_row はスプレッドシート由来なので入れない。
    expect(inserts[0].sql).toContain('NULL');
  });

  test('質問が書かれていれば要対応にする', async () => {
    const inserts: Insert[] = [];
    await post({ ...VALID, question: '事業の相談をしたいです' }, fakeDb(inserts));
    expect(inserts[0].args[10]).toBe('pending');
  });

  test('お名前が無ければ保存しない', async () => {
    const inserts: Insert[] = [];
    const res = await post({ ...VALID, name: '' }, fakeDb(inserts));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  test('満足度が1〜5の範囲外なら保存しない', async () => {
    const inserts: Insert[] = [];
    for (const v of ['0', '6', 'あ', '']) {
      const res = await post({ ...VALID, satisfaction: v }, fakeDb(inserts));
      expect(res.status).toBe(400);
    }
    expect(inserts).toHaveLength(0);
  });

  test('選択肢にない値は保存しない', async () => {
    // 誰でも叩けるエンドポイントなので、画面を経由しない投稿も想定する。
    const inserts: Insert[] = [];
    expect((await post({ ...VALID, valueRating: '最高' }, fakeDb(inserts))).status).toBe(400);
    expect((await post({ ...VALID, nextIntent: 'いつか' }, fakeDb(inserts))).status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  test('実在しない講義には保存しない', async () => {
    const inserts: Insert[] = [];
    const res = await post(VALID, fakeDb(inserts, { lectureFound: false }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});

// ─── LINEから配信した案内 ───────────────────────────────────
// Apps Script の LIFF は講義名を「読み込み中」のまま保存していた。
// 案内トークンで講義と回答者を確定させ、同じことが起きないようにする。

describe('案内トークン', () => {
  test('トークンで開くとその講義のフォームが出る', async () => {
    const res = await get(`/survey?t=${INVITE.token}`, fakeDb([], { invite: true }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('📈 マネジメント学校');
    expect(html).toContain(`name="token" value="${INVITE.token}"`);
  });

  test('知らないトークンは開けない', async () => {
    const res = await get('/survey?t=tok_unknownunknownun', fakeDb([], { invite: false }));
    expect(res.status).toBe(404);
  });

  test('案内に書かれた講義として記録する', async () => {
    // 「今日に一番近い回」で引くと、配信の数日後に回答されたときに
    // 別の回の集計へ入る。実際に 8/21 の回答が 8/28 として保存された。
    const inserts: Insert[] = [];
    await post({ ...VALID, token: INVITE.token }, fakeDb(inserts, { invite: true }));
    expect(inserts[0].args[3]).toBe('📈 マネジメント学校_2026-08-21');
    expect(inserts[0].args[4]).toBe('📈 マネジメント学校');
  });

  test('LINEの回答として保存する（web-始まりにしない）', async () => {
    // 誰の回答かが分かるので、質問への1対1返信がそのまま使える。
    const inserts: Insert[] = [];
    const res = await post({ ...VALID, token: INVITE.token }, fakeDb(inserts, { invite: true }));
    expect(res.status).toBe(200);
    expect(inserts[0].args[2]).toBe(INVITE.lineUserId);
    expect(String(inserts[0].args[2])).not.toMatch(/^web-/);
  });

  test('トークン無しの回答は今までどおりWeb回答として入る', async () => {
    const inserts: Insert[] = [];
    await post(VALID, fakeDb(inserts));
    expect(String(inserts[0].args[2])).toMatch(/^web-/);
  });

  test('偽のトークンでは保存しない', async () => {
    const inserts: Insert[] = [];
    const res = await post({ ...VALID, token: 'tok_forgedforgedforg' }, fakeDb(inserts, { invite: false }));
    expect(res.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});
