'use client'

// Shared visual primitives for the Receptionist dashboard cards — deliberately
// a receptionist-local copy of the same primitives used by the Admin
// dashboard (apps/web/app/(admin)/dashboard/page.tsx), not an import from it.
// The two apps intentionally share zero UI modules (see "Separate admin
// console from client app — own login, zero shared UI"); this file exists so
// the *visual language* (typography, spacing, radius) can still match
// exactly without creating a cross-app-group import.

import { cn } from '@/lib/utils'

export function CompactCard({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-white/[0.04]', className)}>
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-slate-200">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

export function DistributionBar({ segments, total }: { segments: { color: string; count: number }[]; total: number }) {
  const denom = Math.max(total, 1)
  return (
    <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
      {segments.filter(s => s.count > 0).map((s, i) => (
        <div key={i} style={{ width: `${(s.count / denom) * 100}%`, background: s.color }} />
      ))}
    </div>
  )
}

export function ChipLegend({ items, loading }: { items: { label: string; count: number; color: string }[]; loading: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1 text-[10px]">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: it.color }} />
          <span className="text-gray-500 dark:text-slate-400">{it.label}</span>
          <span className="font-bold text-gray-700 dark:text-slate-200">{loading ? '—' : it.count}</span>
        </span>
      ))}
    </div>
  )
}

// Large semicircular satisfaction gauge, identical to the Admin dashboard's
// version — full size in both the real and pending states (never a tiny
// placeholder). Only ever rendered in its pending (pct=null) state here
// today, since the Google Business Profile API is still awaiting approval —
// see PatientSatisfactionCard.tsx.
export function SatisfactionGauge({ pct, ratingLabel }: { pct: number | null; ratingLabel: string }) {
  const r = 86, cx = 110, cy = 100, sw = 22
  const circumference = Math.PI * r
  const clamped = pct === null ? 0 : Math.max(0, Math.min(100, pct))
  const offset = circumference * (1 - clamped / 100)
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`
  return (
    <svg viewBox="0 0 220 156" className="mx-auto block w-full max-w-none overflow-visible">
      <defs>
        <linearGradient id="receptionistSatisfactionGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="38%" stopColor="#F59E0B" />
          <stop offset="66%" stopColor="#EAB308" />
          <stop offset="100%" stopColor="#22C55E" />
        </linearGradient>
      </defs>
      <path d={arc} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" className="text-gray-100 dark:text-white/10" />
      {pct !== null && (
        <path d={arc} fill="none" stroke="url(#receptionistSatisfactionGradient)" strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      )}
      <text x={cx} y={cy + 42} textAnchor="middle" fill="currentColor" className={pct === null ? 'text-gray-300 dark:text-white/25' : 'text-clinic-navy dark:text-white'}>
        <tspan fontSize="32" fontWeight="800">{ratingLabel}</tspan>
        <tspan fontSize="15" fontWeight="600" dx="3">/5</tspan>
      </text>
    </svg>
  )
}
