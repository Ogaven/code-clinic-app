'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Search, ShieldCheck } from 'lucide-react'

type Audit = {
  readOnly: boolean
  generatedAt: string
  summary: {
    codeClinicPatients: number
    quickBooksCustomers: number
    exactLinkedPatients: number
    exactLinkedQuickBooksCustomers: number
    candidateMatches: number
    strongCandidates: number
    reviewCandidates: number
    codeClinicOnly: number
    quickBooksOnly: number
    invoiceQbLinks: number
    brokenInvoiceQbCustomerLinks: number
  }
  exactLinks: Array<{ patientId: string; qbCustomerId: string; basis: string }>
  candidateMatches: Array<{ patientId: string; qbCustomerId: string; signals: string[]; confidence: 'strong' | 'review' }>
}

export default function QuickBooksAuditPage() {
  const [audit, setAudit] = useState<Audit | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function runAudit() {
    const token = localStorage.getItem('cc_token')
    if (!token) { setError('Your Accounts session has expired. Please sign in again.'); return }
    setLoading(true); setError('')
    try {
      const response = await fetch('/api-proxy/accounts/quickbooks/audit/patient-reconciliation', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'QuickBooks audit failed')
      setAudit(body)
    } catch (err: any) {
      setError(err?.message || 'QuickBooks audit failed')
    } finally {
      setLoading(false)
    }
  }

  const cards = audit ? [
    ['Code Clinic patients', audit.summary.codeClinicPatients],
    ['QuickBooks customers', audit.summary.quickBooksCustomers],
    ['Exact linked patients', audit.summary.exactLinkedPatients],
    ['Strong candidates', audit.summary.strongCandidates],
    ['Review candidates', audit.summary.reviewCandidates],
    ['Code Clinic only', audit.summary.codeClinicOnly],
    ['QuickBooks only', audit.summary.quickBooksOnly],
    ['Invoice QB links', audit.summary.invoiceQbLinks],
  ] : []

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 text-emerald-700" size={20} />
          <div>
            <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">Read-only QuickBooks reconciliation audit</h2>
            <p className="mt-1 text-xs leading-5 text-emerald-800 dark:text-emerald-300">This checks the live QuickBooks customer list against Code Clinic patients and existing invoice links. It does not create, merge, link, edit or delete patient or QuickBooks records.</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-white/5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">QuickBooks Data Audit</h1>
          <p className="mt-1 text-xs text-gray-500">Use this to verify whether the two systems contain corresponding people, not just whether the API is connected.</p>
        </div>
        <button onClick={runAudit} disabled={loading} className="flex items-center justify-center gap-2 rounded-xl bg-[#2CA01C] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
          {loading ? 'Auditing…' : audit ? 'Run Audit Again' : 'Run Live Audit'}
        </button>
      </div>

      {error && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700"><AlertTriangle size={15} />{error}</div>}

      {!audit && !error && <div className="rounded-2xl border border-dashed border-gray-200 bg-white/50 py-16 text-center dark:border-white/10 dark:bg-white/[0.03]"><Search size={28} className="mx-auto mb-3 text-gray-300" /><p className="text-sm font-semibold text-gray-600 dark:text-gray-300">No audit has been run in this session.</p><p className="mt-1 text-xs text-gray-400">Click Run Live Audit to compare the current records.</p></div>}

      {audit && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-white/5"><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{Number(value).toLocaleString()}</p></div>)}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-2"><CheckCircle2 size={17} className="text-emerald-600" /><h3 className="text-sm font-bold text-gray-800 dark:text-white">Verified links</h3></div>
            <p className="mt-2 text-xs leading-5 text-gray-500">{audit.summary.exactLinkedPatients} Code Clinic patient(s) have an existing invoice customer ID that resolves to a current QuickBooks customer. These are the strongest existing system links.</p>
            <p className="mt-3 text-[11px] text-gray-400">QuickBooks-linked invoices: {audit.summary.invoiceQbLinks.toLocaleString()} · Broken customer links: {audit.summary.brokenInvoiceQbCustomerLinks.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-5 dark:border-amber-900 dark:bg-amber-950/10">
            <div className="flex items-center gap-2"><AlertTriangle size={17} className="text-amber-600" /><h3 className="text-sm font-bold text-gray-800 dark:text-white">Candidates needing review</h3></div>
            <p className="mt-2 text-xs leading-5 text-gray-600 dark:text-gray-300">{audit.summary.strongCandidates} strong candidate(s) were found by phone/email or multiple signals. {audit.summary.reviewCandidates} name-only candidate(s) require human review. Nothing is linked automatically.</p>
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 px-4 py-3 text-[10px] text-gray-400 dark:bg-white/5">Generated {new Date(audit.generatedAt).toLocaleString()} · Read-only: {audit.readOnly ? 'Yes' : 'No'}</div>
      </>}
    </div>
  )
}
