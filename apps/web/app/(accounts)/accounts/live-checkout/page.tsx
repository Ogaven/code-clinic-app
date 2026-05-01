'use client'

import { useCallback, useEffect, useState } from 'react'
import { Clock, X, Plus, Trash2, RefreshCw, Receipt } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { formatUGX } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────
interface CheckoutPatient {
  id: string
  status: string
  startAt: string
  updatedAt: string
  patient: { id: string; firstName: string; lastName: string }
  doctor: { user: { firstName: string; lastName: string } }
  service: { name: string; colour: string; durationMins: number }
}

interface LineItem {
  description: string
  unitPrice: number
  quantity: number
}

// ── Elapsed helper ────────────────────────────────────────────────────────────
function elapsed(dateStr: string) {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  const text = mins < 1 ? 'just now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
  const color = mins < 15 ? '#10B981' : mins < 30 ? '#F59E0B' : '#EF4444'
  return { text, color }
}

const PAYMENT_METHODS = ['Cash', 'Mobile Money', 'Card', 'Insurance']

// ── Invoice Modal ─────────────────────────────────────────────────────────────
function InvoiceModal({
  patient,
  onClose,
  onSaved,
}: {
  patient: CheckoutPatient
  onClose: () => void
  onSaved: () => void
}) {
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: patient.service.name, unitPrice: 0, quantity: 1 },
  ])
  const [discount,       setDiscount]       = useState(0)
  const [applyVAT,       setApplyVAT]       = useState(false)
  const [paymentMethod,  setPaymentMethod]  = useState('Cash')
  const [dueDate,        setDueDate]        = useState('')
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')

  const subtotal  = lineItems.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const afterDisc = Math.max(0, subtotal - discount)
  const vat       = applyVAT ? Math.round(afterDisc * 0.18) : 0
  const total     = afterDisc + vat

  function addLine() {
    setLineItems(prev => [...prev, { description: '', unitPrice: 0, quantity: 1 }])
  }
  function removeLine(i: number) {
    setLineItems(prev => prev.filter((_, idx) => idx !== i))
  }
  function updateLine(i: number, field: keyof LineItem, value: string | number) {
    setLineItems(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  async function save() {
    if (!lineItems.length) { setError('Add at least one line item'); return }
    setSaving(true); setError('')
    try {
      const token = localStorage.getItem('cc_token')
      const body = {
        patientId:     patient.patient.id,
        appointmentId: patient.id,
        lineItems:     lineItems.map(l => ({
          description: l.description || patient.service.name,
          unitPrice:   Math.round(l.unitPrice),
          quantity:    l.quantity,
        })),
        dueDate:     dueDate || undefined,
        applyVAT,
        paymentMethod,
      }
      const res = await fetch('/api-proxy/accounts/invoices', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error || 'Failed to save invoice')
        return
      }
      onSaved()
    } catch {
      setError('Failed to save invoice')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#0e2045] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/10 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/8 flex-shrink-0">
          <div>
            <h3 className="text-base font-bold text-gray-800 dark:text-white">Create Invoice</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {patient.patient.firstName} {patient.patient.lastName} · Dr. {patient.doctor.user.firstName} {patient.doctor.user.lastName}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/8">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Line items */}
          <div>
            <p className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-2">Line Items</p>
            <div className="space-y-2">
              {lineItems.map((l, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input
                    value={l.description}
                    onChange={e => updateLine(i, 'description', e.target.value)}
                    placeholder="Description"
                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    min={0}
                    value={l.unitPrice || ''}
                    onChange={e => updateLine(i, 'unitPrice', Number(e.target.value))}
                    placeholder="Price (UGX)"
                    className="w-32 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={e => updateLine(i, 'quantity', Math.max(1, Number(e.target.value)))}
                    className="w-16 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {lineItems.length > 1 && (
                    <button onClick={() => removeLine(i)} className="p-2 text-red-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addLine}
                className="flex items-center gap-1.5 text-xs font-semibold text-clinic-blue hover:underline mt-1">
                <Plus size={12} /> Add line item
              </button>
            </div>
          </div>

          {/* Discount & VAT */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide block mb-1">Discount (UGX)</label>
              <input
                type="number"
                min={0}
                value={discount || ''}
                onChange={e => setDiscount(Number(e.target.value))}
                placeholder="0"
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide block mb-1">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide block mb-2">Payment Method</label>
            <div className="flex gap-2 flex-wrap">
              {PAYMENT_METHODS.map(m => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    paymentMethod === m
                      ? 'text-white'
                      : 'bg-gray-100 dark:bg-white/8 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/12'
                  }`}
                  style={paymentMethod === m ? { background: 'linear-gradient(135deg,#1A237E,#29ABE2)' } : {}}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* VAT toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => setApplyVAT(!applyVAT)}
              className={`relative w-10 h-5 rounded-full transition-all ${applyVAT ? 'bg-blue-500' : 'bg-gray-200 dark:bg-white/20'}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${applyVAT ? 'left-5' : 'left-0.5'}`} />
            </div>
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Apply VAT (18%)</span>
          </label>

          {/* Totals */}
          <div className="bg-gray-50 dark:bg-white/5 rounded-2xl p-4 space-y-1.5">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Subtotal</span><span className="font-semibold">{formatUGX(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-xs text-red-500">
                <span>Discount</span><span className="font-semibold">− {formatUGX(discount)}</span>
              </div>
            )}
            {applyVAT && (
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>VAT 18%</span><span className="font-semibold">{formatUGX(vat)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-clinic-navy dark:text-white border-t border-gray-200 dark:border-white/10 pt-1.5 mt-1.5">
              <span>Total</span><span className="text-clinic-blue">{formatUGX(total)}</span>
            </div>
          </div>

          {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-white/8 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !lineItems[0]?.unitPrice}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
            {saving ? 'Saving…' : 'Save Invoice'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Patient Card ──────────────────────────────────────────────────────────────
function PatientCard({
  appt,
  onCreateInvoice,
}: {
  appt: CheckoutPatient
  onCreateInvoice: (a: CheckoutPatient) => void
}) {
  const { text: elText, color: elColor } = elapsed(appt.updatedAt)
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden hover:shadow-md transition-all">
      <div className="flex items-center gap-3 p-4 border-b border-gray-50 dark:border-white/8">
        <Avatar firstName={appt.patient.firstName} lastName={appt.patient.lastName} colour={appt.service.colour} size="md" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 dark:text-white truncate">
            {appt.patient.firstName} {appt.patient.lastName}
          </p>
          <p className="text-[11px] text-gray-400 truncate">{appt.service.name}</p>
          <p className="text-[10px] text-gray-400 truncate">Dr. {appt.doctor.user.firstName} {appt.doctor.user.lastName}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="flex items-center gap-1 justify-end">
            <Clock size={10} style={{ color: elColor }} />
            <span className="text-[10px] font-bold tabular-nums" style={{ color: elColor }}>{elText}</span>
          </div>
          <span className="text-[9px] font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-full mt-1 inline-block">
            Checkout
          </span>
        </div>
      </div>
      <div className="px-4 py-3">
        <button
          onClick={() => onCreateInvoice(appt)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-md"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow: '0 4px 12px rgba(41,171,226,0.3)' }}>
          <Receipt size={14} />
          Create Invoice
        </button>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const CHECKOUT_STATUSES = ['SESSION_COMPLETE', 'CHECKOUT']

export default function LiveCheckoutPage() {
  const [patients,  setPatients]  = useState<CheckoutPatient[]>([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState<CheckoutPatient | null>(null)
  const [toast,     setToast]     = useState('')

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  const fetchCheckout = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await fetch(
        `/api-proxy/scheduling/appointments?startDate=${today}&endDate=${today}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) return
      const data = await res.json()
      const checkout = (Array.isArray(data) ? data : []).filter(
        (a: CheckoutPatient) => CHECKOUT_STATUSES.includes(a.status)
      )
      setPatients(checkout)
    } catch {} finally { setLoading(false) }
  }, [token])

  useEffect(() => {
    fetchCheckout()
    const t = setInterval(fetchCheckout, 30000)
    return () => clearInterval(t)
  }, [fetchCheckout])

  function handleSaved() {
    setSelected(null)
    setToast('Invoice created successfully')
    setTimeout(() => setToast(''), 3500)
    fetchCheckout()
  }

  return (
    <div className="space-y-4">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[99999] bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-semibold">
          {toast}
        </div>
      )}

      {/* Invoice modal */}
      {selected && (
        <InvoiceModal patient={selected} onClose={() => setSelected(null)} onSaved={handleSaved} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-clinic-navy dark:text-white" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            Live Checkout
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Patients at Checkout & Billing stage today</p>
        </div>
        <div className="flex items-center gap-3">
          {patients.length > 0 && (
            <span className="text-xs font-bold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-3 py-1.5 rounded-full">
              {patients.length} waiting
            </span>
          )}
          <button onClick={fetchCheckout}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 animate-pulse">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 bg-gray-200 dark:bg-white/10 rounded" />
                  <div className="h-2.5 w-24 bg-gray-200 dark:bg-white/10 rounded" />
                </div>
              </div>
              <div className="h-10 w-full bg-gray-200 dark:bg-white/10 rounded-xl" />
            </div>
          ))}
        </div>
      ) : patients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="w-20 h-20 rounded-full bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center mb-4">
            <Receipt size={32} className="text-purple-400" />
          </div>
          <p className="text-base font-semibold text-gray-600 dark:text-gray-300">No patients at checkout</p>
          <p className="text-sm mt-1">Patients ready for billing will appear here</p>
          <button onClick={fetchCheckout}
            className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-clinic-blue bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 transition-colors">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {patients.map(appt => (
            <PatientCard key={appt.id} appt={appt} onCreateInvoice={setSelected} />
          ))}
        </div>
      )}
    </div>
  )
}
