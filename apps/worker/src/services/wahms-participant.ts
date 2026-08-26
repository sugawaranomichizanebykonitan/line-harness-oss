/**
 * WAHMS の登録者マスターを、友だち追加の時点で作る。
 *
 * これまで `wahms_participants` は Apps Script からの同期でしか増えず、その
 * 同期が一度も動いていなかったため、2026-08-20 以降に友だち追加した人は
 * こちらから見えなかった。申込の引き取り判定もこの表を見ているので、
 * 新規の人の申込が記録から漏れる原因にもなっていた。
 *
 * Worker は友だち追加の webhook を先に受け取っているので、その場で作る。
 * 氏名や職業などの詳細は初回アンケートで後から埋まる。
 */
export async function ensureWahmsParticipant(
  db: D1Database,
  lineAccountId: string,
  lineUserId: string,
  displayName: string | null,
): Promise<'created' | 'updated'> {
  const existing = await db
    .prepare(`SELECT id FROM wahms_participants WHERE line_account_id = ? AND line_user_id = ? LIMIT 1`)
    .bind(lineAccountId, lineUserId)
    .first<{ id: string }>();

  if (existing) {
    // 表示名の変更だけ拾う。アンケートで入った氏名などは上書きしない。
    await db
      .prepare(
        `UPDATE wahms_participants
            SET line_display_name = COALESCE(?, line_display_name), updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(displayName, existing.id)
      .run();
    return 'updated';
  }

  // source_row はスプレッドシート由来の列。Worker が作った行には対応する
  // 行が無いので NULL のままにする (UNIQUE は NULL を重複扱いしない)。
  await db
    .prepare(
      `INSERT INTO wahms_participants
         (id, line_account_id, line_user_id, line_display_name, followed_at,
          application_count, score, status, source_row)
       VALUES (?, ?, ?, ?, datetime('now', '+9 hours'), 0, 0, '有効', NULL)`,
    )
    .bind(crypto.randomUUID(), lineAccountId, lineUserId, displayName)
    .run();
  return 'created';
}
