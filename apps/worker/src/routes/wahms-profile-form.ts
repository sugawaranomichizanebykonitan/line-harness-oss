import { Hono } from 'hono';
import type { Context } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import type { Env } from '../index.js';
import {
  AGE_GROUPS, GENDERS, HAS_SITE, INTERESTS, OCCUPATIONS,
  findProfileInvite, saveProfile,
} from '../services/wahms-profile.js';
import { bookingConfirmMessages, loadZoomSettings, japaneseDate } from '../services/wahms-messages.js';
import { findLectureSlot, parseBookingRequest } from '../services/wahms-booking.js';

/**
 * 初回プロフィールアンケート。
 *
 * これまでは LIFF (LINEログインが要る画面) で聞いており、回答は Apps Script が
 * スプレッドシートへ書いていた。ここは同じ設問を、LINEログイン無しで開ける
 * 普通のWebページとして出す。回答が終わると保留していた申込が確定する。
 *
 * URLに載るのは使い捨てのトークンだけ。LINEのユーザーIDは出さない。
 */

const profileForm = new Hono<Env>();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(body: string): string {
  return `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>はじめてのご登録 | WAHMS</title>
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
.opt-note{color:#6b7280;font-size:12px;margin-left:6px;font-weight:400}
input[type=text],input[type=url]{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px;font-family:inherit}
.opts{display:flex;flex-direction:column;gap:8px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.opt{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #d1d5db;
     border-radius:10px;cursor:pointer;background:#fff;font-size:15px}
.opt:has(input:checked){border-color:#16a34a;background:#f0fdf4;font-weight:700}
.opt input{width:20px;height:20px;accent-color:#16a34a;margin:0}
button{width:100%;margin-top:28px;padding:16px;border:0;border-radius:12px;background:#16a34a;
       color:#fff;font-size:17px;font-weight:700;cursor:pointer}
button:disabled{background:#9ca3af}
.err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:12px;border-radius:10px;margin-bottom:16px;font-size:14px}
.done{text-align:center}
.done h1{font-size:22px;margin-bottom:12px}
.hide{display:none}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

const notice = (title: string, body: string, status: 404 | 500) => (c: Context<Env>) =>
  c.html(page(`<div class="card"><h1>${title}</h1><p class="sub">${body}</p></div>`), status);

const thanksHandler = (c: Context<Env>) =>
  c.html(page(`<div class="card done">
  <h1>ご登録ありがとうございました</h1>
  <p class="sub">お申し込みが確定しました。</p>
  <p style="font-size:14px;color:#374151;margin-top:20px">
    参加用のZoom URLは、公式LINEにお送りしています。<br>
    開催日の朝にもあらためてご案内します。
  </p>
  <p style="font-size:14px;color:#374151;margin-top:20px">LINEに戻ってご確認ください。</p>
</div>`));

const formHandler = (basePath: string) => async (c: Context<Env>) => {
  const token = c.req.query('t')?.trim() || '';
  const invite = token ? await findProfileInvite(c.env.DB, token) : null;
  if (!invite) {
    return notice('この案内は使えません', 'お手数ですが、公式LINEのメニューからもう一度お申し込みください。', 404)(c);
  }
  if (invite.usedAt) {
    return notice('ご登録はお済みです', 'このアンケートは回答済みです。お申し込みは確定しています。', 404)(c);
  }

  const radios = (name: string, values: readonly string[], required: boolean, grid = false) =>
    `<div class="${grid ? 'grid' : 'opts'}">${values
      .map((v) => `<label class="opt"><input type="radio" name="${name}" value="${escapeHtml(v)}"${required ? ' required' : ''}><span>${escapeHtml(v)}</span></label>`)
      .join('')}</div>`;

  const checks = (name: string, values: readonly string[]) =>
    `<div class="opts">${values
      .map((v) => `<label class="opt"><input type="checkbox" name="${name}" value="${escapeHtml(v)}"><span>${escapeHtml(v)}</span></label>`)
      .join('')}</div>`;

  const lecture = invite.schoolName && invite.eventDate
    ? `${escapeHtml(invite.schoolName)}<br>${escapeHtml(japaneseDate(invite.eventDate))}`
    : 'WAHMS';

  return c.html(page(`<div class="card">
  <h1>はじめてのご登録</h1>
  <p class="sub">${lecture}<br>ご回答いただくと、お申し込みが確定します（約1分）。</p>
  <div id="err"></div>
  <form id="f">
    <input type="hidden" name="token" value="${escapeHtml(invite.token)}">

    <p class="q">お名前<span class="req">必須</span></p>
    <input type="text" name="realName" required maxlength="60" placeholder="山田 太郎">

    <p class="q">ご職業<span class="req">必須</span></p>
    ${radios('occupation', OCCUPATIONS, true)}

    <p class="q">性別<span class="opt-note">任意</span></p>
    ${radios('gender', GENDERS, false, true)}

    <p class="q">年代<span class="opt-note">任意</span></p>
    ${radios('ageGroup', AGE_GROUPS, false, true)}

    <p class="q">ホームページをお持ちですか<span class="opt-note">任意</span></p>
    ${radios('hasSite', HAS_SITE, false, true)}

    <div id="siteWrap" class="hide">
      <p class="q">ホームページのURL<span class="opt-note">任意</span></p>
      <input type="text" name="siteUrl" maxlength="300" placeholder="https://example.com">
    </div>

    <p class="q">興味のある学校<span class="opt-note">任意・複数可</span></p>
    ${checks('interests', INTERESTS)}

    <button type="submit" id="b">回答して申し込みを確定する</button>
  </form>
</div>
<script>
const f=document.getElementById('f'),b=document.getElementById('b'),e=document.getElementById('err');
const wrap=document.getElementById('siteWrap');
f.addEventListener('change',()=>{
  const v=f.querySelector('input[name=hasSite]:checked');
  wrap.classList.toggle('hide', !(v && v.value==='あり'));
});
f.addEventListener('submit',async(ev)=>{
  ev.preventDefault();b.disabled=true;b.textContent='送信中...';e.innerHTML='';
  const fd=new FormData(f);
  const d=Object.fromEntries(fd.entries());
  d.interests=fd.getAll('interests');
  try{
    const r=await fetch('/api/public/wahms-profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    const j=await r.json();
    if(!j.success)throw new Error(j.error||'送信できませんでした');
    location.href='${basePath}/thanks';
  }catch(err){
    e.innerHTML='<div class="err">'+(err.message||'送信できませんでした')+'</div>';
    b.disabled=false;b.textContent='回答して申し込みを確定する';
    window.scrollTo(0,0);
  }
});
</script>`));
};

profileForm.get('/profile/thanks', thanksHandler);
profileForm.get('/wahms/profile/thanks', thanksHandler);
profileForm.get('/profile', formHandler('/profile'));
profileForm.get('/wahms/profile', formHandler('/wahms/profile'));

profileForm.post('/api/public/wahms-profile', async (c) => {
  type Body = {
    token?: string; realName?: string; occupation?: string; gender?: string;
    ageGroup?: string; hasSite?: string; siteUrl?: string; interests?: string[];
  };
  const body: Body = await c.req.json<Body>().catch(() => ({} as Body));

  const invite = body.token ? await findProfileInvite(c.env.DB, body.token.trim()) : null;
  if (!invite) return c.json({ success: false, error: 'この案内は使えません' }, 400);

  const realName = body.realName?.trim();
  if (!realName) return c.json({ success: false, error: 'お名前をご記入ください' }, 400);
  // 選択肢は画面から来るが、直接POSTされても想定外の値を保存しない。
  if (!body.occupation || !OCCUPATIONS.includes(body.occupation)) {
    return c.json({ success: false, error: 'ご職業をお選びください' }, 400);
  }
  const pick = (value: string | undefined, allowed: string[]) =>
    value && allowed.includes(value) ? value : null;
  const interests = Array.isArray(body.interests)
    ? body.interests.filter((v) => INTERESTS.includes(v))
    : [];

  // 二重送信に備えて、先に使用済みにして取り合いに勝ったときだけ書き込む。
  // 2回目も保存すると、送信ボタン連打の2通目 (中身が欠けていることがある) が
  // 1通目を上書きして、せっかくの回答が消える。
  const claimed = await c.env.DB
    .prepare(`UPDATE wahms_profile_invites SET used_at = datetime('now', '+9 hours') WHERE token = ? AND used_at IS NULL`)
    .bind(invite.token)
    .run();
  if (!claimed.meta?.changes) return c.json({ success: true });

  await saveProfile(c.env.DB, invite.lineAccountId, invite.lineUserId, {
    realName,
    occupation: body.occupation,
    gender: pick(body.gender, GENDERS),
    ageGroup: pick(body.ageGroup, AGE_GROUPS),
    hasSite: pick(body.hasSite, HAS_SITE),
    siteUrl: body.siteUrl?.trim() || null,
    interests,
  });

  // 保留していた申込を確定する。ここで初めて Zoom の案内を出す。
  const booking = parseBookingRequest(invite.bookingText ?? undefined);
  if (!booking) return c.json({ success: true });

  try {
    const slot = await findLectureSlot(c.env.DB, invite.lineAccountId, booking);
    const zoom = slot ? await loadZoomSettings(c.env.DB, invite.lineAccountId) : null;
    if (!slot || !zoom) return c.json({ success: true });

    const account = await c.env.DB
      .prepare(`SELECT channel_access_token FROM line_accounts WHERE id = ? AND is_active = 1`)
      .bind(invite.lineAccountId)
      .first<{ channel_access_token: string }>();
    if (!account) return c.json({ success: true });

    await new LineClient(account.channel_access_token).pushMessage(
      invite.lineUserId,
      bookingConfirmMessages(slot, zoom).map((t) => ({ type: 'text' as const, text: t })),
    );
  } catch (err) {
    // 申込の記録は案内を出した時点で済んでいる。案内が送れなくても回答は残す。
    console.error('[wahms-profile] booking confirm push failed', err);
  }

  return c.json({ success: true });
});

export { profileForm };
