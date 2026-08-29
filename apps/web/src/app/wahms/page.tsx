'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { wahmsApi, type WahmsOverview } from '@/lib/api'
import { WAHMS_LECTURE_MASTER, WAHMS_SCHOOLS } from '@/lib/wahms-lectures'

/** 日本時間の今日 (YYYY-MM-DD)。開催日の判定は必ずJSTで行う。 */
function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

type Tab = 'participants' | 'schedule' | 'surveys' | 'archives' | 'delivery'

const tabLabels: Record<Tab, string> = {
  participants: '参加者管理', schedule: '開催予定', surveys: '講義アンケート', archives: 'アーカイブ', delivery: '配信',
}

function dateLabel(value?: string): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('ja-JP')
}

function Stat({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return <div className={`rounded-xl border p-4 ${accent ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}>
    <p className="text-xs text-gray-500">{label}</p><p className={`mt-1 text-2xl font-bold ${accent ? 'text-amber-700' : 'text-gray-900'}`}>{value}</p>
  </div>
}

/**
 * Web版アンケート（LINE未登録の受講者）からの回答か。
 * line_user_id に 'web-' を入れて区別している。LINE返信ができない相手なので、
 * 一覧で見分けられるようにする。
 */
function isWebResponse(s: WahmsOverview['surveys'][number]): boolean {
  return String(s.line_user_id ?? '').startsWith('web-')
}

/**
 * 「返信対応しない」と決めた質問か。
 * response_status には CHECK 制約があり値を増やせないので、別の列で持っている。
 */
function isReplySkipped(s: WahmsOverview['surveys'][number]): boolean {
  return Number(s.reply_skipped ?? 0) === 1
}

/**
 * 「返信対応しない」ボタン。押すと要対応リストから外れる。
 *
 * 戻す操作を画面に用意していないので、押す前に一度確認する。
 */
function SkipReplyButton({ surveyId, onSkip }: { surveyId: string; onSkip: (id: string) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return <button onClick={() => setConfirming(true)} className="mt-3 rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50">返信対応しない</button>
  }
  return <div className="mt-3 rounded-lg border border-gray-300 bg-white p-3">
    <p className="text-sm text-gray-700">要対応から外し、通常のアンケート結果として扱います。よろしいですか？</p>
    <div className="mt-2 flex gap-2">
      <button onClick={() => { setConfirming(false); void onSkip(surveyId) }} className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-bold text-white">外す</button>
      <button onClick={() => setConfirming(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-600">やめる</button>
    </div>
  </div>
}

/** 申込の開催日を YYYY-MM-DD に揃える。'2026/08/21' 形式が混ざるため。 */
function eventDay(value?: string | null): string {
  return String(value || '').slice(0, 10).replace(/\//g, '-')
}

/** 配信画面で選ぶ講義。申込由来と開催予定由来を同じ形にそろえる。 */
type LectureOption = { id: string; school_name: string; event_date: string; theme?: string }

/** 時刻の秒を落とす。開催予定は 20:30:00 の形で返ってくる。 */
function hhmm(value?: string): string {
  return String(value || '').slice(0, 5)
}

/** その日に開催予定の講義。申込が0件でも、時間とテーマはここから出せる。 */
function lectureOn(lectures: WahmsOverview['lectures'], school: string, day: string) {
  return (lectures || []).find((l) => l.event_date === day && (!school || l.school_name === school))
}

/**
 * 「本日の講義に何名申し込んでいるか」を一目で出す。
 * 当日の運営で最初に知りたい数字なので、一覧を数えなくても分かるようにする。
 *
 * 申込が0件でも同じ見た目で0名と出す。ここで数えているのは公式LINE経由の
 * 申込だけで、社内参加者や紹介参加者は入っていない。0件を「開催なし」と
 * 書くと実際には開催しているのに開催が無いと読めてしまう。
 */
function TodayPanel({ applications, lectures, school }: { applications: WahmsOverview['applications']; lectures: WahmsOverview['lectures']; school: string }) {
  const today = todayJst()
  const scoped = school ? applications.filter((a) => a.school_name === school) : applications
  const todays = scoped.filter((a) => eventDay(a.event_date) === today)
  const dayLabel = new Date(today).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })

  // 同じ日に同じ学校が複数枠あることは無い想定だが、念のため学校ごとにまとめる。
  const groups = new Map<string, typeof todays>()
  for (const a of todays) {
    const list = groups.get(a.school_name) ?? []
    list.push(a); groups.set(a.school_name, list)
  }

  const cards: Array<{ name: string; time: string; theme: string; count: number }> = todays.length > 0
    ? Array.from(groups.entries()).map(([name, list]) => {
        const planned = lectureOn(lectures, name, today)
        return {
          name,
          time: String(list[0].event_time || '')
            || (planned ? `${hhmm(planned.start_time)}〜${hhmm(planned.end_time)}` : ''),
          theme: `${planned?.lecture_label ? `${planned.lecture_label}　` : ''}${String(list[0].theme || planned?.theme || '')}`,
          count: list.length,
        }
      })
    // 申込0件の日は申込テーブルに開催情報が無い。開催予定から引く。
    : (() => {
        const planned = lectureOn(lectures, school, today)
        return [{
          name: planned?.school_name || school || '全校',
          time: planned ? `${hhmm(planned.start_time)}〜${hhmm(planned.end_time)}` : '',
          theme: planned
            ? `${planned.lecture_label ? `${planned.lecture_label}　` : ''}${planned.theme || ''}`
            : '本日の開催予定はありません',
          count: 0,
        }]
      })()

  return <div className="mb-4 space-y-3">
    {cards.map((card) => <div key={card.name} className="flex flex-col gap-3 rounded-xl border-2 border-green-500 bg-green-50 p-4 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-green-700">本日 {dayLabel}</p>
        <p className="mt-1 font-bold text-gray-900">{card.name}{card.time ? `　${card.time}` : ''}</p>
        <p className="mt-0.5 truncate text-sm text-gray-600">{card.theme || 'テーマ未登録'}</p>
      </div>
      <div className="shrink-0 text-center md:text-right">
        <span className="text-4xl font-bold text-green-700">{card.count}</span>
        <span className="ml-1 text-sm font-bold text-green-700">名 申込</span>
      </div>
    </div>)}
    <p className="text-xs text-gray-500">
      申込数は公式LINEからの申込のみです。社内参加者・紹介参加者は含みません。
    </p>
  </div>
}

export default function WahmsPage() {
  const { selectedAccount, selectedAccountId, loading: accountLoading } = useAccount()
  const [tab, setTab] = useState<Tab>('participants')
  const [data, setData] = useState<WahmsOverview | null>(null)
  const [school, setSchool] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const isWahms = Boolean(selectedAccount && (selectedAccount.displayName || selectedAccount.name).toUpperCase().includes('WAHMS'))

  const refresh = useCallback(async () => {
    if (!selectedAccountId || !isWahms) return
    setLoading(true); setError('')
    try {
      const res = await wahmsApi.overview(selectedAccountId, { school, search })
      if (!res.success) throw new Error(res.error)
      setData(res.data)
    } catch (e) { setError(e instanceof Error ? e.message : '読み込みに失敗しました') }
    finally { setLoading(false) }
  }, [selectedAccountId, isWahms, school, search])

  useEffect(() => { void refresh() }, [refresh])
  // 配信先に選べる講義。申込がまだ0件の回も選べないと、当日の朝に
  // アンケートを準備できない。開催予定と申込の両方から作る。
  const eventOptions = useMemo<LectureOption[]>(() => {
    const seen = new Set<string>()
    const out: LectureOption[] = []
    const push = (schoolName: string, rawDate: string, theme?: string) => {
      const day = eventDay(rawDate)
      if (!schoolName || !day) return
      const key = `${schoolName}|${day}`
      if (seen.has(key)) return
      seen.add(key)
      out.push({ id: key, school_name: schoolName, event_date: day, theme })
    }
    for (const a of data?.applications || []) push(String(a.school_name), String(a.event_date || ''), a.theme as string)
    for (const l of data?.lectures || []) push(l.school_name, l.event_date, l.theme)
    return out
  }, [data])

  if (accountLoading) return <><Header title="WAHMS運営" /><div className="p-8 text-gray-500">読み込み中...</div></>
  if (!isWahms) return <><Header title="WAHMS運営" /><div className="max-w-2xl mx-auto p-8"><div className="rounded-xl border border-gray-200 bg-white p-8 text-center"><h1 className="text-xl font-bold">WAHMS専用機能です</h1><p className="mt-2 text-gray-500">左上のLINEアカウントを「WAHMS」に切り替えると表示されます。</p></div></div></>

  const flash = (message: string) => { setNotice(message); setTimeout(() => setNotice(''), 5000) }

  // 返信するほどでもない質問を要対応から外す。LINEへは何も送らない。
  const skipReply = async (surveyId: string) => {
    if (!selectedAccountId) return
    try {
      await wahmsApi.skipReply(selectedAccountId, surveyId)
      flash('返信対応しないことにしました。要対応リストから外れます')
      await refresh()
    } catch { setError('変更できませんでした。時間をおいて試してください。') }
  }

  return <>
    <Header title="WAHMS運営" />
    <main className="mx-auto max-w-7xl p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">WAHMS 参加者・講義管理</h1>
        <p className="mt-1 text-sm text-gray-500">申込者、アンケート、アーカイブ、配信をまとめて管理できます。</p>
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-700">{notice}</div>}
      <div className="mb-5 flex gap-2 overflow-x-auto border-b border-gray-200">
        {(Object.keys(tabLabels) as Tab[]).map((key) => <button key={key} onClick={() => setTab(key)} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${tab === key ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500'}`}>{tabLabels[key]}{key === 'surveys' && data?.summary.pendingQuestions ? <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{data.summary.pendingQuestions}</span> : null}</button>)}
      </div>

      {loading && !data ? <div className="p-12 text-center text-gray-500">データを読み込んでいます...</div> : null}

      {tab === 'participants' && data && <section>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="登録者" value={`${data.summary.participants}名`} /><Stat label="申込件数" value={`${data.summary.applications}件`} /><Stat label="学校数" value={`${data.schools.length}校`} /><Stat label="アンケート回答" value={`${data.summary.surveyResponses}件`} />
        </div>
        <div className="mb-4 flex flex-col gap-3 rounded-xl border bg-white p-4 md:flex-row">
          <select value={school} onChange={(e) => setSchool(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">すべての学校</option>{data.schools.map((s) => <option key={s.school_name} value={s.school_name}>{s.school_name}（{s.application_count}件）</option>)}</select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="名前・LINE名・職業で検索" className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <button onClick={() => void refresh()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">検索</button>
        </div>
        <TodayPanel applications={data.applications} lectures={data.lectures} school={school} />
        {school ? <div className="overflow-hidden rounded-xl border bg-white"><div className="border-b bg-gray-50 px-4 py-3 font-bold">{school} の申込者</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="p-3">参加者</th><th className="p-3">開催日</th><th className="p-3">時間</th><th className="p-3">テーマ</th><th className="p-3">実参加</th></tr></thead><tbody>{data.applications.map((a) => <tr key={a.id} className={`border-t ${eventDay(a.event_date) === todayJst() ? 'bg-green-50' : ''}`}><td className="p-3 font-medium">{a.participant_name || '名前未登録'}{eventDay(a.event_date) === todayJst() && <span className="ml-2 rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white">本日</span>}</td><td className="p-3">{dateLabel(a.event_date)}</td><td className="p-3">{a.event_time || '—'}</td><td className="max-w-md p-3">{a.theme || '—'}</td><td className="p-3">{a.attended == null ? '未確認' : a.attended ? '参加' : '不参加'}</td></tr>)}</tbody></table></div></div>
        : <div className="overflow-hidden rounded-xl border bg-white"><div className="border-b bg-gray-50 px-4 py-3 font-bold">登録者一覧</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="p-3">名前</th><th className="p-3">LINE表示名</th><th className="p-3">職業</th><th className="p-3">申込</th><th className="p-3">ステータス</th></tr></thead><tbody>{data.participants.map((p) => <tr key={p.id} className="border-t"><td className="p-3 font-medium">{p.name || '未登録'}</td><td className="p-3">{p.line_display_name || '—'}</td><td className="p-3">{p.occupation || '—'}</td><td className="p-3">{Number(p.booking_count || 0)}回</td><td className="p-3">{p.status || '—'}</td></tr>)}</tbody></table></div></div>}
      </section>}

      {tab === 'surveys' && data && <section>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="回答者数" value={`${data.summary.surveyResponses}名`} /><Stat label="平均得点" value={data.summary.averageSatisfaction == null ? '—' : `${data.summary.averageSatisfaction.toFixed(2)} / 5`} /><Stat label="無料なのが信じられない率" value={`${data.summary.unbelievableRate.toFixed(1)}%`} /><Stat label="要対応の質問" value={`${data.summary.pendingQuestions}件`} accent={data.summary.pendingQuestions > 0} /></div>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1"><button onClick={() => setSchool('')} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${!school ? 'bg-green-600 text-white' : 'bg-white border'}`}>全学校</button>{data.schools.map((s) => <button key={s.school_name} onClick={() => setSchool(s.school_name)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${school === s.school_name ? 'bg-green-600 text-white' : 'bg-white border'}`}>{s.school_name}</button>)}</div>
        <div className="space-y-3">{data.surveys.map((s) => <article key={s.id} className="rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">{s.school_name}</span><span className="text-xs text-gray-500">{dateLabel(s.responded_at)}</span>{isWebResponse(s) && <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700">Web回答</span>}{s.response_status === 'pending' && !isReplySkipped(s) && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">要対応</span>}{s.response_status === 'completed' && <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">対応完了</span>}{isReplySkipped(s) && <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">返信不要</span>}</div><div className="mt-3 grid gap-3 text-sm md:grid-cols-4"><div><span className="text-gray-500">回答者</span><p className="font-medium">{s.respondent_name || '名前未登録'}</p></div><div><span className="text-gray-500">満足度</span><p className="font-medium">{s.satisfaction ? `${s.satisfaction} / 5` : '—'}</p></div><div><span className="text-gray-500">価値評価</span><p className="font-medium">{s.value_rating || '—'}</p></div><div><span className="text-gray-500">次回参加意向</span><p className="font-medium">{s.next_intent || '—'}</p></div></div>{s.question && <div className="mt-4 rounded-lg bg-amber-50 p-3"><p className="text-xs font-bold text-amber-700">青山さんへの質問</p><p className="mt-1 text-sm text-gray-800">{s.question}</p>{s.response_status === 'completed' ? <div className="mt-3 border-t border-amber-200 pt-3"><p className="text-xs font-bold text-gray-500">返信済み</p><p className="mt-1 text-sm">{s.answer}</p></div> : isReplySkipped(s) ? <div className="mt-3 border-t border-amber-200 pt-3 text-sm text-gray-600">返信対応しないことにした質問です。集計には含まれています。</div> : isWebResponse(s) ? <div className="mt-3 border-t border-amber-200 pt-3"><p className="text-sm text-gray-600">この方は公式LINE未登録のため、ここからは返信できません。別の手段でご連絡ください。</p><SkipReplyButton surveyId={s.id} onSkip={skipReply} /></div> : <div className="mt-3 flex flex-col gap-2 md:flex-row"><textarea value={answers[s.id] || ''} onChange={(e) => setAnswers({ ...answers, [s.id]: e.target.value })} placeholder="ここに返信を入力" className="min-h-24 flex-1 rounded-lg border border-amber-300 bg-white p-3 text-sm" /><div className="flex flex-col gap-2"><button onClick={async () => { if (!selectedAccountId) return; try { await wahmsApi.reply(selectedAccountId, s.id, answers[s.id] || ''); flash('LINEへ返信し、対応完了にしました'); await refresh() } catch { setError('返信できませんでした。内容を確認してください。') } }} className="rounded-lg bg-green-600 px-5 py-3 font-bold text-white">LINEへ返信</button><SkipReplyButton surveyId={s.id} onSkip={skipReply} /></div></div>}</div>}</article>)}</div>
      </section>}

      {tab === 'schedule' && data && <ScheduleTab data={data} accountId={selectedAccountId!} refresh={refresh} flash={flash} setError={setError} />}
      {tab === 'archives' && data && <ArchiveTab data={data} accountId={selectedAccountId!} refresh={refresh} flash={flash} setError={setError} />}
      {tab === 'delivery' && data && <DeliveryTab data={data} accountId={selectedAccountId!} eventOptions={eventOptions} refresh={refresh} flash={flash} setError={setError} />}
    </main>
  </>
}

/**
 * 開催予定の操作。延期・休講・繰越を、ここだけで完結させる。
 *
 * 2026年8月に2週続けて延期が起き、そのたびに手作業でDBを直していた。
 * 危ないのは「受付を止めたのにリマインドが飛ぶ」で、実際に2回とも
 * 起きかけた。受付を止めるボタンが、その日のリマインドも一緒に止める。
 */
function ScheduleTab({ data, accountId, refresh, flash, setError }: { data: WahmsOverview; accountId: string; refresh: () => Promise<void>; flash: (s: string) => void; setError: (s: string) => void }) {
  const today = todayJst()
  const [busy, setBusy] = useState('')
  const [confirming, setConfirming] = useState<{ slotId: string; kind: 'shift' | 'shiftBack' | 'notify' } | null>(null)

  // 今日以降だけを出す。過ぎた回を操作しても意味がなく、押し間違いの元になる。
  const upcoming = useMemo(
    () => (data.lectures || []).filter((l) => l.event_date >= today).slice(0, 40),
    [data.lectures, today],
  )

  const run = async (slotId: string, label: string, fn: () => Promise<string>) => {
    setBusy(slotId + label)
    try { flash(await fn()); await refresh() }
    catch { setError('変更できませんでした。時間をおいて試してください。') }
    finally { setBusy(''); setConfirming(null) }
  }

  /** 失敗はそのまま投げて、呼び出し元のエラー表示に任せる。 */
  const ok = <T,>(r: { success: boolean; data?: T }): T => {
    if (!r.success || !r.data) throw new Error('failed')
    return r.data
  }

  const suspend = (slotId: string) => run(slotId, 'suspend', async () => {
    const d = ok(await wahmsApi.suspendLecture(accountId, slotId))
    return `${d.lecture} の受付を止めました。申込ボタンが消え、この日のリマインドも止まります（申込 ${d.applicants}名 / 止めた案内 ${d.remindersStopped}件）`
  })

  const resume = (slotId: string) => run(slotId, 'resume', async () => {
    const d = ok(await wahmsApi.resumeLecture(accountId, slotId))
    return `${d.lecture} の受付を再開しました`
  })

  const shift = (slotId: string, direction: 'forward' | 'back') => run(slotId, 'shift', async () => {
    const d = ok(await wahmsApi.shiftLectureWeek(accountId, slotId, direction))
    const way = direction === 'back' ? '前' : '後ろ'
    return `${d.lecture} を ${d.newDate} へ。以降の回も1週ずつ${way}にずらしました（枠 ${d.shiftedSlots}件 / 申込 ${d.movedApplications}件を移動）`
  })

  const notify = (slotId: string) => run(slotId, 'notify', async () => {
    const d = ok(await wahmsApi.notifyPostponed(accountId, slotId))
    return `延期のお知らせを ${d.success}名へ送りました${d.failure ? `（失敗 ${d.failure}名）` : ''}`
  })

  const applicantsOn = (l: WahmsOverview['lectures'][number]) =>
    data.applications.filter((a) => a.school_name === l.school_name && eventDay(a.event_date) === l.event_date).length

  return <section>
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-bold">延期・休講になったら「受付を止める」を押してください。</p>
      <p className="mt-1">申込ボタンが消え、その日のZoom案内（朝と開始30分前）も一緒に止まります。すでに申し込んでいる方には、右の「延期を知らせる」でご案内できます。</p>
      <p className="mt-2 text-xs">押し間違えても、<b>「受付を止める／再開する」と「1週間ずらす／戻す」は元に戻せます。</b>戻せないのは<b>「延期を知らせる」だけ</b>です（LINEは送信を取り消せないため、確認画面を挟んでいます）。</p>
    </div>

    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="border-b bg-gray-50 px-4 py-3 font-bold">今後の開催予定</div>
      {upcoming.length === 0 && <div className="p-8 text-center text-gray-500">今後の開催予定がありません。</div>}
      <ul className="divide-y">
        {upcoming.map((l) => {
          const stopped = !l.is_active
          const count = applicantsOn(l)
          const isToday = l.event_date === today
          return <li key={l.slot_id} className={`p-4 ${stopped ? 'bg-gray-50' : isToday ? 'bg-green-50' : ''}`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-gray-900">{l.school_name}</span>
                  {l.lecture_label && <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600">{l.lecture_label}</span>}
                  {isToday && <span className="rounded bg-green-600 px-2 py-0.5 text-xs font-bold text-white">本日</span>}
                  {stopped && <span className="rounded bg-gray-600 px-2 py-0.5 text-xs font-bold text-white">受付停止（延期・休講）</span>}
                </div>
                <p className="mt-1 text-sm text-gray-600">{dateLabel(l.event_date)}　{hhmm(l.start_time)}〜{hhmm(l.end_time)}　申込 {count}名</p>
                <p className="mt-0.5 truncate text-sm text-gray-500">{l.theme || 'テーマ未登録'}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {stopped
                  ? <button disabled={!!busy} onClick={() => void resume(l.slot_id)} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">受付を再開する</button>
                  : <button disabled={!!busy} onClick={() => void suspend(l.slot_id)} className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">受付を止める</button>}
                <button disabled={!!busy} onClick={() => setConfirming({ slotId: l.slot_id, kind: 'shift' })} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-50">1週間ずらす</button>
                <button disabled={!!busy} onClick={() => setConfirming({ slotId: l.slot_id, kind: 'shiftBack' })} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-500 disabled:opacity-50" title="「1週間ずらす」を押し間違えたときに戻します">1週間戻す</button>
                {count > 0 && <button disabled={!!busy} onClick={() => setConfirming({ slotId: l.slot_id, kind: 'notify' })} className="rounded-lg border border-amber-400 px-4 py-2 text-sm font-bold text-amber-700 disabled:opacity-50">延期を知らせる</button>}
              </div>
            </div>

            {confirming?.slotId === l.slot_id && confirming.kind === 'shift' && <div className="mt-3 rounded-lg border border-gray-300 bg-white p-3">
              <p className="text-sm text-gray-700"><b>{l.school_name} {l.lecture_label}</b> を1週間後ろへずらします。<br /><b>以降の回もすべて1週ずつ後ろにずれます。</b>申込者{count}名の開催日も一緒に移ります。よろしいですか？</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => void shift(l.slot_id, 'forward')} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white">ずらす</button>
                <button onClick={() => setConfirming(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-600">やめる</button>
              </div>
              <p className="mt-2 text-xs text-gray-500">押し間違えても「1週間戻す」で元に戻せます。</p>
            </div>}

            {confirming?.slotId === l.slot_id && confirming.kind === 'shiftBack' && <div className="mt-3 rounded-lg border border-gray-300 bg-white p-3">
              <p className="text-sm text-gray-700"><b>{l.school_name} {l.lecture_label}</b> を1週間<b>前</b>へ戻します。<br />「1週間ずらす」を押し間違えたときに使ってください。<b>以降の回もすべて1週ずつ前に戻ります。</b></p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => void shift(l.slot_id, 'back')} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white">戻す</button>
                <button onClick={() => setConfirming(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-600">やめる</button>
              </div>
            </div>}

            {confirming?.slotId === l.slot_id && confirming.kind === 'notify' && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-amber-900"><b>申込者{count}名全員のLINEへ</b>、この回が延期になった旨をお送りします。取り消せません。よろしいですか？</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => void notify(l.slot_id)} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white">{count}名へ送る</button>
                <button onClick={() => setConfirming(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-600">やめる</button>
              </div>
            </div>}
          </li>
        })}
      </ul>
    </div>
  </section>
}

/**
 * 移行時にスプレッドシートの操作説明行までアーカイブとして取り込まれている。
 * 学校名が絵文字＋学校名の形をしていない行は講義ではないので画面に出さない。
 */
function isRealLecture(schoolName: string): boolean {
  return /(学校|塾)$/.test(schoolName.trim())
}

function ArchiveTab({ data, accountId, refresh, flash, setError }: { data: WahmsOverview; accountId: string; refresh: () => Promise<void>; flash: (s: string) => void; setError: (s: string) => void }) {
  // アーカイブ画面は参加者管理の学校プルダウンとは独立して切り替える。
  const schools = useMemo(() => {
    const fromData = data.archives.map((a) => a.school_name).filter(isRealLecture)
    return Array.from(new Set([...WAHMS_SCHOOLS, ...fromData]))
  }, [data.archives])

  const [school, setSchool] = useState(() => schools[0] ?? '')
  const [lecture, setLecture] = useState('')
  const [heldOn, setHeldOn] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const rows = useMemo(
    () => data.archives
      .filter((a) => isRealLecture(a.school_name) && a.school_name === school)
      .sort((a, b) => Number(a.lecture_number || 0) - Number(b.lecture_number || 0)),
    [data.archives, school],
  )

  // 回の選択肢。テーマと開催日は**開催予定を正**とする。
  //
  // 以前は画面に持たせたマスターと、登録済みのアーカイブ行のテーマを混ぜて
  // いた。アーカイブ行に古いテーマが残っていると、そちらが勝って別の回の
  // テーマが表示される (実際にマーケティング学校の第13回が第15回のテーマに
  // なっていた)。開催予定は申込やリマインドと同じ元データなので、ここを
  // 正にすればズレようがない。
  //
  // マスターは開催予定に無い学校のための保険としてだけ残している。
  const lectureOptions = useMemo(() => {
    const map = new Map<number, { theme: string; heldOn: string; done: boolean }>()
    for (const l of WAHMS_LECTURE_MASTER[school] ?? []) {
      map.set(l.lecture, { theme: l.theme, heldOn: '', done: false })
    }
    for (const l of data.lectures || []) {
      if (l.school_name !== school) continue
      const n = Number(String(l.lecture_label || '').replace(/[^0-9]/g, ''))
      if (!n) continue
      map.set(n, { theme: l.theme || '', heldOn: l.event_date, done: false })
    }
    // 動画が登録済みかどうかだけ、アーカイブ行から取る。
    for (const a of rows) {
      const n = Number(a.lecture_number || 0)
      const known = map.get(n)
      if (!n) continue
      map.set(n, {
        theme: known?.theme || a.theme || '',
        heldOn: known?.heldOn || eventDay(a.held_on),
        done: Boolean(a.youtube_url),
      })
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [school, rows, data.lectures])

  // 未登録（動画がまだ無い）いちばん若い回を初期選択にする。
  useEffect(() => {
    const next = lectureOptions.find(([, v]) => !v.done)
    setLecture(next ? String(next[0]) : '')
    setYoutubeUrl('')
  }, [lectureOptions])

  const selected = lectureOptions.find(([n]) => String(n) === lecture)?.[1]
  const theme = selected?.theme ?? ''

  // 開催日は開催予定から自動で入れる。手で入れ直す必要がない。
  useEffect(() => { setHeldOn(selected?.heldOn ?? '') }, [lecture, selected?.heldOn])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!school || !lecture) return
    setSaving(true)
    try {
      await wahmsApi.createArchive(accountId, { schoolName: school, lectureNumber: lecture, theme, heldOn, youtubeUrl })
      flash(`${school} 第${lecture}回 を登録しました`)
      setHeldOn(''); setYoutubeUrl('')
      await refresh()
    } catch { setError('アーカイブを登録できませんでした') } finally { setSaving(false) }
  }

  return <section>
    <div className="mb-4 flex flex-wrap gap-2">
      {schools.map((s) => <button key={s} onClick={() => setSchool(s)}
        className={`rounded-full px-4 py-2 text-sm font-bold ${s === school ? 'bg-green-600 text-white' : 'border bg-white text-gray-600 hover:bg-gray-50'}`}>{s}</button>)}
    </div>

    <form onSubmit={submit} className="mb-5 rounded-xl border bg-white p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)_auto] md:items-end">
        <label className="text-xs font-bold text-gray-500">講義
          <select required value={lecture} onChange={(e) => setLecture(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm font-normal text-gray-900">
            <option value="">回を選択</option>
            {lectureOptions.map(([n, v]) => <option key={n} value={String(n)}>{v.done ? '✅ ' : ''}第{n}回{v.theme ? `　${v.theme}` : ''}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-gray-500">開催日
          <input type="date" required value={heldOn} onChange={(e) => setHeldOn(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm font-normal text-gray-900" />
        </label>
        <label className="text-xs font-bold text-gray-500">YouTube URL
          <input required value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtu.be/..." className="mt-1 w-full rounded-lg border p-2 text-sm font-normal text-gray-900" />
        </label>
        <button disabled={saving || !lecture} className="h-[38px] rounded-lg bg-green-600 px-6 font-bold text-white disabled:bg-gray-300">{saving ? '登録中...' : '追加'}</button>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        {theme ? <>テーマは自動で入ります：<span className="font-bold text-gray-700">{theme}</span></> : 'この学校はテーマを設定しません。開催日とYouTube URLだけ入力してください。'}
      </p>
    </form>

    <div className="overflow-hidden rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="p-3 w-20">回</th><th className="p-3 w-32">開催日</th><th className="p-3">テーマ</th><th className="p-3 w-20">動画</th><th className="w-16" /></tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id} className={`border-t ${a.youtube_url ? '' : 'bg-gray-50/60'}`}>
          <td className="p-3 font-medium">第{Number(a.lecture_number || 0)}回</td>
          <td className="p-3">{a.held_on ? dateLabel(a.held_on) : <span className="text-gray-400">未定</span>}</td>
          <td className="p-3">{a.theme || <span className="text-gray-400">—</span>}</td>
          <td className="p-3">{a.youtube_url ? <a href={a.youtube_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">開く</a> : <span className="text-gray-400">未登録</span>}</td>
          <td className="p-3"><button onClick={async () => { if (!confirm(`第${Number(a.lecture_number || 0)}回 を削除しますか？`)) return; await wahmsApi.deleteArchive(accountId, a.id); await refresh() }} className="text-xs text-red-600">削除</button></td>
        </tr>)}</tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-center text-sm text-gray-500">この学校のアーカイブはまだありません。</p>}
    </div>
  </section>
}

function DeliveryTab({ data, accountId, eventOptions, refresh, flash, setError }: { data: WahmsOverview; accountId: string; eventOptions: LectureOption[]; refresh: () => Promise<void>; flash: (s: string) => void; setError: (s: string) => void }) {
  const [event, setEvent] = useState('')

  // 開催日順に並べ替える。申込データは開催日の新しい順で来るが、配信は
  // 「今日の講義」を選ぶ作業なので、今日を境に近い日付から見せる。
  const sortedEvents = useMemo(
    () => [...eventOptions].sort((a, b) => String(b.event_date || '').localeCompare(String(a.event_date || ''))),
    [eventOptions],
  )

  // 当日開催の講義があれば最初から選んでおく。無ければ選択なしのまま。
  // アンケートは講義当日に送るものなので、毎回選び直す手間をなくす。
  const today = todayJst()
  useEffect(() => {
    if (event) return
    const todays = sortedEvents.find((a) => String(a.event_date || '').slice(0, 10).replace(/\//g, '-') === today)
    if (todays) setEvent(`${todays.school_name}|${String(todays.event_date || '').slice(0, 10)}`)
  }, [sortedEvents, today, event])

  const [altText, setAltText] = useState('WAHMSからのお知らせ')
  const [json, setJson] = useState('')
  const [testRecipientId, setTestRecipientId] = useState('')
  const [sending, setSending] = useState(false)
  const sendTest = async (kind: 'survey' | 'flex') => { if (!testRecipientId.match(/^U[0-9a-f]{32}$/i)) { setError('テスト用LINE ID（Uから始まる33文字）を入力してください'); return } setSending(true); try { if (kind === 'survey') { const [schoolName, eventDate] = event.split('|'); const res = await wahmsApi.sendSurvey(accountId, schoolName, eventDate, testRecipientId); if (!res.success) throw new Error(res.error) } else { const contents = JSON.parse(json); const res = await wahmsApi.sendFlex(accountId, altText, contents, testRecipientId); if (!res.success) throw new Error(res.error) } flash('テスト送信が完了しました。LINEをご確認ください'); await refresh() } catch (error) { setError(error instanceof Error ? error.message : 'テスト送信できませんでした') } finally { setSending(false) } }
  return <section className="grid gap-5 lg:grid-cols-2"><div className="rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">当日の講義アンケートを送る</h2><p className="mt-1 text-sm text-gray-500">開催日と学校を選ぶと、その講義の申込者だけに送信します。当日の講義があれば最初から選ばれています。</p><select value={event} onChange={(e) => setEvent(e.target.value)} className="mt-4 w-full rounded-lg border p-3 text-sm"><option value="">講義を選択</option>{sortedEvents.map((a) => { const d = String(a.event_date || '').slice(0, 10).replace(/\//g, '-'); const days = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86400000); const when = d === today ? '本日' : days > 0 ? `${days}日後` : `${-days}日前`; return <option key={a.id} value={`${a.school_name}|${String(a.event_date || '').slice(0, 10)}`}>{d === today ? '● ' : ''}{a.school_name}｜{dateLabel(a.event_date)}（{when}）</option> })}</select><button disabled={!event || sending} onClick={async () => { const [schoolName, eventDate] = event.split('|'); if (!confirm(`${schoolName} の申込者へアンケートを送りますか？`)) return; setSending(true); try { const res = await wahmsApi.sendSurvey(accountId, schoolName, eventDate); if (!res.success) throw new Error(res.error); flash(`${res.data.success}名へアンケートを送信しました`); await refresh() } catch { setError('アンケートを送信できませんでした') } finally { setSending(false) } }} className="mt-3 w-full rounded-lg bg-green-600 px-4 py-3 font-bold text-white disabled:bg-gray-300">{sending ? '送信中...' : '対象者へアンケートを送る'}</button></div><div className="rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">Flexメッセージ一斉配信</h2><p className="mt-1 text-sm text-gray-500">Flex SimulatorのJSONは「contentsのみ」「message全体」のどちらでも貼り付けできます。</p><input value={altText} onChange={(e) => setAltText(e.target.value)} className="mt-4 w-full rounded-lg border p-3 text-sm" placeholder="通知に表示する短い文" /><textarea value={json} onChange={(e) => setJson(e.target.value)} className="mt-3 min-h-64 w-full rounded-lg border p-3 font-mono text-xs" placeholder='{"type":"bubble", ...}' /><button disabled={!json || sending} onClick={async () => { let contents: unknown; try { contents = JSON.parse(json) } catch { setError('Flex JSONの形式が正しくありません'); return } if (!confirm('WAHMSの友だち全員へ一斉配信しますか？')) return; setSending(true); try { const res = await wahmsApi.sendFlex(accountId, altText, contents); if (!res.success) throw new Error(res.error); flash('Flexメッセージを配信しました'); await refresh() } catch (error) { setError(error instanceof Error ? error.message : 'Flexメッセージを配信できませんでした') } finally { setSending(false) } }} className="mt-3 w-full rounded-lg bg-gray-900 px-4 py-3 font-bold text-white disabled:bg-gray-300">配信する</button></div><div className="lg:col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="font-bold text-blue-900">安全なテスト送信</p><p className="mt-1 text-sm text-blue-800">自分のLINE IDだけに送信します。一斉配信はしません。</p><input value={testRecipientId} onChange={(e) => setTestRecipientId(e.target.value)} placeholder="Uから始まるLINE ID" className="mt-3 w-full rounded-lg border border-blue-200 bg-white p-3 text-sm" /><div className="mt-3 flex flex-wrap gap-2"><button disabled={!event || sending} onClick={() => void sendTest('survey')} className="rounded-lg border border-green-600 bg-white px-4 py-2 text-sm font-bold text-green-700 disabled:border-gray-300 disabled:text-gray-400">アンケートをテスト送信</button><button disabled={!json || sending} onClick={() => void sendTest('flex')} className="rounded-lg border border-gray-800 bg-white px-4 py-2 text-sm font-bold text-gray-800 disabled:border-gray-300 disabled:text-gray-400">Flexをテスト送信</button></div></div><div className="lg:col-span-2 rounded-xl border bg-white"><div className="border-b px-4 py-3 font-bold">配信履歴</div>{data.deliveryLogs.map((log) => <div key={log.id} className="flex items-center justify-between border-b px-4 py-3 text-sm"><div><span className="mr-2 rounded bg-gray-100 px-2 py-1 text-xs">{log.delivery_type === 'survey' ? 'アンケート' : 'Flex'}</span>{log.title}</div><div className="text-xs text-gray-500">成功 {log.success_count} / 失敗 {log.failure_count} ・ {dateLabel(log.created_at)}</div></div>)}</div></section>
}
