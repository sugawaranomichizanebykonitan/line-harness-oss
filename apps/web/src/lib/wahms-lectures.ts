// WAHMS 各学校の講義マスター（第11回〜第20回）。
// アーカイブ登録画面で回を選ぶとテーマが自動で入り、日付とYouTube URLだけ
// 入力すれば済むようにするためのもの。
//
// 学校名はD1の wahms_archives / wahms_applications に入っている絵文字付きの
// 表記に合わせている。ここがずれると既存データと突き合わない。
//
// 青山塾はテーマを設けない運用なので空文字。

export type WahmsLecture = { lecture: number; theme: string }

export const WAHMS_LECTURE_MASTER: Record<string, WahmsLecture[]> = {
  '🔥 マーケティング学校': [
    { lecture: 11, theme: 'なぜ集客は「単発ヒット」で終わるのか？｜仕組みで回すマーケティング' },
    { lecture: 12, theme: '一度買ったお客様は、なぜ戻ってこないのか？｜リピートと紹介の設計' },
    { lecture: 13, theme: '安売りは、本当に「負け」なのか？｜価格の裏に戦略を仕込む技術' },
    { lecture: 14, theme: '人はなぜ、商品ではなく「物語」を買うのか？｜ストーリーテリングの技術' },
    { lecture: 15, theme: 'その数字は「相関」か「因果」か？｜勘のマーケティングを卒業する' },
    { lecture: 16, theme: 'お客様の声は、なぜ最強の営業マンになるのか？｜レビュー・事例活用術' },
    { lecture: 17, theme: '月3万円の広告費に、勝ち筋はあるのか？｜小予算広告の実戦' },
    { lecture: 18, theme: 'ファンは「作る」ものか、「育つ」ものか？｜コミュニティ・マーケティング' },
    { lecture: 19, theme: 'AIエージェント時代、マーケターの仕事はどこまで任せられるのか？' },
    { lecture: 20, theme: '総集編｜「1年間回り続けるマーケティング運用計画」を自分で作る' },
  ],
  '☕ 青山塾': [
    { lecture: 11, theme: '' },
    { lecture: 12, theme: '' },
    { lecture: 13, theme: '' },
    { lecture: 14, theme: '' },
    { lecture: 15, theme: '' },
    { lecture: 16, theme: '' },
    { lecture: 17, theme: '' },
    { lecture: 18, theme: '' },
    { lecture: 19, theme: '' },
    { lecture: 20, theme: '' },
  ],
  '💻 WEB学校': [
    { lecture: 11, theme: 'そのサイト、作り直すべきか？育てるべきか？｜リニューアル判断の分岐点' },
    { lecture: 12, theme: 'なぜサイトの更新は、3ヶ月で止まるのか？｜「育てる運用」の凡事徹底' },
    { lecture: 13, theme: 'Googleマップで選ばれる店は、何をしているのか？｜MEO実践' },
    { lecture: 14, theme: 'SNSとホームページ、役割分担の正解はどこにあるのか？' },
    { lecture: 15, theme: 'サイトの未来は「予言」できるのか？｜順位が死ぬ日・崩れる前兆の読み方' },
    { lecture: 16, theme: 'フォームの手前で、なぜ7割の人は消えるのか？｜入力フォーム改善（EFO）' },
    { lecture: 17, theme: 'サイトに「AI店員」を置くと、何が変わるのか？｜AI接客・チャットボット' },
    { lecture: 18, theme: 'AI検索に「引用されるサイト」と「無視されるサイト」は、何が違うのか？｜AIO実践' },
    { lecture: 19, theme: '文章が苦手でも「伝わるサイト」は作れるのか？｜写真・動画・図解の内製術' },
    { lecture: 20, theme: '総集編｜「90日サイト成長計画」を自分の手で完成させる' },
  ],
  '🤝 セールス学校': [
    { lecture: 11, theme: 'アポが取れない時代に、新規開拓はどう変わったのか？' },
    { lecture: 12, theme: '紹介が「自然に生まれる営業」は、何を仕込んでいるのか？' },
    { lecture: 13, theme: '商談は「間」で決まる？｜沈黙を武器にする近接戦闘' },
    { lecture: 14, theme: '読まれる提案書と、捨てられる提案書は、どこで分かれるのか？' },
    { lecture: 15, theme: '「負けない交渉」と「勝ちすぎない交渉」の境界線はどこか？' },
    { lecture: 16, theme: 'なぜあの人の商談は、「一回」で決まるのか？' },
    { lecture: 17, theme: '負け商談は、なぜ宝の山なのか？｜失注分析の技術' },
    { lecture: 18, theme: '売れる営業の技術は、なぜ組織に広がらないのか？｜属人化の壊し方' },
    { lecture: 19, theme: 'AIは商談の「振り返り」をどこまで肩代わりできるのか？｜AI商談解析' },
    { lecture: 20, theme: '総集編｜自分の営業を「人に教えられるレベル」まで言語化する' },
  ],
  '📈 マネジメント学校': [
    { lecture: 11, theme: '良い人が来ない会社は、何を間違えているのか？｜採用はマネジメントだ' },
    { lecture: 12, theme: '「教えたのにできない」は、誰の責任か？｜人が育つOJT設計' },
    { lecture: 13, theme: '「頑張り」ではなく「成果」で評価する仕組みは、作れるのか？' },
    { lecture: 14, theme: 'チームの士気は、リーダーが上げられるものなのか？' },
    { lecture: 15, theme: '言いにくいことを、関係を壊さずに伝える技術はあるのか？' },
    { lecture: 16, theme: 'なぜ問題は、いつも「手遅れ」で発覚するのか？｜気づける組織の作り方' },
    { lecture: 17, theme: 'リーダーが一人で抱える組織は、なぜ壊れるのか？｜サブリーダーと差配の技術' },
    { lecture: 18, theme: '部下より先に、自分をマネジメントできているか？｜リーダーのセルフマネジメント' },
    { lecture: 19, theme: 'AIエージェントは「部下」になれるのか？｜AIと働く組織の作り方' },
    { lecture: 20, theme: '総集編｜自分の「マネジメント憲法」を1枚にまとめる' },
  ],
  '☀️ 人間力学校': [
    { lecture: 11, theme: '結局は日常でしかない｜「凡事徹底」を自分の24時間に実装する' },
    { lecture: 12, theme: '「正しい努力」とは何か？｜量と方向を同時に管理する技術' },
    { lecture: 13, theme: '「考える」と「悩む」は、何が違うのか？' },
    { lecture: 14, theme: '「即時言語化」は、鍛えられるのか？｜その場で言葉にする力' },
    { lecture: 15, theme: '苦手な人と、どう付き合えばいいのか？｜「相手本位」の実戦' },
    { lecture: 16, theme: '目の前に囚われる人と、全体が見える人｜「俯瞰性能」の鍛え方' },
    { lecture: 17, theme: '裏切られても、人を信じるという選択｜折れない人の回復術' },
    { lecture: 18, theme: '「知識×経験＝智慧」｜大人の学びが智慧に変わる瞬間' },
    { lecture: 19, theme: '信頼残高は、どう貯まり、どう一瞬で失われるのか' },
    { lecture: 20, theme: '総集編｜魅力と器量の実践 ― 20回の旅で、あなたはどう変わったか' },
  ],
}

/** マスターに載っている学校の一覧（表示順は定義順）。 */
export const WAHMS_SCHOOLS = Object.keys(WAHMS_LECTURE_MASTER)

/** 学校と回からテーマを引く。マスターに無ければ空文字。 */
export function lectureTheme(school: string, lecture: number): string {
  return WAHMS_LECTURE_MASTER[school]?.find((l) => l.lecture === lecture)?.theme ?? ''
}
