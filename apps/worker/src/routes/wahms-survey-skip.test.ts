import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { wahms } from './wahms.js';

// 返信するほどでもない質問を要対応リストから外す操作。
// 「LINEへ何も送らない」「回答を消さない」「返信済みを巻き戻さない」を固定する。

const ACCOUNT = 'acc-1';

type Call = { sql: string; args: unknown[] };

function fakeDb(survey: { id: string; response_status: string } | null, calls: Call[]) {
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
              if (sql.includes('FROM wahms_survey_responses')) return survey;
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

// Workers の URL 型と node:url の URL 型が食い違うため、パス文字列で読む。
async function readSource(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile('src/routes/wahms.ts', 'utf8');
}

const app = new Hono();
app.route('/', wahms as never);

async function skip(survey: { id: string; response_status: string } | null) {
  const calls: Call[] = [];
  const res = await app.fetch(
    new Request(`https://w.example.com/api/wahms/surveys/s-1/skip?accountId=${ACCOUNT}`, {
      method: 'POST',
    }),
    { DB: fakeDb(survey, calls) } as never,
  );
  return { res, calls };
}

describe('返信対応しない', () => {
  test('要対応の質問に印を付ける', async () => {
    const { res, calls } = await skip({ id: 's-1', response_status: 'pending' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, data: { replySkipped: true } });

    const update = calls.find((c) => c.sql.includes('UPDATE wahms_survey_responses'));
    expect(update?.sql).toContain('reply_skipped = 1');
    // 回答そのものは残す。集計から消えてはいけない。
    expect(update?.sql).not.toContain('DELETE');
    expect(update?.sql).not.toContain('answer =');
    // response_status は触らない。CHECK制約に無い値を入れると本番で失敗する。
    expect(update?.sql).not.toContain('response_status =');
  });

  test('要対応の件数から外れる', async () => {
    const source = await readSource();
    expect(source).toContain("response_status = 'pending' AND reply_skipped = 0");
  });

  test('LINEへは何も送らない', async () => {
    // 送らないことが目的の操作なので、外部送信が起きないことを固定する。
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await skip({ id: 's-1', response_status: 'pending' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('返信済みは巻き戻さない', async () => {
    const { res, calls } = await skip({ id: 's-1', response_status: 'completed' });
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.sql.includes('UPDATE wahms_survey_responses'))).toBe(false);
  });

  test('他アカウントの回答は触れない', async () => {
    // 取得時に line_account_id で絞っているので、見つからなければ404。
    const { res, calls } = await skip(null);
    expect(res.status).toBe(404);
    expect(calls.some((c) => c.sql.includes('UPDATE wahms_survey_responses'))).toBe(false);
  });

  test('スプレッドシート同期で要対応に戻らない', async () => {
    // GASからの再取り込みは response_status を上書きする。印を別の列で
    // 持っているので巻き戻らない。同期のUPSERTが reply_skipped を書かない
    // ことを固定する。
    const source = await readSource();
    const upsert = source.slice(source.indexOf('ON CONFLICT(line_account_id,source_row)'));
    expect(upsert.slice(0, 900)).not.toContain('reply_skipped');
  });
});
