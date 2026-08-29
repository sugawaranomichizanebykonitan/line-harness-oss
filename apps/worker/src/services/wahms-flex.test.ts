import { describe, expect, test } from 'vitest';
import { TESTIMONIALS, testimonialsFlex, weeklyScheduleFlex } from './wahms-flex.js';
import type { WeekEntry } from './wahms-schedule.js';

// リッチメニューの Flex。見た目は Apps Script のものをそのまま移しているので、
// 崩れやすいところ (休講カード・満足度・申込ボタンの文言) を固定する。

function entry(over: Partial<WeekEntry> = {}): WeekEntry {
  return {
    keyword: 'WEB学校', emoji: '💻', label: 'WEB学校', day: '水',
    date: '2026-08-26', month: 8, dayOfMonth: 26,
    held: true, time: '20:30〜22:00', theme: 'テーマW', rating: 4.86,
    bookingText: '8月26日WEB学校に申し込む',
    ...over,
  };
}

/** Flex の中から text をすべて拾う。入れ子が深いので再帰で見る。 */
function texts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!node || typeof node !== 'object') return [];
  const o = node as Record<string, unknown>;
  const own = o.type === 'text' && typeof o.text === 'string' ? [o.text] : [];
  return [...own, ...Object.values(o).flatMap(texts)];
}

function actions(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(actions);
  if (!node || typeof node !== 'object') return [];
  const o = node as Record<string, unknown>;
  const own = o.action && typeof o.action === 'object' ? [o.action as Record<string, unknown>] : [];
  return [...own, ...Object.values(o).flatMap(actions)];
}

describe('今週の開催日 Flex', () => {
  test('開催する回はタップで申込文言を送る', () => {
    const flex = weeklyScheduleFlex([entry()]);
    const tapped = actions(flex).filter((a) => a.type === 'message');
    expect(tapped).toContainEqual({ type: 'message', label: '申込む', text: '8月26日WEB学校に申し込む' });
    expect(texts(flex)).toContain('8月26日（水）20:30〜22:00');
    expect(texts(flex)).toContain('テーマW');
  });

  test('満足度は小数第1位まで。回答が無ければ横線', () => {
    expect(texts(weeklyScheduleFlex([entry({ rating: 4.86 })]))).toContain('★ 4.9');
    expect(texts(weeklyScheduleFlex([entry({ rating: null })]))).toContain('★ ─');
  });

  test('休講の回は申込ボタンを出さない', () => {
    const flex = weeklyScheduleFlex([entry({ held: false })]);
    expect(texts(flex)).toContain('休講');
    expect(texts(flex)).toContain('開催はありません');
    expect(actions(flex).filter((a) => a.type === 'message' && a.label === '申込む')).toHaveLength(0);
  });

  test('テーマが未定なら「近日公開」と出す', () => {
    expect(texts(weeklyScheduleFlex([entry({ theme: null })]))).toContain('近日公開');
  });

  test('6校ぶん並べても1つのバブルに収まる', () => {
    const week = ['マーケティング学校', '青山塾', 'WEB学校', 'セールス学校', 'マネジメント学校', '人間力学校']
      .map((keyword) => entry({ keyword, label: keyword }));
    const flex = weeklyScheduleFlex(week) as { type: string; body: { contents: unknown[] } };
    expect(flex.type).toBe('bubble');
    // 見出し1つ + 6校
    expect(flex.body.contents).toHaveLength(7);
  });
});

describe('受講者の声 Flex', () => {
  test('10名を1枚目3名＋2名ずつのカルーセルにする', () => {
    const flex = testimonialsFlex() as { type: string; contents: unknown[] };
    expect(flex.type).toBe('carousel');
    // 1枚目 (統計+3名) と、残り7名を2名ずつ = 4枚 → 合計5枚
    expect(flex.contents).toHaveLength(5);
    expect(TESTIMONIALS).toHaveLength(10);
  });

  test('全員がどこかの1枚に載る', () => {
    const all = texts(testimonialsFlex());
    for (const t of TESTIMONIALS) expect(all).toContain(t.name);
  });

  test('カルーセルはLINEの上限12枚を超えない', () => {
    const flex = testimonialsFlex() as { contents: unknown[] };
    expect(flex.contents.length).toBeLessThanOrEqual(12);
  });
});
