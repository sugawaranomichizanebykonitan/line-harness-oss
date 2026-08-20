'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { wahmsApi, type WahmsOverview } from '@/lib/api'

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
        {school ? <div className="overflow-hidden rounded-xl border bg-white"><div className="border-b bg-gray-50 px-4 py-3 font-bold">{school} の申込者</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="p-3">参加者</th><th className="p-3">開催日</th><th className="p-3">時間</th><th className="p-3">テーマ</th><th className="p-3">実参加</th></tr></thead><tbody>{data.applications.map((a) => <tr key={a.id} className="border-t"><td className="p-3 font-medium">{a.participant_name || '名前未登録'}</td><td className="p-3">{dateLabel(a.event_date)}</td><td className="p-3">{a.event_time || '—'}</td><td className="max-w-md p-3">{a.theme || '—'}</td><td className="p-3">{a.attended == null ? '未確認' : a.attended ? '参加' : '不参加'}</td></tr>)}</tbody></table></div></div>
        : <div className="overflow-hidden rounded-xl border bg-white"><div className="border-b bg-gray-50 px-4 py-3 font-bold">登録者一覧</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="p-3">名前</th><th className="p-3">LINE表示名</th><th className="p-3">職業</th><th className="p-3">申込</th><th className="p-3">ステータス</th></tr></thead><tbody>{data.participants.map((p) => <tr key={p.id} className="border-t"><td className="p-3 font-medium">{p.name || '未登録'}</td><td className="p-3">{p.line_display_name || '—'}</td><td className="p-3">{p.occupation || '—'}</td><td className="p-3">{Number(p.booking_count || 0)}回</td><td className="p-3">{p.status || '—'}</td></tr>)}</tbody></table></div></div>}
      </section>}

      {tab === 'surveys' && data && <section>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="回答者数" value={`${data.summary.surveyResponses}名`} /><Stat label="平均得点" value={data.summary.averageSatisfaction == null ? '—' : `${data.summary.averageSatisfaction.toFixed(2)} / 5`} /><Stat label="無料なのが信じられない率" value={`${data.summary.unbelievableRate.toFixed(1)}%`} /><Stat label="要対応の質問" value={`${data.summary.pendingQuestions}件`} accent={data.summary.pendingQuestions > 0} /></div>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1"><button onClick={() => setSchool('')} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${!school ? 'bg-green-600 text-white' : 'bg-white border'}`}>全学校</button>{data.schools.map((s) => <button key={s.school_name} onClick={() => setSchool(s.school_name)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${school === s.school_name ? 'bg-green-600 text-white' : 'bg-white border'}`}>{s.school_name}</button>)}</div>
        <div className="space-y-3">{data.surveys.map((s) => <article key={s.id} className="rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">{s.school_name}</span><span className="text-xs text-gray-500">{dateLabel(s.responded_at)}</span>{s.response_status === 'pending' && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">要対応</span>}{s.response_status === 'completed' && <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">対応完了</span>}</div><div className="mt-3 grid gap-3 text-sm md:grid-cols-4"><div><span className="text-gray-500">回答者</span><p className="font-medium">{s.respondent_name || '名前未登録'}</p></div><div><span className="text-gray-500">満足度</span><p className="font-medium">{s.satisfaction ? `${s.satisfaction} / 5` : '—'}</p></div><div><span className="text-gray-500">価値評価</span><p className="font-medium">{s.value_rating || '—'}</p></div><div><span className="text-gray-500">次回参加意向</span><p className="font-medium">{s.next_intent || '—'}</p></div></div>{s.question && <div className="mt-4 rounded-lg bg-amber-50 p-3"><p className="text-xs font-bold text-amber-700">青山さんへの質問</p><p className="mt-1 text-sm text-gray-800">{s.question}</p>{s.response_status === 'completed' ? <div className="mt-3 border-t border-amber-200 pt-3"><p className="text-xs font-bold text-gray-500">返信済み</p><p className="mt-1 text-sm">{s.answer}</p></div> : <div className="mt-3 flex flex-col gap-2 md:flex-row"><textarea value={answers[s.id] || ''} onChange={(e) => setAnswers({ ...answers, [s.id]: e.target.value })} placeholder="ここに返信を入力" className="min-h-24 flex-1 rounded-lg border border-amber-300 bg-white p-3 text-sm" /><button onClick={async () => { if (!selectedAccountId) return; try { await wahmsApi.reply(selectedAccountId, s.id, answers[s.id] || ''); flash('LINEへ返信し、対応完了にしました'); await refresh() } catch { setError('返信できませんでした。内容を確認してください。') } }} className="rounded-lg bg-green-600 px-5 py-3 font-bold text-white">LINEへ返信</button></div>}</div>}</article>)}</div>
      </section>}

      {tab === 'archives' && data && <ArchiveTab data={data} accountId={selectedAccountId!} refresh={refresh} flash={flash} setError={setError} />}
      {tab === 'delivery' && data && <DeliveryTab data={data} accountId={selectedAccountId!} eventOptions={eventOptions} refresh={refresh} flash={flash} setError={setError} />}
    </main>
  </>
}

function ArchiveTab({ data, accountId, refresh, flash, setError }: { data: WahmsOverview; accountId: string; refresh: () => Promise<void>; flash: (s: string) => void; setError: (s: string) => void }) {
  const [form, setForm] = useState({ schoolName: '', lectureNumber: '', theme: '', heldOn: '', youtubeUrl: '' })
  return <section><form onSubmit={async (e) => { e.preventDefault(); try { await wahmsApi.createArchive(accountId, form); setForm({ schoolName: '', lectureNumber: '', theme: '', heldOn: '', youtubeUrl: '' }); flash('アーカイブを追加しました'); await refresh() } catch { setError('アーカイブを追加できませんでした') } }} className="mb-5 grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-5"><input required value={form.schoolName} onChange={(e) => setForm({ ...form, schoolName: e.target.value })} placeholder="学校名" className="rounded-lg border p-2 text-sm" /><input value={form.lectureNumber} onChange={(e) => setForm({ ...form, lectureNumber: e.target.value })} placeholder="LECTURE番号" className="rounded-lg border p-2 text-sm" /><input value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} placeholder="テーマ" className="rounded-lg border p-2 text-sm" /><input type="date" value={form.heldOn} onChange={(e) => setForm({ ...form, heldOn: e.target.value })} className="rounded-lg border p-2 text-sm" /><div className="flex gap-2"><input value={form.youtubeUrl} onChange={(e) => setForm({ ...form, youtubeUrl: e.target.value })} placeholder="YouTube URL" className="min-w-0 flex-1 rounded-lg border p-2 text-sm" /><button className="rounded-lg bg-green-600 px-4 font-bold text-white">追加</button></div></form><div className="overflow-hidden rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-gray-50 text-left text-xs text-gray-500"><tr><th className="p-3">学校</th><th className="p-3">回</th><th className="p-3">開催日</th><th className="p-3">テーマ</th><th className="p-3">動画</th><th /></tr></thead><tbody>{data.archives.map((a) => <tr key={a.id} className="border-t"><td className="p-3 font-medium">{a.school_name}</td><td className="p-3">{a.lecture_number || '—'}</td><td className="p-3">{dateLabel(a.held_on)}</td><td className="p-3">{a.theme || '—'}</td><td className="p-3">{a.youtube_url ? <a href={a.youtube_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">開く</a> : '—'}</td><td className="p-3"><button onClick={async () => { if (!confirm('このアーカイブを削除しますか？')) return; await wahmsApi.deleteArchive(accountId, a.id); await refresh() }} className="text-xs text-red-600">削除</button></td></tr>)}</tbody></table></div></section>
}

function DeliveryTab({ data, accountId, eventOptions, refresh, flash, setError }: { data: WahmsOverview; accountId: string; eventOptions: WahmsOverview['applications']; refresh: () => Promise<void>; flash: (s: string) => void; setError: (s: string) => void }) {
  const [event, setEvent] = useState('')
  const [altText, setAltText] = useState('WAHMSからのお知らせ')
  const [json, setJson] = useState('')
  const [testRecipientId, setTestRecipientId] = useState('')
  const [sending, setSending] = useState(false)
  const sendTest = async (kind: 'survey' | 'flex') => { if (!testRecipientId.match(/^U[0-9a-f]{32}$/i)) { setError('テスト用LINE ID（Uから始まる33文字）を入力してください'); return } setSending(true); try { if (kind === 'survey') { const [schoolName, eventDate] = event.split('|'); const res = await wahmsApi.sendSurvey(accountId, schoolName, eventDate, testRecipientId); if (!res.success) throw new Error(res.error) } else { const contents = JSON.parse(json); const res = await wahmsApi.sendFlex(accountId, altText, contents, testRecipientId); if (!res.success) throw new Error(res.error) } flash('テスト送信が完了しました。LINEをご確認ください'); await refresh() } catch (error) { setError(error instanceof Error ? error.message : 'テスト送信できませんでした') } finally { setSending(false) } }
  return <section className="grid gap-5 lg:grid-cols-2"><div className="rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">当日の講義アンケートを送る</h2><p className="mt-1 text-sm text-gray-500">開催日と学校を選ぶと、その講義の申込者だけに送信します。</p><select value={event} onChange={(e) => setEvent(e.target.value)} className="mt-4 w-full rounded-lg border p-3 text-sm"><option value="">講義を選択</option>{eventOptions.map((a) => <option key={a.id} value={`${a.school_name}|${String(a.event_date || '').slice(0, 10)}`}>{a.school_name}｜{dateLabel(a.event_date)}</option>)}</select><button disabled={!event || sending} onClick={async () => { const [schoolName, eventDate] = event.split('|'); if (!confirm(`${schoolName} の申込者へアンケートを送りますか？`)) return; setSending(true); try { const res = await wahmsApi.sendSurvey(accountId, schoolName, eventDate); if (!res.success) throw new Error(res.error); flash(`${res.data.success}名へアンケートを送信しました`); await refresh() } catch { setError('アンケートを送信できませんでした') } finally { setSending(false) } }} className="mt-3 w-full rounded-lg bg-green-600 px-4 py-3 font-bold text-white disabled:bg-gray-300">{sending ? '送信中...' : '対象者へアンケートを送る'}</button></div><div className="rounded-xl border bg-white p-5"><h2 className="text-lg font-bold">Flexメッセージ一斉配信</h2><p className="mt-1 text-sm text-gray-500">Flex SimulatorのJSONは「contentsのみ」「message全体」のどちらでも貼り付けできます。</p><input value={altText} onChange={(e) => setAltText(e.target.value)} className="mt-4 w-full rounded-lg border p-3 text-sm" placeholder="通知に表示する短い文" /><textarea value={json} onChange={(e) => setJson(e.target.value)} className="mt-3 min-h-64 w-full rounded-lg border p-3 font-mono text-xs" placeholder='{"type":"bubble", ...}' /><button disabled={!json || sending} onClick={async () => { let contents: unknown; try { contents = JSON.parse(json) } catch { setError('Flex JSONの形式が正しくありません'); return } if (!confirm('WAHMSの友だち全員へ一斉配信しますか？')) return; setSending(true); try { const res = await wahmsApi.sendFlex(accountId, altText, contents); if (!res.success) throw new Error(res.error); flash('Flexメッセージを配信しました'); await refresh() } catch (error) { setError(error instanceof Error ? error.message : 'Flexメッセージを配信できませんでした') } finally { setSending(false) } }} className="mt-3 w-full rounded-lg bg-gray-900 px-4 py-3 font-bold text-white disabled:bg-gray-300">配信する</button></div><div className="lg:col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="font-bold text-blue-900">安全なテスト送信</p><p className="mt-1 text-sm text-blue-800">自分のLINE IDだけに送信します。一斉配信はしません。</p><input value={testRecipientId} onChange={(e) => setTestRecipientId(e.target.value)} placeholder="Uから始まるLINE ID" className="mt-3 w-full rounded-lg border border-blue-200 bg-white p-3 text-sm" /><div className="mt-3 flex flex-wrap gap-2"><button disabled={!event || sending} onClick={() => void sendTest('survey')} className="rounded-lg border border-green-600 bg-white px-4 py-2 text-sm font-bold text-green-700 disabled:border-gray-300 disabled:text-gray-400">アンケートをテスト送信</button><button disabled={!json || sending} onClick={() => void sendTest('flex')} className="rounded-lg border border-gray-800 bg-white px-4 py-2 text-sm font-bold text-gray-800 disabled:border-gray-300 disabled:text-gray-400">Flexをテスト送信</button></div></div><div className="lg:col-span-2 rounded-xl border bg-white"><div className="border-b px-4 py-3 font-bold">配信履歴</div>{data.deliveryLogs.map((log) => <div key={log.id} className="flex items-center justify-between border-b px-4 py-3 text-sm"><div><span className="mr-2 rounded bg-gray-100 px-2 py-1 text-xs">{log.delivery_type === 'survey' ? 'アンケート' : 'Flex'}</span>{log.title}</div><div className="text-xs text-gray-500">成功 {log.success_count} / 失敗 {log.failure_count} ・ {dateLabel(log.created_at)}</div></div>)}</div></section>
}
