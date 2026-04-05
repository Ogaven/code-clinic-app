'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Search, Filter, ChevronLeft, ChevronRight, X, CheckCircle, CreditCard, Smartphone, Banknote } from 'lucide-react'
import { cn, formatUGX, formatPhone } from '@/lib/utils'

interface Invoice {
  id: string
  invoiceNumber: string
  patient: { id: string; firstName: string; lastName: string; phone: string }
  totalUGX: number
  subtotalUGX: number
  vatUGX: number
  status: string
  createdAt: string
  dueDate?: string
  lineItems: LineItem[]
  payments?: Payment[]
}

interface LineItem {
  description: string
  quantity: number
  unitPrice: number
  total?: number
}

interface Payment {
  id: string
  amountUGX: number
  method: string
  paidAt: string
}

const STATUS_BADGE: Record<string, string> = {
  PAID:    'bg-green-100 text-green-700',
  DRAFT:   'bg-gray-100 text-gray-600',
  SENT:    'bg-blue-100 text-blue-700',
  OVERDUE: 'bg-red-100 text-red-700',
  VOID:    'bg-gray-100 text-gray-400',
}

const PAYMENT_METHODS = [
  { value: 'CASH',          label: 'Cash',         icon: Banknote },
  { value: 'MTN_MOMO',      label: 'MTN MoMo',     icon: Smartphone },
  { value: 'AIRTEL_MONEY',  label: 'Airtel Money',  icon: Smartphone },
  { value: 'VISA',          label: 'Visa Card',    icon: CreditCard },
  { value: 'MASTERCARD',    label: 'Mastercard',   icon: CreditCard },
]

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [showPayModal, setShowPayModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const limit = 20
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetch_ = useCallback(async (p = page, status = statusFilter) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String((p - 1) * limit) })
      if (status) params.set('status', status)
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api-proxy'}/accounts/invoices?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      setInvoices(data.data || [])
      setTotal(data.total || 0)
    } finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetch_() }, [])
  useEffect(() => { setPage(1); fetch_(1, statusFilter) }, [statusFilter])

  const totalPages = Math.ceil(total / limit)

  const openInvoice = async (inv: Invoice) => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api-proxy'}/accounts/invoices/${inv.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const full = await res.json()
    setSelectedInvoice(full)
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-clinic-navy">Invoices</h2>
          <p className="text-sm text-gray-400 mt-0.5">{total} total invoices</p>
        </div>
        <button onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90">
          <Plus size={16} /> New Invoice
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex gap-3 flex-wrap items-center">
        {['', 'DRAFT', 'SENT', 'PAID', 'OVERDUE'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={cn('text-xs font-semibold px-3 py-1.5 rounded-full border transition-all',
              statusFilter === s ? 'bg-clinic-blue text-white border-clinic-blue' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Invoice #', 'Patient', 'Amount (UGX)', 'Date', 'Due Date', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3.5 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse w-20" /></td>
                  ))}</tr>
                ))
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-400 text-sm">No invoices found</td>
                </tr>
              ) : invoices.map(inv => (
                <tr key={inv.id} onClick={() => openInvoice(inv)}
                  className="hover:bg-blue-50/20 transition-colors cursor-pointer">
                  <td className="px-5 py-3.5">
                    <span className="text-sm font-mono font-medium text-clinic-blue">{inv.invoiceNumber}</span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-700">
                    {inv.patient?.firstName} {inv.patient?.lastName}
                  </td>
                  <td className="px-5 py-3.5 text-sm font-bold text-clinic-navy">
                    {formatUGX(inv.totalUGX)}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-400">
                    {new Date(inv.createdAt).toLocaleDateString('en-UG')}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-400">
                    {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-UG') : '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', STATUS_BADGE[inv.status] || 'bg-gray-100 text-gray-500')}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {inv.status !== 'PAID' && inv.status !== 'VOID' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openInvoice(inv).then(() => setShowPayModal(true)) }}
                        className="text-xs text-clinic-blue hover:underline font-medium">
                        Pay →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-400">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => { setPage(p => p - 1); fetch_(page - 1) }} disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-white border border-gray-200 text-gray-500 disabled:opacity-40">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => { setPage(p => p + 1); fetch_(page + 1) }} disabled={page === totalPages}
                className="p-1.5 rounded-lg hover:bg-white border border-gray-200 text-gray-500 disabled:opacity-40">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Invoice Detail + Pay Panel */}
      {selectedInvoice && (
        <InvoiceDetailPanel
          invoice={selectedInvoice}
          onClose={() => { setSelectedInvoice(null); setShowPayModal(false) }}
          showPayModal={showPayModal}
          onOpenPay={() => setShowPayModal(true)}
          onPaymentDone={() => { setSelectedInvoice(null); setShowPayModal(false); fetch_() }}
          token={token}
        />
      )}

      {showCreateModal && (
        <CreateInvoiceModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetch_() }}
          token={token}
        />
      )}
    </div>
  )
}

// ── Invoice Detail + Payment Side Panel ─────────────────────────────────────
function InvoiceDetailPanel({ invoice, onClose, showPayModal, onOpenPay, onPaymentDone, token }: any) {
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-clinic-navy">{invoice.invoiceNumber}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {invoice.patient?.firstName} {invoice.patient?.lastName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full',
              invoice.status === 'PAID' ? 'bg-green-100 text-green-700' :
              invoice.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
            )}>
              {invoice.status}
            </span>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Line items */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="space-y-2">
            {(invoice.lineItems || []).map((item: LineItem, i: number) => (
              <div key={i} className="flex justify-between items-start py-2.5 border-b border-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-800">{item.description}</p>
                  <p className="text-xs text-gray-400">Qty {item.quantity} × {formatUGX(item.unitPrice)}</p>
                </div>
                <span className="text-sm font-semibold text-gray-800">
                  {formatUGX(item.quantity * item.unitPrice)}
                </span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <div className="flex justify-between text-sm text-gray-500">
              <span>Subtotal</span>
              <span>{formatUGX(invoice.subtotalUGX)}</span>
            </div>
            {invoice.vatUGX > 0 && (
              <div className="flex justify-between text-sm text-gray-500">
                <span>VAT (18%)</span>
                <span>{formatUGX(invoice.vatUGX)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-clinic-navy border-t border-gray-200 pt-2 mt-2">
              <span>Total</span>
              <span>{formatUGX(invoice.totalUGX)}</span>
            </div>
          </div>

          {/* Payment history */}
          {invoice.payments?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Payments</p>
              {invoice.payments.map((p: Payment) => (
                <div key={p.id} className="flex justify-between items-center py-2 border-b border-gray-50 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={12} className="text-green-500" />
                    <span className="text-gray-600">{p.method.replace('_', ' ')}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-gray-800">{formatUGX(p.amountUGX)}</p>
                    <p className="text-xs text-gray-400">{new Date(p.paidAt).toLocaleDateString('en-UG')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pay button */}
        {invoice.status !== 'PAID' && invoice.status !== 'VOID' && (
          <div className="px-6 py-4 border-t border-gray-100">
            <button onClick={onOpenPay}
              className="w-full py-3 bg-clinic-navy text-white font-semibold rounded-xl hover:opacity-90 transition-opacity">
              Record Payment
            </button>
          </div>
        )}
      </div>

      {showPayModal && (
        <PaymentModal invoice={invoice} onClose={() => {}} onPaid={onPaymentDone} token={token} />
      )}
    </>
  )
}

// ── Payment Modal (clone Screenshot 085113) ──────────────────────────────────
function PaymentModal({ invoice, onClose, onPaid, token }: any) {
  const [method, setMethod] = useState('CASH')
  const [amount, setAmount] = useState(String(invoice.totalUGX))
  const [reference, setReference] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pay() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api-proxy'}/accounts/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoiceId: invoice.id, amountUGX: parseInt(amount), method, reference }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      onPaid()
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60] p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl animate-fade-in">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="font-bold text-clinic-navy">Record Payment</h3>
          <p className="text-xs text-gray-400 mt-0.5">{invoice.invoiceNumber}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Amount (UGX)</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue font-mono" />
          </div>

          {/* Method */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map(({ value, label, icon: Icon }) => (
                <button key={value} onClick={() => setMethod(value)}
                  className={cn('flex flex-col items-center gap-1 p-2.5 rounded-xl border text-xs font-medium transition-all',
                    method === value ? 'border-clinic-blue bg-blue-50 text-clinic-blue' : 'border-gray-200 text-gray-500 hover:bg-gray-50')}>
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Reference */}
          {method !== 'CASH' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Reference / Transaction ID</label>
              <input value={reference} onChange={e => setReference(e.target.value)}
                placeholder="e.g. MTN reference number"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
            </div>
          )}

          {/* Total summary */}
          <div className="bg-clinic-navy rounded-xl px-4 py-3 flex justify-between items-center">
            <span className="text-white/70 text-sm">Total Payment</span>
            <span className="text-white font-bold text-lg font-mono">{formatUGX(parseInt(amount) || 0)}</span>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={pay} disabled={loading}
            className="flex-1 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
            {loading ? 'Processing...' : 'Pay Now'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Create Invoice Modal ──────────────────────────────────────────────────────
function CreateInvoiceModal({ onClose, onCreated, token }: any) {
  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<any[]>([])
  const [selectedPatient, setSelectedPatient] = useState<any>(null)
  const [lineItems, setLineItems] = useState([{ description: '', quantity: 1, unitPrice: 0 }])
  const [applyVAT, setApplyVAT] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!patientSearch || patientSearch.length < 2) return
    const t = setTimeout(() => {
      fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api-proxy'}/patients?q=${patientSearch}&limit=5`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).then(d => setPatients(Array.isArray(d) ? d : d.data || []))
    }, 300)
    return () => clearTimeout(t)
  }, [patientSearch])

  const subtotal = lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const vat = applyVAT ? Math.round(subtotal * 0.18) : 0
  const total = subtotal + vat

  async function submit() {
    if (!selectedPatient) return setError('Select a patient')
    if (!lineItems.some(i => i.description && i.unitPrice > 0)) return setError('Add at least one line item')
    setLoading(true); setError(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api-proxy'}/accounts/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId: selectedPatient.id, lineItems, applyVAT }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      onCreated(data)
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl animate-fade-in max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
            <h2 className="text-lg font-bold text-clinic-navy">New Invoice</h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">✕</button>
          </div>

          <div className="overflow-y-auto px-6 py-5 space-y-4 flex-1">
            {/* Patient search */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Patient *</label>
              {selectedPatient ? (
                <div className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2.5">
                  <span className="text-sm font-medium text-clinic-navy">
                    {selectedPatient.firstName} {selectedPatient.lastName}
                  </span>
                  <button onClick={() => setSelectedPatient(null)} className="text-gray-400 hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={patientSearch} onChange={e => setPatientSearch(e.target.value)}
                    placeholder="Search patient by name..."
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
                  {patients.length > 0 && (
                    <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-10 overflow-hidden">
                      {patients.map(p => (
                        <button key={p.id} onClick={() => { setSelectedPatient(p); setPatients([]); setPatientSearch('') }}
                          className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors">
                          {p.firstName} {p.lastName} — {p.phone}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Line items */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Line Items</label>
              <div className="space-y-2">
                {lineItems.map((item, i) => (
                  <div key={i} className="grid grid-cols-[1fr_60px_90px_28px] gap-2 items-center">
                    <input value={item.description} onChange={e => {
                      const n = [...lineItems]; n[i].description = e.target.value; setLineItems(n)
                    }} placeholder="Description"
                      className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-clinic-blue" />
                    <input type="number" value={item.quantity} min={1} onChange={e => {
                      const n = [...lineItems]; n[i].quantity = parseInt(e.target.value) || 1; setLineItems(n)
                    }}
                      className="px-2 py-2 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-1 focus:ring-clinic-blue" />
                    <input type="number" value={item.unitPrice} onChange={e => {
                      const n = [...lineItems]; n[i].unitPrice = parseInt(e.target.value) || 0; setLineItems(n)
                    }} placeholder="Price"
                      className="px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-clinic-blue" />
                    <button onClick={() => setLineItems(ls => ls.filter((_, j) => j !== i))} disabled={lineItems.length === 1}
                      className="text-gray-300 hover:text-red-400 disabled:opacity-30">✕</button>
                  </div>
                ))}
              </div>
              <button onClick={() => setLineItems(ls => [...ls, { description: '', quantity: 1, unitPrice: 0 }])}
                className="mt-2 text-xs text-clinic-blue hover:underline font-medium">
                + Add line
              </button>
            </div>

            {/* VAT toggle */}
            <div className="flex items-center gap-2">
              <button onClick={() => setApplyVAT(v => !v)}
                className={cn('w-10 h-5 rounded-full transition-colors relative', applyVAT ? 'bg-clinic-blue' : 'bg-gray-200')}>
                <span className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                  applyVAT ? 'translate-x-5' : 'translate-x-0.5')} />
              </button>
              <span className="text-sm text-gray-600">Apply VAT (18%)</span>
            </div>

            {/* Totals */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span><span className="font-mono">{formatUGX(subtotal)}</span>
              </div>
              {applyVAT && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>VAT 18%</span><span className="font-mono">{formatUGX(vat)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-clinic-navy border-t border-gray-200 pt-2 mt-2">
                <span>Total</span><span className="font-mono">{formatUGX(total)}</span>
              </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={loading}
              className="flex-1 py-2.5 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
              {loading ? 'Creating...' : 'Create Invoice'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
