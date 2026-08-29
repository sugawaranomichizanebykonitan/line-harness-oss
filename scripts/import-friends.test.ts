import { describe, expect, test } from 'vitest';
import { buildImportSql, parseFriendList, splitFields } from './import-friends.js';

// 既存ツールから出した友だち一覧の取り込み。書き出し形式はツールごとに違うので、
// 「1行に1人、どこかにユーザーIDがある」だけを前提にする。
// ここを緩くしすぎると誰にも紐づかない行が入り、厳しすぎると取りこぼす。

describe('CSVの行を欄に分ける', () => {
  test('カンマ区切りとタブ区切りの両方', () => {
    expect(splitFields('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(splitFields('a\tb\tc')).toEqual(['a', 'b', 'c']);
  });

  test('引用符の中のカンマは区切りにしない', () => {
    expect(splitFields('"山田, 太郎",U' + 'a'.repeat(32))).toEqual(['山田, 太郎', 'U' + 'a'.repeat(32)]);
  });

  test('引用符の中の引用符', () => {
    expect(splitFields('"彼は""天才""だ",x')).toEqual(['彼は"天才"だ', 'x']);
  });
});

const UID1 = 'U0c545075e7660d98ea5ec20178a9c935';
const UID2 = 'U57beeb14d4fb8db188c916ec8f70d781';

describe('一覧の読み取り', () => {
  test('ユーザーIDだけの羅列', () => {
    const { rows } = parseFriendList(`${UID1}\n${UID2}\n`);
    expect(rows).toEqual([
      { lineUserId: UID1, displayName: null },
      { lineUserId: UID2, displayName: null },
    ]);
  });

  test('見出し行と空行は飛ばす', () => {
    const { rows, skipped } = parseFriendList(`ユーザーID,表示名\n\n${UID1},安立佳弘\n`);
    expect(rows).toEqual([{ lineUserId: UID1, displayName: '安立佳弘' }]);
    expect(skipped).toEqual(['ユーザーID,表示名']);
  });

  test('列の並びが違っても拾える', () => {
    const { rows } = parseFriendList(`2026/05/12,安立佳弘,${UID1},60代\n`);
    expect(rows).toEqual([{ lineUserId: UID1, displayName: '安立佳弘' }]);
  });

  test('日付や数値だけの欄は表示名にしない', () => {
    const { rows } = parseFriendList(`${UID1},2026/05/12,133\n`);
    expect(rows[0].displayName).toBeNull();
  });

  test('同じ人が2行あっても1回だけ', () => {
    const { rows } = parseFriendList(`${UID1},名前A\n${UID1},名前B\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe('名前A');
  });

  test('形の違うIDは取り込まない（誰にも紐づかない行を作らない）', () => {
    const { rows, skipped } = parseFriendList('U123,あやしい\nUXYZ0000000000000000000000000000,これも\n');
    expect(rows).toHaveLength(0);
    expect(skipped).toHaveLength(2);
  });
});

describe('取り込みSQL', () => {
  test('すでに居る人は上書きしない', () => {
    const sql = buildImportSql('acc-1', [{ lineUserId: UID1, displayName: '安立佳弘' }]);
    expect(sql).toContain('INSERT INTO friends');
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).not.toContain('UPDATE friends');
    expect(sql).not.toContain('REPLACE INTO');
  });

  test('アカウントを必ず指定する（無所属の友だちを作らない）', () => {
    const sql = buildImportSql('acc-1', [{ lineUserId: UID1, displayName: null }]);
    expect(sql).toContain("'acc-1'");
    expect(sql).toContain('NULL');
  });

  test('名前のアポストロフィでSQLが壊れない', () => {
    const sql = buildImportSql('acc-1', [{ lineUserId: UID1, displayName: "O'Brien" }]);
    expect(sql).toContain("'O''Brien'");
  });

  test('件数を見出しに残す', () => {
    const sql = buildImportSql('acc-1', [
      { lineUserId: UID1, displayName: null },
      { lineUserId: UID2, displayName: null },
    ]);
    expect(sql).toContain('件数: 2');
  });
});
