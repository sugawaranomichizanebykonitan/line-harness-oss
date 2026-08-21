import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { enforceAccountScope, type AuthenticatedStaff } from './auth.js';

// 「WAHMSだけ見られる作業員アカウント」が、本当にWAHMS以外へ到達できないか。
// 42ファイルに散らばるaccountId受け取り箇所を個別に検証するのは現実的でないため、
// 一元化した enforceAccountScope の判定そのものを固定する。

const WAHMS = '5d35c116-bc08-4b52-9354-513d64b65a8b';
const FREI = '2d90cb72-737e-463d-a846-11700b7e80e6';

const scoped: AuthenticatedStaff = {
  id: 'worker-1',
  name: 'WAHMS担当',
  role: 'staff',
  lineAccountId: WAHMS,
};
const unscoped: AuthenticatedStaff = {
  id: 'owner-1',
  name: 'Owner',
  role: 'owner',
  lineAccountId: null,
};

/** enforceAccountScope を単体で通すための最小コンテキスト。 */
async function check(
  staff: AuthenticatedStaff,
  path: string,
  { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {},
): Promise<number | null> {
  const app = new Hono();
  let status: number | null = null;
  app.all('*', (c) => {
    c.set('staff' as never, staff as never);
    const denied = enforceAccountScope(c as never);
    status = denied ? denied.status : null;
    return c.json({ ok: true });
  });
  await app.fetch(new Request(`https://w.example.com${path}`, { method, headers }));
  return status;
}

describe('アカウント限定スタッフのアクセス制御', () => {
  test('担当アカウントを指定したリクエストは通る', async () => {
    expect(await check(scoped, `/api/wahms/overview?accountId=${WAHMS}`)).toBeNull();
  });

  test('別のLINEアカウントを指定すると403', async () => {
    expect(await check(scoped, `/api/wahms/overview?accountId=${FREI}`)).toBe(403);
    expect(await check(scoped, `/api/friends?lineAccountId=${FREI}`)).toBe(403);
  });

  test('ヘッダで別アカウントを指定しても403', async () => {
    expect(
      await check(scoped, '/api/friends', { headers: { 'X-Line-Account-Id': FREI } }),
    ).toBe(403);
  });

  test('アカウント未指定は通さない（fail-closed）', async () => {
    // 未指定を許すと「全アカウント横断の一覧」が漏れる。指定を必須にして塞ぐ。
    expect(await check(scoped, '/api/friends')).toBe(403);
    expect(await check(scoped, '/api/broadcasts')).toBe(403);
    expect(await check(scoped, '/api/scenarios')).toBe(403);
  });

  test('LINEアカウントの管理は参照も含めて操作させない', async () => {
    expect(await check(scoped, '/api/line-accounts/xxx', { method: 'PUT' })).toBe(403);
    expect(await check(scoped, '/api/line-accounts', { method: 'POST' })).toBe(403);
  });

  test('自分の担当を知るための一覧取得とセッション確認は通る', async () => {
    // 一覧の中身は line-accounts ルート側で担当アカウントだけに絞り込む。
    expect(await check(scoped, '/api/line-accounts')).toBeNull();
    expect(await check(scoped, '/api/auth/session')).toBeNull();
    expect(await check(scoped, '/api/auth/logout', { method: 'POST' })).toBeNull();
  });

  test('限定されていないスタッフは従来どおり全部通る', async () => {
    expect(await check(unscoped, '/api/friends')).toBeNull();
    expect(await check(unscoped, `/api/friends?lineAccountId=${FREI}`)).toBeNull();
    expect(await check(unscoped, '/api/line-accounts', { method: 'POST' })).toBeNull();
  });
});
