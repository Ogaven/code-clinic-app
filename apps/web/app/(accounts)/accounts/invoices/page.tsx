'use client'
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, AlertCircle, ExternalLink, CloudUpload, CheckCircle2, XCircle, Clock } from 'lucide-react'

// ── QB status badge ────────────────────────────────────────────────────────────
function QBSyncBadge({ status }: { status?: string | null }) {
  if (status === 'SYNCED')  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
      <CheckCircle2 size={9} /> Synced
    </span>
  )
  if (status === 'FAILED')  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">
      <XCircle size={9} /> Failed
    </span>
  )
  if (status === 'PENDING') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
      <Clock size={9} /> Pending
    </span>
  )
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-400 dark:text-gray-500">
      Not synced
    </span>
  )
}

// ── Local invoice status badge ─────────────────────────────────────────────────
function InvStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    DRAFT:    { bg: 'bg-gray-100 dark:bg-white/10',    text: 'text-gray-500 dark:text-gray-400', label: 'Draft' },
    SENT:     { bg: 'bg-blue-50 dark:bg-blue-900/20',  text: 'text-blue-600 dark:text-blue-400', label: 'Sent' },
    PAID:     { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-400', label: 'Paid' },
    OVERDUE:  { bg: 'bg-red-50 dark:bg-red-900/20',    text: 'text-red-600 dark:text-red-400',   label: 'Overdue' },
    CANCELLED:{ bg: 'bg-gray-100 dark:bg-white/10',    text: 'text-gray-500 dark:text-gray-400', label: 'Cancelled' },
  }
  const s = map[status] || map.DRAFT
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.bg} ${s.text}`}>{s.label}</span>
  )
}

// ── QB invoice status badge ────────────────────────────────────────────────────
function QBInvStatusBadge({ balance }: { balance: number }) {
  return balance === 0
    ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">Paid</span>
    : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600">Open</span>
}

// ─────────────────────────────────────────────────────────────────────────────
export default function InvoicesPage() {
  const [tab, setTab]             = useState<'local' | 'quickbooks'>('local')
  const [qbConnected, setQbConnected] = useState<boolean | null>(null)

  // Local invoices state
  const [localInvoices, setLocalInvoices] = useState<any[]>([])
  const [localLoading,  setLocalLoading]  = useState(true)
  const [localTotal,    setLocalTotal]    = useState(0)
  const [pushingId,     setPushingId]     = useState<string | null>(null)

  // QB invoices state
  const [qbInvoices, setQbInvoices] = useState<any[]>([])
  const [qbLoading,  setQbLoading]  = useState(false)

  const tok = () => typeof window !== 'undefined' ? localStorage.getItem('cc_token') ?? '' : ''

  // ── Load QB connection status ──────────────────────────────────────────────
  useEffect(() => {
    const token = tok()
    if (!token) return
    fetch('/api-proxy/accounts/quickbooks/status', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setQbConnected(!!d.connected))
      .catch(() => setQbConnected(false))
  }, [])

  // ── Load local invoices ────────────────────────────────────────────────────
  const loadLocal = useCallback(async () => {
    setLocalLoading(true)
    try {
      const res  = await fetch('/api-proxy/accounts/invoices?limit=200', { headers: { Authorization: `Bearer ${tok()}` } })
      const data = await res.json()
      setLocalInvoices(data.data || [])
      setLocalTotal(data.total || 0)
    } catch {}
    setLocalLoading(false)
  }, [])

  // ── Load QB invoices ───────────────────────────────────────────────────────
  const loadQB = useCallback(async () => {
    if (!qbConnected) return
    setQbLoading(true)
    try {
      const res  = await fetch('/api-proxy/accounts/quickbooks/invoices', { headers: { Authorization: `Bearer ${tok()}` } })
      const data = await res.json()
      setQbInvoices(data.data || [])
    } catch {}
    setQbLoading(false)
  }, [qbConnected])

  useEffect(() => { loadLocal() }, [loadLocal])
  useEffect(() => {
    if (tab === 'quickbooks' && qbConnected && !qbInvoices.length) loadQB()
  }, [tab, qbConnected, qbInvoices.length, loadQB])

  // ── Push single invoice to QB ──────────────────────────────────────────────
  async function pushToQB(invoiceId: string) {
    setPushingId(invoiceId)
    try {
      await fetch(`/api-proxy/accounts/quickbooks/push-invoice/${invoiceId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok()}` },
      })
      await loadLocal()  // reload to get updated qbSyncStatus
    } finally {
      setPushingId(null)
    }
  }

  // ── Summary stats for local invoices ──────────────────────────────────────
  const totalAmt    = localInvoices.reduce((s, i) => s + (i.totalUGX ?? 0), 0)
  const totalPaid   = localInvoices.filter(i => i.status === 'PAID').reduce((s, i) => s + (i.totalUGX ?? 0), 0)
  const outstanding = localInvoices.filter(i => ['SENT','OVERDUE'].includes(i.status)).reduce((s, i) => s + (i.totalUGX ?? 0), 0)
  const syncedCount = localInvoices.filter(i => i.qbSyncStatus === 'SYNCED').length

  return (
    <div className="space-y-4">

      {/* Tab bar */}
      <div className="flex items-center gap-2 border-b border-gray-100 dark:border-white/10 pb-2">
        <button
          onClick={() => setTab('local')}
          className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${tab === 'local' ? 'bg-clinic-navy text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'}`}>
          Code Clinic
        </button>
        {qbConnected && (
          <button
            onClick={() => setTab('quickbooks')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${tab === 'quickbooks' ? 'bg-[#2CA01C] text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10'}`}>
            QuickBooks
          </button>
        )}
        {!qbConnected && qbConnected !== null && (
          <a href="/api-proxy/accounts/quickbooks/connect"
            className="ml-auto text-[11px] font-semibold text-[#2CA01C] hover:underline flex items-center gap-1">
            Connect QuickBooks →
          </a>
        )}
      </div>

      {/* ── CODE CLINIC TAB ── */}
      {tab === 'local' && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Invoiced', value: `UGX ${totalAmt.toLocaleString()}`,   color: 'text-blue-600' },
              { label: 'Total Paid',     value: `UGX ${totalPaid.toLocaleString()}`,   color: 'text-emerald-600' },
              { label: 'Outstanding',    value: `UGX ${outstanding.toLocaleString()}`, color: 'text-red-500' },
              { label: 'QB Synced',      value: `${syncedCount} / ${localInvoices.length}`, color: 'text-[#2CA01C]' },
            ].map(c => (
              <div key={c.label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 text-center">
                <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">{c.label}</p>
                <p className={`text-sm font-bold ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <a href="https://app.qbo.intuit.com/app/invoice" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#2CA01C] text-white hover:bg-[#228016] transition-colors">
              <ExternalLink size={12} /> Open QuickBooks
            </a>
            <button onClick={loadLocal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
              <RefreshCw size={12} className={localLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
            {localLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : localInvoices.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-gray-400">
                <AlertCircle size={28} className="mb-2 opacity-40" />
                <p className="text-sm">No invoices found</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Invoice #</th>
                    <th className="text-left px-3 py-2.5 hidden md:table-cell">Patient</th>
                    <th className="text-left px-3 py-2.5 hidden sm:table-cell">Date</th>
                    <th className="text-right px-3 py-2.5">Amount</th>
                    <th className="text-left px-3 py-2.5">Status</th>
                    <th className="text-left px-3 py-2.5">QB Sync</th>
                    {qbConnected && <th className="text-left px-4 py-2.5"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {localInvoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-blue-50/30 dark:hover:bg-white/5 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{inv.invoiceNumber}</td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden md:table-cell">
                        {inv.patient?.firstName} {inv.patient?.lastName}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden sm:table-cell">
                        {new Date(inv.createdAt).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold text-gray-800 dark:text-gray-200">
                        UGX {(inv.totalUGX ?? 0).toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5"><InvStatusBadge status={inv.status} /></td>
                      <td className="px-3 py-2.5"><QBSyncBadge status={inv.qbSyncStatus} /></td>
                      {qbConnected && (
                        <td className="px-4 py-2.5">
                          {inv.qbSyncStatus !== 'SYNCED' && (
                            <button
                              onClick={() => pushToQB(inv.id)}
                              disabled={pushingId === inv.id}
                              title="Push to QuickBooks"
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-[#2CA01C]/10 text-[#2CA01C] hover:bg-[#2CA01C]/20 transition-colors disabled:opacity-50">
                              {pushingId === inv.id
                                ? <RefreshCw size={9} className="animate-spin" />
                                : <CloudUpload size={9} />}
                              {pushingId === inv.id ? '…' : 'Push'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-[10px] text-gray-400 text-right">{localTotal} invoice{localTotal !== 1 ? 's' : ''} total</p>
        </>
      )}

      {/* ── QUICKBOOKS TAB ── */}
      {tab === 'quickbooks' && qbConnected && (
        <>
          {/* QB summary */}
          {!qbLoading && qbInvoices.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total Invoiced', value: qbInvoices.reduce((s: number, i: any) => s + Number(i.TotalAmt || 0), 0), color: 'text-blue-600' },
                { label: 'Total Paid',     value: qbInvoices.filter((i: any) => Number(i.Balance) === 0).reduce((s: number, i: any) => s + Number(i.TotalAmt || 0), 0), color: 'text-emerald-600' },
                { label: 'Outstanding',    value: qbInvoices.reduce((s: number, i: any) => s + Number(i.Balance || 0), 0), color: 'text-red-500' },
              ].map(c => (
                <div key={c.label} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 text-center">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold mb-1">{c.label}</p>
                  <p className={`text-sm font-bold ${c.color}`}>UGX {c.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between items-center">
            <a href="https://app.qbo.intuit.com/app/invoice" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#2CA01C] text-white hover:bg-[#228016] transition-colors">
              <ExternalLink size={12} /> Create in QuickBooks
            </a>
            <button onClick={loadQB}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 hover:bg-gray-200">
              <RefreshCw size={12} className={qbLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 overflow-hidden">
            {qbLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-100 dark:bg-white/10 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : qbInvoices.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-gray-400">
                <AlertCircle size={28} className="mb-2 opacity-40" />
                <p className="text-sm">No invoices in QuickBooks</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-white/5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5">Invoice #</th>
                    <th className="text-left px-3 py-2.5 hidden md:table-cell">Customer</th>
                    <th className="text-left px-3 py-2.5 hidden sm:table-cell">Date</th>
                    <th className="text-left px-3 py-2.5 hidden lg:table-cell">Due</th>
                    <th className="text-right px-3 py-2.5">Amount</th>
                    <th className="text-right px-3 py-2.5">Balance</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                  {qbInvoices.map((inv: any) => (
                    <tr key={inv.Id} className="hover:bg-blue-50/30 dark:hover:bg-white/5">
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{inv.DocNumber || inv.Id}</td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden md:table-cell">{inv.CustomerRef?.name || '—'}</td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden sm:table-cell">{inv.TxnDate || '—'}</td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 hidden lg:table-cell">{inv.DueDate || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold text-gray-800 dark:text-gray-200">{Number(inv.TotalAmt || 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right text-xs font-bold text-red-500">{Number(inv.Balance || 0).toLocaleString()}</td>
                      <td className="px-4 py-2.5"><QBInvStatusBadge balance={Number(inv.Balance)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
