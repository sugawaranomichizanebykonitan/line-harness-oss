/**
 * 他ツールの友だち一覧を、こちらの `friends` に取り込む。
 *
 * LINE の「友だち一覧を取得するAPI」(/v2/bot/followers/ids) は、未認証の
 * 公式アカウントでは 403 になる。既存ツール (Lステップ等) から出した一覧を
 * 読み込めるようにしておかないと、引き受けた時点の友だちを永久に知れない。
 *
 * 出力は SQL。実行はせず、目で確認してから wrangler に流す。
 *
 *   npx tsx scripts/import-friends.ts <lineAccountId> <一覧ファイル> > import.sql
 *
 * 入力は「1行に1人」なら何でもよい。CSV / TSV / ユーザーIDだけの羅列。
 * 各行から LINE のユーザーID (U + 16進32桁) を拾い、同じ行の別の欄を表示名に使う。
 */

/** LINE のユーザーID。形が違うものを入れると、あとで誰にも紐づかない行になる。 */
const USER_ID = /U[0-9a-f]{32}/;

export type ParsedFriend = { lineUserId: string; displayName: string | null };
export type ParseResult = { rows: ParsedFriend[]; skipped: string[] };

/** CSV1行を欄に分ける。ダブルクォートで囲まれた欄の中のカンマは区切りにしない。 */
export function splitFields(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; } else { quoted = false; }
      } else current += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',' || ch === '\t') { fields.push(current); current = ''; continue; }
    current += ch;
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * 一覧を読み取る。
 *
 * ユーザーIDを含まない行は見出し行や空行なので黙って飛ばす。ただし何を
 * 飛ばしたかは返す。数だけ合っていて中身が違う、を防ぐため。
 */
export function parseFriendList(text: string): ParseResult {
  const rows: ParsedFriend[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = USER_ID.exec(line);
    if (!match) { skipped.push(line.slice(0, 60)); continue; }
    const lineUserId = match[0];
    if (seen.has(lineUserId)) continue; // 同じ人が2行あっても1回だけ
    seen.add(lineUserId);

    // 表示名は、ユーザーIDでも日付でも数値でもない最初の欄。
    const displayName = splitFields(line)
      .filter((f) => f && !USER_ID.test(f))
      .find((f) => !/^[\d/:\-\s.]+$/.test(f)) ?? null;

    rows.push({ lineUserId, displayName: displayName || null });
  }
  return { rows, skipped };
}

function quote(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
}

/**
 * 取り込み用のSQLを組み立てる。
 *
 * すでに居る人は触らない。webhook 経由で先に登録された人 (表示名や
 * 友だち追加日時が正確) を、一覧の古い情報で上書きしないため。
 */
export function buildImportSql(lineAccountId: string, rows: ParsedFriend[]): string {
  const header = [
    '-- 既存ツールの友だち一覧の取り込み。',
    `-- 対象アカウント: ${lineAccountId}`,
    `-- 件数: ${rows.length}`,
    '--',
    '-- すでに居る人は上書きしない。webhook で先に入った行のほうが情報が新しい。',
    '',
  ].join('\n');

  const statements = rows.map((r) => {
    const id = crypto.randomUUID();
    return [
      'INSERT INTO friends (id, line_user_id, display_name, is_following, line_account_id, metadata)',
      `SELECT ${quote(id)}, ${quote(r.lineUserId)}, ${quote(r.displayName)}, 1, ${quote(lineAccountId)}, '{"importedFrom":"external-tool"}'`,
      ` WHERE NOT EXISTS (SELECT 1 FROM friends WHERE line_user_id = ${quote(r.lineUserId)});`,
    ].join('\n');
  });

  return `${header}${statements.join('\n\n')}\n`;
}

// ─── CLI ────────────────────────────────────────────────────────────────────
// import.meta.url 直実行のときだけ動かす。テストからは読み込むだけ。
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '\0')) {
  const [accountId, file] = process.argv.slice(2);
  if (!accountId || !file) {
    console.error('使い方: npx tsx scripts/import-friends.ts <lineAccountId> <一覧ファイル>');
    process.exit(1);
  }
  const { readFileSync } = await import('node:fs');
  const { rows, skipped } = parseFriendList(readFileSync(file, 'utf8'));
  console.error(`読み取り: ${rows.length}人 / 飛ばした行: ${skipped.length}`);
  for (const s of skipped.slice(0, 5)) console.error(`  飛ばした: ${s}`);
  process.stdout.write(buildImportSql(accountId, rows));
}
