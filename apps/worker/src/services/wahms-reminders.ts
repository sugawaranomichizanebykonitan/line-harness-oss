/**
 * WAHMS 講義のリマインド。開催日の朝7時と、開始30分前の2回。
 *
 * Apps Script も同じリマインドを持っているので、**Worker が引き取った申込だけ**
 * を対象にする。判別は `wahms_applications.source_row`。スプレッドシート由来の
 * 行には行番号が入っており、Worker が記録した行は NULL になる。
 * この境目を外すと、受講者に同じ案内が2通届く。
 *
 * 送信済みかどうかは既存の morning_reminder_sent / last_reminder_sent で持つ。
 * cron は毎分動くので、フラグを先に立ててから送る。
 */

import { LineClient } from '@line-crm/line-sdk';
import type { LectureSlot } from './wahms-booking.js';
import { loadZoomSettings, morningReminderMessages, preLectureReminderMessages } from './wahms-messages.js';

type Row = {
  id: string;
  line_account_id: string;
  line_user_id: string;
  school_name: string;
  event_date: string;
  event_time: string | null;
  theme: string | null;
  lecture_number: string | null;
};

export type ReminderResult = { morning: number; pre: number; failed: number };

/** '20:30〜22:00' を分解する。区切りは全角チルダ。 */
export function splitEventTime(value: string | null): { start: string; end: string } | null {
  const m = /^\s*(\d{1,2}:\d{2})\s*[〜~-]\s*(\d{1,2}:\d{2})\s*$/.exec(value ?? '');
  return m ? { start: m[1], end: m[2] } : null;
}

/** JSTの「今」を YYYY-MM-DD と分に分けて返す。 */
export function jstNow(now: Date): { date: string; minutes: number } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return {
    date: jst.toISOString().slice(0, 10),
    minutes: jst.getUTCHours() * 60 + jst.getUTCMinutes(),
  };
}

function toSlot(row: Row, time: { start: string; end: string }): LectureSlot {
  return {
    slotId: '', eventId: '',
    schoolName: row.school_name,
    eventDate: row.event_date.slice(0, 10),
    startTime: time.start,
    endTime: time.end,
    lectureLabel: row.lecture_number ? `第${row.lecture_number}回` : null,
    theme: row.theme,
  };
}

/**
 * 送信すべきリマインドを送る。毎分の cron から呼ばれる。
 *
 * @param now テストから時刻を差し込むため。既定は現在時刻。
 */
export async function sendWahmsReminders(
  db: D1Database,
  now: Date = new Date(),
): Promise<ReminderResult> {
  const result: ReminderResult = { morning: 0, pre: 0, failed: 0 };
  const { date: today, minutes } = jstNow(now);

  // 朝は7:00〜7:09。cronの取りこぼしに備えて幅を持たせるが、送信済みフラグが
  // あるので二重送信にはならない。
  const morningWindow = minutes >= 7 * 60 && minutes < 7 * 60 + 10;

  const rows = await db
    .prepare(
      `SELECT id, line_account_id, line_user_id, school_name, event_date, event_time, theme, lecture_number
         FROM wahms_applications
        WHERE source_row IS NULL
          AND SUBSTR(REPLACE(event_date, '/', '-'), 1, 10) = ?
          AND (morning_reminder_sent = 0 OR last_reminder_sent = 0)`,
    )
    .bind(today)
    .all<Row>();
  const targets = rows.results ?? [];
  if (targets.length === 0) return result;

  // アカウントごとに1回だけ解決する。行ごとに引くとD1を無駄に叩く。
  const clients = new Map<string, { client: LineClient; zoom: Awaited<ReturnType<typeof loadZoomSettings>> }>();
  const resolve = async (accountId: string) => {
    const cached = clients.get(accountId);
    if (cached) return cached;
    const account = await db
      .prepare(`SELECT channel_access_token FROM line_accounts WHERE id = ? AND is_active = 1`)
      .bind(accountId)
      .first<{ channel_access_token: string }>();
    const entry = {
      client: account ? new LineClient(account.channel_access_token) : null,
      zoom: await loadZoomSettings(db, accountId),
    } as { client: LineClient; zoom: Awaited<ReturnType<typeof loadZoomSettings>> };
    clients.set(accountId, entry);
    return entry;
  };

  for (const row of targets) {
    const time = splitEventTime(row.event_time);
    if (!time) continue;
    const startMinutes = Number(time.start.slice(0, 2)) * 60 + Number(time.start.slice(3, 5));
    const untilStart = startMinutes - minutes;
    // 30分前ちょうどを狙うが、cronの遅れを見込んで25〜35分前を窓にする。
    const preWindow = untilStart <= 35 && untilStart >= 25;

    const kind = morningWindow ? 'morning' : preWindow ? 'pre' : null;
    if (!kind) continue;

    const { client, zoom } = await resolve(row.line_account_id);
    // Zoom情報が無いまま送ると参加できない案内になる。送らずに残す。
    if (!client || !zoom) continue;

    const column = kind === 'morning' ? 'morning_reminder_sent' : 'last_reminder_sent';
    // 先にフラグを立てる。送信中に次の分のcronが走っても二重送信にならない。
    const claimed = await db
      .prepare(`UPDATE wahms_applications SET ${column} = 1, updated_at = datetime('now') WHERE id = ? AND ${column} = 0`)
      .bind(row.id)
      .run();
    if (!claimed.meta?.changes) continue;

    const slot = toSlot(row, time);
    const messages = (kind === 'morning' ? morningReminderMessages : preLectureReminderMessages)(slot, zoom)
      .map((text) => ({ type: 'text' as const, text }));
    try {
      await client.pushMessage(row.line_user_id, messages);
      if (kind === 'morning') result.morning += 1; else result.pre += 1;
    } catch (err) {
      console.error(`[wahms-reminder] push failed ${row.id}`, err);
      result.failed += 1;
      // 送れなかったので、次のcronで再挑戦できるよう戻す。
      await db.prepare(`UPDATE wahms_applications SET ${column} = 0 WHERE id = ?`).bind(row.id).run();
    }
  }
  return result;
}
