import { describe, expect, test } from 'vitest';
import { buildWahmsReply, profileFormBase, welcomeMessages } from './wahms-router.js';

// WAHMS の応答は、ここが唯一の判断の置き場になる。
// 「Worker が返す / 返せないので Apps Script に任せる」の切り分けを固定する。
// 取り違えると、利用者に2通届くか、押しても何も返らないかのどちらかになる。

const SLOT = {
  slotId: 'slot-1', eventId: 'ev-1', schoolName: '💻 WEB学校',
  eventDate: '2026-08-26', startTime: '20:30', endTime: '22:00',
  lectureLabel: '第10回', theme: '総集編｜自社サイトの改善提案書を1本作り上げる',
};

const ZOOM = [
  { key: 'wahms_zoom_url', value: 'https://zoom.test/j/1' },
  { key: 'wahms_zoom_id', value: '4891469109' },
  { key: 'wahms_zoom_password', value: 'whams' },
];

const FORM = { key: 'wahms_survey_form_url', value: 'https://wahms.pages.dev/survey' };

type Options = {
  slot?: boolean;
  finished?: boolean;
  profileDone?: boolean;
  zoom?: boolean;
  formUrl?: boolean;
  archives?: boolean;
};

function fakeDb(sqls: string[], o: Options = {}) {
  const {
    slot = true, finished = false, profileDone = true,
    zoom = true, formUrl = true, archives = true,
  } = o;
  const settings = [...(zoom ? ZOOM : []), ...(formUrl ? [FORM] : [])];
  return {
    prepare(sql: string) {
      const handle = () => ({
        run: async () => ({ success: true, meta: { changes: 1 } }),
        first: async () => {
          if (sql.includes('FROM event_slots')) {
            // 終了済みを探す問い合わせは「今日より前」を条件に持つ。
            const wantsPast = sql.includes("< DATE('now'");
            if (wantsPast) return finished ? { ...SLOT, eventDate: '2026-05-13' } : null;
            return slot ? SLOT : null;
          }
          if (sql.includes('FROM wahms_participants')) return profileDone ? { ok: 1 } : null;
          if (sql.includes('FROM friends')) return { id: 'friend-1' };
          if (sql.includes('FROM wahms_applications')) return null;
          if (sql.includes('FROM event_bookings')) return null;
          return null;
        },
        all: async () => ({
          results:
            sql.includes('FROM account_settings') ? settings
            : sql.includes('FROM event_slots') ? (slot ? [{ schoolName: '💻 WEB学校', eventDate: '2026-08-26', startTime: '20:30', endTime: '22:00', theme: 'テーマW' }] : [])
            : sql.includes('wahms_survey_responses') ? []
            : sql.includes('FROM wahms_archives') ? (archives ? [
                { school_name: '💻 WEB学校', lecture_number: '1.0', theme: 'テーマA', held_on: '2026-05-13T00:00:00', youtube_url: 'https://youtu.be/a' },
              ] : [])
            : [],
        }),
      });
      return { bind: (...args: unknown[]) => { sqls.push(sql); void args; return handle(); }, ...handle() };
    },
  } as unknown as D1Database;
}

const call = (text: string, o: Options = {}, sqls: string[] = []) =>
  buildWahmsReply({ db: fakeDb(sqls, o), lineAccountId: 'acc', lineUserId: 'U1', text, now: new Date('2026-08-26T12:00:00Z') });

describe('リッチメニューの固定応答', () => {
  test('今週の開催日はFlexで返す', async () => {
    const r = await call('今週の開催日');
    expect(r.kind).toBe('handled');
    if (r.kind !== 'handled') return;
    expect(r.messages[0].type).toBe('flex');
  });

  test('受講者の声はカルーセルで返す', async () => {
    const r = await call('受講者の声');
    expect(r.kind).toBe('handled');
    if (r.kind !== 'handled') return;
    expect((r.messages[0] as { contents: { type: string } }).contents.type).toBe('carousel');
  });

  test('よくある質問とワムスとは？はテキストで返す', async () => {
    for (const t of ['よくある質問', 'ワムスとは？', 'ワムスとは', 'wahmsとは', 'WAHMSとは']) {
      const r = await call(t);
      expect(r.kind).toBe('handled');
      if (r.kind !== 'handled') continue;
      expect(r.messages).toHaveLength(1);
      expect(r.messages[0].type).toBe('text');
    }
  });

  test('よくある質問の中身は Apps Script のまま', async () => {
    const r = await call('よくある質問');
    if (r.kind !== 'handled') throw new Error('handled ではない');
    const text = (r.messages[0] as { text: string }).text;
    expect(text).toContain('Q. 本当に無料ですか？');
    expect(text).toContain('A. はい、完全無料です。');
    expect(text).toContain('Q. 接客業ですが合いますか？');
  });

  test('ワムスとは？の中身は Apps Script のまま', async () => {
    const r = await call('WAHMSとは');
    if (r.kind !== 'handled') throw new Error('handled ではない');
    const text = (r.messages[0] as { text: string }).text;
    expect(text).toContain('🎓 SIX Academy『WAHMS』とは');
    expect(text).toContain('https://guardian.jpn.com/wahms/');
  });

  test('アーカイブ要求はD1から一覧を返す', async () => {
    const r = await call('WEB学校 アーカイブ');
    expect(r.kind).toBe('handled');
    if (r.kind !== 'handled') return;
    expect((r.messages[0] as { text: string }).text).toContain('https://youtu.be/a');
  });

  test('アーカイブが1本も無くても黙って落とさない', async () => {
    const r = await call('WEB学校 アーカイブ', { archives: false });
    expect(r.kind).toBe('handled');
    if (r.kind !== 'handled') return;
    expect((r.messages[0] as { text: string }).text).toContain('見つかりませんでした');
  });
});

describe('WAHMS と関係ない文言', () => {
  test('雑談や空文字には答えない（転送も要らない）', async () => {
    for (const t of ['こんにちは', 'ありがとうございます', '', '   ', undefined]) {
      const r = await buildWahmsReply({ db: fakeDb([]), lineAccountId: 'acc', lineUserId: 'U1', text: t });
      expect(r.kind).toBe('skip');
    }
  });
});

describe('申込', () => {
  test('回答済みの人には申込完了を返す', async () => {
    const r = await call('8月26日WEB学校に申し込む');
    expect(r.kind).toBe('handled');
    if (r.kind !== 'handled') return;
    expect((r.messages[0] as { text: string }).text).toBe('✅ お申し込みが完了しました');
    expect((r.messages[1] as { text: string }).text).toContain('https://zoom.test/j/1');
  });

  test('初参加の人にはプロフィール登録の案内を返す', async () => {
    const sqls: string[] = [];
    const r = await call('8月26日WEB学校に申し込む', { profileDone: false }, sqls);
    expect(r.kind).toBe('handled');
    if (r.kind !== 'handled') return;
    expect((r.messages[0] as { text: string }).text).toContain('WAHMSは初参加の方ですね！');
    expect((r.messages[0] as { text: string }).text).toContain('「💻 WEB学校」のお申し込みが');
    expect((r.messages[1] as { text: string }).text).toMatch(
      /^▼ アンケートはこちら\(約1分\)\nhttps:\/\/wahms\.pages\.dev\/profile\?t=[A-Za-z0-9_-]{16,}$/,
    );
    expect(sqls.some((s) => s.includes('INSERT INTO wahms_profile_invites'))).toBe(true);
  });

  test('初参加でも申込はその場で記録する', async () => {
    // 返信の種類にかかわらず記録は残す。2026-08-26 のWEB学校で、初参加の
    // 3名が管理画面に出ないまま当日を迎えた。
    const sqls: string[] = [];
    await call('8月26日WEB学校に申し込む', { profileDone: false }, sqls);
    expect(sqls.some((s) => s.includes('INSERT INTO wahms_applications'))).toBe(true);
  });

  test('終了した回には終了の案内を返す', async () => {
    const r = await call('5月13日WEB学校に申し込む', { slot: false, finished: true });
    expect(r.kind).toBe('handled');
    if (r.kind !== 'handled') return;
    const text = (r.messages[0] as { text: string }).text;
    expect(text).toContain('すでに開催が終了いたしました');
    expect(text).toContain('5月13日（水）20:30〜22:00');
  });

  test('開催予定にも過去にも無い回は記録せず、Apps Script に任せる', async () => {
    const sqls: string[] = [];
    const r = await call('1月1日WEB学校に申し込む', { slot: false, finished: false }, sqls);
    expect(r.kind).toBe('fallback');
    expect(sqls.some((s) => s.includes('INSERT INTO wahms_applications'))).toBe(false);
  });

  test('Zoom設定が無ければ返さない（URLの無い案内を送らない）', async () => {
    const r = await call('8月26日WEB学校に申し込む', { zoom: false });
    expect(r.kind).toBe('fallback');
    if (r.kind !== 'fallback') return;
    expect(r.reason).toBe('zoom-settings-missing');
  });

  test('フォームURLが未設定なら初参加の案内を出さない', async () => {
    const r = await call('8月26日WEB学校に申し込む', { profileDone: false, formUrl: false, zoom: false });
    expect(r.kind).toBe('fallback');
    if (r.kind !== 'fallback') return;
    expect(r.reason).toBe('profile-form-url-missing');
  });

  test('誰の申込か分からないときは引き取らない', async () => {
    const r = await buildWahmsReply({
      db: fakeDb([]), lineAccountId: 'acc', lineUserId: null, text: '8月26日WEB学校に申し込む',
    });
    expect(r.kind).toBe('fallback');
  });
});

describe('フォームURLの導き方', () => {
  test('専用の設定があればそれを使う', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [
        { key: 'wahms_profile_form_url', value: 'https://example.test/p' },
        { key: 'wahms_survey_form_url', value: 'https://wahms.pages.dev/survey' },
      ] }) }) }),
    } as unknown as D1Database;
    expect(await profileFormBase(db, 'acc')).toBe('https://example.test/p');
  });

  test('無ければ講義アンケートのURLから導く', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [FORM] }) }) }),
    } as unknown as D1Database;
    expect(await profileFormBase(db, 'acc')).toBe('https://wahms.pages.dev/profile');
  });

  test('どちらも無ければ null', async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) } as unknown as D1Database;
    expect(await profileFormBase(db, 'acc')).toBeNull();
  });
});

describe('友だち追加のあいさつ', () => {
  test('今週のカレンダーをFlexで返す', async () => {
    const messages = await welcomeMessages(fakeDb([]), 'acc', new Date('2026-08-26T12:00:00Z'));
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('flex');
    expect((messages[0] as { altText: string }).altText).toContain('WAHMSへようこそ');
  });
});
