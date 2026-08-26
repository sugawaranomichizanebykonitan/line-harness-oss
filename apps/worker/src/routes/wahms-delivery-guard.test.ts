import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { wahms } from './wahms.js';

// 「テスト送信のつもりが全員へ飛ぶ」事故を、画面ではなくAPI側で止められているか。
// D1とLINE Messaging APIは叩かず、送信が発生したかどうかだけを見る。

const TEST_ID = 'U0123456789abcdef0123456789abcdef';

function fakeDb() {
  return {
    prepare(sql: string) {
      return {
        bind: (..._args: unknown[]) => ({
          first: async () => {
            if (sql.includes('channel_access_token')) return { channel_access_token: 'dummy-token' };
            if (sql.includes('FROM line_accounts')) return { id: 'acc-1', name: 'WAHMS', channel_id: '2010052458' };
            // アンケートURLの設定。未設定だと配信そのものが止まる。
            if (sql.includes('FROM account_settings')) return { value: 'https://wahms.test/survey' };
            return null;
          },
          all: async () => ({ results: [{ line_user_id: 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }] }),
          run: async () => ({ success: true }),
        }),
      };
    },
  };
}

const app = new Hono();
app.route('/', wahms as never);

function post(path: string, body: unknown) {
  return app.fetch(
    new Request(`https://worker.example.com${path}?accountId=acc-1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB: fakeDb() } as never,
  );
}

const FLEX = { altText: 'お知らせ', contents: { type: 'bubble' } };
const SURVEY = { schoolName: 'テスト校', eventDate: '2026-08-21' };

// Workers 用の fetch 型と vi.spyOn の型が噛み合わないため、stubGlobal で差し替える。
const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('WAHMS配信の全員配信ガード', () => {
  test('Flex: テストIDの形式が不正なら、全員配信へ落とさず400で止める', async () => {
    const res = await post('/api/wahms/flex-deliveries', { ...FLEX, testRecipientId: 'U123' });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('Flex: 同意なしの一斉配信は400で止める', async () => {
    const res = await post('/api/wahms/flex-deliveries', FLEX);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('Flex: 正しいテストIDならpushで1人だけに送る', async () => {
    const res = await post('/api/wahms/flex-deliveries', { ...FLEX, testRecipientId: TEST_ID });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(JSON.parse(String(init?.body)).to).toBe(TEST_ID);
  });

  test('Flex: 明示的に同意した場合だけbroadcastする', async () => {
    const res = await post('/api/wahms/flex-deliveries', { ...FLEX, confirmBroadcast: true });
    expect(res.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.line.me/v2/bot/message/broadcast');
  });

  test('アンケート: テストIDの形式が不正なら申込者全員へ落とさず400で止める', async () => {
    const res = await post('/api/wahms/survey-deliveries', { ...SURVEY, testRecipientId: 'not-an-id' });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('アンケート: 同意なしの一斉配信は400で止める', async () => {
    const res = await post('/api/wahms/survey-deliveries', SURVEY);
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('アンケート: 正しいテストIDなら宛先が1人だけになる', async () => {
    // 受講者ごとに使い捨ての案内URLを作るので、宛先ごとのpushで送る。
    const res = await post('/api/wahms/survey-deliveries', { ...SURVEY, testRecipientId: TEST_ID });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    const body = JSON.parse(String(init?.body));
    expect(body.to).toBe(TEST_ID);
    // URLに載るのは案内トークンだけ。LINEのユーザーIDは出さない。
    expect(body.messages[0].text).toContain('https://wahms.test/survey?t=');
    expect(body.messages[0].text).not.toContain(TEST_ID);
  });
});
