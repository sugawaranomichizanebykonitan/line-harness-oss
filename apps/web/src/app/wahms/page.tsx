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

type Tab = 'participants' | 'surveys' | 'archives' | 'delivery'

const tabLabels: Record<Tab, string> = {
  participants: '参加者管理', surveys: '講義アンケート', archives: 'アーカイブ', delivery: '配信',
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

/** 申込の開催日を YYYY-MM-DD に揃える。'2026/08/21' 形式が混ざるため。 */
function eventDay(value?: string | null): string {
  return String(value || '').slice(0, 10).replace(/\//g, '-')
}

/**
 * 「本日の講義に何名申し込んでいるか」を一目で出す。
 * 当日の運営で最初に知りたい数字なので、一覧を数えなくても分かるようにする。
 */
function TodayPanel({ applications, school }: { applications: WahmsOverview['applications']; school: string }) {
  const today = todayJst()
  const scoped = school ? applications.filter((a) => a.school_name === school) : applications
  const todays = scoped.filter((a) => eventDay(a.event_date) === today)

  if (todays.length > 0) {
    // 同じ日に同じ学校が複数枠あることは無い想定だが、念のため学校ごとにまとめる。
    const groups = new Map<string, typeof todays>()
    for (const a of todays) {
      const list = groups.get(a.school_name) ?? []
      list.push(a); groups.set(a.school_name, list)
    }
    return <div className="mb-4 space-y-3">
      {Array.from(groups.entries()).map(([name, list]) => <div key={name} className="flex flex-col gap-3 rounded-xl border-2 border-green-500 bg-green-50 p-4 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-green-700">本日開催 {new Date(today).toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}</p>
          <p className="mt-1 font-bold text-gray-900">{name}</p>
          <p className="mt-0.5 truncate text-sm text-gray-600">{list[0].event_time ? `${list[0].event_time}　` : ''}{list[0].theme || 'テーマ未設定'}</p>
        </div>
        <div className="shrink-0 text-center md:text-right">
          <span className="text-4xl font-bold text-green-700">{list.length}</span>
          <span className="ml-1 text-sm font-bold text-green-700">名 申込</span>
        </div>
      </div>)}
    </div>
  }

  // 今日は開催なし。次にいつあるのかまで出さないと、結局一覧を見に行くことになる。
  const upcoming = scoped
    .filter((a) => eventDay(a.event_date) > today)
    .sort((a, b) => eventDay(a.event_date).localeCompare(eventDay(b.event_date)))[0]
  const upcomingCount = upcoming
    ? scoped.filter((a) => a.school_name === upcoming.school_name && eventDay(a.event_date) === eventDay(upcoming.event_date)).length
    : 0

  return <div className="mb-4 rounded-xl border bg-white p-4 text-sm text-gray-600">
    <span className="font-bold text-gray-900">本日{school ? `の${school}` : ''}の開催はありません。</span>
    {upcoming
      ? <>　次回は {dateLabel(upcoming.event_date)}（{upcoming.school_name}）で、現在 <span className="font-bold text-gray-900">{upcomingCount}名</span> の申込があります。</>
      : <>　申込が入ると、ここに表示されます。</>}
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
  const eventOptions = useMemo(() => {
    const seen = new Set<string>()
    return (data?.applications || []).filter((item) => {
      const key = `${item.school_name}|${String(item.event_date || '').slice(0, 10)}`
      if (seen.has(key)) return false
      seen.add(key); return true
    })
  }, [data])

  if (accountLoading) return <><Header title="WAHMS運営" /><div className="p-8 text-gray-500">読み込み中...</div></>
  if (!isWahms) return <><Header title="WAHMS運営" /><div className="max-w-2xl mx-auto p-8"><div className="rounded-xl border border-gray-200 bg-white p-8 text-center"><h1 className="text-xl font-bold">WAHMS専用機能です</h1><p className="mt-2 text-gray-500">左上のLINEアカウントを「WAHMS」に切り替えると表示されます。</p></div></div></>

  const flash = (message: string) => { setNotice(message); setTimeout(() => setNotice(''), 5000) }

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
        <TodayPanel applications={data.applications} school={school} />
        {school ? <div className="overflow-hidden rounded-xl border bg-white"><div className="border-b bg-gray-50 px-4 py-3 font-bold">{school} の申込者</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="p-3">参加者</th><th className="p-3">開催日</th><th className="p-3">時間</th><th className="p-3">テーマ</th><th className="p-3">実参加</th></tr></thead><tbody>{data.applications.map((a) => <tr key={a.id} className={`border-t ${eventDay(a.event_date) === todayJst() ? 'bg-green-50' : ''}`}><td className="p-3 font-medium">{a.participant_name || '名前未登録'}{eventDay(a.event_date) === todayJst() && <span className="ml-2 rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white">本日</span>}</td><td className="p-3">{dateLabel(a.event_date)}</td><td className="p-3">{a.event_time || '—'}</td><td className="max-w-md p-3">{a.theme || '—'}</td><td className="p-3">{a.attended == null ? '未確認' : a.attended ? '参加' : '不参加'}</td></tr>)}</tbody></table></div></div>
        : <div className="overflow-hidden rounded-xl border bg-white"><div className="border-b bg-gray-50 px-4 py-3 font-bold">登録者一覧</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="p-3">名前</th><th className="p-3">LINE表示名</th><th className="p-3">職業</th><th className="p-3">申込</th><th className="p-3">ステータス</th></tr></thead><tbody>{data.participants.map((p) => <tr key={p.id} className="border-t"><td className="p-3 font-medium">{p.name || '未登録'}</td><td className="p-3">{p.line_display_name || '—'}</td><td className="p-3">{p.occupation || '—'}</td><td className="p-3">{Number(p.booking_count || 0)}回</td><td className="p-3">{p.status || '—'}</td></tr>)}</tbody></table></div></div>}
      </section>}

      {tab === 'surveys' && data && <section>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="回答者数" value={`${data.summary.surveyResponses}名`} /><Stat label="平均得点" value={data.summary.averageSatisfaction == null ? '—' : `${data.summary.averageSatisfaction.toFixed(2)} / 5`} /><Stat label="無料なのが信じられない率" value={`${data.summary.unbelievableRate.toFixed(1)}%`} /><Stat label="要対応の質問" value={`${data.summary.pendingQuestions}件`} accent={data.summary.pendingQuestions > 0} /></div>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1"><button onClick={() => setSchool('')} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${!school ? 'bg-green-600 text-white' : 'bg-white border'}`}>全学校</button>{data.schools.map((s) => <button key={s.school_name} onClick={() => setSchool(s.school_name)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${school === s.school_name ? 'bg-green-600 text-white' : 'bg-white border'}`}>{s.school_name}</button>)}</div>
        <div className="space-y-3">{data.surveys.map((s) => <article key={s.id} className="rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">{s.school_name}</span><span className="text-xs text-gray-500">{dateLabel(s.responded_at)}</span>{isWebResponse(s) && <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700">Web回答</span>}{s.response_status === 'pending' && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">要対応</span>}{s.response_status === 'completed' && <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">対応完了</span>}</div><div className="mt-3 grid gap-3 text-sm md:grid-cols-4"><div><span className="text-gray-500">回答者</span><p className="font-medium">{s.respondent_name || '名前未登録'}</p></div><div><span className="text-gray-500">満足度</span><p className="font-medium">{s.satisfaction ? `${s.satisfaction} / 5` : '—'}</p></div><div><span className="text-gray-500">価値評価</span><p className="font-medium">{s.value_rating || '—'}</p></div><div><span className="text-gray-500">次回参加意向</span><p className="font-medium">{s.next_intent || '—'}</p></div></div>{s.question && <div className="mt-4 rounded-lg bg-amber-50 p-3"><p className="text-xs font-bold text-amber-700">青山さんへの質問</p><p className="mt-1 text-sm text-gray-800">{s.question}</p>{s.response_status === 'completed' ? <div className="mt-3 border-t border-amber-200 pt-3"><p className="text-xs font-bold text-gray-500">返信済み</p><p className="mt-1 text-sm">{s.answer}</p></div> : isWebResponse(s) ? <div className="mt-3 border-t border-amber-200 pt-3 text-sm text-gray-600">この方は公式LINE未登録のため、ここからは返信できません。別の手段でご連絡ください。</div> : <div className="mt-3 flex flex-col gap-2 md:flex-row"><textarea value={answers[s.id] || ''} onChange={(e) => setAnswers({ ...answers, [s.id]: e.target.value })} placeholder="ここに返信を入力" className="min-h-24 flex-1 rounded-lg border border-amber-300 bg-white p-3 text-sm" /><button onClick={async () => { if (!selectedAccountId) return; try { await wahmsApi.reply(selectedAccountId, s.id, answers[s.id] || ''); flash('LINEへ返信し、対応完了にしました'); await refresh() } catch { setError('返信できませんでした。内容を確認してください。') } }} className="rounded-lg bg-green-600 px-5 py-3 font-bold text-white">LINEへ返信</button></div>}</div>}</article>)}</div>
      </section>}

      {tab === 'archives' && data && <ArchiveTab data={data} accountId={selectedAccountId!} refresh={refresh} flash={flash} setError={setError} />}
      {tab === 'delivery' && data && <DeliveryTab data={data} accountId={selectedAccountId!} eventOptions={eventOptions} refresh={refresh} flash={flash} setError={setError} />}
    </main>
  </>
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

  // 回の選択肢は「既にある枠」と「マスターの第11〜20回」を統合する。
  // 既存の枠を選べば上書き、無い回を選べば新規に作られる。
  const lectureOptions = useMemo(() => {
    const map = new Map<number, { theme: string; done: boolean }>()
    for (const l of WAHMS_LECTURE_MASTER[school] ?? []) map.set(l.lecture, { theme: l.theme, done: false })
    for (const a of rows) {
      const n = Number(a.lecture_number || 0)
      if (!n) continue
      const master = map.get(n)
      map.set(n, {
        theme: a.theme || master?.theme || '',
        done: Boolean(a.youtube_url),
      })
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [school, rows])

  // 未登録（動画がまだ無い）いちばん若い回を初期選択にする。
  useEffect(() => {
    const next = lectureOptions.find(([, v]) => !v.done)
    setLecture(next ? String(next[0]) : '')
    setHeldOn(''); setYoutubeUrl('')
  }, [lectureOptions])

  const theme = lectureOptions.find(([n]) => String(n) === lecture)?.[1].theme ?? ''

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

function DeliveryTab({ data, accountId, eventOptions, refresh, flash, setError }: { data: WahmsOverview; accountId: string; eventOptions: WahmsOverview['applications']; refresh: () => Promise<void>; flash: (s: string) => void; setError: (s: string) => void }) {
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
