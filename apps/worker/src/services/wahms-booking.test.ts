import { describe, expect, test } from 'vitest';
import { parseBookingRequest, findLectureSlot, recordBooking } from './wahms-booking.js';

// 申込の記録。これまでスプレッドシートにしか残らず、5日間気づかれずに
// 取りこぼしていた経路。文言の解釈と、二重記録しないことを固定する。

describe('申込文言の解釈', () => {
  test('リッチメニューの文言を分解できる', () => {
    expect(parseBookingRequest('8月25日マーケティング学校に申し込む'))
      .toEqual({ month: 8, day: 25, school: 'マーケティング学校' });
    expect(parseBookingRequest('5月13日青山塾に申し込む'))
      .toEqual({ month: 5, day: 13, school: '青山塾' });
  });

  test('関係ない文章は拾わない', () => {
    for (const t of ['こんにちは', 'マーケティング学校 アーカイブ', '今週の開催日', '申し込む', '', undefined]) {
      expect(parseBookingRequest(t)).toBeNull();
    }
  });

  test('あり得ない日付は拾わない', () => {
    expect(parseBookingRequest('13月1日WEB学校に申し込む')).toBeNull();
    expect(parseBookingRequest('8月32日WEB学校に申し込む')).toBeNull();
  });
});

type Call = { sql: string; args: unknown[] };
const SLOT = {
  slotId: 'slot-1', eventId: 'ev-1', schoolName: '🔥 マーケティング学校',
  eventDate: '2026-08-25', startTime: '20:30', endTime: '22:00',
  lectureLabel: '第13回', theme: '安売りは、本当に「負け」なのか？',
};

function fakeDb(calls: Call[], { duplicate = false, friend = true, alreadyBooked = false } = {}) {
  return {
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => {
          calls.push({ sql, args });
          return {
            first: async () => {
              if (sql.includes('FROM wahms_applications')) return duplicate ? { id: 'dup' } : null;
              if (sql.includes('FROM friends')) return friend ? { id: 'friend-1' } : null;
              if (sql.includes('FROM event_bookings')) return alreadyBooked ? { id: 'b-1' } : null;
              if (sql.includes('FROM event_slots')) return SLOT;
              return null;
            },
            run: async () => ({ success: true }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('開催枠の照合', () => {
  test('今日以降の同月日だけを対象にする', async () => {
    // 年が文言に無い。年末に「1月◯日」を押して前の年を拾うと、終わった
    // 講義に申し込んだ扱いになる。
    const calls: Call[] = [];
    await findLectureSlot(fakeDb(calls), 'acc-1', { month: 8, day: 25, school: 'マーケティング学校' });
    const sql = calls[0].sql;
    expect(sql).toContain("DATE(s.starts_at, '+9 hours') >= DATE('now', '+9 hours')");
    expect(sql).toContain("SUBSTR(DATE(s.starts_at, '+9 hours'), 6) = ?");
    expect(calls[0].args).toContain('08-25');
    // 学校名は絵文字付きで保存されているので前方一致では引けない。
    expect(sql).toContain("e.name LIKE '%' || ? || '%'");
    expect(sql).toContain('e.line_account_id = ?');
  });
});

describe('申込の記録', () => {
  test('申込履歴とイベント予約の両方に入る', async () => {
    const calls: Call[] = [];
    const r = await recordBooking(fakeDb(calls), 'acc-1', 'U1', SLOT);
    expect(r).toEqual({ recorded: true, reason: 'created' });
    expect(calls.some((c) => c.sql.includes('INSERT INTO wahms_applications'))).toBe(true);
    expect(calls.some((c) => c.sql.includes('INSERT INTO event_bookings'))).toBe(true);
  });

  test('スプレッドシート由来の行と混ざらないよう source_row は入れない', async () => {
    const calls: Call[] = [];
    await recordBooking(fakeDb(calls), 'acc-1', 'U1', SLOT);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO wahms_applications'))!;
    expect(insert.sql).toContain('NULL)');
    expect(insert.args).toContain('第13回'.replace(/[^0-9]/g, ''));
  });

  test('同じ講義に二重で記録しない', async () => {
    // リッチメニューは連打できる。
    const calls: Call[] = [];
    const r = await recordBooking(fakeDb(calls, { duplicate: true }), 'acc-1', 'U1', SLOT);
    expect(r).toEqual({ recorded: false, reason: 'duplicate' });
    expect(calls.some((c) => c.sql.includes('INSERT INTO'))).toBe(false);
  });

  test('すでにイベント予約がある場合は増やさない', async () => {
    const calls: Call[] = [];
    await recordBooking(fakeDb(calls, { alreadyBooked: true }), 'acc-1', 'U1', SLOT);
    expect(calls.some((c) => c.sql.includes('INSERT INTO event_bookings'))).toBe(false);
    expect(calls.some((c) => c.sql.includes('INSERT INTO wahms_applications'))).toBe(true);
  });

  test('friends に居なくても申込履歴には残す', async () => {
    // 記録できるものは記録する。ここで落とすと取りこぼしに戻る。
    const calls: Call[] = [];
    const r = await recordBooking(fakeDb(calls, { friend: false }), 'acc-1', 'U1', SLOT);
    expect(r).toEqual({ recorded: true, reason: 'no_friend' });
    expect(calls.some((c) => c.sql.includes('INSERT INTO wahms_applications'))).toBe(true);
  });

  test('申込回数を増やす', async () => {
    const calls: Call[] = [];
    await recordBooking(fakeDb(calls), 'acc-1', 'U1', SLOT);
    expect(calls.some((c) => c.sql.includes('application_count = application_count + 1'))).toBe(true);
  });
});
