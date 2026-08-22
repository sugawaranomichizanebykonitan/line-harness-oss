import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * LINE登録なしで回答できる講義アンケート。
 *
 * 既存のアンケートは LIFF なので LINE ログインが必須で、紹介で直接参加した
 * 受講者が回答できなかった。回答先を分けると管理画面の集計に乗らないため、
 * LINE版と同じ wahms_survey_responses に入れる。
 *
 * line_user_id は NOT NULL なので、Web回答は 'web-<uuid>' を入れて区別する。
 * source_row はスプレッドシート由来の列なので NULL のまま (SQLite の UNIQUE は
 * NULL を重複扱いしないので、Web回答が何件あっても衝突しない)。
 */

const publicSurvey = new Hono<Env>();

/** 設問と選択肢は既存のLINE版に合わせている。実データから割り出した。 */
const VALUE_RATINGS = ['無料なのが信じられない', 'とても価値あり', '価値あり', 'まあ価値があるかな', '価値なし'];
const NEXT_INTENTS = ['必ず参加したい', '是非参加したい', 'できれば参加したい', '分からない', '参加しない'];

const WAHMS_ADD_FRIEND_URL = 'https://line.me/R/ti/p/@393ixqsd';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Lecture = { schoolName: string; eventDate: string; theme: string | null };

/**
 * 「その日に開催された講義」を返す。運営が講義ごとにURLを作り分けなくて済むよう、
 * 学校だけをURLに載せ、日付はサーバ側で当日のものを引く。
 */
async function findLecture(
  db: D1Database,
  lineAccountId: string,
  school: string,
): Promise<Lecture | null> {
  return db
    .prepare(
      `SELECT school_name AS schoolName,
              SUBSTR(REPLACE(event_date, '/', '-'), 1, 10) AS eventDate,
              theme
         FROM wahms_applications
        WHERE line_account_id = ?
          AND school_name LIKE '%' || ? || '%'
        ORDER BY ABS(julianday(SUBSTR(REPLACE(event_date, '/', '-'), 1, 10))
                     - julianday(date('now', '+9 hours')))
        LIMIT 1`,
    )
    .bind(lineAccountId, school)
    .first<Lecture>();
}

async function wahmsAccountId(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(`SELECT id FROM line_accounts WHERE is_active = 1 AND UPPER(name) LIKE '%WAHMS%' LIMIT 1`)
    .first<{ id: string }>();
  return row?.id ?? null;
}

function page(body: string): string {
  return `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>講義アンケート | WAHMS</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:24px 16px 64px;background:#f5f6f8;color:#1f2937;
     font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif;line-height:1.7}
.wrap{max-width:560px;margin:0 auto}
.card{background:#fff;border-radius:16px;padding:24px 20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#6b7280;font-size:14px;margin:0 0 20px}
.q{margin:26px 0 10px;font-weight:700;font-size:15px}
.req{color:#dc2626;font-size:12px;margin-left:6px}
input[type=text],textarea{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px;font-family:inherit}
textarea{min-height:110px;resize:vertical}
.opts{display:flex;flex-direction:column;gap:8px}
.opt{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #d1d5db;
     border-radius:10px;cursor:pointer;background:#fff;font-size:15px}
.opt:has(input:checked){border-color:#16a34a;background:#f0fdf4;font-weight:700}
.opt input{width:20px;height:20px;accent-color:#16a34a;margin:0}
.stars{display:flex;gap:8px}
.star{flex:1;text-align:center;padding:14px 0;border:1px solid #d1d5db;border-radius:10px;cursor:pointer;font-size:15px;background:#fff}
.star:has(input:checked){border-color:#16a34a;background:#f0fdf4;font-weight:700;color:#15803d}
.star input{display:none}
button{width:100%;margin-top:28px;padding:16px;border:0;border-radius:12px;background:#16a34a;
       color:#fff;font-size:17px;font-weight:700;cursor:pointer}
button:disabled{background:#9ca3af}
.err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:12px;border-radius:10px;margin-bottom:16px;font-size:14px}
.done{text-align:center}
.done h1{font-size:22px;margin-bottom:12px}
.line-btn{display:block;margin-top:24px;padding:16px;border-radius:12px;background:#06C755;
          color:#fff;text-decoration:none;font-weight:700;text-align:center}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

/** 回答フォーム。LINEアプリの外、普通のブラウザで開ける。 */
publicSurvey.get('/wahms/survey', async (c) => {
  const school = c.req.query('school')?.trim() || c.req.query('s')?.trim() || '';
  const accountId = await wahmsAccountId(c.env.DB);
  if (!accountId) return c.html(page(`<div class="card"><h1>アンケートを表示できません</h1><p class="sub">運営までお問い合わせください。</p></div>`), 500);

  const lecture = school ? await findLecture(c.env.DB, accountId, school) : null;
  if (!lecture) {
    return c.html(
      page(`<div class="card"><h1>講義が見つかりません</h1>
        <p class="sub">お渡ししたURLをもう一度ご確認ください。</p></div>`),
      404,
    );
  }

  const opts = (name: string, values: string[]) =>
    `<div class="opts">${values
      .map((v) => `<label class="opt"><input type="radio" name="${name}" value="${escapeHtml(v)}" required><span>${escapeHtml(v)}</span></label>`)
      .join('')}</div>`;

  return c.html(page(`<div class="card">
  <h1>講義アンケート</h1>
  <p class="sub">${escapeHtml(lecture.schoolName)}<br>${escapeHtml(lecture.eventDate)}${lecture.theme ? `<br>${escapeHtml(lecture.theme)}` : ''}</p>
  <div id="err"></div>
  <form id="f">
    <input type="hidden" name="school" value="${escapeHtml(lecture.schoolName)}">
    <input type="hidden" name="eventDate" value="${escapeHtml(lecture.eventDate)}">

    <p class="q">お名前<span class="req">必須</span></p>
    <input type="text" name="name" required maxlength="60" placeholder="山田 太郎">

    <p class="q">本日の講義の満足度<span class="req">必須</span></p>
    <div class="stars">${[1, 2, 3, 4, 5]
      .map((n) => `<label class="star"><input type="radio" name="satisfaction" value="${n}" required>${n}</label>`)
      .join('')}</div>

    <p class="q">この講義の価値をどう感じましたか<span class="req">必須</span></p>
    ${opts('valueRating', VALUE_RATINGS)}

    <p class="q">次回も参加したいですか<span class="req">必須</span></p>
    ${opts('nextIntent', NEXT_INTENTS)}

    <p class="q">青山さんへのご質問（任意）</p>
    <textarea name="question" maxlength="2000" placeholder="ご質問があればご記入ください"></textarea>

    <button type="submit" id="b">回答を送信する</button>
  </form>
</div>
<script>
const f=document.getElementById('f'),b=document.getElementById('b'),e=document.getElementById('err');
f.addEventListener('submit',async(ev)=>{
  ev.preventDefault();b.disabled=true;b.textContent='送信中...';e.innerHTML='';
  const d=Object.fromEntries(new FormData(f).entries());
  try{
    const r=await fetch('/api/public/wahms-survey',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    const j=await r.json();
    if(!j.success)throw new Error(j.error||'送信できませんでした');
    location.href='/wahms/survey/thanks';
  }catch(err){
    e.innerHTML='<div class="err">'+(err.message||'送信できませんでした')+'</div>';
    b.disabled=false;b.textContent='回答を送信する';
    window.scrollTo(0,0);
  }
});
</script>`));
});

/** 送信後の画面。ここを公式LINEへの入口にする。 */
publicSurvey.get('/wahms/survey/thanks', (c) =>
  c.html(page(`<div class="card done">
  <h1>ご回答ありがとうございました</h1>
  <p class="sub">いただいたご意見は、今後の講義づくりに活かしてまいります。</p>
  <p style="font-size:14px;color:#374151;margin-top:24px">
    今後の講義のご案内、アーカイブ動画の視聴は<br>公式LINEからご利用いただけます。
  </p>
  <a class="line-btn" href="${WAHMS_ADD_FRIEND_URL}">公式LINEを友だち追加する</a>
</div>`)),
);

publicSurvey.post('/api/public/wahms-survey', async (c) => {
  type SurveyBody = {
    school?: string; eventDate?: string; name?: string;
    satisfaction?: string; valueRating?: string; nextIntent?: string; question?: string;
  };
  const body: SurveyBody = await c.req.json<SurveyBody>().catch(() => ({} as SurveyBody));

  const school = body.school?.trim();
  const eventDate = body.eventDate?.trim();
  const name = body.name?.trim();
  const satisfaction = Number(body.satisfaction);

  if (!school || !eventDate) return c.json({ success: false, error: '講義を特定できませんでした' }, 400);
  if (!name) return c.json({ success: false, error: 'お名前をご記入ください' }, 400);
  if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
    return c.json({ success: false, error: '満足度をお選びください' }, 400);
  }
  // 選択肢は画面から来るが、直接POSTされても想定外の値を保存しない。
  if (!body.valueRating || !VALUE_RATINGS.includes(body.valueRating)) {
    return c.json({ success: false, error: '価値の評価をお選びください' }, 400);
  }
  if (!body.nextIntent || !NEXT_INTENTS.includes(body.nextIntent)) {
    return c.json({ success: false, error: '次回の参加意向をお選びください' }, 400);
  }

  const accountId = await wahmsAccountId(c.env.DB);
  if (!accountId) return c.json({ success: false, error: '送信できませんでした' }, 500);

  // 実在する講義かを確認する。任意の学校名を投げ込まれても保存しない。
  const lecture = await findLecture(c.env.DB, accountId, school.replace(/^\S+\s*/, '').trim() || school);
  if (!lecture) return c.json({ success: false, error: '講義を特定できませんでした' }, 400);

  const question = body.question?.trim() || null;
  await c.env.DB.prepare(
    `INSERT INTO wahms_survey_responses
       (id, line_account_id, responded_at, line_user_id, lecture_label, school_name,
        satisfaction, value_rating, next_intent, question, respondent_name, response_status, source_row)
     VALUES (?, ?, datetime('now', '+9 hours'), ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).bind(
    crypto.randomUUID(),
    accountId,
    `web-${crypto.randomUUID()}`,
    `${lecture.schoolName}_${lecture.eventDate}`,
    lecture.schoolName,
    satisfaction,
    body.valueRating,
    body.nextIntent,
    question,
    name,
    question ? 'pending' : 'none',
  ).run();

  return c.json({ success: true });
});

export { publicSurvey };
