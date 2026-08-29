/**
 * 開催予定の操作。休講・延期・繰越を、画面のボタンからできるようにする。
 *
 * 2026年8月に2週続けて延期が起き、そのたびに手作業でDBを直していた。
 * 手順を間違えると、延期したのに「まもなく開講」のZoom案内が飛ぶ。
 * 実際に危なかったのは次の3点で、ここで必ずまとめて面倒を見る。
 *
 *   1. 受付を止めても、その日のリマインドは別に止めないと飛ぶ
 *   2. 止めた回の申込文言が Apps Script へ流れ、向こうで申込が通る
 *      (これは wahms-router 側で受け止める)
 *   3. 繰り越すと、申込者の開催日も一緒に動かさないと置き去りになる
 */

export type LectureSlotRow = {
  slotId: string;
  eventId: string;
  schoolName: string;
  eventDate: string;   // JST YYYY-MM-DD
  startTime: string;
  endTime: string;
  lectureLabel: string | null;
  theme: string | null;
  isActive: number;
};

const SLOT_COLUMNS = `s.id AS slotId,
              e.id AS eventId,
              e.name AS schoolName,
              DATE(s.starts_at, '+9 hours') AS eventDate,
              SUBSTR(TIME(s.starts_at, '+9 hours'), 1, 5) AS startTime,
              SUBSTR(TIME(s.ends_at, '+9 hours'), 1, 5) AS endTime,
              s.sequence_label AS lectureLabel,
              s.title AS theme,
              s.is_active AS isActive`;

/** 開催枠を1つ引く。アカウントを必ず条件に入れる (他社の枠を触らせない)。 */
export async function findSlotById(
  db: D1Database,
  lineAccountId: string,
  slotId: string,
): Promise<LectureSlotRow | null> {
  return db
    .prepare(
      `SELECT ${SLOT_COLUMNS}
         FROM event_slots s JOIN events e ON e.id = s.event_id
        WHERE s.id = ? AND e.line_account_id = ? AND s.deleted_at IS NULL`,
    )
    .bind(slotId, lineAccountId)
    .first<LectureSlotRow>();
}

/** 申込の開催日は '2026/08/28' と '2026-08-28T00:00:00' が混在している。 */
const SAME_DAY = `SUBSTR(REPLACE(event_date, '/', '-'), 1, 10) = ?`;

export type SuspendResult = { slot: LectureSlotRow; applicants: number; remindersStopped: number };

/**
 * 受付を止める (延期・休講)。
 *
 * 「今週の開催日」から申込ボタンが消え、その回への申込は延期の案内で断る。
 * **同時に、その日のリマインドも止める。** 止め忘れると、延期したのに
 * Zoom URL 付きの「まもなく開講」が申込者へ飛ぶ。
 *
 * 申込そのものは消さない。誰が申し込んでいたかは案内を出すのに要る。
 */
export async function suspendLecture(
  db: D1Database,
  lineAccountId: string,
  slotId: string,
): Promise<SuspendResult | null> {
  const slot = await findSlotById(db, lineAccountId, slotId);
  if (!slot) return null;

  await db
    .prepare(`UPDATE event_slots SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
    .bind(slotId)
    .run();

  // リマインドは「送信済み」にして止める。行を消さないのは、あとで
  // 再開したときに誰が対象だったか分からなくなるため。
  const stopped = await db
    .prepare(
      `UPDATE wahms_applications
          SET morning_reminder_sent = 1, last_reminder_sent = 1, updated_at = datetime('now')
        WHERE line_account_id = ? AND school_name = ? AND ${SAME_DAY}
          AND source_row IS NULL`,
    )
    .bind(lineAccountId, slot.schoolName, slot.eventDate)
    .run();

  const applicants = await countApplicants(db, lineAccountId, slot);
  return { slot, applicants, remindersStopped: stopped.meta?.changes ?? 0 };
}

/**
 * 受付を再開する。
 *
 * リマインドの送信済みフラグは、**開催日が明日以降のときだけ**戻す。
 * 当日に戻すと、朝に送ったぶんがもう一度飛ぶ。
 */
export async function resumeLecture(
  db: D1Database,
  lineAccountId: string,
  slotId: string,
): Promise<{ slot: LectureSlotRow; remindersRearmed: number } | null> {
  const slot = await findSlotById(db, lineAccountId, slotId);
  if (!slot) return null;

  await db
    .prepare(`UPDATE event_slots SET is_active = 1, updated_at = datetime('now') WHERE id = ?`)
    .bind(slotId)
    .run();

  const rearmed = await db
    .prepare(
      `UPDATE wahms_applications
          SET morning_reminder_sent = 0, last_reminder_sent = 0, updated_at = datetime('now')
        WHERE line_account_id = ? AND school_name = ? AND ${SAME_DAY}
          AND source_row IS NULL
          AND ? > DATE('now', '+9 hours')`,
    )
    .bind(lineAccountId, slot.schoolName, slot.eventDate, slot.eventDate)
    .run();

  return { slot, remindersRearmed: rearmed.meta?.changes ?? 0 };
}

export type ShiftResult = {
  slot: LectureSlotRow;
  shiftedSlots: number;
  movedApplications: number;
  newDate: string;
};

/**
 * この回以降を1週間ずつ後ろへずらす (繰越)。
 *
 * 運用ルール (docs/WAHMS_GAS_MIGRATION.md) どおり、該当回だけを動かすのでは
 * なく以降を全部ずらす。1回だけ動かすと次の回と同じ日に重なる。
 *
 * 申込者の開催日も一緒に動かす。動かさないと、延期後の回に誰も申し込んで
 * いないことになり、リマインドも届かない。
 */
export async function shiftLectureWeek(
  db: D1Database,
  lineAccountId: string,
  slotId: string,
): Promise<ShiftResult | null> {
  const slot = await findSlotById(db, lineAccountId, slotId);
  if (!slot) return null;

  const shifted = await db
    .prepare(
      `UPDATE event_slots
          SET starts_at  = strftime('%Y-%m-%dT%H:%M:%SZ', starts_at, '+7 days'),
              ends_at    = strftime('%Y-%m-%dT%H:%M:%SZ', ends_at,   '+7 days'),
              is_active  = 1,
              updated_at = datetime('now')
        WHERE id IN (
          SELECT s.id FROM event_slots s JOIN events e ON e.id = s.event_id
           WHERE e.line_account_id = ? AND e.id = ? AND s.deleted_at IS NULL
             AND DATE(s.starts_at, '+9 hours') >= ?
        )`,
    )
    .bind(lineAccountId, slot.eventId, slot.eventDate)
    .run();

  const newDate = addDays(slot.eventDate, 7);

  // 申込者も新しい日付へ。source_row を外して、以降の案内はこちらが持つ
  // (スプレッドシート側は古い日付のままなので、Apps Script は送らない)。
  const moved = await db
    .prepare(
      `UPDATE wahms_applications
          SET event_date = ? || 'T00:00:00',
              morning_reminder_sent = 0,
              last_reminder_sent = 0,
              source_row = NULL,
              updated_at = datetime('now')
        WHERE line_account_id = ? AND school_name = ? AND ${SAME_DAY}`,
    )
    .bind(newDate, lineAccountId, slot.schoolName, slot.eventDate)
    .run();

  return {
    slot,
    shiftedSlots: shifted.meta?.changes ?? 0,
    movedApplications: moved.meta?.changes ?? 0,
    newDate,
  };
}

export function addDays(isoDate: string, days: number): string {
  return new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

async function countApplicants(
  db: D1Database,
  lineAccountId: string,
  slot: LectureSlotRow,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT line_user_id) AS n FROM wahms_applications
        WHERE line_account_id = ? AND school_name = ? AND ${SAME_DAY}`,
    )
    .bind(lineAccountId, slot.schoolName, slot.eventDate)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** その回の申込者のLINEユーザーID。延期のお知らせを送る相手。 */
export async function lectureApplicantIds(
  db: D1Database,
  lineAccountId: string,
  slot: LectureSlotRow,
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT line_user_id FROM wahms_applications
        WHERE line_account_id = ? AND school_name = ? AND ${SAME_DAY}`,
    )
    .bind(lineAccountId, slot.schoolName, slot.eventDate)
    .all<{ line_user_id: string }>();
  return (rows.results ?? []).map((r) => r.line_user_id).filter(Boolean);
}
