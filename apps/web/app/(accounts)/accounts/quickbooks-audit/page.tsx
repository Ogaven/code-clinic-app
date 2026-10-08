'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Search, ShieldCheck } from 'lucide-react'

type Audit = {
  readOnly: boolean
  generatedAt: string
  connection: {
    environment: string
    realmId: string
    companyName: string
    connectedAt: string | null
    liveCompanyInfoVerified: boolean
  }
  diagnostics: {
    countQuery: { customers: number | null; invoices: number | null; payments: number | null; purchases: number | null }
    reports: { profitAndLossHasData: boolean | null; balanceSheetHasData: boolean | null }
  }
  summary: {
    codeClinicPatients: number
    quickBooksCustomers: number
    quickBooksInvoices: number
    quickBooksPayments: number
    quickBooksPurchases: number
    quickBooksReferencedCustomers: number
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
  const [quickCheck, setQuickCheck] = useState<{ connected: boolean; realmId?: string; companyName?: string | null } | null>(null)
  const [checking, setChecking] = useState(false)

  async function runQuickCheck() {
    const token = localStorage.getItem('cc_token')
    if (!token) { setError('Please sign in to Accounts again.'); return }
    setChecking(true); setError('')
    try {
      const response = await fetch('/api-proxy/accounts/quickbooks/audit/quick-check', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`Company check failed (HTTP ${response.status}).`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Company check failed')
      setQuickCheck(result)
    } catch (err: any) { setError(err?.message || 'Company check failed') }
    finally { setChecking(false) }
  }

  async function runAudit() {
    const token = localStorage.getItem('cc_token')
    if (!token) { setError('Your Accounts session has expired. Please sign in again.'); return }
    setLoading(true); setError('')
    try {
      const response = await fetch('/api-proxy/accounts/quickbooks/audit/patient-reconciliation', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.toLowerCase().includes('application/json')) {
        if (response.status === 524 || response.status === 522 || response.status === 504) {
          throw new Error('QuickBooks audit timed out before the server responded. The audit is read-only; please retry later. No records were changed.')
        }
        if (response.redirected || response.status === 401 || response.status === 403) {
          throw new Error('Your session may have expired. Sign in to Accounts again and retry the audit.')
        }
        throw new Error(`QuickBooks audit returned an unexpected server response (HTTP ${response.status}). Please contact support if this continues.`)
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `QuickBooks audit failed (HTTP ${response.status})`)
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
    ['QB invoices', audit.summary.quickBooksInvoices],
    ['QB payments', audit.summary.quickBooksPayments],
    ['QB purchases', audit.summary.quickBooksPurchases],
    ['QB referenced customers', audit.summary.quickBooksReferencedCustomers],
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
        <div className="flex flex-wrap gap-2"><button onClick={runQuickCheck} disabled={checking} className="flex items-center justify-center gap-2 rounded-xl bg-[#2CA01C] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">{checking ? 'Checking…' : 'Check Connected Company'}</button><button onClick={runAudit} disabled={loading} className="flex items-center justify-center gap-2 rounded-xl bg-[#2CA01C] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
          {loading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
          {loading ? 'Auditing…' : audit ? 'Run Full Audit Again' : 'Run Full Audit'}
        </button></div>
      </div>

      {quickCheck && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><strong>Stored QuickBooks connection:</strong> {quickCheck.connected ? `${quickCheck.companyName || 'Company name unavailable'} · Company ID ${quickCheck.realmId || 'unknown'}` : 'Not connected'}<p className="mt-1 text-xs">Read-only stored identity check. This does not query QuickBooks customers or change records.</p></div>}

      {error && <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700"><AlertTriangle size={15} />{error}</div>}

      {audit && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5 dark:border-blue-900 dark:bg-blue-950/10">
          <div className="flex items-center gap-2"><CheckCircle2 size={17} className="text-blue-600" /><h3 className="text-sm font-bold text-gray-800 dark:text-white">Live QuickBooks connection identity</h3></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Environment</p><p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{audit.connection.environment}</p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Company</p><p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{audit.connection.companyName || 'Not returned'}</p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Realm / Company ID</p><p className="mt-1 break-all text-sm font-bold text-gray-900 dark:text-white">{audit.connection.realmId || 'Not returned'}</p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Live CompanyInfo</p><p className="mt-1 text-sm font-bold text-emerald-700">{audit.connection.liveCompanyInfoVerified ? 'Verified ✓' : 'Not verified'}</p></div>
          </div>
          <p className="mt-3 text-[11px] text-gray-500">Connected {audit.connection.connectedAt ? new Date(audit.connection.connectedAt).toLocaleString() : 'date unavailable'}. This identity is read live from QuickBooks during the audit; no accounting or patient records are changed.</p>
        </div>
      )}

      {!audit && !error && <div className="rounded-2xl border border-dashed border-gray-200 bg-white/50 py-16 text-center dark:border-white/10 dark:bg-white/[0.03]"><Search size={28} className="mx-auto mb-3 text-gray-300" /><p className="text-sm font-semibold text-gray-600 dark:text-gray-300">No audit has been run in this session.</p><p className="mt-1 text-xs text-gray-400">Click Run Live Audit to compare the current records.</p></div>}

      {audit && <>
        <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-5 dark:border-violet-900 dark:bg-violet-950/10">
          <h3 className="text-sm font-bold text-gray-800 dark:text-white">Independent QuickBooks read diagnostics</h3>
          <p className="mt-1 text-xs leading-5 text-gray-500">These checks use separate QuickBooks count queries and financial reports. They are read-only and return only counts/data-presence signals here, not accounting details.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
            {[
              ['Customer count', audit.diagnostics.countQuery.customers],
              ['Invoice count', audit.diagnostics.countQuery.invoices],
              ['Payment count', audit.diagnostics.countQuery.payments],
              ['Purchase count', audit.diagnostics.countQuery.purchases],
            ].map(([label, value]) => <div key={String(label)}><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{value == null ? 'Unavailable' : Number(value).toLocaleString()}</p></div>)}
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Profit & Loss</p><p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{audit.diagnostics.reports.profitAndLossHasData == null ? 'Unavailable' : audit.diagnostics.reports.profitAndLossHasData ? 'Data present ✓' : 'No data'}</p></div>
            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Balance Sheet</p><p className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{audit.diagnostics.reports.balanceSheetHasData == null ? 'Unavailable' : audit.diagnostics.reports.balanceSheetHasData ? 'Data present ✓' : 'No data'}</p></div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
          {cards.map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/10 dark:bg-white/5"><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{Number(value).toLocaleString()}</p></div>)}
        </div>

        {audit.summary.quickBooksCustomers === 0 && (audit.summary.quickBooksInvoices > 0 || audit.summary.quickBooksPayments > 0 || audit.summary.quickBooksReferencedCustomers > 0) && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
            <div><p className="text-sm font-bold">QuickBooks contains financial records but the customer list is empty</p><p className="mt-1 text-xs leading-5">This points to a QuickBooks customer retrieval or company-data issue. No patient/customer linking should be attempted until this is resolved.</p></div>
          </div>
        )}

        {audit.summary.quickBooksCustomers === 0 && audit.summary.quickBooksInvoices === 0 && audit.summary.quickBooksPayments === 0 && audit.summary.quickBooksPurchases === 0 && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
            <div><p className="text-sm font-bold">No QuickBooks accounting records returned</p><p className="mt-1 text-xs leading-5">The connection is authenticated, but this company returned zero customers, invoices, payments and purchases. Verify that the connected QuickBooks company is the intended live company before any synchronization.</p></div>
          </div>
        )}

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
