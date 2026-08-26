import { describe, expect, test, vi } from 'vitest';
import { splitEventTime, jstNow, sendWahmsReminders } from './wahms-reminders.js';

const pushMessage = vi.fn();
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class { pushMessage = (...a: unknown[]) => pushMessage(...a) },
}));

// Apps Script も同じリマインドを送っている。Worker が引き取った申込だけを
// 対象にしないと、受講者に同じ案内が2通届く。境目は source_row。

const ROW = {
  id: 'app-1', line_account_id: 'acc-1', line_user_id: 'U1',
  school_name: '🔥 マーケティング学校', event_date: '2026-08-25T00:00:00',
  event_time: '20:30〜22:00', theme: 'テーマ', lecture_number: '13',
};

type Call = { sql: string; args: unknown[] };
function fakeDb(calls: Call[], { rows = [ROW], zoom = true, claimed = 1 } = {}) {
  const make = (sql: string, args: unknown[] = []) => ({
    first: async () => (sql.includes('FROM line_accounts') ? { channel_access_token: 't' } : null),
    all: async () => ({
      results: sql.includes('FROM account_settings')
        ? (zoom ? [
            { key: 'wahms_zoom_url', value: 'https://zoom.test/j/1' },
            { key: 'wahms_zoom_id', value: '123' },
            { key: 'wahms_zoom_password', value: 'pw' },
          ] : [])
        : sql.includes('FROM wahms_applications') ? rows : [],
    }),
    run: async () => ({ success: true, meta: { changes: claimed } }),
  });
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => { calls.push({ sql, args }); return make(sql, args) },
      ...make(sql),
    }),
  } as unknown as D1Database;
}

const at = (jst: string) => new Date(`2026-08-25T${jst}:00+09:00`);

describe('時刻の扱い', () => {
  test('開催時間を分解できる', () => {
    expect(splitEventTime('20:30〜22:00')).toEqual({ start: '20:30', end: '22:00' });
    expect(splitEventTime('09:00〜10:30')).toEqual({ start: '09:00', end: '10:30' });
    expect(splitEventTime('')).toBeNull();
    expect(splitEventTime(null)).toBeNull();
  });

  test('JSTに直す', () => {
    // UTCのまま扱うと、20:30開始の講義が前日の判定になる。
    expect(jstNow(new Date('2026-08-25T11:30:00Z'))).toEqual({ date: '2026-08-25', minutes: 20 * 60 + 30 });
  });
});

describe('リマインド送信', () => {
  test('スプレッドシート由来の申込は対象にしない', async () => {
    // Apps Script が送るぶん。ここを外すと2通届く。
    const calls: Call[] = [];
    await sendWahmsReminders(fakeDb(calls, { rows: [] }), at('07:00'));
    expect(calls[0].sql).toContain('source_row IS NULL');
  });

  test('朝7時に当日ぶんを送る', async () => {
    pushMessage.mockClear();
    const calls: Call[] = [];
    const r = await sendWahmsReminders(fakeDb(calls), at('07:00'));
    expect(r.morning).toBe(1);
    const [, messages] = pushMessage.mock.calls[0];
    expect(messages[0].text).toContain('おはようございます');
    expect(messages[1].text).toContain('https://zoom.test/j/1');
    expect(messages[1].text).toContain('20:20');  // 開室は10分前
  });

  test('開始30分前に送る', async () => {
    pushMessage.mockClear();
    const r = await sendWahmsReminders(fakeDb([]), at('20:00'));
    expect(r.pre).toBe(1);
    expect(pushMessage.mock.calls[0][1][0].text).toContain('あと30分');
  });

  test('関係ない時間には送らない', async () => {
    pushMessage.mockClear();
    const r = await sendWahmsReminders(fakeDb([]), at('15:00'));
    expect(r).toEqual({ morning: 0, pre: 0, failed: 0 });
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('送信前にフラグを立てる（毎分のcronで二重送信しない）', async () => {
    const calls: Call[] = [];
    await sendWahmsReminders(fakeDb(calls), at('07:00'));
    const update = calls.find((c) => c.sql.includes('morning_reminder_sent = 1'));
    expect(update?.sql).toContain('morning_reminder_sent = 0');  // 未送信の行だけを取る
  });

  test('他のcronが先に取った行は送らない', async () => {
    pushMessage.mockClear();
    const r = await sendWahmsReminders(fakeDb([], { claimed: 0 }), at('07:00'));
    expect(r.morning).toBe(0);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('Zoom情報が無ければ送らない', async () => {
    // URLの無い案内を送っても参加できない。
    pushMessage.mockClear();
    const r = await sendWahmsReminders(fakeDb([], { zoom: false }), at('07:00'));
    expect(r.morning).toBe(0);
    expect(pushMessage).not.toHaveBeenCalled();
  });

  test('送信に失敗したらフラグを戻す', async () => {
    pushMessage.mockClear();
    pushMessage.mockRejectedValueOnce(new Error('LINE down'));
    const calls: Call[] = [];
    const r = await sendWahmsReminders(fakeDb(calls), at('07:00'));
    expect(r.failed).toBe(1);
    expect(calls.some((c) => c.sql.includes('morning_reminder_sent = 0 WHERE id = ?'))).toBe(true);
  });
});
