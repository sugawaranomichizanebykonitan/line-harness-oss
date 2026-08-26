/**
 * WAHMS のテキスト応答を1か所にまとめる。
 *
 * これまでリッチメニューの応答は Apps Script が返しており、Worker は
 * アーカイブと一部の申込だけを引き取っていた。どちらが返すのかが機能ごとに
 * 散らばっていて、取りこぼしが起きた (2026-08-26 の申込3件)。
 *
 * ここが「Worker はこの文言にこう答える」の唯一の置き場になる。答えられた
 * ものは Apps Script へ転送しない。答えられなければ null を返し、呼び出し元が
 * 従来どおり転送する。
 */

import type { Message } from '@line-crm/line-sdk';
import { parseArchiveRequest, buildArchiveReply } from './wahms-archive.js';
import { parseBookingRequest, findLectureSlot, findFinishedLectureSlot, recordBooking } from './wahms-booking.js';
import { weeklyScheduleFlex, testimonialsFlex } from './wahms-flex.js';
import {
  loadZoomSettings, bookingConfirmMessages, profileInviteMessages,
  lectureFinishedMessage, japaneseDate,
} from './wahms-messages.js';
import { createProfileInvite, hasCompletedProfile } from './wahms-profile.js';
import { loadWeeklySchedule } from './wahms-schedule.js';
import { ABOUT_KEYWORDS, ABOUT_TEXT, FAQ_TEXT } from './wahms-static.js';

const SURVEY_FORM_KEY = 'wahms_survey_form_url';
const PROFILE_FORM_KEY = 'wahms_profile_form_url';

function text(value: string): Message {
  return { type: 'text', text: value };
}

/**
 * 初回アンケートのURLの土台。
 *
 * 専用の設定があればそれを使う。無ければ講義アンケートのURLから導く
 * (`.../survey` → `.../profile`)。設定を1つ足し忘れても止まらないようにする。
 */
export async function profileFormBase(db: D1Database, lineAccountId: string): Promise<string | null> {
  const rows = await db
    .prepare(`SELECT key, value FROM account_settings WHERE line_account_id = ? AND key IN (?, ?)`)
    .bind(lineAccountId, PROFILE_FORM_KEY, SURVEY_FORM_KEY)
    .all<{ key: string; value: string }>();
  const map = new Map((rows.results ?? []).map((r) => [r.key, r.value]));
  const explicit = map.get(PROFILE_FORM_KEY)?.trim();
  if (explicit) return explicit;
  const survey = map.get(SURVEY_FORM_KEY)?.trim();
  if (!survey) return null;
  return survey.replace(/\/survey\/?$/, '/profile');
}

/** 友だち追加のときに返す、6校のカレンダー。 */
export async function welcomeMessages(
  db: D1Database,
  lineAccountId: string,
  now: Date = new Date(),
): Promise<Message[]> {
  const week = await loadWeeklySchedule(db, lineAccountId, now);
  return [
    {
      type: 'flex',
      altText: 'WAHMSへようこそ！今週の学校スケジュールをご確認ください',
      contents: weeklyScheduleFlex(week),
    },
  ];
}

export type RouteInput = {
  db: D1Database;
  lineAccountId: string;
  lineUserId: string | null;
  text: string | undefined | null;
  now?: Date;
};

/**
 * 応答の判定結果。
 *
 * - `handled`  … Worker が返す。Apps Script へ転送しない。
 * - `skip`     … WAHMS の文言ではない。Apps Script も何もしないので転送しない。
 * - `fallback` … 本来 Worker が返すべきだが返せなかった。転送して従来動作に任せる。
 */
export type RouteOutcome =
  | { kind: 'handled'; messages: Message[] }
  | { kind: 'skip' }
  | { kind: 'fallback'; reason: string };

const SKIP: RouteOutcome = { kind: 'skip' };
const handled = (messages: Message[]): RouteOutcome => ({ kind: 'handled', messages });
const fallback = (reason: string): RouteOutcome => ({ kind: 'fallback', reason });

/**
 * 受け取った文言に対する返信を組み立てる。
 *
 * 申込のときは記録も行う。返信できるかどうかと記録するかどうかは別なので、
 * 記録は先に、無条件で済ませる。
 */
export async function buildWahmsReply(input: RouteInput): Promise<RouteOutcome> {
  const { db, lineAccountId, lineUserId } = input;
  const raw = (input.text ?? '').trim();
  if (!raw) return SKIP;
  const now = input.now ?? new Date();

  if (raw === '今週の開催日') {
    const week = await loadWeeklySchedule(db, lineAccountId, now);
    return handled([{
      type: 'flex',
      altText: '📅 今週のWAHMS開催日｜各学校の満足度と申込ボタン',
      contents: weeklyScheduleFlex(week),
    }]);
  }

  if (raw === '受講者の声') {
    return handled([{
      type: 'flex',
      altText: '🎤 WAHMS 受講者のリアルな声｜全体満足度★4.9',
      contents: testimonialsFlex(),
    }]);
  }

  if (raw === 'よくある質問') return handled([text(FAQ_TEXT)]);
  if (ABOUT_KEYWORDS.includes(raw)) return handled([text(ABOUT_TEXT)]);

  const archiveSchool = parseArchiveRequest(raw);
  if (archiveSchool) {
    const reply = await buildArchiveReply(db, lineAccountId, archiveSchool);
    return handled([text(reply ?? 'アーカイブが見つかりませんでした。メニューからもう一度お試しください。')]);
  }

  const booking = parseBookingRequest(raw);
  if (!booking) return SKIP;
  if (!lineUserId) return fallback('no-user-id');

  const slot = await findLectureSlot(db, lineAccountId, booking);

  if (!slot) {
    // 開催予定に無い。過去に同じ日付の回があれば「終了しました」を返す。
    const finished = await findFinishedLectureSlot(db, lineAccountId, booking);
    if (!finished) return fallback('slot-not-found');
    return handled([text(lectureFinishedMessage(
      finished.schoolName,
      japaneseDate(finished.eventDate),
      `${finished.startTime}〜${finished.endTime}`,
    ))]);
  }

  // 記録は返信の成否と切り離す。返せなくても申込は残す。
  await recordBooking(db, lineAccountId, lineUserId, slot);

  if (!(await hasCompletedProfile(db, lineAccountId, lineUserId))) {
    const base = await profileFormBase(db, lineAccountId);
    if (!base) return fallback('profile-form-url-missing');
    const token = await createProfileInvite(db, lineAccountId, lineUserId, {
      text: raw, schoolName: slot.schoolName, eventDate: slot.eventDate,
    });
    return handled(profileInviteMessages(slot.schoolName, `${base}?t=${token}`).map(text));
  }

  const zoom = await loadZoomSettings(db, lineAccountId);
  if (!zoom) return fallback('zoom-settings-missing');
  return handled(bookingConfirmMessages(slot, zoom).map(text));
}
