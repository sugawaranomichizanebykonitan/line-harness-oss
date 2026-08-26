import { describe, expect, test } from 'vitest';
import { ensureWahmsParticipant } from './wahms-participant.js';

// 登録者マスターは Apps Script の同期でしか増えず、その同期が動いていな
// かったため 2026-08-20 以降の友だちが見えなかった。友だち追加の時点で
// こちらが作る。

type Call = { sql: string; args: unknown[] };
function fakeDb(calls: Call[], { exists = false } = {}) {
  return {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => {
          calls.push({ sql, args });
          return {
            first: async () => (exists ? { id: 'p-1' } : null),
            run: async () => ({ success: true }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('登録者マスターの作成', () => {
  test('居なければ作る', async () => {
    const calls: Call[] = [];
    expect(await ensureWahmsParticipant(fakeDb(calls), 'acc-1', 'U1', 'たろう')).toBe('created');
    const ins = calls.find((c) => c.sql.includes('INSERT INTO wahms_participants'))!;
    expect(ins.args).toContain('U1');
    expect(ins.args).toContain('たろう');
    // スプレッドシート由来の行と混ざらないよう source_row は持たせない。
    expect(ins.sql).toContain('NULL');
  });

  test('居れば表示名だけ更新し、アンケートで入った情報は壊さない', async () => {
    const calls: Call[] = [];
    expect(await ensureWahmsParticipant(fakeDb(calls, { exists: true }), 'acc-1', 'U1', 'たろう')).toBe('updated');
    const upd = calls.find((c) => c.sql.includes('UPDATE wahms_participants'))!;
    expect(upd.sql).toContain('COALESCE(?, line_display_name)');
    // 氏名や初回アンケートの完了日は触らない（line_display_name とは別の列）。
    expect(upd.sql).not.toMatch(/(^|,|SET)\s*name\s*=/);
    expect(upd.sql).not.toContain('survey_completed_at');
    expect(calls.some((c) => c.sql.includes('INSERT INTO'))).toBe(false);
  });

  test('表示名が取れなくても作る', async () => {
    // プロフィール取得に失敗しても、存在だけは記録する。
    const calls: Call[] = [];
    expect(await ensureWahmsParticipant(fakeDb(calls), 'acc-1', 'U2', null)).toBe('created');
    expect(calls.some((c) => c.sql.includes('INSERT INTO wahms_participants'))).toBe(true);
  });
});
