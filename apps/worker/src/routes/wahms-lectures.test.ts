import { describe, expect, test } from 'vitest';

// 開催予定を overview が返すことを固定する。
// 申込が0件の日でも時間とテーマを画面に出すのに使っており、
// この問い合わせが落ちると「テーマ未登録」に戻る。

async function source(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  return readFile('src/routes/wahms.ts', 'utf8');
}

describe('開催予定の取得', () => {
  test('event_slots から学校・日付・時刻・回・テーマを返す', async () => {
    const s = await source();
    expect(s).toContain('FROM event_slots s');
    expect(s).toContain('JOIN events e ON e.id = s.event_id');
    for (const col of ['school_name', 'event_date', 'start_time', 'end_time', 'lecture_label', 'theme']) {
      expect(s).toContain(`AS ${col}`);
    }
  });

  test('JSTに直して返す', async () => {
    // starts_at はUTC。+9時間しないと、20:30開始の講義が前日の11:30に見える。
    const s = await source();
    expect(s).toContain("DATE(s.starts_at, '+9 hours')");
    expect(s).toContain("TIME(s.starts_at, '+9 hours')");
  });

  test('削除・停止した枠は出さない', async () => {
    const s = await source();
    expect(s).toContain('s.deleted_at IS NULL AND s.is_active = 1');
  });

  test('他アカウントの予定を混ぜない', async () => {
    const s = await source();
    expect(s).toContain('WHERE e.line_account_id = ?');
  });

  test('overview の返り値に含める', async () => {
    const s = await source();
    expect(s).toContain('lectures: lectures.results');
  });
});
