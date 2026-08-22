import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';

const wahms = new Hono<Env>();

type WahmsAccount = {
  id: string;
  name: string;
  channel_id: string;
};

const SURVEY_LIFF_URL = 'https://liff.line.me/2010052458-oPl4GiQQ';

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

function schoolKey(schoolName: string, eventDate: string): string {
  const date = new Date(`${normalizeDate(eventDate)}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return schoolName;
  const plainName = schoolName.replace(/^\S+\s*/, '').trim();
  return `${date.getMonth() + 1}月${date.getDate()}日${plainName}に申し込む`;
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

  const [participantCount, applicationCount, surveyStats, pendingCount, schoolRows, participants, applications, surveys, archives, logs] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM wahms_participants WHERE line_account_id = ?').bind(accountId).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM wahms_applications WHERE line_account_id = ?${schoolClause}`).bind(...schoolArgs).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count, AVG(satisfaction) AS average, SUM(CASE WHEN value_rating = '無料なのが信じられない' THEN 1 ELSE 0 END) AS unbelievable FROM wahms_survey_responses WHERE line_account_id = ?${schoolClause}`).bind(...schoolArgs).first<{ count: number; average: number | null; unbelievable: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM wahms_survey_responses WHERE line_account_id = ? AND response_status = 'pending'${schoolClause}`).bind(...schoolArgs).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT school_name, MAX(event_date) AS latest_date, COUNT(*) AS application_count FROM wahms_applications WHERE line_account_id = ? GROUP BY school_name ORDER BY latest_date DESC`).bind(accountId).all(),
    c.env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM wahms_applications a WHERE a.line_account_id = p.line_account_id AND a.line_user_id = p.line_user_id) AS booking_count FROM wahms_participants p WHERE p.line_account_id = ? AND (? = '' OR p.name LIKE ? OR p.line_display_name LIKE ? OR p.occupation LIKE ?) ORDER BY p.updated_at DESC LIMIT 500`).bind(accountId, search, `%${search}%`, `%${search}%`, `%${search}%`).all(),
    c.env.DB.prepare(`SELECT a.*, COALESCE(p.name, p.line_display_name) AS participant_name FROM wahms_applications a LEFT JOIN wahms_participants p ON p.line_account_id = a.line_account_id AND p.line_user_id = a.line_user_id WHERE a.line_account_id = ?${schoolClause} ORDER BY a.event_date DESC, a.applied_at DESC LIMIT 1000`).bind(...schoolArgs).all(),
    c.env.DB.prepare(`SELECT s.* FROM wahms_survey_responses s WHERE s.line_account_id = ?${schoolClause} ORDER BY s.responded_at DESC, s.source_row DESC LIMIT 1000`).bind(...schoolArgs).all(),
    // アーカイブは参加者管理の学校プルダウンに引きずられないよう、常に全件返す。
    // アーカイブ画面側に独立した学校の絞り込みがあり、そちらで切り替える。
    c.env.DB.prepare(`SELECT * FROM wahms_archives WHERE line_account_id = ? ORDER BY school_name, CAST(lecture_number AS REAL), source_row LIMIT 1000`).bind(accountId).all(),
    c.env.DB.prepare(`SELECT * FROM wahms_delivery_logs WHERE line_account_id = ? ORDER BY created_at DESC LIMIT 30`).bind(accountId).all(),
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

  const key = schoolKey(schoolName, eventDate);
  const text = `【 ${schoolName}】\nご参加いただき、ありがとうございます。\n講義アンケートのご協力をお願いします。\n\n回答目安：60〜90秒\n\n${SURVEY_LIFF_URL}?s=${encodeURIComponent(key)}`;
  let success = 0;
  let failure = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const response = await proxySend(c, scope.account.id, 'multicast', { to: chunk, messages: [{ type: 'text', text }] });
    if (response.ok) success += chunk.length;
    else failure += chunk.length;
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

export { wahms };
