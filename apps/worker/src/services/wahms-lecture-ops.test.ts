import { describe, expect, test } from 'vitest';
import {
  addDays, findSlotById, lectureApplicantIds, resumeLecture, shiftLectureWeek, suspendLecture,
} from './wahms-lecture-ops.js';

// 延期・休講・繰越。ここを間違えると受講者に実害が出る。
// 2026-08-27 と 08-28 に連続で起きた事故を、そのまま固定する。

const SLOT = {
  slotId: 'slot-1', eventId: 'ev-1', schoolName: '📈 マネジメント学校',
  eventDate: '2026-08-28', startTime: '20:30', endTime: '22:00',
  lectureLabel: '第13回', theme: 'テーマM', isActive: 1,
};

type Call = { sql: string; args: unknown[] };

function fakeDb(calls: Call[], { slot = true, applicants = 2, changes = 1 } = {}) {
  return {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => {
          calls.push({ sql, args });
          return {
            first: async () => {
              if (sql.includes('FROM event_slots')) return slot ? SLOT : null;
              if (sql.includes('COUNT(DISTINCT line_user_id)')) return { n: applicants };
              return null;
            },
            all: async () => ({
              results: sql.includes('DISTINCT line_user_id')
                ? [{ line_user_id: 'U1' }, { line_user_id: 'U2' }]
                : [],
            }),
            run: async () => ({ success: true, meta: { changes } }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

const sqlOf = (calls: Call[]) => calls.map((c) => c.sql).join('\n---\n');

describe('開催枠の取り出し', () => {
  test('必ずアカウントを条件に入れる（他社の枠を触らせない）', async () => {
    const calls: Call[] = [];
    await findSlotById(fakeDb(calls), 'acc-1', 'slot-1');
    expect(calls[0].sql).toContain('e.line_account_id = ?');
    expect(calls[0].args).toEqual(['slot-1', 'acc-1']);
  });

  test('他社の枠なら null', async () => {
    expect(await findSlotById(fakeDb([], { slot: false }), 'acc-1', 'slot-x')).toBeNull();
  });
});

describe('受付を止める（延期・休講）', () => {
  test('枠を止めると同時に、その日のリマインドも止める', async () => {
    // ここを分けて実行していたせいで、延期なのに「まもなく開講」が
    // 飛ぶ状態が2回できた。1つの操作にまとめる。
    const calls: Call[] = [];
    const r = await suspendLecture(fakeDb(calls), 'acc-1', 'slot-1');
    expect(r).not.toBeNull();
    const sql = sqlOf(calls);
    expect(sql).toContain('UPDATE event_slots SET is_active = 0');
    expect(sql).toContain('morning_reminder_sent = 1, last_reminder_sent = 1');
  });

  test('こちらが担当する申込だけ止める（Apps Script のぶんは触らない）', async () => {
    const calls: Call[] = [];
    await suspendLecture(fakeDb(calls), 'acc-1', 'slot-1');
    const stop = calls.find((c) => c.sql.includes('last_reminder_sent = 1'))!;
    expect(stop.sql).toContain('source_row IS NULL');
  });

  test('申込は消さない（誰に案内すべきか分からなくなる）', async () => {
    const calls: Call[] = [];
    await suspendLecture(fakeDb(calls), 'acc-1', 'slot-1');
    expect(sqlOf(calls)).not.toContain('DELETE FROM wahms_applications');
  });

  test('申込者の人数を返す（お知らせを出すか判断するため）', async () => {
    const r = await suspendLecture(fakeDb([], { applicants: 5 }), 'acc-1', 'slot-1');
    expect(r?.applicants).toBe(5);
    expect(r?.slot.schoolName).toBe('📈 マネジメント学校');
  });

  test('存在しない枠なら null', async () => {
    expect(await suspendLecture(fakeDb([], { slot: false }), 'acc-1', 'x')).toBeNull();
  });
});

describe('受付を再開する', () => {
  test('当日の再開ではリマインドを送り直さない', async () => {
    // 朝に送ったぶんがもう一度飛ぶのを防ぐ。SQL側で日付を見る。
    const calls: Call[] = [];
    await resumeLecture(fakeDb(calls), 'acc-1', 'slot-1');
    const rearm = calls.find((c) => c.sql.includes('morning_reminder_sent = 0'))!;
    expect(rearm.sql).toContain("> DATE('now', '+9 hours')");
  });

  test('枠を有効に戻す', async () => {
    const calls: Call[] = [];
    await resumeLecture(fakeDb(calls), 'acc-1', 'slot-1');
    expect(sqlOf(calls)).toContain('UPDATE event_slots SET is_active = 1');
  });
});

describe('1週間ずつ後ろへずらす（繰越）', () => {
  test('その回だけでなく、以降を全部ずらす', async () => {
    // 1回だけ動かすと次の回と同じ日に重なる。
    const calls: Call[] = [];
    const r = await shiftLectureWeek(fakeDb(calls), 'acc-1', 'slot-1');
    const shift = calls.find((c) => c.sql.includes("'+7 days'"))!;
    expect(shift.sql).toContain("DATE(s.starts_at, '+9 hours') >= ?");
    expect(shift.args).toContain('2026-08-28');
    expect(r?.newDate).toBe('2026-09-04');
  });

  test('同じ学校の枠だけを動かす', async () => {
    const calls: Call[] = [];
    await shiftLectureWeek(fakeDb(calls), 'acc-1', 'slot-1');
    const shift = calls.find((c) => c.sql.includes("'+7 days'"))!;
    expect(shift.sql).toContain('e.id = ?');
    expect(shift.args).toContain('ev-1');
  });

  test('申込者も新しい日付へ移す（置き去りにしない）', async () => {
    const calls: Call[] = [];
    await shiftLectureWeek(fakeDb(calls), 'acc-1', 'slot-1');
    const move = calls.find((c) => c.sql.includes('UPDATE wahms_applications'))!;
    expect(move.args[0]).toBe('2026-09-04');
    expect(move.sql).toContain('morning_reminder_sent = 0');
    expect(move.sql).toContain('source_row = NULL');
  });

  test('止めていた枠も、ずらすと同時に受付を再開する', async () => {
    const calls: Call[] = [];
    await shiftLectureWeek(fakeDb(calls), 'acc-1', 'slot-1');
    expect(calls.find((c) => c.sql.includes("'+7 days'"))!.sql).toContain('is_active  = 1');
  });

  test('月をまたいでも日付がずれない', () => {
    expect(addDays('2026-08-28', 7)).toBe('2026-09-04');
    expect(addDays('2026-12-29', 7)).toBe('2027-01-05');
  });
});

describe('お知らせの送り先', () => {
  test('その回の申込者を重複なく返す', async () => {
    const ids = await lectureApplicantIds(fakeDb([]), 'acc-1', SLOT);
    expect(ids).toEqual(['U1', 'U2']);
  });
});
