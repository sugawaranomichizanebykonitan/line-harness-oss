/**
 * WAHMS リッチメニューの Flex 応答。
 *
 * 「今週の開催日」と「受講者の声」は Apps Script が組み立てていた。見た目を
 * 変えずにそのまま移す。違うのは開催日の出どころだけで、コードの辞書ではなく
 * D1 の開催予定 (event_slots) を読む。
 */

import type { WeekEntry } from './wahms-schedule.js';

const NAVY = '#1F3864';
const GOLD = '#C8A752';
const WHITE = '#FFFFFF';
const LIGHT_GOLD = '#FFF8E1';

/** 受講者の声。Apps Script のコードに直書きされていた内容をそのまま持つ。 */
export const TESTIMONIALS: {
  name: string; job: string; journey: string; rating: number; summary: string; image: string;
}[] = [
  {
    "name": "齋藤 圭亮",
    "job": "営業マン",
    "journey": "セールス学校 → マーケティング学校",
    "rating": 5.0,
    "summary": "「売り込むな、聞け」を学び、ヒアリングで本音を引き出す質問力を鍛えました。お客様から「齋藤さんは他の営業と違う」と言われるように。マーケで3D-CMF理論を知り、提案の精度が劇的に変わりました。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50089/image/_/"
  },
  {
    "name": "久保 日向太",
    "job": "営業マン",
    "journey": "セールス学校 → 人間力学校",
    "rating": 5.0,
    "summary": "入社1年目で営業成績に伸び悩む中、自分の聴く姿勢のなさに気づきました。質問力と人間力を磨き、「久保さんだから頼みたい」と言われるように。反論処理を学び、商談の質が一段上がりました。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50090/image/_/"
  },
  {
    "name": "岡部 ちよ",
    "job": "経理",
    "journey": "マネジメント学校 → 青山塾",
    "rating": 5.0,
    "summary": "経理に関係ないと思っていたマネジメント学校。「成果=再現性×速度×品質」と学び、数字も成果を測る言語だと気づきました。月次報告の差し戻しが月3回からほぼゼロに。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50091/image/_/"
  },
  {
    "name": "吉村 せいこ",
    "job": "SNSマーケティング",
    "journey": "マーケティング学校 → WEB学校",
    "rating": 5.0,
    "summary": "3D-CMF理論を学び、自社のSNS発信が自分本位だったと気づきました。購買心理18パターンで投稿の切り口が広がり、Instagramのエンゲージメントが2倍以上に。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50092/image/_/"
  },
  {
    "name": "鈴木 はるな",
    "job": "人事",
    "journey": "人間力学校 → マネジメント学校",
    "rating": 5.0,
    "summary": "「言語化できない人は評価されない」が刺さりました。傾聴力を磨き、相手本位で考える習慣がつき、面接の質と社内コミュニケーションが大きく向上しました。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50093/image/_/"
  },
  {
    "name": "川島 ゆみ",
    "job": "動画クリエイター",
    "journey": "WEB学校 → マーケティング学校",
    "rating": 5.0,
    "summary": "AI活用術でコンテキスト設計を学び、YouTube脚本の制作時間が大幅短縮。WEB学校のサイト設計の論理思考が活き、誰が作っても同じクオリティを実現できるようになりました。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50094/image/_/"
  },
  {
    "name": "谷口 かなこ",
    "job": "秘書",
    "journey": "青山塾 → 人間力学校",
    "rating": 5.0,
    "summary": "人間力学校を中心に学び、経営者の判断の背景や他メンバーの視点が理解できるように。先回りして情報を整理し、判断しやすい状態を整える秘書業務に変わりました。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50095/image/_/"
  },
  {
    "name": "廣 みわこ",
    "job": "WEBデザイナー",
    "journey": "WEB学校 → セールス学校",
    "rating": 5.0,
    "summary": "デザインは美しさではなく成果を出す設計だと学びました。セールスのヒアリング力を活かし、お客様が本当に求めるものが聴けるように。サイトの修正回数が激減しました。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50096/image/_/"
  },
  {
    "name": "石川 航",
    "job": "フロントエンドエンジニア",
    "journey": "WEB学校 → マネジメント学校",
    "rating": 5.0,
    "summary": "「なぜこの機能が必要か」を語れるエンジニアになれました。顧客導線の設計思想と検索を意識した構造で実装の優先順位を自分で判断できるように。社内のAI推進リーダーに抜擢されました。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50097/image/_/"
  },
  {
    "name": "渡邉 大也",
    "job": "WEBディレクター",
    "journey": "全学校参加",
    "rating": 5.0,
    "summary": "ディレクターに必要な5つの力（セールス・マーケ・WEB・マネジメント・人間力）が全部学べる場所はここしかない。火曜の学びが木曜に活き、金曜の学びが土曜に深まる。「1つの成長の旅」です。",
    "image": "https://guardian.jpn.com/_img/ja/cms_parts_library/50098/image/_/"
  }
];

/**
 * 今週の開催日 Flex。
 *
 * 開催が無い日はグレーの「休講」カードにする (申込ボタンを出さない)。
 */
export function weeklyScheduleFlex(week: WeekEntry[]): object {
  const bodyContents: object[] = [
    {
      type: 'box', layout: 'vertical',
      backgroundColor: LIGHT_GOLD, cornerRadius: '12px', paddingAll: '14px',
      contents: [
        { type: 'text', text: '📅 今週の開催スケジュール', color: NAVY, size: 'md', weight: 'bold', align: 'center' },
        { type: 'text', text: '気になる学校をタップで申込', color: '#888888', size: 'xs', align: 'center', margin: 'xs' },
      ],
    },
  ];

  for (const s of week) {
    const dateLabel = `${s.month}月${s.dayOfMonth}日（${s.day}）`;
    if (!s.held) {
      bodyContents.push({
        type: 'box', layout: 'vertical', margin: 'md',
        backgroundColor: '#E8E8E8', cornerRadius: '12px', paddingAll: '14px',
        contents: [
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: `${s.emoji} ${s.label}`, color: '#999999', size: 'md', weight: 'bold', flex: 3, wrap: true },
              { type: 'text', text: '休講', color: '#999999', size: 'sm', weight: 'bold', align: 'end', flex: 1 },
            ],
          },
          { type: 'text', text: dateLabel, color: '#AAAAAA', size: 'xs', margin: 'sm' },
          { type: 'text', text: '開催はありません', color: '#999999', size: 'xs', margin: 'sm', wrap: true },
        ],
      });
      continue;
    }

    bodyContents.push({
      type: 'box', layout: 'vertical', margin: 'md',
      backgroundColor: NAVY, cornerRadius: '12px', paddingAll: '14px',
      action: { type: 'message', label: '申込む', text: s.bookingText },
      contents: [
        {
          type: 'box', layout: 'horizontal',
          contents: [
            { type: 'text', text: `${s.emoji} ${s.label}`, color: WHITE, size: 'md', weight: 'bold', flex: 3, wrap: true },
            { type: 'text', text: s.rating == null ? '★ ─' : `★ ${s.rating.toFixed(1)}`, color: GOLD, size: 'sm', weight: 'bold', align: 'end', flex: 1 },
          ],
        },
        { type: 'text', text: `${dateLabel}${s.time}`, color: '#FFD966', size: 'xs', margin: 'sm' },
        { type: 'text', text: s.theme ?? '近日公開', color: WHITE, size: 'xs', margin: 'sm', wrap: true },
        {
          type: 'box', layout: 'vertical', margin: 'md',
          backgroundColor: GOLD, cornerRadius: '8px', paddingAll: '8px',
          contents: [{ type: 'text', text: '▶ タップで申込', color: NAVY, size: 'xs', weight: 'bold', align: 'center' }],
        },
      ],
    });
  }

  return {
    type: 'bubble',
    size: 'giga',
    header: {
      type: 'box', layout: 'vertical',
      backgroundColor: NAVY, paddingAll: '20px',
      contents: [
        { type: 'text', text: 'WAHMS', color: GOLD, size: 'sm', align: 'center', weight: 'bold' },
        { type: 'text', text: '今週の開催日', color: WHITE, size: 'xl', weight: 'bold', align: 'center', margin: 'sm' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: bodyContents,
    },
    footer: {
      type: 'box', layout: 'vertical',
      backgroundColor: NAVY, paddingAll: '12px',
      contents: [
        {
          type: 'text', text: '📱 スマホ1台でOK｜👤 顔出しなしOK｜💰 完全無料',
          color: '#FFD966', size: 'xs', align: 'center', wrap: true,
        },
      ],
    },
  };
}

function voiceCard(t: (typeof TESTIMONIALS)[number]): object {
  return {
    type: 'box', layout: 'horizontal', margin: 'md', spacing: 'md',
    backgroundColor: '#F8F9FB', cornerRadius: '10px', paddingAll: '12px',
    contents: [
      {
        type: 'box', layout: 'vertical', flex: 2,
        contents: [
          {
            type: 'box', layout: 'vertical', cornerRadius: '8px',
            contents: [{ type: 'image', url: t.image, aspectMode: 'cover', aspectRatio: '1:1', size: 'full' }],
          },
          { type: 'text', text: t.name, color: NAVY, size: 'sm', weight: 'bold', align: 'center', margin: 'sm', wrap: true },
          { type: 'text', text: `★ ${t.rating.toFixed(1)}`, color: GOLD, size: 'xs', weight: 'bold', align: 'center', margin: 'xs' },
        ],
      },
      {
        type: 'box', layout: 'vertical', flex: 3,
        contents: [
          { type: 'text', text: '【職業】', color: '#888888', size: 'xs' },
          { type: 'text', text: t.job, color: NAVY, size: 'md', weight: 'bold', margin: 'xs', wrap: true },
          { type: 'text', text: '【参加学校】', color: '#888888', size: 'xs', margin: 'md' },
          { type: 'text', text: t.journey, color: '#333333', size: 'xs', margin: 'xs', wrap: true, weight: 'bold' },
          { type: 'separator', margin: 'sm', color: '#E0E0E0' },
          { type: 'text', text: `「${t.summary}」`, color: '#333333', size: 'xs', wrap: true, margin: 'sm' },
        ],
      },
    ],
  };
}

function weeklyFooter(): object {
  return {
    type: 'box', layout: 'vertical',
    backgroundColor: NAVY, paddingAll: '12px',
    action: { type: 'message', label: '今週の開催日', text: '今週の開催日' },
    contents: [{ type: 'text', text: '▶ 今週の開催を見る', color: GOLD, size: 'sm', weight: 'bold', align: 'center' }],
  };
}

/** 受講者の声 Flex (カルーセル)。1枚目が統計＋ピックアップ3名、以降は2名ずつ。 */
export function testimonialsFlex(): object {
  const bubble1 = {
    type: 'bubble', size: 'giga',
    header: {
      type: 'box', layout: 'vertical',
      backgroundColor: NAVY, paddingAll: '20px',
      contents: [
        { type: 'text', text: '🎤 受講者のリアルな声', color: GOLD, size: 'sm', align: 'center', weight: 'bold' },
        { type: 'text', text: 'WAHMS', color: WHITE, size: 'xl', weight: 'bold', align: 'center', margin: 'sm' },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
      contents: [
        {
          type: 'box', layout: 'vertical',
          backgroundColor: LIGHT_GOLD, cornerRadius: '12px', paddingAll: '16px',
          contents: [
            { type: 'text', text: '全体満足度', color: '#888888', size: 'xs', align: 'center' },
            { type: 'text', text: '★4.9 / 5.0', color: NAVY, size: 'xl', weight: 'bold', align: 'center', margin: 'sm' },
            { type: 'separator', margin: 'md', color: '#FFD966' },
            { type: 'text', text: '🤩「無料なのが信じられない」', color: '#5C4400', size: 'xs', align: 'center', weight: 'bold', margin: 'md' },
            { type: 'text', text: 'と答えた人 80%', color: NAVY, size: 'lg', weight: 'bold', align: 'center', margin: 'xs' },
          ],
        },
        { type: 'separator', margin: 'lg', color: '#E0E0E0' },
        { type: 'text', text: '── ピックアップの声 ──', color: '#888888', size: 'xs', align: 'center', margin: 'lg' },
      ] as object[],
    },
    footer: weeklyFooter(),
  };

  for (const t of [TESTIMONIALS[0], TESTIMONIALS[1], TESTIMONIALS[9]]) {
    bubble1.body.contents.push(voiceCard(t));
  }

  const bubbles: object[] = [bubble1];
  const others = TESTIMONIALS.slice(2, 9);
  let part = 2;
  for (let i = 0; i < others.length; i += 2) {
    const chunk = others.slice(i, i + 2);
    bubbles.push({
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical',
        backgroundColor: NAVY, paddingAll: '16px',
        contents: [
          { type: 'text', text: '🎤 受講者の声', color: GOLD, size: 'sm', align: 'center', weight: 'bold' },
          { type: 'text', text: `Part ${part}`, color: WHITE, size: 'lg', weight: 'bold', align: 'center', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: chunk.map(voiceCard),
      },
      footer: weeklyFooter(),
    });
    part += 1;
  }

  return { type: 'carousel', contents: bubbles };
}
