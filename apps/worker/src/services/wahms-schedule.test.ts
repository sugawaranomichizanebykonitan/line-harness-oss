import { describe, expect, test } from 'vitest';
import { addDays, loadSchoolRatings, loadWeeklySchedule, weekAnchorTuesday } from './wahms-schedule.js';

// 「今週の開催日」の土台。Apps Script はコードの辞書を毎週書き足していたので、
// 書き忘れた回が休講扱いになっていた。ここでは D1 の開催予定を正とする。

/** JSTの壁時計から UTC の Date を作る。Worker は UTC で動くため。 */
function atJst(iso: string): Date {
  return new Date(new Date(`${iso}:00Z`).getTime() - 9 * 3600_000);
}

describe('表示する週の火曜日', () => {
  test('火〜金は今週の火曜', () => {
    expect(weekAnchorTuesday(atJst('2026-08-25T20:00'))).toBe('2026-08-25'); // 火
    expect(weekAnchorTuesday(atJst('2026-08-26T21:00'))).toBe('2026-08-25'); // 水
    expect(weekAnchorTuesday(atJst('2026-08-27T09:00'))).toBe('2026-08-25'); // 木
    expect(weekAnchorTuesday(atJst('2026-08-28T23:59'))).toBe('2026-08-25'); // 金
  });

  test('土曜は朝10時が境目', () => {
    // 人間力学校が土曜9時開催。終わるまでは今週を出す。
    expect(weekAnchorTuesday(atJst('2026-08-29T09:30'))).toBe('2026-08-25');
    expect(weekAnchorTuesday(atJst('2026-08-29T10:00'))).toBe('2026-09-01');
  });

  test('日曜と月曜は来週の火曜', () => {
    expect(weekAnchorTuesday(atJst('2026-08-30T12:00'))).toBe('2026-09-01'); // 日
    expect(weekAnchorTuesday(atJst('2026-08-31T12:00'))).toBe('2026-09-01'); // 月
  });

  test('月をまたいでも日付がずれない', () => {
    expect(weekAnchorTuesday(atJst('2026-12-31T12:00'))).toBe('2026-12-29'); // 木
    expect(addDays('2026-12-29', 4)).toBe('2027-01-02');
  });
});

type Slot = { schoolName: string; eventDate: string; startTime: string; endTime: string; theme: string | null };

function fakeDb(slots: Slot[], surveys: { school: string; total: number; count: number }[] = []) {
  return {
    prepare(sql: string) {
      return {
        bind: () => ({
          all: async () => ({
            results: sql.includes('FROM event_slots') ? slots : sql.includes('wahms_survey_responses') ? surveys : [],
          }),
          first: async () => null,
          run: async () => ({ success: true }),
        }),
      };
    },
  } as unknown as D1Database;
}

describe('今週の6校', () => {
  const slots: Slot[] = [
    { schoolName: '🔥 マーケティング学校', eventDate: '2026-08-25', startTime: '20:30', endTime: '22:00', theme: 'テーマM' },
    { schoolName: '☕ 青山塾', eventDate: '2026-08-26', startTime: '12:00', endTime: '13:00', theme: null },
    { schoolName: '💻 WEB学校', eventDate: '2026-08-26', startTime: '20:30', endTime: '22:00', theme: 'テーマW' },
    { schoolName: '🤝 セールス学校', eventDate: '2026-08-27', startTime: '20:30', endTime: '22:00', theme: 'テーマS' },
    // マネジメント学校 (金) は登録が無い = 休講
    { schoolName: '☀️ 人間力学校', eventDate: '2026-08-29', startTime: '09:00', endTime: '10:30', theme: 'テーマH' },
  ];

  test('開催予定にある回は申込できる形で返る', async () => {
    const week = await loadWeeklySchedule(fakeDb(slots), 'acc', atJst('2026-08-26T21:00'));
    expect(week).toHaveLength(6);
    const web = week.find((w) => w.keyword === 'WEB学校')!;
    expect(web.held).toBe(true);
    expect(web.date).toBe('2026-08-26');
    expect(web.time).toBe('20:30〜22:00');
    expect(web.theme).toBe('テーマW');
    expect(web.bookingText).toBe('8月26日WEB学校に申し込む');
  });

  test('開催予定に無い回は休講になる', async () => {
    const week = await loadWeeklySchedule(fakeDb(slots), 'acc', atJst('2026-08-26T21:00'));
    const mgmt = week.find((w) => w.keyword === 'マネジメント学校')!;
    expect(mgmt.held).toBe(false);
    expect(mgmt.date).toBe('2026-08-28');
  });

  test('テーマが無い回でも壊れない', async () => {
    // 青山塾は第11回から「何でも相談OK」でテーマを設けていない。
    const week = await loadWeeklySchedule(fakeDb(slots), 'acc', atJst('2026-08-26T21:00'));
    const aoyama = week.find((w) => w.keyword === '青山塾')!;
    expect(aoyama.held).toBe(true);
    expect(aoyama.theme).toBeNull();
  });

  test('別の週の枠は拾わない', async () => {
    const week = await loadWeeklySchedule(
      fakeDb([{ schoolName: '💻 WEB学校', eventDate: '2026-09-02', startTime: '20:30', endTime: '22:00', theme: '来週' }]),
      'acc',
      atJst('2026-08-26T21:00'),
    );
    expect(week.every((w) => !w.held)).toBe(true);
  });
});

describe('学校別の平均満足度', () => {
  test('表記ゆれがあっても件数で重みづけして1つにまとめる', async () => {
    const db = fakeDb([], [
      { school: '💻 WEB学校', total: 40, count: 10 },   // 4.0 × 10件
      { school: 'WEB学校', total: 5, count: 1 },        // 5.0 × 1件
      { school: '🔥 マーケティング学校', total: 45, count: 10 },
    ]);
    const ratings = await loadSchoolRatings(db, 'acc');
    // 平均の平均 (4.5) ではなく、合計45 ÷ 11件 = 4.09...
    expect(ratings.get('WEB学校')).toBeCloseTo(45 / 11, 5);
    expect(ratings.get('マーケティング学校')).toBe(4.5);
  });

  test('回答が無い学校は持たない', async () => {
    const ratings = await loadSchoolRatings(fakeDb([], []), 'acc');
    expect(ratings.size).toBe(0);
  });
});
