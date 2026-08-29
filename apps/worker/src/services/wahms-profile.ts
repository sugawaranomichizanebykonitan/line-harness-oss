/**
 * 初回プロフィールアンケート。
 *
 * Apps Script では LIFF (LINEログイン必須) で聞き、回答はスプレッドシートへ
 * 書いていた。Worker が申込を最後まで引き取るには同じ導線が要る。
 *
 * 講義アンケートと同じく使い捨てトークン方式にする。LINEログインを挟まない
 * ぶん確実で、URLにユーザーIDが出ない。
 */

/** 設問の選択肢。既存データから割り出した、LIFF版とまったく同じ並び。 */
export const OCCUPATIONS = ['経営者', '個人事業主', '会社員', '学生', '接客業', '主婦・子育て', 'その他'];
export const GENDERS = ['男性', '女性'];
export const AGE_GROUPS = ['10代', '20代', '30代', '40代', '50代', '60代', '70代以上'];
export const HAS_SITE = ['あり', 'なし'];
export const INTERESTS = ['マーケティング', '青山塾', 'WEB', 'セールス', 'マネジメント', '人間力'];

export type ProfileInvite = {
  token: string;
  lineAccountId: string;
  lineUserId: string;
  bookingText: string | null;
  schoolName: string | null;
  eventDate: string | null;
  usedAt: string | null;
};

/** URLに載せる文字列。推測されないよう乱数から作る。 */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createProfileInvite(
  db: D1Database,
  lineAccountId: string,
  lineUserId: string,
  booking: { text: string; schoolName: string; eventDate: string } | null,
): Promise<string> {
  const token = newInviteToken();
  await db
    .prepare(
      `INSERT INTO wahms_profile_invites
         (token, line_account_id, line_user_id, booking_text, school_name, event_date)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(token, lineAccountId, lineUserId, booking?.text ?? null, booking?.schoolName ?? null, booking?.eventDate ?? null)
    .run();
  return token;
}

export async function findProfileInvite(db: D1Database, token: string): Promise<ProfileInvite | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return db
    .prepare(
      `SELECT token, line_account_id AS lineAccountId, line_user_id AS lineUserId,
              booking_text AS bookingText, school_name AS schoolName,
              event_date AS eventDate, used_at AS usedAt
         FROM wahms_profile_invites WHERE token = ?`,
    )
    .bind(token)
    .first<ProfileInvite>();
}

export type ProfileAnswers = {
  realName: string;
  occupation: string;
  gender: string | null;
  ageGroup: string | null;
  hasSite: string | null;
  siteUrl: string | null;
  interests: string[];
};

/**
 * 回答を登録者マスターへ書く。Apps Script の updateUserProfile と同じ列。
 *
 * 参加者行が無いことは通常ないが (友だち追加時に作る)、取りこぼしても
 * 回答を捨てないよう、無ければここで作る。
 */
export async function saveProfile(
  db: D1Database,
  lineAccountId: string,
  lineUserId: string,
  answers: ProfileAnswers,
): Promise<void> {
  const existing = await db
    .prepare(`SELECT id FROM wahms_participants WHERE line_account_id = ? AND line_user_id = ? LIMIT 1`)
    .bind(lineAccountId, lineUserId)
    .first<{ id: string }>();

  const interests = answers.interests.join(',');
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO wahms_participants
           (id, line_account_id, line_user_id, name, occupation, gender, age_group,
            has_website, website_url, interests, survey_completed_at,
            application_count, score, status, source_row)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+9 hours'), 0, 0, '有効', NULL)`,
      )
      .bind(
        crypto.randomUUID(), lineAccountId, lineUserId,
        answers.realName, answers.occupation, answers.gender, answers.ageGroup,
        answers.hasSite, answers.siteUrl, interests,
      )
      .run();
    return;
  }

  await db
    .prepare(
      `UPDATE wahms_participants
          SET name = ?, occupation = ?, gender = ?, age_group = ?,
              has_website = ?, website_url = ?, interests = ?,
              survey_completed_at = datetime('now', '+9 hours'),
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(
      answers.realName, answers.occupation, answers.gender, answers.ageGroup,
      answers.hasSite, answers.siteUrl, interests, existing.id,
    )
    .run();
}

/** 回答済みかどうか。申込を即確定してよい相手かの判定に使う。 */
export async function hasCompletedProfile(
  db: D1Database,
  lineAccountId: string,
  lineUserId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM wahms_participants
        WHERE line_account_id = ? AND line_user_id = ?
          AND survey_completed_at IS NOT NULL AND survey_completed_at <> ''`,
    )
    .bind(lineAccountId, lineUserId)
    .first<{ ok: number }>();
  return Boolean(row);
}
