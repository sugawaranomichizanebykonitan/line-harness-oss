/**
 * WAHMS「今週の開催日」の土台。
 *
 * Apps Script は6校の開催日を SCHOOLS という辞書にコードで持っており、
 * 毎週人手で書き足していた。書き忘れるとその回は「休講」と表示される。
 *
 * Worker は D1 の event_slots (開催予定) を正とする。管理画面から直せるので、
 * コードを触らずに開催日とテーマを変えられる。
 */

/** 6校の並びと曜日。火曜を起点にした日数のずれで持つ (Apps Script と同じ)。 */
export const SCHOOL_WEEK = [
  { keyword: 'マーケティング学校', emoji: '🔥', label: 'マーケティング学校', dayOffset: 0, day: '火', time: '20:30〜22:00' },
  { keyword: '青山塾', emoji: '☕', label: '青山塾（一問一答）', dayOffset: 1, day: '水', time: '12:00〜13:00' },
  { keyword: 'WEB学校', emoji: '💻', label: 'WEB学校', dayOffset: 1, day: '水', time: '20:30〜22:00' },
  { keyword: 'セールス学校', emoji: '🤝', label: 'セールス学校', dayOffset: 2, day: '木', time: '20:30〜22:00' },
  { keyword: 'マネジメント学校', emoji: '📈', label: 'マネジメント学校', dayOffset: 3, day: '金', time: '20:30〜22:00' },
  { keyword: '人間力学校', emoji: '☀️', label: '人間力学校', dayOffset: 4, day: '土', time: '09:00〜10:30' },
] as const;

/** JSTの「今」を Date として得る。中身のUTC値をJSTの壁時計として読む。 */
function jst(now: Date): Date {
  return new Date(now.getTime() + 9 * 3600_000);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 表示する週の火曜日 (JST) を返す。Apps Script の getCurrentWeekRange と同じ。
 *
 * 土曜は朝10時が境目。人間力学校が土曜9時開催なので、終わるまでは今週を出す。
 */
export function weekAnchorTuesday(now: Date): string {
  const j = jst(now);
  const dow = j.getUTCDay(); // 0=日
  let diff: number;
  if (dow === 0) diff = 2;
  else if (dow === 1) diff = 1;
  else if (dow === 6) diff = j.getUTCHours() < 10 ? -4 : 3;
  else diff = -(dow - 2);
  const tuesday = new Date(j.getTime() + diff * 86_400_000);
  return ymd(tuesday);
}

/** 火曜日から n 日後の日付 (YYYY-MM-DD)。 */
export function addDays(isoDate: string, days: number): string {
  return ymd(new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + days * 86_400_000));
}

export type WeekEntry = {
  keyword: string;
  emoji: string;
  label: string;
  day: string;
  date: string;        // YYYY-MM-DD
  month: number;
  dayOfMonth: number;
  held: boolean;
  time: string;
  theme: string | null;
  rating: number | null;
  bookingText: string; // 「8月26日WEB学校に申し込む」
};

type SlotRow = { schoolName: string; eventDate: string; startTime: string; endTime: string; theme: string | null };

/** 学校別の平均満足度。Apps Script の calculateSchoolRatings と同じ集計。 */
export async function loadSchoolRatings(
  db: D1Database,
  lineAccountId: string,
): Promise<Map<string, number>> {
  // school_name は絵文字付き ('💻 WEB学校') で、移行前後で表記ゆれがある。
  // 合計と件数で持ち帰り、学校ごとに足し合わせてから割る。学校名で先に
  // 平均を出して平均の平均を取ると、件数の偏りで数字がずれる。
  const rows = await db
    .prepare(
      `SELECT school_name AS school, SUM(satisfaction) AS total, COUNT(*) AS count
         FROM wahms_survey_responses
        WHERE line_account_id = ? AND satisfaction > 0
        GROUP BY school_name`,
    )
    .bind(lineAccountId)
    .all<{ school: string; total: number; count: number }>();

  const map = new Map<string, number>();
  for (const s of SCHOOL_WEEK) {
    let total = 0;
    let count = 0;
    for (const r of rows.results ?? []) {
      if (!(r.school ?? '').includes(s.keyword)) continue;
      total += Number(r.total) || 0;
      count += Number(r.count) || 0;
    }
    if (count > 0) map.set(s.keyword, total / count);
  }
  return map;
}

/**
 * 今週の6校を、開催の有無つきで返す。
 *
 * event_slots に無い日は「休講」。Apps Script も SCHOOLS 辞書に無いキーを
 * 休講カードにしていたので、受講者から見た表示は変わらない。
 */
export async function loadWeeklySchedule(
  db: D1Database,
  lineAccountId: string,
  now: Date = new Date(),
): Promise<WeekEntry[]> {
  const tuesday = weekAnchorTuesday(now);
  const saturday = addDays(tuesday, 4);
  const [slots, ratings] = await Promise.all([
    db
      .prepare(
        `SELECT e.name AS schoolName,
                DATE(s.starts_at, '+9 hours') AS eventDate,
                SUBSTR(TIME(s.starts_at, '+9 hours'), 1, 5) AS startTime,
                SUBSTR(TIME(s.ends_at, '+9 hours'), 1, 5) AS endTime,
                s.title AS theme
           FROM event_slots s
           JOIN events e ON e.id = s.event_id
          WHERE e.line_account_id = ?
            AND s.deleted_at IS NULL AND s.is_active = 1
            AND DATE(s.starts_at, '+9 hours') BETWEEN ? AND ?`,
      )
      .bind(lineAccountId, tuesday, saturday)
      .all<SlotRow>(),
    loadSchoolRatings(db, lineAccountId),
  ]);

  return SCHOOL_WEEK.map((s) => {
    const date = addDays(tuesday, s.dayOffset);
    const slot = (slots.results ?? []).find(
      (r) => r.eventDate === date && (r.schoolName ?? '').includes(s.keyword),
    );
    const [, mm, dd] = date.split('-');
    const month = Number(mm);
    const dayOfMonth = Number(dd);
    return {
      keyword: s.keyword,
      emoji: s.emoji,
      label: s.label,
      day: s.day,
      date,
      month,
      dayOfMonth,
      held: Boolean(slot),
      time: slot ? `${slot.startTime}〜${slot.endTime}` : s.time,
      theme: slot?.theme?.trim() || null,
      rating: ratings.get(s.keyword) ?? null,
      bookingText: `${month}月${dayOfMonth}日${s.keyword}に申し込む`,
    };
  });
}
