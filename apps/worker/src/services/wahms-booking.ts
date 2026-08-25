/**
 * WAHMS 講義の申込。
 *
 * これまで申込は Apps Script がスプレッドシートに書くだけで、こちらには
 * 一切届いていなかった (2026-08-25 に判明。5日間気づかれなかった)。
 * Worker は webhook を先に受け取るので、Apps Script へ渡す前に同じ申込を
 * D1 へ記録しておけば、二度と取りこぼさない。
 *
 * 移行の段階3aとして、まずは記録だけを行う。返信は従来どおり Apps Script が
 * 出す。返信まで奪うと、こちらの不具合がそのまま「申し込んでも返事が来ない」に
 * なるため、記録が正しいと確認できるまで分けている。
 */

export type BookingRequest = { month: number; day: number; school: string };

/** 「8月25日マーケティング学校に申し込む」を分解する。リッチメニューの文言。 */
export function parseBookingRequest(text: string | undefined): BookingRequest | null {
  const m = /^\s*(\d{1,2})月(\d{1,2})日(.+?)に申し込む\s*$/.exec(text ?? '');
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const school = m[3].trim();
  if (month < 1 || month > 12 || day < 1 || day > 31 || !school) return null;
  return { month, day, school };
}

export type LectureSlot = {
  slotId: string;
  eventId: string;
  schoolName: string;
  eventDate: string;   // JST YYYY-MM-DD
  startTime: string;   // JST HH:MM
  endTime: string;     // JST HH:MM
  lectureLabel: string | null;
  theme: string | null;
};

/**
 * 申込文言から開催枠を引く。
 *
 * 文言に年が無いので、今日以降で最初に来る同月日を採る。年末に「1月◯日」を
 * 押したときに前の年を拾わないため。
 */
export async function findLectureSlot(
  db: D1Database,
  lineAccountId: string,
  req: BookingRequest,
): Promise<LectureSlot | null> {
  const mmdd = `${String(req.month).padStart(2, '0')}-${String(req.day).padStart(2, '0')}`;
  return db
    .prepare(
      `SELECT s.id AS slotId,
              e.id AS eventId,
              e.name AS schoolName,
              DATE(s.starts_at, '+9 hours') AS eventDate,
              SUBSTR(TIME(s.starts_at, '+9 hours'), 1, 5) AS startTime,
              SUBSTR(TIME(s.ends_at, '+9 hours'), 1, 5) AS endTime,
              s.sequence_label AS lectureLabel,
              s.title AS theme
         FROM event_slots s
         JOIN events e ON e.id = s.event_id
        WHERE e.line_account_id = ?
          AND s.deleted_at IS NULL
          AND s.is_active = 1
          AND SUBSTR(DATE(s.starts_at, '+9 hours'), 6) = ?
          AND e.name LIKE '%' || ? || '%'
          AND DATE(s.starts_at, '+9 hours') >= DATE('now', '+9 hours')
        ORDER BY s.starts_at
        LIMIT 1`,
    )
    .bind(lineAccountId, mmdd, req.school)
    .first<LectureSlot>();
}

export type RecordResult = { recorded: boolean; reason: 'created' | 'duplicate' | 'no_friend' };

/**
 * 申込を D1 に記録する。
 *
 * 2か所に書く。`wahms_applications` は今の管理画面が見ているところ、
 * `event_bookings` は移行先のイベント予約機能。移行が終わるまでは両方を
 * 揃えておく必要がある。
 *
 * source_row は NULL。スプレッドシートの行番号を持つ列で、Worker 由来の
 * 申込には対応する行が無い (SQLite の UNIQUE は NULL を重複扱いしないので、
 * 何件あっても衝突しない)。
 */
export async function recordBooking(
  db: D1Database,
  lineAccountId: string,
  lineUserId: string,
  slot: LectureSlot,
): Promise<RecordResult> {
  // 同じ講義に二重で記録しない。リッチメニューは連打できる。
  const dup = await db
    .prepare(
      `SELECT id FROM wahms_applications
        WHERE line_account_id = ? AND line_user_id = ? AND school_name = ?
          AND SUBSTR(REPLACE(event_date, '/', '-'), 1, 10) = ?
        LIMIT 1`,
    )
    .bind(lineAccountId, lineUserId, slot.schoolName, slot.eventDate)
    .first<{ id: string }>();
  if (dup) return { recorded: false, reason: 'duplicate' };

  const lectureNumber = slot.lectureLabel ? slot.lectureLabel.replace(/[^0-9]/g, '') : null;
  await db
    .prepare(
      `INSERT INTO wahms_applications
         (id, line_account_id, applied_at, line_user_id, school_name, event_date, event_time,
          theme, lecture_number, morning_reminder_sent, last_reminder_sent, attended, source_row)
       VALUES (?, ?, datetime('now', '+9 hours'), ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL)`,
    )
    .bind(
      crypto.randomUUID(),
      lineAccountId,
      lineUserId,
      slot.schoolName,
      `${slot.eventDate}T00:00:00`,
      `${slot.startTime}〜${slot.endTime}`,
      slot.theme,
      lectureNumber,
    )
    .run();

  // 申込回数は管理画面の並びに出ている。増やさないと実態とずれる。
  await db
    .prepare(
      `UPDATE wahms_participants
          SET application_count = application_count + 1, updated_at = datetime('now')
        WHERE line_account_id = ? AND line_user_id = ?`,
    )
    .bind(lineAccountId, lineUserId)
    .run();

  // イベント予約側。friends に居ない相手は記録できないので、その場合は
  // wahms_applications だけで止める (webhook が friend を作るので通常は在る)。
  const friend = await db
    .prepare(`SELECT id FROM friends WHERE line_user_id = ? LIMIT 1`)
    .bind(lineUserId)
    .first<{ id: string }>();
  if (!friend) return { recorded: true, reason: 'no_friend' };

  const already = await db
    .prepare(
      `SELECT id FROM event_bookings
        WHERE slot_id = ? AND friend_id = ? AND status NOT IN ('cancelled', 'rejected', 'expired')
        LIMIT 1`,
    )
    .bind(slot.slotId, friend.id)
    .first<{ id: string }>();
  if (already) return { recorded: true, reason: 'created' };

  await db
    .prepare(
      `INSERT INTO event_bookings
         (id, line_account_id, event_id, slot_id, friend_id, status, requested_at, internal_note)
       VALUES (?, ?, ?, ?, ?, 'confirmed', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), ?)`,
    )
    .bind(
      crypto.randomUUID(),
      lineAccountId,
      slot.eventId,
      slot.slotId,
      friend.id,
      'リッチメニューからの申込',
    )
    .run();

  return { recorded: true, reason: 'created' };
}
