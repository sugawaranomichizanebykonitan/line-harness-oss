import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  replyMessage: vi.fn(),
  pushMessage: vi.fn(),
}));

// Stub the DB graph — these tests focus on webhook guard behavior and the
// first-contact friend registration path without touching real D1/LINE.
vi.mock('@line-crm/db', () => ({
  upsertFriend: vi.fn(),
  updateFriendFollowStatus: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getScenarioSteps: vi.fn(),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  upsertChatOnMessage: vi.fn(),
  getLineAccounts: vi.fn().mockResolvedValue([]),
  jstNow: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  addTagToFriend: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getMessageTemplateById: vi.fn(),
  getTemplateById: vi.fn(),
}));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    verifySignature: vi.fn(),
    LineClient: vi.fn().mockImplementation(() => lineClientMocks),
  };
});

vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
  logOutgoingMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/activity-mileage.js', () => ({
  awardActivityMileage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
}));

vi.mock('../services/step-delivery.js', () => ({
  buildMessage: vi.fn(),
  expandVariables: vi.fn(),
  resolveMetadata: vi.fn(),
  messageToLogPayload: vi.fn(),
}));

import { verifySignature } from '@line-crm/line-sdk';
import {
  addTagToFriend,
  advanceFriendScenario,
  completeFriendScenario,
  computeNextDeliveryAt,
  enrollFriendInScenario,
  getEntryRouteByRefCode,
  getFriendByLineUserId,
  getLineAccounts,
  getMessageTemplateById,
  getScenarioSteps,
  getScenarios,
  jstNow,
  resolveStepContent,
  updateFriendFollowStatus,
  upsertChatOnMessage,
  upsertFriend,
} from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { webhook } from './webhook.js';

function setupApp() {
  const app = new Hono();
  app.route('/', webhook);
  return app;
}

const baseEnv = {
  DB: {} as D1Database,
  LINE_CHANNEL_SECRET: 'env-default-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-default-token',
} as Record<string, unknown>;

const baseExecutionCtx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLineAccounts).mockResolvedValue([]);
});

describe('POST /webhook — DoS defenses (#104)', () => {
  test('rejects with 413 when Content-Length declares an oversized body', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(2 * 1024 * 1024), // 2 MiB > 1 MiB cap
          'X-Line-Signature': 'whatever',
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    // Signature verification must not even be attempted on an oversized body.
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('rejects with 413 when actual body exceeds the cap even if Content-Length is absent', async () => {
    const app = setupApp();
    const oversizedBody = 'x'.repeat(1024 * 1024 + 1);
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'whatever',
        },
        body: oversizedBody,
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('verifies signature before parsing JSON — malformed body with invalid signature never reaches the parser', async () => {
    vi.mocked(verifySignature).mockResolvedValue(false);

    const app = setupApp();
    // 44-char signature (valid HMAC-SHA256 base64 length) so it clears the
    // length pre-check and reaches verifySignature. Malformed JSON body: if
    // signature were verified *after* parse (old behavior), we'd hit the
    // parser-failure branch first. With signature-first, we get the invalid-
    // signature branch and never attempt to parse.
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: '{not valid json',
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // verifySignature must run; rejection happens before any parse attempt.
    expect(verifySignature).toHaveBeenCalled();
    expect(verifySignature).toHaveBeenCalledWith('env-default-secret', '{not valid json', validShapedSignature);
  });

  test('rejects unsigned or malformed-signature requests without hitting verifySignature or D1', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Missing X-Line-Signature header entirely.
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // Fast-rejected before any crypto / DB work.
    expect(verifySignature).not.toHaveBeenCalled();
  });
});

describe('POST /webhook — WAHMS legacy bridge', () => {
  /** WAHMSアカウントとして署名検証を通すための共通設定。 */
  function wahmsAccounts() {
    vi.mocked(verifySignature).mockResolvedValue(true);
    // 友だち解決まで通さないと handleEvent が途中で落ち、返信経路が動かない。
    vi.mocked(getFriendByLineUserId).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'Uarchive',
      line_account_id: 'wahms-account',
      is_following: 1,
    } as never);
    vi.mocked(getLineAccounts).mockResolvedValue([
      {
        id: 'wahms-account',
        channel_id: 'wahms-channel',
        channel_access_token: 'wahms-token',
        channel_secret: 'env-default-secret',
        name: 'WAHMS',
        is_active: 1,
      } as never,
    ]);
  }

  /** アーカイブ2本ぶんを返すだけの最小D1。返信本文の組み立てまで通す。 */
  function archiveDb() {
    return {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ success: true }),
          first: async () => null,
          all: async () => ({
            results: [
              { school_name: '🔥 マーケティング学校', lecture_number: '1.0', theme: 'テーマA', held_on: '2026-05-12T00:00:00', youtube_url: 'https://youtu.be/a' },
              { school_name: '🔥 マーケティング学校', lecture_number: '2.0', theme: 'テーマB', held_on: '2026-05-19T00:00:00', youtube_url: 'https://youtu.be/b' },
            ],
          }),
        }),
      }),
    };
  }

  function wahmsEnv() {
    return {
      ...baseEnv,
      DB: archiveDb(),
      WAHMS_LEGACY_LINE_ACCOUNT_ID: 'wahms-account',
      WAHMS_LEGACY_WEBHOOK_URL: 'https://script.google.test/exec',
    };
  }

  function textEvent(text: string) {
    return {
      type: 'message',
      replyToken: 'reply-token',
      source: { type: 'user', userId: 'Uarchive' },
      message: { type: 'text', id: 'm1', text },
    };
  }

  // Workers用のfetch型とvi.spyOnの型が噛み合わないので、呼び出し履歴だけを見る形にする。
  async function post(events: unknown[], fetchSpy: { mock: { calls: unknown[][] } }) {
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const rawBody = JSON.stringify({ destination: 'wahms', events });
    const res = await setupApp().request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'A'.repeat(43) + '=' },
        body: rawBody,
      },
      wahmsEnv(),
      executionCtx,
    );
    // 未解決のまま残すとテスト間で漏れるので、積まれた処理を流し切る。
    for (const call of vi.mocked(executionCtx.waitUntil).mock.calls) {
      await (call[0] as Promise<unknown>).catch(() => {});
    }
    const forwarded = fetchSpy.mock.calls.some((c) => String(c[0]).includes('script.google.test'));
    return { res, forwarded };
  }

  test('アーカイブ要求はApps Scriptへ転送しない（二重返信を防ぐ）', async () => {
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    lineClientMocks.replyMessage.mockClear();
    const { res, forwarded } = await post([textEvent('マーケティング学校 アーカイブ')], fetchSpy);
    expect(res.status).toBe(200);
    expect(forwarded).toBe(false);
    // 転送しない代わりに、Worker が replyToken を使って一覧を返す。
    expect(lineClientMocks.replyMessage).toHaveBeenCalledTimes(1);
    const [, messages] = lineClientMocks.replyMessage.mock.calls[0];
    expect(messages[0].text).toContain('🔥 マーケティング学校 アーカイブ（2本）');
    expect(messages[0].text).toContain('https://youtu.be/a');
    fetchSpy.mockRestore();
  });

  test('リッチメニューの応答はすべて Worker が返し、転送しない', async () => {
    // 移行前は Apps Script が返していた4つ。転送すると同じものが2通届く。
    for (const [text, expected] of [
      ['今週の開催日', '今週の開催日'],
      ['受講者の声', '受講者のリアルな声'],
      ['よくある質問', 'Q. 本当に無料ですか？'],
      ['ワムスとは？', 'SIX Academy『WAHMS』とは'],
    ] as const) {
      wahmsAccounts();
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
      lineClientMocks.replyMessage.mockClear();
      const { forwarded } = await post([textEvent(text)], fetchSpy);
      expect(forwarded, text).toBe(false);
      expect(lineClientMocks.replyMessage, text).toHaveBeenCalledTimes(1);
      const [, messages] = lineClientMocks.replyMessage.mock.calls[0];
      expect(JSON.stringify(messages), text).toContain(expected);
      fetchSpy.mockRestore();
    }
  });

  test('1回のwebhookに複数のイベントが入っても、全部 Worker が返す', async () => {
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    lineClientMocks.replyMessage.mockClear();
    const { forwarded } = await post(
      [textEvent('マーケティング学校 アーカイブ'), textEvent('よくある質問')],
      fetchSpy,
    );
    expect(forwarded).toBe(false);
    expect(lineClientMocks.replyMessage).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  test('WAHMS と関係のない文章には答えず、転送もしない', async () => {
    // Apps Script も知らない文言には何も返さない。転送しても何も起きない。
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    lineClientMocks.replyMessage.mockClear();
    const { forwarded } = await post([textEvent('ありがとうございました！')], fetchSpy);
    expect(forwarded).toBe(false);
    expect(lineClientMocks.replyMessage).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  // ─── 申込の引き取り ───────────────────────────────────────────
  // Worker が確実に扱えるときだけ返信し、それ以外は Apps Script へ渡す。
  // 「返せなかったのに転送もしない」が起きると、申し込んだ人に何も届かない。

  function bookingDb({ repeat = true, slot = true, zoom = true } = {}) {
    const SLOT = {
      slotId: 'slot-1', eventId: 'ev-1', schoolName: '🔥 マーケティング学校',
      eventDate: '2026-08-25', startTime: '20:30', endTime: '22:00',
      lectureLabel: '第13回', theme: '安売りは、本当に「負け」なのか？',
    };
    const make = (sql: string) => ({
      run: async () => ({ success: true }),
      first: async () => {
        if (sql.includes('FROM wahms_participants')) return repeat ? { ok: 1 } : null;
        if (sql.includes('FROM event_slots')) return slot ? SLOT : null;
        if (sql.includes('FROM friends')) return { id: 'friend-1' };
        if (sql.includes('FROM wahms_applications')) return null;
        if (sql.includes('FROM event_bookings')) return null;
        return null;
      },
      all: async () => ({
        results: sql.includes('FROM account_settings')
          ? [
              { key: 'wahms_survey_form_url', value: 'https://wahms.test/survey' },
              ...(zoom
                ? [
                    { key: 'wahms_zoom_url', value: 'https://zoom.test/j/1' },
                    { key: 'wahms_zoom_id', value: '4891469109' },
                    { key: 'wahms_zoom_password', value: 'whams' },
                  ]
                : []),
            ]
          : [],
      }),
    });
    return { prepare: (sql: string) => ({ bind: () => make(sql), ...make(sql) }) };
  }

  async function postBooking(text: string, db: unknown, fetchSpy: { mock: { calls: unknown[][] } }) {
    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext;
    const res = await setupApp().request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Line-Signature': 'A'.repeat(43) + '=' },
        body: JSON.stringify({ destination: 'wahms', events: [textEvent(text)] }),
      },
      { ...wahmsEnv(), DB: db },
      executionCtx,
    );
    for (const call of vi.mocked(executionCtx.waitUntil).mock.calls) {
      await (call[0] as Promise<unknown>).catch(() => {});
    }
    return { res, forwarded: fetchSpy.mock.calls.some((c) => String(c[0]).includes('script.google.test')) };
  }

  test('リピーターの申込は Worker が返し、転送しない', async () => {
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    lineClientMocks.replyMessage.mockClear();
    const { forwarded } = await postBooking('8月25日マーケティング学校に申し込む', bookingDb(), fetchSpy);
    expect(forwarded).toBe(false);
    expect(lineClientMocks.replyMessage).toHaveBeenCalledTimes(1);
    const [, messages] = lineClientMocks.replyMessage.mock.calls[0];
    expect(messages[0].text).toBe('✅ お申し込みが完了しました');
    expect(messages[1].text).toContain('🔥 マーケティング学校');
    expect(messages[1].text).toContain('8月25日（火）20:30〜22:00');
    expect(messages[1].text).toContain('https://zoom.test/j/1');
    fetchSpy.mockRestore();
  });

  test('初参加の人にはプロフィール登録の案内を返す', async () => {
    // 移行前はここで Apps Script が LIFF へ案内していた。Worker が自前の
    // フォームを持ったので、申込の最初から最後までこちらで完結する。
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    lineClientMocks.replyMessage.mockClear();
    const { forwarded } = await postBooking('8月25日マーケティング学校に申し込む', bookingDb({ repeat: false }), fetchSpy);
    expect(forwarded).toBe(false);
    expect(lineClientMocks.replyMessage).toHaveBeenCalledTimes(1);
    const [, messages] = lineClientMocks.replyMessage.mock.calls[0];
    expect(messages[0].text).toContain('WAHMSは初参加の方ですね！');
    expect(messages[1].text).toContain('https://wahms.test/profile?t=');
    fetchSpy.mockRestore();
  });

  test('返信を任せた場合でも、申込は必ずこちらに記録する', async () => {
    // 当日はじめて友だち追加した人の申込が管理画面に出ず、講義当日に
    // 3件取りこぼした (2026-08-26 WEB学校)。記録と返信は別の話なので、
    // 返信を Apps Script に任せても記録は残す。
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const calls: string[] = [];
    const db = bookingDb({ repeat: false });
    const orig = db.prepare.bind(db);
    (db as { prepare: (sql: string) => unknown }).prepare = (sql: string) => { calls.push(sql); return orig(sql) };
    await postBooking('8月25日マーケティング学校に申し込む', db, fetchSpy);
    expect(calls.some((c) => c.includes('INSERT INTO wahms_applications'))).toBe(true);
    fetchSpy.mockRestore();
  });

  test('開催予定に無い回は記録もしない', async () => {
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const calls: string[] = [];
    const db = bookingDb({ slot: false });
    const orig = db.prepare.bind(db);
    (db as { prepare: (sql: string) => unknown }).prepare = (sql: string) => { calls.push(sql); return orig(sql) };
    const { forwarded } = await postBooking('5月12日マーケティング学校に申し込む', db, fetchSpy);
    expect(forwarded).toBe(true);
    expect(calls.some((c) => c.includes('INSERT INTO wahms_applications'))).toBe(false);
    fetchSpy.mockRestore();
  });

  test('開催予定に無い回は Apps Script に任せる（終了済みの案内があるため）', async () => {
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    lineClientMocks.replyMessage.mockClear();
    const { forwarded } = await postBooking('5月12日マーケティング学校に申し込む', bookingDb({ slot: false }), fetchSpy);
    expect(forwarded).toBe(true);
    expect(lineClientMocks.replyMessage).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('Zoom設定が無ければ Apps Script に任せる（URLの無い案内を送らない）', async () => {
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    lineClientMocks.replyMessage.mockClear();
    const { forwarded } = await postBooking('8月25日マーケティング学校に申し込む', bookingDb({ zoom: false }), fetchSpy);
    expect(forwarded).toBe(true);
    fetchSpy.mockRestore();
  });

  test('返信に失敗したら転送する（申し込んだのに無反応を作らない）', async () => {
    wahmsAccounts();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    lineClientMocks.replyMessage.mockClear();
    lineClientMocks.replyMessage.mockRejectedValueOnce(new Error('LINE API down'));
    const { forwarded } = await postBooking('8月25日マーケティング学校に申し込む', bookingDb(), fetchSpy);
    expect(forwarded).toBe(true);
    fetchSpy.mockRestore();
  });

  test('返すものが無いときは Apps Script を呼ばない', async () => {
    // 転送そのものをやめたので、素通しの中継は起きない。
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getLineAccounts).mockResolvedValue([
      {
        id: 'wahms-account',
        channel_id: 'wahms-channel',
        channel_access_token: 'wahms-token',
        channel_secret: 'env-default-secret',
        name: 'WAHMS',
        is_active: 1,
      } as never,
    ]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const { forwarded } = await post([], fetchSpy);
    expect(forwarded).toBe(false);
    fetchSpy.mockRestore();
  });

  test('友だち追加には今週のカレンダーを返す', async () => {
    wahmsAccounts();
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'Unew',
      // ref_code があると紹介リンクの解決待ちに入らない。この検証の対象外。
      ref_code: 'ref-1',
      first_followed_at: '2026-08-26T20:00:00.000+09:00',
      created_at: '2026-08-26T20:00:00.000+09:00',
    } as never);
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(null as never);
    vi.mocked(getScenarios).mockResolvedValue([] as never);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    lineClientMocks.replyMessage.mockClear();
    const { forwarded } = await post(
      [{ type: 'follow', replyToken: 'reply-token', source: { type: 'user', userId: 'Unew' } }],
      fetchSpy,
    );
    expect(forwarded).toBe(false);
    expect(lineClientMocks.replyMessage).toHaveBeenCalledTimes(1);
    const [, messages] = lineClientMocks.replyMessage.mock.calls[0];
    expect(messages[0].type).toBe('flex');
    expect(messages[0].altText).toContain('WAHMSへようこそ');
    fetchSpy.mockRestore();
  });

  test('Worker が応答を組み立てられなかったら Apps Script へ渡す', async () => {
    // ここが抜けると「押したのに何も返ってこない」になる。最後の受け皿。
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(jstNow).mockReturnValue('2026-08-20T15:45:12.000+09:00');
    vi.mocked(getLineAccounts).mockResolvedValue([
      {
        id: 'wahms-account',
        channel_id: 'wahms-channel',
        channel_access_token: 'wahms-token',
        channel_secret: 'env-default-secret',
        name: 'WAHMS',
        is_active: 1,
      } as never,
    ]);
    vi.mocked(getFriendByLineUserId).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: null,
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: 'wahms-account',
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-08-20T15:00:00.000+09:00',
      updated_at: '2026-08-20T15:00:00.000+09:00',
    });

    // D1 が all() を持たない = 開催予定を引けずに落ちる、という壊れ方。
    const stmt = { bind: vi.fn(), run: vi.fn().mockResolvedValue({}) };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;
    const rawBody = JSON.stringify({
      destination: 'wahms',
      events: [{
        type: 'message',
        replyToken: 'reply-once',
        source: { type: 'user', userId: 'U-existing' },
        message: { id: 'message-1', type: 'text', text: '今週の開催日' },
      }],
    });

    const res = await setupApp().request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'A'.repeat(43) + '=',
        },
        body: rawBody,
      },
      {
        ...baseEnv,
        DB: db,
        WAHMS_LEGACY_LINE_ACCOUNT_ID: 'wahms-account',
        WAHMS_LEGACY_WEBHOOK_URL: 'https://script.google.test/exec',
      },
      executionCtx,
    );

    expect(res.status).toBe(200);
    await Promise.all(
      vi.mocked(executionCtx.waitUntil).mock.calls.map(([promise]) => promise),
    );
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://script.google.test/exec',
      expect.objectContaining({ method: 'POST', body: rawBody }),
    );
    fetchSpy.mockRestore();
  });
});

describe('POST /webhook — postback events', () => {
  test('fires postback_received with postback.data so IF-THEN automations run on rich menu taps', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(jstNow).mockReturnValue('2026-07-19T12:00:00.000+09:00');
    vi.mocked(getFriendByLineUserId).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: null,
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-07-19T12:00:00.000+09:00',
      updated_at: '2026-07-19T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }), // no auto_reply match
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'postback',
              replyToken: 'reply-token-postback',
              postback: { data: 'tag:premium' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-postback-1',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db },
      executionCtx,
    );

    expect(res.status).toBe(200);
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    // No auto-reply matched — the reply token must be handed to the event bus
    // so automations can still use it for free reply delivery.
    expect(fireEvent).toHaveBeenCalledWith(
      db,
      'postback_received',
      {
        friendId: 'friend-1',
        eventData: { text: 'tag:premium', matched: false },
        replyToken: 'reply-token-postback',
      },
      'env-default-token',
      null,
    );
    expect(lineClientMocks.replyMessage).not.toHaveBeenCalled();
  });

  test('silent auto-reply rule suppresses the reply but still fires postback_received as matched', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(jstNow).mockReturnValue('2026-07-19T12:00:00.000+09:00');
    vi.mocked(getFriendByLineUserId).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: null,
      status_message: null,
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-07-19T12:00:00.000+09:00',
      updated_at: '2026-07-19T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({
        results: [
          {
            id: 'rule-1',
            keyword: 'tag:premium',
            match_type: 'exact',
            response_type: 'silent',
            response_content: '',
            template_id: null,
          },
        ],
      }),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'postback',
              replyToken: 'reply-token-postback',
              postback: { data: 'tag:premium' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-postback-2',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db },
      executionCtx,
    );

    expect(res.status).toBe(200);
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    // Silent rule: no reply sent, but matched=true and the unconsumed reply
    // token still reaches the event bus (rich menu tap → silent + add_tag flow).
    expect(lineClientMocks.replyMessage).not.toHaveBeenCalled();
    expect(fireEvent).toHaveBeenCalledWith(
      db,
      'postback_received',
      {
        friendId: 'friend-1',
        eventData: { text: 'tag:premium', matched: true },
        replyToken: 'reply-token-postback',
      },
      'env-default-token',
      null,
    );
  });
});

describe('POST /webhook — first-contact existing friends', () => {
  test('auto-registers an unknown text-message sender without firing friend_add handling', async () => {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(jstNow).mockReturnValue('2026-06-18T12:00:00.000+09:00');
    lineClientMocks.getProfile.mockResolvedValue({
      userId: 'U-existing',
      displayName: 'Existing Friend',
      pictureUrl: 'https://example.com/profile.jpg',
      statusMessage: 'hello',
    });
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-existing',
      display_name: 'Existing Friend',
      picture_url: 'https://example.com/profile.jpg',
      status_message: 'hello',
      is_following: 1,
      user_id: null,
      line_account_id: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });
    vi.mocked(upsertChatOnMessage).mockResolvedValue({
      id: 'chat-1',
      friend_id: 'friend-1',
      operator_id: null,
      status: 'unread',
      notes: null,
      last_message_at: '2026-06-18T12:00:00.000+09:00',
      created_at: '2026-06-18T12:00:00.000+09:00',
      updated_at: '2026-06-18T12:00:00.000+09:00',
    });

    const stmt = {
      bind: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    stmt.bind.mockReturnValue(stmt);
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const executionCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    } as unknown as ExecutionContext;

    const app = setupApp();
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({
          destination: 'bot',
          events: [
            {
              type: 'message',
              replyToken: 'reply-token',
              message: { type: 'text', id: 'message-1', text: 'こんにちは' },
              timestamp: Date.now(),
              source: { type: 'user', userId: 'U-existing' },
              webhookEventId: 'event-1',
              deliveryContext: { isRedelivery: false },
              mode: 'active',
            },
          ],
        }),
      },
      { ...baseEnv, DB: db },
      executionCtx,
    );

    expect(res.status).toBe(200);
    const processing = vi.mocked(executionCtx.waitUntil).mock.calls[0]?.[0] as Promise<unknown>;
    await processing;

    expect(lineClientMocks.getProfile).toHaveBeenCalledWith('U-existing');
    expect(upsertFriend).toHaveBeenCalledWith(db, {
      lineUserId: 'U-existing',
      displayName: 'Existing Friend',
      pictureUrl: 'https://example.com/profile.jpg',
      statusMessage: 'hello',
    });
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-1');
    expect(fireEvent).toHaveBeenCalledWith(
      db,
      'message_received',
      expect.objectContaining({ friendId: 'friend-1' }),
      'env-default-token',
      null,
    );
    expect(getScenarios).not.toHaveBeenCalled();
    expect(enrollFriendInScenario).not.toHaveBeenCalled();

    // Keep the unrelated DB stubs quiet but type-checked as mocked imports.
    expect(updateFriendFollowStatus).not.toHaveBeenCalled();
    expect(getScenarioSteps).not.toHaveBeenCalled();
    expect(advanceFriendScenario).not.toHaveBeenCalled();
    expect(completeFriendScenario).not.toHaveBeenCalled();
    expect(computeNextDeliveryAt).not.toHaveBeenCalled();
    expect(resolveStepContent).not.toHaveBeenCalled();
    expect(addTagToFriend).not.toHaveBeenCalled();
    expect(getEntryRouteByRefCode).not.toHaveBeenCalled();
    expect(getMessageTemplateById).not.toHaveBeenCalled();
  });
});
