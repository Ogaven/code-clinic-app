'use client'
import { useEffect, useState } from 'react'
import { fetchWithAuth } from '@/lib/api'
import { DollarSign, FileText, TrendingUp, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { formatUGX } from '@/lib/utils'

interface Summary {
  monthRevenue: number
  outstandingDebt: number
  unpaidInvoices: number
  monthExpenses: number
}

const NAV = [
  { label: 'Invoices',  href: '/accounts/invoices' },
  { label: 'Expenses',  href: '/accounts/expenses' },
  { label: 'Payroll',   href: '/accounts/payroll' },
]

export default function AccountsDashboardPage() {
  const [name, setName]       = useState('Accounts')
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || 'null')
      if (u?.firstName) setName(`${u.firstName} ${u.lastName || ''}`.trim())
    } catch {}

    fetchWithAuth('/accounts/dashboard-summary')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSummary(d) })
      .catch(() => {})
  }, [])

  const cards = summary ? [
    { label: 'Month Revenue',    value: formatUGX(summary.monthRevenue),   icon: TrendingUp,   color: 'text-green-600' },
    { label: 'Month Expenses',   value: formatUGX(summary.monthExpenses),  icon: DollarSign,   color: 'text-red-500' },
    { label: 'Outstanding Debt', value: formatUGX(summary.outstandingDebt),icon: AlertCircle,  color: 'text-yellow-500' },
    { label: 'Unpaid Invoices',  value: String(summary.unpaidInvoices),    icon: FileText,     color: 'text-blue-500' },
  ] : []

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Welcome, {name}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Accounts Portal</p>
      </div>

      {/* Quick nav */}
      <div className="flex gap-3 flex-wrap">
        {NAV.map(({ label, href }) => (
          <Link key={href} href={href}
            className="px-4 py-2 rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
            {label}
          </Link>
        ))}
      </div>

      {/* Summary cards */}
      {cards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-2xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 p-5">
              <div className="flex items-center gap-2 mb-2">
                <Icon size={16} className={color} />
                <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
              </div>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
