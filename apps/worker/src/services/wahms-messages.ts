/**
 * WAHMS が受講者へ出す定型文。
 *
 * 文面は既存の Apps Script と1文字単位で合わせている。移行しても受講者から
 * 見て何も変わらないようにするため。文面を良くするのは移行が終わってから。
 *
 * Zoom の接続情報は D1 の account_settings に置く。Apps Script では
 * コードに直書きされており、スクリプトの編集権限を持つ全員に見えていた。
 */

import type { LectureSlot } from './wahms-booking.js';

export type ZoomSettings = { url: string; id: string; password: string };

const KEYS = {
  url: 'wahms_zoom_url',
  id: 'wahms_zoom_id',
  password: 'wahms_zoom_password',
} as const;

export async function loadZoomSettings(
  db: D1Database,
  lineAccountId: string,
): Promise<ZoomSettings | null> {
  const rows = await db
    .prepare(`SELECT key, value FROM account_settings WHERE line_account_id = ? AND key IN (?, ?, ?)`)
    .bind(lineAccountId, KEYS.url, KEYS.id, KEYS.password)
    .all<{ key: string; value: string }>();
  const map = new Map((rows.results ?? []).map((r) => [r.key, r.value]));
  const url = map.get(KEYS.url);
  const id = map.get(KEYS.id);
  const password = map.get(KEYS.password);
  // 1つでも欠けたら送らない。URLの無い案内を送っても参加できない。
  if (!url || !id || !password) return null;
  return { url, id, password };
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 「8月25日（火）」。Apps Script の school.date と同じ形。 */
export function japaneseDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日（${w}）`;
}

/** 開室時刻。開始10分前。Apps Script の openTime と同じ。 */
export function openTime(startTime: string): string {
  const [h, m] = startTime.split(':').map(Number);
  const t = h * 60 + m - 10;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function timeRange(slot: LectureSlot): string {
  return `${slot.startTime}〜${slot.endTime}`;
}

/**
 * テーマ行。テーマの無い学校では行ごと省く。
 *
 * 青山塾は第11回から「何でも相談OK」になりテーマを設けていない。
 * 空文字のまま組み立てると『』や「🎓 」だけの行が残り、壊れて見える。
 */
function themeLine(theme: string | null, wrap: (t: string) => string): string {
  const value = theme?.trim();
  return value ? `${wrap(value)}\n` : '';
}

/** 申込完了。2通に分けるのも既存に合わせている。 */
export function bookingConfirmMessages(slot: LectureSlot, zoom: ZoomSettings): string[] {
  return [
    '✅ お申し込みが完了しました',
    `確かに下記、${slot.schoolName}について承りました。\n` +
      '_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/\n' +
      `《 ${slot.schoolName} 》\n` +
      `日時：${japaneseDate(slot.eventDate)}${timeRange(slot)}\n` +
      'オンラインzoom開催\n' +
      themeLine(slot.theme, (t) => `『${t}』`) +
      ' スマホ、顔出しなしでもOK\n' +
      '_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/_/\n' +
      '🔷ZOOM参加URL\n' +
      `${zoom.url}\n` +
      `ID：${zoom.id}\n` +
      `パスワード：${zoom.password}`,
  ];
}

/** 開催日の朝に送る案内。 */
export function morningReminderMessages(slot: LectureSlot, zoom: ZoomSettings): string[] {
  return [
    `✨【${slot.schoolName}の参加用Zoom URLをお送りします】✨\n\n` +
      '🌅 おはようございます！\n\n' +
      `本日「${timeRange(slot)}」より開講の\n` +
      `${slot.schoolName}は\n` +
      '下記Zoom URLよりご参加くださいませ👇',
    '━━━━━━━━━━━━━\n' +
      `📅 本日 ${timeRange(slot)}\n` +
      themeLine(slot.theme, (t) => `🎓 ${t}`) +
      '━━━━━━━━━━━━━\n\n' +
      '▼ 下のZOOM URLをタップして参加 ▼\n\n' +
      `${zoom.url}\n\n` +
      `ID：${zoom.id}\n` +
      `パスコード：${zoom.password}\n\n` +
      `🕐 「${openTime(slot.startTime)}」頃に開室いたします\n` +
      '📱 スマホ1台でOK\n' +
      '👤 カメラOFF・顔出しなしOK',
  ];
}

/** 開始30分前に送る案内。 */
export function preLectureReminderMessages(slot: LectureSlot, zoom: ZoomSettings): string[] {
  return [
    `🔔【まもなく開講！${slot.schoolName}】\n\n` +
      `本日 ${slot.startTime} スタートまで\n` +
      'あと30分です✨',
    '━━━━━━━━━━━━━\n' +
      `📅 本日 ${timeRange(slot)}\n` +
      themeLine(slot.theme, (t) => `🎓 ${t}`) +
      '━━━━━━━━━━━━━\n\n' +
      '▼ 下のZOOM URLをタップして参加 ▼\n\n' +
      `${zoom.url}\n\n` +
      `ID：${zoom.id}\n` +
      `パスコード：${zoom.password}`,
  ];
}

/** 開催が終わった講義に申し込まれたとき。 */
export function lectureFinishedMessage(schoolName: string, date: string, time: string): string {
  return (
    '⚠️ 申し訳ございません。\n\n' +
    `${schoolName}\n（${date}${time}）は\n` +
    'すでに開催が終了いたしました。\n\n' +
    '次回の開催をぜひお申し込みください🌱\n' +
    '他の学校は引き続き受付中です！'
  );
}

/**
 * 初参加の人に送る、プロフィール登録の案内。
 *
 * Apps Script の sendLiffInvite と同じ2通。違うのはリンク先だけで、
 * LIFF (LINEログイン必須) ではなく Worker が出す普通のWebフォームを指す。
 */
export function profileInviteMessages(schoolName: string, formUrl: string): string[] {
  return [
    '✨【ご利用ありがとうございます】\n\n' +
      'WAHMSは初参加の方ですね！\n' +
      '1分の簡単なアンケートにご協力ください📝\n\n' +
      '回答完了後、自動的に\n' +
      `「${schoolName}」のお申し込みが\n` +
      '確定いたします✨',
    `▼ アンケートはこちら(約1分)\n${formUrl}`,
  ];
}

/**
 * 延期になった回に申し込まれたとき。
 *
 * 終了済みの案内 (lectureFinishedMessage) と分けている。「終了しました」と
 * 返すと、まだ開催前なのに終わったと受け取られてしまう。
 */
export function lecturePostponedMessage(schoolName: string, date: string, time: string): string {
  return (
    '⚠️ 申し訳ございません。\n\n' +
    `${schoolName}\n（${date}${time}）は\n` +
    '諸般の事情により延期となりました。\n\n' +
    'あらためて日程が決まり次第、\n' +
    'ご案内いたします。\n\n' +
    '他の学校は引き続き受付中です🌱'
  );
}
