'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Item = { id: string; patientId: string; patientName: string; userName: string; recipientName: string; message?: string; createdAt: string; handled: boolean; replyToId?: string | null }
export default function TreatmentCoordinationPage() {
  const [items, setItems] = useState<Item[]>([])
  const [filter, setFilter] = useState<'pending' | 'handled' | 'all'>('pending')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [limited, setLimited] = useState(false)
  const refresh = useCallback(async () => {
    const token = localStorage.getItem('cc_token')
    if (!token) { setError('Please sign in again'); setLoading(false); return }
    try {
      const response = await fetch('/api-proxy/clinical/staff-instructions/worklist', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (!response.ok) throw new Error(response.status === 403 ? 'Admin access required' : 'Unable to load worklist')
      const result = await response.json()
      setItems(result.items || []); setLimited(Boolean(result.limited)); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load worklist') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const visible = useMemo(() => items.filter(i => filter === 'all' || i.handled === (filter === 'handled')), [items, filter])
  const pending = items.filter(i => !i.handled).length
  return <main className="p-4 md:p-8 space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold dark:text-white">Treatment Coordination</h1><p className="text-sm text-gray-500">Private patient-linked instructions between clinic staff. Never sent to patients.</p></div>
      <button type="button" onClick={() => { setLoading(true); void refresh() }} className="rounded-lg border px-4 py-2 text-sm dark:text-white">Refresh</button>
    </header>
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl border p-4 dark:border-white/10"><p className="text-sm text-gray-500">Pending instructions</p><p className="text-3xl font-bold dark:text-white">{pending}</p></div>
      <div className="rounded-xl border p-4 dark:border-white/10"><p className="text-sm text-gray-500">Handled instructions</p><p className="text-3xl font-bold dark:text-white">{items.length - pending}</p></div>
    </div>
    <div className="flex gap-2">{(['pending','handled','all'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-lg px-4 py-2 text-sm capitalize ${filter === value ? 'bg-teal-700 text-white' : 'border dark:text-white'}`}>{value}</button>)}</div>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {limited && <p className="text-sm text-amber-700">Showing the latest 2,000 communication events. Older instructions may not be included in these totals.</p>}
    {loading ? <p className="text-gray-500">Loading instructions…</p> : visible.length === 0 ? <p className="text-gray-500">No instructions in this view.</p> :
      <div className="space-y-3">{visible.map(item => <article key={item.id} className="rounded-xl border p-4 space-y-2 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/patients/${item.patientId}?tab=staff`} className="font-semibold text-teal-700 hover:underline">{item.patientName}</Link><span className={item.handled ? 'text-green-700 text-sm' : 'text-amber-700 text-sm'}>{item.handled ? 'Handled' : 'Pending'}</span></div>
        <p className="text-sm text-gray-500">From {item.userName} · To {item.recipientName} · {new Date(item.createdAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}</p>
        <p className="whitespace-pre-wrap break-words dark:text-white">{item.message || 'Internal instruction'}</p>
        <Link href={`/patients/${item.patientId}?tab=staff`} className="inline-block text-sm text-teal-700 hover:underline">Open patient staff messages →</Link>
      </article>)}</div>}
  </main>
}
