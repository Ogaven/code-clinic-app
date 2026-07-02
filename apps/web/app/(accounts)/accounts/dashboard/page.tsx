'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  TrendingUp, TrendingDown, DollarSign, FileText, ShoppingBag, AlertCircle,
  ChevronRight, CheckCircle, RefreshCw, Unplug,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { formatUGX, getGreeting } from '@/lib/utils'
import LivePatientFlow from '@/components/scheduling/LivePatientFlow'

// ── Analog Clock ─────────────────────────────────────────────────────────────
function AnalogClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const kla  = new Date(time.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }))
  const h    = kla.getHours() % 12
  const m    = kla.getMinutes()
  const s    = kla.getSeconds()
  const hDeg = h / 12 * 360 + m / 60 * 30
  const mDeg = m / 60 * 360 + s / 60 * 6
  const sDeg = s / 60 * 360
  const cx = 44, cy = 44, r = 40
  const hand = (deg: number, len: number) => ({
    x2: cx + Math.cos((deg - 90) * Math.PI / 180) * len,
    y2: cy + Math.sin((deg - 90) * Math.PI / 180) * len,
  })
  const timeStr = kla.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true })
  const dateStr = kla.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: '2-digit' })
    .replace(',', '').replace(/(\d+) (\w+) (\d+)/, '$1 $2 \'$3')
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5"/>
        <circle cx={cx} cy={cy} r={r-4} fill="rgba(255,255,255,0.04)"/>
        {Array.from({ length: 12 }).map((_, i) => {
          const a  = (i / 12) * 360 - 90
          const x1 = cx + Math.cos(a * Math.PI/180) * (r - 6)
          const y1 = cy + Math.sin(a * Math.PI/180) * (r - 6)
          const x2 = cx + Math.cos(a * Math.PI/180) * (r - 2)
          const y2 = cy + Math.sin(a * Math.PI/180) * (r - 2)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.45)" strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round"/>
        })}
        <line x1={cx} y1={cy} x2={hand(hDeg,22).x2} y2={hand(hDeg,22).y2} stroke="white" strokeWidth="3" strokeLinecap="round"/>
        <line x1={cx} y1={cy} x2={hand(mDeg,30).x2} y2={hand(mDeg,30).y2} stroke="#29ABE2" strokeWidth="2" strokeLinecap="round"/>
        <line x1={cx} y1={cy} x2={hand(sDeg,34).x2} y2={hand(sDeg,34).y2} stroke="#EC4899" strokeWidth="1.2" strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r="3.5" fill="white"/>
        <circle cx={cx} cy={cy} r="1.5" fill="#29ABE2"/>
      </svg>
      <p className="text-white/90 text-[11px] font-bold tracking-wide">{timeStr} EAT</p>
      <p className="text-blue-200 text-[9px] font-semibold tracking-wider uppercase">{dateStr}</p>
    </div>
  )
}

// ── QuickBooks Logo ───────────────────────────────────────────────────────────
function QBLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="44" cy="44" r="44" fill="white"/>
      <circle cx="44" cy="44" r="38" fill="#2CA01C"/>
      <text x="44" y="58" textAnchor="middle" fill="white"
        fontSize="34" fontFamily="Arial, sans-serif" fontWeight="bold" letterSpacing="-3">qb</text>
    </svg>
  )
}

// ── Recharts tooltip ──────────────────────────────────────────────────────────
function PLTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 p-3 text-xs">
      <p className="font-bold text-gray-800 dark:text-white mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.fill }} />
          <span className="text-gray-500 dark:text-gray-400 capitalize">{p.name}:</span>
          <span className="font-bold text-gray-800 dark:text-white">{formatUGX(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Invoice status badge ──────────────────────────────────────────────────────
const statusStyle: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT:    { bg: '#F3F4F6', text: '#6B7280', label: 'Draft' },
  SENT:     { bg: '#DBEAFE', text: '#2563EB', label: 'Sent' },
  PAID:     { bg: '#D1FAE5', text: '#059669', label: 'Paid' },
  OVERDUE:  { bg: '#FEE2E2', text: '#DC2626', label: 'Overdue' },
  CANCELLED:{ bg: '#F3F4F6', text: '#6B7280', label: 'Cancelled' },
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
interface DashboardData {
  todayRevenue: number
  monthRevenue: number
  yearRevenue: number
  outstandingDebt: number
  monthExpenses: number
  unpaidInvoices: number
  recentInvoices: Array<{
    id: string; invoiceNumber: string; totalUGX: number; status: string; createdAt: string
    patient: { firstName: string; lastName: string }
  }>
  trend: Array<{ month: string; revenue: number; expenses: number }>
}

export default function AccountsDashboardPage() {
  const [user, setUser]       = useState<any>(null)
  const [now,  setNow]        = useState(new Date())
  const [data, setData]       = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [qbStatus, setQbStatus]         = useState<{ connected: boolean; companyName?: string } | null>(null)
  const [toast, setToast]               = useState('')
  const [syncing, setSyncing]           = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [showDisconnectModal, setShowDisconnectModal] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (stored) setUser(JSON.parse(stored))

    const tick  = setInterval(() => setNow(new Date()), 60000)
    const token = localStorage.getItem('cc_token')

    if (token) {
      fetch('/api-proxy/accounts/dashboard', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => { if (!d.error) setData(d) })
        .catch(() => {})
        .finally(() => setLoading(false))

      fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(setQbStatus)
        .catch(() => setQbStatus({ connected: false }))
    } else {
      setLoading(false)
    }

    // Show toast if returning from OAuth
    const params = new URLSearchParams(window.location.search)
    if (params.get('qb') === 'connected') {
      setToast('QuickBooks connected successfully!')
      setTimeout(() => setToast(''), 4000)
      window.history.replaceState({}, '', '/accounts/dashboard')
    } else if (params.get('qb') === 'error') {
      setToast('QuickBooks connection failed — please try again.')
      setTimeout(() => setToast(''), 5000)
      window.history.replaceState({}, '', '/accounts/dashboard')
    }

    return () => clearInterval(tick)
  }, [])

  async function handleSync() {
    setSyncing(true)
    try {
      const token = localStorage.getItem('cc_token')
      await fetch('/api-proxy/accounts/quickbooks/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      setToast('QuickBooks cache cleared — refreshing data…')
      setTimeout(() => setToast(''), 3000)
    } finally {
      setSyncing(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const token = localStorage.getItem('cc_token')
      await fetch('/api-proxy/accounts/quickbooks/disconnect', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      setQbStatus({ connected: false })
      setShowDisconnectModal(false)
      setToast('QuickBooks disconnected.')
      setTimeout(() => setToast(''), 3000)
    } finally {
      setDisconnecting(false)
    }
  }

  const greeting    = getGreeting()
  const name        = user?.firstName || 'Accounts'
  const netProfit   = data ? data.monthRevenue - data.monthExpenses : 0
  const dateStr     = now.toLocaleDateString('en-GB', {
    timeZone: 'Africa/Nairobi', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const stats = [
    {
      title: "Today's Revenue",
      value: loading ? null : formatUGX(data?.todayRevenue ?? 0),
      icon: TrendingUp,
      color: '#059669',
      bg: 'linear-gradient(135deg,#D1FAE5,#A7F3D0)',
      trend: { up: true, label: 'Payments received today' },
    },
    {
      title: 'Outstanding Invoices',
      value: loading ? null : String(data?.unpaidInvoices ?? 0),
      icon: FileText,
      color: '#D97706',
      bg: 'linear-gradient(135deg,#FEF3C7,#FDE68A)',
      trend: { up: false, label: 'Unpaid & overdue' },
    },
    {
      title: 'Month Expenses',
      value: loading ? null : formatUGX(data?.monthExpenses ?? 0),
      icon: ShoppingBag,
      color: '#DC2626',
      bg: 'linear-gradient(135deg,#FEE2E2,#FECACA)',
      trend: { up: false, label: 'Total this month' },
    },
    {
      title: 'Net Profit',
      value: loading ? null : formatUGX(netProfit),
      icon: DollarSign,
      color: netProfit >= 0 ? '#059669' : '#DC2626',
      bg: netProfit >= 0
        ? 'linear-gradient(135deg,#D1FAE5,#A7F3D0)'
        : 'linear-gradient(135deg,#FEE2E2,#FECACA)',
      trend: { up: netProfit >= 0, label: 'Revenue − Expenses' },
    },
  ]

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-amber-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold max-w-xs">
          {toast}
        </div>
      )}

      {/* Disconnect confirmation modal */}
      {showDisconnectModal && (
        <div className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <Unplug size={18} className="text-red-500" />
              </div>
              <p className="font-bold text-gray-800 dark:text-white text-sm">Disconnect QuickBooks?</p>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
              This will stop syncing data between Code Clinic and QuickBooks. Your existing records in QuickBooks will remain untouched.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDisconnectModal(false)}
                className="flex-1 px-4 py-2 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex-1 px-4 py-2 rounded-xl text-xs font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60">
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── TOP ROW ── */}
      <div className="relative flex items-end gap-4" style={{ marginBottom: -50 }}>
        {/* Greeting — left column; QB buttons sit below greeting text, well left of the clock */}
        <div className="flex-1 pb-3">
          <h2 className="text-clinic-navy dark:text-white text-xl font-bold leading-tight" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            {greeting}, {name}! 👋
          </h2>
          <p className="text-gray-400 dark:text-blue-300 text-xs mt-0.5">{dateStr}</p>

          {/* QuickBooks controls — own row below greeting */}
          <div className="mt-3 flex items-center gap-1.5 flex-wrap">
            {qbStatus?.connected ? (
              <>
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-800">
                  <CheckCircle size={13} className="text-green-500" />
                  {qbStatus.companyName || 'QuickBooks'} Connected
                </div>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  title="Sync from QuickBooks"
                  className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-semibold bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors disabled:opacity-60">
                  <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Syncing…' : 'Sync'}
                </button>
                <button
                  onClick={() => setShowDisconnectModal(true)}
                  title="Disconnect QuickBooks"
                  className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-semibold bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 transition-colors">
                  <Unplug size={12} />
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  const token = localStorage.getItem('cc_token')
                  window.location.href = `/api-proxy/accounts/quickbooks/connect?token=${token}`
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{ background: 'linear-gradient(135deg,#2CA01C,#4DB629)', boxShadow: '0 4px 12px rgba(44,160,28,0.3)' }}>
                <QBLogo size={22} />
                Connect QuickBooks
              </button>
            )}
          </div>
        </div>

        {/* Clock — centred */}
        <div className="flex-shrink-0 rounded-2xl px-5 py-4 shadow-2xl"
          style={{
            background: 'linear-gradient(135deg,#1A237E,#0d47a1)',
            boxShadow: '0 12px 40px rgba(26,35,126,0.4)',
            position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', zIndex: 5,
          }}>
          <AnalogClock />
        </div>

        {/* Dental image */}
        <div className="flex-shrink-0 pointer-events-none select-none" style={{ width: 190 }}>
          <Image src="/dental40.png" alt="Dental" width={190} height={170} priority
            style={{ objectFit: 'contain', objectPosition: 'bottom', filter: 'drop-shadow(0 10px 32px rgba(41,171,226,0.4))', display: 'block', width: '100%', height: 'auto' }} />
        </div>
      </div>

      {/* ── 4 STAT CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" style={{ paddingTop: 58 }}>
        {stats.map((k, i) => (
          <div key={i} className="bg-white dark:bg-white/5 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-white/10 hover:shadow-md transition-all">
            <div className="flex items-start justify-between mb-2">
              <p className="text-[10px] font-semibold text-gray-400 dark:text-white/60 uppercase tracking-wide leading-tight">{k.title}</p>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: k.bg }}>
                <k.icon size={15} style={{ color: k.color }} />
              </div>
            </div>
            {k.value === null ? (
              <div className="h-6 w-28 bg-gray-200 dark:bg-white/10 rounded-lg animate-pulse mb-2" />
            ) : (
              <p className="text-xl font-bold text-clinic-navy dark:text-white truncate">{k.value}</p>
            )}
            <div className={`flex items-center gap-1 text-[10px] font-semibold mt-1 ${k.trend.up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
              {k.trend.up ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
              {k.trend.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── MAIN 2-COL ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">

        {/* LEFT 2/3 — Recent Transactions */}
        <div className="xl:col-span-2">
          <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-white/8">
              <p className="font-bold text-clinic-navy dark:text-white text-sm" style={{ fontFamily: 'Plus Jakarta Sans' }}>
                Recent Transactions
              </p>
              <Link href="/accounts/invoices"
                className="text-[10px] font-semibold text-clinic-blue hover:underline flex items-center gap-1">
                All invoices <ChevronRight size={11}/>
              </Link>
            </div>

            {loading ? (
              <div className="p-4 space-y-3">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-white/10 animate-pulse flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-40 bg-gray-100 dark:bg-white/10 rounded animate-pulse" />
                      <div className="h-2.5 w-24 bg-gray-100 dark:bg-white/10 rounded animate-pulse" />
                    </div>
                    <div className="h-3 w-20 bg-gray-100 dark:bg-white/10 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : !data?.recentInvoices.length ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <AlertCircle size={32} className="mb-2 opacity-30" />
                <p className="text-sm">No recent transactions</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 dark:bg-white/5">
                    <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide px-4 py-2">Invoice</th>
                    <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide px-3 py-2 hidden md:table-cell">Patient</th>
                    <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide px-3 py-2">Amount</th>
                    <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide px-3 py-2">Status</th>
                    <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide px-3 py-2 hidden sm:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {data.recentInvoices.slice(0, 10).map(inv => {
                    const s = statusStyle[inv.status] || statusStyle.DRAFT
                    return (
                      <tr key={inv.id} className="hover:bg-blue-50/30 dark:hover:bg-white/5 transition-colors">
                        <td className="px-4 py-2.5">
                          <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 font-mono">{inv.invoiceNumber}</span>
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell">
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            {inv.patient.firstName} {inv.patient.lastName}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-bold text-gray-800 dark:text-gray-200">{formatUGX(inv.totalUGX)}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: s.bg, color: s.text }}>
                            {s.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 hidden sm:table-cell">
                          <span className="text-[10px] text-gray-400">
                            {new Date(inv.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT 1/3 — P&L Chart */}
        <div className="space-y-3">
          <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 p-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide">Profit & Loss</p>
                <p className="text-sm font-bold text-clinic-navy dark:text-white mt-0.5">6-Month Trend</p>
              </div>
              <Link href="/accounts/reports/pl"
                className="text-[10px] font-semibold text-clinic-blue hover:underline flex items-center gap-1">
                Full report <ChevronRight size={10}/>
              </Link>
            </div>

            {loading ? (
              <div className="h-48 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />
            ) : data?.trend.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.trend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip content={<PLTooltip />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 9, paddingTop: 8 }} />
                  <Bar dataKey="revenue"  fill="#29ABE2" radius={[4,4,0,0]} name="Revenue" />
                  <Bar dataKey="expenses" fill="#EF4444" radius={[4,4,0,0]} name="Expenses" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-400 text-xs">No trend data yet</div>
            )}

            {/* Summary row */}
            {data && (
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-white/8">
                <div className="text-center">
                  <p className="text-[9px] text-gray-400 uppercase font-semibold">Revenue</p>
                  <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{formatUGX(data.monthRevenue)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] text-gray-400 uppercase font-semibold">Expenses</p>
                  <p className="text-[11px] font-bold text-red-500 mt-0.5">{formatUGX(data.monthExpenses)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] text-gray-400 uppercase font-semibold">Net</p>
                  <p className={`text-[11px] font-bold mt-0.5 ${netProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{formatUGX(netProfit)}</p>
                </div>
              </div>
            )}
          </div>

          {/* Outstanding debt card */}
          {data && data.outstandingDebt > 0 && (
            <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-red-100 dark:border-red-500/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={15} className="text-red-500" />
                <p className="text-xs font-bold text-gray-800 dark:text-white">Outstanding Debt</p>
              </div>
              <p className="text-xl font-black text-red-600">{formatUGX(data.outstandingDebt)}</p>
              <p className="text-[10px] text-gray-400 mt-1">{data.unpaidInvoices} unpaid invoice{data.unpaidInvoices !== 1 ? 's' : ''}</p>
              <Link href="/accounts/receivables"
                className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:underline">
                View debtors <ChevronRight size={11} />
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── LIVE PATIENT FLOW (read-only) ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <p className="text-sm font-bold text-clinic-navy dark:text-white" style={{ fontFamily: 'Plus Jakarta Sans' }}>Live Patient Flow</p>
          <span className="text-[10px] text-gray-400 font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 px-2 py-0.5 rounded-full">View only</span>
        </div>
        <LivePatientFlow readOnly />
      </div>

    </div>
  )
}
