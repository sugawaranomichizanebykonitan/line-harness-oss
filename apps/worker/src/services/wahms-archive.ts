/**
 * WAHMS リッチメニューの「アーカイブ」応答。
 *
 * これまで、アーカイブ一覧は既存の Apps Script がスプレッドシートを読んで
 * 返していた。管理画面から登録した内容は D1 にしか入らないため、登録しても
 * LINE 利用者には届かない状態だった。
 *
 * そこで、アーカイブ要求だけは Worker が D1 から直接返す。二重返信を防ぐため、
 * この要求は Apps Script へ転送しない (webhook.ts 側で制御)。
 *
 * リッチメニューのボタンは絵文字なしのテキスト (例:「マーケティング学校 アーカイブ」)
 * を送るが、D1 の school_name は絵文字付き (例:「🔥 マーケティング学校」) なので
 * 部分一致で突き合わせる。
 */

/** リッチメニューが送ってくる文言。末尾が「アーカイブ」なら学校名を返す。 */
export function parseArchiveRequest(text: string | undefined | null): string | null {
  if (!text) return null;
  const m = text.trim().match(/^(.+?)\s*アーカイブ$/);
  if (!m) return null;
  const school = m[1].trim();
  // 「学校」「塾」で終わらないものは学校名ではない (「講義アーカイブ」など)。
  return /(学校|塾)$/.test(school) ? school : null;
}

type ArchiveRow = {
  school_name: string;
  lecture_number: string | null;
  theme: string | null;
  held_on: string | null;
  youtube_url: string | null;
};

function lectureLabel(value: string | null): string {
  // 移行元の都合で '13' と '13.0' が混在する。表示は整数に揃える。
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `第${Math.round(n)}回` : '';
}

function dateLabel(value: string | null): string {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}` : '';
}

/**
 * 指定学校の公開済みアーカイブを、LINE へ返すテキストに組み立てる。
 * 該当学校が存在しなければ null (その場合は転送して従来動作に任せる)。
 */
export async function buildArchiveReply(
  db: D1Database,
  lineAccountId: string,
  plainSchoolName: string,
): Promise<string | null> {
  const rows = await db
    .prepare(
      `SELECT school_name, lecture_number, theme, held_on, youtube_url
         FROM wahms_archives
        WHERE line_account_id = ?
          AND school_name LIKE '%' || ? || '%'
        ORDER BY CAST(lecture_number AS REAL)`,
    )
    .bind(lineAccountId, plainSchoolName)
    .all<ArchiveRow>();

  const all = rows.results || [];
  if (all.length === 0) return null;

  const displayName = all[0].school_name;
  // 動画が登録されている回だけを出す。未実施の回は枠だけ存在している。
  const published = all.filter((r) => r.youtube_url && r.youtube_url.trim());

  if (published.length === 0) {
    return `${displayName}\n\nまだ公開中のアーカイブがありません。\n講義の公開をお待ちください。`;
  }

  const lines = published.map((r) => {
    const head = [lectureLabel(r.lecture_number), dateLabel(r.held_on)].filter(Boolean).join('  ');
    const theme = r.theme?.trim();
    return [head, theme, r.youtube_url!.trim()].filter(Boolean).join('\n');
  });

  return `${displayName} アーカイブ（${published.length}本）\n\n${lines.join('\n\n')}`;
}
