'use client'

import { useEffect, useState } from 'react'
import { Play, CheckCircle, Users, Calculator } from 'lucide-react'
import { cn, formatUGX } from '@/lib/utils'

interface PayrollRecord {
  id: string
  userId: string
  month: string
  grossUGX: number
  nssfEmployee: number
  nssfEmployer: number
  paye: number
  netUGX: number
  status: string
  user: { firstName: string; lastName: string; role: string }
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  role: string
}

export default function PayrollPage() {
  const [payroll, setPayroll] = useState<PayrollRecord[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [salaries, setSalaries] = useState<Record<string, string>>({})
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  function fetchPayroll(m = month) {
    setLoading(true)
    fetch(`/api-proxy/accounts/payroll?month=${m}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => setPayroll(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => {
    fetch(`/api-proxy/employees`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => {
      const emps = Array.isArray(d) ? d : []
      setEmployees(emps)
      const init: Record<string, string> = {}
      emps.forEach((e: Employee) => { init[e.id] = '' })
      setSalaries(init)
    }).catch(() => {})

    fetchPayroll()
  }, [])

  async function runPayroll() {
    const staffSalaries = Object.entries(salaries)
      .filter(([, v]) => v && parseInt(v) > 0)
      .map(([userId, grossUGX]) => ({ userId, grossUGX: parseInt(grossUGX) }))

    if (!staffSalaries.length) return alert('Enter at least one salary')
    setRunning(true)
    try {
      const res = await fetch(`/api-proxy/accounts/payroll/${month}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ staffSalaries }),
      })
      const data = await res.json()
      if (res.ok) { setPayroll(data); }
    } finally { setRunning(false) }
  }

  async function markPaid(id: string) {
    await fetch(`/api-proxy/accounts/payroll/${id}/mark-paid`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    })
    setPayroll(ps => ps.map(p => p.id === id ? { ...p, status: 'PAID' } : p))
  }

  const totalNet = payroll.reduce((s, p) => s + p.netUGX, 0)
  const totalGross = payroll.reduce((s, p) => s + p.grossUGX, 0)
  const totalPAYE = payroll.reduce((s, p) => s + p.paye, 0)
  const totalNSSF = payroll.reduce((s, p) => s + p.nssfEmployee + p.nssfEmployer, 0)

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-clinic-navy">Payroll</h2>
          <p className="text-sm text-gray-400 mt-0.5">Uganda NSSF + PAYE auto-calculated</p>
        </div>
        <input type="month" value={month} onChange={e => { setMonth(e.target.value); fetchPayroll(e.target.value) }}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinic-blue" />
      </div>

      {/* KPI summary */}
      {payroll.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Gross', value: totalGross, colour: 'text-clinic-navy' },
            { label: 'Total Net Pay', value: totalNet, colour: 'text-green-600' },
            { label: 'Total PAYE', value: totalPAYE, colour: 'text-red-500' },
            { label: 'Total NSSF', value: totalNSSF, colour: 'text-yellow-600' },
          ].map(({ label, value, colour }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <p className={cn('text-lg font-bold', colour)}>{formatUGX(value)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Run Payroll panel */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="font-semibold text-clinic-navy mb-4 flex items-center gap-2">
            <Calculator size={16} /> Run Payroll — {month}
          </h3>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {employees.map(emp => (
              <div key={emp.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{emp.firstName} {emp.lastName}</p>
                  <p className="text-xs text-gray-400">{emp.role}</p>
                </div>
                <input
                  type="number"
                  value={salaries[emp.id] || ''}
                  onChange={e => setSalaries(s => ({ ...s, [emp.id]: e.target.value }))}
                  placeholder="Gross UGX"
                  className="w-28 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-right focus:outline-none focus:ring-1 focus:ring-clinic-blue font-mono"
                />
              </div>
            ))}
          </div>
          <button onClick={runPayroll} disabled={running}
            className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 bg-clinic-navy text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-60">
            <Play size={14} />
            {running ? 'Calculating...' : 'Calculate & Run'}
          </button>
          <p className="text-xs text-gray-400 mt-2 text-center">
            PAYE per URA bands · NSSF 5% employee + 10% employer
          </p>
        </div>

        {/* Payroll table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Employee', 'Gross', 'NSSF (5%)', 'PAYE', 'Net Pay', 'Status', ''].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-4 bg-gray-100 rounded animate-pulse w-16" /></td>
                    ))}</tr>
                  ))
                ) : payroll.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                      <Users size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No payroll for {month}. Enter salaries and run payroll.</p>
                    </td>
                  </tr>
                ) : payroll.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3.5">
                      <p className="text-sm font-medium text-gray-800">{p.user.firstName} {p.user.lastName}</p>
                      <p className="text-xs text-gray-400">{p.user.role}</p>
                    </td>
                    <td className="px-4 py-3.5 text-sm font-mono text-gray-700">{formatUGX(p.grossUGX)}</td>
                    <td className="px-4 py-3.5 text-sm font-mono text-yellow-600">{formatUGX(p.nssfEmployee)}</td>
                    <td className="px-4 py-3.5 text-sm font-mono text-red-500">{formatUGX(p.paye)}</td>
                    <td className="px-4 py-3.5 text-sm font-bold font-mono text-green-600">{formatUGX(p.netUGX)}</td>
                    <td className="px-4 py-3.5">
                      <span className={cn('text-xs font-semibold px-2 py-1 rounded-full',
                        p.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700')}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {p.status === 'PENDING' && (
                        <button onClick={() => markPaid(p.id)}
                          className="flex items-center gap-1 text-xs text-clinic-blue hover:underline font-medium">
                          <CheckCircle size={12} /> Mark Paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* NSSF/PAYE note */}
          {payroll.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-100 bg-blue-50 text-xs text-blue-700">
              <strong>Employer NSSF contribution:</strong> {formatUGX(payroll.reduce((s, p) => s + p.nssfEmployer, 0))} (10%) — paid by clinic, not deducted from salary
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
