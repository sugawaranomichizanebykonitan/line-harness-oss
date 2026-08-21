import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { enforceAccountScope, type AuthenticatedStaff } from './auth.js';

// 「WAHMSだけ担当する作業員」が、WAHMS内では自由に動け、他アカウントには
// 一切到達できないこと。42ファイルに散らばるaccountId受け取り箇所を個別に
// 検証するのは現実的でないため、一元化した判定そのものを固定する。

const WAHMS = '5d35c116-bc08-4b52-9354-513d64b65a8b';
const FREI = '2d90cb72-737e-463d-a846-11700b7e80e6';

const scoped: AuthenticatedStaff = {
  id: 'worker-1',
  name: '谷口',
  role: 'staff',
  lineAccountId: WAHMS,
};
const unscoped: AuthenticatedStaff = {
  id: 'owner-1',
  name: 'Owner',
  role: 'owner',
  lineAccountId: null,
};

/**
 * ID指定パスの所属アカウント問い合わせを差し替える。
 * 'wahms-*' で始まるIDはWAHMSのデータ、'frei-*' はFreiのデータ、
 * それ以外は存在しないものとして扱う。
 */
function fakeDb() {
  return {
    prepare: (_sql: string) => ({
      bind: (id: string) => ({
        first: async () => {
          if (String(id).startsWith('wahms-')) return { account: WAHMS };
          if (String(id).startsWith('frei-')) return { account: FREI };
          return null;
        },
      }),
    }),
  };
}

async function check(
  staff: AuthenticatedStaff,
  path: string,
  { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {},
): Promise<number | null> {
  const app = new Hono();
  let status: number | null = null;
  app.all('*', async (c) => {
    c.set('staff' as never, staff as never);
    const denied = await enforceAccountScope(c as never);
    status = denied ? denied.status : null;
    return c.json({ ok: true });
  });
  await app.fetch(
    new Request(`https://w.example.com${path}`, { method, headers }),
    { DB: fakeDb() } as never,
  );
  return status;
}

describe('担当アカウントを限定したスタッフ', () => {
  describe('WAHMS内では自由に操作できる', () => {
    test('アカウントを明示した操作', async () => {
      expect(await check(scoped, `/api/wahms/overview?accountId=${WAHMS}`)).toBeNull();
      expect(await check(scoped, `/api/chats?lineAccountId=${WAHMS}`)).toBeNull();
      expect(await check(scoped, `/api/friends?lineAccountId=${WAHMS}&limit=20`)).toBeNull();
    });

    test('WAHMSのチャットは詳細も返信もできる', async () => {
      // 管理画面のチャット詳細はアカウントを送らない。所属をDBに聞いて判定する。
      expect(await check(scoped, '/api/chats/wahms-chat-1')).toBeNull();
      expect(await check(scoped, '/api/chats/wahms-chat-1', { method: 'PUT' })).toBeNull();
      expect(await check(scoped, '/api/chats/wahms-chat-1/send', { method: 'POST' })).toBeNull();
    });

    test('チャットのIDが友だちIDで来ても通る', async () => {
      // /api/chats/:id は chats.id と friends.id の両方を受け付け、
      // 一覧が返す公開IDは friend_id に統一されている。実際に来るのはこちら。
      expect(await check(scoped, '/api/chats/wahms-friend-9')).toBeNull();
      expect(await check(scoped, '/api/chats/wahms-friend-9/send', { method: 'POST' })).toBeNull();
    });

    test('WAHMSの友だち詳細・会話履歴を見られる', async () => {
      expect(await check(scoped, '/api/friends/wahms-friend-1')).toBeNull();
      expect(await check(scoped, '/api/conversations/wahms-friend-1')).toBeNull();
    });

    test('アカウントに紐づかない共通データは使える', async () => {
      // これが通らないとチャット画面が成立しない。
      expect(await check(scoped, '/api/operators')).toBeNull();
      expect(await check(scoped, '/api/tags')).toBeNull();
      expect(await check(scoped, '/api/auth/session')).toBeNull();
      expect(await check(scoped, '/api/line-accounts')).toBeNull();
    });
  });

  describe('他アカウントには到達できない', () => {
    test('別アカウントを明示すると403', async () => {
      expect(await check(scoped, `/api/friends?lineAccountId=${FREI}`)).toBe(403);
      expect(await check(scoped, `/api/wahms/overview?accountId=${FREI}`)).toBe(403);
    });

    test('ヘッダで偽装しても403', async () => {
      expect(await check(scoped, '/api/friends', { headers: { 'X-Line-Account-Id': FREI } })).toBe(403);
    });

    test('他アカウントのチャットや友だちをIDで直接指しても403', async () => {
      expect(await check(scoped, '/api/chats/frei-chat-1')).toBe(403);
      expect(await check(scoped, '/api/chats/frei-chat-1/send', { method: 'POST' })).toBe(403);
      expect(await check(scoped, '/api/friends/frei-friend-1')).toBe(403);
    });

    test('存在しないIDは404。存在有無を漏らさない', async () => {
      expect(await check(scoped, '/api/chats/does-not-exist')).toBe(404);
    });

    test('アカウント指定のない一覧は通さない', async () => {
      // 指定を省略すると全アカウント横断で返すエンドポイントがあるため。
      expect(await check(scoped, '/api/friends?limit=100')).toBe(403);
      expect(await check(scoped, '/api/broadcasts')).toBe(403);
    });

    test('LINEアカウントの管理はできない', async () => {
      expect(await check(scoped, '/api/line-accounts', { method: 'POST' })).toBe(403);
      expect(await check(scoped, `/api/line-accounts/${FREI}`, { method: 'PUT' })).toBe(403);
    });
  });

  test('限定されていないスタッフは従来どおり全部通る', async () => {
    expect(await check(unscoped, '/api/friends')).toBeNull();
    expect(await check(unscoped, `/api/friends?lineAccountId=${FREI}`)).toBeNull();
    expect(await check(unscoped, '/api/chats/frei-chat-1')).toBeNull();
    expect(await check(unscoped, '/api/line-accounts', { method: 'POST' })).toBeNull();
  });
});
