import { describe, expect, test } from 'vitest';
import { parseArchiveRequest, buildArchiveReply } from './wahms-archive.js';

// リッチメニューは絵文字なしのテキスト (例:「マーケティング学校 アーカイブ」) を
// 送るが、D1 の school_name は絵文字付き (例:「🔥 マーケティング学校」)。
// ここがずれると利用者に一覧が届かないので、突き合わせを固定する。

describe('アーカイブ要求の判定', () => {
  test('リッチメニューの6つのボタンをすべて拾える', () => {
    for (const s of ['マーケティング学校', '青山塾', 'WEB学校', 'セールス学校', 'マネジメント学校', '人間力学校']) {
      expect(parseArchiveRequest(`${s} アーカイブ`)).toBe(s);
    }
  });

  test('空白が無くても拾う', () => {
    expect(parseArchiveRequest('WEB学校アーカイブ')).toBe('WEB学校');
  });

  test('学校名でないものは拾わない', () => {
    // ここで拾ってしまうと、Apps Script へ転送すべきイベントを奪ってしまう。
    expect(parseArchiveRequest('アーカイブ')).toBeNull();
    expect(parseArchiveRequest('動画アーカイブ')).toBeNull();
    expect(parseArchiveRequest('今週の開催日')).toBeNull();
    expect(parseArchiveRequest('よくある質問')).toBeNull();
    expect(parseArchiveRequest('')).toBeNull();
    expect(parseArchiveRequest(undefined)).toBeNull();
  });
});

function fakeDb(rows: unknown[]) {
  return {
    prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }),
  } as unknown as D1Database;
}

const ROWS = [
  { school_name: '🔥 マーケティング学校', lecture_number: '1.0', theme: '売り込まなくても選ばれる会社は、何が違うのか？', held_on: '2026-05-12T00:00:00', youtube_url: 'https://youtu.be/a' },
  { school_name: '🔥 マーケティング学校', lecture_number: '2.0', theme: 'あなたのお客様は、本当はどこにいるのか？', held_on: '2026-05-19T00:00:00', youtube_url: 'https://youtu.be/b' },
  { school_name: '🔥 マーケティング学校', lecture_number: '13.0', theme: 'その数字は「相関」か「因果」か？', held_on: null, youtube_url: null },
];

describe('アーカイブ応答の組み立て', () => {
  test('動画が登録済みの回だけを、回の順に並べて返す', async () => {
    const text = (await buildArchiveReply(fakeDb(ROWS), 'acc', 'マーケティング学校'))!;
    expect(text).toContain('🔥 マーケティング学校 アーカイブ（2本）');
    expect(text).toContain('第1回');
    expect(text).toContain('https://youtu.be/a');
    expect(text).toContain('https://youtu.be/b');
    // 未実施の第13回は枠だけなので出さない。
    expect(text).not.toContain('第13回');
    expect(text.indexOf('第1回')).toBeLessThan(text.indexOf('第2回'));
  });

  test('開催日を M/D で添える', async () => {
    const text = (await buildArchiveReply(fakeDb(ROWS), 'acc', 'マーケティング学校'))!;
    expect(text).toContain('5/12');
  });

  test('テーマの無い学校でも空行を作らない', async () => {
    // 青山塾は第11回から「何でも相談OK」になりテーマを設けていない。
    // テーマ欄を無条件に挟むと、回とURLの間に空行が入って読みにくくなる。
    const rows = [
      { school_name: '☕ 青山塾', lecture_number: '11.0', theme: null, held_on: '2026-07-29T00:00:00', youtube_url: 'https://youtu.be/x' },
      { school_name: '☕ 青山塾', lecture_number: '12.0', theme: '', held_on: '2026-08-19T00:00:00', youtube_url: 'https://youtu.be/y' },
    ];
    const text = (await buildArchiveReply(fakeDb(rows), 'acc', '青山塾'))!;
    expect(text).toContain('☕ 青山塾 アーカイブ（2本）');
    expect(text).toContain('第11回  7/29\nhttps://youtu.be/x');
    expect(text).toContain('第12回  8/19\nhttps://youtu.be/y');
    expect(text).not.toContain('\n\n\n');
  });

  test('公開済みが1本も無ければ、その旨を返す', async () => {
    const text = await buildArchiveReply(fakeDb([ROWS[2]]), 'acc', 'マーケティング学校');
    expect(text).toContain('まだ公開中のアーカイブがありません');
  });

  test('該当学校が無ければ null。従来動作に任せる', async () => {
    expect(await buildArchiveReply(fakeDb([]), 'acc', '存在しない学校')).toBeNull();
  });
});
