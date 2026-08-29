import type { Context, Next } from 'hono';
import { getStaffByApiKey } from '@line-crm/db';
import type { Env } from '../index.js';
import type { AdminSameSite } from './admin-auth-config.js';

export const ADMIN_AUTH_COOKIE = 'lh_admin_session';
export const CSRF_COOKIE = 'lh_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// 7 days, matching the previous localStorage session longevity.
const SESSION_MAX_AGE = 604800;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * decodeURIComponent throws on malformed percent escapes (e.g. `%`). Cookie
 * headers are client-controlled, so fall back to the raw value rather than
 * letting the exception turn a request into a 500.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) continue;
    cookies[rawName] = safeDecode(rawValue.join('=') || '');
  }
  return cookies;
}

function bearerToken(c: Context<Env>): string | null {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length);
}

function cookieToken(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[ADMIN_AUTH_COOKIE] || null;
}

export function csrfTokenFromCookie(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[CSRF_COOKIE] || null;
}

function buildCookie(
  name: string,
  value: string,
  sameSite: AdminSameSite,
  maxAge: number,
  httpOnly: boolean,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (httpOnly) parts.push('HttpOnly');
  parts.push('Secure', `SameSite=${sameSite}`, `Max-Age=${maxAge}`);
  return parts.join('; ');
}

/** HttpOnly session cookie carrying the API token. */
export function adminSessionCookie(token: string, sameSite: AdminSameSite): string {
  return buildCookie(ADMIN_AUTH_COOKIE, token, sameSite, SESSION_MAX_AGE, true);
}

/**
 * CSRF cookie. NOT HttpOnly so it can participate in double-submit, but in a
 * cross-site topology the SPA cannot read it (different registrable domain) —
 * the token is therefore also returned in the login/session response body and
 * the SPA echoes it via the X-CSRF-Token header. The Worker validates that
 * header against this cookie, which the browser does send back to the API
 * (SameSite=None).
 */
export function csrfCookie(token: string, sameSite: AdminSameSite): string {
  return buildCookie(CSRF_COOKIE, token, sameSite, SESSION_MAX_AGE, false);
}

export function expiredCookie(name: string, sameSite: AdminSameSite): string {
  return buildCookie(name, '', sameSite, 0, name === ADMIN_AUTH_COOKIE);
}

export type AuthenticatedStaff = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
  /**
   * 担当できる LINE 公式アカウント。null は従来どおり全アカウント。
   * 値が入っているスタッフは、そのアカウント以外のデータへ一切到達できない
   * (enforceAccountScope で遮断する)。
   */
  lineAccountId: string | null;
};

/**
 * Resolve a token (from a Bearer header or the session cookie) to a staff
 * identity. Shared by the auth middleware and the /api/auth/login endpoint so
 * cookie and Bearer auth accept exactly the same credentials.
 */
export async function authenticateApiToken(
  c: Context<Env>,
  token: string | null,
): Promise<AuthenticatedStaff | null> {
  if (!token) return null;

  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    return {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      lineAccountId: staff.line_account_id ?? null,
    };
  }

  // Fallback: env API_KEY acts as owner (current rotation slot)
  if (token === c.env.API_KEY) {
    return { id: 'env-owner', name: 'Owner', role: 'owner', lineAccountId: null };
  }

  // Legacy fallback: LEGACY_API_KEY accepted during rotation grace period.
  // Same-value guard: if both env vars are set to the same secret, the primary
  // check above already accepts it; this branch must skip to avoid false
  // LEGACY counters. Logs accept_via=LEGACY_API_KEY so operators can confirm
  // zero legacy usage before deleting the secret.
  if (
    c.env.LEGACY_API_KEY &&
    c.env.LEGACY_API_KEY !== c.env.API_KEY &&
    token === c.env.LEGACY_API_KEY
  ) {
    console.log('[auth] accept_via=LEGACY_API_KEY');
    return { id: 'env-owner', name: 'Owner', role: 'owner', lineAccountId: null };
  }

  return null;
}

/**
 * アカウントに紐づかない共通データ。担当が限定されたスタッフでも触れないと
 * チャット画面が成立しないもの (対応者一覧、タグ、定型文など) を通す。
 * 顧客データそのものではないので、担当アカウント外の情報は含まれない。
 */
const ACCOUNT_AGNOSTIC = [
  /^\/api\/auth\/session$/,
  /^\/api\/capabilities$/,
  /^\/api\/line-accounts$/, // 中身はルート側で担当分だけに絞る
  /^\/api\/operators(\/[^/]+)?$/,
  /^\/api\/tags(\/[^/]+)?$/,
  /^\/api\/templates(\/[^/]+)?$/,
  /^\/api\/message-templates(\/[^/]+)?$/,
  /^\/api\/account-settings/,
];

/**
 * ID で個別のデータを指すパス。アカウントを問い合わせに含められないので、
 * そのデータが実際にどのLINEアカウントのものかをDBに聞いて判定する。
 *
 * ここに無いID指定パスは fail-closed で 403 になる。
 * 谷口さんのような担当限定スタッフが実際に使う画面から順に追加していく。
 */
const OWNERSHIP_RULES: { re: RegExp; sql: string }[] = [
  {
    // /api/chats/:id は chats.id と friends.id のどちらでも受け付ける仕様
    // (ルート側が公開IDを friend_id に統一しているため、実際に来るのは
    // ほぼ friends.id)。両方を引いて、先に見つかった方の所属を採用する。
    // chats.line_account_id は後から追加された列で NULL のことがあるので、
    // friends 側にフォールバックして必ずアカウントを特定する。
    re: /^\/api\/chats\/([^/]+)(?:\/.*)?$/,
    sql: `SELECT COALESCE(c.line_account_id, cf.line_account_id, f.line_account_id) AS account
          FROM (SELECT ? AS key) k
          LEFT JOIN chats   c  ON c.id = k.key
          LEFT JOIN friends cf ON cf.id = c.friend_id
          LEFT JOIN friends f  ON f.id = k.key
          WHERE c.id IS NOT NULL OR f.id IS NOT NULL`,
  },
  { re: /^\/api\/friends\/([^/]+)(?:\/.*)?$/, sql: 'SELECT line_account_id AS account FROM friends WHERE id = ?' },
  { re: /^\/api\/conversations\/([^/]+)$/, sql: 'SELECT line_account_id AS account FROM friends WHERE id = ?' },
  { re: /^\/api\/broadcasts\/([^/]+)(?:\/.*)?$/, sql: 'SELECT line_account_id AS account FROM broadcasts WHERE id = ?' },
  { re: /^\/api\/scenarios\/([^/]+)(?:\/.*)?$/, sql: 'SELECT line_account_id AS account FROM scenarios WHERE id = ?' },
  { re: /^\/api\/tracked-links\/([^/]+)(?:\/.*)?$/, sql: 'SELECT line_account_id AS account FROM tracked_links WHERE id = ?' },
  { re: /^\/api\/auto-replies\/([^/]+)(?:\/.*)?$/, sql: 'SELECT line_account_id AS account FROM auto_replies WHERE id = ?' },
  { re: /^\/api\/events\/([^/]+)(?:\/.*)?$/, sql: 'SELECT line_account_id AS account FROM events WHERE id = ?' },
  { re: /^\/api\/reminders\/([^/]+)(?:\/.*)?$/, sql: 'SELECT line_account_id AS account FROM reminders WHERE id = ?' },
];

/** リクエストが対象にしている LINE アカウントを取り出す。 */
function requestedAccountId(c: Context<Env>): string | null {
  const url = new URL(c.req.url);
  return (
    url.searchParams.get('accountId') ||
    url.searchParams.get('lineAccountId') ||
    c.req.header('X-Line-Account-Id') ||
    null
  );
}

/**
 * アカウント限定スタッフのアクセス制御。
 *
 * 42 ファイルに散らばる accountId 受け取り箇所を個別に直すのは漏れが出るので、
 * 認証の関門で一度だけ判定する。判定は次の順。
 *
 *   1. アカウントを明示している → 担当と一致すれば通す。違えば 403。
 *   2. ID で個別データを指している → そのデータの所属アカウントをDBに聞いて判定。
 *   3. アカウントに紐づかない共通データ → 通す。
 *   4. それ以外 (アカウント指定のない一覧など) → 403。
 *
 * 4 を fail-closed にしているのは、/api/friends のようにアカウント指定を
 * 省略すると全アカウント横断で返すエンドポイントがあるため。
 *
 * 戻り値が Response ならそこで打ち切る。null なら通してよい。
 */
export async function enforceAccountScope(c: Context<Env>): Promise<Response | null> {
  const staff = c.get('staff') as AuthenticatedStaff | undefined;
  if (!staff?.lineAccountId) return null; // 全アカウント権限

  const path = new URL(c.req.url).pathname;
  const method = c.req.method.toUpperCase();

  if (path === '/api/auth/logout') return null;

  // LINE アカウント自体の作成・変更・削除は許さない。一覧の参照だけ通す
  // (中身は line-accounts ルート側で担当分に絞り込む)。
  if (path.startsWith('/api/line-accounts')) {
    if (method === 'GET' && path === '/api/line-accounts') return null;
    return c.json(
      { success: false, error: 'このログインではLINEアカウントの管理はできません' },
      403,
    );
  }

  // 1. アカウントを明示している場合
  const requested = requestedAccountId(c);
  if (requested) {
    if (requested !== staff.lineAccountId) {
      return c.json(
        { success: false, error: 'このLINEアカウントへのアクセス権がありません' },
        403,
      );
    }
    return null;
  }

  // 2. ID で個別データを指している場合は、所属アカウントを引いて照合する
  for (const rule of OWNERSHIP_RULES) {
    const m = path.match(rule.re);
    if (!m) continue;
    const row = await c.env.DB.prepare(rule.sql)
      .bind(m[1])
      .first<{ account: string | null }>();
    if (!row) {
      // 存在しないIDと、担当外のIDを区別しない。存在有無を漏らさないため。
      return c.json({ success: false, error: 'データが見つかりません' }, 404);
    }
    if (row.account !== staff.lineAccountId) {
      return c.json(
        { success: false, error: 'このデータへのアクセス権がありません' },
        403,
      );
    }
    return null;
  }

  // 3. アカウントに紐づかない共通データ
  if (ACCOUNT_AGNOSTIC.some((re) => re.test(path))) return null;

  // 4. それ以外は通さない
  return c.json(
    {
      success: false,
      error: 'アカウントを指定してください。このログインは担当のLINEアカウント専用です',
    },
    403,
  );
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  // LIFF / admin の SPA アセットは Authorization ヘッダなしで HTML を取りに
  // くる。Worker は API 以外のパスを ASSETS バインディングから配信するので、
  // /api/ で始まらないパスは認証 skip して static asset として返す。
  // (admin は別ホスト、Worker の non-API path はすべて LIFF/SPA 経由)
  const method = c.req.method.toUpperCase();
  // WAHMS Apps Script mirrors new participants/bookings/surveys into D1.
  // This endpoint authenticates with the registered LINE channel token inside
  // its own route, so it must bypass staff-cookie authentication here.
  if (method === 'POST' && path === '/api/wahms/sync') return next();
  if (!path.startsWith('/api/')) {
    // ただし内部用エンドポイント (/webhook, /auth, /setup) は元の skip 判定に任せる
    if (
      path !== '/webhook' &&
      !path.startsWith('/wahms/survey') &&
      !path.startsWith('/survey') &&
      !path.startsWith('/wahms/profile') &&
      !path.startsWith('/profile') &&
      !path.startsWith('/auth/') &&
      path !== '/setup' &&
      !path.startsWith('/t/') &&
      !path.startsWith('/r/') &&
      !path.startsWith('/pool/') &&
      !path.startsWith('/images/')
    ) {
      return next();
    }
  }

  // A form definition is public because the LIFF client must render it before
  // submission. Authenticate opportunistically so the same GET can still
  // return the full admin representation to SDK/admin callers, while an
  // unauthenticated LIFF caller receives the redacted public representation.
  // Crucially, this exception is method-aware: PUT/DELETE on the same path
  // must continue through the normal admin authentication below.
  const isPublicFormDefinition =
    method === 'GET' && /^\/api\/forms\/[^/]+$/.test(path);
  if (isPublicFormDefinition) {
    const token = bearerToken(c) ?? cookieToken(c);
    const staff = await authenticateApiToken(c, token);
    if (staff) c.set('staff', staff);
    return next();
  }

  // These LIFF actions perform their own LINE ID-token verification inside
  // the route. They cannot use the admin auth gate because their Bearer token
  // is a LINE ID token, not a Harness staff API key.
  const isPublicFormAction =
    method === 'POST' &&
    (/^\/api\/forms\/[^/]+\/submit$/.test(path) ||
      /^\/api\/forms\/[^/]+\/opened$/.test(path) ||
      /^\/api\/forms\/[^/]+\/partial$/.test(path));
  if (isPublicFormAction) return next();

  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    // 画像 src として <img> 経由でブラウザが取得するため (Authorization ヘッダ不可)。
    // R2 key 内に group_id / page_id (UUID) が含まれるので推測困難。draft 画像も
    // 最終的に LINE 上で公開されるため機密性は低い。
    path.startsWith('/api/rich-menu-images/') ||
    // LINE 上 rich menu 画像 proxy (Authorization ヘッダなしで <img src> 経由表示)
    path.match(/^\/api\/rich-menu-groups\/external\/[^/]+\/image$/) ||
    path.startsWith('/api/liff/') ||
    // Admin login/logout — issue/clear the session cookie before auth exists.
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path === '/api/meet-callback' || // Meet Harness completion callback
    // Google OAuth redirects without admin headers. Route verifies a signed, expiring state.
    (path === '/api/booking/google-calendar/oauth/callback' && method === 'GET') ||
    // LINE登録なしで回答できる講義アンケート。紹介で直接参加した受講者向けで、
    // 認証を要求すると本来の目的 (LINEを持たない人が答える) が果たせない。
    // 学校は英字キーで /survey/management のように渡す (日本語のURLは
    // Zoomのチャットなどでリンクとして認識されないため)。
    /^\/(?:wahms\/)?survey(?:\/[A-Za-z0-9_-]+)?$/.test(path) ||
    (path === '/api/public/wahms-survey' && method === 'POST') ||
    // 初参加者のプロフィール登録。LIFF (LINEログイン必須) をやめて普通のWeb
    // ページにしたので、ここも認証なしで開ける必要がある。誰の回答かは
    // URLの使い捨てトークンで確定する。
    /^\/(?:wahms\/)?profile(?:\/thanks)?$/.test(path) ||
    (path === '/api/public/wahms-profile' && method === 'POST') ||
    path === '/api/qr' || // Public QR proxy — used by desktop landing pages
    path === '/api/health' || // Liveness probe (update CLI / self-update verify)
    // Public lead form. Origin validation and field validation happen in-route.
    (path === '/api/public/media-inquiries' && method === 'POST')
  ) {
    return next();
  }

  const bearer = bearerToken(c);
  const cookie = cookieToken(c);
  const token = bearer ?? cookie;

  const staff = await authenticateApiToken(c, token);
  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  // CSRF protection applies ONLY to cookie-authenticated, state-changing
  // requests. Bearer callers (SDK/MCP) cannot be driven cross-site by a
  // browser (an attacker cannot set the Authorization header), so they are
  // exempt. Safe methods (GET/HEAD/OPTIONS) never mutate, so they are exempt.
  if (!bearer && cookie && !SAFE_METHODS.has(c.req.method.toUpperCase())) {
    const header = c.req.header(CSRF_HEADER);
    const expected = csrfTokenFromCookie(c);
    if (!header || !expected || header !== expected) {
      return c.json({ success: false, error: 'CSRF token mismatch' }, 403);
    }
  }

  c.set('staff', staff);

  // 担当アカウントが限定されているスタッフは、ここで範囲外を遮断する。
  const scopeDenied = await enforceAccountScope(c);
  if (scopeDenied) return scopeDenied;

  return next();
}
