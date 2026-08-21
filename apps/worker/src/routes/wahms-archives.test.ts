import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { wahms } from './wahms.js';

// 各学校の第1〜20回は移行時に枠だけ作られており、未実施の回は日付も動画も空。
// 管理画面から同じ回を登録したときに行が増えると、LINEへ出す一覧が二重になる。
// 既存の枠を上書きすること、無い回は新規に作られることを固定する。

const ACCOUNT = 'acc-1';

type Call = { sql: string; args: unknown[] };

function fakeDb(existingLectures: Set<string>, calls: Call[]) {
  return {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => {
          calls.push({ sql, args });
          return {
            first: async () => {
              if (sql.includes('FROM line_accounts')) {
                return { id: ACCOUNT, name: 'オンライン学校「WAHMS」', channel_id: '1' };
              }
              if (sql.includes('FROM wahms_archives')) {
                // args = [accountId, schoolName, lectureNumber]
                return existingLectures.has(String(args[2])) ? { id: 'existing-row' } : null;
              }
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          };
        },
      };
    },
  };
}

const app = new Hono();
app.route('/', wahms as never);

async function postArchive(body: unknown, existing: Set<string>) {
  const calls: Call[] = [];
  const res = await app.fetch(
    new Request(`https://w.example.com/api/wahms/archives?accountId=${ACCOUNT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB: fakeDb(existing, calls) } as never,
  );
  return { res, calls };
}

const BASE = {
  schoolName: '🔥 マーケティング学校',
  lectureNumber: '13',
  theme: 'その数字は「相関」か「因果」か？',
  heldOn: '2026-09-01',
  youtubeUrl: 'https://youtu.be/xxxx',
};

describe('アーカイブ登録', () => {
  test('既にある回は上書きし、行を増やさない', async () => {
    const { res, calls } = await postArchive(BASE, new Set(['13']));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, data: { updated: true } });
    expect(calls.some((c) => c.sql.includes('UPDATE wahms_archives'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('INSERT INTO wahms_archives'))).toBe(false);
  });

  test('まだ無い回は新規に作る', async () => {
    const { res, calls } = await postArchive(BASE, new Set());
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ success: true, data: { updated: false } });
    expect(calls.some((c) => c.sql.includes('INSERT INTO wahms_archives'))).toBe(true);
  });

  test('回の照合は数値で行う。13 と 13.0 を別物にしない', async () => {
    const { calls } = await postArchive(BASE, new Set(['13']));
    const lookup = calls.find((c) => c.sql.includes('FROM wahms_archives'));
    expect(lookup?.sql).toContain('CAST(lecture_number AS REAL)');
  });

  test('テーマ未入力なら既存のテーマを消さない', async () => {
    // 青山塾のようにテーマなし運用の学校で、空文字で潰さないこと。
    const { calls } = await postArchive({ ...BASE, schoolName: '☕ 青山塾', theme: '' }, new Set(['13']));
    const update = calls.find((c) => c.sql.includes('UPDATE wahms_archives'));
    expect(update?.sql).toContain("COALESCE(NULLIF(?, ''), theme)");
  });

  test('学校名が無ければ登録しない', async () => {
    const { res } = await postArchive({ ...BASE, schoolName: '' }, new Set());
    expect(res.status).toBe(400);
  });
});
