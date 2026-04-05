'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, DollarSign, AlertCircle, FileText, ArrowUpRight } from 'lucide-react'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { cn, formatUGX } from '@/lib/utils'
import Link from 'next/link'

interface DashboardData {
  monthRevenue: number
  yearRevenue: number
  outstandingDebt: number
  monthExpenses: number
  unpaidInvoices: number
  recentInvoices: any[]
  trend: { month: string; revenue: number; expenses: number }[]
}

const STATUS_BADGE: Record<string, string> = {
  PAID:    'bg-green-100 text-green-700',
  DRAFT:   'bg-gray-100 text-gray-600',
  SENT:    'bg-blue-100 text-blue-700',
  OVERDUE: 'bg-red-100 text-red-700',
  VOID:    'bg-gray-100 text-gray-400 line-through',
}

export default function AccountsDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/accounts/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setData).catch(console.error).finally(() => setLoading(false))
  }, [])

  const profit = (data?.monthRevenue || 0) - (data?.monthExpenses || 0)

  const kpis = [
    {
      label: 'This Month Revenue',
      value: formatUGX(data?.monthRevenue || 0),
      icon: TrendingUp,
      colour: '#29ABE2',
      bg: 'bg-blue-50',
      iconColour: 'text-clinic-blue',
    },
    {
      label: 'This Month Expenses',
      value: formatUGX(data?.monthExpenses || 0),
      icon: TrendingDown,
      colour: '#EF4444',
      bg: 'bg-red-50',
      iconColour: 'text-red-500',
    },
    {
      label: 'Net Profit (Month)',
      value: formatUGX(profit),
      icon: DollarSign,
      colour: profit >= 0 ? '#10B981' : '#EF4444',
      bg: profit >= 0 ? 'bg-green-50' : 'bg-red-50',
      iconColour: profit >= 0 ? 'text-green-600' : 'text-red-500',
    },
    {
      label: 'Outstanding Debt',
      value: formatUGX(data?.outstandingDebt || 0),
      icon: AlertCircle,
      colour: '#F59E0B',
      bg: 'bg-yellow-50',
      iconColour: 'text-yellow-600',
      sub: data?.unpaidInvoices ? `${data.unpaidInvoices} unpaid invoices` : '',
    },
  ]

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-clinic-navy">Accounts Overview</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date().toLocaleDateString('en-UG', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/accounts/invoices" className="px-4 py-2 bg-clinic-blue text-white text-sm font-semibold rounded-lg hover:opacity-90">
            + New Invoice
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <p className="text-xs text-gray-400 font-medium">{kpi.label}</p>
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', kpi.bg)}>
                  <Icon size={15} className={kpi.iconColour} />
                </div>
              </div>
              {loading ? (
                <div className="h-7 bg-gray-200 rounded animate-pulse w-3/4" />
              ) : (
                <p className="text-xl font-bold text-clinic-navy leading-tight">{kpi.value}</p>
              )}
              {kpi.sub && <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>}
            </div>
          )
        })}
      </div>

      {/* Revenue vs Expenses Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-clinic-navy">Revenue vs Expenses</h3>
            <span className="text-xs text-gray-400">Last 6 months</span>
          </div>
          {loading ? (
            <div className="h-56 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data?.trend || []} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                <Tooltip
                  formatter={(v: number) => [formatUGX(v), '']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                <Bar dataKey="revenue"  name="Revenue"  fill="#29ABE2" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#EF4444" radius={[4, 4, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Quick stats */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
          <h3 className="font-semibold text-clinic-navy">Year to Date</h3>
          <div className="space-y-3">
            {[
              { label: 'Total Revenue', value: data?.yearRevenue, colour: 'text-green-600' },
              { label: 'Total Expenses', value: undefined, colour: 'text-red-500' },
              { label: 'Net Profit', value: undefined, colour: 'text-clinic-navy' },
            ].map(({ label, value, colour }) => (
              <div key={label} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-500">{label}</span>
                {loading ? (
                  <div className="h-4 bg-gray-100 rounded animate-pulse w-20" />
                ) : (
                  <span className={cn('text-sm font-bold', colour)}>
                    {formatUGX(value || 0)}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="pt-2">
            <Link href="/accounts/reports" className="flex items-center gap-1 text-xs text-clinic-blue font-medium hover:underline">
              View full reports <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-clinic-navy flex items-center gap-2">
            <FileText size={16} /> Recent Invoices
          </h3>
          <Link href="/accounts/invoices" className="text-xs text-clinic-blue font-medium hover:underline">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Invoice #', 'Patient', 'Amount', 'Date', 'Status'].map(h => (
                  <th key={h} className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide px-5 py-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-5 py-3.5">
                        <div className="h-4 bg-gray-100 rounded animate-pulse w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !data?.recentInvoices?.length ? (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-gray-400 text-sm">
                    No invoices yet
                  </td>
                </tr>
              ) : data.recentInvoices.map((inv: any) => (
                <tr key={inv.id} className="hover:bg-blue-50/20 transition-colors">
                  <td className="px-5 py-3.5">
                    <span className="text-sm font-mono font-medium text-clinic-blue">{inv.invoiceNumber}</span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-700">
                    {inv.patient ? `${inv.patient.firstName} ${inv.patient.lastName}` : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-clinic-navy">
                    {formatUGX(inv.totalUGX)}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-400">
                    {new Date(inv.createdAt).toLocaleDateString('en-UG')}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', STATUS_BADGE[inv.status] || 'bg-gray-100 text-gray-500')}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
