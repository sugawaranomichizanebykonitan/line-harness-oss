import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import {
  findSlotById, lectureApplicantIds, resumeLecture, shiftLectureWeek, suspendLecture,
} from '../services/wahms-lecture-ops.js';
import { lecturePostponedMessage, japaneseDate } from '../services/wahms-messages.js';

const wahms = new Hono<Env>();

type WahmsAccount = {
  id: string;
  name: string;
  channel_id: string;
};

// Apps Script の LIFF アンケート。講義名を「読み込み中」のまま保存する不具合が
// あり、2026-08-20以降の回答5件がどの講義のものか分からなくなっていた。
// 受講者ごとの案内トークンを使う自前のフォームへ切り替えたので、もう使わない。
const SURVEY_FORM_BASE_KEY = 'wahms_survey_form_url';

/** 案内トークン。URLに載るのはこれだけで、LINEのユーザーIDは出さない。 */
function inviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const TEST_RECIPIENT_PATTERN = /^U[0-9a-f]{32}$/i;

/**
 * 「テスト送信のつもりが全員配信」事故を止めるための共通判定。
 *
 * - IDを渡したのに形式が不正なら、全員配信へフォールバックせず必ず失敗させる。
 * - IDを渡していない＝一斉配信なので、呼び出し側の明示的な同意 (confirmBroadcast)
 *   が無い限り送信しない。画面のconfirmだけに頼らず、APIを直接叩かれても守る。
 */
function resolveDeliveryScope(body: { testRecipientId?: string; confirmBroadcast?: boolean }):
  | { mode: 'test'; recipientId: string }
  | { mode: 'broadcast' }
  | { mode: 'invalid'; message: string } {
  const raw = body.testRecipientId?.trim();
  if (raw) {
    if (!TEST_RECIPIENT_PATTERN.test(raw)) {
      return { mode: 'invalid', message: 'テスト送信先のLINE IDの形式が正しくありません。安全のため、一斉配信には切り替えず送信を中止しました' };
    }
    return { mode: 'test', recipientId: raw };
  }
  if (body.confirmBroadcast !== true) {
    return { mode: 'invalid', message: '一斉配信するには確認が必要です。テスト送信の場合はテスト用LINE IDを入力してください' };
  }
  return { mode: 'broadcast' };
}

function bearerToken(header: string | undefined): string | null {
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

function normalizeDate(value: string | null): string {
  if (!value) return '';
  return value.slice(0, 10).replaceAll('/', '-');
}

async function requireWahmsAccount(c: Context<Env>) {
  const accountId = c.req.query('accountId') || c.req.header('X-Line-Account-Id');
  if (!accountId) return { error: c.json({ success: false, error: 'accountId is required' }, 400) };
  const account = await c.env.DB.prepare(
    `SELECT id, name, channel_id FROM line_accounts WHERE id = ? AND is_active = 1`,
  ).bind(accountId).first<WahmsAccount>();
  if (!account || !account.name.toUpperCase().includes('WAHMS')) {
    return { error: c.json({ success: false, error: 'WAHMS account only' }, 403) };
  }
  return { account };
}

async function proxySend(
  c: Context<Env>,
  accountId: string,
  path: 'push' | 'multicast' | 'broadcast',
  payload: unknown,
  manual = false,
): Promise<Response> {
  // Calling this same Worker over HTTP creates a Cloudflare self-request loop.
  // Resolve the WAHMS channel token here and call LINE's Messaging API directly.
  const account = await c.env.DB.prepare(
    'SELECT channel_access_token FROM line_accounts WHERE id = ? AND is_active = 1',
  ).bind(accountId).first<{ channel_access_token: string | null }>();
  if (!account?.channel_access_token) {
    return new Response('WAHMSのLINE送信設定が見つかりません', { status: 500 });
  }
  return fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.channel_access_token}`,
      'Content-Type': 'application/json',
      ...(manual ? { 'X-Line-Harness-Source': 'manual' } : {}),
    },
    body: JSON.stringify(payload),
  });
}

// Existing WAHMS Apps Script sends newly written rows here. The bearer is the
// channel access token already held by that private script and is matched
// against line_accounts, preventing this public auth exception becoming an
// open write endpoint.
wahms.post('/api/wahms/sync', async (c) => {
  const token = bearerToken(c.req.header('Authorization'));
  if (!token) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const account = await c.env.DB.prepare(
    `SELECT id, name FROM line_accounts WHERE channel_access_token = ? AND is_active = 1`,
  ).bind(token).first<{ id: string; name: string }>();
  if (!account || !account.name.toUpperCase().includes('WAHMS')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const body = await c.req.json<{ type?: string; row?: Record<string, unknown> }>();
  const row = body.row || {};
  const sourceRow = Number(row.sourceRow || 0);
  const lineUserId = String(row.lineUserId || '');
  if (!sourceRow || !lineUserId) return c.json({ success: false, error: 'Invalid row' }, 400);

  if (body.type === 'participant') {
    const displayName = String(row.lineDisplayName || '') || null;
    await c.env.DB.prepare(`INSERT INTO friends (id,line_user_id,display_name,is_following,metadata,line_account_id,created_at,updated_at) VALUES (?,?,?,1,'{}',?,datetime('now'),datetime('now')) ON CONFLICT(line_user_id) DO UPDATE SET display_name=COALESCE(excluded.display_name,friends.display_name),line_account_id=COALESCE(friends.line_account_id,excluded.line_account_id),updated_at=datetime('now')`).bind(`wahms-${crypto.randomUUID()}`, lineUserId, displayName, account.id).run();
    await c.env.DB.prepare(`INSERT INTO wahms_participants (id,line_account_id,line_user_id,line_display_name,followed_at,name,occupation,gender,age_group,has_website,website_url,interests,survey_completed_at,application_count,score,status,notes,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(line_account_id,line_user_id) DO UPDATE SET line_display_name=excluded.line_display_name,followed_at=excluded.followed_at,name=excluded.name,occupation=excluded.occupation,gender=excluded.gender,age_group=excluded.age_group,has_website=excluded.has_website,website_url=excluded.website_url,interests=excluded.interests,survey_completed_at=excluded.survey_completed_at,application_count=excluded.application_count,score=excluded.score,status=excluded.status,notes=excluded.notes,source_row=excluded.source_row,updated_at=datetime('now')`).bind(
      crypto.randomUUID(), account.id, lineUserId, displayName, row.followedAt || null, row.name || null, row.occupation || null, row.gender || null, row.ageGroup || null, row.hasWebsite || null, row.websiteUrl || null, row.interests || null, row.surveyCompletedAt || null, Number(row.applicationCount || 0), Number(row.score || 0), row.status || null, row.notes || null, sourceRow,
    ).run();
  } else if (body.type === 'application') {
    await c.env.DB.prepare(`INSERT INTO wahms_applications (id,line_account_id,applied_at,line_user_id,school_name,event_date,event_time,theme,lecture_number,morning_reminder_sent,last_reminder_sent,attended,source_row) VALUES (?,?,?,?,?,?,?,?,?,0,0,NULL,?) ON CONFLICT(line_account_id,source_row) DO UPDATE SET applied_at=excluded.applied_at,line_user_id=excluded.line_user_id,school_name=excluded.school_name,event_date=excluded.event_date,event_time=excluded.event_time,theme=excluded.theme,lecture_number=excluded.lecture_number,updated_at=datetime('now')`).bind(crypto.randomUUID(), account.id, row.appliedAt || null, lineUserId, row.schoolName || '', row.eventDate || null, row.eventTime || null, row.theme || null, row.lectureNumber || null, sourceRow).run();
  } else if (body.type === 'survey') {
    const question = String(row.question || '');
    const answer = String(row.answer || '');
    const status = question ? (answer ? 'completed' : 'pending') : 'none';
    await c.env.DB.prepare(`INSERT INTO wahms_survey_responses (id,line_account_id,responded_at,line_user_id,lecture_label,school_name,satisfaction,value_rating,next_intent,question,answer,respondent_name,memo,content_number,response_status,source_row) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(line_account_id,source_row) DO UPDATE SET responded_at=excluded.responded_at,line_user_id=excluded.line_user_id,lecture_label=excluded.lecture_label,school_name=excluded.school_name,satisfaction=excluded.satisfaction,value_rating=excluded.value_rating,next_intent=excluded.next_intent,question=excluded.question,answer=COALESCE(NULLIF(excluded.answer,''),wahms_survey_responses.answer),respondent_name=COALESCE(excluded.respondent_name,wahms_survey_responses.respondent_name),response_status=CASE WHEN wahms_survey_responses.response_status='completed' THEN 'completed' ELSE excluded.response_status END,updated_at=datetime('now')`).bind(crypto.randomUUID(), account.id, row.respondedAt || null, lineUserId, row.lectureLabel || '', row.schoolName || '', Number(row.satisfaction || 0) || null, row.valueRating || null, row.nextIntent || null, question || null, answer || null, row.respondentName || null, row.memo || null, row.contentNumber || null, status, sourceRow).run();
  } else {
    return c.json({ success: false, error: 'Unknown type' }, 400);
  }
  return c.json({ success: true });
});

wahms.get('/api/wahms/overview', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  const accountId = scope.account.id;
  const school = c.req.query('school') || '';
  const search = c.req.query('search')?.trim() || '';
  const schoolClause = school ? ' AND school_name = ?' : '';
  const schoolArgs = school ? [accountId, school] : [accountId];

  const [participantCount, applicationCount, surveyStats, pendingCount, schoolRows, participants, applications, surveys, archives, logs, lectures] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM wahms_participants WHERE line_account_id = ?').bind(accountId).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM wahms_applications WHERE line_account_id = ?${schoolClause}`).bind(...schoolArgs).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count, AVG(satisfaction) AS average, SUM(CASE WHEN value_rating = '無料なのが信じられない' THEN 1 ELSE 0 END) AS unbelievable FROM wahms_survey_responses WHERE line_account_id = ?${schoolClause}`).bind(...schoolArgs).first<{ count: number; average: number | null; unbelievable: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM wahms_survey_responses WHERE line_account_id = ? AND response_status = 'pending' AND reply_skipped = 0${schoolClause}`).bind(...schoolArgs).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT school_name, MAX(event_date) AS latest_date, COUNT(*) AS application_count FROM wahms_applications WHERE line_account_id = ? GROUP BY school_name ORDER BY latest_date DESC`).bind(accountId).all(),
    c.env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM wahms_applications a WHERE a.line_account_id = p.line_account_id AND a.line_user_id = p.line_user_id) AS booking_count FROM wahms_participants p WHERE p.line_account_id = ? AND (? = '' OR p.name LIKE ? OR p.line_display_name LIKE ? OR p.occupation LIKE ?) ORDER BY p.updated_at DESC LIMIT 500`).bind(accountId, search, `%${search}%`, `%${search}%`, `%${search}%`).all(),
    c.env.DB.prepare(`SELECT a.*, COALESCE(p.name, p.line_display_name) AS participant_name FROM wahms_applications a LEFT JOIN wahms_participants p ON p.line_account_id = a.line_account_id AND p.line_user_id = a.line_user_id WHERE a.line_account_id = ?${schoolClause} ORDER BY a.event_date DESC, a.applied_at DESC LIMIT 1000`).bind(...schoolArgs).all(),
    c.env.DB.prepare(`SELECT s.* FROM wahms_survey_responses s WHERE s.line_account_id = ?${schoolClause} ORDER BY s.responded_at DESC, s.source_row DESC LIMIT 1000`).bind(...schoolArgs).all(),
    // アーカイブは参加者管理の学校プルダウンに引きずられないよう、常に全件返す。
    // アーカイブ画面側に独立した学校の絞り込みがあり、そちらで切り替える。
    c.env.DB.prepare(`SELECT * FROM wahms_archives WHERE line_account_id = ? ORDER BY school_name, CAST(lecture_number AS REAL), source_row LIMIT 1000`).bind(accountId).all(),
    c.env.DB.prepare(`SELECT * FROM wahms_delivery_logs WHERE line_account_id = ? ORDER BY created_at DESC LIMIT 30`).bind(accountId).all(),
    // 開催予定。申込が1件も無い日でも、何時に何をやるのかを画面に出すため。
    // starts_at はUTCなので、+9時間してJSTの日付と時刻に直して返す。
    // 受付を止めた回 (延期・休講) も返す。画面から再開できないと、
    // 止めたあと私に頼まないと戻せなくなる。
    c.env.DB.prepare(
      `SELECT s.id AS slot_id,
              e.name AS school_name,
              DATE(s.starts_at, '+9 hours') AS event_date,
              TIME(s.starts_at, '+9 hours') AS start_time,
              TIME(s.ends_at, '+9 hours') AS end_time,
              s.sequence_label AS lecture_label,
              s.title AS theme,
              s.is_active AS is_active
         FROM event_slots s
         JOIN events e ON e.id = s.event_id
        WHERE e.line_account_id = ? AND s.deleted_at IS NULL
        ORDER BY s.starts_at`,
    ).bind(accountId).all(),
  ]);

  const count = Number(surveyStats?.count || 0);
  return c.json({ success: true, data: {
    account: scope.account,
    summary: {
      participants: Number(participantCount?.count || 0),
      applications: Number(applicationCount?.count || 0),
      surveyResponses: count,
      averageSatisfaction: surveyStats?.average == null ? null : Number(surveyStats.average),
      unbelievableRate: count ? Number(surveyStats?.unbelievable || 0) / count * 100 : 0,
      pendingQuestions: Number(pendingCount?.count || 0),
    },
    schools: schoolRows.results,
    participants: participants.results,
    applications: applications.results,
    surveys: surveys.results,
    archives: archives.results,
    deliveryLogs: logs.results,
    lectures: lectures.results,
  }});
});

wahms.post('/api/wahms/surveys/:id/reply', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  const body = await c.req.json<{ answer?: string }>();
  const answer = body.answer?.trim();
  if (!answer) return c.json({ success: false, error: '返信内容を入力してください' }, 400);
  const survey = await c.env.DB.prepare(
    'SELECT id, line_user_id, question FROM wahms_survey_responses WHERE id = ? AND line_account_id = ?',
  ).bind(c.req.param('id'), scope.account.id).first<{ id: string; line_user_id: string; question: string | null }>();
  if (!survey) return c.json({ success: false, error: '回答が見つかりません' }, 404);
  // Web版アンケート (LINE未登録の受講者) は送信先が無い。LINE送信を試みても
  // 必ず失敗するので、理由が分かる形で止める。
  if (survey.line_user_id.startsWith('web-')) {
    return c.json(
      { success: false, error: 'Web回答のため、LINEで返信できません。別の手段でご連絡ください' },
      400,
    );
  }

  const message = survey.question
    ? `青山さんへのご質問に回答します。\n\n【ご質問】\n${survey.question}\n\n【回答】\n${answer}`
    : answer;
  const sent = await proxySend(c, scope.account.id, 'push', {
    to: survey.line_user_id,
    messages: [{ type: 'text', text: message }],
  }, true);
  if (!sent.ok) return c.json({ success: false, error: 'LINEへの返信に失敗しました' }, 502);

  const staff = c.get('staff');
  await c.env.DB.prepare(
    `UPDATE wahms_survey_responses SET answer = ?, response_status = 'completed', answered_at = datetime('now'), answered_by = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(answer, staff?.name || '担当者', survey.id).run();
  return c.json({ success: true, data: { id: survey.id, status: 'completed' } });
});

/**
 * 「返信対応しない」。返信するほどでもない質問を要対応リストから外す。
 *
 * 回答そのものは消さない。集計には残したまま、対応の要否だけを落とす。
 * LINEへは何も送らない (送らないことが目的の操作なので)。
 */
wahms.post('/api/wahms/surveys/:id/skip', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  const survey = await c.env.DB.prepare(
    'SELECT id, response_status FROM wahms_survey_responses WHERE id = ? AND line_account_id = ?',
  ).bind(c.req.param('id'), scope.account.id).first<{ id: string; response_status: string }>();
  if (!survey) return c.json({ success: false, error: '回答が見つかりません' }, 404);
  // 返信済みを取り消す操作ではない。履歴を消さないよう手前で止める。
  if (survey.response_status === 'completed') {
    return c.json({ success: false, error: 'すでに返信済みのため変更できません' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE wahms_survey_responses SET reply_skipped = 1, updated_at = datetime('now') WHERE id = ?`,
  ).bind(survey.id).run();
  return c.json({ success: true, data: { id: survey.id, replySkipped: true } });
});

wahms.post('/api/wahms/survey-deliveries', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  const body = await c.req.json<{ schoolName?: string; eventDate?: string; testRecipientId?: string; confirmBroadcast?: boolean }>();
  const scopeMode = resolveDeliveryScope(body);
  if (scopeMode.mode === 'invalid') return c.json({ success: false, error: scopeMode.message }, 400);
  const schoolName = body.schoolName?.trim();
  const eventDate = normalizeDate(body.eventDate || '');
  if (!schoolName || !eventDate) return c.json({ success: false, error: '学校と開催日を選択してください' }, 400);
  const targets = await c.env.DB.prepare(
    `SELECT DISTINCT line_user_id FROM wahms_applications WHERE line_account_id = ? AND school_name = ? AND REPLACE(SUBSTR(event_date, 1, 10), '/', '-') = ?`,
  ).bind(scope.account.id, schoolName, eventDate).all<{ line_user_id: string }>();
  const ids = scopeMode.mode === 'test'
    ? [scopeMode.recipientId]
    : (targets.results || []).map((row) => row.line_user_id).filter(Boolean);
  if (!ids.length) return c.json({ success: false, error: 'この講義の申込者が見つかりません' }, 400);

  const base = await c.env.DB
    .prepare(`SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?`)
    .bind(scope.account.id, SURVEY_FORM_BASE_KEY)
    .first<{ value: string }>();
  if (!base?.value) {
    return c.json({ success: false, error: 'アンケートフォームのURLが未設定です' }, 400);
  }

  // 受講者ごとに使い捨ての案内を作る。誰がどの講義に答えたかが確定するので、
  // 講義名の取り違えが起きず、質問への1対1返信もそのまま使える。
  let success = 0;
  let failure = 0;
  for (const lineUserId of ids) {
    const token = inviteToken();
    await c.env.DB.prepare(
      `INSERT INTO wahms_survey_invites (token, line_account_id, line_user_id, school_name, event_date) VALUES (?, ?, ?, ?, ?)`,
    ).bind(token, scope.account.id, lineUserId, schoolName, eventDate).run();
    const text = `【 ${schoolName}】\nご参加いただき、ありがとうございます。\n講義アンケートのご協力をお願いします。\n\n回答目安：60〜90秒\n\n${base.value}?t=${token}`;
    const response = await proxySend(c, scope.account.id, 'push', { to: lineUserId, messages: [{ type: 'text', text }] });
    if (response.ok) success += 1;
    else failure += 1;
  }
  await c.env.DB.prepare(`INSERT INTO wahms_delivery_logs (id, line_account_id, delivery_type, title, target_count, success_count, failure_count, created_by) VALUES (?, ?, 'survey', ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), scope.account.id, `${schoolName} ${eventDate}`, ids.length, success, failure, c.get('staff')?.name || '担当者').run();
  return c.json({ success: failure === 0, data: { targetCount: ids.length, success, failure } });
});

wahms.post('/api/wahms/flex-deliveries', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  const body = await c.req.json<{ altText?: string; contents?: unknown; testRecipientId?: string; confirmBroadcast?: boolean }>();
  if (!body.altText?.trim() || !body.contents || typeof body.contents !== 'object') {
    return c.json({ success: false, error: '代替テキストとFlex JSONを入力してください' }, 400);
  }
  const scopeMode = resolveDeliveryScope(body);
  if (scopeMode.mode === 'invalid') return c.json({ success: false, error: scopeMode.message }, 400);
  // Flex Simulatorの「contents」だけでなく、LINE Messaging API用の
  // { type: 'flex', altText, contents } 全体を貼り付けても配信できる。
  const candidate = body.contents as { type?: string; altText?: string; contents?: unknown };
  const flexContents = candidate.type === 'flex' && candidate.contents ? candidate.contents : body.contents;
  const altText = candidate.type === 'flex' && candidate.altText ? candidate.altText : body.altText.trim();
  const testRecipientId = scopeMode.mode === 'test' ? scopeMode.recipientId : null;
  const response = await proxySend(c, scope.account.id, testRecipientId ? 'push' : 'broadcast', testRecipientId ? {
    to: testRecipientId,
    messages: [{ type: 'flex', altText, contents: flexContents }],
  } : {
    messages: [{ type: 'flex', altText, contents: flexContents }],
  });
  const upstreamDetail = response.ok ? '' : (await response.text()).slice(0, 300);
  await c.env.DB.prepare(`INSERT INTO wahms_delivery_logs (id, line_account_id, delivery_type, title, target_count, success_count, failure_count, created_by) VALUES (?, ?, 'flex', ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), scope.account.id, altText, testRecipientId ? 1 : 0, response.ok ? 1 : 0, response.ok ? 0 : 1, c.get('staff')?.name || '担当者').run();
  if (!response.ok) return c.json({ success: false, error: `Flex配信に失敗しました${upstreamDetail ? `: ${upstreamDetail}` : ''}` }, 502);
  return c.json({ success: true, data: { sent: true } });
});

wahms.post('/api/wahms/archives', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  const body = await c.req.json<{ schoolName?: string; lectureNumber?: string; theme?: string; heldOn?: string; youtubeUrl?: string }>();
  const schoolName = body.schoolName?.trim();
  if (!schoolName) return c.json({ success: false, error: '学校名は必須です' }, 400);

  // 各学校の第1〜20回は移行時に枠だけ作られており、未実施の回は日付も動画も
  // 空のまま入っている。同じ回をもう一度「追加」すると重複行になり、LINEへ
  // 出す一覧が二重になるので、既存の枠があれば上書きする。
  //
  // lecture_number は移行元の都合で '13' と '13.0' が混在しうるため、
  // 数値として比較する。
  const lectureNumber = body.lectureNumber?.trim() || null;
  const existing = lectureNumber
    ? await c.env.DB.prepare(
        `SELECT id FROM wahms_archives
          WHERE line_account_id = ? AND school_name = ?
            AND CAST(lecture_number AS REAL) = CAST(? AS REAL)
          ORDER BY source_row LIMIT 1`,
      ).bind(scope.account.id, schoolName, lectureNumber).first<{ id: string }>()
    : null;

  if (existing) {
    // テーマは入力があるときだけ上書きする。青山塾のようにテーマなし運用の
    // 学校で、既存のテーマを空で潰さないため。
    await c.env.DB.prepare(
      `UPDATE wahms_archives
          SET theme = COALESCE(NULLIF(?, ''), theme),
              held_on = ?,
              youtube_url = ?,
              updated_at = datetime('now')
        WHERE id = ? AND line_account_id = ?`,
    ).bind(body.theme || '', body.heldOn || null, body.youtubeUrl || null, existing.id, scope.account.id).run();
    return c.json({ success: true, data: { id: existing.id, updated: true } });
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO wahms_archives (id, line_account_id, school_name, lecture_number, theme, held_on, youtube_url) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, scope.account.id, schoolName, lectureNumber, body.theme || null, body.heldOn || null, body.youtubeUrl || null).run();
  return c.json({ success: true, data: { id, updated: false } }, 201);
});

wahms.delete('/api/wahms/archives/:id', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  await c.env.DB.prepare('DELETE FROM wahms_archives WHERE id = ? AND line_account_id = ?').bind(c.req.param('id'), scope.account.id).run();
  return c.json({ success: true, data: null });
});

// ─── 開催予定の操作 ───────────────────────────────────────────────
// 延期・休講・繰越。2026年8月に2週続けて起き、そのたびに手作業でDBを
// 直していた。手順を間違えると、延期したのに Zoom 案内が飛ぶ。

/** 操作の結果を、画面にそのまま出せる日本語にする。 */
function lectureLabelOf(slot: { schoolName: string; eventDate: string; lectureLabel: string | null }): string {
  return `${slot.schoolName} ${slot.lectureLabel ?? ''}（${japaneseDate(slot.eventDate)}）`.replace('  ', ' ');
}

wahms.post('/api/wahms/lectures/:slotId/suspend', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  const result = await suspendLecture(c.env.DB, scope.account.id, c.req.param('slotId'));
  if (!result) return c.json({ success: false, error: 'この開催予定が見つかりません' }, 404);
  return c.json({
    success: true,
    data: {
      lecture: lectureLabelOf(result.slot),
      applicants: result.applicants,
      remindersStopped: result.remindersStopped,
    },
  });
});

wahms.post('/api/wahms/lectures/:slotId/resume', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  const result = await resumeLecture(c.env.DB, scope.account.id, c.req.param('slotId'));
  if (!result) return c.json({ success: false, error: 'この開催予定が見つかりません' }, 404);
  return c.json({
    success: true,
    data: { lecture: lectureLabelOf(result.slot), remindersRearmed: result.remindersRearmed },
  });
});

wahms.post('/api/wahms/lectures/:slotId/shift-week', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  // direction=back は押し間違いを1週間ぶん戻すためのもの。
  const direction = c.req.query('direction') === 'back' ? 'back' : 'forward';
  const result = await shiftLectureWeek(c.env.DB, scope.account.id, c.req.param('slotId'), direction);
  if (!result) return c.json({ success: false, error: 'この開催予定が見つかりません' }, 404);
  if ('refused' in result) return c.json({ success: false, error: result.refused }, 400);
  return c.json({
    success: true,
    data: {
      lecture: lectureLabelOf(result.slot),
      newDate: result.newDate,
      shiftedSlots: result.shiftedSlots,
      movedApplications: result.movedApplications,
      direction,
    },
  });
});

/**
 * 延期のお知らせを、その回の申込者へ送る。
 *
 * 一斉配信と同じ扱いにして、確認なしでは飛ばない。申込者はすでに開催日の
 * 朝に Zoom 案内を受け取っていることが多く、知らせないと当日 Zoom に来る。
 */
wahms.post('/api/wahms/lectures/:slotId/notify-postponed', async (c) => {
  const scope = await requireWahmsAccount(c);
  if ('error' in scope) return scope.error;
  const body = await c.req.json<{ testRecipientId?: string; confirmBroadcast?: boolean }>().catch(() => ({}));
  const scopeMode = resolveDeliveryScope(body);
  if (scopeMode.mode === 'invalid') return c.json({ success: false, error: scopeMode.message }, 400);

  const slot = await findSlotById(c.env.DB, scope.account.id, c.req.param('slotId'));
  if (!slot) return c.json({ success: false, error: 'この開催予定が見つかりません' }, 404);

  const ids = scopeMode.mode === 'test'
    ? [scopeMode.recipientId]
    : await lectureApplicantIds(c.env.DB, scope.account.id, slot);
  if (!ids.length) return c.json({ success: false, error: 'この講義の申込者が見つかりません' }, 400);

  const text = lecturePostponedMessage(
    slot.schoolName,
    japaneseDate(slot.eventDate),
    `${slot.startTime}〜${slot.endTime}`,
  );

  let success = 0;
  let failure = 0;
  for (const lineUserId of ids) {
    const response = await proxySend(c, scope.account.id, 'push', {
      to: lineUserId, messages: [{ type: 'text', text }],
    }, true);
    if (response.ok) success += 1; else failure += 1;
  }
  await c.env.DB.prepare(
    `INSERT INTO wahms_delivery_logs (id, line_account_id, delivery_type, title, target_count, success_count, failure_count, created_by)
     VALUES (?, ?, 'flex', ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), scope.account.id, `延期のお知らせ ${lectureLabelOf(slot)}`,
    ids.length, success, failure, c.get('staff')?.name || '担当者',
  ).run();

  return c.json({ success: failure === 0, data: { targetCount: ids.length, success, failure, text } });
});

export { wahms };
