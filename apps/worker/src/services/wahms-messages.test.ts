import { describe, expect, test } from 'vitest';
import {
  japaneseDate, openTime,
  bookingConfirmMessages, morningReminderMessages, preLectureReminderMessages,
} from './wahms-messages.js';

// 文面は既存の Apps Script と同じにしてある。受講者から見て何も変わらない
// ようにするため。テーマの無い学校 (青山塾は第11回から「何でも相談OK」で
// テーマを設けていない) で行が壊れないことを固定する。

const ZOOM = { url: 'https://zoom.test/j/1', id: '4891469109', password: 'whams' };
const WITH_THEME = {
  slotId: '', eventId: '', schoolName: '🔥 マーケティング学校',
  eventDate: '2026-08-25', startTime: '20:30', endTime: '22:00',
  lectureLabel: '第13回', theme: '安売りは、本当に「負け」なのか？',
};
const NO_THEME = { ...WITH_THEME, schoolName: '☕ 青山塾', theme: null, startTime: '12:00', endTime: '13:00' };

describe('日付と開室時刻', () => {
  test('曜日つきで出す', () => {
    expect(japaneseDate('2026-08-25')).toBe('8月25日（火）');
    expect(japaneseDate('2026-08-29')).toBe('8月29日（土）');
  });

  test('開室は10分前', () => {
    expect(openTime('20:30')).toBe('20:20');
    expect(openTime('09:00')).toBe('08:50');
  });
});

describe('テーマがある学校', () => {
  test('申込完了にテーマが入る', () => {
    const [, body] = bookingConfirmMessages(WITH_THEME, ZOOM);
    expect(body).toContain('『安売りは、本当に「負け」なのか？』');
    expect(body).toContain('日時：8月25日（火）20:30〜22:00');
  });

  test('リマインドにテーマが入る', () => {
    expect(morningReminderMessages(WITH_THEME, ZOOM)[1]).toContain('🎓 安売りは');
    expect(preLectureReminderMessages(WITH_THEME, ZOOM)[1]).toContain('🎓 安売りは');
  });
});

describe('テーマが無い学校', () => {
  // 空文字のまま組み立てると『』や「🎓 」だけの行が残り、壊れて見える。
  test('申込完了に空の『』を残さない', () => {
    const [, body] = bookingConfirmMessages(NO_THEME, ZOOM);
    expect(body).not.toContain('『』');
    expect(body).toContain('オンラインzoom開催\n スマホ、顔出しなしでもOK');
    expect(body).toContain('☕ 青山塾');
  });

  test('リマインドに空の🎓行を残さない', () => {
    for (const messages of [morningReminderMessages(NO_THEME, ZOOM), preLectureReminderMessages(NO_THEME, ZOOM)]) {
      const body = messages[1];
      expect(body).not.toContain('🎓');
      // 区切り線が連続しても崩れない形であること。
      expect(body).toContain('📅 本日 12:00〜13:00\n━━━━━━━━━━━━━');
      expect(body).toContain(ZOOM.url);
    }
  });

  test('空白だけのテーマも無しとして扱う', () => {
    const [, body] = bookingConfirmMessages({ ...NO_THEME, theme: '   ' }, ZOOM);
    expect(body).not.toContain('『');
  });
});
