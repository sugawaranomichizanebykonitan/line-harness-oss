import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const pushMessage = vi.fn(async () => ({}));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class { pushMessage = pushMessage; },
}));

const { profileForm } = await import('./wahms-profile-form.js');

// 初参加者のプロフィール登録。誰でも開けるページなので、
// 使い捨てトークンの扱いと、想定外の値を保存しないことを固定する。

const INVITE = {
  token: 'tok_abcdefghijklmnop',
  lineAccountId: 'wahms-account',
  lineUserId: 'U57beeb14d4fb8db188c916ec8f70d781',
  bookingText: '8月26日WEB学校に申し込む' as string | null,
  schoolName: '💻 WEB学校',
  eventDate: '2026-08-26',
  usedAt: null as string | null,
};

const SLOT = {
  slotId: 'slot-1', eventId: 'ev-1', schoolName: '💻 WEB学校',
  eventDate: '2026-08-26', startTime: '20:30', endTime: '22:00',
  lectureLabel: '第10回', theme: 'テーマW',
};

type Call = { sql: string; args: unknown[] };

function fakeDb(calls: Call[], o: {
  invite?: Partial<typeof INVITE> | null;
  participant?: boolean;
  claimed?: boolean;
  slot?: boolean;
  zoom?: boolean;
} = {}) {
  const { invite = {}, participant = true, claimed = true, slot = true, zoom = true } = o;
  const row = invite === null ? null : { ...INVITE, ...invite };
  return {
    prepare(sql: string) {
      const handle = (args: unknown[]) => ({
        run: async () => ({ success: true, meta: { changes: claimed ? 1 : 0 } }),
        first: async () => {
          void args;
          if (sql.includes('FROM wahms_profile_invites')) return row;
          if (sql.includes('FROM wahms_participants')) return participant ? { id: 'p-1' } : null;
          if (sql.includes('FROM event_slots')) return slot ? SLOT : null;
          if (sql.includes('FROM line_accounts')) return { channel_access_token: 'tok' };
          return null;
        },
        all: async () => ({
          results: sql.includes('FROM account_settings') && zoom
            ? [
                { key: 'wahms_zoom_url', value: 'https://zoom.test/j/1' },
                { key: 'wahms_zoom_id', value: '489' },
                { key: 'wahms_zoom_password', value: 'whams' },
              ]
            : [],
        }),
      });
      return { bind: (...args: unknown[]) => { calls.push({ sql, args }); return handle(args); }, ...handle([]) };
    },
  };
}

const app = new Hono();
app.route('/', profileForm as never);

const get = (path: string, db: unknown) =>
  app.fetch(new Request(`https://wahms.test${path}`), { DB: db } as never);

const post = (body: unknown, db: unknown) =>
  app.fetch(
    new Request('https://wahms.test/api/public/wahms-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB: db } as never,
  );

const ANSWER = {
  token: INVITE.token,
  realName: '佐藤 亨',
  occupation: '経営者',
  gender: '男性',
  ageGroup: '40代',
  hasSite: 'あり',
  siteUrl: 'https://example.com',
  interests: ['マーケティング', 'WEB'],
};

beforeEach(() => pushMessage.mockClear());

describe('フォームの表示', () => {
  test('案内トークンがあれば設問を出す', async () => {
    const res = await get(`/profile?t=${INVITE.token}`, fakeDb([]));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('はじめてのご登録');
    expect(html).toContain('💻 WEB学校');
    expect(html).toContain('8月26日（水）');
    for (const o of ['経営者', '個人事業主', '会社員', '学生', '接客業', '主婦・子育て', 'その他']) {
      expect(html).toContain(o);
    }
  });

  test('トークンが無い・知らないトークンなら開けない', async () => {
    expect((await get('/profile', fakeDb([]))).status).toBe(404);
    expect((await get('/profile?t=tok_unknownunknown', fakeDb([], { invite: null }))).status).toBe(404);
  });

  test('回答済みのトークンは再度開けない', async () => {
    const res = await get(`/profile?t=${INVITE.token}`, fakeDb([], { invite: { usedAt: '2026-08-26T20:00:00' } }));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('ご登録はお済みです');
  });

  test('お礼の画面は誰でも開ける', async () => {
    const res = await get('/profile/thanks', fakeDb([]));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ご登録ありがとうございました');
  });
});

describe('回答の保存', () => {
  test('登録者マスターに書き、申込完了をLINEへ送る', async () => {
    const calls: Call[] = [];
    const res = await post(ANSWER, fakeDb(calls));
    expect(await res.json()).toEqual({ success: true });

    const update = calls.find((c) => c.sql.includes('UPDATE wahms_participants'));
    expect(update).toBeTruthy();
    expect(update!.args).toContain('佐藤 亨');
    expect(update!.args).toContain('経営者');
    expect(update!.args).toContain('マーケティング,WEB');
    expect(update!.sql).toContain('survey_completed_at');

    expect(pushMessage).toHaveBeenCalledTimes(1);
    const [to, messages] = pushMessage.mock.calls[0] as unknown as [string, { text: string }[]];
    expect(to).toBe(INVITE.lineUserId);
    expect(messages[0].text).toBe('✅ お申し込みが完了しました');
    expect(messages[1].text).toContain('https://zoom.test/j/1');
  });

  test('登録者マスターに行が無ければ作る', async () => {
    const calls: Call[] = [];
    await post(ANSWER, fakeDb(calls, { participant: false }));
    expect(calls.some((c) => c.sql.includes('INSERT INTO wahms_participants'))).toBe(true);
  });

  test('二重送信は1通目を上書きしない', async () => {
    // 送信ボタンを連打すると、2通目は中身が欠けていることがある。使用済みの
    // 取り合いに負けた側は、保存も通知もしない。
    const calls: Call[] = [];
    const res = await post({ token: INVITE.token, realName: '佐藤 亨', occupation: '経営者' }, fakeDb(calls, { claimed: false }));
    expect(await res.json()).toEqual({ success: true });
    expect(calls.some((c) => c.sql.includes('UPDATE wahms_participants'))).toBe(false);
    expect(calls.some((c) => c.sql.includes('INSERT INTO wahms_participants'))).toBe(false);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('知らないトークンは受け付けない', async () => {
    const res = await post({ ...ANSWER, token: 'tok_unknownunknown' }, fakeDb([], { invite: null }));
    expect(res.status).toBe(400);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('お名前とご職業は必須', async () => {
    expect((await post({ ...ANSWER, realName: '  ' }, fakeDb([]))).status).toBe(400);
    expect((await post({ ...ANSWER, occupation: '' }, fakeDb([]))).status).toBe(400);
  });

  test('選択肢にない値は保存しない', async () => {
    // 画面を通さず直接送られても、想定外の値を登録者マスターに入れない。
    expect((await post({ ...ANSWER, occupation: '社長（自称）' }, fakeDb([]))).status).toBe(400);

    const calls: Call[] = [];
    await post({ ...ANSWER, gender: 'その他の性別', ageGroup: '100代', hasSite: 'たぶん', interests: ['料理'] }, fakeDb(calls));
    const update = calls.find((c) => c.sql.includes('UPDATE wahms_participants'))!;
    expect(update.args).toContain(null);        // 性別・年代・サイト有無は空で保存
    expect(update.args).toContain('');          // 興味のある学校は空文字
    expect(update.args).not.toContain('料理');
  });

  test('任意項目が空でも受け付ける', async () => {
    const calls: Call[] = [];
    const res = await post({ token: INVITE.token, realName: '山田 太郎', occupation: '会社員' }, fakeDb(calls));
    expect(await res.json()).toEqual({ success: true });
    expect(calls.some((c) => c.sql.includes('UPDATE wahms_participants'))).toBe(true);
  });

  test('Zoom設定が無ければ回答は残し、通知だけ見送る', async () => {
    const calls: Call[] = [];
    const res = await post(ANSWER, fakeDb(calls, { zoom: false }));
    expect(await res.json()).toEqual({ success: true });
    expect(calls.some((c) => c.sql.includes('UPDATE wahms_participants'))).toBe(true);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('保留していた申込が無くても回答は保存する', async () => {
    const calls: Call[] = [];
    const res = await post(ANSWER, fakeDb(calls, { invite: { bookingText: null } }));
    expect(await res.json()).toEqual({ success: true });
    expect(calls.some((c) => c.sql.includes('UPDATE wahms_participants'))).toBe(true);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('LINEへの送信に失敗しても回答は失われない', async () => {
    pushMessage.mockRejectedValueOnce(new Error('LINE API down'));
    const calls: Call[] = [];
    const res = await post(ANSWER, fakeDb(calls));
    expect(await res.json()).toEqual({ success: true });
    expect(calls.some((c) => c.sql.includes('UPDATE wahms_participants'))).toBe(true);
  });
});
